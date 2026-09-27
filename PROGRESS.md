# Project Progress

## Current status
- Framework is complete and working: Vite + React + TypeScript SPA with a plugin-shaped tool
  registry, live analysis, overlap-aware highlighting, and a tabbed results pane.
- Topbar shows 11 always-on document metrics; each of the five ratios carries a **percentile chip**
  against the CLEAR corpus distribution (`91st`, `22nd`) instead of a σ readout.
- Pushed to `origin/main`. `main` == `origin/main`, nothing outstanding.
- `npm run build`, `npm run smoke` and `npm run ui-check` all pass.

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
- Pushed to GitHub (`dougliebe/eztext`): `9a7bd39` → `c0b44a4` → `27e4498` on `main`, fast-forward.
  Before pushing, the local branch was rebased onto the remote's `c0b44a4`, which the local clone did
  not have (see notes below). Re-verified after the rebase: typecheck, 16/16 smoke, 16/16 render.
- Topbar metrics (`core/metrics.ts`): the six corpus counts plus Words/sentence, Chars/word,
  % polysyllabic, % unfamiliar (Dale–Chall) and Syllables/word, in a second visual group behind a
  divider. Metric values carry advisory colour thresholds and hover tooltips with the exact definition.
- Vendored the Dale–Chall list as data: `core/data/dale-chall.ts`, 2,949 entries, with the formula's
  own familiarity rule (plural, possessive, -ed, -ing, -er/-est, -ly, doubled consonants, hyphenated
  compounds) implemented as candidate-stem lookup in `isFamiliarWord`.
- Smoke test now reports the metric table and asserts the sample document's counts (163 words / 11
  sentences / 4 paragraphs / 1,015 characters — matching the UI), ratio sanity, and 11 familiarity
  cases. `ui-check` guards topbar height (< 15% of viewport) and that the five language metrics render.
- **Corpus norms** (`npm run corpus:norms` → `core/data/corpus-norms.ts`): mean and SD of each ratio
  across 4,724 CLEAR excerpts, so the topbar can show a percentile versus real published prose (σ has since been replaced). The generator
  reads the xlsx with no dependency, finds the `Excerpt` column by header text, and computes metrics by
  bundling `core/metrics.ts` itself — norms cannot drift from the implementation.
- **Corpus percentiles replace σ** (`formatPercentile` / `percentileOf`): each ratio shows where it sits
  in the corpus distribution (`91st`, `22nd`) in a small chip, with mean ± SD and n in the tooltip. The
  generator now emits **empirical quantiles p0…p100** per metric (6 KB total) and the app inverts them by
  binary search — no normality assumption, which matters because words/sentence spans 3.9…101.5: at +1σ
  the normal CDF says p84 where the corpus actually says p89. Also exposes a true median (p50 = 20.25
  words/sentence vs mean 21.28).
- Tone bands moved from ±1.5σ to percentile tails: ≥ p93 amber, ≤ p7 green. On the sample text that
  surfaces `chars/word 91st` (long words) while `% unfamiliar` is an unremarkable `66th`.
- Guarded comparisons below 20 words (`MIN_COMPARABLE_WORDS`) — ratios and z-scores are meaningless on
  tiny inputs, so no σ chips render.
- `ui-check` now fails loudly if the page renders unstyled, instead of reporting a layout catastrophe
  (see the dev-server note below — it happened a third time and cost real debugging time).
- **Click-a-metric heatmaps** (`core/heatmap.ts` + `components/HeatmapView.tsx`): the five ratio metrics
  are buttons that shade the preview — sentences by length, words by letters, words by syllables
  (all words for `syllables/word`, only 3+ syllable words for `% polysyllabic`), and unfamiliar words in
  one flat colour. One active at a time; clicking the same metric again clears it; selection persists.
- Heatmap shades are **document-relative** with a visible floor (weakest word α 0.25, weakest sentence
  α 0.14). Measured in-browser: weakest shade Δ32 per channel over the pane background, strongest Δ142,
  median Δ59 — the ramp is legible end to end and whole sentences stay gentle because they cover more
  page.
- The heatmap *replaces* tool highlights (two colour systems at once would be unreadable): the coverage
  strip hides, the tool legend swaps for the ramp + Clear in the preview header, and the analysis keeps
  running so the Results pane is unaffected.
- Smoke test cross-checks the heatmap against `computeMetrics` on the same document: 11 sentence spans,
  163 word spans, 23 polysyllables, 34 unfamiliar, and per-word values summing to 824 letters / 255
  syllables. `ui-check` drives the clicks: switch, toggle-off, single-selection, flat-colour test for
  `% unfamiliar`, ramp presence, and that activating a metric does not resize the topbar.
- Caught a real accessibility bug via the render check: `aria-pressed={undefined}` made React omit the
  attribute entirely, so the metric toggles carried no pressed state. Now `Boolean(active)`.
- Removed the per-tool methodology footnotes; `notes` is now reserved for engine-level diagnostics
  (a tool throwing) and renders only for `tone: 'bad'`.
