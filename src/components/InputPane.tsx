import { useMemo, useRef, useState } from 'react';
import { lineCount, offsetToLineCol } from '../core/text';

interface InputPaneProps {
  text: string;
  onChange: (text: string) => void;
  wrap: boolean;
  onToggleWrap: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  /** The local model, driven from the toolbar of this pane. */
  run: RunControl;
}

/** Everything the Run control needs to describe itself. */
export interface RunControl {
  status: 'idle' | 'running' | 'ready' | 'offline' | 'error';
  /** Text edited since the last run: results are withheld until it is re-run. */
  stale: boolean;
  /** Some enabled tool declared that it needs a model signal. */
  needed: boolean;
  /** Is the model process answering? `null` while unknown. */
  online: boolean | null;
  message?: string;
  elapsedMs?: number;
  onRun: () => void;
}

/** The editable source document, with a line-number gutter when wrapping is off. */
export function InputPane({ text, onChange, wrap, onToggleWrap, onLoadSample, onClear, run }: InputPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ start: 0, end: 0 });

  const lines = useMemo(() => (wrap ? [] : Array.from({ length: lineCount(text) }, (_, i) => i + 1)), [text, wrap]);
  const { line, column } = offsetToLineCol(text, caret.end);
  const selectionLength = Math.max(0, caret.end - caret.start);

  const syncCaret = () => {
    const node = textareaRef.current;
    if (!node) return;
    setCaret({ start: node.selectionStart, end: node.selectionEnd });
  };

  return (
    <section className="pane pane--input">
      <header className="pane__header">
        <h2 className="pane__title">Input</h2>
        <div className="pane__actions">
          <RunButton run={run} />
          <label className="toggle" title="Toggle soft wrapping">
            <input type="checkbox" checked={wrap} onChange={onToggleWrap} />
            <span>Wrap</span>
          </label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLoadSample}>
            Sample
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClear} disabled={text.length === 0}>
            Clear
          </button>
        </div>
      </header>

      <div className="input">
        {!wrap && (
          <div className="input__gutter" ref={gutterRef} aria-hidden="true">
            {lines.map((number) => (
              <div className="input__gutter-line" key={number}>
                {number}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input__area"
          value={text}
          wrap={wrap ? 'soft' : 'off'}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Paste or type the text you want to analyse…"
          aria-label="Source text"
          onChange={(event) => {
            onChange(event.target.value);
            syncCaret();
          }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onScroll={(event) => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>

      <footer className="pane__footer">
        <span>
          Line {line}, column {column}
        </span>
        <span className="pane__footer-sep">·</span>
        <span>
          {selectionLength > 0 ? `${selectionLength} characters selected` : `${text.length} characters`}
        </span>
      </footer>
    </section>
  );
}

/**
 * The model is explicit — nothing is scored until this is pressed.
 *
 * A forward pass costs hundreds of milliseconds to a few seconds, so the label
 * carries the state (`Run model`, `Scoring…`, `Re-run · edited`) instead of the
 * app guessing when to spend it.
 */
function RunButton({ run }: { run: RunControl }) {
  if (!run.needed) return null;

  const label =
    run.status === 'running'
      ? 'Scoring…'
      : run.status === 'offline'
        ? 'Run model (offline)'
        : run.status === 'ready'
          ? run.stale
            ? 'Re-run · edited'
            : 'Re-run'
          : 'Run model';

  const title = [
    run.status === 'offline'
      ? 'The model process is not running. Start it with: npm run model'
      : 'Score this text with the local language model',
    run.status === 'ready' && run.elapsedMs !== undefined ? `Last run: ${Math.round(run.elapsedMs)} ms` : null,
    run.status === 'ready' && run.stale ? 'The text changed since that run, so its scores are withheld.' : null,
    run.status === 'error' ? run.message : null,
  ]
    .filter(Boolean)
    .join('\n');

  const tone =
    run.status === 'offline' || run.status === 'error'
      ? ' btn--danger'
      : run.status === 'ready' && run.stale
        ? ' btn--stale'
        : '';

  return (
    <button
      type="button"
      className={`btn btn--sm${tone}`}
      onClick={run.onRun}
      disabled={run.status === 'running'}
      title={title}
    >
      {label}
    </button>
  );
}
