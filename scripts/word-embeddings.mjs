/**
 * Word embeddings for the Dale-Chall tool.
 *
 * "Which familiar word means most nearly this unfamiliar one?" is a *word
 * similarity* question, and spelling distance answers it badly ("enormous" has
 * no near neighbour among 3,000 fourth-grade words — the answer is "huge").
 * A small sentence-embedding model answers it directly: embed the flagged word,
 * rank the Dale-Chall list by cosine, take the top few.
 *
 * Cost, measured on this machine:
 *   · one-time: download the model (~34 MB, cached in `.models/`) and embed the
 *     2,941-word list (~2 s), cached next to the weights;
 *   · per document: one embedding per *new* flagged word (cached by word), then
 *     ~5 ms to rank 2,941 vectors. A keystroke usually adds no new words at all.
 *
 * Kept out of the browser on purpose: the weights would otherwise be a 34 MB
 * download in the app's cache, which is the same reasoning that put the
 * surprisal model in a process of its own.
 *
 * The arithmetic here is plain cosine over cached vectors; the *words* come from
 * `src/core/data/dale-chall.ts` and the familiarity rule from
 * `src/core/metrics.ts`, bundled in below so the process and the app cannot
 * disagree about what "unfamiliar" means.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** bge-small-en-v1.5 measured clearly better than MiniLM on single words. */
const MODEL = process.env.EMBED_MODEL ?? 'Xenova/bge-small-en-v1.5';

/** Neighbours returned per word. */
const TOP_K = 6;

/**
 * Below this cosine a neighbour is not worth sending. Deliberately the loosest
 * floor the tool offers: the server returns candidates and the tool's `match`
 * strength decides what to show, so a looser setting does not need a new model
 * call. bge scores real synonyms around 0.75–0.96 ("enormous"/"huge" 0.96,
 * "spine"/"bone" 0.74) and unrelated words around 0.5.
 */
const MIN_SCORE = 0.55;

env.cacheDir = resolve(ROOT, '.models', 'transformers');
env.allowLocalModels = true;

const CORE_DIR = resolve(ROOT, '.models', 'words-core');
const VECTOR_FILE = resolve(ROOT, '.models', `word-vectors-${MODEL.replace(/[^\w.]+/g, '-')}.json`);

/** App modules the server needs a copy of, with the bundle name for each. */
const CORE_MODULES = [
  { entry: 'src/core/metrics.ts', out: 'metrics.cjs' },
  { entry: 'src/core/text.ts', out: 'text.cjs' },
  { entry: 'src/core/data/dale-chall.ts', out: 'dale-chall.cjs' },
];

/* ------------------------------------------------------------------ */
/* Shared app code, bundled                                             */
/* ------------------------------------------------------------------ */

let core = null;

