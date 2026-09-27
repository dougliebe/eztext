# eztext

A single-page workbench for applying **many overlapping text-analysis extensions** to one document.
Type or paste text at the top, toggle tools in the toolbar, and read the results below — inspired by
[regex101](https://regex101.com/)'s split "input / explanation / match information" layout.

```
┌─ topbar ──────────────── document metrics ─────────────────────────────┐
├─ toolbar ── [Readability] Readability · … your tools here ─────────┤
│                          ⚙ opens that tool's settings                  │├─ input (editable) ───────────┬─ preview (annotated, hoverable) ─────────┤
│                              │  tint per layer, darker on overlap      │
│                              ├─ coverage strip: one track per tool ────┤
├────────────── draggable splitter ──────────────────────────────────────┤
│ results │ stats │ JSON   —  per-tool panels, metrics, machine output   │
└─ statusbar ─────────────────────────────────────────────────────────────┘
```

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck (`tsc --noEmit`) then production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Types only |
| `npm run smoke` | Headless checks: runs the pipeline over the sample document, asserts engine invariants, and server-renders the whole app |
| `npm run ui-check` | Drives your installed Chrome/Edge (via `playwright-core`, no browser download) against a running dev server to verify divider dragging, pane sizing, topbar height and that the page is actually styled. Needs `npm run dev` in another shell. |
| `npm run corpus:norms` | Downloads the CLEAR corpus (if absent) and regenerates `src/core/data/corpus-norms.ts`. Needs no dependencies. |
| `npm run model` | Starts the local surprisal model on `:5174` (proxied as `/api/model`). Add `-- --score "text"` or `-- --file draft.txt` to score from the terminal. |

## The mental model

Everything is a **tool** (the words *tool* and *extension* are interchangeable here). A tool is a pure
function of `(text, options)` that returns annotations and stats. Nothing else. The engine runs
every enabled tool, resolves all the ranges they return into a flat set of non-overlapping
**segments**, and the UI just renders segments.

```
text ─┬─► sentences ──┐
      ├─► verbs ──────┤   normalise   sweep-line      render
      ├─► repeats ────┼─► ranges ───► segments ─────► nested spans
      └─► readability ┘                              + result rows
                                                     + coverage tracks
```

The two contracts that make this work:

- **`AnnotationDraft`** — what a tool returns: a range plus *why*. The engine fills in ids, the tool
  id, and the covered text, clamps ranges to the document, and drops empty ones.
- **`Segment`** — a maximal run of text whose covering annotations never change, with `layers` ordered
  widest → narrowest. Segments tile the document exactly once, so overlap rendering becomes trivial:
  nest one `<span>` per layer and give each a translucent background wash. The washes compound where
  layers overlap, so a verb inside a flagged sentence reads as a deeper tint — highlighting only, with
  nothing drawn under the text.

Layering order is deterministic: widest annotation at the bottom, then registry order, then position.

## Writing a tool

Create `src/tools/echo.tool.ts`:

```ts
import type { Tool } from '../core/types';
import { tokenizeWords } from '../core/text';

export const echoTool: Tool = {
  id: 'echo',
  name: 'Echo',
  description: 'Highlights every word that repeats back-to-back.',
  category: 'lexical',              // structure | grammar | lexical | readability | utility
  color: '#56d39a',                 // highlight colour for this tool
  defaultEnabled: false,
  options: [                        // declared once — the toolbar renders the UI for you
    { kind: 'boolean', id: 'strict', label: 'Case sensitive', default: false },
    { kind: 'number', id: 'maxGap', label: 'Max words between', default: 2, min: 0, max: 10, step: 1 },
  ],

  run({ text, options }) {
    const strict = options.strict === true;
    const maxGap = Number(options.maxGap ?? 2);
    const words = tokenizeWords(text);

    const annotations = [];
    for (let i = 1; i < words.length; i += 1) {
      const previous = words[i - 1];
      const current = words[i];
      const left = strict ? previous.text : previous.lower;
      const right = strict ? current.text : current.lower;
      if (left !== right || i - i > maxGap) continue;   // your logic here

      annotations.push({
        start: current.start,
        end: current.end,
        label: current.text,
        group: 'echo',                // drives the filter chips in the results pane
        detail: `Repeats “${previous.text}”.`,
        data: { wordIndex: i },       // exported in the JSON tab
      });
    }

    return {
      annotations,
      stats: [
        { id: 'echo.count', label: 'Echoes', value: annotations.length, tone: 'accent' },
      ],
      summary: 'Higher counts mean more back-to-back repetition.',
      groupDescriptions: { echo: 'Two identical words in a row — a stutter or a typo.' },
      groupExamples: { echo: '“the the plan” → “the plan”' },
    };
  },
};
```

Then register it in `src/tools/index.ts`:

```ts
export const tools: Tool[] = [readabilityTool, echoTool];
```

That's the whole cost of a new extension. You get a toolbar chip, a settings popover, per-tool stats,
a summary and per-group explanations with one canonical fix example each, group filters, a result
list, coverage tracks, JSON export, hover/click syncing with the preview, and inclusion in
`npm run smoke` for free.

### Rules of thumb

- **Never touch the DOM or React.** Tools run on every keystroke inside a `useMemo`.
- **Keep it O(n).** Run the shared tokenizers (`tokenizeWords`, `splitSentences`, `splitParagraphs`)
  instead of re-scanning the text.
- **Overlap freely.** Do not try to coordinate with other tools; layering is the engine's job.
- **Use `group`** for sub-categories. `"long"`, `"complex"`, `"auxiliary"` — they become filter chips
  and the per-row tag.
- **Explain inside `detail`, and explain the category once.** Every annotation carries a `detail`
  string shown on hover and in the row title — that is where a tool says *why* it fired on this range.
  The optional `summary`, `groupDescriptions` and `groupExamples` fields say what the tool's numbers
  mean, what each group is for, and one canonical before → after fix. The results panel renders the
  descriptions, and the selection inspector shows the example for whatever was clicked. `npm run
  smoke` fails if a group has no description, or if examples cover only some of a tool's groups.
- **Shade items individually** with `AnnotationDraft.color` (any hex) and/or `AnnotationDraft.alpha` (0–1).
  Omit `alpha` and the renderer derives an opacity from the layer stacking, which is the right default for
  overlaps; supply `alpha: 1` for an opaque shade whose rendered colour is exactly the one you measured —
  which is also what lets the same spans be composited later with `multiply` or an additive blend.
- **Ask for external data with `requires`.** A tool that needs a model declares it, reads it from
  `ctx.signals`, and *degrades gracefully* when it is absent — return a status `Stat` rather than throwing.
  The app owns fetching it; the engine stays pure.

### Bundled tools

| Tool | What it shows | Stats it produces |
| --- | --- | --- |
| **Readability** | Long sentences and complex words overlapping, so it exercises the layering | Flesch Reading Ease, Flesch–Kincaid, Gunning Fog, syllables/word, complex-word share |
| **Surprisal** | Every word shaded transparent → red by how many bits the language model needed to predict it | mean bits/token, perplexity, hardest words, top-decile count, model name |
| **Syntactic density** | The densest T-units shaded, with a click-through breakdown of the weighted shares behind each one (audit view highlights every counted feature) | SDS, grade equivalent, weighted total, densest T-unit, and every frequency with its weight and contribution |

Earlier revisions shipped Sentences, Verbs and Repeated-words tools as worked examples of the contract.
They were removed because they were demonstrations rather than things worth reading with — the recipe
above is the documentation instead. They remain in git history (`git log -- src/tools`) if a
future tool wants the verb lexicon or the sentence-boundary heuristics.


## Layout of the code

```
src/
  core/
    types.ts        Tool, AnnotationDraft, Annotation, Segment, Stat, Note, ToolOption
    engine.ts       runAnalysis, sweep-line overlap resolution, option resolution
    metrics.ts      topbar metrics, z-scores + CDF percentiles, Dale–Chall rules
    gsds.ts         Golub Syntactic Density Score: lexicons, detection, weights, grade conversion
    syntax.ts       T-units, subordinate clauses, verb-ish tests (shared by structure tools)
    surprisal.ts    language-model surprisal: logits → per-word bits, perturbation gains
    heatmap.ts      click-a-metric preview shading (document-relative intensity)
    text.ts         tokenizers (words/sentences/paragraphs), syllables, formatting
    persistence.ts  namespaced localStorage + usePersistentState
    color.ts        hex → rgba helpers for layer tints
    data/           vendored data: dale-chall.ts, corpus-norms.ts (generated)
  components/
    Toolbar, ToolOptionsEditor, InputPane, HighlightView, HeatmapView, CoverageStrip,
    ResultsPane, ToolPanel, StatGrid, JsonView, Splitter
  tools/            one file per extension + index.ts registry
  dev/              headless smoke test and render check
  App.tsx           state, layout, topbar metrics, selection/hover wiring
scripts/            smoke + ui-check runners, corpus norms generator, local model server
```

## Surprisal (local language model)

`npm run model` starts a **local** process that scores the document with GPT-2 and serves it at
`/api/model`, which Vite proxies so the app stays same-origin. Nothing leaves the machine: the weights
download once into `.models/` (gitignored, 125 MB) and every run after that is offline.

Surprisal is `−log₂ P(token | everything before it)` — how many bits the model needed to encode what you
actually wrote. It is the strongest cheap signal for "where is this hard": human reading times track it
closely, and it needs no hand-written rules about difficult words.

One forward pass yields both outputs:

| Output | Definition |
| --- | --- |
| **Surprisal per word** | summed over the word's subword pieces, since a word's probability is the product of its pieces |
| **Perturbation gain** | the bits the model's *own* preferred piece would have saved at that position — how obvious an alternative it saw. First-order and local: what the best substitution would gain *here*, not how the rest of the sentence would re-flow |

Both come from the same logits, so the second is free. Worked examples from the sample text:

```
  bits   word              model expected instead
 12.01  " Nevertheless,"   ""        (11.0 bits cheaper) — it wanted the sentence to end
 12.81  " spine"           "entire"  ( 7.4 bits cheaper)
 11.88  " decode"          "read"    ( 7.5 bits cheaper)
  1.28  " the"             —
  0.00  "The"             —          (nothing precedes it)
```

### Model choice

| Model | ONNX file | Size | Notes |
| --- | --- | --- | --- |
| `Xenova/gpt2` (default) | `decoder_model_merged_quantized` | 122 MB | the convention in the surprisal literature; 1024-token context |
| `Xenova/distilgpt2` | `model_quantized` | 226 MB | smaller, weaker |
| `Xenova/gpt2-medium` | — | ~350 MB | better expectations, ~3× the compute |

Switch with `MODEL=` / `MODEL_FILE=`. Measured on this machine with native ONNX Runtime:

```
197-token document    396 ms  (158 ms forward)
1,198-token document  2.5 s   (two windows)
```

### How it is wired

- **A tool, not a view mode.** `src/tools/surprisal.tool.ts` shades one annotation per word on a
  **paper → red ramp**: opaque `mixHex` colours from the page background to `--bad`, so the rendered shade
  is exactly the shade that was checked for legibility. It declares `requires: ['surprisal']`; when the
  scores are missing or stale it returns a status card instead of annotations, so it can never shade the
  wrong ranges.

  The ramp's ceiling is **derived, not chosen**. `maxMixForContrast()` in `core/color.ts` binary-searches
  the largest mix that keeps the preview's own ink (`--text` #1b1b1b at 13px) at WCAG AA, and the answer is
  **t = 0.645 → `#d65b5b`, 4.52:1**. The search re-runs at module load, so the cap follows the theme: a
  darker ink buys a deeper red (`--text-strong` #000 would allow t = 0.747 → `#d04141`), and relaxing to
  AA-large would allow `#c81e1e`. A 2.2 exponent on the curve keeps the median word around 13:1 against
  ink, so ordinary prose stays nearly clean.
- **Native, not WebAssembly.** Running in Node means native ONNX Runtime (several times faster than the
  browser build), no 122 MB download into your browser cache, and no `onnxruntime-web` in the app bundle.
  `@huggingface/transformers` is therefore a devDependency — it never enters `dist/`.
- **Signals keep the engine pure.** The app fetches model output *outside* `runAnalysis` and passes it as
  `signals`; tools read `ctx.signals`. `runAnalysis` stays a synchronous pure function of its inputs, which
  is what keeps `smoke.ts` trivial and stops typing from ever waiting on a model.
- **Scoring is explicit.** Nothing runs on a keystroke: the Run control in the input bar owns it. Editing
  after a run marks the scores stale, and stale scores are withheld — the tool shows “Text changed” and
  the button turns amber.
- **One implementation.** `src/core/surprisal.ts` owns the arithmetic (log-softmax, top-k, subword →
  word folding, quantiles) and has no model in it. The server bundles that file with esbuild, exactly as
  the corpus generator bundles `metrics.ts`, so the process and the app cannot drift apart.
- **Documents longer than the context** are scored in 1024-token windows, each borrowing one token of
  left context so no token is scored as if it opened the document.
- **Line endings are normalised** to `\n` first: GPT-2 was trained on `\n`, so a Windows `\r` is
  essentially unmodellable (50+ bits) and would pollute every paragraph break.
- Requests are serialised (one forward pass at a time) and the model loads once, in the background, at
  startup.

State lives in `App.tsx` and is deliberately small: `text`, `enabled`, `options`, `tab`,
`hoverId`, `selectedId`, plus three persisted layout numbers. `text`/`enabled`/`options` are
persisted; `runAnalysis` is a pure `useMemo` over them, deferred with `useDeferredValue` so
typing never blocks on analysis.

## Interaction model

- **Toolbar chip** toggles a tool; **⚙** (or shift-click) opens its settings.
- **Run model** in the input bar scores the document with the local language model (see *Surprisal*).
- **Topbar metric** (the five ratios) shades the preview by that metric — click again to clear.
- **Hover** a highlight, result row or coverage block → the same annotation lights up everywhere.
- **Click** any highlight — including a surprisal-shaded word — and the results pane pins a bounded
  inspector above the scrolling list: the selected text in context, the rule that fired, an example fix,
  and (for dense GSDS units) the weighted shares behind the range. A tall inspector scrolls internally
  rather than covering the list.
- **Click** a result row or coverage block → the preview scrolls to that annotation and the row is
  kept in view. Clicking `JSON` gives you the whole run, ready to copy.
- **Drag the splitters** (or focus one and use arrow keys) to rebalance input / preview / results.

## Topbar metrics

The topbar always shows eleven numbers, regardless of which tools are enabled. The first group are corpus
counts; the second are the per-word and per-sentence ratios that readability formulas are built from,
and they are the ones with hover tooltips explaining the definition.

| Metric | Definition |
| --- | --- |
| Words | Word tokens — letters/digits, allowing internal `'` and `-` (`don't`, `well-known` = 1 word) |
| Sentences | Heuristic sentence splitter; never crosses a blank line |
| Paragraphs | Blocks of consecutive non-blank lines |
| Characters | Every character in the document, whitespace included |
| Read time | `words ÷ 200` |
| Annotations | Highlights produced by all enabled tools (accent colour) |
| Words / sentence | `words ÷ sentences` |
| Chars / word | Letters and digits only — punctuation, spaces and apostrophes excluded. This is the divisor ARI and Coleman–Liau use |
| % polysyllabic | Share of words with 3+ syllables (estimated from vowel groups) |
| % unfamiliar | Share of words outside the **Dale–Chall** list of ~3,000 familiar words |
| Syllables / word | Estimated with the same vowel-group heuristic |

Each of the five ratios carries a small **percentile chip**, computed from its z-score against the CORPUS
with the normal CDF. `24th` on words/sentence means your sentences are shorter than the typical excerpt;
`92nd` on chars/word means your words are longer. All five point the same way (higher = harder to read),
so a high percentile is always "more difficult than the average excerpt".

The z-score behind it is in the tooltip and on the element (`data-z`); the chip shows the percentile
because it is the more readable of the two. The chip's **font colour follows the z-score** on a continuous
ramp: neutral grey at the mean, cooling to green below it and warming through amber to red above it,
saturating at ±2.5σ.

```
z −2 → #0d7a0d     z −1 → #3a7336     z 0 → #6b6b63     z +1.7 → #895b04     z +2.4 → #b80d00
```

The box around it is tinted only outside the 93rd/7th percentile. Hovering gives the definition plus the
numbers:

```
Average sentence length in words.

CLEAR corpus: 21.28 ± 9.23 (n=4,724) → z-score −0.7, easier than the average excerpt
(24th percentile by the normal approximation; the corpus is skewed, so treat it as approximate).
```

Comparisons are suppressed entirely below 20 words, where the ratios are meaningless.

### Heatmaps (click a metric)

Each of the five ratios is a button. Clicking it shades the preview by how much every word or sentence
contributes to that value; clicking the same one again clears it, and only one can be active at a time.

| Metric | What gets shaded | Shading |
| --- | --- | --- |
| Words / sentence | whole sentences | hotter = more words |
| Chars / word | every word | hotter = more letters |
| % polysyllabic | only words of 3+ syllables | hotter = more syllables |
| % unfamiliar | only words off the Dale–Chall list | one flat colour, no ramp |
| Syllables / word | every word | hotter = more syllables |

Every shade carries a tooltip with the measurement and how it compares within this document
(`“Unfortunately” carries about 5 syllables — 3+ counts as polysyllabic.`), and the preview header swaps
the tool legend for the ramp, a one-line explanation and a **Clear** button.

Two deliberate choices:

- **Intensity is relative to the document, not the corpus.** The question a heatmap answers is "which
  sentences are longer *than the others here*", so the longest sentence here is always 100% hot. The
  corpus comparison lives on the percentile chips instead. The weakest shade keeps a floor (α 0.25 for words,
  0.14 for sentences) so low contributors are still visibly shaded, and whole sentences use a gentler
  range than single words because they cover far more of the page.
- **A heatmap replaces the tool highlights** rather than layering on top of them. Two colour systems at
  once would be unreadable — tool tints mean "this tool matched", heat means "this is long/hard". The
  coverage strip hides too, and the analysis keeps running underneath, so the Results pane is unchanged.

The selection is persisted, so a reload keeps you in the same view.

Everything is computed in `src/core/metrics.ts` — a pure function of the text, deliberately *outside* the
tool registry so the topbar never depends on which extensions are on.

### About the CLEAR corpus norms

`src/core/data/corpus-norms.ts` holds the mean and standard deviation of each ratio across the
[CLEAR](https://github.com/scrosseye/CLEAR-Corpus) corpus (CommonLit Ease of Readability;
Crossley, Heintz, Choi, Batchelor, Karimi & Malatinszky 2021/2022). Regenerate with:

```bash
npm run corpus:norms     # downloads the corpus to .corpus/, rewrites the norms module
```

The generator reads the xlsx directly (a zip of XML — no dependency), finds the `Excerpt` column *by
header text* rather than by letter, and computes every metric by bundling and running `core/metrics.ts`
itself, so the norms can never drift from the implementation.

```
4724 excerpts   words/excerpt 173.8 ± 17.1
metric                     mean       sd  p10      p50      p90
wordsPerSentence        21.2829   9.2330    11.34    20.25    31.33
charactersPerWord       4.4419   0.4345     3.92     4.40     5.01
polysyllabicShare       0.0958   0.0600     0.03     0.09     0.18
unfamiliarShare         0.1757   0.0990     0.06     0.16     0.31
syllablesPerWord        1.4147   0.1649     1.22     1.39     1.63
```

Those deciles are printed as a diagnostic (the generator computes them from the raw values) but not
shipped — the module is just `mean` and `sd` per metric.

**The percentile is a normal approximation of the z-score.** The module ships only a mean and a standard
deviation per metric (2.4 KB); the app converts `z` to a percentile with Φ(z). That assumes the metric is
normally distributed, and this corpus is not — words/sentence is right-skewed, running 3.9…101.5 with the
median (20.25) below the mean (21.28). So the generator measures the damage on every run, comparing Φ(z)
against where each value truly sits:

```
accuracy of the normal-CDF percentile
metric                  max error  worst at
wordsPerSentence            8.0 pp  true p75 claimed p67 (z 0.44)
charactersPerWord           4.1 pp  true p53 claimed p49 (z -0.03)
polysyllabicShare           6.6 pp  true p47 claimed p40 (z -0.24)
unfamiliarShare             6.7 pp  true p51 claimed p44 (z -0.14)
syllablesPerWord            6.2 pp  true p52 claimed p46 (z -0.10)
```

**Worst case ≈ 8 percentile points**, and (counter-intuitively) the error peaks near the *middle* of the
distribution, where density is highest and the mean/median gap shifts everything along. The tails are
well behaved. If exact percentiles are ever needed, the fix is to ship the quantile table — which is what
an earlier revision did, at 6.2 KB.

Two things this makes obvious. First, the corpus averages **17.6% unfamiliar** words, so an absolute
"over 10% is hard" rule (which this README previously suggested) fires on nearly everything — the
bundled sample sits at a perfectly ordinary `z +0.3` (63rd percentile). Second, CLEAR excerpts are a
fixed ~174 words, so comparing raw counts against them would be meaningless; only length-normalised
ratios are recorded.

**Licence:** the corpus is **CC BY-NC-SA 4.0** — non-commercial, share-alike, attribution required. Only
aggregate statistics are committed here, never the corpus text, and the generated file carries the
attribution. If eztext is ever used commercially, these norms need a licence review or a corpus swap.

### About the Dale–Chall list

`src/core/data/dale-chall.ts` vendors the list as data (2,949 entries) so the app keeps zero runtime
dependencies. The list comes from Dale & Chall's 1948 paper *A Formula for Predicting Readability*, as
reproduced by the ISC-licensed [`text-readability`](https://www.npmjs.com/package/text-readability)
package (v1.1.1). Familiarity follows the formula's own rule: a word counts as familiar if it is listed
**or** is a simple variant of a listed word — plural, possessive, `-ed`, `-ing`, `-er`/`-est`, `-ly`,
doubled consonants, or a hyphenated compound whose parts are all listed.

The list is deliberately narrow (words known to 80% of fourth-graders), so ordinary adult prose scores
high: the bundled sample text lands at ~21% unfamiliar. That is the formula working as intended, not a bug.

## Golub Syntactic Density Score

The **Syntactic density** tool implements Golub's (1973) score: ten weighted syntax features summed and
divided by the number of T-units (`Total = Σ weight × frequency`, `SDS = Total ÷ T-units`, then the
published linear grade conversion).

| # | Variable | Weight | Extraction |
| --- | --- | --- | --- |
| 1 | Words / T-unit | 0.95 | word tokenizer + T-unit splitter |
| 2 | Subordinate clauses / T-unit | 0.90 | subordinator/relative list + verb lookahead |
| 3 | Main clause word length | 0.20 | T-unit words minus merged clause spans |
| 4 | Subordinate clause word length | 0.50 | merged clause spans |
| 5 | Modals | 0.65 | closed list, token match |
| 6 | Be / have in the auxiliary position | 0.40 | closed list + next-word test |
| 7 | Prepositional phrases | 0.75 | closed list, local disambiguation |
| 8 | Possessives | 0.70 | pronoun list + apostrophe orthography |
| 9 | Adverbs of time | 0.60 | closed list, counted by form (as the instrument did) |
| 10 | Gerunds, participles, absolutes | 0.85 | the original program's suffix proxy |

Variables 5–9 are closed-class lookups and behave like real counts. Variables 1–4 all depend on one
component — T-unit and subordinate-clause segmentation in `core/syntax.ts` — and variable 10 reproduces
the 1974 program's rule (a >6-letter `-ing`/`-ed`/`-en` word with no be/have in the preceding three
words), which the paper itself called only "predominantly accurate". Every annotation therefore carries
the rule that fired, and the stats carry each variable's weight and weighted contribution, so the score
is auditable rather than oracular.

The default **dense view** answers the question a density score naturally raises: *where* is the prose
packed hardest, and why. `core/gsds.ts` attributes every part of the weighted total to the T-unit that
owns it (`units`), so each T-unit has an exact share; the tool shades the top quarter, darkest first,
and clicking one lists its contributors — `30 words = 1.78`, `2 time adverbs = 1.20`,
`23 subordinate-clause words = 0.88` … — which sum back to that unit's share of the published total.
The **audit view** flips to highlighting every counted feature, so the frequencies can be checked by
hand against the rules above.

Two properties of the instrument are surfaced instead of hidden:

- **Be/have has two published readings.** The hand formula counts only the auxiliary position; the 1974
  program counted *every* form and scored higher — ED090304 measured r = .96 against hand scoring and
  named the difference. The tool's `Be / have` option switches between them and reports both counts.
- **The literal score is sample-length dependent.** Variables 1–4 enter as rates, then the whole sum is
  divided by T-units again, so the score falls as a document grows at constant syntax density
  (Belanger 1978). The instrument was normed on ~200-word samples; the tool turns the stat amber past
  400 words and says so in the hint rather than presenting the raw number as comparable.

`npm run smoke` checks the formula against the published worked example (ED091741: 203 words, 16 T-units,
frequencies `12.7, .87, 8.2, 6.3, 5, 5, 18, 4, 3, 2` → Total 42.62 → SDS 2.7 → grade 4.0) before any
heuristic runs, then pins the sample document's tally (163 words, 16 T-units, SDS 1.70) and the T-unit
decisions (coordination splits, verb-phrase coordination does not, lists do not).

Sources: Golub (1973), ED091741; Kidder & Golub (1974), ED090304; O'Neal et al. (1983), ED237558.
The extraction audit and the staged plan are in `docs/gsds-feasibility.md`.

## Layout rules

Pane sizes are owned by the splitters, never by content. Concretely:

- The pane whose size a splitter controls is `flex: 0 0 auto` with a `height`/`width` percentage — it
  never shrinks and never derives a size from its children.
- The pane on the other side of the splitter is `flex: 1 1 0` with `min-*: 0` and `overflow: hidden`,
  so its content scrolls inside it instead of pushing the divider around.
- Fixed chrome (`pane__header`, `pane__footer`, the coverage strip, the splitters themselves) is
  `flex: 0 0 auto`.
- Drags are **delta based**: the ratio captured at pointer-down plus the pointer's travel, so the
  divider keeps its offset under the cursor and a mid-drag reflow cannot move it.

Getting this wrong is subtle — with content-driven flex bases, expanding a tool panel grows the
results pane, flexbox distributes the deficit across both panes, and the divider drifts upward. It
also makes a drag appear to "reset first", because the pointer is measured against a divider that has
already moved. `npm run ui-check` exists to catch exactly that.

## Known limits

- English-only heuristics; no POS tagger, so words that are both nouns and verbs (`walk`, `plan`)
  are always counted as verbs, and rare verbs are missed.
- The GSDS clause variables (1–4) inherit that limit: an unpunctuated relative clause is over-captured
  by the span rule, and a list item containing a relative clause can be mistaken for a coordinated
  clause. Variable 10 counts participial adjectives. Each annotation names its rule; the smoke test
  pins the known over-capture rather than pretending it away.
- Analysis runs on every keystroke for the whole document. Fine to ~100 KB; beyond that a worker
  and/or debounce is the next step.
- No shareable permalinks yet (only `localStorage`).
