/**
 * Reference norms for the stats pane, derived from the CLEAR corpus.
 *
 *   npm run stats:norms
 *
 * Runs the tools themselves — `readabilityTool` and `gsdsTool`, with default
 * options — over every CLEAR excerpt and stores the mean and sample standard
 * deviation of every statistic that is a **rate or a score**, so a document's
 * values can be located against real published prose the way the topbar metrics
 * already are.
 *
 * Raw counts are deliberately excluded: CLEAR excerpts are a fixed ~174 words,
 * so comparing "long sentences" or "unfamiliar words" as counts would reward
 * length rather than measure the writing. That is the same line the topbar norms
 * draw, and it is why this generator records ratios only.
 *
 * The tools are bundled from `src/tools/`, so the norms come from the same code
 * path the app runs; a formula change cannot leave its norm behind.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CORPUS_DIR, ROOT, readCorpus } from './lib/clear-corpus.mjs';

const OUT = resolve(ROOT, 'src/core/data/stat-norms.ts');

/** Excerpts shorter than this are skipped: too little context to mean anything. */
const MIN_WORDS = 20;

/**
 * The stats worth comparing, by tool and stat id. Each one is a rate or a
 * score; the tooltip label is just the stat's own label.
 */
const METRICS = [
  { tool: 'readability', id: 'read.flesch', label: 'Flesch Reading Ease' },
  { tool: 'readability', id: 'read.fk', label: 'Flesch–Kincaid grade' },
  { tool: 'readability', id: 'read.fog', label: 'Gunning Fog' },
  { tool: 'readability', id: 'read.syllables', label: 'Syllables / word' },
  { tool: 'readability', id: 'read.complex.share', label: 'Complex words' },
  { tool: 'readability', id: 'read.words.sentence', label: 'Words / sentence' },
  { tool: 'gsds', id: 'gsds.score', label: 'Syntactic Density Score' },
  { tool: 'gsds', id: 'gsds.wtu', label: 'Words / T-unit' },
  { tool: 'gsds', id: 'gsds.subtu', label: 'Sub clauses / T-unit' },
  { tool: 'gsds', id: 'gsds.main', label: 'Main clause length' },
  { tool: 'gsds', id: 'gsds.sublen', label: 'Sub clause length' },
];

/** Stored as 0–1 fractions, so tooltips can format them as percentages. */
const FRACTIONS = new Set(['read.complex.share']);

const round = (value, digits = 4) => Number(value.toFixed(digits));

