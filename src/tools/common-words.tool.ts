import { COMMON_WORD_FLOOR, countCommonWords, isCommonWord, prevalenceOf } from '../core/data/common-words';
import { isFamiliarWord, normalCdf } from '../core/metrics';
import { similarity, type SemanticNeighbour } from '../core/similarity';
import { splitSentences, tokenizeWords } from '../core/text';
import type { AnnotationDraft, Stat, Tool } from '../core/types';

/**
 * The other half of `% unfamiliar`: it highlights exactly the words the topbar
 * metric counts, and for each one names the nearest words that *are* common, so
 * the number is something you can act on rather than just read.
 *
 * Suggestions come from two places, in this order:
 *
 *   1. **Word family** — the flagged word is a listed word wearing a prefix or a
 *      derivational suffix ("enormousness" → "enormous", "reshaping" → "shape").
 *      Same lexeme, different form: the meaning is carried over exactly, and the
 *      base word is *in* the flagged word.
 *   2. **Meaning** — the embedding service's nearest common words by cosine,
 *      which needs the model process. Filtered by the `match` strength.
 *
 * There used to be a third tier, spelling distance, and it is gone on purpose:
 * on the words that actually get flagged it offered coincidence rather than
 * vocabulary — "merely" → "merry", "defenestration" → "deforestation" — and
 * the embedding tier measured both better and more honestly. A word the model
 * does not know now gets its family match or nothing, which is the truth about
 * it.
 *
 * The remaining honest limitation: without the model process there are no
 * meaning suggestions at all, only word-family ones.
 */

/** Relations, best first. Also used verbatim as the annotation groups. */
type Relation = 'base form' | 'shorter form' | 'similar meaning';

export interface WordSuggestion {
  word: string;
  relation: Relation;
  /**
   * Probability a reader knows the suggested word, 0–1 — the list's probit read
   * as a probability (`normalCdf`). The floor is 94.5%, the ceiling 99.5%, so
   * this is the one number that says how *safe* a swap is: "commonplace" at 99%
   * is a better bet than "occult" at 97%, whatever the cosine says.
   */
  known?: number;
  /**
   * How close, 0–1. For a word-family relation this is spelling distance — the
   * base word really is inside the flagged one; for `similar meaning` it is the
   * embedding cosine, which is why the inspector shows the relation rather than
   * pretending the two are the same number.
   */
  similarity: number;
}

/**
 * Ranking order. Word family first: "passage" → "pass" is a *simpler word for
 * the same idea*, which is what a readability tool is for. Meaning comes second,
 * and there is nothing after it: see the note above about spelling.
 */
const RELATION_RANK: Record<Relation, number> = {
  'base form': 0,
  'shorter form': 1,
  'similar meaning': 2,
};

/** Match strength → how close in meaning a suggestion has to be. */
const STRENGTH: Record<string, number> = { loose: 0.55, balanced: 0.62, strict: 0.75 };

/**
 * Derivational suffixes. Inflectional ones (plural, -ed, -ing, -er/-est, -ly)
 * are already what `isFamiliarWord` strips, so a word fixable that way is never
 * flagged in the first place; these are the endings that change a word's class
 * or add meaning, which is what makes "enormousness" flag while "enormous"
 * stays familiar.
 */
const SUFFIXES = [
  'fulness', 'lessness', 'ousness', 'iveness', 'ability', 'ibility',
  'ations', 'ation', 'itions', 'ition', 'utions', 'ution',
  'ments', 'ment', 'ness', 'nesses', 'ship', 'hood', 'wards', 'ward', 'wise',
  'tions', 'tion', 'sions', 'sion',
  'ities', 'ity', 'ancies', 'ancy', 'encies', 'ency', 'ances', 'ance', 'ences', 'ence',
  'ables', 'able', 'ibles', 'ible', 'fully', 'ful', 'lessly', 'less',
  'ously', 'ous', 'ively', 'ive', 'ically', 'ic', 'ally', 'al',
  'ists', 'ist', 'isms', 'ism', 'eries', 'ery', 'ages', 'age', 'ates', 'ate',
  'izes', 'ize', 'ises', 'ise', 'ants', 'ant', 'ents', 'ent', 'aries', 'ary', 'ories', 'ory',
  'ners', 'ner', 'ers', 'er', 'ors', 'or',
  'ings', 'ing', 'eds', 'ed', 'ies', 'ied', 'ier', 'iest', 'est', 'es', 's',
];

/** Prefixes that carry meaning of their own; stripping one leaves a listed base. */
const PREFIXES = [
  'under', 'over', 'inter', 'super', 'semi', 'anti', 'auto', 'micro', 'macro', 'multi',
  'trans', 'post', 'fore', 'counter', 'sub', 'pre', 'mis', 'dis', 'non', 'out', 'mid',
  'un', 're', 'in', 'im', 'ir', 'il', 'de', 'en', 'em', 'be', 'co', 'ex', 'up',
];

