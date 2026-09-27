/**
 * Syntax helpers for structure-oriented tools.
 *
 * These are the rule-based approximation of a shallow parse — T-unit
 * boundaries, subordinate-clause spans, and the local tests that separate a
 * closed-class word from its homographs. They are deliberately conservative and
 * every consumer is expected to state the rule it relies on in the annotation
 * `detail` rather than pass the output off as a parse.
 *
 * Definitions follow Hunt (1965), whose T-unit underlies the Golub Syntactic
 * Density Score: one main clause plus every subordinate clause attached to or
 * embedded in it. Coordinated main clauses are therefore separate T-units even
 * when an orthographic sentence contains both.
 */
import { splitSentences, tokenizeWords, type WordToken } from './text';
import type { TextRange } from './types';

export interface SyntaxToken extends WordToken {
  /** Position in the document's token list. */
  index: number;
  /** Neighbouring words, skipping punctuation and whitespace. */
  next: SyntaxToken | null;
  prev: SyntaxToken | null;
  /** Text between this token and its neighbour (punctuation and spaces). */
  before: string;
  after: string;
  /** Index of the sentence this token falls in. */
  sentence: number;
  /** Followed by a bare possessive apostrophe: `students'`. */
  pluralPossessive: boolean;
}

/**
 * Words and their neighbours over the whole document.
 *
 * Punctuation is not tokenised — a gap between two words is kept as a string,
 * which is all the local tests need (`“and” directly after a comma?`). A
 * trailing apostrophe is treated as possessive unless the space before the word
 * contains an unmatched quote, which makes the apostrophe a closing quote.
 */
