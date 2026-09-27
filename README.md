# eztext

A single-page workbench for applying **many overlapping text-analysis extensions** to one document.
Type or paste text at the top, toggle tools in the toolbar, and read the results below — inspired by
[regex101](https://regex101.com/)'s split "input / explanation / match information" layout.

```
┌─ topbar ──────────────── document metrics ─────────────────────────────┐
├─ toolbar ── [Structure] Sentences · Verbs   [Readability] Readability ──┤
│                          ⚙ opens that tool's settings                  │
├─ input (editable) ───────────┬─ preview (annotated, hoverable) ─────────┤
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
| `npm run ui-check` | Drives your installed Chrome/Edge (via `playwright-core`, no browser download) against a running dev server to verify divider dragging, pane sizing and topbar height. Needs `npm run dev` in another shell. |

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
    metrics.ts      topbar metrics + Dale–Chall familiarity rules
    text.ts         tokenizers (words/sentences/paragraphs), syllables, formatting
    persistence.ts  namespaced localStorage + usePersistentState
    color.ts        hex → rgba helpers for layer tints
    data/           vendored word lists (dale-chall.ts)
  components/
    Toolbar, ToolOptionsEditor, InputPane, HighlightView, CoverageStrip,
    ResultsPane, ToolPanel, StatGrid, JsonView, Splitter
  tools/            one file per extension + index.ts registry
  dev/              headless smoke test and render check
  App.tsx           state, layout, topbar metrics, selection/hover wiring
```

State lives in `App.tsx` and is deliberately small: `text`, `enabled`, `options`, `tab`,
`hoverId`, `selectedId`, plus three persisted layout numbers. `text`/`enabled`/`options` are
persisted; `runAnalysis` is a pure `useMemo` over them, deferred with `useDeferredValue` so
typing never blocks on analysis.

## Interaction model

- **Toolbar chip** toggles a tool; **⚙** (or shift-click) opens its settings.
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
| % unfamiliar | Share of words outside the **Dale–Chall** list of ~3,000 familiar words. Below 5% reads as easy, above 10% as hard |
| Syllables / word | Estimated with the same vowel-group heuristic |

Thresholds are advisory only and show as colour on the value: words/sentence > 25, % polysyllabic ≥ 20%,
% unfamiliar ≥ 10%, syllables/word ≥ 1.7.

Everything is computed in `src/core/metrics.ts` — a pure function of the text, deliberately *outside* the
tool registry so the topbar never depends on which extensions are on.

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