/** Letters only, lower-case: how the list is keyed and how we compare words. */
function lettersOnly(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

/** Stored words bucketed by first letter, so a lookup never scans all 24,000. */
/**
 * Candidate base words hidden inside `word` by a suffix, a prefix, or both
 * ("reshaping" → reshape → shape), each tagged with how it was reached.
 *
 * Two levels is enough for English derivation and keeps the search bounded; a
 * plain `editDistance` match handles the rest. The tag matters because the
 * strings alone cannot tell you the relation: "reshaping" does not contain
 * "shape" as a substring, yet that is exactly what the prefix strip found.
 */
function familyForms(word: string, threshold: number = COMMON_WORD_FLOOR): Map<string, Relation> {
  const found = new Map<string, Relation>();
  let frontier = [{ word, kind: 'base form' as Relation }];

  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    const next = new Map<string, Relation>();

    const visit = (stem: string, kind: Relation) => {
      if (isCommonWord(stem, threshold)) {
        if (!found.has(stem)) found.set(stem, kind);
      }
      // Keep reducing even through a word that is itself on the list: "reshaping"
      // should reach both "reshape" and, one step further, "shape" — the deeper
      // word is usually the simpler one, which is the point of the tool.
      if (stem.length >= 4 && !next.has(stem)) next.set(stem, kind);
    };

    for (const current of frontier) {
      for (const stem of stemCandidates(current.word)) visit(stem, 'base form');
      for (const stem of prefixCandidates(current.word)) visit(stem, 'shorter form');
    }

    frontier = [...next.entries()].slice(0, 32).map(([stem, kind]) => ({ word: stem, kind }));
  }

  return found;
}

/**
 * Endings where a final `e` is dropped before the suffix, so the stem is
 * restored with one: making → make, hoped → hope, larger → large.
 *
 * Deliberately only the inflectional ones. The rule used to apply to every
 * vowel-initial suffix, which invented derivations that are not there —
 * "brutal" minus "al" plus "e" is "brute", and the tool then claimed "brute"
 * was a base word of "brutalist".
 */
const E_RESTORING = new Set(['ing', 'ed', 'er', 'est', 'es']);

function stemCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (stem: string) => {
    if (stem.length >= 3 && stem !== word) out.push(stem);
  };

  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 2) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem);
    // A final y turns into i before most endings: happiness → happy.
    if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
    // An ending that starts with a vowel often replaces a final e: reshaping → reshape.
    if (E_RESTORING.has(suffix)) add(`${stem}e`);
    // Doubled consonant: stopping → stop.
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) add(stem.slice(0, -1));
  }

  return out;
}

function prefixCandidates(word: string): string[] {
  const out: string[] = [];
  for (const prefix of PREFIXES) {
    if (!word.startsWith(prefix) || word.length <= prefix.length + 2) continue;
    out.push(word.slice(prefix.length));
  }
  return out;
}

const round2 = (value: number) => Number(value.toFixed(2));

/**
 * p(known) for a stored word: the prevalence list stores a probit, and this reads
 * it as a probability. `undefined` for a word the list does not carry.
 */
export function knownProbability(word: string): number | undefined {
  const probit = prevalenceOf(word);
  return probit === undefined ? undefined : normalCdf(probit);
}

