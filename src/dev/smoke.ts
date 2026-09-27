/**
 * Headless smoke test for the analysis pipeline.
 *
 * Run with `npm run smoke`. It executes every registered tool against the
 * sample document, prints a short report, and asserts the engine invariants
 * that the view layer depends on:
 *
 *   1. segments tile the document exactly once, in order;
 *   2. every resolved annotation appears in at least one segment;
 *   3. layers inside a segment are ordered widest → narrowest.
 */
import { buildHeatmap, type HeatMetricId, type HeatSpan } from '../core/heatmap';
import { scoreWindow, summarise, surprisalScale } from '../core/surprisal';
import { surprisalTool } from '../tools/surprisal.tool';
import { runAnalysis } from '../core/engine';
import {
  computeMetrics,
  deviationColor,
  EASY_PERCENTILE,
  formatPercentile,
  formatZ,
  isFamiliarWord,
  MIN_COMPARABLE_WORDS,
  NOTABLE_PERCENTILE,
  percentileFromZ,
  POLYSYLLABLE_THRESHOLD,
  SATURATED_Z,
  zScore,
} from '../core/metrics';
import { parseHex } from '../core/color';
import { CLEAR_CORPUS } from '../core/data/corpus-norms';
import { SAMPLE_TEXT } from '../sample-text';
import { tools } from '../tools';
import type { Tool } from '../core/types';

const RULE = '─'.repeat(78);

