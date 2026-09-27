import { DALE_CHALL_SIZE, DALE_CHALL_WORDS } from '../core/data/dale-chall';
import { isFamiliarWord } from '../core/metrics';
import { commonPrefixLength, similarity } from '../core/similarity';
import { splitSentences, tokenizeWords } from '../core/text';
import type { AnnotationDraft, Stat, Tool } from '../core/types';

/**
 * The other half of `% unfamiliar`: it highlights exactly the words the topbar
 * metric counts, and for each one names the nearest words that *are* on the
 * Dale–Chall list, so the number is something you can act on rather than just
 * read.
 *
 * Suggestions come from two places, in this order:
 *
 *   1. **Word family** — the flagged word is a listed word wearing a prefix or a
 *      derivational suffix ("enormousness" → "enormous", "reshaping" → "shape").
 *      This is the high-precision signal: the base word is *in* the flagged word.
 *   2. **Spelling** — edit distance against listed words sharing an opening and
 *      a length ballpark. This catches simple variants and typos, and is
 *      necessarily noisier, which is why it ranks below the family matches and
 *      can be filtered by the `match` option.
 *
 * The honest limitation, stated in the tool description rather than hidden: this
 * is a *spelling* similarity, not a semantic one. eztext has no embeddings and
 * no runtime dependencies, so "similar" means "close in letters or word
 * family". "enormous" has no near-listed word at all, and the tool says so
 * instead of inventing one.
 */

/** Relations, best first. Also used verbatim as the annotation groups. */
type Relation = 'base form' | 'shorter form' | 'close spelling';

export interface WordSuggestion {
  word: string;
  relation: Relation;
  /** Raw spelling similarity, 0–1. Ranking is by relation first, then this. */
  similarity: number;
}

const RELATION_RANK: Record<Relation, number> = {
  'base form': 0,
  'shorter form': 1,
  'close spelling': 2,
};

/** Match strength → how close a spelling has to be before it is offered. */
const STRENGTH: Record<string, number> = { loose: 0.45, balanced: 0.6, strict: 0.75 };

/** Below this length a spelling match is noise, not a suggestion. */
const MIN_SPELLING_LENGTH = 4;

/** Spelling floor for words shorter than six letters, whatever the strength. */
const SHORT_WORD_FLOOR = 0.7;

/** How far a spelling candidate's length may differ from the flagged word. */
const LENGTH_WINDOW = 3;

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

/** Listed words bucketed by first letter, so a lookup never scans all 3,000. */
let indexByInitial: Map<string, string[]> | null = null;

function bucketFor(initial: string): string[] {
  if (!indexByInitial) {
    indexByInitial = new Map();
    for (const entry of DALE_CHALL_WORDS) {
      const key = lettersOnly(entry).charAt(0);
      if (!key) continue;
      const bucket = indexByInitial.get(key);
      if (bucket) bucket.push(entry);
      else indexByInitial.set(key, [entry]);
    }
  }
  return indexByInitial.get(initial) ?? [];
}

/**
 * Candidate base words hidden inside `word` by a suffix, a prefix, or both
 * ("reshaping" → reshape → shape), each tagged with how it was reached.
 *
 * Two levels is enough for English derivation and keeps the search bounded; a
 * plain `editDistance` match handles the rest. The tag matters because the
 * strings alone cannot tell you the relation: "reshaping" does not contain
 * "shape" as a substring, yet that is exactly what the prefix strip found.
 */
function familyForms(word: string): Map<string, Relation> {
  const found = new Map<string, Relation>();
  let frontier = [{ word, kind: 'base form' as Relation }];

  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    const next = new Map<string, Relation>();

    const visit = (stem: string, kind: Relation) => {
      if (DALE_CHALL_WORDS.has(stem)) {
        if (!found.has(stem)) found.set(stem, kind);
      } else if (stem.length >= 4 && !next.has(stem)) {
        // Keep going only through plausible words: junk intermediates multiply.
        next.set(stem, kind);
      }
    };

    for (const current of frontier) {
      for (const stem of stemCandidates(current.word)) visit(stem, 'base form');
      for (const stem of prefixCandidates(current.word)) visit(stem, 'shorter form');
    }

    frontier = [...next.entries()].slice(0, 32).map(([stem, kind]) => ({ word: stem, kind }));
  }

  return found;
}

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
    if (/^[aeiou]/.test(suffix)) add(`${stem}e`);
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
 * Nearest listed words for one flagged word, best first.
 *
 * Exported for the smoke test, which checks the promise this tool makes: every
 * suggestion really is on the list, and the family matches outrank the
 * spelling ones.
 */
