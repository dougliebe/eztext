import { useMemo, useState } from 'react';
import type { Stat, Tool, ToolResult } from '../core/types';
import { StatGrid } from './StatGrid';

interface ToolPanelProps {
  tool: Tool;
  result: ToolResult;
  stats: Stat[];
}

/**
 * One tool's figures in the results pane's Stats tab: a header, its statistics,
 * and a general explanation of each group it produced.
 *
 * There is deliberately no list of every annotation — a thousand rows of
 * "the = 1.2 bits" is noise, and annotations are browsable where they belong, by
 * clicking a highlight in the preview pane (which opens the inspector above
 * these panels). The JSON tab still carries the full set for export. The group
 * notes are not that list: they say what a category means and how a writer
 * usually adjusts it, once per tool instead of once per row.
 */
export function ToolPanel({ tool, result, stats }: ToolPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // The groups that actually produced annotations, first-seen order, with the
  // tool's explanation of what each one means and one canonical fix.
  const groupNotes = useMemo(() => {
    const descriptions = result.groupDescriptions ?? {};
    const examples = result.groupExamples ?? {};
    const seen = new Set<string>();
    const notes: Array<{ group: string; description: string; example?: string }> = [];
    for (const annotation of result.annotations ?? []) {
      const group = annotation.group;
      if (!group || seen.has(group) || !descriptions[group]) continue;
      seen.add(group);
      notes.push({ group, description: descriptions[group], example: examples[group] });
    }
    return notes;
  }, [result.annotations, result.groupDescriptions, result.groupExamples]);

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
            {stats.length} metric{stats.length === 1 ? '' : 's'}
          </span>
        </button>
      </header>

      {!collapsed && (
        <div className="tool-panel__body">
          {result.summary && <p className="tool-panel__summary">{result.summary}</p>}

          {stats.length > 0 ? (
            <StatGrid stats={stats} />
          ) : (
            <p className="muted">This tool has not produced any figures yet.</p>
          )}

          {groupNotes.length > 0 && (
            <details className="group-notes" open>
              <summary>What these groups mean</summary>
              <dl>
                {groupNotes.map(({ group, description, example }) => (
                  <div className="group-notes__row" key={group}>
                    <dt>{group}</dt>
                    <dd>
                      {description}
                      {example && <span className="group-notes__example">e.g. {example}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
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
