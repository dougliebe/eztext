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
import { CLEAR_SURPRISAL_NORMS } from '../core/data/surprisal-norms';
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
import { contrastRatio, maxMixForContrast, mixHex, parseHex, relativeLuminance } from '../core/color';
import { CLEAR_CORPUS } from '../core/data/corpus-norms';
import { DALE_CHALL_WORDS } from '../core/data/dale-chall';
import { daleChallTool, suggestFamiliarWords, type WordSuggestion } from '../tools/dale-chall.tool';
import type { SimilaritySignal } from '../core/similarity';
import type { AnnotationDraft } from '../core/types';
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
  // WCAG contrast, shared with the surprisal ramp (core/color.ts).
  const contrastOnPaper = (hex: string) => contrastRatio(hex, "#ffffff");


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

  // The corpus comparison is guarded on the model id, so the synthetic scores
  // have to claim the same model to exercise it. The guard itself is tested
  // below, with a mismatched id.
  const matchingModel = { ...scoredAll, model: CLEAR_SURPRISAL_NORMS.model };
  const scored = runTool({ surprisal: matchingModel, surprisalText: toolText });
  const annotations = scored.annotations ?? [];
  check(
    'a scored document yields one shaded annotation per word',
    annotations.length === 4 && annotations[0].start === 0 && annotations[3].end === toolText.length,
    `${annotations.length} annotations covering ${annotations.map((a) => `"${a.label}"`).join(' ')}`,
  );
  check(
    'every annotation is shaded on the paper → red ramp',
    annotations.every((annotation) => {
      const [r, g, b] = parseHex(annotation.color!);
      // A mix of #ffffff toward #c00000: green and blue stay equal and fall
      // together while red stays high.
      return g === b && r >= 192 && g <= 255;
    }) && new Set(annotations.map((a) => a.color)).size > 1,
    annotations.map((a) => `${a.label}=${a.color}`).join(' '),
  );
  check(
    'shading is opaque, so the rendered colour is the one we measured',
    annotations.every((annotation) => annotation.alpha === 1),
    annotations.map((a) => `${a.label}=${a.alpha}`).join(' '),
  );
  check(
    'the hardest word is the darkest, and the easiest is the palest',
    relativeLuminance(annotations[2].color!) < Math.min(relativeLuminance(annotations[0].color!), relativeLuminance(annotations[1].color!), relativeLuminance(annotations[3].color!)),
    annotations.map((a) => `${a.label} L=${relativeLuminance(a.color!).toFixed(3)}`).join(' '),
  );

  // The requirement that set the ramp's ceiling: dark ink stays legible.
  const darkest = annotations.reduce((worst, annotation) =>
    relativeLuminance(annotation.color!) < relativeLuminance(worst.color!) ? annotation : worst,
  );
  const contrast = contrastRatio(darkest.color!, '#1b1b1b');
  check(
    'the darkest shade still clears WCAG AA under the preview ink',
    contrast >= 4.5,
    `${darkest.color} vs #1b1b1b = ${contrast.toFixed(2)}:1`,
  );

  console.log('\n  contrast helpers:');
  check('  white on black is 21:1', Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.01, contrastRatio('#ffffff', '#000000').toFixed(3));
  check(
    '  the preview ink on paper matches the theme',
    Math.abs(contrastRatio('#ffffff', '#1b1b1b') - 17.22) < 0.02,
    `${contrastRatio('#ffffff', '#1b1b1b').toFixed(2)}:1`,
  );
  check(
    '  the cap lands where the ink reaches 4.5:1',
    // Binary search must sit just inside the limit: below it by a hair at the
    // cap, above it one step further on.
    contrastRatio(mixHex('#ffffff', '#c00000', maxMixForContrast('#ffffff', '#c00000', '#1b1b1b')), '#1b1b1b') >= 4.5 &&
      contrastRatio(mixHex('#ffffff', '#c00000', maxMixForContrast('#ffffff', '#c00000', '#1b1b1b') + 0.02), '#1b1b1b') < 4.5,
    `cap = ${maxMixForContrast('#ffffff', '#c00000', '#1b1b1b').toFixed(4)} → ${mixHex('#ffffff', '#c00000', maxMixForContrast('#ffffff', '#c00000', '#1b1b1b'))}`,
  );
  check(
    '  a stricter minimum gives a shallower cap',
    maxMixForContrast('#ffffff', '#c00000', '#1b1b1b', 7) < maxMixForContrast('#ffffff', '#c00000', '#1b1b1b', 4.5),
    `7:1 → ${maxMixForContrast('#ffffff', '#c00000', '#1b1b1b', 7).toFixed(3)}, 4.5:1 → ${maxMixForContrast('#ffffff', '#c00000', '#1b1b1b', 4.5).toFixed(3)}`,
  );
  check(
    '  luminance is monotonic in the mix',
    [0, 0.25, 0.5, 0.75, 1].map((t) => relativeLuminance(mixHex('#ffffff', '#c00000', t))).every((value, index, all) => index === 0 || value < all[index - 1]),
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

  // The three model figures carry a percentile against the CLEAR corpus, so a
  // document can be placed against real prose.
  const compared = (scored.stats ?? []).filter((stat) => stat.comparison);
  check(
    'the model stats carry a corpus percentile',
    compared.length === 3 &&
      compared.every(
        (stat) =>
          stat.comparison!.percentile > 0 &&
          stat.comparison!.percentile < 100 &&
          Number.isFinite(stat.comparison!.z) &&
          stat.comparison!.description.includes('CLEAR'),
      ),
    compared
      .map((stat) => `${stat.label}: ${formatPercentile(stat.comparison!.percentile)} (z ${formatZ(stat.comparison!.z)})`)
      .join('  '),
  );
  check(
    'the comparison names the model and the population',
    compared[0].comparison!.description.includes(CLEAR_SURPRISAL_NORMS.model) &&
      compared[0].comparison!.description.includes(`n=${CLEAR_SURPRISAL_NORMS.n.toLocaleString('en-US')}`),
    compared[0].comparison!.description,
  );
  check(
    'percentile and z agree with the corpus figures',
    (() => {
      const stat = (scored.stats ?? []).find((entry) => entry.id === 'surprisal.mean')!;
      const norm = CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken;
      const expectedZ = (scoredAll.meanBits - norm.mean) / norm.sd;
      return Math.abs(stat.comparison!.z - expectedZ) < 1e-9;
    })(),
  );

  // Guard: the norms describe one model, so a different one gets no chip.
  const otherModel = surprisalTool.run({
    text: toolText,
    options: {},
    signals: { surprisal: { ...scoredAll, model: 'someone/else' }, surprisalText: toolText },
  });
  check(
    'scores from another model are not compared against these norms',
    (otherModel.stats ?? []).every((stat) => stat.comparison === undefined),
    `${(otherModel.stats ?? []).filter((stat) => stat.comparison).length} chips shown for someone/else`,
  );
  check(
    'the shipped norms match the model the app asks for',
    CLEAR_SURPRISAL_NORMS.n > 4000 &&
      CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken.sd > 0 &&
      CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken.mean > 3 &&
      CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken.mean < 8 &&
      CLEAR_SURPRISAL_NORMS.metrics.perplexity.mean > 10 &&
      CLEAR_SURPRISAL_NORMS.metrics.perplexity.mean < 200 &&
      CLEAR_SURPRISAL_NORMS.metrics.bitsPerWord.mean > 3 &&
      CLEAR_SURPRISAL_NORMS.metrics.bitsPerWord.mean < 10,
    `${CLEAR_SURPRISAL_NORMS.n} excerpts: ${CLEAR_SURPRISAL_NORMS.metrics.bitsPerToken.mean.toFixed(2)} bits/token, ` +
      `perplexity ${CLEAR_SURPRISAL_NORMS.metrics.perplexity.mean.toFixed(1)}, ` +
      `${CLEAR_SURPRISAL_NORMS.metrics.bitsPerWord.mean.toFixed(2)} bits/word`,
  );
  check(
    'the norms record which model produced them',
    CLEAR_SURPRISAL_NORMS.model.length > 0 && CLEAR_SURPRISAL_NORMS.modelFile.length > 0,
    `${CLEAR_SURPRISAL_NORMS.model} / ${CLEAR_SURPRISAL_NORMS.modelFile}`,
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

  console.log(`\n${RULE}\nDale-Chall tool`);

  // The tool exists to explain the topbar's % unfamiliar, so the two counts must
  // agree exactly in the default configuration.
  const metricsForText = computeMetrics(SAMPLE_TEXT);
  const daleChallRun = daleChallTool.run({ text: SAMPLE_TEXT, options: {} });
  const daleChall = daleChallRun.annotations ?? [];
  const suggestionsOf = (annotation: (typeof daleChall)[number]): WordSuggestion[] =>
    (annotation.data?.suggestions ?? []) as WordSuggestion[];
  const coveredOf = (annotation: (typeof daleChall)[number]) => SAMPLE_TEXT.slice(annotation.start, annotation.end);
  check(
    'highlights exactly what % unfamiliar counts',
    daleChall.length === metricsForText.unfamiliarWords,
    `${daleChall.length} annotations vs metric ${metricsForText.unfamiliarWords}`,
  );
  check(
    'every highlighted word really is unfamiliar',
    daleChall.every((annotation) => !isFamiliarWord(coveredOf(annotation))),
    `${daleChall.length} checked`,
  );
  check(
    'groups are the suggestion relations plus “no match”',
    daleChall.every((annotation) =>
      ['base form', 'shorter form', 'similar meaning', 'close spelling', 'no match'].includes(
        annotation.group ?? '',
      ),
    ),
    [...new Set(daleChall.map((annotation) => annotation.group))].join(', '),
  );

  // The promise of the feature: a suggestion is a word that is on the list.
  const allSuggestions = daleChall.flatMap(suggestionsOf);
  check(
    'every suggestion is on the Dale-Chall list',
    allSuggestions.every((suggestion) => DALE_CHALL_WORDS.has(suggestion.word)),
    `${allSuggestions.length} suggestions offered`,
  );
  check(
    'nothing is suggested for itself',
    daleChall.every((annotation) =>
      suggestionsOf(annotation).every((suggestion) => suggestion.word !== coveredOf(annotation).toLowerCase()),
    ),
  );
  check(
    'a suggestion list is never longer than the requested cap',
    daleChall.every((annotation) => suggestionsOf(annotation).length <= 4),
  );
  // Per annotation, not across the flattened list: families must come first.
  check(
    'family matches outrank spelling matches',
    daleChall.every((annotation) => {
      const list = suggestionsOf(annotation);
      const firstSpelling = list.findIndex((suggestion) => suggestion.relation === 'close spelling');
      return firstSpelling === -1 || list.slice(firstSpelling).every((s) => s.relation === 'close spelling');
    }),
    daleChall.filter((annotation) => suggestionsOf(annotation)[0]?.relation !== 'close spelling' && suggestionsOf(annotation).length > 0).length +
      ' words led by a family match',
  );
  check(
    'every suggestion carries a relation and a score in range',
    allSuggestions.every(
      (suggestion) =>
        ['base form', 'shorter form', 'close spelling'].includes(suggestion.relation) &&
        suggestion.similarity > 0 &&
        suggestion.similarity <= 1,
    ),
  );

  // Word-family matches are the useful half, so name the ones that must work.
  // (Expectations were checked against the list itself: "enormous" is not on it,
  // which is exactly why the tool reports no suggestion for it.)
  const familyCases: Array<[string, string]> = [
    ['reshaping', 'shape'],
    ['writers', 'write'],
    ['passage', 'pass'],
    ['unhappiness', 'happiness'],
    ['unhappiness', 'unhappy'],
  ];
  const familyMisses = familyCases.filter(
    ([word, expected]) => !suggestFamiliarWords(word, { limit: 6 }).some((s) => s.word === expected),
  );
  check(
    'derived forms point back at their base word',
    familyMisses.length === 0,
    familyMisses.length > 0
      ? familyMisses.map(([word, expected]) => `${word} → ${expected}`).join(', ')
      : familyCases.map(([word]) => word).join(', '),
  );

  // A word with no near neighbour must say so rather than invent one.
  check(
    'a word with no listed neighbour suggests nothing',
    suggestFamiliarWords('enormous').length === 0 && suggestFamiliarWords('nevertheless').length === 0,
    `enormous: ${suggestFamiliarWords('enormous').length}, nevertheless: ${suggestFamiliarWords('nevertheless').length}`,
  );
  check(
    'match strength filters the spelling matches',
    suggestFamiliarWords('merely', { minSimilarity: 0.45 }).length >
      suggestFamiliarWords('merely', { minSimilarity: 0.75 }).length,
    `loose ${suggestFamiliarWords('merely', { minSimilarity: 0.45 }).length} vs strict ${suggestFamiliarWords('merely', { minSimilarity: 0.75 }).length}`,
  );
  check(
    'the suggestion cap is honoured, including zero',
    suggestFamiliarWords('merely', { limit: 1 }).length <= 1 && suggestFamiliarWords('merely', { limit: 0 }).length === 0,
  );

  // The options are meant to change the result, and `show` must not change what
  // the stats call unfamiliar — only what is highlighted.
  const fixableRun = daleChallTool.run({ text: SAMPLE_TEXT, options: { show: 'fixable' } });
  check(
    '“only words with a match” hides the rest',
    (fixableRun.annotations ?? []).length > 0 &&
      (fixableRun.annotations ?? []).length < daleChall.length &&
      (fixableRun.annotations ?? []).every((annotation) => annotation.group !== 'no match'),
    `${(fixableRun.annotations ?? []).length} of ${daleChall.length} shown`,
  );
  check(
    'the stats still describe the whole document',
    fixableRun.stats?.find((stat) => stat.id === 'dale-chall.words')?.value === metricsForText.unfamiliarWords,
    `Unfamiliar words: ${fixableRun.stats?.find((stat) => stat.id === 'dale-chall.words')?.value}`,
  );

  const namesRun = daleChallTool.run({ text: SAMPLE_TEXT, options: { ignoreNames: true } });
  const namesStat = namesRun.stats?.find((stat) => stat.id === 'dale-chall.names');
  check(
    'the name filter is reported, not silent',
    namesStat !== undefined &&
      (namesRun.annotations ?? []).length + Number(namesStat.value) === daleChall.length,
    `${namesStat?.label ?? '(missing)'}: ${namesStat?.value}`,
  );

  // The sample happens to have no mid-sentence capitals, so drive the two cases
  // the filter is meant to separate: a name inside a sentence is skipped, the
  // same word opening a sentence is not (that is just orthography).
  const nameProbe = 'The manager, Zoltan, revised everything.';
  const wordAt = (run: { annotations?: AnnotationDraft[] }, start: number) =>
    run.annotations?.find((annotation) => annotation.start === start) !== undefined;
  const nameStart = nameProbe.indexOf('Zoltan');
  const keptByDefault = daleChallTool.run({ text: nameProbe, options: {} });
  const skippedByName = daleChallTool.run({ text: nameProbe, options: { ignoreNames: true } });
  const openingProbe = daleChallTool.run({ text: 'Zoltan revised everything.', options: { ignoreNames: true } });
  check(
    'the name filter skips a mid-sentence capital only',
    wordAt(keptByDefault, nameStart) &&
      !wordAt(skippedByName, nameStart) &&
      wordAt(openingProbe, 0) &&
      skippedByName.stats?.find((stat) => stat.id === 'dale-chall.names')?.value === 1,
    `mid-sentence kept=${wordAt(keptByDefault, nameStart)}, skipped=${!wordAt(skippedByName, nameStart)}, sentence-initial kept=${wordAt(openingProbe, 0)}`,
  );
  check(
    'asking for no suggestions still highlights the words',
    (() => {
      const none = daleChallTool.run({ text: SAMPLE_TEXT, options: { suggestions: 0 } });
      const annotations = none.annotations ?? [];
      return (
        annotations.length === daleChall.length &&
        annotations.every(
          (annotation) => annotation.group === 'no match' && suggestionsOf(annotation).length === 0,
        )
      );
    })(),
    'every word falls into “no match”',
  );

  const sampleSuggestions = daleChall.filter((annotation) => suggestionsOf(annotation).length > 0);
  console.log(
    `  sample: ${daleChall.length} flagged, ${sampleSuggestions.length} with a match — ` +
      sampleSuggestions
        .slice(0, 4)
        .map((annotation) => `${coveredOf(annotation)}→${suggestionsOf(annotation)[0]?.word}`)
        .join(', '),
  );

  // --- the embedding signal, driven by a stand-in so this runs without a model
  console.log('\n  meaning suggestions (stand-in signal):');
  const fakeSimilarity: SimilaritySignal = {
    model: 'test/bge-stand-in',
    words: {
      enormous: [
        { word: 'huge', score: 0.96 },
        { word: 'large', score: 0.88 },
        { word: 'notonlist', score: 0.99 },
      ],
      merely: [{ word: 'just', score: 0.83 }],
      passage: [{ word: 'journey', score: 0.9 }],
      patience: [{ word: 'hurry', score: 0.66 }],
    },
  };
  const semanticRun = daleChallTool.run({ text: SAMPLE_TEXT, options: {}, signals: { similarity: fakeSimilarity } });
  const semanticAnnotations = semanticRun.annotations ?? [];
  const suggestionsForWord = (list: AnnotationDraft[], word: string) => {
    const annotation = list.find((entry) => SAMPLE_TEXT.slice(entry.start, entry.end).toLowerCase() === word);
    return ((annotation?.data?.suggestions ?? []) as WordSuggestion[]).map((s) => `${s.word}/${s.relation}`);
  };
  check(
    'the signal becomes “similar meaning” suggestions',
    suggestionsForWord(semanticAnnotations, 'enormous').includes('huge/similar meaning'),
    suggestionsForWord(semanticAnnotations, 'enormous').join(', ') || '(none)',
  );
  check(
    'the signal cannot smuggle in a word that is not on the list',
    !suggestionsForWord(semanticAnnotations, 'enormous').some((entry) => entry.startsWith('notonlist')),
    suggestionsForWord(semanticAnnotations, 'enormous').join(', '),
  );
  check(
    'meaning replaces the spelling guess once the model has answered',
    suggestionsForWord(semanticAnnotations, 'merely').includes('just/similar meaning') &&
      !suggestionsForWord(semanticAnnotations, 'merely').some((entry) => entry.endsWith('/close spelling')),
    suggestionsForWord(semanticAnnotations, 'merely').join(', '),
  );
  check(
    'word family still outranks meaning',
    suggestionsForWord(semanticAnnotations, 'passage')[0] === 'pass/base form',
    suggestionsForWord(semanticAnnotations, 'passage').join(', '),
  );
  check(
    'the panel names the model that answered',
    semanticRun.stats?.find((stat) => stat.id === 'dale-chall.source')?.value === 'bge-stand-in',
    String(semanticRun.stats?.find((stat) => stat.id === 'dale-chall.source')?.value),
  );
  check(
    'match strength filters the meaning matches too',
    suggestFamiliarWords('patience', {
      semantic: fakeSimilarity.words.patience,
      semanticFloor: 0.62,
    }).some((suggestion) => suggestion.word === 'hurry') &&
      !suggestFamiliarWords('patience', {
        semantic: fakeSimilarity.words.patience,
        semanticFloor: 0.75,
      }).some((suggestion) => suggestion.word === 'hurry'),
    'hurry at 0.66: kept at balanced, dropped at strict',
  );
  check(
    'without the signal the panel says so',
    daleChallRun.stats?.find((stat) => stat.id === 'dale-chall.source')?.value === 'spelling only',
    String(daleChallRun.stats?.find((stat) => stat.id === 'dale-chall.source')?.value),
  );
  check(
    'the detail sentence groups family, meaning and spelling',
    /base word/.test(String(semanticAnnotations.find((a) => SAMPLE_TEXT.slice(a.start, a.end).toLowerCase() === 'passage')?.detail)) &&
      /closer in meaning/.test(String(semanticAnnotations.find((a) => SAMPLE_TEXT.slice(a.start, a.end).toLowerCase() === 'passage')?.detail)),
    String(semanticAnnotations.find((a) => SAMPLE_TEXT.slice(a.start, a.end).toLowerCase() === 'passage')?.detail),
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
