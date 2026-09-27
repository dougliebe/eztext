import type { Tool, ToolOptionValue, ToolOptions } from '../core/types';

interface ToolOptionsEditorProps {
  tool: Tool;
  /** Only stored overrides — missing keys fall back to the declared default. */
  values: ToolOptions;
  onChange: (optionId: string, value: ToolOptionValue) => void;
}

/**
 * Renders a tool's declared `options` schema. Tools never write UI code, which
 * is what keeps new extensions cheap to add.
 */
export function ToolOptionsEditor({ tool, values, onChange }: ToolOptionsEditorProps) {
  if (!tool.options?.length) return <p className="popover__empty">This tool has no settings.</p>;

  return (
    <div className="options">
      {tool.options.map((option) => {
        const value = values[option.id] ?? option.default;
        const fieldId = `${tool.id}-${option.id}`;

        if (option.kind === 'boolean') {
          return (
            <label className="option option--check" key={option.id} htmlFor={fieldId}>
              <input
                id={fieldId}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => onChange(option.id, event.target.checked)}
              />
              <span className="option__body">
                <span className="option__label">{option.label}</span>
                {option.hint && <span className="option__hint">{option.hint}</span>}
              </span>
            </label>
          );
        }

        return (
          <div className="option" key={option.id}>
            <label className="option__label" htmlFor={fieldId}>
              {option.label}
            </label>

            {option.kind === 'select' && (
              <select
                id={fieldId}
                className="field"
                value={String(value)}
                onChange={(event) => onChange(option.id, event.target.value)}
              >
                {option.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}

            {option.kind === 'number' && (
              <input
                id={fieldId}
                className="field"
                type="number"
                value={Number(value)}
                min={option.min}
                max={option.max}
                step={option.step ?? 1}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) onChange(option.id, parsed);
                }}
              />
            )}

            {option.kind === 'text' && (
              <input
                id={fieldId}
                className="field"
                type="text"
                value={String(value)}
                placeholder={option.placeholder}
                onChange={(event) => onChange(option.id, event.target.value)}
              />
            )}

            {option.hint && <span className="option__hint">{option.hint}</span>}
          </div>
        );
      })}
    </div>
  );
}