function summarise(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  // Sample standard deviation (n − 1): the corpus is a sample of published prose.
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

/** A stat's value as a number; `%`-formatted strings are parsed. */
function numberOf(stat) {
  if (!stat) return Number.NaN;
  return typeof stat.value === 'number' ? stat.value : Number.parseFloat(String(stat.value));
}

async function main() {
  const corpus = await readCorpus();
  console.log(`CLEAR: ${corpus.excerpts.length} excerpts`);

  // Bundle the tools and the word counter together — one import, one code path.
  const bundle = resolve(CORPUS_DIR, 'stat-norms.bundle.cjs');
  await build({
    stdin: {
      contents: `
        export { computeMetrics } from './src/core/metrics';
        export { readabilityTool } from './src/tools/readability.tool';
        export { gsdsTool } from './src/tools/gsds.tool';
      `,
      resolveDir: ROOT,
      sourcefile: 'stat-norms-entry.ts',
      loader: 'ts',
    },
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'warning',
  });
  const { computeMetrics, readabilityTool, gsdsTool } = await import(pathToFileURL(bundle).href);
  rmSync(bundle, { force: true });

  const byTool = { readability: readabilityTool, gsds: gsdsTool };
  const values = Object.fromEntries(METRICS.map((metric) => [metric.id, []]));
  let skipped = 0;

  const started = performance.now();
  for (const excerpt of corpus.excerpts) {
    const text = (excerpt ?? '').trim();
    if (computeMetrics(text).words < MIN_WORDS) {
      skipped += 1;
      continue;
    }

    const stats = Object.fromEntries(
      Object.entries(byTool).map(([name, tool]) => [name, tool.run({ text, options: {} }).stats ?? []]),
    );

    for (const metric of METRICS) {
      const stat = stats[metric.tool].find((candidate) => candidate.id === metric.id);
      let value = numberOf(stat);
      if (!Number.isFinite(value)) {
        throw new Error(`stat "${metric.id}" produced ${JSON.stringify(stat?.value)} for "${text.slice(0, 60)}…"`);
      }
      if (FRACTIONS.has(metric.id)) value /= 100; // the stat is shown as a percentage
      values[metric.id].push(value);
    }
  }

  const n = values[METRICS[0].id].length;
  console.log(
    `  ${n} excerpts used (${skipped} skipped under ${MIN_WORDS} words) in ` +
      `${((performance.now() - started) / 1000).toFixed(1)}s\n`,
  );

  const summarised = METRICS.map((metric) => {
    const list = values[metric.id];
    return { ...metric, values: list, ...summarise(list), quantiles: quantiles(list) };
  });

  console.log(`  ${'metric'.padEnd(34)} ${'mean'.padStart(9)} ${'sd'.padStart(9)}  p10      p50      p90`);
  for (const metric of summarised) {
    const q = metric.quantiles;
    const scale = FRACTIONS.has(metric.id) ? 100 : 1;
    console.log(
      `  ${metric.id.padEnd(34)} ${(metric.mean * scale).toFixed(3).padStart(9)} ${(metric.sd * scale).toFixed(3).padStart(9)}  ` +
        `${(q[10] * scale).toFixed(2).padStart(7)}  ${(q[50] * scale).toFixed(2).padStart(7)}  ${(q[90] * scale).toFixed(2).padStart(7)}`,
    );
  }

  // The same honesty check the topbar norms run: these distributions are skewed,
  // so measure how far Φ(z) drifts from the corpus's true percentiles.
  console.log(`\n  accuracy of the normal-CDF percentile (app converts z → percentile):`);
  let worstOverall = { id: '', error: 0 };
  for (const metric of summarised) {
    const q = metric.quantiles;
    let worst = { error: 0, empirical: 0, claimed: 0, z: 0 };
    for (let p = 1; p <= 99; p += 1) {
      const z = (q[p] - metric.mean) / metric.sd;
      const claimed = normalPercentile(z);
      const error = Math.abs(claimed - p);
      if (error > worst.error) worst = { error, empirical: p, claimed, z };
    }
    if (worst.error > worstOverall.error) worstOverall = { id: metric.id, error: worst.error };
    console.log(
      `  ${metric.id.padEnd(30)} ${worst.error.toFixed(1).padStart(6)} pp  true p${worst.empirical} claimed p${worst.claimed.toFixed(0)} (z ${worst.z.toFixed(2)})`,
    );
  }
  console.log(`\n  worst case: ${worstOverall.id} misreports by ${worstOverall.error.toFixed(1)} percentile points.\n`);

  const entries = summarised
    .map(
      (metric) =>
        `    '${metric.id}': { mean: ${round(metric.mean, 4)}, sd: ${round(metric.sd, 4)} }, // ${metric.label}`,
    )
    .join('\n');

  const file = `/**
 * Reference norms for the stats pane, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with \`npm run stats:norms\`.
 *
 *   ${n} excerpts, each statistic produced by running the tool itself with its
 *   default options (\`readabilityTool\`, \`gsdsTool\`), so the norms cannot drift
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
 * length, not the writing. \`read.complex.share\` is stored as a 0–1 fraction.
 *
 * These are skewed distributions, so the app's normal-CDF percentile locates a
 * value rather than giving its exact rank; the generator prints the worst error
 * per metric on every run (currently ${worstOverall.error.toFixed(1)} pp, ${worstOverall.id}).
 */

import type { MetricNorm } from './corpus-norms';

export interface StatNorms {
  name: string;
  source: string;
  license: string;
  /** Excerpts that contributed, after dropping anything under ${MIN_WORDS} words. */
  n: number;
  /** Keyed by tool stat id, the same ids the stats pane renders. */
  metrics: Record<string, MetricNorm>;
}

export const CLEAR_STAT_NORMS: StatNorms = {
  name: 'CLEAR corpus',
  source: 'https://github.com/scrosseye/CLEAR-Corpus',
  license: 'CC BY-NC-SA 4.0',
  n: ${n},
  metrics: {
${entries}
  },
};
`;

  if (n < 4000) throw new Error(`expected ~4,700 excerpts, got ${n}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, file);
  console.log(`wrote ${OUT.replace(ROOT, '.')} (${file.length} bytes)`);
}

if (!existsSync(resolve(CORPUS_DIR, 'CLEAR_corpus_final.xlsx'))) {
  console.log('corpus missing; run `npm run corpus:norms` first or let this download it');
}

await main();
