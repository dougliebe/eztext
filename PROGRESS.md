# Project Progress

## Current status
- Framework is complete and working: Vite + React + TypeScript SPA with a plugin-shaped tool
  registry, live analysis, overlap-aware highlighting, and a tabbed results pane.
- Topbar shows 11 always-on document metrics; each of the five ratios carries a **percentile chip**
  derived from its z-score against the CLEAR corpus, with a colour-coded font.
- The **Common words tool** is in: it flags exactly what `% unfamiliar` counts and, when a flagged word
  is selected, names the nearest common words — by meaning while the local model is running, by word
  family always. The list is the ~24,600 words most US readers know, so ordinary prose is usually clean.
- Selecting a word now shows **where the model goes next**: five five-word phrases, each from a different
  one of the model's likeliest next pieces (`POST /continue`). The ranked next-token table it replaced
  answered "what word did I miss"; the phrases answer "where is this sentence heading".
- `main` is **1 commit ahead of `origin/main`** at the time of writing, plus the work below, not yet pushed.
- `npm run build`, `npm run smoke` and `npm run ui-check` all pass (62 assertions in the browser, 151 in smoke).

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
- Results pane tabs: Stats (per-tool metric cards), JSON (copyable export of the whole run).
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
  % polysyllabic, % unfamiliar (common words) and Syllables/word, in a second visual group behind a
  divider. Metric values carry advisory colour thresholds and hover tooltips with the exact definition.
- Vendored the Dale–Chall list as data: `core/data/dale-chall.ts`, 2,949 entries, with the formula's
  own familiarity rule (plural, possessive, -ed, -ing, -er/-est, -ly, doubled consonants, hyphenated
  compounds) implemented as candidate-stem lookup in `isFamiliarWord`. **Replaced by the common-word
  list below** — the stemming rule stayed, because the new source carries inflections unevenly.
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
- **Surprisal norms** (`npm run model:norms` → `core/data/surprisal-norms.ts`): all 4,724 CLEAR excerpts
  scored with the same model, so the surprisal panel reports a percentile beside bits/token, bits/word and
  perplexity. 35 minutes, resumable via a JSONL cache, and the module is only written from a complete set.
  - `bits / token 5.1973 ± 0.6529`, `bits / word 6.4551 ± 0.9276`, `perplexity 40.5430 ± 18.5139`.
  - Guards on the model id: another model's scores get no chip, since the norms describe GPT-2.
  - The generator measures the normal-CDF drift per figure — perplexity 7.0 pp worst case (heavily skewed:
    mean 40.5 over median 37.4), bits/word 1.4 pp, bits/token 2.2 pp.
  - The sample document lands at the 47th percentile for bits/token and the 91st for characters per word:
    long words, ordinary predictability.
- `Stat.comparison` (percentile + z + population description) is the general form: the tool computes all
  three because it knows the population, and `StatGrid` only renders — no CDF inversion in the view.
- Shared `scripts/lib/`: the CLEAR xlsx reader and the model runner, so the two norms generators and the
  model server each have one implementation to depend on.
- Found a port collision worth remembering: a second dev server started elsewhere on this machine
  auto-incremented onto **5174**, and on Windows its specific `[::1]` bind won over the model server's
  wildcard one — so the Vite proxy resolved `localhost:5174` to that dev server, which answered `/health`
  with index.html and status 200. The app then failed with a JSON parse error rather than a connection
  error, and ui-check silently skipped the model checks. Fixed by binding the model to `127.0.0.1` and
  targeting `127.0.0.1` in the proxy, plus `strictPort: true` so a stray dev server fails loudly instead of
  drifting onto the model's port.
- The ui-check probe now checks the *content type* before trusting a 200, and reports why it skipped.

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
- **Common words tool** (`src/tools/common-words.tool.ts`, renamed from Dale–Chall when the list
  changed): flags every word outside the list and offers replacements for each, grouped by how it can
  be fixed (`base form`, `shorter form`, `similar meaning`, `no match` — which double as the filter
  pills). Options: prevalence threshold, suggestions per word, meaning match, highlight only words with
  a match, and an opt-in filter for capitalised names that do not open a sentence. Each suggestion also
  carries **p(known)** — the stored probit read as a probability (`normalCdf`), shown as a right-aligned
  “Known” column beside the relation, one decimal so the 99.5% ceiling is not rounded up to certainty.
