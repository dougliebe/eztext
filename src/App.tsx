import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { CoverageStrip } from './components/CoverageStrip';
import { HeatmapView } from './components/HeatmapView';
import { HighlightView } from './components/HighlightView';
import { InputPane } from './components/InputPane';
import { ResultsPane, type TabId } from './components/ResultsPane';
import { Splitter } from './components/Splitter';
import { Toolbar } from './components/Toolbar';
import { countsByTool, isToolEnabled, runAnalysis } from './core/engine';
import { heatGradient } from './core/color';
import { buildHeatmap, HEAT_METRICS, type HeatMetricId, type HeatMetricInfo } from './core/heatmap';
import { computeMetrics, describeNorm, formatSigma, MIN_COMPARABLE_WORDS, zScore } from './core/metrics';
import { CLEAR_CORPUS, type MetricNorm } from './core/data/corpus-norms';
import { usePersistentState } from './core/persistence';
import { compactNumber, round } from './core/text';
import type { ResolvedAnnotation, ToolOptionValue, ToolOptions } from './core/types';
import { SAMPLE_TEXT } from './sample-text';
import { getTool, tools } from './tools';

export default function App() {
  const [text, setText] = usePersistentState('text', SAMPLE_TEXT);
  const [enabled, setEnabled] = usePersistentState<Record<string, boolean>>('enabled', {});
  const [options, setOptions] = usePersistentState<Record<string, ToolOptions>>('options', {});
  // Layout keys are versioned so a changed default actually reaches users who
  // already have a ratio persisted from an earlier session.
  const [topRatio, setTopRatio] = usePersistentState('layout.v3.top', 0.62);
  const [leftRatio, setLeftRatio] = usePersistentState('layout.v3.left', 0.42);
  const [wrap, setWrap] = usePersistentState('input.wrap', true);
  // Which metric is shading the preview, if any. A view mode, persisted so a
  // reload keeps you where you were.
  const [heatMetric, setHeatMetric] = usePersistentState<HeatMetricId | null>('preview.heatmap', null);

  const [tab, setTab] = useState<TabId>('results');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openToolId, setOpenToolId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Analysis is kept off the typing critical path: the textarea always updates
  // immediately, and React re-runs the pipeline in a transition when it can.
  const deferredText = useDeferredValue(text);

  const analysis = useMemo(
    () => runAnalysis({ tools, text: deferredText, enabled, options }),
    [deferredText, enabled, options],
  );

  const doc = useMemo(() => computeMetrics(deferredText), [deferredText]);

  const heatmap = useMemo(
    () => (heatMetric ? buildHeatmap(deferredText, heatMetric) : []),
    [deferredText, heatMetric],
  );
  const heatInfo = heatMetric ? HEAT_METRICS[heatMetric] : null;

  const activeTools = useMemo(() => tools.filter((tool) => isToolEnabled(tool, enabled)), [enabled]);

  const counts = useMemo(() => countsByTool(analysis), [analysis]);

  /**
   * Corpus comparison, suppressed while the document is too short for the
   * ratios to mean anything (mirrors the generator's cut-off).
   */
  const deviation = useCallback(
    (raw: number, norm: MetricNorm) => (doc.words >= MIN_COMPARABLE_WORDS ? { raw, norm } : null),
    [doc.words],
  );

  /** Selecting a metric shades the preview by it; selecting it again clears. */
  const toggleHeatmap = useCallback(
    (id: HeatMetricId) => setHeatMetric((current) => (current === id ? null : id)),
    [setHeatMetric],
  );

  const toggleTool = useCallback(
    (id: string) => {
      const tool = getTool(id);
      setEnabled((previous) => {
        const current = previous[id] ?? tool?.defaultEnabled ?? false;
        return { ...previous, [id]: !current };
      });
    },
    [setEnabled],
  );

  const changeOption = useCallback(
    (toolId: string, optionId: string, value: ToolOptionValue) => {
      setOptions((previous) => ({
        ...previous,
        [toolId]: { ...(previous[toolId] ?? {}), [optionId]: value },
      }));
    },
    [setOptions],
  );

  const resetOptions = useCallback(
    (toolId: string) => {
      setOptions((previous) => {
        const next = { ...previous };
        delete next[toolId];
        return next;
      });
    },
    [setOptions],
  );

  const disableAll = useCallback(() => {
    setEnabled(Object.fromEntries(tools.map((tool) => [tool.id, false])));
  }, [setEnabled]);

  const revealInPreview = useCallback((annotation: ResolvedAnnotation) => {
    window.requestAnimationFrame(() => {
      const node = previewRef.current?.querySelector(`[data-ann="${CSS.escape(annotation.id)}"]`);
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  const selectFromList = useCallback(
    (annotation: ResolvedAnnotation) => {
      setSelectedId(annotation.id);
      setHoverId(null);
      setTab('results');
      revealInPreview(annotation);
    },
    [revealInPreview],
  );

  const selectFromPreview = useCallback((annotation: ResolvedAnnotation) => {
    setSelectedId(annotation.id);
    setHoverId(null);
    setTab('results');
  }, []);

  const selectedAnnotation = useMemo(
    () => analysis.annotations.find((annotation) => annotation.id === selectedId) ?? null,
    [analysis.annotations, selectedId],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ez
          </span>
          <div className="brand__text">
            <h1 className="brand__name">eztext</h1>
            <p className="brand__tag">overlapping text analysis, one extension at a time</p>
          </div>
        </div>

        <div className="metrics" role="group" aria-label="Document metrics">
          <Metric label="Words" value={compactNumber(doc.words)} />
          <Metric label="Sentences" value={compactNumber(doc.sentences)} />
          <Metric label="Paragraphs" value={compactNumber(doc.paragraphs)} />
          <Metric label="Characters" value={compactNumber(doc.characters)} />
          <Metric label="Read time" value={`${doc.readingMinutes} min`} />
          <Metric label="Annotations" value={compactNumber(analysis.annotations.length)} tone="accent" />

          <span className="metrics__rule" aria-hidden="true" />

          <Metric
            label="Words / sentence"
            value={round(doc.wordsPerSentence, 1)}
            hint="Average sentence length in words."
            deviation={deviation(doc.wordsPerSentence, CLEAR_CORPUS.metrics.wordsPerSentence)}
            heatLabel="colour sentences by length"
            active={heatMetric === 'wordsPerSentence'}
            onToggle={() => toggleHeatmap('wordsPerSentence')}
          />
          <Metric
            label="Chars / word"
            value={round(doc.charactersPerWord, 2)}
            hint="Letters and digits per word — punctuation, spaces and apostrophes excluded."
            deviation={deviation(doc.charactersPerWord, CLEAR_CORPUS.metrics.charactersPerWord)}
            heatLabel="colour words by length"
            active={heatMetric === 'charactersPerWord'}
            onToggle={() => toggleHeatmap('charactersPerWord')}
          />
          <Metric
            label="% polysyllabic"
            value={`${round(doc.polysyllabicShare * 100, 1)}%`}
            hint="Share of words carrying three or more syllables (estimated from vowel groups)."
            percent
            deviation={deviation(doc.polysyllabicShare, CLEAR_CORPUS.metrics.polysyllabicShare)}
            heatLabel="colour 3+ syllable words"
            active={heatMetric === 'polysyllabicShare'}
            onToggle={() => toggleHeatmap('polysyllabicShare')}
          />
          <Metric
            label="% unfamiliar"
            value={`${round(doc.unfamiliarShare * 100, 1)}%`}
            hint={`Share of words outside the Dale–Chall list of ~3,000 familiar words, and not a simple variant of one (${doc.unfamiliarWords} of ${doc.words} words).`}
            percent
            deviation={deviation(doc.unfamiliarShare, CLEAR_CORPUS.metrics.unfamiliarShare)}
            heatLabel="mark unfamiliar words"
            active={heatMetric === 'unfamiliarShare'}
            onToggle={() => toggleHeatmap('unfamiliarShare')}
          />
          <Metric
            label="Syllables / word"
            value={round(doc.syllablesPerWord, 2)}
            hint="Average syllables per word, estimated with a vowel-group heuristic."
            deviation={deviation(doc.syllablesPerWord, CLEAR_CORPUS.metrics.syllablesPerWord)}
            heatLabel="colour words by syllables"
            active={heatMetric === 'syllablesPerWord'}
            onToggle={() => toggleHeatmap('syllablesPerWord')}
          />
        </div>
      </header>

      <Toolbar
        tools={tools}
        enabled={enabled}
        options={options}
        counts={counts}
        openToolId={openToolId}
        onOpenTool={setOpenToolId}
        onToggle={toggleTool}
        onOptionChange={changeOption}
        onResetOptions={resetOptions}
        onDisableAll={disableAll}
      />

      <main className="workbench">
        <div className="workbench__top" style={{ height: `${topRatio * 100}%` }}>
          <div className="workbench__row">
            <div className="workbench__column" style={{ width: `${leftRatio * 100}%` }}>
              <InputPane
                text={text}
                onChange={setText}
                wrap={wrap}
                onToggleWrap={() => setWrap((value) => !value)}
                onLoadSample={() => setText(SAMPLE_TEXT)}
                onClear={() => {
                  setText('');
                  setSelectedId(null);
                }}
              />
            </div>

            <Splitter axis="x" ratio={leftRatio} onChange={setLeftRatio} label="Resize input and preview" min={0.2} max={0.8} />

            <section className="pane pane--preview">
              <header className="pane__header">
                <h2 className="pane__title">Preview</h2>

                {heatInfo ? (
                  <>
                    <span className="pane__hint">
                      {heatmap.length} {heatInfo.unit === 'sentence' ? 'sentences' : 'words'} shaded
                    </span>
                    <HeatLegend info={heatInfo} onClear={() => setHeatMetric(null)} />
                  </>
                ) : (
                  <>
                    <span className="pane__hint">
                      {analysis.annotations.length} highlights · {analysis.segments.length} segments
                    </span>
                    <div className="legend" aria-label="Active tools">
                      {activeTools.map((tool) => (
                        <span className="legend__item" key={tool.id}>
                          <span className="legend__swatch" style={{ backgroundColor: tool.color }} aria-hidden="true" />
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </header>

              <div className="pane__body pane__body--preview" ref={previewRef}>
                {heatMetric ? (
                  <HeatmapView text={deferredText} spans={heatmap} metric={heatMetric} />
                ) : (
                  <HighlightView
                    text={deferredText}
                    segments={analysis.segments}
                    hoverId={hoverId}
                    selectedId={selectedId}
                    onHover={setHoverId}
                    onSelect={selectFromPreview}
                  />
                )}
              </div>

              {!heatMetric && (
                <CoverageStrip
                  textLength={deferredText.length}
                  activeTools={activeTools}
                  byToolAnnotations={analysis.byToolAnnotations}
                  hoverId={hoverId}
                  selectedId={selectedId}
                  onHover={setHoverId}
                  onSelect={selectFromList}
                />
              )}
            </section>
          </div>
        </div>

        <Splitter axis="y" ratio={topRatio} onChange={setTopRatio} label="Resize input and results" min={0.18} max={0.82} />

        <div className="workbench__bottom">
          <ResultsPane
            text={deferredText}
            activeTools={activeTools}
            analysis={analysis}
            tab={tab}
            onTabChange={setTab}
            hoverId={hoverId}
            selectedId={selectedId}
            onHover={setHoverId}
            onSelect={selectFromList}
          />
        </div>
      </main>

      <footer className="statusbar">
        <span>
          {activeTools.length} of {tools.length} tools active
        </span>
        <span className="statusbar__sep">·</span>
        <span>
          {selectedAnnotation
            ? `Selected: ${selectedAnnotation.toolName} — “${selectedAnnotation.label}” [${selectedAnnotation.start}–${selectedAnnotation.end}]`
            : 'Click a highlight or a result row to inspect it'}
        </span>
        <span className="statusbar__spacer" />
        <span>runs on every keystroke · {round(analysis.elapsedMs, 2)} ms</span>
      </footer>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
  deviation,
  percent,
  active,
  heatLabel,
  onToggle,
}: {
  label: string;
  value: string | number;
  tone?: 'accent' | 'good' | 'warn';
  hint?: string;
  /** The raw value plus the corpus norm to compare it against. */
  deviation?: { raw: number; norm: MetricNorm } | null;
  /** Format the norm as a percentage rather than a plain number. */
  percent?: boolean;
  /** Present ⇒ the metric is clickable and shades the preview. */
  onToggle?: () => void;
  active?: boolean;
  /** Explains the click affordance in the tooltip. */
  heatLabel?: string;
}) {
  const z = deviation ? zScore(deviation.raw, deviation.norm) : null;

  // Tone comes from the corpus comparison, not a hardcoded threshold: the CLEAR
  // corpus averages ~17.6% unfamiliar words, so an absolute "over 10% is hard"
  // rule would fire on nearly every text.
  const resolvedTone = tone ?? (z === null ? undefined : z >= 1.5 ? 'warn' : z <= -1.5 ? 'good' : undefined);

  const title = [
    hint,
    deviation && z !== null
      ? `${CLEAR_CORPUS.name}: ${describeNorm(deviation.norm, percent)} → ${formatSigma(z)}, ${z >= 0 ? 'more difficult' : 'easier'} than the average excerpt.`
      : null,
    onToggle ? `${active ? 'Shading the preview. Click to stop' : `Click to ${heatLabel ?? 'shade the preview'}`}.` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const className = [
    'metric',
    resolvedTone ? `metric--${resolvedTone}` : '',
    onToggle ? 'metric--clickable' : '',
    active ? 'metric--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className="metric__label">{label}</span>
      <span className="metric__value">
        {value}
        {z !== null && <span className="metric__sigma">{formatSigma(z)}</span>}
      </span>
    </>
  );

  if (!onToggle) {
    return (
      <div className={className} title={title || undefined}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={title || undefined}
      aria-pressed={Boolean(active)}
      onClick={onToggle}
    >
      {body}
    </button>
  );
}

/** Ramp legend shown in the preview header while a metric is shading it. */
function HeatLegend({ info, onClear }: { info: HeatMetricInfo; onClear: () => void }) {
  return (
    <div className="heat-legend">
      <span className="heat-legend__label">{info.label}</span>
      {!info.binary && (
        <span className="heat-legend__ramp" style={{ background: heatGradient() }} aria-hidden="true" />
      )}
      <span className="heat-legend__blurb">{info.legend}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
