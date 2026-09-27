/**
 * Text utilities shared by tools.
 *
 * Everything here is intentionally heuristic and dependency-free: it is fast
 * enough to run on every keystroke for documents in the tens of kilobytes, and
 * it never touches the DOM.
 */
import type { TextRange } from './types';

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export interface WordToken extends TextRange {
  text: string;
  lower: string;
}

/** Letters/numbers, allowing internal apostrophes and hyphens (`don't`, `well-known`). */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’ʼ\u2011-][\p{L}\p{N}]+)*/gu;

export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    out.push({
      start,
      end: start + match[0].length,
      text: match[0],
      lower: match[0].toLowerCase(),
    });
  }
  return out;
}

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below
   between both but by can cannot could did do does doing down during each few for from further had
   has have having he her here hers herself him himself his how i if in into is it its itself just
   me more most my myself no nor not now of off on once only or other our ours ourselves out over own
   same she should so some such than that the their theirs them themselves then there these they this
   those through to too under until up very was we were what when where which while who whom why will
   with would you your yours yourself yourselves`
    .split(/\s+/)
    .filter(Boolean),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase());
}

/** Rough syllable count using the classic vowel-group heuristic. */
export function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return 0;
  if (cleaned.length <= 3) return 1;
  const trimmed = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/* ------------------------------------------------------------------ */
/* Paragraphs & sentences                                              */
/* ------------------------------------------------------------------ */

/** Whitespace-delimited blocks: one or more consecutive non-blank lines. */
export function splitParagraphs(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let lineStart = 0;
  let blockStart = -1;
  let blockEnd = -1;

  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const isBlank = text.slice(lineStart, lineEnd).trim().length === 0;

    if (isBlank) {
      if (blockStart !== -1) {
        ranges.push({ start: blockStart, end: blockEnd });
        blockStart = -1;
      }
    } else {
      if (blockStart === -1) blockStart = lineStart;
      blockEnd = lineEnd;
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }

  if (blockStart !== -1) ranges.push({ start: blockStart, end: blockEnd });
  return ranges;
}

/**
 * Abbreviations that should not terminate a sentence. Lowercased, and the
 * trailing period is part of the key (e.g. `e.g.`).
 */
const ABBREVIATIONS = new Set(
  `mr. mrs. ms. dr. prof. sr. jr. st. vs. etc. e.g. i.e. fig. no. inc. ltd. co. corp. gov. sen.
   rep. gen. col. capt. lt. sgt. rev. approx. dept. est. min. max. al. jan. feb. mar. apr. jun.
   jul. aug. sep. sept. oct. nov. dec. mon. tue. tues. wed. thu. thur. thurs. fri. sat. sun.`
    .split(/\s+/)
    .filter(Boolean),
);

const TERMINATORS = '.!?…';
const CLOSERS = `"'”’)]}`;

function isRealTerminator(text: string, index: number, rangeEnd: number): boolean {
  const char = text[index];
  // `?` and `!` always end a sentence.
  if (char !== '.') return true;

  const prev = index > 0 ? text[index - 1] : '';
  const next = index + 1 < text.length ? text[index + 1] : '';
  // Decimal numbers: 3.14
  if (/\d/.test(prev) && /\d/.test(next)) return false;

  const before = text.slice(Math.max(0, index - 12), index);
  const wordMatch = before.match(/([A-Za-z.]+)$/);
  const word = wordMatch ? wordMatch[1].toLowerCase() : '';
  if (word && ABBREVIATIONS.has(word)) return false;
  // Single initials: "J. K. Rowling"
  if (/^[A-Za-z]$/.test(word)) return false;

  // A lowercase word after the period suggests an abbreviation we don't know about.
  let lookahead = index + 1;
  while (lookahead < rangeEnd && /[\s"'”’)\]]/.test(text[lookahead])) lookahead += 1;
  const after = lookahead < rangeEnd ? text[lookahead] : '';
  if (after && /[a-z]/.test(after)) return false;

  return true;
}

/** Sentence ranges for a single paragraph. */
function splitSentencesInRange(text: string, range: TextRange): TextRange[] {
  const out: TextRange[] = [];
  let cursor = range.start;

  while (cursor < range.end) {
    while (cursor < range.end && /\s/.test(text[cursor])) cursor += 1;
    if (cursor >= range.end) break;

    const start = cursor;
    let end = range.end;
    let index = cursor;

    while (index < range.end) {
      if (!TERMINATORS.includes(text[index])) {
        index += 1;
        continue;
      }

      let after = index + 1;
      while (after < range.end && TERMINATORS.includes(text[after])) after += 1;
      while (after < range.end && CLOSERS.includes(text[after])) after += 1;

      if (isRealTerminator(text, index, range.end)) {
        end = after;
        break;
      }
      index = after;
    }

    out.push({ start, end });
    cursor = end;
  }

  return out;
}

/** Sentence ranges for the whole document, never crossing paragraph breaks. */
export function splitSentences(text: string): TextRange[] {
  const out: TextRange[] = [];
  for (const paragraph of splitParagraphs(text)) {
    out.push(...splitSentencesInRange(text, paragraph));
  }
  return out;
}

/** True when the token opens with a capital letter. */
function isCapitalised(text: string): boolean {
  const first = text.charAt(0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/**
 * Token start offsets that look like proper nouns: capitalised, and not the
 * first word of a sentence.
 *
 * A heuristic, not named-entity recognition — it cannot tell that a name opens
 * a sentence (English capitalises there anyway), so sentence-initial names still
 * count. The Common words tool's “Ignore names” option, `% unfamiliar` and its
 * heatmap all read the same set, so none of them can disagree about which
 * tokens were skipped.
 */
export function properNounStarts(text: string, tokens: WordToken[]): Set<number> {
  const sentences = splitSentences(text);
  const out = new Set<number>();
  let sentence = 0;
  let seenInSentence = false;

  for (const token of tokens) {
    while (sentence < sentences.length && token.start >= sentences[sentence].end) {
      sentence += 1;
      seenInSentence = false;
    }
    if (!seenInSentence) {
      seenInSentence = true;
      continue;
    }
    if (isCapitalised(token.text)) out.add(token.start);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

/** Shrink a range so it excludes leading/trailing whitespace. */
export function trimRange(text: string, range: TextRange): TextRange {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
}

export function lineCount(text: string): number {
  if (!text) return 1;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') count += 1;
  return count;
}

export function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

/** Average of a list, or `null` when empty. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** `1430` → `"1.4k"`, for compact counters. */
export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${Math.max(1, Math.round(ms * 1000))} µs`;
  if (ms < 1000) return `${round(ms, 1)} ms`;
  return `${round(ms / 1000, 2)} s`;
}
