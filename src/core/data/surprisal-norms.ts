/**
 * Surprisal norms, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with `npm run model:norms`.
 *
 *   4724 excerpts scored with Xenova/gpt2
 *   (decoder_model_merged_quantized), using the app's own `core/surprisal.ts` through the
 *   local model process. Mean and sample standard deviation (n − 1).
 *
 * Source: CLEAR — CommonLit Ease of Readability corpus
 *   https://github.com/scrosseye/CLEAR-Corpus
 *   Licensed CC BY-NC-SA 4.0 — non-commercial use with attribution. Only these
 *   aggregate statistics are stored; no corpus text is redistributed.
 *
 * These are model-dependent: they are only comparable against scores from the
 * same model id, which is why the id is recorded and checked at runtime. They are
 * also skewed (perplexity especially), so the app's normal-CDF percentile is an
 * approximation — the generator prints the worst error, currently
 * 7.0 percentile points.
 */

export interface SurprisalNorm {
  mean: number;
  sd: number;
}

export interface SurprisalNorms {
  model: string;
  modelFile: string;
  /** Excerpts that contributed, after dropping anything under 20 words. */
  n: number;
  /** Mean context per excerpt — these are short passages, not whole books. */
  tokensPerExcerpt: SurprisalNorm;
  metrics: {
    bitsPerToken: SurprisalNorm;
    bitsPerWord: SurprisalNorm;
    perplexity: SurprisalNorm;
  };
}

export const CLEAR_SURPRISAL_NORMS: SurprisalNorms = {
  model: "Xenova/gpt2",
  modelFile: "decoder_model_merged_quantized",
  n: 4724,
  tokensPerExcerpt: { mean: 215.4, sd: 25.3 },
  metrics: {
    bitsPerToken: { mean: 5.1973, sd: 0.6529 },
    bitsPerWord: { mean: 6.4551, sd: 0.9276 },
    perplexity: { mean: 40.543, sd: 18.5139 },
  },
};
