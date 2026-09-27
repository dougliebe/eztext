import { maxMixForContrast, mixHex } from '../core/color';
import { CLEAR_SURPRISAL_NORMS, type SurprisalNorm } from '../core/data/surprisal-norms';
import { describeNorm, percentileFromZ, zScore } from '../core/metrics';
import { surprisalScale, type ScoredWord } from '../core/surprisal';
import type { AnnotationDraft, Stat, StatComparison, Tool } from '../core/types';

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/**
 * Where a value sits against the same model on the CLEAR corpus.
 *
 * Guards on the model id: these norms describe GPT-2's expectations, so comparing
 * a document scored by some other model against them would be meaningless.
 * Returns undefined (no chip) rather than a wrong number.
 */
function againstCorpus(value: number, norm: SurprisalNorm, model: string, label: string): StatComparison | undefined {
  if (model !== CLEAR_SURPRISAL_NORMS.model) return undefined;
  const z = zScore(value, norm);
  if (z === null) return undefined;
  return {
    percentile: percentileFromZ(z),
    z,
    description: `${label}: ${CLEAR_SURPRISAL_NORMS.model} on CLEAR, ${describeNorm(norm, { n: CLEAR_SURPRISAL_NORMS.n })}`,
  };
}

/**
 * Surprisal is shaded with **opaque mixes from the page to red** — not alpha.
 *
 * Two reasons. It keeps the highlight legible by construction: the rendered
 * colour is exactly the colour we measured, rather than a blend of red with
 * whatever happens to be underneath. And an opaque colour composes: the same
 * spans can later be laid over one another with `multiply` (or an additive
 * `screen`) and the result still means something, which translucent reds would
 * not.
 *
 * These must track the light theme's tokens.
 */
const SHADE_PAPER = '#ffffff'; // --bg-1, the pane the preview renders on
const SHADE_TARGET = '#c00000'; // --bad
const SHADE_INK = '#1b1b1b'; // --text, the ink the preview actually uses

/** WCAG AA for body text — the preview runs at 13px. */
const SHADE_MIN_CONTRAST = 4.5;

/**
 * The furthest the ramp may go: ≈0.645, i.e. #d65b5b, where the ink falls to
 * 4.52:1. Derived rather than hardcoded so it stays true if the theme's paper,
 * red or ink changes. (Against `--text-strong` #000 the same search reaches
 * 0.747 → #d04141; black ink would buy a deeper red if that is ever wanted.)
 */
const SHADE_MAX_MIX = maxMixForContrast(SHADE_PAPER, SHADE_TARGET, SHADE_INK, SHADE_MIN_CONTRAST);

/**
 * Fraction of the available ramp for a word, 0–1.
 *
 * The exponent matters as much as the endpoints: word surprisal clusters in the
 * middle of its own distribution, so a linear map puts the median word halfway
 * to the cap and the page reads as a wall of colour. Bending the curve keeps
 * ordinary prose nearly clean and lets the hard words do the pointing.
 */
const SHADE_EXPONENT = 2.2;

function shadeColor(scale: number): string {
  return mixHex(SHADE_PAPER, SHADE_TARGET, SHADE_MAX_MIX * scale ** SHADE_EXPONENT);
}

const SUMMARY =
  'Surprisal is how many bits the model needed to predict each word — a close proxy for reading ' +
  'effort. High-surprisal words are where a plainer word or a clearer setup pays off.';

const GROUP_DESCRIPTIONS: Record<string, string> = {
  high:
    'The hardest tenth of the words in this document. These cost the reader the most; consider a ' +
    'plainer word or giving the idea more setup.',
  medium: 'Mid-frequency words: predictable enough to skim, still carrying information.',
  low: 'Words the model expected. They keep the sentence moving without asking the reader for effort.',
};

/**
 * Language-model surprisal.
 *
 * Shades every word by `−log₂ P(word | everything before it)` and reports what
 * the model expected instead. The model itself runs in a separate local process
 * (`npm run model`) — this tool only reads the scores, so it stays a pure
 * function and the engine stays synchronous.
 *
 * When the document has not been scored yet (or has been edited since), the tool
 * degrades to a single status card rather than throwing: `signals` is simply
 * absent, and the Run control in the input pane is what fills it.
 */
