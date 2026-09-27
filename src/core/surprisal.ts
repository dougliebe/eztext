/**
 * Language-model surprisal.
 *
 * Surprisal is `−log₂ P(token | everything before it)`: how many bits the model
 * needed to encode what was actually written. It is the strongest cheap signal
 * for "where is this hard" — human reading times track it closely, and it needs
 * no hand-written rules about what counts as a difficult word.
 *
 * The weights never run here. A *local* companion process (`npm run model`)
 * holds the model in native ONNX Runtime and this module owns the arithmetic,
 * so both sides share one implementation: the server bundles this file with
 * esbuild, exactly like `scripts/build-corpus-norms.mjs` bundles `metrics.ts`.
 *
 * Two outputs, both from a single forward pass over the document:
 *
 *   1. **Surprisal per word** — summed over the word's subword tokens, since a
 *      word's probability is the product of its pieces.
 *   2. **Perturbation gain** — how many bits *cheaper* the model's own preferred
 *      token would have been at that position. Large gain means the model saw an
 *      obvious alternative: the reader's expectation was pulled one way and the
 *      text went another. This is a first-order (local) measure — it asks what
 *      the best substitution would have saved at that position, not how the
 *      rest of the sentence would have re-flowed.
 */

/** One candidate the model ranked above or near what was written. */
export interface SurprisalAlternative {
  /** Raw piece, which may carry a leading space (GPT-2 encodes word boundaries as spaces). */
  text: string;
  /** `−log₂ P` of this piece at this position. */
  bits: number;
  /** `P` of this piece at this position, 0–1. */
  probability: number;
  /** Bits saved had this piece been written instead. */
  gain: number;
}

export interface ScoredToken {
  /** Position in the token sequence (token 0 has no surprisal — nothing precedes it). */
  index: number;
  text: string;
  /** Character offsets into the document. */
  start: number;
  end: number;
  /** `−log₂ P(token | prefix)`. */
  bits: number;
  alternatives: SurprisalAlternative[];
}

export interface ScoredWord {
  text: string;
  start: number;
  end: number;
  /** Sum of the word's token surprisals — the surprisal of spelling this word here. */
  bits: number;
  tokenCount: number;
  /**
   * The model's preferred piece at this word's highest-gain position, and what
   * taking it would have saved. Absent when the model already expected the word.
   */
  expected?: {
    /** Cleaned for display: no leading space. */
    text: string;
    /** Bits saved by writing this instead. */
    gain: number;
    probability: number;
    /** Index of the token within `tokens` that this alternative competes with. */
    tokenIndex: number;
  };
}

export interface SurprisalScores {
  model: string;
  tokens: ScoredToken[];
  words: ScoredWord[];
  /** Mean bits per token — the standard summary of a text under a model. */
  meanBits: number;
  /** Mean bits per word, friendlier for a readability tool. */
  meanWordBits: number;
  maxBits: number;
  /** Word-bit quantiles, so the UI can shade without one outlier flattening the ramp. */
  quantiles: { p50: number; p75: number; p90: number; p99: number };
  /**
   * False when concatenating the decoded pieces did not reproduce the document,
   * which would mean the offsets are unreliable (non-UTF-8 input, mainly).
   */
  offsetsExact: boolean;
  /** Set by the scoring process when the document needed more than one window. */
  chunked?: boolean;
}

const LN2 = Math.LN2;

/** Strip a leading space from a piece so alternatives read as words. */
export function cleanPiece(piece: string): string {
  return piece.replace(/^\s+/, '');
}

/**
 * Score one forward pass.
 *
 * `logits` is `[batch, positions, vocab]` and position `i` holds the
 * distribution over token `i + 1`, so every token after the first gets a
 * surprisal. Pure: no tensors, no model, no I/O — just arithmetic over the
 * logits the server hands over.
 *
 * Long documents are split into windows by the caller (see `scripts/model-server.mjs`),
 * so `indexOffset` lets a window report tokens at their true global index.
 */