- **Suggestions are ranked by how much they help, not by string distance**: word family first
  (“passage” → pass, “reshaping” → shape, “writers” → write — a shorter word for the same idea is what
  a readability tool is for), then embedding neighbours **by meaning**. There is deliberately no third
  tier: spelling distance was removed because on the words that actually get flagged it offered
  coincidence instead of vocabulary — “merely” → “merry”, “defenestration” → “deforestation”,
  “perspicacious” → “perspiration” — and where spelling was not available the honest answer is the
  family match or nothing. Consequence: with the model process stopped, only word-family suggestions
  exist, and the panel's “Nearest words from” stat says so.
- **Local word embeddings in the model process** (`scripts/word-embeddings.mjs`, served at
  `POST /similarity`): bge-small-en-v1.5 (34 MB, measured clearly better than MiniLM on single words),
  the 2,941-word list embedded once (1.8 s) and cached as 6 MB of vectors in gitignored `.models/`. A
  document then costs one embedding per *new* flagged word and ~5 ms to rank — 11 ms warm, 24 ms with a
  new word. The familiarity rule and the tokenizer are bundled from `src/core/metrics.ts` /
  `text.ts`, so the process and the app cannot disagree about what counts as unfamiliar.
- **The overlap renderer nested its layers backwards**: the widest annotation (a sentence) ended up as
  the deepest element under the pointer, so a click inside an overlap selected the structural
  annotation instead of the word. Wrong since the framework commit, and invisible until a ui-check
  clicked a flagged word and got a sentence back. `HighlightView` now wraps narrowest → widest, which
  is what the engine's layering contract always said.

- Results pane is **statistics only**: the per-annotation row lists and their group filter pills are gone
  (a thousand rows of "the = 1.2 bits" is noise). Annotations are browsed by clicking the preview, the
  coverage strip, or the JSON tab. ToolPanel, the dead row/pill CSS (150 lines) and the render-check
  assertion all went with them.
- Selecting is a **toggle**: clicking whatever is already selected clears the inspector, in the preview
  and in the coverage strip alike.
- Verified the Dale-Chall work that landed in parallel still functions against the stats-only panels
  (7 stats each, 0 row lists) and that its selection card still appears.
- **Where the model goes next**: the inspector's ranked next-token table is replaced by five five-word
  continuations, asked of a new `POST /continue` (`.tmp/probe-continue*.mjs` hold the measurements that
  shaped it).
  - The prompt stops where the selected word **starts**, not where it ends, so the model's first word is
    its candidate for the slot the writer filled: "I want to eat ␣salmon␣" asks about "I want to eat …",
    and the answers are salmon's replacements and where each would have led. A row opening with the writer's
    own word is tagged "written"; when no row is tagged, the model never expected that word at all.
  - **The prompt must not end in a space.** GPT-2's BPE folds a word boundary into the next token, so a
    trailing space leaves it holding a bare `"Ġ"` — a state absent from its training text — and it answers
    with the separator rows of its web corpus (`"___________"`, `"----"`). Measured across the sample
    document: **26% of rows** were that junk, and **0%** after trimming the trailing space. A ui-check
    assertion now guards it ("no continuation is separator junk"). A second assertion asks the model the
    same question directly and requires the table to match, which is what proves the client sliced the
    prompt at the word's *start* — an off-by-one-word prompt looks perfectly plausible in the table.
  - **Words, not tokens** — the question of which is easier, answered by measurement: five complete words
    need 6–9 tokens (median 8, `.tmp/probe-tokens.mjs`), and a fixed 8-token cut lands on a word boundary
    only 89% of the time, so ~1 row in 9 would read "salmon on a pl". Cost is the same either way (~8
    forwards), so the word rule stays and every row shows five whole words.
  - The five openings are forced to be **distinct** — five beams that all start with the same word say
    nothing — and each branch then walks greedily, accumulating its own exact `−log₂ P` per piece.
  - `generate()` is unusable for this: `num_beams: 5, num_return_sequences: 5` returned **one** row, the
    scores are a `// TODO` in v4.3, and the sampler takes only the first of the candidates it ranks.
  - The KV cache is unusable too: the merged ONNX graph takes no `position_ids` input, so a hand-driven
    cache step disagreed with a full forward pass by **3.7 logits** while producing fluent text. That is
    the dangerous kind of wrong, and it is why the walk re-feeds the sequence instead.
  - Cost is context × forwards, all five rows in every forward: 17 tokens 0.7 s, 69 tokens 1.8 s, 99 tokens
    2.4 s, 175 tokens 4.2 s. Hence a 200-character context cap (~1 s), a debounce, a per-position cache,
    and an abort when the selection moves on.
  - `scoreWindow`'s ranking was extracted as `rankNext(logits, base, vocab, topK, decode, againstLogit?)`
    so the walk reuses the app's own top-k code rather than growing a second copy, and
    `SurprisalAlternative` gained the token `id` the walk needs.
  - The refactor was wrong on the first attempt in a way smoke caught immediately: `againstLogit` was
    handed a raw logit where a log-probability was wanted, so every `gain` was off by `logZ`. Worth
    remembering that this is exactly the class of error the synthetic-vocabulary tests exist for.
  - EOS branches are dropped when branching (a row that opens with end-of-text has no words to show) and
    never displayed when they end a phrase.
  - The table is bits-only and 620 px wide: probability is a monotone transform of bits, and the results
    pane is as wide as the window, which stranded the numbers a screen away from the phrases.