export const surprisalTool: Tool = {
  id: 'surprisal',
  name: 'Surprisal',
  description:
    'How many bits the language model needed to predict each word, and the word it expected instead.',
  category: 'readability',
  color: '#7b6cf6',
  defaultEnabled: true,
  requires: ['surprisal'],
  options: [
    {
      kind: 'select',
      id: 'shade',
      label: 'Shade',
      default: 'all',
      choices: [
        { value: 'all', label: 'Every word' },
        { value: 'surprising', label: 'Only surprising words' },
      ],
    },
    {
      kind: 'number',
      id: 'notable',
      label: '“Surprising” above (bits)',
      default: 8,
      min: 1,
      max: 40,
      step: 1,
      hint: 'Used for the group filter and for “only surprising words”.',
    },
  ],

  run({ text, options, signals }) {
    const notableBits = Number(options.notable ?? 8);
    const onlySurprising = String(options.shade ?? 'all') === 'surprising';
    const scores = signals?.surprisal;
    const scoredText = signals?.surprisalText;

    if (!scores || scoredText !== text) {
      return {
        stats: [
          {
            id: 'surprisal.status',
            label: 'Status',
            value: scoredText && scoredText !== text ? 'Text changed' : 'Not scored yet',
            hint: scoredText && scoredText !== text ? 'Press Run again' : 'Press Run',
            tone: 'warn',
          },
        ],
        summary: SUMMARY,
        groupDescriptions: GROUP_DESCRIPTIONS,
      };
    }

    const reference = scores.quantiles.p90 || 1;
    const words = scores.words.filter((word) => word.text.trim().length > 0);
    const worst = [...words].sort((a, b) => b.bits - a.bits);
    const notable = words.filter((word) => word.bits >= notableBits);
    const high = words.filter((word) => word.bits >= scores.quantiles.p90).length;

    const annotations: AnnotationDraft[] = [];
    for (const word of words) {
      if (onlySurprising && word.bits < notableBits) continue;
      annotations.push({
        start: word.start,
        end: word.end,
        label: cleanWord(word),
        group: word.bits >= scores.quantiles.p90 ? 'high' : word.bits >= scores.quantiles.p50 ? 'medium' : 'low',
        detail: describe(word),
        // Paper → red, opaque: the mix is the rendered colour, and `alpha: 1`
        // tells the renderer not to blend it with anything.
        color: shadeColor(surprisalScale(word.bits, reference)),
        alpha: 1,
        data: { bits: word.bits, gain: word.expected?.gain ?? 0, tokenCount: word.tokenCount },
      });
    }

    const top = worst.slice(0, 6);
    const stats: Stat[] = [
      {
        id: 'surprisal.mean',
        label: 'Mean bits / token',
        value: round(scores.meanBits, 2),
        tone: 'accent',
        comparison: againstCorpus(scores.meanBits, CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken, scores.model, 'bits per token'),
      },
      {
        id: 'surprisal.perplexity',
        label: 'Perplexity',
        value: round(2 ** scores.meanBits, 1),
        hint: `at ${scores.tokens.length} tokens`,
        comparison: againstCorpus(2 ** scores.meanBits, CLEAR_SURPRISAL_NORMS.metrics.perplexity, scores.model, 'perplexity'),
      },
      {
        id: 'surprisal.meanWord',
        label: 'Mean bits / word',
        value: round(scores.meanWordBits, 2),
        comparison: againstCorpus(scores.meanWordBits, CLEAR_SURPRISAL_NORMS.metrics.bitsPerWord, scores.model, 'bits per word'),
      },
      {
        id: 'surprisal.max',
        label: 'Most surprising',
        value: top[0] ? cleanWord(top[0]) : '—',
        hint: top[0] ? `${round(top[0].bits, 2)} bits` : undefined,
        tone: 'warn',
      },
      { id: 'surprisal.notable', label: 'Words over threshold', value: notable.length, hint: `≥ ${notableBits} bits` },
      { id: 'surprisal.high', label: 'Top-decile words', value: high, hint: `≥ p90 = ${round(scores.quantiles.p90, 2)} bits` },
      {
        id: 'surprisal.offenders',
        label: 'Hardest words',
        value: top.length > 0 ? top.map(cleanWord).join(', ') : '—',
      },
      {
        id: 'surprisal.model',
        label: 'Model',
        value: scores.model.replace(/^\w+\//, ''),
        hint: `${scores.tokens.length} tokens${scores.chunked ? ', windowed' : ''}`,
      },
    ];

    return { annotations, stats, summary: SUMMARY, groupDescriptions: GROUP_DESCRIPTIONS };

    function cleanWord(word: ScoredWord): string {
      return word.text.trim();
    }

    function describe(word: ScoredWord): string {
      const bits = `${round(word.bits, 2)} bits`;
      if (!word.expected) return `${cleanWord(word)} — ${bits}; the model expected exactly this.`;
      return (
        `${cleanWord(word)} — ${bits}. The model expected “${word.expected.text}” instead, ` +
        `worth ${round(word.expected.gain, 2)} bits.`
      );
    }
  },
};
