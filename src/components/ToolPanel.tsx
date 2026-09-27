import { useEffect, useMemo, useRef, useState } from 'react';
import { withAlpha } from '../core/color';
import type { ResolvedAnnotation, Stat, Tool, ToolResult } from '../core/types';
import { StatGrid } from './StatGrid';

const PAGE_SIZE = 150;

interface ToolPanelProps {
  tool: Tool;
  result: ToolResult;
  annotations: ResolvedAnnotation[];
  stats: Stat[];
  hoverId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (annotation: ResolvedAnnotation) => void;
}

export function ToolPanel({
  tool,
  result,
  annotations,
  stats,
  hoverId,
  selectedId,
  onHover,
  onSelect,
}: ToolPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLOListElement>(null);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      const key = annotation.group ?? 'all';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [annotations]);

  const visible = useMemo(
    () => (groupFilter === 'all' ? annotations : annotations.filter((annotation) => (annotation.group ?? 'all') === groupFilter)),
    [annotations, groupFilter],
  );

  // Keep the clicked annotation visible in the list.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-row="${CSS.escape(selectedId)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, visible]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [groupFilter, annotations.length]);

  const errorNotes = (result.notes ?? []).filter((note) => note.tone === 'bad');

  return (
    <section className="tool-panel" style={{ ['--tool-color' as string]: tool.color }}>
      <header className="tool-panel__head">
        <button
          type="button"
          className="tool-panel__toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className={`disclosure${collapsed ? '' : ' disclosure--open'}`} aria-hidden="true">
            ▸
          </span>
          <span className="tool-panel__dot" aria-hidden="true" />
          <span className="tool-panel__name">{tool.name}</span>
          <span className="tool-panel__count">
            {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
          </span>
        </button>
      </header>

      {!collapsed && (
        <div className="tool-panel__body">
          {stats.length > 0 && <StatGrid stats={stats} />}

          {groups.length > 1 && (
            <div className="filters">
              <button
                type="button"
                className={`pill${groupFilter === 'all' ? ' pill--on' : ''}`}
                onClick={() => setGroupFilter('all')}
              >
                all <span className="pill__count">{annotations.length}</span>
              </button>
              {groups.map(([group, count]) => (
                <button
                  type="button"
                  key={group}
                  className={`pill${groupFilter === group ? ' pill--on' : ''}`}
                  onClick={() => setGroupFilter(group)}
                >
                  {group} <span className="pill__count">{count}</span>
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="muted">Nothing matched — try loosening this tool’s settings.</p>
          ) : (
            <ol className="rows" ref={listRef}>
              {visible.slice(0, limit).map((annotation, index) => (
                <ResultRow
                  key={annotation.id}
                  annotation={annotation}
                  index={index}
                  state={annotation.id === selectedId ? 'selected' : annotation.id === hoverId ? 'hover' : 'none'}
                  onHover={onHover}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          )}

          {visible.length > limit && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLimit((value) => value + PAGE_SIZE * 2)}>
              Show {Math.min(PAGE_SIZE * 2, visible.length - limit)} more of {visible.length}
            </button>
          )}

          {errorNotes.length > 0 && (
            <ul className="notes">
              {errorNotes.map((note) => (
                <li className={`note note--${note.tone ?? 'muted'}`} key={note.id}>
                  {note.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface ResultRowProps {
  annotation: ResolvedAnnotation;
  index: number;
  state: 'none' | 'hover' | 'selected';
  onHover: (id: string | null) => void;
  onSelect: (annotation: ResolvedAnnotation) => void;
}

function ResultRow({ annotation, index, state, onHover, onSelect }: ResultRowProps) {
  const preview = (annotation.text || '').replace(/\s+/g, ' ').trim();

  return (
    <li>
      <button
        type="button"
        data-row={annotation.id}
        className={`row row--${state}`}
        style={{ borderLeftColor: withAlpha(annotation.color, state === 'none' ? 0.6 : 1) }}
        onMouseEnter={() => onHover(annotation.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(annotation.id)}
        onClick={() => onSelect(annotation)}
        title={`${annotation.label}${annotation.detail ? ` — ${annotation.detail}` : ''}`}
      >
        <span className="row__index">{index + 1}</span>
        <span className="row__range">
          {annotation.start}–{annotation.end}
        </span>
        <span className="row__text">{preview}</span>
        {annotation.group && annotation.group !== 'all' && <span className="row__group">{annotation.group}</span>}
      </button>
    </li>
  );
}
