/**
 * Core data model for eztext.
 *
 * The whole app is built around one idea: a *tool* (aka extension) reads the
 * document text and returns a set of *annotations* (ranges over the text) plus
 * *stats* / *notes*. Nothing else. Any number of tools may be enabled at once,
 * and their annotations are allowed to overlap freely — the engine is
 * responsible for resolving overlaps into renderable segments.
 */

import type { SurprisalScores } from './surprisal';
import type { SimilaritySignal } from './similarity';

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
  /**
   * Override the tool's colour for this annotation. Lets a tool emit a
   * *gradient* — the surprisal tool shades each word by its own value rather
   * than giving every match the same hue. Must be a hex colour.
   */
  color?: string;
  /**
   * Opacity for this annotation, 0–1. Omit it and the renderer derives one from
   * the layer stacking (so a tool that says nothing still gets sensible
   * overlaps). Supply it to shade items by magnitude — surprisal goes from
   * transparent to red this way, with the hue held constant.
   */
  alpha?: number;
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

/**
 * Where a value sits against a reference population, for a percentile chip.
 *
 * The tool computes all three because it is the side that knows the population —
 * the view only renders, and never has to invert a CDF to colour a chip.
 */
export interface StatComparison {
  percentile: number;
  z: number;
  /** Describes the population, e.g. `CLEAR corpus: 5.14 ± 0.61 (n=4,724)`. */
  description: string;
  /**
   * True for the few stats where a high value is the *easy* end (Flesch
   * Reading Ease). The percentile still describes the value; this only flips
   * the chip's tint so its colour keeps meaning "harder than the corpus".
   */
  higherIsEasier?: boolean;
}

/** A single computed number/label shown in the stats views. */
export interface Stat {
  id: string;
  label: string;
  value: string | number;
  /** Optional secondary text, e.g. a formula or target range. */
  hint?: string;
  tone?: Tone;
  /** Reference-population comparison, rendered as a chip beside the value. */
  comparison?: StatComparison;
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
  /**
   * One or two general sentences rendered above the stats: what this tool's
   * numbers mean and which direction is denser or easier. Run-specific
   * diagnostics belong in `notes` instead.
   */
  summary?: string;
  /**
   * One general explanation per annotation `group`, rendered once beside the
   * group filters. The per-annotation `detail` says why *this* range fired;
   * this says what the category means and what a writer usually does about it,
   * so a reader is never left with unexplained highlights.
   */
  groupDescriptions?: Record<string, string>;
  /**
   * One short, canonical before → after example per `group`, shown in the
   * selection inspector under the selected annotation. Keep it generic — the
   * shape of the fix, not a rewrite of the user's own text. Omit it for groups
   * that are purely descriptive (surprisal's severity bands already show what
   * the model expected), but supply all of them when any is supplied.
   */
  groupExamples?: Record<string, string>;
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

/**
 * Data a tool cannot compute itself.
 *
 * Signals are produced *outside* the engine — currently by the local model
 * process — and handed to tools through their context. That keeps
 * `runAnalysis` a pure synchronous function which is what makes the smoke test
 * trivial and keeps typing from ever waiting on a model.
 */
export type SignalId = 'surprisal' | 'similarity';

export interface ToolSignals {
  surprisal?: SurprisalScores;
  /** The document the signals were computed from; tools must not trust stale data. */
  surprisalText?: string;
  /** Word-level neighbours by meaning, accumulated across edits. */
  similarity?: SimilaritySignal;
}

export interface ToolContext {
  /** The full document text. */
  text: string;
  /** Options merged with the tool's declared defaults. */
  options: ToolOptions;
  /** Whatever the declared `requires` asked for. Absent until it has been fetched. */
  signals?: ToolSignals;
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
  /**
   * External data this tool needs before it can run. The app fetches whatever
   * is declared here (and shows a Run control while waiting); a tool whose
   * signals are missing must degrade to a "not scored yet" result rather than
   * throwing.
   */
  requires?: SignalId[];
  /** Pure function of `(text, options, signals)`. No side effects, no DOM access. */
  run(ctx: ToolContext): ToolResult;
}

/* ------------------------------------------------------------------ */
/* Engine output                                                       */
/* ------------------------------------------------------------------ */

/** An annotation enriched with presentation data by the engine. */
export interface ResolvedAnnotation extends Annotation {
  color: string;
  /** Tool-supplied opacity; absent when the renderer should pick one. */
  alpha?: number;
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
