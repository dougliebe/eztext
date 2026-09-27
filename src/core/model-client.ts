/**
 * Client for the local surprisal model.
 *
 * The model runs in its own process (`npm run model`, proxied by Vite at
 * `/api/model`) so it can use native ONNX Runtime. Everything here is ordinary
 * `fetch` against that process — there is no cloud service involved, and if the
 * process is not running these calls fail fast with a message the UI can act on.
 */
import type { SemanticNeighbour, SimilaritySignal } from './similarity';
import type { SurprisalScores } from './surprisal';

export interface ModelHealth {
  ready: boolean;
  loading: boolean;
  model: string;
  modelFile: string;
  cacheDir: string;
}

/** Where the Run control points. Overridable so the proxy can move. */
export const MODEL_ENDPOINT = '/api/model';

export class ModelOfflineError extends Error {
  constructor() {
    super('The local model process is not reachable. Start it with `npm run model`.');
    this.name = 'ModelOfflineError';
  }
}

/** Is the model process up, and has it finished loading weights? */
export async function checkHealth(signal?: AbortSignal): Promise<ModelHealth | null> {
  try {
    const response = await fetch(`${MODEL_ENDPOINT}/health`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as ModelHealth;
  } catch {
    return null;
  }
}

/**
 * Score a document. Throws `ModelOfflineError` when the process is not running.
 */
export async function scoreText(
  text: string,
  options: { topK?: number; signal?: AbortSignal } = {},
): Promise<SurprisalScores & { modelMs: number }> {
  let response: Response;
  try {
    response = await fetch(`${MODEL_ENDPOINT}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, topK: options.topK }),
      signal: options.signal,
    });
  } catch (error) {
    // A dead process and a dropped connection look the same to fetch, and both
    // mean the same thing to the user.
    throw new ModelOfflineError();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Model returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return (await response.json()) as SurprisalScores & { modelMs: number };
}

/**
 * Nearest familiar words by meaning, for every unfamiliar word in `text`.
 *
 * Returns `null` rather than throwing when the process is not running: this is
 * an *upgrade* on the spelling-based suggestions a tool can always compute, so
 * its absence is a normal state, not an error the user needs to see.
 */
export async function fetchSimilarity(
  text: string,
  options: { k?: number; signal?: AbortSignal } = {},
): Promise<SimilaritySignal | null> {
  if (!text.trim()) return null;

  try {
    const response = await fetch(`${MODEL_ENDPOINT}/similarity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, k: options.k }),
      signal: options.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { model?: string; words?: Record<string, SemanticNeighbour[]> };
    if (!payload.words || typeof payload.words !== 'object') return null;
    return { model: payload.model ?? 'unknown', words: payload.words };
  } catch {
    return null;
  }
}