/** Bundle the app's own familiarity rule and tokenizer, so both sides agree. */
function loadCore() {
  if (core) return core;

  mkdirSync(CORE_DIR, { recursive: true });
  for (const { entry, out } of CORE_MODULES) {
    const outfile = resolve(CORE_DIR, out);
    if (existsSync(outfile)) continue;
    // One esbuild run per module with an explicit outfile: `--outdir` would
    // mirror the source tree and put dale-chall under data/.
    execFileSync(process.execPath, [
      resolve(ROOT, 'node_modules/esbuild/bin/esbuild'),
      resolve(ROOT, entry),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--log-level=error',
      `--outfile=${outfile}`,
    ]);
  }

  core = {
    isFamiliarWord: require(resolve(CORE_DIR, 'metrics.cjs')).isFamiliarWord,
    tokenizeWords: require(resolve(CORE_DIR, 'text.cjs')).tokenizeWords,
    DALE_CHALL_WORDS: require(resolve(CORE_DIR, 'dale-chall.cjs')).DALE_CHALL_WORDS,
  };
  return core;
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                           */
/* ------------------------------------------------------------------ */

let extractor = null;
let modelLoading = false;

async function loadModel() {
  if (extractor) return extractor;
  if (!modelLoading) {
    modelLoading = true;
    const started = performance.now();
    extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
    console.error(
      `embeddings ready: ${MODEL} in ${((performance.now() - started) / 1000).toFixed(1)}s — cache ${env.cacheDir}`,
    );
  }
  // A second caller waits for the first instead of starting a second load.
  while (!extractor) await new Promise((done) => setTimeout(done, 50));
  return extractor;
}

/** Mean-pooled, L2-normalised vectors — cosine is then a plain dot product. */
async function embed(texts) {
  const model = await loadModel();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const dims = output.dims[output.dims.length - 1];
  return { dims, rows: texts.map((_, i) => output.data.slice(i * dims, (i + 1) * dims)) };
}

let index = null;

/** The Dale-Chall list, embedded once and cached beside the model weights. */
async function loadIndex() {
  if (index) return index;
  const { DALE_CHALL_WORDS } = loadCore();
  const words = [...DALE_CHALL_WORDS].sort();

  if (existsSync(VECTOR_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(VECTOR_FILE, 'utf8'));
      if (cached.model === MODEL && cached.words.length === words.length) {
        const data = Buffer.from(cached.vectors, 'base64');
        index = {
          words: cached.words,
          dims: cached.dims,
          vectors: new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4),
        };
        console.error(`word vectors: ${index.words.length} words, ${index.dims}-dim (cached)`);
        return index;
      }
    } catch (error) {
      console.error(`word vectors: cache unreadable (${error.message}), rebuilding`);
    }
  }

  const started = performance.now();
  const { dims, rows } = await embed(words);
  const vectors = new Float32Array(words.length * dims);
  rows.forEach((row, i) => vectors.set(row, i * dims));

  index = { words, dims, vectors };
  writeFileSync(
    VECTOR_FILE,
    JSON.stringify({
      model: MODEL,
      dims,
      words,
      vectors: Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).toString('base64'),
    }),
  );
  console.error(
    `word vectors: embedded ${words.length} words in ${((performance.now() - started) / 1000).toFixed(1)}s → ${VECTOR_FILE}`,
  );
  return index;
}

/** Query words already embedded, so typing does not re-embed the same word. */
const queryCache = new Map();

async function embedWord(word) {
  const cached = queryCache.get(word);
  if (cached) return cached;
  const { rows } = await embed([word]);
  const vector = rows[0];
  if (queryCache.size >= 5000) queryCache.clear();
  queryCache.set(word, vector);
  return vector;
}

function rank(vector, { words, dims, vectors }, k) {
  const scored = [];
  for (let i = 0; i < words.length; i += 1) {
    let dot = 0;
    const offset = i * dims;
    for (let d = 0; d < dims; d += 1) dot += vector[d] * vectors[offset + d];
    if (dot >= MIN_SCORE) scored.push({ word: words[i], score: dot });
  }
  scored.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
  return scored.slice(0, k).map((entry) => ({ word: entry.word, score: Number(entry.score.toFixed(4)) }));
}

/**
 * Nearest listed words for every unfamiliar word in `text`.
 *
 * The set of words to look up is decided here, not by the caller, so the app
 * only has to say "here is the document".
 */
export async function similarityForText(text, { k = TOP_K } = {}) {
  const started = performance.now();
  const { isFamiliarWord, tokenizeWords } = loadCore();
  const idx = await loadIndex();

  const candidates = [];
  const seen = new Set();
  for (const token of tokenizeWords(text)) {
    const word = token.lower.replace(/[^a-z'-]/g, '');
    if (!word || seen.has(word) || isFamiliarWord(word)) continue;
    seen.add(word);
    candidates.push(word);
  }

  const words = {};
  let embedded = 0;
  for (const word of candidates) {
    if (!queryCache.has(word)) embedded += 1;
    words[word] = rank(await embedWord(word), idx, k);
  }

  return {
    model: MODEL,
    dims: idx.dims,
    listSize: idx.words.length,
    candidates: candidates.length,
    embedded,
    ms: Math.round(performance.now() - started),
    words,
  };
}

export const embeddingInfo = () => ({
  model: MODEL,
  ready: Boolean(index && extractor),
  loading: modelLoading && !extractor,
  listSize: index?.words.length ?? null,
  dims: index?.dims ?? null,
});

/** Warm the model and the vector index, for the server's startup path. */
export async function warmEmbeddings() {
  await loadIndex();
}