function main(): void {
  const allEnabled = Object.fromEntries(tools.map((tool) => [tool.id, true]));
  const run = runAnalysis({ tools, text: SAMPLE_TEXT, enabled: allEnabled, options: {} });

  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  console.log(`\neztext smoke test — ${tools.length} tools, ${SAMPLE_TEXT.length} characters\n${RULE}`);

  for (const tool of tools) {
    const annotations = run.byToolAnnotations[tool.id] ?? [];
    const result = run.byTool[tool.id]?.result;

    console.log(`\n${tool.name}  (${tool.id}, ${annotations.length} annotations)`);
    for (const stat of result?.stats ?? []) {
      console.log(`   ${stat.label.padEnd(26)} ${String(stat.value).padStart(10)}  ${stat.hint ?? ''}`);
    }
    const sample = annotations.slice(0, 4).map((a) => `${JSON.stringify(a.text)} [${a.start}–${a.end}]`);
    if (sample.length > 0) console.log(`   first: ${sample.join(', ')}`);
  }

  console.log(`\n${RULE}\nDocument metrics`);
  const metrics = computeMetrics(SAMPLE_TEXT);
  const table: Array<[string, string]> = [
    ['Words', String(metrics.words)],
    ['Sentences', String(metrics.sentences)],
    ['Paragraphs', String(metrics.paragraphs)],
    ['Characters', String(metrics.characters)],
    ['Words / sentence', metrics.wordsPerSentence.toFixed(1)],
    ['Chars / word', metrics.charactersPerWord.toFixed(2)],
    ['% polysyllabic', `${(metrics.polysyllabicShare * 100).toFixed(1)}%`],
    ['% unfamiliar (Dale-Chall)', `${(metrics.unfamiliarShare * 100).toFixed(1)}%`],
    ['Syllables / word', metrics.syllablesPerWord.toFixed(2)],
  ];
  for (const [label, value] of table) console.log(`  ${label.padEnd(26)} ${value.padStart(8)}`);

  check(
    'metric counts match the sample document',
    metrics.words === 163 && metrics.sentences === 11 && metrics.paragraphs === 4 && metrics.characters === 1015,
    `${metrics.words} words / ${metrics.sentences} sentences / ${metrics.paragraphs} paragraphs / ${metrics.characters} characters`,
  );
  check(
    'counts and ratios are internally consistent',
    metrics.polysyllables <= metrics.words &&
      metrics.unfamiliarWords <= metrics.words &&
      metrics.letters <= metrics.characters &&
      metrics.wordsPerSentence > 0 &&
      metrics.charactersPerWord > 1 &&
      metrics.charactersPerWord < 15 &&
      metrics.syllablesPerWord > 1 &&
      metrics.syllablesPerWord < 4 &&
      metrics.polysyllabicShare > 0 &&
      metrics.polysyllabicShare < 1 &&
      metrics.unfamiliarShare > 0 &&
      metrics.unfamiliarShare < 1,
  );

  console.log('\n  familiarity rules (Dale-Chall):');
  const familiarity: Array<[string, boolean]> = [
    ['stop', true], // on the list
    ['stops', true], // plural of a listed word
    ['readers', true], // plural of a listed word
    ['quicker', true], // comparative
    ['quickest', true], // superlative
    ['stopping', true], // listed directly
    ["stop's", true], // possessive
    ['afternoon-tea', true], // hyphenated, both halves listed
    ['zygote', false],
    ['argument', false], // genuinely absent from the list
    ['arguments', false], // and its plural stays unfamiliar
  ];
  for (const [word, expected] of familiarity) {
    const actual = isFamiliarWord(word);
    check(`  ${word} → ${expected ? 'familiar' : 'unfamiliar'}`, actual === expected, actual !== expected ? `got ${actual}` : '');
  }

  console.log(`\n${RULE}\nCorpus comparison — ${CLEAR_CORPUS.name}, n=${CLEAR_CORPUS.n}`);
  const comparisons: Array<[string, number, keyof typeof CLEAR_CORPUS.metrics]> = [
    ['Words / sentence', metrics.wordsPerSentence, 'wordsPerSentence'],
    ['Chars / word', metrics.charactersPerWord, 'charactersPerWord'],
    ['% polysyllabic', metrics.polysyllabicShare, 'polysyllabicShare'],
    ['% unfamiliar', metrics.unfamiliarShare, 'unfamiliarShare'],
    ['Syllables / word', metrics.syllablesPerWord, 'syllablesPerWord'],
  ];
  for (const [label, value, key] of comparisons) {
    const norm = CLEAR_CORPUS.metrics[key];
    const z = zScore(value, norm);
    console.log(
      `  ${label.padEnd(18)} ${value.toFixed(3).padStart(7)}  corpus ${norm.mean.toFixed(4)} ± ${norm.sd.toFixed(4)}  ${z === null ? 'n/a' : `z ${formatZ(z).padStart(5)}`}`,
    );
  }

  const normValues = Object.entries(CLEAR_CORPUS.metrics);
  check(
    'corpus norms are populated and plausible',
    CLEAR_CORPUS.n > 4000 &&
      normValues.every(([, norm]) => norm.sd > 0 && Number.isFinite(norm.mean)) &&
      CLEAR_CORPUS.metrics.wordsPerSentence.mean > 10 &&
      CLEAR_CORPUS.metrics.wordsPerSentence.mean < 30 &&
      CLEAR_CORPUS.metrics.charactersPerWord.mean > 3 &&
      CLEAR_CORPUS.metrics.charactersPerWord.mean < 6 &&
      CLEAR_CORPUS.metrics.polysyllabicShare.mean > 0 &&
      CLEAR_CORPUS.metrics.polysyllabicShare.mean < 1 &&
      CLEAR_CORPUS.metrics.unfamiliarShare.mean > 0 &&
      CLEAR_CORPUS.metrics.unfamiliarShare.mean < 1 &&
      CLEAR_CORPUS.metrics.syllablesPerWord.mean > 1 &&
      CLEAR_CORPUS.metrics.syllablesPerWord.mean < 2,
    `${normValues.length} metrics with a mean and a spread`,
  );

  // The z-score must locate a value relative to the distribution it came from.
  // Compared with a tolerance: (mean + sd − mean) / sd lands on 0.9999999999999998
  // for some of these means, which is a fact about floats, not about the maths.
  const near = (actual: number | null, expected: number) => actual !== null && Math.abs(actual - expected) < 1e-9;
  check(
    'the corpus mean scores z = 0 and one sd scores z = 1',
    normValues.every(([, norm]) => near(zScore(norm.mean, norm), 0) && near(zScore(norm.mean + norm.sd, norm), 1)),
  );
  check(
    'z rises with the value and falls below the mean',
    normValues.every(([, norm]) =>
      near(zScore(norm.mean - norm.sd, norm), -1) &&
      near(zScore(norm.mean, norm), 0) &&
      near(zScore(norm.mean + norm.sd, norm), 1),
    ),
  );
  check(
    'a zero-spread norm yields no comparison',
    zScore(5, { mean: 5, sd: 0 }) === null && zScore(Number.NaN, { mean: 1, sd: 1 }) === null,
  );
  check('corpus covers real prose', CLEAR_CORPUS.wordsPerExcerpt.mean > 150 && CLEAR_CORPUS.wordsPerExcerpt.mean < 200,
    `${CLEAR_CORPUS.wordsPerExcerpt.mean} words per excerpt ± ${CLEAR_CORPUS.wordsPerExcerpt.sd}`);

  const sampleZs = comparisons.map(([, value, key]) => zScore(value, CLEAR_CORPUS.metrics[key])!);
  console.log(
    `  sample deviations: ${sampleZs.map((z) => `z ${formatZ(z)} (${formatPercentile(percentileFromZ(z))})`).join('  ')}`,
  );
  check(
    'every sample deviation is finite and unremarkable',
    sampleZs.every((z) => Number.isFinite(z) && Math.abs(z) < 5),
  );
  check(
    'sample sentences are shorter than the typical excerpt',
    sampleZs[0] < 0,
    `z ${formatZ(sampleZs[0])} on words/sentence`,
  );
  check(
    'sample words are longer than the typical excerpt',
    sampleZs[1] > 0,
    `z ${formatZ(sampleZs[1])} on chars/word`,
  );

  console.log('\n  z-score labelling:');
  check('  +1.42 → +1.4', formatZ(1.42) === '+1.4', formatZ(1.42));
  check('  −0.7 → −0.7', formatZ(-0.7) === '\u22120.7', formatZ(-0.7));
  check('  0 → 0.0', formatZ(0) === '0.0', formatZ(0));
  check('  −0.03 → 0.0 (never prints −0.0)', formatZ(-0.03) === '0.0', formatZ(-0.03));

  console.log('\n  normal-CDF percentile:');
  const closeTo = (actual: number, expected: number, tolerance = 0.01) => Math.abs(actual - expected) < tolerance;
  const percentage = (value: number) => `${value.toFixed(2)}%`;
  check('  Φ(0) = 50th', closeTo(percentileFromZ(0), 50), percentage(percentileFromZ(0)));
  check('  Φ(1) = 84.1st', closeTo(percentileFromZ(1), 84.13, 0.02), percentage(percentileFromZ(1)));
  check('  Φ(-1) = 15.9th', closeTo(percentileFromZ(-1), 15.87, 0.02), percentage(percentileFromZ(-1)));
  check('  Φ(1.96) = 97.5th', closeTo(percentileFromZ(1.96), 97.5, 0.02), percentage(percentileFromZ(1.96)));
  check(
    '  Φ(z) + Φ(−z) = 100 (symmetric)',
    [0.5, 1, 1.5, 2, 3].every((z) => closeTo(percentileFromZ(z) + percentileFromZ(-z), 100, 1e-6)),
  );
  check(
    '  monotonic in z',
    [-3, -2, -1, 0, 1, 2, 3]
      .map(percentileFromZ)
      .every((value, index, all) => index === 0 || value > all[index - 1]),
  );
  check(
    '  saturates at the tails rather than overflowing',
    percentileFromZ(-12) < 0.01 && percentileFromZ(12) > 99.99 && closeTo(percentileFromZ(-12), 0, 0.01),
    `Φ(−12) = ${percentage(percentileFromZ(-12))}, Φ(+12) = ${percentage(percentileFromZ(12))}`,
  );
  check(
    '  notable/easy bands sit inside the tails',
    NOTABLE_PERCENTILE > 90 &&
      NOTABLE_PERCENTILE < 100 &&
      EASY_PERCENTILE === 100 - NOTABLE_PERCENTILE &&
      closeTo(percentileFromZ(1.5), NOTABLE_PERCENTILE, 1),
    `notable ≥ ${formatPercentile(NOTABLE_PERCENTILE)}, easy ≤ ${formatPercentile(EASY_PERCENTILE)} (z ±1.5 = ${formatPercentile(percentileFromZ(1.5))})`,
  );
  check(
    '  short documents are excluded from comparison',
    MIN_COMPARABLE_WORDS === 20 && computeMetrics('Too short.').words < MIN_COMPARABLE_WORDS,
    `cut-off ${MIN_COMPARABLE_WORDS} words`,
  );

  console.log('\n  percentile labelling:');
  check('  1 → 1st', formatPercentile(1) === '1st', formatPercentile(1));
  check('  2 → 2nd', formatPercentile(2) === '2nd', formatPercentile(2));
  check('  3 → 3rd', formatPercentile(3) === '3rd', formatPercentile(3));
  check('  11 → 11th', formatPercentile(11) === '11th', formatPercentile(11));
  check('  24.4 → 24th', formatPercentile(24.4) === '24th', formatPercentile(24.4));
  check('  92.6 → 93rd', formatPercentile(92.6) === '93rd', formatPercentile(92.6));
  check('  0.2 → <1st', formatPercentile(0.2) === '<1st', formatPercentile(0.2));
  check('  99.9 → >99th', formatPercentile(99.9) === '>99th', formatPercentile(99.9));

  console.log('\n  deviation colour ramp:');
  const channel = (hex: string, index: number) => parseHex(hex)[index];
  // WCAG relative luminance, for the contrast guard below.
  const luminance = (hex: string) => {
    const linear = parseHex(hex).map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrastOnPaper = (hex: string) => 1.05 / (luminance(hex) + 0.05);

  // The ramp's exact hexes are theme values, so they are asserted as properties
  // instead — how the middle and the ends should behave — plus the one thing the
  // light theme requires of them: they are used as small text on white paper.
  check(
    '  neutral grey at the corpus mean',
    channel(deviationColor(0), 0) === channel(deviationColor(0), 1),
    deviationColor(0),
  );
  check(
    '  saturates green below and red above',
    channel(deviationColor(-SATURATED_Z), 1) > channel(deviationColor(-SATURATED_Z), 0) &&
      channel(deviationColor(SATURATED_Z), 0) > channel(deviationColor(SATURATED_Z), 1) &&
      channel(deviationColor(-SATURATED_Z), 1) > channel(deviationColor(0), 1) &&
      channel(deviationColor(SATURATED_Z), 0) > channel(deviationColor(0), 0),
    `${deviationColor(-SATURATED_Z)} … ${deviationColor(SATURATED_Z)}`,
  );
  check(
    '  warms as the deviation rises above the mean',
    channel(deviationColor(2.4), 0) > channel(deviationColor(1.7), 0) &&
      channel(deviationColor(1.7), 0) > channel(deviationColor(1), 0) &&
      channel(deviationColor(1), 0) > channel(deviationColor(0), 0),
    [1, 1.7, 2.4].map((z) => `z${z}=${deviationColor(z)}`).join(' '),
  );
  check(
    '  cools as the deviation falls below the mean',
    channel(deviationColor(-2.4), 1) > channel(deviationColor(-1.7), 1) &&
      channel(deviationColor(-1.7), 1) > channel(deviationColor(-1), 1) &&
      channel(deviationColor(-1), 1) > channel(deviationColor(0), 1),
    [-1, -1.7, -2.4].map((z) => `z${z}=${deviationColor(z)}`).join(' '),
  );
  check(
    '  saturates rather than running off the ramp',
    deviationColor(50) === deviationColor(SATURATED_Z) && deviationColor(-50) === deviationColor(-SATURATED_Z),
  );
  const ramp = Array.from({ length: 121 }, (_, index) => deviationColor(-3 + (index * 6) / 120));
  check('  every deviation yields a valid colour', ramp.every((hex) => /^#[0-9a-f]{6}$/.test(hex)));
  const worst = ramp.map(contrastOnPaper).reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  check(
    '  every deviation is legible as small text on paper',
    worst >= 4.5,
    `worst contrast ${worst.toFixed(2)}:1 (WCAG AA needs 4.5:1)`,
  );

  console.log(`\n${RULE}\nHeatmaps`);
  const heatIds: HeatMetricId[] = [
    'wordsPerSentence',
    'charactersPerWord',
    'polysyllabicShare',
    'unfamiliarShare',
    'syllablesPerWord',
  ];
  const heatmaps = new Map<HeatMetricId, HeatSpan[]>(heatIds.map((id) => [id, buildHeatmap(SAMPLE_TEXT, id)]));

  for (const id of heatIds) {
    const spans = heatmaps.get(id)!;
    const ordered = spans.every((span, index) => index === 0 || span.start >= spans[index - 1].end);
    const inBounds = spans.every(
      (span) => span.start >= 0 && span.end <= SAMPLE_TEXT.length && span.end > span.start,
    );
    const slices = spans.every((span) => SAMPLE_TEXT.slice(span.start, span.end) === span.text);
    const shades = spans.every((span) => span.intensity >= 0 && span.intensity <= 1);
    const units = new Set(spans.map((span) => span.unit));
    console.log(
      `  ${id.padEnd(18)} ${String(spans.length).padStart(4)} spans  unit=${[...units].join('/')}  intensity ${Math.min(...spans.map((s) => s.intensity)).toFixed(2)}…${Math.max(...spans.map((s) => s.intensity)).toFixed(2)}`,
    );
    check(
      `  ${id}: spans are ordered, in bounds and in shades`,
      ordered && inBounds && slices && shades && spans.length > 0,
      `${spans.length} spans`,
    );
  }

  // The heatmap and the metric must agree about the same document.
  const wordsPerSentence = heatmaps.get('wordsPerSentence')!;
  const charactersPerWord = heatmaps.get('charactersPerWord')!;
  const polysyllabic = heatmaps.get('polysyllabicShare')!;
  const unfamiliar = heatmaps.get('unfamiliarShare')!;
  const syllables = heatmaps.get('syllablesPerWord')!;

  check(
    'one span per sentence, valued in words',
    wordsPerSentence.length === metrics.sentences && wordsPerSentence.every((span) => span.unit === 'sentence'),
    `${wordsPerSentence.length} vs ${metrics.sentences} sentences`,
  );
  check(
    'one span per word, valued in letters',
    charactersPerWord.length === metrics.words &&
      charactersPerWord.reduce((sum, span) => sum + span.value, 0) === metrics.letters,
    `${charactersPerWord.length} words, ${charactersPerWord.reduce((sum, span) => sum + span.value, 0)} vs ${metrics.letters} letters`,
  );
  check(
    'polysyllabic shading only covers 3+ syllable words',
    polysyllabic.length === metrics.polysyllables &&
      polysyllabic.every((span) => span.value >= POLYSYLLABLE_THRESHOLD),
    `${polysyllabic.length} vs ${metrics.polysyllables} polysyllables`,
  );
  check(
    'unfamiliar shading matches the unfamiliar count',
    unfamiliar.length === metrics.unfamiliarWords &&
      unfamiliar.every((span) => !isFamiliarWord(span.text.toLowerCase())),
    `${unfamiliar.length} vs ${metrics.unfamiliarWords} unfamiliar`,
  );
  check(
    'syllable shading covers every word and sums to the total',
    syllables.length === metrics.words &&
      syllables.reduce((sum, span) => sum + span.value, 0) === metrics.syllables,
    `${syllables.length} words, ${syllables.reduce((sum, span) => sum + span.value, 0)} vs ${metrics.syllables} syllables`,
  );

  for (const id of heatIds.filter((metric) => metric !== 'unfamiliarShare')) {
    const intensities = heatmaps.get(id)!.map((span) => span.intensity);
    check(
      `  ${id}: strongest span is 1.0 and the weakest stays visible`,
      Math.max(...intensities) === 1 && Math.min(...intensities) <= 0.16,
      `${Math.min(...intensities).toFixed(2)}…${Math.max(...intensities).toFixed(2)}`,
    );
  }
  check(
    'unfamiliar shading is a flat colour',
    unfamiliar.every((span) => span.intensity === 1),
    `${unfamiliar.length} spans at 1.0`,
  );

  console.log('\n  edge cases:');
  check('  empty document yields no spans', heatIds.every((id) => buildHeatmap('', id).length === 0));
  check(
    '  one-word document yields a finite shade',
    heatIds.every((id) => {
      const spans = buildHeatmap('Zygote.', id);
      return spans.length === 0 || spans.every((span) => Number.isFinite(span.intensity) && span.intensity > 0);
    }),
  );
  check(
    '  a document with no polysyllables yields no spans',
    buildHeatmap('The cat sat on the mat and had fun.', 'polysyllabicShare').length === 0,
  );

  console.log(`\n${RULE}\nSurprisal scoring`);

  // A tiny synthetic vocabulary: 4 pieces where tokens 1 and 3 are cheap and
  // token 2 is the one the model did not expect.
  const probeVocab = 4;
  const pieces = ['A', ' B', ' C', ' D'];
  const probeIds = [0, 1, 2, 3];
  const probeLogits = new Float32Array(probeIds.length * probeVocab);
  const teach = (position: number, id: number, value: number) => {
    probeLogits[position * probeVocab + id] = value;
  };
  teach(0, 1, 8); // confident about " B"
  teach(1, 3, 8); // but at the next position it expects " D", not " C"
  teach(2, 3, 8); // confident about " D"

  const probeDecode = (id: number) => pieces[id] ?? '?';
  const scorable = () =>
    scoreWindow({
      logits: probeLogits,
      positions: probeIds.length,
      vocab: probeVocab,
      ids: probeIds,
      decode: probeDecode,
      topK: 5,
    });

  const tokens = scorable();
  check('the first token has no surprisal', tokens[0].bits === 0, `${tokens[0].bits}`);
  check('a predicted token costs almost nothing', tokens[1].bits < 0.01, `${tokens[1].bits.toFixed(4)} bits`);
  check(
    'an unexpected token costs a lot',
    tokens[2].bits > 10,
    `${tokens[2].bits.toFixed(2)} bits for " C" where the model wanted " D"`,
  );
  check(
    'the surprise is quantified as a gain for the expected token',
    tokens[2].alternatives[0].text === ' D' && Math.abs(tokens[2].alternatives[0].gain - tokens[2].bits) < 0.01,
    `" D" would have saved ${tokens[2].alternatives[0].gain.toFixed(2)} bits (p=${tokens[2].alternatives[0].probability.toFixed(3)})`,
  );
  check(
    'alternatives are ranked by probability',
    tokens[2].alternatives.every(
      (alternative, index, all) => index === 0 || alternative.probability <= all[index - 1].probability,
    ),
  );

  const summary = summarise(tokens, 'A B C D', 'test-model');
  check(
    'subword pieces fold into words with exact offsets',
    summary.offsetsExact && summary.words.length === 4 && summary.words[2].text === ' C',
    `${summary.words.map((word) => `"${word.text}"`).join(' ')}`,
  );
  check('a word carries the expectation for its piece', summary.words[2].expected?.text === 'D', summary.words[2].expected?.text);
  check(
    'word and token summaries agree',
    summary.tokens.length === 3 && summary.meanBits > 3 && summary.maxBits === summary.words[2].bits,
    `mean ${summary.meanBits.toFixed(2)} bits/token, max ${summary.maxBits.toFixed(2)} bits/word`,
  );

  // Regression: `Number(undefined)` is NaN, and a NaN k made the ranking loop's
  // early-out never fire, growing the candidate arrays to the whole vocabulary.
  console.log('\n  guards:');
  const nanK = scoreWindow({
    logits: probeLogits,
    positions: probeIds.length,
    vocab: probeVocab,
    ids: probeIds,
    decode: probeDecode,
    topK: Number.NaN,
  });
  check(
    'a NaN topK falls back instead of ranking the whole vocabulary',
    nanK.every((token) => token.alternatives.length <= 5),
    `alternatives per token: ${nanK.map((token) => token.alternatives.length).join(', ')}`,
  );
  const zeroK = scoreWindow({
    logits: probeLogits,
    positions: probeIds.length,
    vocab: probeVocab,
    ids: probeIds,
    decode: probeDecode,
    topK: 0,
  });
  check(
    'a zero topK still yields one alternative',
    zeroK.every((token) => token.index === 0 || token.alternatives.length >= 1),
  );
  check(
    'intensity is clamped and scales linearly',
    surprisalScale(0, 10) === 0 &&
      Math.abs(surprisalScale(5, 10) - 0.5) < 1e-9 &&
      surprisalScale(10, 10) === 1 &&
      surprisalScale(999, 10) === 1 &&
      surprisalScale(5, 0) === 0,
  );

  console.log(`\n${RULE}\nSurprisal tool`);

  const toolText = 'A B C D';
  const toolIds = [0, 1, 2, 3];
  const toolPieces = ['A', ' B', ' C', ' D'];
  const toolLogits = new Float32Array(toolIds.length * probeVocab);
  toolLogits[0 * probeVocab + 1] = 8;
  toolLogits[1 * probeVocab + 3] = 8;
  toolLogits[2 * probeVocab + 3] = 8;
  const toolDecode = (id: number) => toolPieces[id] ?? '?';
  const scoredTokens = scoreWindow({
    logits: toolLogits,
    positions: toolIds.length,
    vocab: probeVocab,
    ids: toolIds,
    decode: toolDecode,
    topK: 4,
  });
  const scoredAll = summarise(scoredTokens, toolText, 'test-model');

  const runTool = (signals?: { surprisal?: typeof scoredAll; surprisalText?: string }, options = {}) =>
    surprisalTool.run({ text: toolText, options, signals });

  const unscored = runTool();
  check(
    'without signals the tool reports status instead of failing',
    (unscored.annotations ?? []).length === 0 && unscored.stats?.[0].value === 'Not scored yet',
    `${unscored.stats?.[0].label}: ${unscored.stats?.[0].value}`,
  );

  const staleResult = runTool({ surprisal: scoredAll, surprisalText: 'something else entirely' });
  check(
    'scores for a different document are refused',
    (staleResult.annotations ?? []).length === 0 && staleResult.stats?.[0].value === 'Text changed',
    `${staleResult.stats?.[0].value} / ${staleResult.stats?.[0].hint}`,
  );

  const scored = runTool({ surprisal: scoredAll, surprisalText: toolText });
  const annotations = scored.annotations ?? [];
  check(
    'a scored document yields one shaded annotation per word',
    annotations.length === 4 && annotations[0].start === 0 && annotations[3].end === toolText.length,
    `${annotations.length} annotations covering ${annotations.map((a) => `"${a.label}"`).join(' ')}`,
  );
  check(
    'every annotation is shaded on one red hue',
    annotations.every((annotation) => annotation.color === '#c00000'),
    [...new Set(annotations.map((a) => a.color))].join(' '),
  );
  check(
    'opacity carries the magnitude: the surprising word is the most opaque',
    // Range only loosely asserted — the floor and cap are tuning knobs; what
    // must hold is that opacity is monotonic in surprisal and never zero.
    annotations.every((annotation) => typeof annotation.alpha === 'number' && annotation.alpha > 0 && annotation.alpha <= 0.9) &&
      annotations[2].alpha! > Math.max(annotations[0].alpha!, annotations[1].alpha!, annotations[3].alpha!),
    annotations.map((a) => `${a.label}=${a.alpha!.toFixed(2)}`).join(' '),
  );
  check(
    'the detail names the word the model expected',
    (annotations[2].detail ?? '').includes('“D”'),
    annotations[2].detail,
  );
  check(
    'stats summarise the run',
    (scored.stats ?? []).some((stat) => stat.id === 'surprisal.mean') &&
      (scored.stats ?? []).some((stat) => stat.id === 'surprisal.offenders' && String(stat.value).includes('C')),
    (scored.stats ?? []).map((stat) => `${stat.label}=${stat.value}`).join('  '),
  );

  // Only surprising words when asked.
  const onlySurprising = runTool({ surprisal: scoredAll, surprisalText: toolText }, { shade: 'surprising', notable: 5 });
  check(
    'the “only surprising words” option filters the shading',
    (onlySurprising.annotations ?? []).length === 1 && onlySurprising.annotations?.[0].label === 'C',
    `${(onlySurprising.annotations ?? []).map((a) => a.label).join(', ')} (${(onlySurprising.annotations ?? []).length} of 4 words above 5 bits)`,
  );

  // The engine must honour a tool's per-annotation colour.
  const withTool = runAnalysis({
    tools: [surprisalTool],
    text: toolText,
    enabled: { surprisal: true },
    options: {},
    signals: { surprisal: scoredAll, surprisalText: toolText },
  });
  check(
    'the engine carries per-annotation colours and opacities',
    withTool.annotations.length === 4 &&
      withTool.annotations.every((annotation) => annotation.color !== surprisalTool.color && annotation.alpha !== undefined),
    `${withTool.annotations.length} annotations, tool colour ${surprisalTool.color}, opacities ${withTool.annotations.map((a) => a.alpha?.toFixed(2)).join(' ')}`,
  );
  const withoutSignals = runAnalysis({
    tools: [surprisalTool],
    text: toolText,
    enabled: { surprisal: true },
    options: {},
  });
  check(
    'the engine runs a signal-hungry tool without signals',
    withoutSignals.annotations.length === 0 && withoutSignals.stats.length > 0,
    `${withoutSignals.stats.length} stat card(s)`,
  );
  check(
    'the tool declares what it needs',
    (surprisalTool.requires ?? []).includes('surprisal'),
    (surprisalTool.requires ?? []).join(', ') || '(nothing declared)',
  );

  console.log(`\n${RULE}\nOverlap & invariants`);
  const distinctLayerCounts = new Map<number, number>();
  for (const segment of run.segments) {
    distinctLayerCounts.set(segment.layers.length, (distinctLayerCounts.get(segment.layers.length) ?? 0) + 1);
  }
  console.log(
    `  layer stacks: ${[...distinctLayerCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([layers, count]) => `${layers} layer${layers === 1 ? '' : 's'} × ${count}`)
      .join(', ')}`,
  );

  const rebuilt = run.segments.map((segment) => segment.text).join('');
  check('segments tile the document exactly', rebuilt === SAMPLE_TEXT, `${rebuilt.length} vs ${SAMPLE_TEXT.length} characters`);

  const covered = new Set<string>();
  let orderingOk = true;
  for (const segment of run.segments) {
    for (let i = 1; i < segment.layers.length; i += 1) {
      const previous = segment.layers[i - 1];
      const current = segment.layers[i];
      if (previous.end - previous.start < current.end - current.start) orderingOk = false;
      if (previous.start > current.start) orderingOk = false;
    }
    for (const layer of segment.layers) covered.add(layer.id);
  }
  check('layers ordered widest → narrowest', orderingOk);

  const missing = run.annotations.filter((annotation) => !covered.has(annotation.id));
  check('every annotation is rendered', missing.length === 0, missing.slice(0, 3).map((a) => a.id).join(', '));

  const ids = new Set(run.annotations.map((annotation) => annotation.id));
  check('annotation ids are unique', ids.size === run.annotations.length);

  // A tool that throws must degrade to a diagnostic instead of taking the app down.
  const faultyTool: Tool = {
    id: 'faulty',
    name: 'Faulty',
    description: 'Always throws.',
    category: 'utility',
    color: '#f2767c',
    run() {
      throw new Error('boom');
    },
  };
  const faulty = runAnalysis({ tools: [faultyTool], text: SAMPLE_TEXT, enabled: { faulty: true }, options: {} });
  const diagnostics = faulty.notes.filter((entry) => entry.note.tone === 'bad');
  check(
    'a throwing tool degrades to a diagnostic',
    diagnostics.length === 1 && diagnostics[0].note.text.includes('boom'),
    diagnostics[0]?.note.text,
  );
  check('a throwing tool does not break the run', faulty.annotations.length === 0 && faulty.segments.length === 1);

  console.log(`\n  ${run.annotations.length} annotations → ${run.segments.length} segments in ${run.elapsedMs.toFixed(1)} ms`);
  console.log(`  ${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
