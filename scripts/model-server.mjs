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
import { embeddingInfo, similarityForText, warmEmbeddings } from './word-embeddings.mjs';

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
let rankNext;
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
  rankNext = core.rankNext;
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

/**
 * GPT-2's byte ⇄ unicode alphabet, inverted.
 *
 * The vocabulary stores bytes as printable characters (`bytes_to_unicode()` in
 * the original implementation). `decodePiece` is fine for display, but it is
 * wrong for offsets: a multi-byte character can be split across tokens, and
 * decoding half a UTF-8 sequence yields U+FFFD with the wrong length.
 */
const BYTE_DECODER = (() => {
  const bytes = [
    ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => 0x21 + index),
    ...Array.from({ length: 0xac - 0xa1 + 1 }, (_, index) => 0xa1 + index),
    ...Array.from({ length: 0xff - 0xae + 1 }, (_, index) => 0xae + index),
  ];
  const chars = [...bytes];
  let next = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    if (!bytes.includes(byte)) {
      bytes.push(byte);
      chars.push(256 + next);
      next += 1;
    }
  }
  const decoder = new Map();
  bytes.forEach((byte, index) => decoder.set(String.fromCodePoint(chars[index]), byte));
  return decoder;
})();

/** piece string → bytes, per token id. Built once the tokenizer is loaded. */
let vocabById = null;
const tokenByteCache = new Map();

function tokenBytes(id) {
  let bytes = tokenByteCache.get(id);
  if (bytes !== undefined) return bytes;
  if (!vocabById) {
    vocabById = new Map();
    for (const [piece, tokenId] of tokenizer.get_vocab()) vocabById.set(tokenId, piece);
  }
  const piece = vocabById.get(id);
  if (piece === undefined) return null;
  const out = [];
  for (const character of piece) {
    const byte = BYTE_DECODER.get(character);
    if (byte === undefined) return null;
    out.push(byte);
  }
  bytes = Uint8Array.from(out);
  tokenByteCache.set(id, bytes);
  return bytes;
}

const utf8Length = (codePoint) =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

/**
 * The exact document text for every token id, or `null` when it cannot be
 * recovered.
 *
 * `summarise` derives character offsets by walking the pieces, which is only
 * sound if concatenating them reproduces the document. `decode([id])` breaks
 * that for any multi-byte character split across tokens, so this concatenates
 * the tokens' own bytes instead and walks the document's UTF-8 bytes, cutting a
 * span where each token's byte budget runs out. A character belongs to the
 * token that contains its first byte, which keeps the spans tiling the text
 * even when a token boundary falls inside a character.
 */
function tokenTexts(text, ids) {
  const boundaries = [0];
  for (const id of ids) {
    const bytes = tokenBytes(id);
    if (!bytes) return null;
    boundaries.push(boundaries[boundaries.length - 1] + bytes.length);
  }
  if (boundaries[boundaries.length - 1] !== Buffer.byteLength(text, 'utf8')) return null;

  const texts = [];
  let charIndex = 0;
  let bytePos = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const start = charIndex;
    const target = boundaries[i + 1];
    while (charIndex < text.length && bytePos < target) {
      const codePoint = text.codePointAt(charIndex);
      bytePos += utf8Length(codePoint);
      charIndex += codePoint > 0xffff ? 2 : 1;
    }
    texts.push(text.slice(start, charIndex));
  }
  return texts;
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
    // Exact spans, so a multi-byte character split across tokens cannot shift
    // the character offsets the app shades by. `null` falls back to the pieces.
    const texts = tokenTexts(normalised, ids);

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
        texts: texts ? texts.slice(windowStart, start + CONTEXT) : undefined,
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
/* Continuation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Where the model would go next, as phrases rather than a single word.
 *
 * The interesting question about a sentence is not which word the model wanted
 * at this position — it is where it thinks the sentence is heading. So: take the
 * five likeliest next pieces, let each of them continue, and keep five words of
 * each. That is five hypotheses about the shape of the sentence, which is
 * something a writer can disagree with.
 *
 * Deliberately not beam search, and not `generate()`:
 *   - the app already shows the model's ranked next words, which is what beam
 *     search would spend its width on; what it cannot show is the phrase, so the
 *     five first pieces are *forced* to be distinct. Five rows that all open
 *     with the same word answer a question nobody asked.
 *   - transformers.js beam search returns one sequence and drops the scores
 *     (`// TODO: scores` in v4.3), and its sampler takes only the first candidate
 *     per row, so `num_beams: 5` is greedy with extra steps. Measured, not assumed.
 *
 * Each branch walks greedily from its own first piece, and the bits it reports
 * are the sum of the per-step surprises — the exact −log₂ P of that whole phrase
 * under the model, not an estimate.
 *
 * The KV cache is deliberately unused. A cached step in this ONNX graph takes
 * ~45 ms whether the context is 32 tokens or 512 (cost is per-call, not per-token),
 * and it disagrees with a full forward pass by whole logits because the graph has
 * no `position_ids` input — so a hand-driven cache produces fluent, wrong text.
 * Re-feeding the sequence is boring, obviously correct, and its cost is bounded
 * by the context cap below.
 */
