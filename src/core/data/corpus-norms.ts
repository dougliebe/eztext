/**
 * Reference norms for the topbar metrics, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with `npm run corpus:norms`.
 *
 *   4724 excerpts, each metric computed with the app's own
 *   `core/metrics.ts` implementation, so these never drift from the code.
 *   Mean and sample standard deviation (n − 1); the app compares a document
 *   against these as a z-score.
 *
 * Source: CLEAR — CommonLit Ease of Readability corpus
 *   https://github.com/scrosseye/CLEAR-Corpus
 *   Crossley, Heintz, Choi, Batchelor, Karimi & Malatinszky (2021, 2022)
 *   Licensed CC BY-NC-SA 4.0 — non-commercial use with attribution. The
 *   corpus text itself is NOT redistributed here; only these aggregate
 *   statistics. Rebuilding requires downloading the corpus yourself.
 *
 * Each metric records the mean and the sample standard deviation. The app shows
 * a z-score and converts it to a percentile with the normal CDF, which assumes
 * normality — and these distributions are skewed (words per sentence spans
 * 3.9…101.5), so the generator measures and prints how far that approximation
 * drifts from the corpus's true percentiles on every run.
 *
 * Only length-normalised ratios are recorded: corpus excerpts are a roughly
 * fixed length, so comparing raw counts (words, characters) against them would
 * be meaningless.
 */

export interface MetricNorm {
  mean: number;
  sd: number;
}

export interface CorpusNorms {
  name: string;
  source: string;
  license: string;
  /** Excerpts that contributed, after dropping anything under 20 words. */
  n: number;
  /** Context for tooltips — the corpus is made of short excerpts. */
  wordsPerExcerpt: MetricNorm;
  metrics: {
    wordsPerSentence: MetricNorm;
    charactersPerWord: MetricNorm;
    polysyllabicShare: MetricNorm;
    unfamiliarShare: MetricNorm;
    syllablesPerWord: MetricNorm;
  };
}

export const CLEAR_CORPUS: CorpusNorms = {
  name: 'CLEAR corpus',
  source: 'https://github.com/scrosseye/CLEAR-Corpus',
  license: 'CC BY-NC-SA 4.0',
  n: 4724,
  wordsPerExcerpt: { mean: 173.8, sd: 17.1 },
  metrics: {
    wordsPerSentence: { mean: 21.2829, sd: 9.233 },
    charactersPerWord: { mean: 4.4419, sd: 0.4345 },
    polysyllabicShare: { mean: 0.0958, sd: 0.06 },
    unfamiliarShare: { mean: 0.023, sd: 0.019 },
    syllablesPerWord: { mean: 1.4147, sd: 0.1649 },
  },
};
