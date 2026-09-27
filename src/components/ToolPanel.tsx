import { useState } from 'react';
import type { ResolvedAnnotation, Stat, Tool, ToolResult } from '../core/types';
import { StatGrid } from './StatGrid';

interface ToolPanelProps {
  tool: Tool;
  result: ToolResult;
  annotations: ResolvedAnnotation[];
  stats: Stat[];
}

/**
 * One tool's output in the results pane: its statistics, and nothing else.
 *
 * There is deliberately no list of every annotation — a thousand rows of
 * "the = 1.2 bits" is noise, and the annotations are already browsable where
 * they belong, by clicking a highlight in the preview (the selection inspector
 * at the top of this pane). The JSON tab still carries the full set for export.
 */
export function ToolPanel({ tool, result, annotations, stats }: ToolPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Notes are engine diagnostics — a tool that threw — not commentary.
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
            {annotations.length} annotation{annotations.length === 1 ? '' : 's'} in the preview
          </span>
        </button>
      </header>

      {!collapsed && (
        <div className="tool-panel__body">
          {stats.length > 0 ? (
            <StatGrid stats={stats} />
          ) : (
            <p className="muted">This tool has not produced any figures yet.</p>
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
