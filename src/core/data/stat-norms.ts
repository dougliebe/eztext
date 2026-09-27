/**
 * Reference norms for the stats pane, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with `npm run stats:norms`.
 *
 *   4724 excerpts, each statistic produced by running the tool itself with its
 *   default options (`readabilityTool`, `gsdsTool`), so the norms cannot drift
 *   from the implementation. Mean and sample standard deviation (n − 1).
 *
 * Source: CLEAR — CommonLit Ease of Readability corpus
 *   https://github.com/scrosseye/CLEAR-Corpus
 *   Crossley, Heintz, Choi, Batchelor, Karimi & Malatinszky (2021, 2022)
 *   Licensed CC BY-NC-SA 4.0 — non-commercial use with attribution. The corpus
 *   text itself is NOT redistributed here; only these aggregate statistics.
 *
 * Only rates and scores are recorded. Raw counts (long sentences, unfamiliar
 * words, flagged items, weighted totals, clause counts) are deliberately absent:
 * CLEAR excerpts are a fixed ~174 words, so a count comparison would measure
 * length, not the writing. `read.complex.share` is stored as a 0–1 fraction.
 *
 * These are skewed distributions, so the app's normal-CDF percentile locates a
 * value rather than giving its exact rank; the generator prints the worst error
 * per metric on every run (currently 9.4 pp, gsds.subtu).
 */

import type { MetricNorm } from './corpus-norms';

export interface StatNorms {
  name: string;
  source: string;
  license: string;
  /** Excerpts that contributed, after dropping anything under 20 words. */
  n: number;
  /** Keyed by tool stat id, the same ids the stats pane renders. */
  metrics: Record<string, MetricNorm>;
}

export const CLEAR_STAT_NORMS: StatNorms = {
  name: 'CLEAR corpus',
  source: 'https://github.com/scrosseye/CLEAR-Corpus',
  license: 'CC BY-NC-SA 4.0',
  n: 4724,
  metrics: {
    'read.flesch': { mean: 65.5473, sd: 17.8196 }, // Flesch Reading Ease
    'read.fk': { mean: 9.4033, sd: 4.3162 }, // Flesch–Kincaid grade
    'read.fog': { mean: 12.3463, sd: 4.672 }, // Gunning Fog
    'read.syllables': { mean: 1.4148, sd: 0.1649 }, // Syllables / word
    'read.complex.share': { mean: 0.0958, sd: 0.06 }, // Complex words
    'read.words.sentence': { mean: 21.2855, sd: 9.2343 }, // Words / sentence
    'gsds.score': { mean: 4.7365, sd: 2.3993 }, // Syntactic Density Score
    'gsds.wtu': { mean: 15.9114, sd: 5.1234 }, // Words / T-unit
    'gsds.subtu': { mean: 0.5461, sd: 0.3402 }, // Sub clauses / T-unit
    'gsds.main': { mean: 11.7773, sd: 3.6775 }, // Main clause length
    'gsds.sublen': { mean: 7.4496, sd: 2.4236 }, // Sub clause length
  },
};
