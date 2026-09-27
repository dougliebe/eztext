import type { ResolvedAnnotation, Tool } from '../core/types';
import { withAlpha } from '../core/color';

interface CoverageStripProps {
  textLength: number;
  activeTools: Tool[];
  byToolAnnotations: Record<string, ResolvedAnnotation[]>;
  hoverId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (annotation: ResolvedAnnotation) => void;
}

/**
 * One track per active tool showing *where* in the document it fired.
 *
 * This is the cheapest way to make overlapping extensions legible: you can see
 * at a glance that the readability tool only covers sentence 3 while the verbs
 * tool fires everywhere, and you can click any block to jump to that
 * annotation's entry in the results list.
 */
export function CoverageStrip({
  textLength,
  activeTools,
  byToolAnnotations,
  hoverId,
  selectedId,
  onHover,
  onSelect,
}: CoverageStripProps) {
  if (textLength === 0 || activeTools.length === 0) return null;

  return (
    <div className="coverage" aria-label="Annotation coverage" onMouseLeave={() => onHover(null)}>
      {activeTools.map((tool) => {
        const annotations = byToolAnnotations[tool.id] ?? [];
        const covered = annotations.reduce((sum, annotation) => sum + (annotation.end - annotation.start), 0);
        const share = textLength > 0 ? Math.round((covered / textLength) * 100) : 0;

        return (
          <div className="coverage__row" key={tool.id}>
            <span className="coverage__label" style={{ ['--tool-color' as string]: tool.color }} title={tool.name}>
              <span className="coverage__dot" aria-hidden="true" />
              {tool.name}
            </span>
            <div className="coverage__track">
              {annotations.map((annotation) => {
                const left = (annotation.start / textLength) * 100;
                const width = Math.max(((annotation.end - annotation.start) / textLength) * 100, 0.35);
                const state = annotation.id === selectedId ? 'selected' : annotation.id === hoverId ? 'hover' : 'none';
                return (
                  <button
                    type="button"
                    key={annotation.id}
                    className={`coverage__block coverage__block--${state}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: withAlpha(tool.color, state === 'none' ? 0.55 : 0.95),
                    }}
                    title={`${tool.name}: ${annotation.label} [${annotation.start}–${annotation.end}]`}
                    aria-label={`${tool.name} annotation: ${annotation.label}`}
                    onMouseEnter={() => onHover(annotation.id)}
                    onFocus={() => onHover(annotation.id)}
                    onClick={() => onSelect(annotation)}
                  />
                );
              })}
            </div>
            <span className="coverage__share" title={`${annotations.length} annotations covering ${share}% of the document`}>
              {annotations.length}
            </span>
          </div>
        );
      })}
    </div>
  );
}
