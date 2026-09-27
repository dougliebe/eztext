/**
 * The local surprisal model.
 *
 *   npm run model                # serve on http://localhost:5174
 *   npm run model -- --score "Some text to score."
 *   npm run model -- --file draft.txt
 *
 * Runs GPT-2 under native ONNX Runtime, which measured ~1 ms per token on this
 * machine — several times faster than the browser's WebAssembly build, and it
 * keeps a 120 MB model out of the browser cache and out of the app bundle. The
 * weights are downloaded once into `.models/` (gitignored) and are then used
 * offline: nothing about this tool talks to a server you do not control.
 *
 * Scoring arithmetic lives in `src/core/surprisal.ts` and is bundled in here, so
 * the process and the app share one implementation.
 *
 * The same process also answers "what familiar word means most nearly this one?"
 * for the Common words tool (`POST /similarity`), lazily loading
 * `Xenova/bge-small-en-v1.5` (~34 MB) and a cached vector per common word on
 * first use. See `scripts/word-embeddings.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AutoModelForCausalLM, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { embeddingInfo, similarityForText } from './word-embeddings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Model choice.
 *
 * GPT-2 small is the convention in the surprisal literature, its 1024-token
 * context covers a page of prose, and the int8 export is 122 MB. `MODEL=` and
 * `MODEL_FILE=` switch it — `Xenova/gpt2-medium` gives better expectations for
 * roughly 3× the compute, `Xenova/distilgpt2` is smaller and weaker.
 */
const MODEL = process.env.MODEL ?? 'Xenova/gpt2';
const MODEL_FILE = process.env.MODEL_FILE ?? 'decoder_model_merged_quantized';
const PORT = Number(process.env.PORT ?? 5174);
const TOP_K = 5;

/** Cached to the project so the weights are visible and removable. */
env.cacheDir = resolve(ROOT, '.models', 'transformers');
env.allowLocalModels = true;

/* ------------------------------------------------------------------ */
/* Scoring core (bundled from src/core/surprisal.ts)                   */
/* ------------------------------------------------------------------ */

let scoreWindow;
let summarise;
let cleanPiece;
let coreLoaded = false;

async function loadCore() {
  if (coreLoaded) return;
  const outfile = resolve(ROOT, '.models', 'surprisal-core.cjs');
  mkdirSync(dirname(outfile), { recursive: true });
  execFileSync(
    process.execPath,
    [
      resolve(ROOT, 'node_modules/esbuild/bin/esbuild'),
      resolve(ROOT, 'src/core/surprisal.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node18',
      `--outfile=${outfile}`,
      '--log-level=warning',
    ],
    { stdio: 'inherit' },
  );
  const core = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  scoreWindow = core.scoreWindow;
  summarise = core.summarise;
  cleanPiece = core.cleanPiece;
  coreLoaded = true;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

let tokenizer = null;
let model = null;
let loading = null;
const pieceCache = new Map();

async function loadModel() {
  if (model) return;
  if (loading) return loading;

  loading = (async () => {
    await loadCore();
    const started = performance.now();
    tokenizer = await AutoTokenizer.from_pretrained(MODEL);
    model = await AutoModelForCausalLM.from_pretrained(MODEL, { model_file_name: MODEL_FILE });
    console.log(
      `model ready: ${MODEL} (${MODEL_FILE}) in ${((performance.now() - started) / 1000).toFixed(1)}s` +
        ` — cache ${env.cacheDir}`,
    );
  })();

  return loading;
}

function decodePiece(id) {
  let piece = pieceCache.get(id);
  if (piece === undefined) {
    piece = tokenizer.decode([id]);
    pieceCache.set(id, piece);
  }
  return piece;
}

/** One document through the model. Serialised: a second call waits its turn. */
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** GPT-2 was trained on 1024 positions. */
const CONTEXT = 1024;

async function score(text, topK = TOP_K) {
  await loadModel();
  return enqueue(async () => {
    const started = performance.now();

    // Line endings: GPT-2 was trained on \n, so a lone \r is essentially
    // unmodellable (50+ bits). Windows pastes and this repo's CRLF checkout both
    // produce them, and the model should score the prose, not the encoding.
    const normalised = text.replace(/\r\n?/g, '\n');

    // Tokenise once and window over the *ids*. Re-tokenising a substring would
    // not give the same pieces at the boundary, and character counts are not
    // token counts — both mistakes score the wrong text.
    const input = await tokenizer(normalised);
    const ids = Array.from(input.input_ids.data).map(Number);

    const tokens = [];
    let truncated = false;
    let forwardMs = 0;

    for (let start = 0; start < ids.length; start += CONTEXT - 1) {
      // One token of left context so the window's first real token is scored
      // with a full history rather than as a sentence opening.
      const windowStart = start === 0 ? 0 : start - 1;
      const windowIds = ids.slice(windowStart, start + CONTEXT);
      if (windowIds.length < 2) break;
      if (start + CONTEXT < ids.length) truncated = true;

      const inputIds = new Tensor('int64', BigInt64Array.from(windowIds.map(BigInt)), [1, windowIds.length]);
      // The graph demands an attention mask alongside raw ids (all ones: no padding).
      const attentionMask = new Tensor('int64', BigInt64Array.from(windowIds.map(() => 1n)), [1, windowIds.length]);
      const forwardStart = performance.now();
      const { logits } = await model({ input_ids: inputIds, attention_mask: attentionMask });
      forwardMs += performance.now() - forwardStart;
      const [, positions, vocab] = logits.dims;

      const scored = scoreWindow({
        logits: logits.data,
        positions,
        vocab,
        ids: windowIds,
        decode: decodePiece,
        indexOffset: windowStart,
        topK,
      });

      // Drop the borrowed context token: an earlier window already scored it.
      tokens.push(...(windowStart === start ? scored : scored.slice(1)));
    }

    const scores = summarise(tokens, normalised, MODEL);
    return { ...scores, chunked: truncated, modelMs: performance.now() - started, forwardMs };
  });
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The app calls this through the Vite proxy (same origin); allow direct
    // calls from the dev server too, so the URL can be pointed at by hand.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  response.end(payload);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
    response.end();
    return;
  }

  if (url.pathname === '/health') {
    json(response, 200, {
      ready: Boolean(model),
      loading: Boolean(loading) && !model,
      model: MODEL,
      modelFile: MODEL_FILE,
      cacheDir: env.cacheDir,
      topK: TOP_K,
      // The word-embedding side of this process, for tools that need meaning
      // rather than probability. Loaded lazily, so `ready` is false until a
      // /similarity call (or the warm-up below) touches it.
      embeddings: embeddingInfo(),
    });
    return;
  }

  // Nearest common words by meaning, for every uncommon word in the text.
  if (url.pathname === '/similarity' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);

    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      json(response, 400, { error: 'body must be JSON' });
      return;
    }

    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      json(response, 200, { ...embeddingInfo(), candidates: 0, words: {} });
      return;
    }

    try {
      const requestedK = Number(body.k);
      const requestedThreshold = Number(body.threshold);
      json(
        response,
        200,
        await similarityForText(text, {
          ...(Number.isFinite(requestedK) ? { k: requestedK } : {}),
          ...(Number.isFinite(requestedThreshold) ? { threshold: requestedThreshold } : {}),
        }),
      );
    } catch (error) {
      json(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (url.pathname === '/score' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);

    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      json(response, 400, { error: 'body must be JSON' });
      return;
    }

    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      json(response, 200, { model: MODEL, tokens: [], words: [], empty: true });
      return;
    }

    try {
      const requested = Number(body.topK);
      const scores = await score(text, Number.isFinite(requested) ? requested : TOP_K);
      json(response, 200, scores);
    } catch (error) {
      console.error('scoring failed:', error);
      json(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  json(response, 404, { error: 'try GET /health or POST /score' });
});

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

