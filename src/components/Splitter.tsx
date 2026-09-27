import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface SplitterProps {
  /** `x` splits left/right (vertical bar), `y` splits top/bottom (horizontal bar). */
  axis: 'x' | 'y';
  /** Position of the divider as a fraction of the parent box. */
  ratio: number;
  onChange: (ratio: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

interface DragState {
  /** Ratio when the drag started — the drag is relative to this, not to the pointer. */
  ratio: number;
  /** Pointer coordinate when the drag started. */
  position: number;
  /** Parent size along the drag axis, for converting pixels into a ratio. */
  size: number;
}

/** A draggable pane divider with keyboard support (arrow keys, Home/End). */
export function Splitter({ axis, ratio, onChange, min = 0.15, max = 0.85, label }: SplitterProps) {
  const drag = useRef<DragState | null>(null);

  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const coordinate = (event: ReactPointerEvent<HTMLDivElement>) =>
    axis === 'y' ? event.clientY : event.clientX;

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const parent = event.currentTarget.parentElement;
    const rect = parent?.getBoundingClientRect();

    // Everything the drag needs is captured up front, so the divider keeps its
    // offset under the pointer no matter how the layout reflows mid-drag.
    drag.current = {
      ratio,
      position: coordinate(event),
      size: Math.max((axis === 'y' ? rect?.height : rect?.width) ?? 0, 1),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = 'true';
  };

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const delta = (coordinate(event) - state.position) / state.size;
    onChange(clamp(state.ratio + delta));
  };

  const handleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.05 : 0.02;
    const increase = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
    const decrease = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
    if (event.key === increase) onChange(clamp(ratio + step));
    else if (event.key === decrease) onChange(clamp(ratio - step));
    else if (event.key === 'Home') onChange(min);
    else if (event.key === 'End') onChange(max);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={`splitter splitter--${axis}`}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label ?? 'Resize panes'}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      tabIndex={0}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
    >
      <span className="splitter__grip" aria-hidden="true" />
    </div>
  );
}
