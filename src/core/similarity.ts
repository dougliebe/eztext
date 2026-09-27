/**
 * Spelling similarity, for suggesting words a reader is more likely to know.
 *
 * Deliberately string-based: eztext carries no thesaurus, no embeddings and no
 * runtime dependencies, so "similar" here means *close in letters or in word
 * family*. Tools that use this must say so rather than implying a synonym
 * dictionary — the honest promise is "the nearest words that are on the list",
 * and the reader judges whether the meaning survives.
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

/**
 * How many leading characters two words share.
 *
 * A shared opening is what makes a spelling match feel related rather than
 * accidental ("enormous"/"enormously" share eight, "merely"/"merry" two), so
 * callers use this as a floor before offering a spelling suggestion.
 */
export function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
}
