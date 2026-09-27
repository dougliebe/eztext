/**
 * Core data model for eztext.
 *
 * The whole app is built around one idea: a *tool* (aka extension) reads the
 * document text and returns a set of *annotations* (ranges over the text) plus
 * *stats* / *notes*. Nothing else. Any number of tools may be enabled at once,
 * and their annotations are allowed to overlap freely — the engine is
 * responsible for resolving overlaps into renderable segments.
 */

/** A half-open range `[start, end)` of character offsets into the document. */
export interface TextRange {
  start: number;
  end: number;
}

export type ToolCategory = 'lexical' | 'grammar' | 'structure' | 'readability' | 'utility';

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  structure: 'Structure',
  grammar: 'Grammar',
  lexical: 'Lexical',
  readability: 'Readability',
  utility: 'Utility',
};

/**
 * What a tool returns. Ids, tool ids and the covered text are filled in by the
 * engine, so a tool only has to describe the range and why it matters.
 */
export interface AnnotationDraft extends TextRange {
  id?: string;
  text?: string;
  /** Short human label, e.g. the matched word. Defaults to the covered text. */
  label?: string;
  group?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

/** A single highlighted range produced by a tool, with every field resolved. */
export interface Annotation extends TextRange {
  /** Unique id, assigned by the engine as `${toolId}#${index}`. */
  id: string;
  /** Id of the tool that produced this annotation. */
  toolId: string;
  /** The exact substring covered by the range. */
  text: string;
  /** Short human label, e.g. the matched word. */
  label: string;
  /**
   * Sub-category inside a tool, e.g. `verb` vs `auxiliary`.
   * Used for grouping and filtering in the results pane.
   */
  group?: string;
  /** Longer explanation shown in the results pane. */
  detail?: string;
  /** Arbitrary tool-specific payload (exported as JSON). */
  data?: Record<string, unknown>;
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'muted';

/** A single computed number/label shown in the stats views. */
export interface Stat {
  id: string;
  label: string;
  value: string | number;
  /** Optional secondary text, e.g. a formula or target range. */
  hint?: string;
  tone?: Tone;
}

/**
 * Engine diagnostics attached to a tool result, rendered only when `tone` is
 * `bad` (a tool threw). Tools should not use this for commentary — put that in
 * an annotation's `detail` instead.
 */
export interface Note {
  id: string;
  text: string;
  tone?: Tone;
}

export interface ToolResult {
  annotations?: AnnotationDraft[];
  stats?: Stat[];
  notes?: Note[];
}

/* ------------------------------------------------------------------ */
/* Tool options                                                        */
/* ------------------------------------------------------------------ */

export type ToolOption =
  | { kind: 'boolean'; id: string; label: string; default: boolean; hint?: string }
  | {
      kind: 'number';
      id: string;
      label: string;
      default: number;
      min?: number;
      max?: number;
      step?: number;
      hint?: string;
    }
  | { kind: 'text'; id: string; label: string; default: string; placeholder?: string; hint?: string }
  | {
      kind: 'select';
      id: string;
      label: string;
      default: string;
      choices: Array<{ value: string; label: string }>;
      hint?: string;
    };

export type ToolOptionValue = boolean | number | string;
export type ToolOptions = Record<string, ToolOptionValue>;

export interface ToolContext {
  /** The full document text. */
  text: string;
  /** Options merged with the tool's declared defaults. */
  options: ToolOptions;
}

export interface Tool {
  id: string;
  name: string;
  /** One-line description shown in the toolbar tooltip. */
  description: string;
  category: ToolCategory;
  /** Base colour for this tool's highlights. Any CSS hex colour. */
  color: string;
  /** Enabled on first load. */
  defaultEnabled?: boolean;
  /** Declared options — rendered generically by the toolbar. */
  options?: ToolOption[];
  /** Pure function of `(text, options)`. No side effects, no DOM access. */
  run(ctx: ToolContext): ToolResult;
}

/* ------------------------------------------------------------------ */
/* Engine output                                                       */
/* ------------------------------------------------------------------ */

/** An annotation enriched with presentation data by the engine. */
export interface ResolvedAnnotation extends Annotation {
  color: string;
  toolName: string;
  /** Position of the owning tool in the registry, used for deterministic layering. */
  toolIndex: number;
}

/**
 * A maximal run of text whose set of covering annotations is constant.
 * Segments tile the document exactly once, which is what makes overlap
 * rendering possible.
 */
export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Covering annotations, ordered bottom-most (widest) to top-most (narrowest). */
  layers: ResolvedAnnotation[];
}

export interface ToolRun {
  tool: Tool;
  result: ToolResult;
}

export interface AnalysisRun {
  /** Results keyed by tool id, for every *enabled* tool. */
  byTool: Record<string, ToolRun>;
  /** Resolved annotations keyed by tool id (same objects as `annotations`). */
  byToolAnnotations: Record<string, ResolvedAnnotation[]>;
  /** Flat list of every annotation, in document order. */
  annotations: ResolvedAnnotation[];
  /** Stats aggregated across all enabled tools, with the owning tool attached. */
  stats: Array<{ toolId: string; toolName: string; color: string; stat: Stat }>;
  /** Notes aggregated across all enabled tools. */
  notes: Array<{ toolId: string; toolName: string; color: string; note: Note }>;
  segments: Segment[];
  /** Wall-clock time of the whole pipeline, in milliseconds. */
  elapsedMs: number;
}
