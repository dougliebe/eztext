import { surprisalScale, type ScoredWord } from '../core/surprisal';
import type { AnnotationDraft, Stat, Tool } from '../core/types';

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/**
 * Surprisal is shaded on a transparent → red ramp: the hue is constant and the
 * *opacity* carries the magnitude, so the page stays readable and only the hard
 * words pull the eye. The red tracks `--bad` in the theme (#c00000).
 */
const SHADE_COLOR = '#c00000';
const SHADE_MIN_ALPHA = 0.06;
const SHADE_MAX_ALPHA = 0.85;

/**
 * Opacity curve. The exponent matters more than it looks: word surprisal is
 * concentrated in the middle of its own distribution, so a linear map leaves the
 * median word ~40% red and the page still reads as a wall of colour. Bending the
 * curve keeps ordinary prose nearly clean and lets the genuinely hard words be
 * the only thing that pulls the eye.
 */
const SHADE_EXPONENT = 2.2;

/** Map a word's position on the document's scale to an opacity. */
function shadeAlpha(scale: number): number {
  return SHADE_MIN_ALPHA + (SHADE_MAX_ALPHA - SHADE_MIN_ALPHA) * scale ** SHADE_EXPONENT;
}

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
        // Transparent → red: hue fixed, opacity by magnitude. The engine hands
        // both through, and the renderer uses `alpha` instead of guessing.
        color: SHADE_COLOR,
        alpha: shadeAlpha(surprisalScale(word.bits, reference)),
        data: { bits: word.bits, gain: word.expected?.gain ?? 0, tokenCount: word.tokenCount },
      });
    }

    const top = worst.slice(0, 6);
    const stats: Stat[] = [
      { id: 'surprisal.mean', label: 'Mean bits / token', value: round(scores.meanBits, 2), tone: 'accent' },
      {
        id: 'surprisal.perplexity',
        label: 'Perplexity',
        value: round(2 ** scores.meanBits, 1),
        hint: `at ${scores.tokens.length} tokens`,
      },
      { id: 'surprisal.meanWord', label: 'Mean bits / word', value: round(scores.meanWordBits, 2) },
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

    return { annotations, stats };

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
