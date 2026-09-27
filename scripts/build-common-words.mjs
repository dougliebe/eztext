/**
 * Builds `src/core/data/common-words.ts` from a word-prevalence CSV.
 *
 *   npm run words:common -- "D:/Downloads/common_us_words.csv"
 *   npm run words:common -- words.csv --threshold 2
 *
 * The source table is `Word, Prevalence_US` — a *knowledge* prevalence, not a
 * text frequency: it is how widely US readers recognise the word ("the" scores
 * below "cat", because "do you know this word?" is a strange question for a
 * function word). Words above the threshold are therefore the ones a typical
 * reader knows, which is exactly what a readability tool should call familiar.
 *
 * Only the words are kept, not the scores: the runtime needs a `Set` lookup, and
 * a threshold is a build-time decision. The CSV itself is not committed — it
 * lives wherever it was downloaded — but the generated module is, so the app
 * builds without it.
 *
 * Regenerating rewrites the module; `word-embeddings.mjs` picks the new list up
 * on its next start and rebuilds the vector cache, because the cache is checked
 * against the list rather than trusted by name.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/core/data/common-words.ts');

const args = process.argv.slice(2);
const thresholdFlag = args.indexOf('--threshold');
const THRESHOLD = thresholdFlag >= 0 ? Number(args[thresholdFlag + 1]) : 1.6;
const source = args.find((arg) => !arg.startsWith('--') && arg !== String(THRESHOLD));

if (!source) {
  console.error('usage: npm run words:common -- <prevalence.csv> [--threshold 1.6]');
  process.exit(1);
}

const text = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);
const header = lines[0].split(',').map((field) => field.trim());

if (header.length < 2) {
  console.error(`expected "Word,Prevalence_US" in the first line, found: ${lines[0]}`);
  process.exit(1);
}

let skipped = 0;
const kept = new Map();
const dataRows = lines.slice(1).filter((line) => line.trim()).length;

for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  // The word never contains a comma, so the last one separates the score.
  const cut = line.lastIndexOf(',');
  if (cut <= 0) {
    skipped += 1;
    continue;
  }

  const word = line.slice(0, cut).trim().toLowerCase();
  const prevalence = Number(line.slice(cut + 1));
  if (!Number.isFinite(prevalence) || !/^[a-z][a-z'-]*$/.test(word) || prevalence <= THRESHOLD) {
    if (!Number.isFinite(prevalence)) skipped += 1;
    continue;
  }

  // Keep the highest score if the same word appears twice with different case.
  if (kept.get(word) === undefined || kept.get(word) < prevalence) kept.set(word, prevalence);
}

const words = [...kept.keys()].sort();

/** Wrap the list so the generated file stays reviewable. */
function block(list) {
  const lines = [];
  let current = '';
  for (const word of list) {
    if (current.length + word.length + 1 > 110) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

const content = `/**
 * The words a typical US reader knows — generated, do not edit by hand.
 *
 * Source: ${basename(source)} (\`${header[0]}, ${header[1]}\`), keeping
 * ${header[1]} > ${THRESHOLD}: ${words.length.toLocaleString('en-US')} words from
 * ${dataRows.toLocaleString('en-US')} rows${skipped > 0 ? ` (${skipped} unreadable rows skipped)` : ''}.
 *
 * Regenerate with:
 *   npm run words:common -- "${basename(source)}"
 *
 * Prevalence is knowledge rather than text frequency, so this is "would a reader
 * recognise this word", not "how often does it appear". The source carries
 * inflections unevenly ("word" but not "words", "walk" but not "walked"), which
 * is why \`isFamiliarWord\` still strips inflection before looking a word up.
 */
const RAW = \`
${block(words)}
\`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(RAW.split(/\\s+/).filter(Boolean));

export const COMMON_WORDS_SIZE = COMMON_WORDS.size;
`;

writeFileSync(OUT, content);
console.log(
  `common words: kept ${words.length.toLocaleString('en-US')} of ${dataRows.toLocaleString('en-US')} rows ` +
    `(${header[1]} > ${THRESHOLD}${skipped > 0 ? `, ${skipped} skipped` : ''}) → ${OUT.replace(`${ROOT}\\`, '')}`,
);
