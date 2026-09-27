/**
 * Document-level metrics.
 *
 * These are the "always on" numbers shown in the topbar: corpus counts plus the
 * standard per-word / per-sentence ratios that readability formulas are built
 * from. They are deliberately computed here rather than inside a tool, so the
 * topbar never depends on which extensions are enabled.
 *
 * Everything is a pure function of the text and cheap enough to run on every
 * keystroke alongside the analysis pipeline.
 */
import { DALE_CHALL_WORDS } from './data/dale-chall';
import { CLEAR_CORPUS, type MetricNorm } from './data/corpus-norms';
import { countSyllables, splitParagraphs, splitSentences, tokenizeWords } from './text';

/** Words with at least this many syllables are "polysyllabic". */
export const POLYSYLLABLE_THRESHOLD = 3;

/** Used for the reading-time estimate. */
export const WORDS_PER_MINUTE = 200;

/**
 * Below this word count the ratios are too noisy to compare against corpus
 * norms. The norms generator skips excerpts this short, so the two stay
 * consistent.
 */
export const MIN_COMPARABLE_WORDS = 20;

/**
 * How many standard deviations a value sits from the CLEAR corpus mean.
 * Returns `null` when the comparison is meaningless (no spread in the norm).
 *
 * All five normative metrics point the same way — higher means harder to read —
 * so a positive z is always "more difficult than the average excerpt".
 */
export function zScore(value: number, norm: MetricNorm): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(norm.mean) || !(norm.sd > 0)) return null;
  return (value - norm.mean) / norm.sd;
}

/** Format a z-score for display: `+1.4σ`, `−0.7σ`, `±0σ`. */
export function formatSigma(z: number): string {
  const magnitude = Math.abs(z).toFixed(1);
  if (magnitude === '0.0') return '\u00B10\u03C3';
  return (z > 0 ? '+' : '\u2212') + magnitude + '\u03C3';
}

/** Corpus context line for a metric tooltip, e.g. `21.3 ± 9.2 (n=4,724)`. */
export function describeNorm(norm: MetricNorm, percent = false): string {
  const format = (value: number) =>
    percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
  return `${format(norm.mean)} \u00B1 ${format(norm.sd)} (n=${CLEAR_CORPUS.n.toLocaleString('en-US')})`;
}

export interface DocumentMetrics {
  /* Counts (integers) */
  words: number;
  sentences: number;
  paragraphs: number;
  /** Every character in the document, whitespace included. */
  characters: number;
  /** Letters and digits only — the numerator of "characters per word". */
  letters: number;
  /** Estimated with the vowel-group heuristic in `core/text.ts`. */
  syllables: number;
  polysyllables: number;
  /** Words that are not on the Dale–Chall list, or a variant of one. */
  unfamiliarWords: number;
  readingMinutes: number;

  /* Ratios (unrounded) */
  wordsPerSentence: number;
  charactersPerWord: number;
  syllablesPerWord: number;
  /** 0–1. */
  polysyllabicShare: number;
  /** 0–1. */
  unfamiliarShare: number;
}

/**
 * Is the word one a fourth-grader would recognise?
 *
 * Dale & Chall count a word as familiar when it is on their list **or** is a
 * simple variant of a listed word: plural, possessive, past tense, present
 * participle, comparative/superlative, or adverb. This is expressed as
 * candidate stem generation — for every suffix that could have been added, the
 * resulting stem is looked up.
 */
export function isFamiliarWord(rawWord: string): boolean {
  const word = rawWord.toLowerCase();
  if (!word) return true;
  if (DALE_CHALL_WORDS.has(word)) return true;

  // Hyphenated compounds are familiar when every part is ("afternoon-tea").
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every((part) => isFamiliarWord(part))) return true;
  }

  const stems: string[] = [];
  const push = (stem: string) => {
    if (stem.length >= 2 && stem !== word) stems.push(stem);
  };
  const strip = (suffix: string, replacement = '') => {
    if (word.endsWith(suffix) && word.length > suffix.length + 1) {
      push(word.slice(0, -suffix.length) + replacement);
    }
  };

  // Possessive: "writer's" → "writer".
  strip("'s");
  strip('\u2019s');
  // Plurals and third person singular.
  strip('ies', 'y');
  strip('es');
  strip('s');
  // Past tense and participles.
  strip('ied', 'y');
  strip('ed', 'e');
  strip('ed');
  // Present participle.
  strip('ing', 'e');
  strip('ing');
  // Comparative / superlative.
  strip('ier', 'y');
  strip('iest', 'y');
  strip('er');
  strip('est');
  // Adverb.
  strip('ly');

  // Doubled final consonant: "stopped" → "stop", "running" → "run".
  const doubled = /^(.*?)([bcdfghjklmnpqrstvwxz])\2(?:ed|ing|er|est)$/.exec(word);
  if (doubled) push(doubled[1] + doubled[2]);

  return stems.some((stem) => DALE_CHALL_WORDS.has(stem));
}

export function computeMetrics(text: string): DocumentMetrics {
  const tokens = tokenizeWords(text);
  const words = tokens.length;

  let letters = 0;
  let syllables = 0;
  let polysyllables = 0;
  let unfamiliarWords = 0;

  for (const token of tokens) {
    letters += token.text.replace(/[^\p{L}\p{N}]/gu, '').length;

    const syllableCount = countSyllables(token.lower);
    syllables += syllableCount;
    if (syllableCount >= POLYSYLLABLE_THRESHOLD) polysyllables += 1;

    if (!isFamiliarWord(token.lower)) unfamiliarWords += 1;
  }

  const sentences = splitSentences(text).length;
  const paragraphs = splitParagraphs(text).length;

  return {
    words,
    sentences,
    paragraphs,
    characters: text.length,
    letters,
    syllables,
    polysyllables,
    unfamiliarWords,
    readingMinutes: Math.round(words / WORDS_PER_MINUTE),

    wordsPerSentence: sentences > 0 ? words / sentences : 0,
    charactersPerWord: words > 0 ? letters / words : 0,
    syllablesPerWord: words > 0 ? syllables / words : 0,
    polysyllabicShare: words > 0 ? polysyllables / words : 0,
    unfamiliarShare: words > 0 ? unfamiliarWords / words : 0,
  };
}
