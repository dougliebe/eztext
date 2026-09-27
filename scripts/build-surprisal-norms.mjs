/**
 * Surprisal norms for the CLEAR corpus.
 *
 *   npm run model:norms               # every excerpt (~30 min), resumable
 *   npm run model:norms -- --limit 50 # a quick sample, to sanity-check
 *
 * Scores each CLEAR excerpt with the same model the app uses and stores the mean
 * and standard deviation of three figures — bits per token, bits per word and
 * perplexity — so the surprisal tool can report where a document sits against
 * real published prose, the way the topbar metrics do.
 *
 * Per-excerpt results are appended to `.corpus/surprisal-norms.jsonl` as they are
 * produced, so an interrupted run resumes instead of starting over, and the
 * committed output is only ever written from a complete set.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CORPUS_DIR, ROOT, readCorpus } from './lib/clear-corpus.mjs';
import { createScorer, DEFAULT_MODEL, DEFAULT_MODEL_FILE } from './lib/model.mjs';

const OUT = resolve(ROOT, 'src/core/data/surprisal-norms.ts');
const CACHE = resolve(CORPUS_DIR, 'surprisal-norms.jsonl');

/** Excerpts shorter than this are skipped: too little context to mean anything. */
const MIN_WORDS = 20;

/** Only bits are needed for norms, so skip the top-k work entirely. */
const TOP_K = 1;

const round = (value, digits = 4) => Number(value.toFixed(digits));

function summarise(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance) };
}

/** Empirical quantiles, used only to report how far the normal CDF drifts. */
function quantiles(values, resolution = 101) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < resolution; i += 1) {
    const at = (i / (resolution - 1)) * (sorted.length - 1);
    const low = Math.floor(at);
    const high = Math.ceil(at);
    out.push(sorted[low] + (sorted[high] - sorted[low]) * (at - low));
  }
  return out;
}

/** Abramowitz & Stegun 7.1.26, matching `percentileFromZ` in the app. */
function normalPercentile(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989423 * Math.exp((-z * z) / 2);
  const tail =
    density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return (z > 0 ? 1 - tail : tail) * 100;
}

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const limit = Number(flag('limit'));
const fresh = process.argv.includes('--fresh');

