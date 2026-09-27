import { memo, type CSSProperties, type ReactNode } from 'react';
import { withAlpha } from '../core/color';
import type { ResolvedAnnotation, Segment } from '../core/types';

interface HighlightViewProps {
  text: string;
  segments: Segment[];
  hoverId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (annotation: ResolvedAnnotation) => void;
}

/**
 * Renders annotations over the raw document.
 *
 * Overlap is visualised by nesting one span per covering annotation: the widest
 * annotation is the outermost element and every layer washes its own translucent
 * background over the text. The washes compound where layers overlap, so a verb
 * inside a flagged sentence reads as a deeper tint — highlighting only, with no
 * underline or other decoration under the text.
 *
 * `segments` already tiles the document exactly once and each `layers` array is
 * ordered widest → narrowest, so this function never has to reason about ranges
 * beyond the span it is building.
 */
export const HighlightView = memo(function HighlightView({
  text,
  segments,
  hoverId,
  selectedId,
  onHover,
  onSelect,
}: HighlightViewProps) {
  if (text.trim().length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing to analyse yet</p>
        <p className="empty__body">
          Type or paste some text in the Input pane — highlights appear here as you type.
        </p>
      </div>
    );
  }

  return (
    <div className="highlights" onMouseLeave={() => onHover(null)}>
      <pre className="highlights__text">
        {segments.map((segment) => (
          <SegmentView
            key={segment.start}
            segment={segment}
            hoverId={hoverId}
            selectedId={selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </pre>
    </div>
  );
});

interface SegmentViewProps {
  segment: Segment;
  hoverId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (annotation: ResolvedAnnotation) => void;
}

function SegmentView({ segment, hoverId, selectedId, onHover, onSelect }: SegmentViewProps) {
  if (segment.layers.length === 0) return <>{segment.text}</>;

  const total = segment.layers.length;

  let content: ReactNode = segment.text;

  segment.layers.forEach((layer: ResolvedAnnotation, depth: number) => {
    const state = layer.id === selectedId ? 'selected' : layer.id === hoverId ? 'hover' : 'none';
    const isTop = depth === total - 1;

    // Light paper needs a stronger wash than a dark pane did: the tint has to
    // stay readable over white, and the widest (structural) layer must remain
    // visible even when two narrower layers stack on top of it.
    //
    // A tool may shade an item by its own magnitude instead (surprisal does:
    // transparent to red), in which case stacking depth is not consulted.
    const baseAlpha = layer.alpha ?? (total === 1 ? 0.3 : 0.12 + 0.09 * depth);
    // Capped at fully opaque, never above: a tool that supplies its own colour at
    // `alpha: 1` has already been contrast-checked, and the feedback for hover
    // and selection is the ink change and the ring below, not a lighter wash.
    const boost = state === 'selected' ? 0.34 : state === 'hover' ? 0.2 : 0;
    const alpha = Math.min(baseAlpha + boost, 1);

    const style: CSSProperties = {
      backgroundColor: withAlpha(layer.color, alpha),
      borderRadius: 0,
      color: state === 'none' ? undefined : 'var(--text-strong)',
    };

    if (state !== 'none') {
      // Ringed in the accent, not in the annotation's own colour: on this ramp a
      // word with no surprisal is shaded in the paper colour, so a tinted ring
      // would be invisible exactly when the user is trying to select it.
      style.boxShadow =
        state === 'selected' ? '0 0 0 2px var(--accent)' : '0 0 0 1px var(--accent)';
    }

    content = (
      <span
        className={`hl${isTop ? ' hl--top' : ''}`}
        style={style}
        data-ann={layer.id}
        data-tool={layer.toolId}
        title={`${layer.toolName}: ${layer.label}${layer.detail ? ` — ${layer.detail}` : ''}`}
        onMouseEnter={() => onHover(layer.id)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(layer);
        }}
      >
        {content}
      </span>
    );
  });

  return <>{content}</>;
}
