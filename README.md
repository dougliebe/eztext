# eztext

A single-page workbench for applying **many overlapping text-analysis extensions** to one document.
Type or paste text at the top, toggle tools in the toolbar, and read the results below — inspired by
[regex101](https://regex101.com/)'s split "input / explanation / match information" layout.

```
┌─ topbar ──────────────── document metrics ─────────────────────────────┐
├─ toolbar ── [Structure] Sentences · Verbs   [Readability] Readability ──┤
│                          ⚙ opens that tool's settings                  │├─ input (editable) ───────────┬─ preview (annotated, hoverable) ─────────┤
│                              │  tint + stacked underlines per layer    │
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
  nest one `<span>` per layer, give the outermost a background tint, and give every layer its own
  underline offset. That is how a verb inside a flagged sentence reads as one tint plus two stacked
  underlines.

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
    };
  },
};
```

Then register it in `src/tools/index.ts`:

```ts
export const tools: Tool[] = [sentencesTool, verbsTool, repeatedWordsTool, readabilityTool, echoTool];
```

That's the whole cost of a new extension. You get a toolbar chip, a settings popover, per-tool stats,
group filters, a result list, coverage tracks, JSON export, hover/click syncing with the preview, and
inclusion in `npm run smoke` for free.

### Rules of thumb

- **Never touch the DOM or React.** Tools run on every keystroke inside a `useMemo`.
- **Keep it O(n).** Run the shared tokenizers (`tokenizeWords`, `splitSentences`, `splitParagraphs`)
  instead of re-scanning the text.
- **Overlap freely.** Do not try to coordinate with other tools; layering is the engine's job.
- **Use `group`** for sub-categories. `"long"`, `"complex"`, `"auxiliary"` — they become filter chips
  and the per-row tag.
- **Explain inside `detail`, not in a footnote.** Every annotation carries a `detail` string shown on
  hover and in the row title — that is where a tool says *why* it fired on this range.

### Bundled tools

| Tool | What it demonstrates | Stats it produces |
| --- | --- | --- |
| **Sentences** | Broad structural annotations that everything else overlaps | count, avg/median words, longest, length variation |
| **Verbs** | A lexicon + morphology approach, auxiliaries vs main verbs, opt-in guessing | count, density, **avg words between verbs**, longest verb-free stretch, verbs/sentence |
| **Repeated words** | Off by default, options that change the entire result set | repeated types, occurrence share, top repeats, diversity |
| **Readability** | Producing both annotations and document-level scores | Flesch Reading Ease, Flesch–Kincaid, Gunning Fog, syllables/word |

## Layout of the code

```
src/
  core/
    types.ts        Tool, AnnotationDraft, Annotation, Segment, Stat, Note, ToolOption
    engine.ts       runAnalysis, sweep-line overlap resolution, option resolution
    metrics.ts      topbar metrics, corpus percentiles, Dale–Chall rules
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
scripts/            smoke + ui-check runners, corpus norms generator
```

State lives in `App.tsx` and is deliberately small: `text`, `enabled`, `options`, `tab`,
`hoverId`, `selectedId`, plus three persisted layout numbers. `text`/`enabled`/`options` are
persisted; `runAnalysis` is a pure `useMemo` over them, deferred with `useDeferredValue` so
typing never blocks on analysis.

## Interaction model

- **Toolbar chip** toggles a tool; **⚙** (or shift-click) opens its settings.
- **Topbar metric** (the five ratios) shades the preview by that metric — click again to clear.
- **Hover** a highlight, result row or coverage block → the same annotation lights up everywhere.
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

Each of the five ratios carries a small **percentile chip** — how far into the CLEAR corpus distribution
your value sits. `22nd` on words/sentence means your sentences are shorter than 78% of published
excerpts; `91st` on chars/word means your words are longer than 91% of them. Chip colour appears only in
the tails: ≥ 93rd shows amber, ≤ 7th shows green. Hovering gives the definition plus the numbers:

```
Average sentence length in words.

CLEAR corpus: 21.28 ± 9.23 (n=4,724) → 22nd percentile, easier than the average excerpt.
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
Words / sentence  21.2829 ± 9.2330
Chars / word       4.4419 ± 0.4345
% polysyllabic     0.0958 ± 0.0600     (9.6% ± 6.0%)
% unfamiliar       0.1757 ± 0.0990     (17.6% ± 9.9%)
Syllables / word   1.4147 ± 0.1649
```

Two things this makes obvious. First, the corpus averages **17.6% unfamiliar** words, so an absolute
"over 10% is hard" rule (which this README previously suggested) fires on nearly everything — the
bundled sample sits at a perfectly ordinary `66th` percentile. Second, CLEAR excerpts are a fixed ~174 words, so
comparing raw counts against them would be meaningless; only length-normalised ratios are recorded.

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
- Analysis runs on every keystroke for the whole document. Fine to ~100 KB; beyond that a worker
  and/or debounce is the next step.
- No shareable permalinks yet (only `localStorage`).