async function main() {
  const corpus = await readCorpus();
  console.log(`CLEAR: ${corpus.excerpts.length} excerpts`);

  // Which excerpts are worth scoring (word count uses the app's own tokenizer).
  const bundle = resolve(CORPUS_DIR, 'metrics.bundle.cjs');
  await build({
    entryPoints: [resolve(ROOT, 'src/core/metrics.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'warning',
  });
  const { computeMetrics } = await import(pathToFileURL(bundle).href);
  rmSync(bundle, { force: true });

  const work = [];
  corpus.excerpts.forEach((text, index) => {
    const trimmed = (text ?? '').trim();
    if (computeMetrics(trimmed).words < MIN_WORDS) return;
    work.push({ index, text: trimmed });
  });
  console.log(`${work.length} excerpts with at least ${MIN_WORDS} words`);

  if (fresh && existsSync(CACHE)) rmSync(CACHE, { force: true });
  mkdirSync(CORPUS_DIR, { recursive: true });

  // Resume: anything already scored is left alone.
  const done = new Map();
  if (existsSync(CACHE)) {
    for (const line of readFileSync(CACHE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.model === DEFAULT_MODEL) done.set(row.index, row);
      } catch {
        // a torn final line from an interrupted write; it will simply be redone
      }
    }
  }
  if (done.size > 0) console.log(`resuming: ${done.size} already scored`);

  const remaining = work.filter((item) => !done.has(item.index));
  const queue = typeof limit === 'number' && Number.isFinite(limit) ? remaining.slice(0, limit) : remaining;

  let scorer = null;
  if (queue.length > 0) {
    scorer = await createScorer();
    console.log(
      `model ready: ${scorer.modelId} (${scorer.modelFile}) in ${(scorer.loadMs / 1000).toFixed(1)}s` +
        ` — ${queue.length} to score, estimate ${((queue.length * 0.55) / 60).toFixed(1)} min`,
    );
  }

  const started = performance.now();
  for (let at = 0; at < queue.length; at += 1) {
    const item = queue[at];
    const scores = await scorer.score(item.text, TOP_K);
    const row = {
      index: item.index,
      model: scorer.modelId,
      tokens: scores.tokens.length,
      words: scores.words.length,
      bitsPerToken: scores.meanBits,
      bitsPerWord: scores.meanWordBits,
      perplexity: 2 ** scores.meanBits,
    };
    appendFileSync(CACHE, `${JSON.stringify(row)}\n`);
    done.set(row.index, row);

    if (at % 25 === 0 || at === queue.length - 1) {
      const elapsed = (performance.now() - started) / 1000;
      const rate = elapsed / (at + 1);
      const left = (queue.length - at - 1) * rate;
      console.log(
        `  ${String(done.size).padStart(4)}/${work.length}  ${rate.toFixed(2)}s/excerpt  ` +
          `eta ${(left / 60).toFixed(1)} min  (last: ${row.bitsPerToken.toFixed(2)} bits/token, ` +
          `${row.tokens} tokens)`,
      );
    }
  }

  const rows = [...done.values()];
  if (rows.length < work.length) {
    console.log(`\nonly ${rows.length} of ${work.length} scored; re-run to finish before generating.`);
    if (typeof limit === 'number') {
      console.log('(a --limit run is a sample: generating the file from it would be misleading)');
    }
    process.exitCode = 1;
    return;
  }

  const bitsPerToken = summarise(rows.map((row) => row.bitsPerToken));
  const bitsPerWord = summarise(rows.map((row) => row.bitsPerWord));
  const perplexity = summarise(rows.map((row) => row.perplexity));

  console.log(`\n  ${rows.length} excerpts scored with ${DEFAULT_MODEL}\n`);
  console.log(`  ${'metric'.padEnd(18)} ${'mean'.padStart(9)} ${'sd'.padStart(9)}  p10      p50      p90`);
  for (const [name, values, stats] of [
    ['bits / token', rows.map((row) => row.bitsPerToken), bitsPerToken],
    ['bits / word', rows.map((row) => row.bitsPerWord), bitsPerWord],
    ['perplexity', rows.map((row) => row.perplexity), perplexity],
  ]) {
    const q = quantiles(values);
    console.log(
      `  ${name.padEnd(18)} ${stats.mean.toFixed(4).padStart(9)} ${stats.sd.toFixed(4).padStart(9)}  ` +
        `${q[10].toFixed(2).padStart(7)}  ${q[50].toFixed(2).padStart(7)}  ${q[90].toFixed(2).padStart(7)}`,
    );
  }

  // The app turns a z-score into a percentile with the normal CDF; these
  // distributions are skewed, so measure the damage the same way the metric
  // norms do.
  console.log(`\n  accuracy of the normal-CDF percentile:`);
  const accuracy = new Map();
  for (const [name, values, stats] of [
    ['bitsPerToken', rows.map((row) => row.bitsPerToken), bitsPerToken],
    ['bitsPerWord', rows.map((row) => row.bitsPerWord), bitsPerWord],
    ['perplexity', rows.map((row) => row.perplexity), perplexity],
  ]) {
    const q = quantiles(values);
    let worst = { error: 0, empirical: 0, claimed: 0 };
    for (let p = 1; p <= 99; p += 1) {
      const z = (q[p] - stats.mean) / stats.sd;
      const claimed = normalPercentile(z);
      if (Math.abs(claimed - p) > worst.error) worst = { error: Math.abs(claimed - p), empirical: p, claimed };
    }
    accuracy.set(name, worst);
    console.log(
      `  ${name.padEnd(18)} ${worst.error.toFixed(1).padStart(8)} pp  true p${worst.empirical} claimed p${worst.claimed.toFixed(0)}`,
    );
  }

  const file = `/**
 * Surprisal norms, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with \`npm run model:norms\`.
 *
 *   ${rows.length} excerpts scored with ${DEFAULT_MODEL}
 *   (${DEFAULT_MODEL_FILE}), using the app's own \`core/surprisal.ts\` through the
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
 * ${Math.max(...[...accuracy.values()].map((worst) => worst.error)).toFixed(1)} percentile points.
 */

export interface SurprisalNorm {
  mean: number;
  sd: number;
}

export interface SurprisalNorms {
  model: string;
  modelFile: string;
  /** Excerpts that contributed, after dropping anything under ${MIN_WORDS} words. */
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
  model: ${JSON.stringify(DEFAULT_MODEL)},
  modelFile: ${JSON.stringify(DEFAULT_MODEL_FILE)},
  n: ${rows.length},
  tokensPerExcerpt: { mean: ${round(summarise(rows.map((row) => row.tokens)).mean, 1)}, sd: ${round(summarise(rows.map((row) => row.tokens)).sd, 1)} },
  metrics: {
    bitsPerToken: { mean: ${round(bitsPerToken.mean, 4)}, sd: ${round(bitsPerToken.sd, 4)} },
    bitsPerWord: { mean: ${round(bitsPerWord.mean, 4)}, sd: ${round(bitsPerWord.sd, 4)} },
    perplexity: { mean: ${round(perplexity.mean, 4)}, sd: ${round(perplexity.sd, 4)} },
  },
};
`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, file);
  console.log(`\nwrote ${OUT.replace(ROOT, '.')} (${file.length} bytes)`);
}

await main();