- **Fixed a latent server bug while restarting it**: `warmEmbeddings()` existed "for the server's startup
  path" but was never called, so a fresh process paid the embedding load inside the first `/similarity`
  request — which the app abandons whenever the text changes. The Common words tool then silently fell
  back to spelling suggestions, which is how the ui-check surfaced it (a real flake, not a test artifact).

## Pane vocabulary

Fixed names, used in the code and these notes: **input pane** (top left), **preview pane** (top right,
the highlights plus the coverage strip), **results pane** (bottom), **inspector** (the panel that opens at
the top of the results pane when something in the preview is selected).
- The results and stats tabs turned out to render the identical stat grids — verified in the browser, 15
  cards each, zero differing — and had since the early commits; the annotation rows were their only real
  difference, so removing the rows exposed the duplication rather than causing it. The Results tab is gone;
  `Stats` and `JSON` remain, and `ToolPanel` is the single implementation (it was already stats-only).
- `SelectionCard` is renamed `Inspector` (classes `.inspector*`) so the code says what we call it.
- ui-check now returns to the Stats tab after its tab loop: the JSON tab *replaces* the panels, so
  assertions after that point were finding none.
- **Golub Syntactic Density Score** (`core/gsds.ts` + `core/syntax.ts` + `tools/gsds.tool.ts`):
  the ten published variables, weights, `Total = Σ weight × frequency`, `SDS = Total ÷ T-units` and the
  grade conversion. Formula checked against ED091741's worked example with no heuristics in the loop
  (`scoreGsds`); sample tally pinned at 163 words / 16 T-units / SDS 1.70. Five variables are
  closed-class counts; variables 1–4 share the T-unit/clause heuristics; variable 10 is the original
  program's suffix proxy. `Be / have` is an option (formula auxiliary-only vs the 1974 program's
  all-forms, since the paper measured the gap). The length dependence (Belanger 1978) is surfaced as an
  amber hint past 400 words. Smoke pins the known relative-clause over-capture rather than hiding it.
  Full audit: `docs/gsds-feasibility.md`.
- **Highlight renderer shows tint only** (user request): the stacked per-layer underlines are gone.
  Each nested layer still washes its own translucent background, and the washes compound on overlap,
  so depth remains visible without any decoration under the text.
- **Inspector no longer covers the panels** (user report): it was a `position: sticky` panel inside
  the scrolling results body, and a tall one (373px on the GSDS dense view, in a ~140px pane) stacked
  over the content and made both unreadable. It is now a bounded region between the tab bar and the
  scrolling panels (`pane__inspector`, `max-height: min(60%, 340px)`, internal scroll), so it still
  stays put but cannot overlap.
