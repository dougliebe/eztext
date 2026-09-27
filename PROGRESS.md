# Project Progress

## Current status
- Framework is complete and working: Vite + React + TypeScript SPA with a plugin-shaped tool
  registry, live analysis, overlap-aware highlighting, and a tabbed results pane.
- Topbar shows 11 always-on document metrics; each of the five ratios carries a **percentile chip**
  derived from its z-score against the CLEAR corpus, with a colour-coded font.
- Pushed to `origin/main`. `main` == `origin/main`, nothing outstanding.
- `npm run build`, `npm run smoke` and `npm run ui-check` all pass.

## In progress
- **GSDS Stage 1 is implemented and verified** on `feat/gsds-tool` (worktree `D:/ANALYTICS/eztext-gsds`).
  Remaining: a windowed score for documents past ~200 words (currently an amber hint), and optionally a
  POS tagger from the local model process to replace the suffix heuristics for variables 2–4 and 10.

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
- Tools: Readability only. Sentences, Verbs and Repeated words were removed as examples — they were
  demonstrations of the contract rather than things worth reading with (recoverable from git history).
- **Surprisal model** (`npm run model`): a local process runs GPT-2 under native ONNX Runtime and serves
  per-word surprisal plus perturbation gains at /api/model, proxied by Vite. Weights download once into
  .models/ (125 MB, gitignored), then it is offline. Scoring arithmetic is pure and lives in
  src/core/surprisal.ts; the server bundles that file so both sides share one implementation.
  Measured: 197 tokens in 396 ms, 1,198 tokens in 2.5 s (1024-token windows with one token of left
  context). Line endings are normalised to `\n` first — GPT-2 has never seen `\r` and
  scores it at 50+ bits, which would otherwise poison every paragraph break.
- Surprisal smoke tests cover the arithmetic on a synthetic 4-token vocabulary: first token has no
  surprisal, predicted tokens cost ~0, unexpected ones cost >10 bits, the gain equals the surprise the
  expected piece would have avoided, subword pieces fold into words with exact offsets, and two guards
  (a NaN topK and a zero topK) hold.
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
  across 4,724 CLEAR excerpts, so the topbar can compare against real published prose. The generator
  reads the xlsx with no dependency, finds the `Excerpt` column by header text, and computes metrics by
  bundling `core/metrics.ts` itself — norms cannot drift from the implementation.
- **Percentile = Φ(z), computed from mean + SD alone** (`percentileFromZ`, Abramowitz & Stegun 7.1.26).
  The chip shows the percentile (`92nd`) because it reads better; the z-score stays in the tooltip and on
  `data-z`. No quantile table ships (2.4 KB), and the *cost* of that trade is measured rather than
  assumed: the generator compares Φ(z) against the corpus's true percentiles and prints the worst error
  per metric — **8.0 pp for words/sentence**, 4–7 pp for the rest, peaking near the middle of the
  distribution where the mean/median gap bites. Tails behave. Exact percentiles would need the quantile
  table back (the previous revision shipped 101 values × 5 metrics, 6.2 KB).
- Tone bands sit at the 93rd/7th percentile (≈ z ±1.5, which the smoke test asserts they agree with).
  On the sample text that surfaces `chars/word 92nd` (long words) while `% unfamiliar 63rd` is ordinary.
- **Chip fonts are colour-coded** on a continuous ramp (`deviationColor`): neutral grey at the corpus
  mean, cooling to green below, warming through amber to red above, saturating at ±2.5σ, with an exponent
  so the tint shows up outside the middle band rather than only at the extremes. The box stays neutral
  except outside ±1.5σ. Pure colour maths lives in `core/color.ts` (`mixHex`), the semantic ramp in
  `core/metrics.ts`; smoke.ts guards WCAG AA contrast for the whole ramp on paper.
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
- **Surprisal shading is a paper → red mix**, opaque rather than alpha: the rendered colour is exactly the
  colour that was checked, and opaque spans can be composited later with multiply/additive blends. The
  ceiling is derived: `maxMixForContrast()` binary-searches the largest mix keeping the preview ink
  (`--text` #1b1b1b at 13px) at WCAG AA — t = 0.645 → `#d65b5b`, 4.52:1. Re-derived at module load,
  so it follows the theme (black ink would allow t = 0.747 → `#d04141`; AA-large would allow `#c81e1e`).
  A 2.2 exponent keeps the median word ~13:1 against ink, so ordinary prose stays nearly clean.
- Highlight rings now use `--accent` rather than the annotation's own colour: on this ramp a word with no
  surprisal is shaded in the paper colour, so a tinted ring was invisible exactly when selecting it.
- **Surprisal is in the toolbar** as a real tool with one annotation per word, each carrying its own
  colour from the heat ramp (`AnnotationDraft.color`). Selecting a shaded word pins an inspector
  at the top of the results pane showing the model's whole distribution at that position (probability
  bars, bits, bits saved) and which of them was the word actually written.
- **Golub Syntactic Density Score** (`core/gsds.ts` + `core/syntax.ts` + `tools/gsds.tool.ts`):
  the ten published variables, weights, `Total = Σ weight × frequency`, `SDS = Total ÷ T-units` and the
  grade conversion. Formula checked against ED091741's worked example with no heuristics in the loop
  (`scoreGsds`); sample tally pinned at 163 words / 16 T-units / SDS 1.70. Five variables are
  closed-class counts; variables 1–4 share the T-unit/clause heuristics; variable 10 is the original
  program's suffix proxy. `Be / have` is an option (formula auxiliary-only vs the 1974 program's
  all-forms, since the paper measured the gap). The length dependence (Belanger 1978) is surfaced as an
  amber hint past 400 words. Smoke pins the known relative-clause over-capture rather than hiding it.
  Full audit: `docs/gsds-feasibility.md`.

## Next steps
- GSDS Stage 2: window the score to ~200-word blocks at sentence boundaries and average, so long
  documents get a comparable number instead of only the amber caveat.
- Optional: POS tagging from the local model process to firm up variables 2–4 and 10.
- Optional: perturbation as its own visual channel (the model's expected word underlined on the shaded
  word) — the data is already in the tool's annotations as `data.gain`.
- Surprisal windows arrive all at once; streaming them per window would give progress on long documents.

- An "unfamiliar words" tool that highlights exactly what `% unfamiliar` counts, reusing
  `isFamiliarWord` — makes the topbar number explainable and is the obvious companion to it.
- Cross-validate our metrics against the corpus's own columns (`Flesch-Reading-Ease`,
  `Flesch-Kincaid-Grade-Level`, `New Dale-Chall Readability Formula`): the xlsx already carries them, so
  the generator could report correlations and expose any weakness in the syllable heuristic.
- Show a percentile alongside the z-score  ← done, via the normal CDF (approximate: worst case 8 pp).
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
  percentile at +1σ), which is how that decision got justified with numbers rather than taste. Kept as a
  log line after the switch to z-scores.
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
- **GSDS mirrors the published instrument where it documented its rules** — the `-ing`/`-ed`/`-en`
  proxy for verbals, `for` after a comma as a coordinator, time adverbs and subordinators counted in
  both variables — rather than "fixing" them, so scores stay comparable to the published norms. The
  two places the sources disagree (be/have auxiliary vs all forms; the length-bound formula) are an
  option and a caveat, never a silent choice.

_Last updated: 2026-09-27_
