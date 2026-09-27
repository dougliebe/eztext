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
import { runAnalysis } from '../core/engine';
import {
  computeMetrics,
  EASY_PERCENTILE,
  formatPercentile,
  isFamiliarWord,
  MIN_COMPARABLE_WORDS,
  NOTABLE_PERCENTILE,
  percentileColor,
  percentileOf,
  POLYSYLLABLE_THRESHOLD,
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
    const percentile = percentileOf(value, norm);
    console.log(
      `  ${label.padEnd(18)} ${value.toFixed(3).padStart(7)}  corpus ${norm.mean.toFixed(4)} ± ${norm.sd.toFixed(4)}  ${percentile === null ? 'n/a' : `${formatPercentile(percentile).padStart(6)} (p${percentile.toFixed(1)})`}`,
    );
  }

  const normValues = Object.entries(CLEAR_CORPUS.metrics);
  check(
    'corpus norms are populated and plausible',
    CLEAR_CORPUS.n > 4000 &&
      normValues.every(
        ([, norm]) =>
          norm.sd > 0 &&
          Number.isFinite(norm.mean) &&
          Array.isArray(norm.quantiles) &&
          norm.quantiles.length === 101,
      ) &&
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
    `${normValues.length} metrics with mean, sd and 101 quantiles`,
  );
  check(
    'quantiles ascend and bracket the mean',
    normValues.every(([, norm]) => {
      const ascending = norm.quantiles.every((value, index) => index === 0 || value >= norm.quantiles[index - 1]);
      return ascending && norm.quantiles[0] <= norm.mean && norm.mean <= norm.quantiles[100];
    }),
  );

  // The percentile lookup must agree with the distribution it came from.
  const medianMatches = normValues.every(([, norm]) => {
    const atMedian = percentileOf(norm.quantiles[50], norm);
    return atMedian !== null && Math.abs(atMedian - 50) < 0.5;
  });
  check('the corpus median scores as the 50th percentile', medianMatches);
  check(
    'percentile lookup is monotonic in value',
    normValues.every(([, norm]) => {
      const low = percentileOf(norm.quantiles[10], norm)!;
      const mid = percentileOf(norm.quantiles[50], norm)!;
      const high = percentileOf(norm.quantiles[90], norm)!;
      return low < mid && mid < high;
    }),
  );
  check(
    'values beyond the corpus range clamp to 0 and 100',
    normValues.every(([, norm]) =>
      percentileOf(norm.quantiles[0] - 1, norm) === 0 && percentileOf(norm.quantiles[100] + 1, norm) === 100),
  );
  check('corpus covers real prose', CLEAR_CORPUS.wordsPerExcerpt.mean > 150 && CLEAR_CORPUS.wordsPerExcerpt.mean < 200,
    `${CLEAR_CORPUS.wordsPerExcerpt.mean} words per excerpt ± ${CLEAR_CORPUS.wordsPerExcerpt.sd}`);

  const samplePercentiles = comparisons.map(([, value, key]) => percentileOf(value, CLEAR_CORPUS.metrics[key])!);
  console.log(`  sample percentiles: ${samplePercentiles.map((p) => formatPercentile(p)).join(' ')}`);
  check(
    'every sample percentile is finite and inside the corpus range',
    samplePercentiles.every((p) => Number.isFinite(p) && p >= 0 && p <= 100),
  );
  check(
    'sample sentences are shorter than the typical excerpt',
    samplePercentiles[0] < 50,
    `${formatPercentile(samplePercentiles[0])} on words/sentence`,
  );
  check(
    'sample words are longer than the typical excerpt',
    samplePercentiles[1] > 50,
    `${formatPercentile(samplePercentiles[1])} on chars/word`,
  );

  console.log('\n  percentile labelling:');
  check('  1 → 1st', formatPercentile(1) === '1st', formatPercentile(1));
  check('  2 → 2nd', formatPercentile(2) === '2nd', formatPercentile(2));
  check('  3 → 3rd', formatPercentile(3) === '3rd', formatPercentile(3));
  check('  11 → 11th', formatPercentile(11) === '11th', formatPercentile(11));
  check('  24.4 → 24th', formatPercentile(24.4) === '24th', formatPercentile(24.4));
  check('  92.6 → 93rd', formatPercentile(92.6) === '93rd', formatPercentile(92.6));
  check('  0 → <1st', formatPercentile(0) === '<1st', formatPercentile(0));
  check('  100 → >99th', formatPercentile(100) === '>99th', formatPercentile(100));
  check(
    '  notable/easy bands sit inside the tails',
    NOTABLE_PERCENTILE > 90 && NOTABLE_PERCENTILE < 100 && EASY_PERCENTILE > 0 && EASY_PERCENTILE < 10,
    `notable ≥ p${NOTABLE_PERCENTILE}, easy ≤ p${EASY_PERCENTILE}`,
  );
  check(
    '  short documents are excluded from comparison',
    MIN_COMPARABLE_WORDS === 20 && computeMetrics('Too short.').words < MIN_COMPARABLE_WORDS,
    `cut-off ${MIN_COMPARABLE_WORDS} words`,
  );

  console.log('\n  percentile colour ramp:');
  const channel = (hex: string, index: number) => parseHex(hex)[index];
  check('  neutral grey at the median', percentileColor(50) === '#8592a3', percentileColor(50));
  check(
    '  saturates green at p0 and red at p100',
    percentileColor(0) === '#56d39a' && percentileColor(100) === '#f2767c',
    `${percentileColor(0)} … ${percentileColor(100)}`,
  );
  check(
    '  warms as the percentile rises above the median',
    channel(percentileColor(99), 0) > channel(percentileColor(75), 0) &&
      channel(percentileColor(75), 0) > channel(percentileColor(55), 0) &&
      channel(percentileColor(55), 0) > channel(percentileColor(50), 0),
    [55, 75, 99].map((p) => `p${p}=${percentileColor(p)}`).join(' '),
  );
  check(
    '  cools as the percentile falls below the median',
    channel(percentileColor(0), 1) > channel(percentileColor(25), 1) &&
      channel(percentileColor(25), 1) > channel(percentileColor(45), 1),
    [0, 25, 45].map((p) => `p${p}=${percentileColor(p)}`).join(' '),
  );
  check(
    '  every percentile yields a valid colour',
    Array.from({ length: 101 }, (_, p) => percentileColor(p)).every((hex) => /^#[0-9a-f]{6}$/.test(hex)),
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
