/**
 * The analysis engine.
 *
 * `runAnalysis` is a pure function of `(tools, text, enabled, options)`. It runs
 * every enabled tool, normalises and validates the annotations they return, and
 * resolves all overlapping annotations into a flat list of non-overlapping
 * *segments* that the view layer can render directly.
 */
import type {
  AnalysisRun,
  AnnotationDraft,
  ResolvedAnnotation,
  Segment,
  Tool,
  ToolOptions,
  ToolRun,
  ToolSignals,
} from './types';

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export function defaultOptions(tool: Tool): ToolOptions {
  const out: ToolOptions = {};
  for (const option of tool.options ?? []) out[option.id] = option.default;
  return out;
}

/** Declared defaults merged with any user overrides. */
export function resolveOptions(tool: Tool, overrides: ToolOptions | undefined): ToolOptions {
  return { ...defaultOptions(tool), ...(overrides ?? {}) };
}

export function isToolEnabled(tool: Tool, overrides: Record<string, boolean>): boolean {
  return overrides[tool.id] ?? tool.defaultEnabled ?? false;
}

export function hasOptionOverrides(tool: Tool, overrides: ToolOptions | undefined): boolean {
  if (!overrides) return false;
  const defaults = defaultOptions(tool);
  return Object.keys(defaults).some((key) => overrides[key] !== undefined && overrides[key] !== defaults[key]);
}

/* ------------------------------------------------------------------ */
/* Running tools                                                       */
/* ------------------------------------------------------------------ */

export interface RunInput {
  tools: Tool[];
  text: string;
  enabled: Record<string, boolean>;
  options: Record<string, ToolOptions>;
  /** External data for tools that declare `requires`. See `ToolSignals`. */
  signals?: ToolSignals;
}

function normalise(
  annotation: AnnotationDraft,
  index: number,
  tool: Tool,
  toolIndex: number,
  text: string,
): ResolvedAnnotation | null {
  const start = Math.max(0, Math.min(annotation.start, text.length));
  const end = Math.max(0, Math.min(annotation.end, text.length));
  if (end <= start) return null;

  const covered = text.slice(start, end);
  return {
    ...annotation,
    id: annotation.id || `${tool.id}#${index}`,
    toolId: tool.id,
    toolName: tool.name,
    toolIndex,
    start,
    end,
    text: covered,
    label: annotation.label || covered,
    // A tool may shade each annotation individually (gradients); otherwise it
    // gets its single declared colour.
    color: annotation.color ?? tool.color,
  };
}

export function runAnalysis({ tools, text, enabled, options, signals }: RunInput): AnalysisRun {
  const startedAt = performance.now();

  const byTool: Record<string, ToolRun> = {};
  const byToolAnnotations: Record<string, ResolvedAnnotation[]> = {};
  const annotations: ResolvedAnnotation[] = [];
  const stats: AnalysisRun['stats'] = [];
  const notes: AnalysisRun['notes'] = [];

  tools.forEach((tool, toolIndex) => {
    if (!isToolEnabled(tool, enabled)) return;

    let result;
    try {
      result = tool.run({ text, options: resolveOptions(tool, options[tool.id]), signals });
    } catch (error) {
      result = {
        notes: [
          {
            id: `${tool.id}#error`,
            text: `Tool threw: ${error instanceof Error ? error.message : String(error)}`,
            tone: 'bad' as const,
          },
        ],
      };
    }

    const resolved = (result.annotations ?? [])
      .map((annotation, index) => normalise(annotation, index, tool, toolIndex, text))
      .filter((annotation): annotation is ResolvedAnnotation => annotation !== null)
      .map((annotation, index) => ({ ...annotation, id: `${tool.id}#${index}` }));

    byTool[tool.id] = { tool, result };
    byToolAnnotations[tool.id] = resolved;
    annotations.push(...resolved);

    for (const stat of result.stats ?? []) {
      stats.push({ toolId: tool.id, toolName: tool.name, color: tool.color, stat });
    }
    for (const note of result.notes ?? []) {
      notes.push({ toolId: tool.id, toolName: tool.name, color: tool.color, note });
    }
  });

  annotations.sort((a, b) => a.start - b.start || a.end - b.end || a.toolIndex - b.toolIndex);

  const segments = buildSegments(text, annotations);

  return {
    byTool,
    byToolAnnotations,
    annotations,
    stats,
    notes,
    segments,
    elapsedMs: performance.now() - startedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Overlap resolution                                                  */
/* ------------------------------------------------------------------ */

/**
 * Layering rule: the **widest** annotation sits at the bottom (it is usually the
 * broad structural context, e.g. a sentence) and the **narrowest** sits on top
 * (usually the specific thing you asked to find, e.g. a verb). Ties are broken
 * by tool order in the registry, then by position — so the result is stable and
 * predictable regardless of the order tools run in.
 */
function compareLayers(a: ResolvedAnnotation, b: ResolvedAnnotation): number {
  const lengthA = a.end - a.start;
  const lengthB = b.end - b.start;
  if (lengthA !== lengthB) return lengthB - lengthA;
  if (a.toolIndex !== b.toolIndex) return a.toolIndex - b.toolIndex;
  return a.start - b.start;
}

/**
 * Sweep-line partition of the document into maximal constant-layer segments.
 * Runs in `O(n log n + k)` where `k` is the number of output segments.
 */
export function buildSegments(text: string, annotations: ResolvedAnnotation[]): Segment[] {
  if (text.length === 0) return [];

  const boundaries = new Set<number>([0, text.length]);
  for (const annotation of annotations) {
    boundaries.add(annotation.start);
    boundaries.add(annotation.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const ordered = [...annotations].sort((a, b) => a.start - b.start);
  const active: ResolvedAnnotation[] = [];
  const segments: Segment[] = [];
  let added = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;

    while (added < ordered.length && ordered[added].start <= start) {
      active.push(ordered[added]);
      added += 1;
    }
    for (let k = active.length - 1; k >= 0; k -= 1) {
      if (active[k].end <= start) active.splice(k, 1);
    }

    segments.push({
      start,
      end,
      text: text.slice(start, end),
      layers: active.length === 0 ? [] : [...active].sort(compareLayers),
    });
  }

  return segments;
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** Per-tool annotation counts, e.g. for the toolbar badges. */
export function countsByTool(run: Pick<AnalysisRun, 'byToolAnnotations'>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [toolId, annotations] of Object.entries(run.byToolAnnotations)) {
    counts[toolId] = annotations.length;
  }
  return counts;
}
