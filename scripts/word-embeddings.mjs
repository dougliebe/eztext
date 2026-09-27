/**
 * Word embeddings for the Common words tool.
 *
 * "Which word that a reader knows means most nearly this uncommon one?" is a
 * *word similarity* question, and spelling distance answers it badly ("enormous"
 * has no near neighbour by spelling — the answer is "huge"). A small
 * sentence-embedding model answers it directly: embed the flagged word, rank the
 * common-word list by cosine, take the top few.
 *
 * Cost, measured on this machine:
 *   · one-time: download the model (~34 MB, cached in `.models/`) and embed the
 *     24,607-word list (~10 s), cached next to the weights;
 *   · per document: one embedding per *new* flagged word (cached by word), then
 *     ~15 ms to rank 24,607 vectors. A keystroke usually adds no new words.
 *
 * The candidate list is filtered by the prevalence threshold the app sends, so
 * raising it narrows what may be suggested without touching the cached index.
 *
 * Kept out of the browser on purpose: the weights would otherwise be a 34 MB
 * download in the app's cache, which is the same reasoning that put the
 * surprisal model in a process of its own.
 *
 * The arithmetic here is plain cosine over cached vectors; the *words* come from
 * `src/core/data/common-words.ts` and the familiarity rule from
 * `src/core/metrics.ts`, bundled in below so the process and the app cannot
 * disagree about what "unfamiliar" means.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, AutoTokenizer, pipeline } from '@huggingface/transformers';

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
 * call. bge scores real synonyms around 0.75–0.96 ("ubiquitous"/"universally"
 * 0.77, "esoteric"/"occult" 0.81) and unrelated words around 0.5.
 */
const MIN_SCORE = 0.55;

/**
 * The most pieces the tokenizer may split a query into before we stop trusting
 * its neighbours.
 *
 * Measured: words the model has learned tokenize in one or two pieces
 * ("ubiquitous" 1, "esoteric" 2, "brutalist" 2) and get sensible neighbours,
 * while rare words it has barely seen split into three to five ("zygote" 4,
 * "bibliopolic" 5, "antediluvian" 5) and come back with *confident* noise:
 * "bibliopolic" → "bibliographic" 0.83, "litotes" → "lit" 0.76. Those scores are
 * higher than the good answers, so no cosine floor can remove them — the fix is
 * to refuse to answer for words the model does not really know, and let the
 * tool's word-family and spelling tiers (which need no model) take over.
 */
const MAX_QUERY_PIECES = 2;

env.cacheDir = resolve(ROOT, '.models', 'transformers');
env.allowLocalModels = true;

const CORE_DIR = resolve(ROOT, '.models', 'words-core');

/** App modules the server needs a copy of, with the bundle name for each. */
const CORE_MODULES = [
  { entry: 'src/core/metrics.ts', out: 'metrics.cjs' },
  { entry: 'src/core/text.ts', out: 'text.cjs' },
  { entry: 'src/core/data/common-words.ts', out: 'common-words.cjs' },
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
    // Rebuilt on every start rather than trusted if present: these bundles embed
    // the word list and the familiarity rule, and a stale one would quietly
    // serve an old vocabulary (or miss a new export) instead of failing.
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
    COMMON_WORDS: require(resolve(CORE_DIR, 'common-words.cjs')).COMMON_WORDS,
    COMMON_WORD_FLOOR: require(resolve(CORE_DIR, 'common-words.cjs')).COMMON_WORD_FLOOR,
  };
  return core;
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                           */
/* ------------------------------------------------------------------ */

let extractor = null;
let tokenizer = null;
let modelLoading = false;

async function loadModel() {
  if (extractor) return extractor;
  if (!modelLoading) {
    modelLoading = true;
    const started = performance.now();
    extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
    tokenizer = await AutoTokenizer.from_pretrained(MODEL);
    console.error(
      `embeddings ready: ${MODEL} in ${((performance.now() - started) / 1000).toFixed(1)}s — cache ${env.cacheDir}`,
    );
  }
  // A second caller waits for the first instead of starting a second load.
  while (!extractor) await new Promise((done) => setTimeout(done, 50));
  return extractor;
}

