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
 * annotation is the outermost element (background tint) and each narrower layer
 * adds its own underline, so a verb inside a flagged sentence reads as one tint
 * plus two stacked underlines.
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
    // The caps sit above a tool's own range, so hovering or selecting a strongly
    // shaded word never makes it *fainter* than it already was.
    const alpha =
      state === 'selected'
        ? Math.min(baseAlpha + 0.34, 0.95)
        : state === 'hover'
          ? Math.min(baseAlpha + 0.2, 0.9)
          : baseAlpha;

    const style: CSSProperties = {
      backgroundColor: withAlpha(layer.color, alpha),
      borderRadius: 0,
      color: state === 'none' ? undefined : 'var(--text-strong)',
    };

    // A single covering annotation is communicated by tint alone; stacked
    // underlines appear only where layers genuinely overlap.
    if (total > 1) {
      style.textDecorationLine = 'underline';
      style.textDecorationColor = withAlpha(layer.color, state === 'none' ? 0.85 : 1);
      style.textDecorationThickness = '2px';
      style.textUnderlineOffset = `${2 + 2 * (total - 1 - depth)}px`;
    }

    if (state !== 'none') {
      style.boxShadow = `0 0 0 1px ${withAlpha(layer.color, 0.9)}`;
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
