import { useMemo } from 'react';
import type { AnalysisRun, Stat, Tool } from '../core/types';
import { JsonView } from './JsonView';
import { ToolPanel } from './ToolPanel';

export type TabId = 'stats' | 'json';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'stats', label: 'Stats' },
  { id: 'json', label: 'JSON' },
];

interface ResultsPaneProps {
  text: string;
  activeTools: Tool[];
  analysis: AnalysisRun;
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  /** Selection inspector, rendered above the scrolling tab content. */
  selection?: React.ReactNode;
}

export function ResultsPane({
  text,
  activeTools,
  analysis,
  tab,
  onTabChange,
  selection,
}: ResultsPaneProps) {
  const statsByTool = useMemo(() => {
    const map = new Map<string, Stat[]>();
    for (const entry of analysis.stats) {
      const list = map.get(entry.toolId);
      if (list) list.push(entry.stat);
      else map.set(entry.toolId, [entry.stat]);
    }
    return map;
  }, [analysis.stats]);

  const noteCount = analysis.notes.filter((entry) => entry.note.tone === 'bad').length;

  return (
    <section className="pane pane--results">
      <header className="pane__header pane__header--tabs">
        <div className="tabs" role="tablist" aria-label="Analysis views">
          {TABS.map((entry) => {
            const badge =
              entry.id === 'stats'
                ? analysis.stats.length
                : undefined;
            return (
              <button
                type="button"
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                className={`tab${tab === entry.id ? ' tab--on' : ''}`}
                onClick={() => onTabChange(entry.id)}
              >
                {entry.label}
                {badge !== undefined && badge > 0 && <span className="tab__badge">{badge}</span>}
              </button>
            );
          })}
        </div>
        <span className="pane__hint">
          {analysis.elapsedMs < 0.05 ? '<0.1' : analysis.elapsedMs.toFixed(1)} ms · {activeTools.length} tool
          {activeTools.length === 1 ? '' : 's'}
          {noteCount > 0 && ` · ${noteCount} error${noteCount === 1 ? '' : 's'}`}
        </span>
      </header>

      {selection && <div className="pane__inspector">{selection}</div>}

      <div className="pane__body">
        {activeTools.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No tools enabled</p>
            <p className="empty__body">
              Pick one or more extensions in the toolbar above. They run on every keystroke and may overlap freely.
            </p>
          </div>
        ) : tab === 'stats' ? (
          <div className="panels">
            {activeTools.map((tool) => {
              const run = analysis.byTool[tool.id];
              if (!run) return null;
              return (
                <ToolPanel
                  key={tool.id}
                  tool={tool}
                  result={run.result}
                  stats={statsByTool.get(tool.id) ?? []}
                />
              );
            })}
          </div>
        ) : (
          <JsonView text={text} analysis={analysis} />
        )}
      </div>
    </section>
  );
}
