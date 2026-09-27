/**
 * Preview heatmaps.
 *
 * Clicking a metric in the topbar shades the document by how much each word or
 * sentence contributes to that metric. This is a *view mode*, not a tool: it
 * produces a flat, non-overlapping run of styled spans over the text, which is
 * far simpler than the annotation/segment pipeline (nothing overlaps here) and
 * keeps the topbar independent of the tool registry.
 *
 * Intensity is always **relative to the document being viewed** — the user
 * asked to see which sentences are longer *than the others here*, not which are
 * unusual for English. Corpus norms stay on the topbar's σ readouts.
 */
import { isFamiliarWord, POLYSYLLABLE_THRESHOLD } from './metrics';
import { countSyllables, splitSentences, tokenizeWords } from './text';

export type HeatMetricId =
  | 'wordsPerSentence'
  | 'charactersPerWord'
  | 'polysyllabicShare'
  | 'unfamiliarShare'
  | 'syllablesPerWord';

export interface HeatMetricInfo {
  id: HeatMetricId;
  /** Topbar label, reused by the legend. */
  label: string;
  /** What a single shaded span represents. */
  unit: 'sentence' | 'word';
  /** One line explaining how to read the shading. */
  legend: string;
  /** True when matches share one colour instead of a ramp. */
  binary: boolean;
}

export const HEAT_METRICS: Record<HeatMetricId, HeatMetricInfo> = {
  wordsPerSentence: {
    id: 'wordsPerSentence',
    label: 'Words / sentence',
    unit: 'sentence',
    legend: 'Shades whole sentences — hotter means more words.',
    binary: false,
  },
  charactersPerWord: {
    id: 'charactersPerWord',
    label: 'Chars / word',
    unit: 'word',
    legend: 'Shades every word — hotter means more letters.',
    binary: false,
  },
  polysyllabicShare: {
    id: 'polysyllabicShare',
    label: '% polysyllabic',
    unit: 'word',
    legend: `Shades only words of ${POLYSYLLABLE_THRESHOLD}+ syllables — hotter means more syllables.`,
    binary: false,
  },
  unfamiliarShare: {
    id: 'unfamiliarShare',
    label: '% unfamiliar',
    unit: 'word',
    legend: 'Shades only words outside the Dale–Chall list of familiar words.',
    binary: true,
  },
  syllablesPerWord: {
    id: 'syllablesPerWord',
    label: 'Syllables / word',
    unit: 'word',
    legend: 'Shades every word — hotter means more syllables.',
    binary: false,
  },
};

/** One shaded run of text. Spans never overlap and arrive in document order. */
export interface HeatSpan {
  start: number;
  end: number;
  text: string;
  /** The raw measurement driving the shade. */
  value: number;
  /** 0–1, already floor-adjusted so the weakest shade is still visible. */
  intensity: number;
  /** Short value shown in the tooltip, e.g. `4 syllables`. */
  label: string;
  /** Sentence or word — determines the shade strength. */
  unit: 'sentence' | 'word';
  /** Longer explanation for the tooltip. */
  detail: string;
}

/** Shading is relative to the document; keep the weakest shade visible. */
const MIN_INTENSITY = 0.15;

function relabel(value: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return (value - min) / (max - min);
}

function shade(value: number, min: number, max: number): number {
  return MIN_INTENSITY + (1 - MIN_INTENSITY) * relabel(value, min, max);
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Count of letters and digits — matches the `Chars / word` metric. */
function letters(token: string): number {
  return token.replace(/[^\p{L}\p{N}]/gu, '').length;
}

export function buildHeatmap(text: string, metric: HeatMetricId): HeatSpan[] {
  if (text.length === 0) return [];

  if (metric === 'wordsPerSentence') {
    const measured = splitSentences(text)
      .map((range, index) => ({
        range,
        index,
        words: tokenizeWords(text.slice(range.start, range.end)).length,
      }))
      .filter((entry) => entry.words > 0);

    if (measured.length === 0) return [];
    const counts = measured.map((entry) => entry.words);
    const min = Math.min(...counts);
    const max = Math.max(...counts);

    return measured.map((entry) => ({
      start: entry.range.start,
      end: entry.range.end,
      text: text.slice(entry.range.start, entry.range.end),
      value: entry.words,
      intensity: shade(entry.words, min, max),
      label: plural(entry.words, 'word'),
      unit: 'sentence' as const,
      detail: `Sentence ${entry.index + 1}: ${plural(entry.words, 'word')}. Longest here is ${max}, shortest ${min}.`,
    }));
  }

  const tokens = tokenizeWords(text).map((token) => ({
    start: token.start,
    end: token.end,
    text: token.text,
    lower: token.lower,
    syllables: countSyllables(token.lower),
  }));

  if (tokens.length === 0) return [];

  const span = (
    token: (typeof tokens)[number],
    value: number,
    intensity: number,
    label: string,
    detail: string,
  ): HeatSpan => ({
    start: token.start,
    end: token.end,
    text: token.text,
    value,
    intensity,
    label,
    unit: 'word',
    detail,
  });

  if (metric === 'charactersPerWord') {
    const lengths = tokens.map((token) => letters(token.text));
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    return tokens.map((token, index) =>
      span(
        token,
        lengths[index],
        shade(lengths[index], min, max),
        plural(lengths[index], 'letter'),
        `“${token.text}” has ${plural(lengths[index], 'letter')} (longest here ${max}, shortest ${min}).`,
      ),
    );
  }

  if (metric === 'unfamiliarShare') {
    return tokens
      .filter((token) => !isFamiliarWord(token.lower))
      .map((token) =>
        span(token, 1, 1, 'unfamiliar', `“${token.text}” is not on the Dale–Chall list of familiar words.`),
      );
  }

  if (metric === 'polysyllabicShare') {
    const long = tokens.filter((token) => token.syllables >= POLYSYLLABLE_THRESHOLD);
    if (long.length === 0) return [];
    const max = Math.max(...long.map((token) => token.syllables));
    // 3 syllables is the floor, so scale from the threshold to the longest word.
    const ceiling = Math.max(max, POLYSYLLABLE_THRESHOLD + 1);
    return long.map((token) =>
      span(
        token,
        token.syllables,
        shade(token.syllables, POLYSYLLABLE_THRESHOLD, ceiling),
        plural(token.syllables, 'syllable'),
        `“${token.text}” carries about ${plural(token.syllables, 'syllable')} — ${POLYSYLLABLE_THRESHOLD}+ counts as polysyllabic.`,
      ),
    );
  }

  // syllablesPerWord — every word, shaded by syllable count.
  const counts = tokens.map((token) => token.syllables);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return tokens.map((token) =>
    span(
      token,
      token.syllables,
      shade(token.syllables, min, max),
      plural(token.syllables, 'syllable'),
      `“${token.text}” carries about ${plural(token.syllables, 'syllable')} (most here ${max}, fewest ${min}).`,
    ),
  );
}