- **GSDS now highlights density, not tokens** (user request): the default view ranks T-units by their
  exact share of the weighted total — `core/gsds.ts` computes a per-unit decomposition whose shares sum
  back to the published contributions, which smoke verifies to 1e-9 — shades the top quarter with a
  graded alpha, and the inspector lists the contributors (`30 words = 1.78`, `2 time adverbs = 1.20`, …)
  under the canonical fix. The counted words inside each shaded unit are highlighted with one hue per
  feature group (six hues, smoke asserts they are distinct and each AA-legible over the region's wash),
  so the sentence shows its time adverbs, modals and so on instead of only counting them; the inspector
  names them too (`2 time adverbs — while, before`). The audit view keeps every counted feature for
  hand-checking the tally. The three highlight checkboxes are gone; the options are view / top% /
  show-words / be-have.
- **Every tool explains its groups** (`ToolResult.summary` + `groupDescriptions` + `groupExamples`):
  the results panel renders one general line above the stats and a per-group “what this means / what to
  do / one canonical fix” list below them, and the selection inspector shows the fix example for
  whatever was clicked. GSDS states that density is not an error; Readability and
  Surprisal got descriptions too (Surprisal has no examples — its alternatives table is the fix).
  Smoke fails if a group has no explanation or if examples cover only some of a tool's groups; the
  render check asserts the explanations reach the page.
- **Stats-pane percentile norms** (`npm run stats:norms` → `core/data/stat-norms.ts`): the generator runs
  `readabilityTool` and `gsdsTool` over all 4,724 CLEAR excerpts with default options, so the norms come
  from the implementation rather than a second copy of the formulas. Eleven rates/scores now get chips:
  Flesch 65.55 ± 17.82, FK 9.40 ± 4.32, Fog 12.35 ± 4.67, syllables 1.41 ± 0.16, complex words 9.6% ± 6.0%,
  words/sentence 21.29 ± 9.23, SDS 4.74 ± 2.40, words/T-unit 15.91 ± 5.12, sub/T-unit 0.55 ± 0.34,
  main clause length 11.78 ± 3.68, sub clause length 7.45 ± 2.42. The two metrics that overlap the topbar
  (syllables/word, words/sentence) match the existing norms to 1e-3, which smoke asserts. The generator
  prints the normal-CDF error per stat; worst is 9.4 pp (sub clauses/T-unit).

## Next steps
- GSDS Stage 2: window the score to ~200-word blocks at sentence boundaries and average, so long
  documents get a comparable number instead of only the amber caveat.
- Optional: POS tagging from the local model process to firm up variables 2–4 and 10.
- Optional: perturbation as its own visual channel (the model's expected word underlined on the shaded
  word) — the data is already in the tool's annotations as `data.gain`.
- Surprisal windows arrive all at once; streaming them per window would give progress on long documents.
- Continuations are greedy *within* a branch. A real beam search (proper joint scoring across branches)
  needs a working KV cache, which this ONNX export does not offer — see the README for the measurements.
  If a better model is ever swapped in, the cheapest real gain is a **larger context** (200 characters is
  a responsiveness choice, ~1.3 s) or more branches; `POST /continue` takes `words`, `branches` and
  `contextChars`.

- Context-aware suggestions: the common-word neighbours are word-level, so a masked pass over the
  sentence (“…the patience it demands is [MASK]”) would use the surrounding text as well — one forward
  pass per occurrence, and the model process already knows how to read a distribution at a position.
  (Tried once with GPT-2's own next-token alternatives and rejected: they are dominated by punctuation
  and function words, and rare words are split into subword pieces.)
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
- **The familiar-word list is vendorable data, not a dependency**: a user-supplied
  `Word, Prevalence_US` table is reduced to the words above 1.6 and written to
  `core/data/common-words.ts` (24,607 entries, 229 KB) by `npm run words:common -- <csv>`, so the app
  keeps zero runtime deps and the list is regenerable without the CSV in the repo.
- **Prevalence is knowledge, not frequency** — and that is the better bar for this metric. The source
  scores how widely US readers *recognise* a word, which is why `the` sits below `cat` (asking “do you
  know this word?” of a function word is odd) and why obscure entries run far below zero. A word above
  the threshold is one a typical reader knows, which is exactly what the tool should treat as familiar.
  The cost of the swap: the list is eight times the size of the Dale–Chall one, so ordinary prose now
  scores ~5% unfamiliar instead of ~18% (CLEAR corpus mean 5.1%, sd 3.9pp after regenerating the
  norms) **at the default floor**. Because that makes the metric quiet, the bar itself became a
  setting: the tool's `Prevalence threshold` option (1.6…2.6) drives the metric, the heatmap,
  the suggestions and the embedding service together, so the tool's count still equals `% unfamiliar`
  at any setting (at 2.0: 16,412 words, and the sample's 0% becomes 1.2%). Each stored word keeps its
  score (written as `<score> word word …`, 242 KB) and nothing at or below the floor is stored, so a
  lower setting could not be honoured. Tests drive the tool with a sentence built from genuine misses
  (`The antediluvian brutalist edifice obfuscated the zygote.`) rather than the sample.
- **Closed-class words are exempt from the threshold** (`core/data/function-words.ts`, 212 entries):
  the prevalence survey asks whether you *know* a word, which is a strange question about `is` (1.93)
  or `a` (2.05) while `cat` and `water` sit at the 2.58 ceiling. Without the exemption, raising the
  threshold counts grammar rather than vocabulary — at 2.0 the first flagged word in ordinary prose
  was `is`, and at 2.2 it was `is`, `when`, `not`, `a`, `so`; with it, 2.0 flags `nevertheless` and
  `prose`. The exemption also caught `has`, `having`, `nor`, `onto` and `others`, which the survey
  scores at or below the floor and which were being reported as unfamiliar words at the default.
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
- **Overlap rendering**: one nested `<span>` per covering layer — each layer gets a translucent
  background wash and the washes compound where layers overlap, so depth reads as a deeper tint with
  no CSS blending tricks. Underlines were removed at the user's request; the tint carries the depth
  instead of a decoration under the text.
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
- **Word similarity comes from embeddings, not a classifier** (and not from Laya, which is a typed
  decision router whose options share a fixed token budget — it is not an embedding service). “Which
  familiar word means most nearly this one?” is a ranking over a fixed 3,000-word list, so it is cosine
  similarity over a precomputed matrix: no training, no labels, ~10 ms, on the local process the
  surprisal tool already uses.
- **The `similarity` signal is keyed by word, not by document, and is optional.** A word's embedding
  does not depend on where it appears, so answers accumulate across edits instead of being discarded on
  every keystroke; a model that is not running means no signal, not an error, and the tool falls back to
  word family alone. The tool re-checks every neighbour against the common-word list before showing it — the
  signal crosses a process boundary, and “this word is on the list” has to survive bad data.
- **Meaning suggestions are refused for words the embedding model does not really know.** Measured on
  the 24,607-word list: words the model has learned tokenize in 1–2 pieces and get sensible neighbours
  (“ubiquitous” → universally/commonplace 0.77, “esoteric” → occult 0.81), while rare words split into
  3–5 pieces and come back with *confident* nonsense — “bibliopolic” → bibliographic 0.83,
  “litotes” → lit 0.76, “zygote” → pokey 0.67. Those scores sit *above* the good answers, so no cosine
  floor can separate them. The service therefore asks the model's own tokenizer whether it knows the
  word (more than 2 pieces = refuse, empty list) and lets word family answer instead: all
  eighteen rare words probed now return nothing, and the good answers survive. The floor stays 0.55 on
  the server because the tool's `match` strength decides what to show.
- **Nothing leaves the machine**: the weights download once (34 MB) and are then loaded from
  `.models/` — verified by loading with remote fetches disabled — and no API is involved. bge-small's
  original weights are MIT (the ONNX conversion repo states no licence), and GPT-2 is MIT, so unlike the
  CC BY-NC-SA CLEAR corpus these carry no non-commercial constraint.
- **GSDS mirrors the published instrument where it documented its rules** — the `-ing`/`-ed`/`-en`
  proxy for verbals, `for` after a comma as a coordinator, time adverbs and subordinators counted in
  both variables — rather than "fixing" them, so scores stay comparable to the published norms. The
  two places the sources disagree (be/have auxiliary vs all forms; the length-bound formula) are an
  option and a caveat, never a silent choice.
- **Stats-pane percentiles are for rates, not counts**: CLEAR excerpts are a fixed ~174 words, so a count
  of long sentences, unfamiliar words or weighted features would measure length rather than the writing —
  the topbar made the same call. The chip's colour always follows difficulty, so `higherIsEasier` flips
  Flesch Reading Ease's tint while leaving its percentile alone, and the length-bound SDS drops its chip
  past 400 words while the length-normalised GSDS rates keep theirs.

_Last updated: 2026-09-27_
