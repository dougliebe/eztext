# Project Progress

## Current status
- Framework is complete and working: Vite + React + TypeScript SPA with a plugin-shaped tool
  registry, live analysis, overlap-aware highlighting, and a tabbed results pane.
- `npm run build` and `npm run smoke` both pass (engine invariants + headless render check).

## In progress
- Nothing.

## Completed
- Project scaffold: Vite 5, React 18, strict TS, dark-theme design tokens, `dev`/`build`/`preview`/`typecheck`/`smoke` scripts.
- Core: `core/types.ts` (Tool / AnnotationDraft / Annotation / Segment contract), `core/engine.ts`
  (`runAnalysis` + sweep-line overlap resolution), `core/text.ts` (word/sentence/paragraph tokenizers,
  syllable estimate), `core/persistence.ts`, `core/color.ts`.
- UI: topbar metrics, tool-chip toolbar with generic options popovers, input pane (line/col, wrap
  toggle, gutter), live highlight preview with nested layers, coverage tracks per tool, resizable
  input/preview/results splitters, statusbar.
- Results pane tabs: Results (per-tool panels, group filters, paged rows), Stats (metric cards),
  JSON (copyable export of the whole run).
- Four starter tools: Sentences, Verbs (incl. "avg words between verbs"), Repeated words, Readability.
- Hover/click synchronisation across preview ↔ rows ↔ coverage strip; localStorage persistence.
- `npm run smoke`: headless pipeline run with invariant assertions (tiling, layering, coverage,
  unique ids) plus a `renderToStaticMarkup` check of the full app.
- `npm run ui-check`: real-browser layout check (`playwright-core` + installed Chrome) that drags both
  splitters and asserts no drift when panels are collapsed/expanded or tabs are switched.
- Fixed pane sizing: panes are now `flex: 0 0 auto` (splitter-controlled side) and `flex: 1 1 0`
  (filler side) with `overflow: hidden`, so content can no longer resize a pane. Previously the
  results pane's content grew it to ~522px, squeezing the top pane from 62% to 21.4%, and collapsing
  a panel shifted the divider by up to 25 percentage points.
- Divider drags are delta-based (ratio at pointer-down + pointer travel) instead of absolute, so the
  divider keeps its offset under the cursor and the first move no longer jumps to a smaller size.
- `vite.config.ts`: `server.watch.awaitWriteFinish` — without it, a file replaced by another tool
  (`git checkout`, `>` redirect) can be stat-cached at its 0-byte moment, which serves a blank app
  until the dev server restarts. Reproduced twice.
- Layout persistence keys bumped to `layout.v3.*` so the corrected default reaches sessions that had
  a ratio saved while the sizing bug was live.
- Removed the per-tool methodology footnotes; `notes` is now reserved for engine-level diagnostics
  (a tool throwing) and renders only for `tone: 'bad'`.
- Top pane (input + preview) defaults to 62% of the workbench height; layout keys are versioned so
  changed defaults reach existing sessions.

## Next steps
- Shareable permalinks (encode text + enabled tools + options into the URL hash), regex101-style.
- Move analysis off the main thread (Web Worker) + debounce for documents beyond ~100 KB.
- Filter/highlight only a selection range (use `TextRange` input instead of whole-document runs).
- Per-tool "annotation → explanation" detail view for the currently selected annotation.
- Export: CSV/Markdown of annotations; download instead of clipboard-only.
- Tests for `core/text.ts` heuristics (abbreviations, sentence edges) and `buildSegments` overlap cases.
- More tools: clauses, adverbs/adjectives, passive voice, sentiment, word-length histogram, dialog.

## Decisions and notes
- **Stack**: Vite + React + TS, plain CSS with tokens. No CSS framework, no state library, no test
  runner — the pipeline is pure so `scripts/smoke.mjs` (esbuild + Node) covers it headlessly.
- **Tool contract**: tools return `AnnotationDraft`s (range + label + group + detail + data) and never
  touch the DOM. Ids, tool ids and covered text are assigned by the engine, so a new extension needs
  no UI work at all: toolbar chip, settings popover, stats, filters, coverage track and JSON export
  come from the declared `options` schema and returned data.
- **Overlap model**: `buildSegments` partitions the document into maximal constant-layer segments
  (sweep line, O(n log n)). Layering rule: widest annotation at the bottom (structural context),
  narrowest on top (the specific match), ties broken by registry order then position.
- **Overlap rendering**: one nested `<span>` per covering layer — outermost gets the background tint,
  each layer adds its own `text-underline-offset`, so overlaps read as stacked underlines without
  any CSS blending tricks.
- **Performance**: `runAnalysis` is a pure `useMemo` fed by `useDeferredValue(text)`, so typing never
  blocks on analysis.
- **Layout contract**: a splitter is the only thing that sizes a pane. The controlled side is
  `flex: 0 0 auto` with a percentage size; the other side is `flex: 1 1 0; min-*: 0; overflow: hidden`.
  Content-driven flex bases (the original bug) let the lower pane's content push the divider around.
- **UI verification**: `scripts/ui-check.mjs` drives the installed Chrome through `playwright-core`
  (tiny dependency, no ~100 MB browser download) and reads geometry straight from the DOM, so it
  cannot be fooled by app state. Verified to fail on the pre-fix layout and pass after.
- **Dev-server gotcha**: Vite on Windows can cache a 0-byte transform for a module whose file was
  replaced rather than edited (`git checkout`, shell redirects, atomic-save editors). Symptom is a
  blank page with the module serving `Content-Length: 0`. Mitigated with `awaitWriteFinish`; if it
  recurs, restart the dev server or delete `node_modules/.vite`.
- Heuristic (not statistical) NLP: english lexicon + morphology for verbs, vowel-group syllable
  estimate. Tools state their limits through each annotation's `detail` field, not through footnotes.

_Last updated: 2025-07-26_
