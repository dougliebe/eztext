/**
 * String distance, and the shape of the neighbours the model process returns.
 *
 * The edit distance here is no longer used to *suggest* words: spelling
 * resemblance turned out to be the wrong signal for "words a reader knows"
 * ("merely" → "merry", "defenestration" → "deforestation"), and meaning comes
 * from embeddings instead. What remains is measurement — how much of the flagged
 * word a word-family match accounts for, so "brutal" scores higher against
 * "brutalist" than "brute" does — plus the shared types for the semantic signal.
 */

/**
 * Levenshtein distance, with an early exit.
 *
 * `limit` caps the work: a row whose smallest cell already exceeds the limit
 * cannot come back under it, so the search stops and reports `limit + 1`.
 * Suggestions only care about distances below roughly 40% of a word's length,
 * and that bail-out is what keeps a whole-document run cheap.
 */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  let previous = Array.from({ length: short.length + 1 }, (_, index) => index);
  let current = new Array<number>(short.length + 1);

  for (let row = 1; row <= long.length; row += 1) {
    current[0] = row;
    let rowMin = row;
    const from = long.charCodeAt(row - 1);

    for (let column = 1; column <= short.length; column += 1) {
      const substitution = short.charCodeAt(column - 1) === from ? 0 : 1;
      const value = Math.min(
        previous[column] + 1, // deletion
        current[column - 1] + 1, // insertion
        previous[column - 1] + substitution,
      );
      current[column] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > limit) return limit + 1;
    [previous, current] = [current, previous];
  }

  return previous[short.length];
}

/**
 * Similarity in 0..1: one minus the edit distance over the longer word.
 * Returns 0 when the distance exceeds `limit`, so callers can cut off cheaply.
 */
export function similarity(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;

  const distance = editDistance(a, b, limit);
  return distance > limit ? 0 : 1 - distance / longest;
}

/* ------------------------------------------------------------------ */
/* Semantic neighbours, as delivered by the local model process        */
/* ------------------------------------------------------------------ */

/** One "means something like this" neighbour of a word. */
export interface SemanticNeighbour {
  word: string;
  /** Cosine similarity, 0–1. Roughly: >0.8 is a synonym, 0.62 is the floor. */
  score: number;
}

/**
 * Neighbours keyed by the word they describe.
 *
 * Keying by word rather than by document is deliberate: the embedding of a word
 * does not depend on where it appears, so the app can accumulate these as the
 * text changes instead of throwing them away on every keystroke, and a lookup is
 * a plain object access.
 */
export interface SimilaritySignal {
  /** The embedding model that produced these, for the UI to name. */
  model: string;
  /** The prevalence threshold the neighbours were ranked against. */
  threshold: number;
  words: Record<string, SemanticNeighbour[]>;
}

/**
 * Merge fresh neighbours into what we already know; new answers win.
 *
 * A different threshold means a different vocabulary — the neighbours it allows
 * are a different set — so the old answers are dropped rather than mixed in.
 */
export function mergeSimilarity(
  previous: SimilaritySignal | null,
  next: SimilaritySignal,
): SimilaritySignal {
  if (!previous || previous.threshold !== next.threshold) return next;
  return { model: next.model, threshold: next.threshold, words: { ...previous.words, ...next.words } };
}