const CONTINUATION = {
  /**
   * Characters of context. Kept short on purpose: local context decides the next
   * phrase, and this cap is what the wait is made of. Measured on this machine,
   * five branches of five words: 17 tokens 0.7 s, 69 tokens 1.8 s, 99 tokens
   * 2.4 s, 175 tokens 4.2 s — the cost is context × forwards, and every forward
   * carries all five rows.
   */
  contextChars: 200,
  words: 5,
  branches: 5,
  /** Hard cap on pieces per branch, whatever five words turn out to need. */
  maxTokens: 16,
};

/**
 * Words *started* by a run of pieces.
 *
 * GPT-2 encodes a word boundary as a leading space, so a piece that opens with
 * whitespace begins a word and pieces like "'s" extend the one before it. Past
 * `words + 1` words the first five are complete and the sixth can be cut.
 */
function startedWords(pieces) {
  let count = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    if (index === 0 || /^\s/.test(pieces[index])) count += 1;
  }
  return count;
}

/** The first `words` words of a decoded branch, as display text. */
function phraseOf(text, words) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, words)
    .join(' ');
}

async function continueFrom(text, options = {}) {
  await loadModel();
  return enqueue(async () => {
    const started = performance.now();
    const words = Math.min(Math.max(Number(options.words) || CONTINUATION.words, 1), 12);
    const branches = Math.min(Math.max(Number(options.branches) || CONTINUATION.branches, 1), 10);
    const maxTokens = Math.min(Math.max(Number(options.maxTokens) || CONTINUATION.maxTokens, words), 40);
    const contextChars = Math.min(Math.max(Number(options.contextChars) || CONTINUATION.contextChars, 40), 4000);

    // Same normalisation as scoring: a lone \r is unmodellable for GPT-2.
    const normalised = text.replace(/\r\n?/g, '\n');
    let context = normalised;
    if (context.length > contextChars) {
      // Start at a word boundary, so the prompt does not open mid-word.
      const cut = context.length - contextChars;
      const space = context.indexOf(' ', cut);
      context = context.slice(space === -1 ? cut : space + 1);
    }

    // Trailing whitespace is not cosmetic here. GPT-2's BPE folds a word
    // boundary into the *next* token, so a prompt ending in a space leaves the
    // model holding a bare "Ġ" — a state its training text never contains, since
    // documents are tokenised whole. Measured from a bare space, it answers with
    // the separator junk of its web corpus ("___________", "----") in 26% of
    // rows, and sensible prose in none of them. Dropping the space costs nothing:
    // the model then writes the word with its own leading space, which the
    // display trims anyway.
    context = context.replace(/\s+$/, '');

    const empty = {
      model: MODEL,
      contextTokens: 0,
      contextChars: context.length,
      steps: 0,
      rows: [],
      modelMs: 0,
      forwardMs: 0,
      forwardCalls: 0,
    };
    if (!context.trim()) return empty;

    const encoded = await tokenizer(context);
    const contextIds = Array.from(encoded.input_ids.data).map(Number);
    if (contextIds.length < 2) return { ...empty, contextTokens: contextIds.length };

    const eosId = tokenizer.eos_token_id ?? 50256;
    let forwardMs = 0;
    let forwardCalls = 0;

    // Rows are equal length by construction, so the batch needs no padding and
    // no attention-mask trickery: just a full rectangle of ones.
    const forward = async (rows) => {
      const width = rows[0].length;
      const inputIds = new Tensor(
        'int64',
        BigInt64Array.from(rows.flat().map((id) => BigInt(id))),
        [rows.length, width],
      );
      const attentionMask = new Tensor(
        'int64',
        BigInt64Array.from(rows.flatMap(() => new Array(width).fill(1n))),
        [rows.length, width],
      );
      const at = performance.now();
      const output = await model({ input_ids: inputIds, attention_mask: attentionMask });
      forwardMs += performance.now() - at;
      forwardCalls += 1;
      return output;
    };

    const seed = await forward([contextIds]);
    const vocab = seed.logits.dims.at(-1);
    // A few extra candidates, because a branch that opens with end-of-text has no
    // words to show: the model is saying the sentence stops here. Skipping it is
    // the honest way to keep five *phrases* — there is nothing to display.
    const { alternatives } = rankNext({
      logits: seed.logits.data,
      base: (contextIds.length - 1) * vocab,
      vocab,
      topK: branches + 4,
      decode: decodePiece,
    });

    const rows = alternatives
      .filter((alternative) => alternative.id !== eosId)
      .slice(0, branches)
      .map((alternative) => ({
        ids: [alternative.id],
        pieces: [alternative.text],
        bits: alternative.bits,
        done: false,
      }));

    let step = 1;
    while (step < maxTokens) {
      const active = rows.filter((row) => !row.done);
      if (active.length === 0) break;

      const width = contextIds.length + step;
      const output = await forward(active.map((row) => [...contextIds, ...row.ids]));

      for (let index = 0; index < active.length; index += 1) {
        const row = active[index];
        const { alternatives: ranked } = rankNext({
          logits: output.logits.data,
          base: (index * width + width - 1) * vocab,
          vocab,
          topK: 1,
          decode: decodePiece,
        });
        const next = ranked[0];
        const piece = decodePiece(next.id);
        // End of text ends the phrase: it is not part of what the model would
        // write, and its bits belong to no words.
        const ended = next.id === eosId;
        if (!ended) {
          row.ids.push(next.id);
          row.pieces.push(piece);
          row.bits += next.bits;
          row.done = startedWords(row.pieces) > words;
        } else {
          row.done = true;
        }
      }

      step += 1;
    }

    // Two branches can converge on the same words; keep the likelier spelling of
    // the two, and rank the survivors by the probability of the whole phrase.
    const seen = new Set();
    const results = [];
    for (const row of rows) {
      const phrase = phraseOf(tokenizer.decode(row.ids), words);
      const key = phrase.toLowerCase();
      if (!phrase || seen.has(key)) continue;
      seen.add(key);
      results.push({
        text: phrase,
        bits: row.bits,
        probability: 2 ** -row.bits,
        tokens: row.ids.length,
        words: phrase.split(' ').length,
      });
    }
    results.sort((a, b) => a.bits - b.bits);

    return {
      model: MODEL,
      contextTokens: contextIds.length,
      contextChars: context.length,
      steps: step,
      rows: results,
      modelMs: performance.now() - started,
      forwardMs,
      forwardCalls,
    };
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
          ...(typeof body.ignoreNames === 'boolean' ? { ignoreNames: body.ignoreNames } : {}),
        }),
      );
    } catch (error) {
      json(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  // Where the model would take the sentence next, five words deep.
  if (url.pathname === '/continue' && request.method === 'POST') {
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
    try {
      json(response, 200, await continueFrom(text, body));
    } catch (error) {
      console.error('continuation failed:', error);
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
      '  npm run model -- --continue "text"  five five-word continuations',
      '  npm run model -- --next "text"      same, with a wider context',
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
const onwards = flag('continue') ?? flag('next');

if (onwards !== undefined) {
  const context = flag('continue') !== undefined ? onwards : (file ? readFileSync(file, 'utf8') : onwards);
  const result = await continueFrom(context, {
    ...(Number.isFinite(Number(flag('words'))) ? { words: Number(flag('words')) } : {}),
    ...(Number.isFinite(Number(flag('branches'))) ? { branches: Number(flag('branches')) } : {}),
    ...(Number.isFinite(Number(flag('context'))) ? { contextChars: Number(flag('context')) } : {}),
  });
  console.log(
    `\n${result.model} — ${result.rows.length} continuations from ${result.contextTokens} tokens of context` +
      ` in ${Math.round(result.modelMs)} ms (${result.forwardCalls} forwards, ${Math.round(result.forwardMs)} ms)`,
  );
  console.log('\n   bits   next words');
  for (const row of result.rows) {
    console.log(`  ${row.bits.toFixed(2).padStart(5)}   ${JSON.stringify(row.text)}`);
  }
  process.exit(0);
}

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
  // The embeddings are a separate, lazily loaded model, and loading it takes
  // seconds. Without this the first /similarity call from a fresh server spends
  // that time in the request — which the app usually abandons when the text
  // changes under it, so the tool silently falls back to spelling suggestions.
  warmEmbeddings().catch((error) => console.error('embeddings failed to load:', error));
});
