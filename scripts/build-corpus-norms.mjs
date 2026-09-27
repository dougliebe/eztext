/**
 * Builds `src/core/data/corpus-norms.ts` from the CLEAR corpus.
 *
 *   npm run corpus:norms
 *
 * The corpus itself is never committed (see .gitignore) — only the aggregate
 * means and standard deviations we derive from it, which is what the app needs
 * to express a document's metrics as a deviation from a reference population.
 *
 * The xlsx is read directly (it is a zip of XML) so the project keeps zero
 * dependencies. Metrics are computed by bundling `src/core/metrics.ts` and
 * running it — the exact same code path the app uses, so the norms can never
 * drift from the implementation.
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = resolve(ROOT, '.corpus');
const XLSX = resolve(CORPUS_DIR, 'CLEAR_corpus_final.xlsx');
const XLSX_URL = 'https://github.com/scrosseye/CLEAR-Corpus/raw/HEAD/CLEAR_corpus_final.xlsx';
const OUT = resolve(ROOT, 'src/core/data/corpus-norms.ts');

/* ------------------------------------------------------------------ */
/* xlsx reading (dependency-free)                                      */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(value) {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (match, hex, dec, name) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return ENTITIES[name] ?? match;
  });
}

function readZipEntry(archive, entry) {
  return execFileSync('unzip', ['-p', archive, entry], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

/** The shared string table: one entry per unique string, referenced by index. */
function parseSharedStrings(xml) {
  const strings = [];
  const entry = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let match;
  while ((match = entry.exec(xml))) {
    const inner = match[1] ?? '';
    let text = '';
    const run = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let part;
    while ((part = run.exec(inner))) text += unescapeXml(part[1]);
    strings.push(text);
  }
  return strings;
}

/** Decode one row's cells into a column → value map. */
function parseRowCells(rowInner, sharedStrings) {
  const cells = new Map();
  const cell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;

  while ((match = cell.exec(rowInner))) {
    const attrs = match[1];
    const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
    if (!ref) continue;

    const inner = match[2] ?? '';
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';

    if (type === 's') {
      const index = Number.parseInt(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? '-1', 10);
      cells.set(ref[1], sharedStrings[index] ?? '');
    } else if (type === 'inlineStr') {
      cells.set(ref[1], unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''));
    } else {
      cells.set(ref[1], unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''));
    }
  }

  return cells;
}

/**
 * Locate a column by the header text in row 1.
 *
 * Column order is a property of whoever exported the workbook, so the letter is
 * discovered rather than hardcoded — the CLEAR workbook puts `Excerpt` in O,
 * with `Sub Cat`, `Lexile Band`, `MPAA *` and its own readability scores
 * scattered around it.
 */
function findColumn(xml, sharedStrings, headerName) {
  const firstRow = /<row\b[^>]*>([\s\S]*?)<\/row>/.exec(xml);
  if (!firstRow) throw new Error('no header row found in sheet1.xml');

  const headers = parseRowCells(firstRow[1], sharedStrings);
  for (const [column, value] of headers) {
    if (value.trim().toLowerCase() === headerName.toLowerCase()) return { column, headers };
  }

  throw new Error(
    `column "${headerName}" not found. Headers present: ${[...headers.entries()].map(([c, v]) => `${c}=${v}`).join(', ')}`,
  );
}

/** Extract one column of a worksheet as an array of strings, in row order. */
function parseColumn(xml, column, sharedStrings) {
  const values = [];
  const row = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = row.exec(xml))) {
    const cells = parseRowCells(rowMatch[2], sharedStrings);
    if (cells.has(column)) values.push(cells.get(column));
  }

  return values;
}

async function ensureCorpus() {
  if (existsSync(XLSX) && readFileSync(XLSX).length > 1_000_000) return;

  mkdirSync(CORPUS_DIR, { recursive: true });
  console.log(`downloading CLEAR corpus → ${XLSX}`);
  const response = await fetch(XLSX_URL);
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await new Promise((ok, fail) => {
    const stream = createWriteStream(XLSX);
    stream.on('error', fail);
    stream.on('finish', ok);
    stream.end(buffer);
  });
}

/* ------------------------------------------------------------------ */
/* statistics                                                          */
/* ------------------------------------------------------------------ */

function summarise(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  // Sample standard deviation (n − 1): the corpus is a sample of published prose.
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance) };
}

const round = (value, digits = 4) => Number(value.toFixed(digits));

/* ------------------------------------------------------------------ */