export function suggestFamiliarWords(
  rawWord: string,
  { limit = 4, minSimilarity = STRENGTH.balanced }: { limit?: number; minSimilarity?: number } = {},
): WordSuggestion[] {
  const capped = Math.max(0, Math.min(10, limit));
  const word = lettersOnly(rawWord);
  if (capped === 0 || word.length < 3) return [];

  const key = `${word}|${capped}|${minSimilarity}`;
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  const ranked: WordSuggestion[] = [];
  const seen = new Set<string>();

  for (const [form, relation] of familyForms(word)) {
    if (seen.has(form)) continue;
    seen.add(form);
    ranked.push({ word: form, relation, similarity: round2(similarity(word, form)) });
  }

  for (const candidate of bucketFor(word.charAt(0))) {
    if (seen.has(candidate)) continue;
    if (candidate.length < MIN_SPELLING_LENGTH) continue;
    if (Math.abs(candidate.length - word.length) > LENGTH_WINDOW) continue;

    // Short words are where spelling resemblance misleads most ("verbs" and
    // "very" differ by two letters and mean nothing alike), so they have to
    // clear a higher bar than the chosen strength.
    const floor = word.length < 6 ? Math.max(minSimilarity, SHORT_WORD_FLOOR) : minSimilarity;
    const prefixFloor = word.length <= 4 ? 3 : 2;

    const longest = Math.max(word.length, candidate.length);
    const score = similarity(word, candidate, Math.ceil(longest * (1 - floor)) + 1);
    if (score < floor) continue;
    // A shared opening is what makes a spelling match feel related instead of
    // accidental — unless the two are nearly identical anyway.
    if (commonPrefixLength(word, candidate) < prefixFloor && score < 0.8) continue;

    ranked.push({ word: candidate, relation: 'close spelling', similarity: round2(score) });
  }

  ranked.sort(
    (a, b) =>
      RELATION_RANK[a.relation] - RELATION_RANK[b.relation] ||
      b.similarity - a.similarity ||
      a.word.length - b.word.length ||
      (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  );

  const result = ranked.slice(0, capped);
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
      `“${word}” is not on the Dale–Chall list, and no word close to it is either — usually a ` +
      `name, a technical term, or simply rarer than a fourth-grader’s vocabulary.`
    );
  }

  const nearest = suggestions.map((suggestion) => `“${suggestion.word}” (${suggestion.relation})`).join(', ');
  return `“${word}” is not on the Dale–Chall list. Nearest listed words: ${nearest}.`;
}

export const daleChallTool: Tool = {
  id: 'dale-chall',
  name: 'Dale–Chall',
  description:
    'Every word outside the Dale–Chall list of familiar words, with the nearest listed words to ' +
    'swap in. Similarity is spelling and word family, not meaning.',
  category: 'readability',
  color: '#2f9488',
  // Off by default: it flags ~20% of the words in ordinary prose, which is the
  // point of the tool but a lot of colour to switch on for someone else.
  defaultEnabled: false,
  options: [
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
      label: 'Match strength',
      default: 'balanced',
      choices: [
        { value: 'loose', label: 'Loose' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'strict', label: 'Strict' },
      ],
      hint: 'How close a spelling must be before it is suggested. Word-family matches always qualify.',
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

  run({ text, options }) {
    const limit = Number(options.suggestions ?? 4);
    const minSimilarity = STRENGTH[String(options.match ?? 'balanced')] ?? STRENGTH.balanced;
    const onlyWithMatch = String(options.show ?? 'all') === 'fixable';
    const ignoreNames = Boolean(options.ignoreNames ?? false);

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
      if (isFamiliarWord(word)) continue;

      if (ignoreNames && sentenceStarts && !sentenceStarts.has(token.start) && isCapitalised(token.text)) {
        ignoredNames += 1;
        continue;
      }

      const suggestions = suggestFamiliarWords(word, { limit, minSimilarity });
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
        id: 'dale-chall.words',
        label: 'Unfamiliar words',
        value: flagged,
        hint:
          flagged > 0
            ? `${annotations.length} highlighted${onlyWithMatch ? ' — only words with a match' : ''}`
            : 'every word is on the list',
        tone: 'accent',
      },
      { id: 'dale-chall.distinct', label: 'Distinct words', value: distinct, hint: `of ${tokens.length} words` },
      {
        id: 'dale-chall.matched',
        label: 'With a match',
        value: matched.size,
        hint: `of ${distinct} distinct words`,
      },
      {
        id: 'dale-chall.common',
        label: 'Most flagged',
        value: mostCommon ? mostCommon[0] : '—',
        hint: mostCommon ? `${mostCommon[1]}×` : undefined,
      },
      {
        id: 'dale-chall.longest',
        label: 'Longest',
        value: longest || '—',
        hint: longest ? `${longest.length} letters` : undefined,
      },
      {
        id: 'dale-chall.list',
        label: 'Reference list',
        value: DALE_CHALL_SIZE.toLocaleString('en-US'),
        hint: 'words a fourth-grader knows',
      },
    ];

    if (ignoreNames) {
      stats.splice(3, 0, {
        id: 'dale-chall.names',
        label: 'Names ignored',
        value: ignoredNames,
        hint: 'capitalised, not sentence-initial',
      });
    }

    return { annotations, stats };
  },
};