export function tokenizeSyntax(text: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = tokenizeWords(text).map((word, index) => ({
    ...word,
    index,
    next: null,
    prev: null,
    before: '',
    after: '',
    sentence: 0,
    pluralPossessive: false,
  }));

  const sentences = splitSentences(text);
  let sentence = 0;
  for (const token of tokens) {
    while (sentence < sentences.length && token.start >= sentences[sentence].end) sentence += 1;
    token.sentence = sentences.length === 0 ? 0 : Math.min(sentence, sentences.length - 1);
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i + 1 < tokens.length ? tokens[i + 1] : null;
    token.prev = prev;
    token.next = next;
    token.before = text.slice(prev ? prev.end : 0, token.start);
    token.after = text.slice(token.end, next ? next.start : text.length);

    const trailing = text.slice(token.end, token.end + 1);
    const apostrophes = (token.before.match(/['’ʼ]/g) ?? []).length;
    token.pluralPossessive = /['’ʼ]/.test(trailing) && apostrophes % 2 === 0;
  }

  return tokens;
}

/* ------------------------------------------------------------------ */
/* Verb-ish tests                                                      */
/* ------------------------------------------------------------------ */

/**
 * High-frequency English verbs in base form. Enough for local decisions
 * (“does this `to` introduce a verb?”); not a dictionary. Recovered from the
 * removed Verbs example tool (`git show 57785d1^:src/tools/verbs.tool.ts`).
 */
export const BASE_VERBS = new Set(
  `ask avoid accept add admit agree allow answer appear apply argue arrive
believe belong break bring build buy call care carry catch cause change choose claim clean clear
close come compare complain complete consider continue cook count cover create cross cut decide
deliver describe design destroy develop die disagree discover discuss divide draw dream drive drop
earn eat enable encourage enjoy enter exist expect explain explore express fail fall fear feel
fight fill find finish fit fix fly follow forget forgive form gain gather get give go grow guess
handle happen hate hear help hide hit hold hope hurt imagine improve include increase indicate
intend introduce invent invite join jump keep kill know laugh lead learn leave lend let lie like
listen live look lose love manage mark matter mean measure meet mention miss move need notice
obtain offer open order own pass pay perform pick place plan play point prefer prepare present
prevent produce promise protect prove provide pull push put raise reach read realize receive
recognize reduce refuse regard relate remain remember remove repeat reply report request require
rescue respect respond rest result return reveal ride ring rise risk run save say search see seem
sell send serve set shake share shine shoot shop show shut sign sing sit sleep smile solve speak
spend stand start stay steal stick stop study succeed suggest supply support suppose surprise
survive take talk teach tell tend test thank think throw touch train travel treat trust try turn
understand unite use visit wait walk want warn wash watch wear win wish wonder worry write`
    .split(/\s+/)
    .filter(Boolean),
);

const IRREGULAR_FINITE = new Set(
  `am is are was were been being have has had having do does did done doing
went came saw said told made took gave found left felt kept ran ate wrote read grew knew thought
brought bought caught met paid sat stood understood won lost sold sent spent built heard held slept
meant led began fell drove spoke chose broke wore drew flew forgot rode rang sang drank swam threw
stole hid bit shook shot fought sought dealt dug hung stuck struck swept wept crept cost hurt quit
split spread rose lay bore beat bent bound bred cast chose clung crept dealt drew fed flung froze
ground knelt laid leapt lent lit rode sank sought sewed shone tore wove`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Finite-verb guess by form: an auxiliary/modal, an irregular past, or the
 * regular endings. False positives on plural nouns (`apples`) are accepted —
 * the callers use this to *confirm* a candidate boundary, never to create one.
 */
export function looksLikeVerb(token: SyntaxToken): boolean {
  const lower = token.lower;
  if (AUXILIARIES.has(lower) || IRREGULAR_FINITE.has(lower) || BASE_VERBS.has(lower)) return true;
  if (lower.length > 4 && /(?:ed|ing)$/.test(lower)) return true;
  if (lower.length > 3 && /s$/.test(lower) && !/(?:ss|us|is)$/.test(lower)) return true;
  return false;
}

/** Could this word head an infinitive after `to`? Verb list first, then common endings. */
export function looksLikeBaseVerb(lower: string): boolean {
  if (BASE_VERBS.has(lower) || AUXILIARIES.has(lower)) return true;
  if (lower.length > 4 && /(?:ate|ize|ise|ify|fy)$/.test(lower)) return true;
  return false;
}

export const AUXILIARIES = new Set(
  `be am is are was were been being have has had having do does did done doing
will would shall should can could may might must ought`.split(/\s+/),
);

/** Golub's preposition list (ED091741). Closed class, shared with the clause tests. */
export const PREPOSITIONS = new Set(
  `about above across after against along amid among around at before behind below beneath beside
besides between beyond by concerning down during except for from in into like of off on over past
since through throughout to toward under underneath until unto up upon with within without`
    .split(/\s+/)
    .filter(Boolean),
);

export function isCapitalised(token: SyntaxToken): boolean {
  return /^\p{Lu}/u.test(token.text) && token.text.length > 1;
}

/* ------------------------------------------------------------------ */
/* T-units                                                             */
/* ------------------------------------------------------------------ */

export interface TUnit extends TextRange {
  sentence: number;
  /** Global token indices, `[wordStart, wordEnd)`. */
  wordStart: number;
  wordEnd: number;
}

const COORDINATORS = new Set(['and', 'but', 'or', 'nor', 'yet', 'so']);

export const SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'there']);

const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'another', 'each', 'every', 'some', 'any',
  'no', 'one', 'both', 'all', 'such', 'which', 'what', 'whatever', 'my', 'your', 'his', 'her',
  'its', 'our', 'their',
]);

/** Adverbs that can sit between a coordinator and the clause it introduces. */
const CLAUSE_ADVERBS = new Set([
  'then', 'soon', 'later', 'now', 'afterwards', 'finally', 'suddenly', 'meanwhile', 'however',
  'nevertheless', 'therefore', 'still', 'also', 'just', 'only', 'perhaps', 'probably',
]);

function isSubjectLike(token: SyntaxToken): boolean {
  return (
    SUBJECT_PRONOUNS.has(token.lower) || DETERMINERS.has(token.lower) || isCapitalised(token)
  );
}

/** Does a finite-verb guess follow before the next clause boundary? */
function clauseHasVerb(words: SyntaxToken[], from: number): boolean {
  for (let i = from; i < words.length; i += 1) {
    if (i > from && (COORDINATORS.has(words[i].lower) || /[;,]/.test(words[i].before))) break;
    // A verb-ish word right after a preposition is almost always its object
    // (`of verbs`, `in writing`), not the clause's finite verb.
    const afterPreposition = i > 0 && PREPOSITIONS.has(words[i - 1].lower);
    if (!afterPreposition && looksLikeVerb(words[i])) return true;
  }
  return false;
}

/**
 * Does the word at `words[i]` open a new T-unit?
 *
 * A semicolon always does. A coordinator does when it joins clauses rather than
 * phrases or list items: a following pronoun is conclusive, and a following
 * determiner or proper noun is accepted only when a finite-verb guess follows.
 * `for` is only a coordinator after a comma — otherwise it is a preposition,
 * which is the original program's rule (ED090304, routine FOR).
 */
function startsTUnit(words: SyntaxToken[], i: number): boolean {
  const word = words[i];
  if (word.before.includes(';')) return true;
  if (!COORDINATORS.has(word.lower)) return false;
  if (word.lower === 'for' && !word.before.includes(',')) return false;

  let next = i + 1;
  if (!words[next]) return false;
  if (CLAUSE_ADVERBS.has(words[next].lower) && words[next + 1]) next += 1;
  const candidate = words[next];

  if (SUBJECT_PRONOUNS.has(candidate.lower)) return true;
  if (AUXILIARIES.has(candidate.lower) && words[next + 1] && isSubjectLike(words[next + 1])) {
    return clauseHasVerb(words, next + 1);
  }
  if (!isSubjectLike(candidate)) return false;
  return clauseHasVerb(words, next);
}

/**
 * T-unit ranges for the whole document. Each unit keeps its sentence index and
 * the global token range it covers, so callers can count words exactly.
 */
export function splitTUnits(tokens: SyntaxToken[]): TUnit[] {
  const units: TUnit[] = [];
  const bySentence: SyntaxToken[][] = [];
  for (const token of tokens) {
    if (!bySentence[token.sentence]) bySentence[token.sentence] = [];
    bySentence[token.sentence].push(token);
  }

  bySentence.forEach((words, sentence) => {
    if (words.length === 0) return;
    const starts: number[] = [0];
    for (let i = 1; i < words.length; i += 1) {
      if (startsTUnit(words, i)) starts.push(i);
    }
    starts.push(words.length);

    for (let k = 0; k < starts.length - 1; k += 1) {
      const from = words[starts[k]];
      const to = words[starts[k + 1] - 1];
      units.push({
        start: from.start,
        end: to.end,
        sentence,
        wordStart: from.index,
        wordEnd: to.index + 1,
      });
    }
  });

  return units;
}

/* ------------------------------------------------------------------ */
/* Subordinate clauses                                                 */
/* ------------------------------------------------------------------ */

export interface SubordinateClause extends TextRange {
  /** The word that introduced the clause, lowercased. */
  connector: string;
  /** Global token index of the connector. */
  connectorIndex: number;
}

/** Golub's decision aid (ED091741) plus the common additions it leaves implicit. */
export const SUBORDINATORS = new Set(
  `after although as because before how if inasmuch lest once provided since so than that though
till unless until when whenever where whereas wherever whether while whilst`
    .split(/\s+/)
    .filter(Boolean),
);

export const RELATIVE_PRONOUNS = new Set(
  `who whom whose which whoever whomever whosever whichever`.split(/\s+/),
);

/** Second words of a multiword subordinator that was already counted. */
const MULTIWORD_TAILS = new Set(['that', 'as']);

/**
 * Is the word a subordinator *here*?
 *
 * `that` is the dangerous one: it is a subordinator only when a subject or a
 * verb follows (`the book that I read`, `the idea that matters`) and a
 * determiner otherwise. The conjunction list is checked with a short verb
 * lookahead, which rejects the prepositional and adverbial uses (`after the
 * storm`, `as a result`, `because of the rain`).
 */
function isSubordinator(words: SyntaxToken[], i: number, endsQuestion: boolean): boolean {
  const token = words[i];
  const lower = token.lower;
  const prev = words[i - 1];

  if (RELATIVE_PRONOUNS.has(lower)) {
    return !(i === 0 && endsQuestion);
  }

  if (lower === 'that') {
    if (prev && (SUBORDINATORS.has(prev.lower) || MULTIWORD_TAILS.has(prev.lower) || prev.lower === 'order')) {
      return false;
    }
    const next = words[i + 1];
    if (!next) return false;
    return isSubjectLike(next) || looksLikeVerb(next);
  }

  if (!SUBORDINATORS.has(lower)) return false;
  // `so` alone is a degree adverb (`so many drafts`); the aid's subordinator is
  // the multiword `so that`.
  if (lower === 'so') return words[i + 1]?.lower === 'that';
  if (MULTIWORD_TAILS.has(lower) && prev && ['so', 'in', 'order', 'provided', 'now', 'given'].includes(prev.lower)) {
    return false;
  }
  for (let j = i + 1; j <= i + 6 && j < words.length; j += 1) {
    if (words[j].before.includes(',')) return false;
    if (looksLikeVerb(words[j])) return true;
  }
  return false;
}

/**
 * Subordinate-clause spans inside the T-units.
 *
 * A clause runs from its connector to the next comma, semicolon or T-unit end.
 * That is right for the common cases (initial clause ending at a comma, final
 * clause ending at the unit) and deliberately over-captures a relative clause
 * that has no punctuation after it — the caller merges overlapping spans before
 * counting words, so the arithmetic stays consistent even when the boundaries
 * are approximate.
 */
export function findSubordinateClauses(
  text: string,
  tokens: SyntaxToken[],
  units: TUnit[],
): SubordinateClause[] {
  const clauses: SubordinateClause[] = [];
  const sentences = splitSentences(text);
  for (const unit of units) {
    const words = tokens.slice(unit.wordStart, unit.wordEnd);
    const sentence = sentences[unit.sentence];
    const sentenceText = sentence ? text.slice(sentence.start, sentence.end) : text;
    const endsQuestion = /\?\s*['"”’)\]]*\s*$/.test(sentenceText);
    for (let i = 0; i < words.length; i += 1) {
      if (!isSubordinator(words, i, endsQuestion)) continue;

      let end = words[words.length - 1].end;
      for (let j = i + 1; j < words.length; j += 1) {
        if (/[;,]/.test(words[j].before)) {
          end = words[j - 1].end;
          break;
        }
      }
      clauses.push({
        start: words[i].start,
        end,
        connector: words[i].lower,
        connectorIndex: words[i].index,
      });
    }
  }
  return clauses;
}

/** Union of overlapping ranges — used before counting words in clause spans. */
export function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TextRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

/** Number of tokens whose start offset falls inside one of the (merged) ranges. */
export function countTokensInRanges(tokens: SyntaxToken[], ranges: TextRange[]): number {
  let count = 0;
  let range = 0;
  for (const token of tokens) {
    while (range < ranges.length && token.start >= ranges[range].end) range += 1;
    if (range < ranges.length && token.start >= ranges[range].start) count += 1;
  }
  return count;
}
