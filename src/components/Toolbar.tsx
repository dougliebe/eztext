import { useEffect, useMemo } from 'react';
import { colorVars } from '../core/color';
import { hasOptionOverrides } from '../core/engine';
import type { Tool, ToolCategory, ToolOptionValue, ToolOptions } from '../core/types';
import { CATEGORY_LABELS } from '../core/types';
import { ToolOptionsEditor } from './ToolOptionsEditor';

interface ToolbarProps {
  tools: Tool[];
  enabled: Record<string, boolean>;
  options: Record<string, ToolOptions>;
  /** Annotation count per tool id, for the badge. */
  counts: Record<string, number>;
  openToolId: string | null;
  onOpenTool: (id: string | null) => void;
  onToggle: (id: string) => void;
  onOptionChange: (toolId: string, optionId: string, value: ToolOptionValue) => void;
  onResetOptions: (toolId: string) => void;
  onDisableAll: () => void;
}

export function Toolbar({
  tools,
  enabled,
  options,
  counts,
  openToolId,
  onOpenTool,
  onToggle,
  onOptionChange,
  onResetOptions,
  onDisableAll,
}: ToolbarProps) {
  const groups = useMemo(() => {
    const map = new Map<ToolCategory, Tool[]>();
    for (const tool of tools) {
      const list = map.get(tool.category);
      if (list) list.push(tool);
      else map.set(tool.category, [tool]);
    }
    return [...map.entries()];
  }, [tools]);

  const activeCount = tools.filter((tool) => enabled[tool.id] ?? tool.defaultEnabled ?? false).length;

  // Close the popover on Escape or on any click outside the owning chip.
  useEffect(() => {
    if (!openToolId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenTool(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-tool-popover="${openToolId}"]`)) return;
      onOpenTool(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openToolId, onOpenTool]);

  return (
    <div className="toolbar">
      <div className="toolbar__groups">
        {groups.map(([category, list]) => (
          <div className="toolbar__group" key={category}>
            <span className="toolbar__group-label">{CATEGORY_LABELS[category]}</span>
            <div className="toolbar__chips">
              {list.map((tool) => {
                const isOn = enabled[tool.id] ?? tool.defaultEnabled ?? false;
                const value = options[tool.id] ?? {};
                const customised = hasOptionOverrides(tool, value);
                const count = counts[tool.id] ?? 0;
                const hasOptions = (tool.options?.length ?? 0) > 0;

                return (
                  <div className="chip-wrap" key={tool.id} data-tool-popover={tool.id}>
                    <div
                      className={`chip${isOn ? ' chip--on' : ''}${openToolId === tool.id ? ' chip--open' : ''}`}
                      style={colorVars(tool.color)}
                    >
                      <button
                        type="button"
                        className="chip__main"
                        aria-pressed={isOn}
                        title={`${tool.description}${hasOptions ? '\n\nShift-click or use the ⚙ button for settings.' : ''}`}
                        onClick={(event) => {
                          if (event.shiftKey && hasOptions) {
                            onOpenTool(openToolId === tool.id ? null : tool.id);
                            return;
                          }
                          onToggle(tool.id);
                        }}
                      >
                        <span className="chip__dot" aria-hidden="true" />
                        <span className="chip__name">{tool.name}</span>
                        {isOn && count > 0 && <span className="chip__count">{count}</span>}
                      </button>
                      {hasOptions && (
                        <button
                          type="button"
                          className={`chip__gear${customised ? ' chip__gear--dirty' : ''}`}
                          aria-label={`${tool.name} settings`}
                          aria-expanded={openToolId === tool.id}
                          title={customised ? 'Settings (modified)' : 'Settings'}
                          onClick={() => onOpenTool(openToolId === tool.id ? null : tool.id)}
                        >
                          ⚙
                        </button>
                      )}
                    </div>

                    {openToolId === tool.id && hasOptions && (
                      <div className="popover" role="dialog" aria-label={`${tool.name} settings`}>
                        <div className="popover__head">
                          <span className="popover__title">{tool.name}</span>
                          <button type="button" className="popover__close" onClick={() => onOpenTool(null)} aria-label="Close settings">
                            ✕
                          </button>
                        </div>
                        <p className="popover__desc">{tool.description}</p>
                        <ToolOptionsEditor
                          tool={tool}
                          values={value}
                          onChange={(optionId, next) => onOptionChange(tool.id, optionId, next)}
                        />
                        <div className="popover__actions">
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onResetOptions(tool.id)} disabled={!customised}>
                            Reset
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => {
                              if (!isOn) onToggle(tool.id);
                              onOpenTool(null);
                            }}
                          >
                            {isOn ? 'Done' : 'Enable tool'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar__meta">
        <span className="toolbar__active">{activeCount} active</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDisableAll} disabled={activeCount === 0}>
          Clear
        </button>
      </div>
    </div>
  );
}
