/**
 * The local language model, shared by the model server and the norms generator.
 *
 * Native ONNX Runtime in Node, not the browser: several times faster than the
 * WebAssembly build, and it keeps the weights out of the browser cache and out
 * of the app bundle. The scoring arithmetic itself lives in
 * `src/core/surprisal.ts` and is bundled in, so the process and the app share
 * one implementation.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AutoModelForCausalLM, AutoTokenizer, Tensor, env } from '@huggingface/transformers';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_MODEL = process.env.MODEL ?? 'Xenova/gpt2';
export const DEFAULT_MODEL_FILE = process.env.MODEL_FILE ?? 'decoder_model_merged_quantized';

/** Cached inside the project so the weights are visible and removable. */
env.cacheDir = resolve(ROOT, '.models', 'transformers');
env.allowLocalModels = true;

/** GPT-2 was trained on 1024 positions. */
const CONTEXT = 1024;

async function loadCore() {
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
  return core;
}

/**
 * Load the model once and hand back a scorer.
 *
 * `score` is serialised behind a promise chain so two callers never run a
 * forward pass at the same time — the ONNX session is not re-entrant, and the
 * event loop would otherwise interleave them.
 */
export async function createScorer(options = {}) {
  const modelId = options.model ?? DEFAULT_MODEL;
  const modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;

  const { scoreWindow, summarise } = await loadCore();

  const started = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForCausalLM.from_pretrained(modelId, { model_file_name: modelFile });
  const loadMs = performance.now() - started;

  const pieceCache = new Map();
  const decodePiece = (id) => {
    let piece = pieceCache.get(id);
    if (piece === undefined) {
      piece = tokenizer.decode([id]);
      pieceCache.set(id, piece);
    }
    return piece;
  };

  let queue = Promise.resolve();
  const enqueue = (task) => {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  async function score(text, topK = 5) {
    return enqueue(async () => {
      const started = performance.now();

      // Line endings: GPT-2 was trained on \n, so a lone \r is essentially
      // unmodellable (50+ bits) and would pollute every paragraph break.
      const normalised = text.replace(/\r\n?/g, '\n');

      // Tokenise once and window over the *ids*. Re-tokenising a substring would
      // not give the same pieces at the boundary, and character counts are not
      // token counts — both mistakes score the wrong text.
      const input = await tokenizer(normalised);
      const ids = Array.from(input.input_ids.data).map(Number);

      const tokens = [];
      let chunked = false;
      let forwardMs = 0;

      for (let start = 0; start < ids.length; start += CONTEXT - 1) {
        // One token of left context so the window's first real token is scored
        // with a full history rather than as a sentence opening.
        const windowStart = start === 0 ? 0 : start - 1;
        const windowIds = ids.slice(windowStart, start + CONTEXT);
        if (windowIds.length < 2) break;
        if (start + CONTEXT < ids.length) chunked = true;

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

      const scores = summarise(tokens, normalised, modelId);
      return { ...scores, chunked, modelMs: performance.now() - started, forwardMs };
    });
  }

  return { score, modelId, modelFile, loadMs, cacheDir: env.cacheDir };
}