async function main() {
  await ensureCorpus();

  console.log('reading xlsx…');
  const sharedStrings = parseSharedStrings(readZipEntry(XLSX, 'xl/sharedStrings.xml'));
  const sheet = readZipEntry(XLSX, 'xl/worksheets/sheet1.xml');
  const { column, headers } = findColumn(sheet, sharedStrings, 'Excerpt');
  const excerpts = parseColumn(sheet, column, sharedStrings).slice(1); // drop the header row
  console.log(`  ${sharedStrings.length} shared strings, ${headers.size} columns`);
  console.log(`  excerpt text in column ${column} ("${headers.get(column)}"), ${excerpts.length} rows`);

  if (excerpts.length < 4000) throw new Error(`expected ~4,700 excerpts, got ${excerpts.length}`);

  // Use the app's own metric implementation.
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
  const { computeMetrics, MIN_COMPARABLE_WORDS: MIN_WORDS } = await import(pathToFileURL(bundle).href);
  rmSync(bundle, { force: true });

  const ratios = { wordsPerSentence: [], charactersPerWord: [], polysyllabicShare: [], unfamiliarShare: [], syllablesPerWord: [] };
  const wordCounts = [];
  let skipped = 0;

  for (const excerpt of excerpts) {
    const text = (excerpt ?? '').trim();
    const metrics = computeMetrics(text);
    if (metrics.words < MIN_WORDS) {
      skipped += 1;
      continue;
    }
    wordCounts.push(metrics.words);
    for (const key of Object.keys(ratios)) ratios[key].push(metrics[key]);
  }

  const n = wordCounts.length;
  const stats = Object.fromEntries(Object.entries(ratios).map(([key, values]) => [key, summarise(values)]));
  const words = summarise(wordCounts);

  console.log(`\n  ${n} excerpts used (${skipped} skipped under ${MIN_WORDS} words)\n`);
  console.log(`  ${'metric'.padEnd(22)} ${'mean'.padStart(8)} ${'sd'.padStart(8)}  range`);
  const ranges = Object.fromEntries(
    Object.entries(ratios).map(([key, values]) => [key, [Math.min(...values), Math.max(...values)]]),
  );
  for (const [key, value] of Object.entries(stats)) {
    console.log(
      `  ${key.padEnd(22)} ${value.mean.toFixed(4).padStart(8)} ${value.sd.toFixed(4).padStart(8)}  ${ranges[key][0].toFixed(2)} … ${ranges[key][1].toFixed(2)}`,
    );
  }
  console.log(`  ${'words per excerpt'.padEnd(22)} ${words.mean.toFixed(1).padStart(8)} ${words.sd.toFixed(1).padStart(8)}`);

  const file = `/**
 * Reference norms for the topbar metrics, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with \`npm run corpus:norms\`.
 *
 *   ${n} excerpts, each metric computed with the app's own
 *   \`core/metrics.ts\` implementation, so these never drift from the code.
 *   Mean and sample standard deviation (n − 1).
 *
 * Source: CLEAR — CommonLit Ease of Readability corpus
 *   https://github.com/scrosseye/CLEAR-Corpus
 *   Crossley, Heintz, Choi, Batchelor, Karimi & Malatinszky (2021, 2022)
 *   Licensed CC BY-NC-SA 4.0 — non-commercial use with attribution. The
 *   corpus text itself is NOT redistributed here; only these aggregate
 *   statistics. Rebuilding requires downloading the corpus yourself.
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
  n: ${n},
  wordsPerExcerpt: { mean: ${round(words.mean, 1)}, sd: ${round(words.sd, 1)} },
  metrics: {
    wordsPerSentence: { mean: ${round(stats.wordsPerSentence.mean, 4)}, sd: ${round(stats.wordsPerSentence.sd, 4)} },
    charactersPerWord: { mean: ${round(stats.charactersPerWord.mean, 4)}, sd: ${round(stats.charactersPerWord.sd, 4)} },
    polysyllabicShare: { mean: ${round(stats.polysyllabicShare.mean, 4)}, sd: ${round(stats.polysyllabicShare.sd, 4)} },
    unfamiliarShare: { mean: ${round(stats.unfamiliarShare.mean, 4)}, sd: ${round(stats.unfamiliarShare.sd, 4)} },
    syllablesPerWord: { mean: ${round(stats.syllablesPerWord.mean, 4)}, sd: ${round(stats.syllablesPerWord.sd, 4)} },
  },
};
`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, file);
  console.log(`\nwrote ${OUT.replace(ROOT, '.')} (${file.length} bytes)`);
}

await main();