/** Token ids that are not the word: [PAD], [UNK], [CLS], [SEP]. */
const SPECIAL_TOKEN_IDS = new Set([0, 100, 101, 102]);

/** How many pieces the model's own tokenizer breaks `word` into. */
function wordPieces(word) {
  const ids = tokenizer(word).input_ids.data;
  let pieces = 0;
  for (const id of ids) if (!SPECIAL_TOKEN_IDS.has(Number(id))) pieces += 1;
  return pieces;
}

/** Mean-pooled, L2-normalised vectors — cosine is then a plain dot product. */
async function embed(texts) {
  const model = await loadModel();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const dims = output.dims[output.dims.length - 1];
  return { dims, rows: texts.map((_, i) => output.data.slice(i * dims, (i + 1) * dims)) };
}

let index = null;

/**
 * The common-word list, embedded once and cached beside the model weights.
 *
 * The cache is named for the list size and its contents are compared against the
 * live list, so regenerating `common-words.ts` rebuilds the vectors rather than
 * silently ranking a stale vocabulary.
 */
async function loadIndex() {
  if (index) return index;
  const { COMMON_WORDS } = loadCore();
  // Keys, not entries: the module carries word → prevalence.
  const words = [...COMMON_WORDS.keys()].sort();
  const vectorFile = resolve(ROOT, '.models', `word-vectors-${MODEL.replace(/[^\w.]+/g, '-')}-${words.length}.json`);

  if (existsSync(vectorFile)) {
    try {
      const cached = JSON.parse(readFileSync(vectorFile, 'utf8'));
      const sameList =
        cached.model === MODEL &&
        cached.words.length === words.length &&
        cached.words.every((word, i) => word === words[i]);
      if (sameList) {
        const data = Buffer.from(cached.vectors, 'base64');
        index = {
          words: cached.words,
          dims: cached.dims,
          vectors: new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4),
        };
        console.error(`word vectors: ${index.words.length} words, ${index.dims}-dim (cached)`);
        return index;
      }
      console.error(`word vectors: cache is for a different list (${cached.words.length} vs ${words.length}), rebuilding`);
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
    vectorFile,
    JSON.stringify({
      model: MODEL,
      dims,
      words,
      vectors: Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).toString('base64'),
    }),
  );
  console.error(
    `word vectors: embedded ${words.length} words in ${((performance.now() - started) / 1000).toFixed(1)}s → ${vectorFile}`,
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

function rank(vector, { words, dims, vectors }, k, threshold) {
  const scored = [];
  const prevalence = loadCore().COMMON_WORDS;
  for (let i = 0; i < words.length; i += 1) {
    // The index holds every stored word; the threshold decides which are allowed
    // to be suggested, exactly as the tool does when it ranks its own tiers.
    if ((prevalence.get(words[i]) ?? 0) <= threshold) continue;
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
export async function similarityForText(text, { k = TOP_K, threshold } = {}) {
  const started = performance.now();
  const { isFamiliarWord, tokenizeWords, COMMON_WORD_FLOOR } = loadCore();
  const floor = Number.isFinite(threshold) ? Math.max(COMMON_WORD_FLOOR, threshold) : COMMON_WORD_FLOOR;
  const idx = await loadIndex();

  const candidates = [];
  const seen = new Set();
  for (const token of tokenizeWords(text)) {
    const word = token.lower.replace(/[^a-z'-]/g, '');
    if (!word || seen.has(word) || isFamiliarWord(word, floor)) continue;
    seen.add(word);
    candidates.push(word);
  }

  const words = {};
  let embedded = 0;
  let tooRare = 0;
  for (const word of candidates) {
    await loadModel();
    if (wordPieces(word) > MAX_QUERY_PIECES) {
      // The model does not know the word well enough to rank it; an empty list
      // is the honest answer, and the tool falls back to word family/spelling.
      tooRare += 1;
      words[word] = [];
      continue;
    }
    if (!queryCache.has(word)) embedded += 1;
    words[word] = rank(await embedWord(word), idx, k, floor);
  }

  return {
    model: MODEL,
    threshold: floor,
    dims: idx.dims,
    listSize: idx.words.length,
    candidates: candidates.length,
    embedded,
    tooRare,
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