/** `Xenova/bge-small-en-v1.5` reads better in a stat card as `bge-small-en-v1.5`. */
const shortModel = (model: string) => model.replace(/^[^/]+\//, '');

/**
 * Nearest listed words for one flagged word, best first.
 *
 * `semantic` is what the embedding model said (or `undefined` when it is not
 * running, in which case only word-family matches can be found).
 *
 * Exported for the smoke test, which checks the promise this tool makes: every
 * suggestion really is on the list, whatever source it came from.
 */
export function suggestFamiliarWords(
  rawWord: string,
  {
    limit = 4,
    minSimilarity = STRENGTH.balanced,
    semantic,
    threshold = COMMON_WORD_FLOOR,
  }: {
    limit?: number;
    minSimilarity?: number;
    semantic?: SemanticNeighbour[];
    threshold?: number;
  } = {},
): WordSuggestion[] {
  const capped = Math.max(0, Math.min(10, limit));
  const word = lettersOnly(rawWord);
  if (capped === 0 || word.length < 3) return [];

  const key = `${word}|${capped}|${minSimilarity}|${threshold}|${semantic ? semantic.length : 'none'}`;
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  const ranked: WordSuggestion[] = [];
  const seen = new Set<string>();

  for (const [form, relation] of familyForms(word, threshold)) {
    if (seen.has(form)) continue;
    seen.add(form);
    ranked.push({ word: form, relation, similarity: round2(similarity(word, form)) });
  }

  if (semantic) {
    // Never trust an external list blindly: the signal comes from another
    // process, so anything it sends is re-checked against the list here —
    // including the current threshold, which the server may not have seen.
    for (const neighbour of semantic) {
      if (neighbour.score < minSimilarity) continue;
      if (seen.has(neighbour.word) || !isCommonWord(neighbour.word, threshold)) continue;
      seen.add(neighbour.word);
      ranked.push({ word: neighbour.word, relation: 'similar meaning', similarity: round2(neighbour.score) });
    }
  }

  ranked.sort(
    (a, b) =>
      RELATION_RANK[a.relation] - RELATION_RANK[b.relation] ||
      b.similarity - a.similarity ||
      a.word.length - b.word.length ||
      (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  );

  const result = ranked.slice(0, capped).map((suggestion) => ({
    ...suggestion,
    known: knownProbability(suggestion.word),
  }));
  if (suggestionCache.size >= 4000) suggestionCache.clear(); // bounded; options rarely move
  suggestionCache.set(key, result);
  return result;
}

const suggestionCache = new Map<string, WordSuggestion[]>();

/**
 * Offsets of the tokens that open a sentence.
 *
 * Used by `ignoreNames`: a capitalised word *inside* a sentence is probably a
 * name, while one that opens a sentence is just English orthography.
 */
function sentenceInitialStarts(text: string, tokens: ReturnType<typeof tokenizeWords>): Set<number> {
  const sentences = splitSentences(text);
  const starts = new Set<number>();
  let sentence = 0;
  let seenInSentence = false;

  for (const token of tokens) {
    while (sentence < sentences.length && token.start >= sentences[sentence].end) {
      sentence += 1;
      seenInSentence = false;
    }
    if (!seenInSentence) {
      starts.add(token.start);
      seenInSentence = true;
    }
  }

  return starts;
}

function isCapitalised(text: string): boolean {
  const first = text.charAt(0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

function describe(word: string, suggestions: WordSuggestion[]): string {
  if (suggestions.length === 0) {
    return (
      `“${word}” is not a common word, and no listed word is close to it in meaning — usually ` +
      `a name, a technical term, or simply rarer than the model knows.`
    );
  }

  // Grouped rather than listed flat: "closer in meaning" and "same base word" are
  // different kinds of advice, and the reader should not have to work out which
  // is which from a parenthetical.
  const quote = (list: WordSuggestion[]) => list.map((suggestion) => `“${suggestion.word}”`).join(', ');
  const meaning = suggestions.filter((suggestion) => suggestion.relation === 'similar meaning');
  const family = suggestions.filter((suggestion) => suggestion.relation !== 'similar meaning');

  const parts: string[] = [];
  if (family.length > 0) {
    const base = family[0].relation === 'base form' ? 'its base word' : 'a shorter form of it';
    parts.push(`${quote(family)} ${family.length === 1 ? `is ${base}` : `are related words`}`);
  }
  if (meaning.length > 0) parts.push(`${quote(meaning)} ${meaning.length === 1 ? 'is' : 'are'} closer in meaning`);

  return `“${word}” is not a common word. On the list: ${parts.join('; ')}.`;
}

export const commonWordsTool: Tool = {
  id: 'common-words',
  name: 'Common words',
  description:
    'Every word outside the words most US readers know, with the nearest listed words to ' +
    'swap in — by meaning when the local embedding model is running, and by word family always.',
  category: 'readability',
  color: '#2f9488',
  // Off by default: it flags the words a typical reader may not know, which in
  // ordinary prose is now a small fraction — but it is still a lot of colour to
  // switch on for someone else.
  defaultEnabled: false,
  // Meaning-based neighbours come from the model process. Without it the tool
  // still works, from word family alone, so this is a pure upgrade.
  requires: ['similarity'],
  options: [
    {
      // Above the floor only: nothing below it is stored, so a lower setting
      // could not be honoured anyway. Raising it is the point — a stricter
      // "familiar" bar flags more words, for the topbar metric as well.
      kind: 'number',
      id: 'threshold',
      label: 'Prevalence threshold',
      default: COMMON_WORD_FLOOR,
      min: COMMON_WORD_FLOOR,
      max: 2.6,
      step: 0.1,
      hint: 'Words at or below this count as unfamiliar, for % unfamiliar too. The floor is every word the list has.',
    },
    {
      kind: 'number',
      id: 'suggestions',
      label: 'Suggestions per word',
      default: 4,
      min: 0,
      max: 10,
      step: 1,
      hint: 'How many listed words to offer for each flagged word.',
    },
    {
      kind: 'select',
      id: 'match',
      label: 'Meaning match',
      default: 'balanced',
      choices: [
        { value: 'loose', label: 'Loose' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'strict', label: 'Strict' },
      ],
      hint: 'How close in meaning a suggestion must be. Word-family matches always qualify.',
    },
    {
      kind: 'select',
      id: 'show',
      label: 'Highlight',
      default: 'all',
      choices: [
        { value: 'all', label: 'Every unfamiliar word' },
        { value: 'fixable', label: 'Only words with a match' },
      ],
      hint: '“Only words with a match” hides the names and jargon you cannot rephrase anyway.',
    },
    {
      kind: 'boolean',
      id: 'ignoreNames',
      label: 'Ignore names',
      default: false,
      hint: 'Skip capitalised words that do not open a sentence — usually proper nouns. Off by default, so the count matches the topbar’s % unfamiliar.',
    },
  ],

  run({ text, options, signals }) {
    const limit = Number(options.suggestions ?? 4);
    const threshold = Math.max(
      COMMON_WORD_FLOOR,
      Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : COMMON_WORD_FLOOR,
    );
    const strength = String(options.match ?? 'balanced');
    const minSimilarity = STRENGTH[strength] ?? STRENGTH.balanced;
    const onlyWithMatch = String(options.show ?? 'all') === 'fixable';
    const ignoreNames = Boolean(options.ignoreNames ?? false);
    const neighbours = signals?.similarity?.words;

    const tokens = tokenizeWords(text);
    const sentenceStarts = ignoreNames ? sentenceInitialStarts(text, tokens) : null;

    const annotations: AnnotationDraft[] = [];
    const occurrences = new Map<string, number>();
    const matched = new Set<string>();
    let flagged = 0;
    let ignoredNames = 0;
    let longest = '';

    for (const token of tokens) {
      const word = token.lower;
      if (isFamiliarWord(word, threshold)) continue;

      if (ignoreNames && sentenceStarts && !sentenceStarts.has(token.start) && isCapitalised(token.text)) {
        ignoredNames += 1;
        continue;
      }

      const suggestions = suggestFamiliarWords(word, {
        limit,
        minSimilarity,
        semantic: neighbours?.[word],
        threshold,
      });
      flagged += 1;
      if (suggestions.length > 0) matched.add(word);
      occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
      if (word.length > longest.length) longest = word;

      if (onlyWithMatch && suggestions.length === 0) continue;

      annotations.push({
        start: token.start,
        end: token.end,
        label: token.text,
        group: suggestions.length > 0 ? suggestions[0].relation : 'no match',
        detail: describe(word, suggestions),
        data: { suggestions },
      });
    }

    const distinct = occurrences.size;
    const mostCommon = [...occurrences.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0];

    const stats: Stat[] = [
      {
        id: 'common-words.words',
        label: 'Unfamiliar words',
        value: flagged,
        hint:
          flagged > 0
            ? `${annotations.length} highlighted${onlyWithMatch ? ' — only words with a match' : ''}`
            : 'every word is on the list',
        tone: 'accent',
      },
      { id: 'common-words.distinct', label: 'Distinct words', value: distinct, hint: `of ${tokens.length} words` },
      {
        id: 'common-words.matched',
        label: 'With a match',
        value: matched.size,
        hint: `of ${distinct} distinct words`,
      },
      {
        id: 'common-words.common',
        label: 'Most flagged',
        value: mostCommon ? mostCommon[0] : '—',
        hint: mostCommon ? `${mostCommon[1]}×` : undefined,
      },
      {
        id: 'common-words.longest',
        label: 'Longest',
        value: longest || '—',
        hint: longest ? `${longest.length} letters` : undefined,
      },
      // Which source the suggestions came from, so "no match" is never mistaken
      // for "nothing exists" when the model is simply not running.
      {
        id: 'common-words.source',
        label: 'Nearest words from',
        value: signals?.similarity?.model ? shortModel(signals.similarity.model) : 'word family only',
        hint: signals?.similarity?.model ? 'embeddings, plus word family' : 'start the model for meaning',
        tone: signals?.similarity?.model ? undefined : 'warn',
      },
      {
        id: 'common-words.list',
        label: 'Reference list',
        value: countCommonWords(threshold).toLocaleString('en-US'),
        hint: `words above prevalence ${threshold}`,
      },
    ];

    if (ignoreNames) {
      stats.splice(3, 0, {
        id: 'common-words.names',
        label: 'Names ignored',
        value: ignoredNames,
        hint: 'capitalised, not sentence-initial',
      });
    }

    return { annotations, stats };
  },
};
