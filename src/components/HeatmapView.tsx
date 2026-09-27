import { memo, type ReactNode } from 'react';
import { heatColor } from '../core/color';
import type { HeatMetricId, HeatSpan } from '../core/heatmap';

interface HeatmapViewProps {
  text: string;
  spans: HeatSpan[];
  metric: HeatMetricId;
}

/**
 * Renders the document with each contributing word or sentence shaded.
 *
 * Heat spans never overlap and arrive in document order, so the text between
 * them is emitted as-is — no segmentation, no layering. Stronger contributors
 * get a hotter colour *and* more alpha; sentences use a gentler range because
 * they cover much more of the page than a single word.
 */
export const HeatmapView = memo(function HeatmapView({ text, spans, metric }: HeatmapViewProps) {
  if (text.trim().length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing to shade yet</p>
        <p className="empty__body">Type or paste some text in the Input pane — the heatmap appears here as you type.</p>
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing to shade</p>
        <p className="empty__body">No {metric === 'wordsPerSentence' ? 'sentences' : 'words'} matched this metric.</p>
      </div>
    );
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  spans.forEach((span) => {
    if (span.start > cursor) {
      nodes.push(<span key={`gap-${cursor}`}>{text.slice(cursor, span.start)}</span>);
    }

    // Tuned for paper: the wash has to survive being laid over white, and
    // sentences cover far more of the page, so their range stays gentler.
    const alpha = span.unit === 'sentence' ? 0.14 + 0.3 * span.intensity : 0.2 + 0.5 * span.intensity;

    nodes.push(
      <span
        key={`heat-${span.start}`}
        className={`heat heat--${span.unit}`}
        style={{
          backgroundColor: heatColor(span.intensity, alpha),
          boxShadow: span.intensity > 0.75 ? `inset 0 -2px 0 0 ${heatColor(span.intensity, 0.9)}` : undefined,
        }}
        title={`${span.label} — ${span.detail}`}
      >
        {span.text}
      </span>,
    );

    cursor = span.end;
  });

  if (cursor < text.length) nodes.push(<span key={`gap-${cursor}`}>{text.slice(cursor)}</span>);

  return (
    <div className="highlights">
      <pre className="highlights__text">{nodes}</pre>
    </div>
  );
});