export function scoreWindow(input: {
  /** Raw logits, row-major `[1, positions, vocab]`. */
  logits: Float32Array | number[];
  positions: number;
  vocab: number;
  ids: number[];
  /** Piece for any token id — cached by the caller if it is expensive. */
  decode: (id: number) => string;
  /** Global index of this window's first token. */
  indexOffset?: number;
  /** How many alternatives to keep per position. */
  topK?: number;
}): ScoredToken[] {
  const { logits, positions, vocab, ids, decode, indexOffset = 0 } = input;
  // Guard the NaN that `Number(undefined)` produces — with a NaN k the ranking
  // loop's early-out never fires and the candidate arrays grow to the whole
  // vocabulary, which turns one forward pass into minutes of work.
  const requestedK = input.topK;
  const topK = typeof requestedK === 'number' && Number.isFinite(requestedK) ? Math.max(1, Math.floor(requestedK)) : 5;
  const scorable = Math.min(positions, ids.length - 1);

  const tokens: ScoredToken[] = [];
  const bestIds: number[] = [];
  const bestValues: number[] = [];

  for (let local = 0; local < ids.length; local += 1) {
    const index = indexOffset + local;
    const piece = decode(ids[local]);

    // The first token of the whole document has no context, so it has no
    // surprisal. Within a window, token 0 is either that token or a context
    // token that an earlier window already scored.
    let bits = 0;
    let alternatives: SurprisalAlternative[] = [];

    if (local > 0 && local <= scorable) {
      const base = (local - 1) * vocab;

      let max = -Infinity;
      for (let v = 0; v < vocab; v += 1) {
        const value = logits[base + v];
        if (value > max) max = value;
      }
      let sum = 0;
      for (let v = 0; v < vocab; v += 1) sum += Math.exp(logits[base + v] - max);
      const logZ = max + Math.log(sum);

      const logProbability = logits[base + ids[local]] - logZ;
      bits = -logProbability / LN2;

      // Top-k in a single pass, keeping the best ids in descending order.
      bestIds.length = 0;
      bestValues.length = 0;
      for (let v = 0; v < vocab; v += 1) {
        const value = logits[base + v];
        // Cheap rejection: with k candidates held, nothing worse can enter.
        if (bestValues.length === topK && value <= bestValues[topK - 1]) continue;
        let at = bestValues.length;
        while (at > 0 && bestValues[at - 1] < value) at -= 1;
        bestValues.splice(at, 0, value);
        bestIds.splice(at, 0, v);
        if (bestValues.length > topK) {
          bestValues.pop();
          bestIds.pop();
        }
      }

      alternatives = bestIds.map((id, rank) => {
        const candidateLogProbability = bestValues[rank] - logZ;
        return {
          text: decode(id),
          bits: -candidateLogProbability / LN2,
          probability: Math.exp(candidateLogProbability),
          gain: (candidateLogProbability - logProbability) / LN2,
        };
      });
    }

    // Offsets are filled in by `summarise`, which knows the whole document.
    tokens.push({ index, text: piece, start: -1, end: -1, bits, alternatives });
  }

  return tokens;
}

/**
 * Fold subword pieces into words and compute the summary figures.
 *
 * Character offsets are derived here by walking the pieces, because
 * concatenating a byte-level BPE decode reproduces the document exactly — this
 * is what lets a word taken from the model line up with the app's own
 * tokenizer.
 */
export function summarise(tokens: ScoredToken[], text: string, model: string): SurprisalScores {
  let cursor = 0;
  for (const token of tokens) {
    token.start = cursor;
    cursor += token.text.length;
    token.end = cursor;
  }

  const words = groupIntoWords(tokens, text);
  const scored = tokens.filter((token) => token.index > 0);
  const wordBits = words.map((word) => word.bits).sort((a, b) => a - b);
  const quantile = (q: number) =>
    wordBits.length === 0 ? 0 : wordBits[Math.min(wordBits.length - 1, Math.floor(q * wordBits.length))];

  return {
    model,
    tokens: scored,
    words,
    meanBits: scored.length === 0 ? 0 : scored.reduce((sum, token) => sum + token.bits, 0) / scored.length,
    meanWordBits: words.length === 0 ? 0 : words.reduce((sum, word) => sum + word.bits, 0) / words.length,
    maxBits: words.reduce((max, word) => Math.max(max, word.bits), 0),
    quantiles: { p50: quantile(0.5), p75: quantile(0.75), p90: quantile(0.9), p99: quantile(0.99) },
    offsetsExact: cursor === text.length,
  };
}

/**
 * Fold subword pieces into words.
 *
 * GPT-2 marks a word boundary with a leading space, so a piece that does not
 * start with whitespace continues the previous word. Punctuation that hugs a
 * word (`mat.`) stays with it — the alternative is inventing word boundaries the
 * model never saw.
 */
export function groupIntoWords(tokens: ScoredToken[], text: string): ScoredWord[] {
  const words: ScoredWord[] = [];

  for (const token of tokens) {
    const startsWord = words.length === 0 || /^\s/.test(token.text);

    if (startsWord) {
      words.push({
        text: text.slice(token.start, token.end),
        start: token.start,
        end: token.end,
        bits: token.bits,
        tokenCount: 1,
      });
    } else {
      const word = words[words.length - 1];
      word.end = token.end;
      word.text = text.slice(word.start, word.end);
      word.bits += token.bits;
      word.tokenCount += 1;
    }

    // Record the word's best substitution: the largest gain among its pieces,
    // skipping the piece the model itself ranked first (that has zero gain).
    const best = token.alternatives[0];
    if (!best || best.gain <= 0) continue;
    const word = words[words.length - 1];
    if (!word.expected || best.gain > word.expected.gain) {
      word.expected = {
        text: cleanPiece(best.text),
        gain: best.gain,
        probability: best.probability,
        tokenIndex: token.index,
      };
    }
  }

  return words;
}

/**
 * Where a word sits on the document's own surprisal scale, 0–1, clipped at the
 * reference (the corpus of comparison is the text in front of you, not the
 * language at large).
 *
 * Deliberately a raw ratio with no floor: the renderer turns it into opacity, and
 * "no surprise at all" should mean "no shade at all".
 */
export function surprisalScale(bits: number, reference: number): number {
  if (!(reference > 0)) return 0;
  return Math.max(0, Math.min(1, bits / reference));
}
