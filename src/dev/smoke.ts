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
  formatSigma,
  isFamiliarWord,
  MIN_COMPARABLE_WORDS,
  POLYSYLLABLE_THRESHOLD,
  zScore,
} from '../core/metrics';
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
      `  ${label.padEnd(18)} ${value.toFixed(3).padStart(7)}  norm ${norm.mean.toFixed(4)} ± ${norm.sd.toFixed(4)}  ${z === null ? 'n/a' : formatSigma(z).padStart(7)}`,
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
    `${normValues.length} metrics with spread`,
  );
  check('corpus covers real prose', CLEAR_CORPUS.wordsPerExcerpt.mean > 150 && CLEAR_CORPUS.wordsPerExcerpt.mean < 200,
    `${CLEAR_CORPUS.wordsPerExcerpt.mean} words per excerpt ± ${CLEAR_CORPUS.wordsPerExcerpt.sd}`);

  const sampleZs = comparisons.map(([, value, key]) => zScore(value, CLEAR_CORPUS.metrics[key])!);
  check('every sample deviation is finite and unremarkable', sampleZs.every((z) => Number.isFinite(z) && Math.abs(z) < 5),
    sampleZs.map((z) => formatSigma(z)).join(' '));
  check(
    'sample sentences are shorter than the corpus average',
    sampleZs[0] < 0,
    `${formatSigma(sampleZs[0])} on words/sentence`,
  );
  check(
    'sample words are longer than the corpus average',
    sampleZs[1] > 0,
    `${formatSigma(sampleZs[1])} on chars/word`,
  );

  console.log('\n  z-score formatting:');
  check('  +1.42 → +1.4σ', formatSigma(1.42) === '+1.4\u03C3', formatSigma(1.42));
  check('  −0.7 → −0.7σ', formatSigma(-0.7) === '\u22120.7\u03C3', formatSigma(-0.7));
  check('  0 → ±0σ', formatSigma(0) === '\u00B10\u03C3', formatSigma(0));
  check(
    '  short documents are excluded from comparison',
    MIN_COMPARABLE_WORDS === 20 && computeMetrics('Too short.').words < MIN_COMPARABLE_WORDS,
    `cut-off ${MIN_COMPARABLE_WORDS} words`,
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