- Top pane (input + preview) defaults to 62% of the workbench height; layout keys are versioned so
  changed defaults reach existing sessions.

## Next steps
- An "unfamiliar words" tool that highlights exactly what `% unfamiliar` counts, reusing
  `isFamiliarWord` — makes the topbar number explainable and is the obvious companion to it.
- Cross-validate our metrics against the corpus's own columns (`Flesch-Reading-Ease`,
  `Flesch-Kincaid-Grade-Level`, `New Dale-Chall Readability Formula`): the xlsx already carries them, so
  the generator could report correlations and expose any weakness in the syllable heuristic.
- Show the corpus percentile as well as σ (a `+1.4σ` on chars/word is the 92nd percentile — more
  intuitive for some readers).  ← done, σ removed entirely
- Surface `% unfamiliar` / polysyllabic share in the Readability tool's stats too (single source of
  truth in `core/metrics.ts` once the tool stops computing its own).
- Shareable permalinks (encode text + enabled tools + options into the URL hash), regex101-style.
- Move analysis off the main thread (Web Worker) + debounce for documents beyond ~100 KB.
- Filter/highlight only a selection range (use `TextRange` input instead of whole-document runs).
- Per-tool "annotation → explanation" detail view for the currently selected annotation.
- Export: CSV/Markdown of annotations; download instead of clipboard-only.
- Tests for `core/text.ts` heuristics (abbreviations, sentence edges) and `buildSegments` overlap cases.
- More tools: clauses, adverbs/adjectives, passive voice, sentiment, word-length histogram, dialog.

## Decisions and notes
- **Topbar metrics are not a tool**: `core/metrics.ts` is a pure function of the text, called from
  `App.tsx` independently of the tool registry, so the header never changes when tools are toggled.
  Metrics are computed inside the same `useDeferredValue` boundary as the analysis.
- **Dale–Chall data is vendored, not a dependency**: extracted from the ISC-licensed
  `text-readability` package (v1.1.1), credited in the file header, so the app keeps zero runtime deps.
  The list is deliberately narrow (80% fourth-grade familiarity): the bundled sample scores ~21%
  unfamiliar. That is the formula working as intended — thresholds are <5% easy, >10% hard.
- **Chars/word** counts letters and digits only (punctuation/apostrophes excluded), matching what ARI
  and Coleman–Liau use as their divisor. Documented in the metric's tooltip.
- **Stray remote commit (resolved)**: `origin/main` carried `c0b44a4` — a commit appending
  `# migraine_discord_bot` to `README.md` in **UTF-16LE**, mixed with ASCII, which made git treat the
  README as a binary file. That content belongs to a different project. The rebase resolved the
  README conflict in favour of the new documentation, so the stray line is gone from the working tree
  but still recoverable at `c0b44a4`. If it mattered, restore it deliberately — do not re-add it in
  UTF-16.
- **Unrelated remote branch left alone**: `origin/claude/espn-fantasy-draft-app-6b5809` exists on the
  remote and has nothing to do with eztext. Untouched.
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
- **Heatmaps are a view mode, not a tool.** A tool goes through annotation → overlap → segment
  resolution, but a heatmap is a flat non-overlapping run of styled spans, so `core/heatmap.ts` produces
  spans directly and `HeatmapView` renders them — no segmentation, no layering, no fake registry entry.
  Intensity is relative to the document (the heatmap answers "which are longest *here*"), while the
  corpus comparison stays on the σ readouts. A heatmap also *replaces* tool highlights rather than
  mixing two colour systems.
- **Corpus norms: mean, SD *and* quantiles.** Percentiles are read off the stored distribution rather
  than derived from a z-score. The generator logs the skew per metric (empirical vs normal-CDF
  percentile at +1σ), which is how that decision got justified with numbers rather than taste.
- **CLEAR corpus is CC BY-NC-SA 4.0** (non-commercial, share-alike, attribution). Only aggregate
  statistics are committed — never corpus text — and the generated file states the licence. If eztext is
  ever commercialised, this needs a licence review or a different reference corpus.
- **Corpus data stays out of the repo**: `.corpus/` is gitignored, the generator re-downloads on demand,
  and the app itself only ever reads the small generated norms module.
- **Dev-server gotcha**: Vite on Windows can cache a 0-byte transform for a module whose file was
  replaced rather than edited (`git checkout`, shell redirects, atomic-save editors). Symptom is a blank
  page, or a page rendered *unstyled* when it hits `styles.css` (`const __vite__css = ""`). Mitigated
  with `awaitWriteFinish` plus `watch.ignored` for `.tmp/`, `.corpus/`, `dist/`; `ui-check` now detects
  it. If it recurs: restart the dev server (`rm -rf node_modules/.vite` first if it exits with EPERM).
- Heuristic (not statistical) NLP: english lexicon + morphology for verbs, vowel-group syllable
  estimate. Tools state their limits through each annotation's `detail` field, not through footnotes.

_Last updated: 2025-07-26_