if (args.includes('--help')) {
  console.log(
    [
      'Local surprisal model.',
      '',
      '  npm run model                     serve on http://localhost:5174',
      '  npm run model -- --score "text"   score a string and print it',
      '  npm run model -- --file draft.txt score a file and print it',
      '',
      '  MODEL=Xenova/gpt2-medium          override the model',
      '  MODEL_FILE=...                    override the onnx file',
      '  PORT=5174                         override the port',
    ].join('\n'),
  );
  process.exit(0);
}

const inline = flag('score');
const file = flag('file');

if (inline !== undefined || file !== undefined) {
  const text = file ? readFileSync(file, 'utf8') : inline;
  const requested = Number(flag('top'));
  const scores = await score(text, Number.isFinite(requested) ? requested : TOP_K);

  console.log(`\n${MODEL} — ${scores.tokens.length} tokens in ${Math.round(scores.modelMs)} ms (forward ${Math.round(scores.forwardMs)} ms)${scores.chunked ? ' [chunked]' : ''}`);
  console.log(`mean ${scores.meanBits.toFixed(2)} bits/token (perplexity ${2 ** scores.meanBits})`);
  console.log(`mean ${scores.meanWordBits.toFixed(2)} bits/word, max ${scores.maxBits.toFixed(2)}`);

  const top = [...scores.words].sort((a, b) => b.bits - a.bits).slice(0, 20);
  console.log('\n  bits   word                 model expected instead');
  for (const word of top) {
    const expected = word.expected
      ? `"${word.expected.text}" (${word.expected.gain.toFixed(1)} bits cheaper, p=${word.expected.probability.toFixed(4)})`
      : '—';
    console.log(`  ${word.bits.toFixed(2).padStart(5)}  ${JSON.stringify(word.text).padEnd(20)} ${expected}`);
  }

  const gains = [...scores.words].filter((w) => w.expected).sort((a, b) => b.expected.gain - a.expected.gain).slice(0, 12);
  console.log('\n  largest perturbation gains');
  for (const word of gains) {
    console.log(
      `  ${word.expected.gain.toFixed(2).padStart(5)} bits cheaper: "${word.expected.text}" instead of ${JSON.stringify(word.text)}`,
    );
  }
  process.exit(0);
}

if (!existsSync(env.cacheDir)) mkdirSync(env.cacheDir, { recursive: true });

server.listen(PORT, '127.0.0.1', () => {
  console.log(`surprisal model server on http://127.0.0.1:${PORT}  (${MODEL})`);
  console.log('first run downloads the weights into .models/ — later runs are offline');
  // Warm up in the background so the first request is not the one that pays.
  loadModel().catch((error) => console.error('model failed to load:', error));
});
