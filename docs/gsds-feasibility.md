# Golub Syntactic Density Score — feasibility notes

_Investigated 2026-09-27 on `feat/gsds-tool`. Sources are the primary documents,
not secondary summaries; page images were used where PDF text extraction garbled
the tables._

## Sources

| ID | Document | URL |
|----|----------|-----|
| ED091741 | Golub, L. S. (1973). *Syntactic Density Score (SDS) with Some Aids for Tabulating.* | <https://files.eric.ed.gov/fulltext/ED091741.pdf> |
| ED090304 | Kidder, C. L. & Golub, L. S. (1974). *Computer Application of a Syntactic Density Measure* (AERA paper). | <https://files.eric.ed.gov/fulltext/ED090304.pdf> |
| ED237558 | O'Neal, M. R. et al. (1983). *The Use of the Syntactic Density Score as an Evaluative Criterion Measure.* | <https://files.eric.ed.gov/fulltext/ED237558.pdf> |
| — | Golub, L. S. & Kidder, C. (1974). Syntactic Density and the Computer. *Elementary English*, 51(8), 1128–1131. | (print) |
| — | Belanger, J. F. (1978). Calculating the Syntactic Density Score: A Mathematical Problem. *RTE*, 12, 149–153. | <https://doi.org/10.58680/rte197817894> |

ED091741 contains the tabulation sheet, the decision aids, and a **worked
example with all ten frequencies** — usable as a unit-test fixture for the
arithmetic. ED090304 describes the original PL/1 program, including the count
rules and its documented divergence from the hand formula.

## The formula as published

`Total = Σ (weight × frequency)` over the ten variables, then
`SDS = Total ÷ number of T-units`, then a linear grade conversion
(`grade = (SDS − 0.5) / 0.8 + 1`; table runs SDS 0.5 → grade 1 … 10.9 → grade 14).

| # | Variable | Weight | Frequency the original counted |
|---|----------|--------|-------------------------------|
| 1 | Words / T-unit | .95 | total words ÷ T-units (a rate) |
| 2 | Subordinate clauses / T-unit | .90 | subordinate-clause count ÷ T-units (a rate) |
| 3 | Main clause word length (mean) | .20 | main-clause words ÷ main clauses |
| 4 | Subordinate clause word length (mean) | .50 | subordinate-clause words ÷ subordinate clauses |
| 5 | Number of modals | .65 | raw count |
| 6 | Number of be / have forms in the auxiliary position | .40 | raw count |
| 7 | Number of prepositional phrases | .75 | raw count (preposition tokens) |
| 8 | Number of possessives | .70 | raw count (possessive pronouns + `'s`/`s'` nouns) |
| 9 | Number of adverbs of time | .60 | raw count (closed list) |
| 10 | Number of gerunds, participles, absolute phrases | .85 | raw count ("unbound modifiers") |

Worked example (ED091741, sample "Fred", 203 words, 16 T-units):
`12.1 + .78 + 1.64 + 3.1 + 3.2 + 2.0 + 13.5 + 2.8 + 1.8 + 1.7 = 42.62`;
`42.62 ÷ 16 = 2.66` → printed as **SDS 2.7, grade 4.0**. This reproduces the
sheet exactly: variables 1–4 enter the sum already normalised, variables 5–10
enter as raw counts, and the whole sum is divided by T-units once.

### Two facts that force design decisions

**1. The formula and the author's own program disagree on variable 6.**
The hand formula counts be/have "in the auxiliary position"; the PL/1 program
counted *every* form of be/have. ED090304 measures the gap against hand scoring:
Pearson r = .96, with machine scores running consistently higher, and names this
difference as part of the cause. A faithful tool has to choose — or show both.

**2. The score is sample-length dependent.**
Because variables 1–4 are already rates and then get divided by T-units again,
their contribution shrinks as a document grows even if the syntax stays
identical. Holding the worked example's per-T-unit rates constant and scaling
the sample 10× (160 T-units) drops the literal SDS from 2.66 to ≈0.12. The
instrument was normed on ~200-word samples; Belanger (1978) is the published
critique of this. A general-document tool should either window to ~200 words,
label the raw score as sample-length-bound, or report a corrected rate-based
variant alongside — it must not silently present the raw number as comparable.

## Extraction assessment, variable by variable

The question asked was how much can be pulled from raw text without human
adjudication. Three tiers:

- **A — deterministic.** Closed-class list or orthography; a rule-based
  detector reproduces the intended count, disagreements are homograph noise.
- **B — reproducible heuristic.** Needs clause/constituent structure, but a
  fixed rule gets close; the original program did exactly this, with a
  transition matrix and printed "ERR" sentences for human review.
- **C — genuinely subjective.** Even trained hand annotators disagree without a
  parse; the original implementation is a cargo-cult proxy.

| # | Variable | Needs | Verdict |
|---|----------|-------|---------|
| 5 | Modals | closed list | **A** |
| 6 | be/have forms | closed list (+ local next-word rule for "auxiliary position") | **A** (forms) / **A−** (auxiliary) |
| 7 | Prepositional phrases | closed list + local disambiguation (`to`, `for`, `like`, `after`…) | **A−** |
| 8 | Possessives | `'s`/`s'` orthography + pronoun list + contraction exclusions | **A** |
| 9 | Adverbs of time | closed list, **form-based** | **A** (form) / **C** (function) |
| 1 | Words / T-unit | T-unit segmentation (+ existing word tokenizer) | **B** |
| 2 | Subordinate clauses / T-unit | subordinator list + clause marking | **B** |
| 3 | Main clause mean length | clause spans from B; main clauses = T-units | **B** |
| 4 | Subordinate clause mean length | clause spans from B | **B** |
| 10 | Gerunds / participles / absolutes | POS + syntax; absolutes in particular | **C** |

**Bottom line: 5 of 10 are easy token/orthographic counts, 4 of 10 collapse into
a single shared dependency (T-unit and clause segmentation), and 1 of 10 is a
proxy at best.** Variables 1–4 are not four independent problems: get clause
structure right and all four fall out.

### Per-variable notes

- **V1 words/T-unit.** Word counting is already solved (`tokenizeWords` handles
  contractions and hyphenated compounds as single words, which matches the
  original's blank-delimited keypunch convention). The only risk is T-unit
  segmentation.
- **V2 subordinate clauses.** Original aid lists subordinators
  (after, although, as, as much as, because, before, how, inasmuch as, in order
  that, provided that, since, so that, that, than, though, till, unless, when,
  where, whenever, whether, while) plus relatives (who, whoever, whom,
  whomever, whose, whosever, which). Two problems: (a) `that` is
  overwhelmingly a determiner/pronoun in normal prose and will over-count;
  (b) reduced relatives ("the man standing there") and infinitival clauses have
  no subordinator and are invisible to the original rule. The program's own
  rule was crude: mark a subordinate clause once a subordinator is followed by
  three words without punctuation, then add 3 to the clause word count.
- **V3/V4 clause lengths.** Depend entirely on where V2 says a clause starts and
  ends. The published program counted main-clause words at each T-unit end and
  subordinate words in 3-word increments. This is the largest error term in the
  instrument.
- **V5 modals.** The aid list is closed: could, can, may, might, would, should,
  will, shall, must, ought to. Homographs are rare ("a can", "a must", month or
  name "May", name "Will"). Match the original by counting tokens, not
  functions.
- **V6 be/have.** Forms are closed and trivial (be, am, is, are, was, were,
  being, been, have, has, had, having, isn't — plus contractions like `'s`,
  `'re`, `'ve` if the tokenizer splits them). "Auxiliary position" is decidable
  locally: count when followed by a past participle, `-ing`, or `to` +
  infinitive; not when it is the copula or a possessive main verb. Expect ~90%
  agreement with a careful human. The original program dodged this and counted
  everything; the paper quantifies the cost.
- **V7 prepositional phrases.** Closed list (about, above, across, after,
  against, along, amid, among, around, at, before, behind, below, beneath,
  beside, besides, between, beyond, by, concerning, down, during, except, for,
  from, in, into, like, of, off, on, over, past, since, through, throughout, to,
  toward, under, underneath, until, unto, up, upon, with, within, without).
  Disambiguations needed: infinitive `to`, verbal `like`, coordinator `for`
  after a comma, subordinator vs preposition for
  after/before/since/until/as, and particles in phrasal verbs ("look up").
  Multiword prepositions ("because of", "out of") will only count their second
  word; that matches the original list's blind spot.
- **V8 possessives.** Mechanical: pronoun list (my, mine, your, yours, his, her,
  hers, its, our, ours, their, theirs) plus nouns ending `'s`/`s'`. Exclude
  contractions (`it's`, `he's`, `let's`, `there's`, `who's`, …) and recognize
  that `of`-genitives are deliberately invisible in this variable.
- **V9 adverbs of time.** List: when, then, once, while, whenever, soon,
  soonest, later, now, after, afterwards, lately, immediately, yesterday, today,
  tonight, often, always, never, before, beforehand, early, sometimes, forever.
  Token matching is trivial, but six of these (when, while, once, after, before,
  whenever) are *also* on the subordinator list, so the original double-counts
  them in V2 and V9 simultaneously. Function-based counting needs a parse and is
  as subjective as V10; form-based counting is what the instrument actually did.
- **V10 gerunds/participles/absolutes.** The honest weak spot. The original
  program's rule was: a word ending in `-ing`/`-ed`/`-en`, longer than six
  characters, with no form of have/be in the preceding three words → "verbal".
  That over-counts adjectives and nouns ("interested", "exciting", "married",
  "building"), under-counts short participles ("made", "used", "gone"), and
  never detects an absolute phrase at all. A better heuristic (suppress known
  participial adjectives, require a preceding noun, treat be/have+participle as
  bound) improves it but cannot resolve gerund vs participle ("his running",
  "running water", "was running") without a parse. For a browser-only,
  dependency-free tool this is a documented proxy.

### What "without subjectivity" buys

The original authors did not claim more than the rules allow. ED090304:
"Many of the decisions to be made by the machine are quite deterministic…
For more complicated decisions, program algorithms check series of conditions…
A few of the decisions are probabilistic." The program printed sentences it
could not classify for human evaluation ("ERR" routines). The published
hand/machine correlation is .96 on 200-word samples, which is the realistic
ceiling to aim at.

## Tentative implementation sketch

1. `core/syntax.ts` — new shared module:
   - punctuation-aware token stream over the existing word tokenizer;
   - `splitTUnits()`: sentence ranges from `splitSentences`, then split on
     coordinating main-clause joints (`and`/`but`/`or`/`nor`/`yet`/`so`
     followed by a subject rather than a bare verb; comma-list guard);
   - `findSubordinateClauses()`: subordinator/relative list → clause spans;
   - feature detectors returning token lists per GSDS variable.
2. `src/tools/gsds.tool.ts` — one annotation group per variable (so overlap
   rendering shows, say, a subordinate clause under a modal), plus stats: the
   ten frequencies, their weighted contributions, Total, SDS, grade equivalent.
   Options: be/have mode (formula vs 1974 program), maybe highlight toggles.
3. Tests:
   - arithmetic fixture: the ED091741 worked example must produce 42.62 / 2.66;
   - tallies on the bundled sample text, asserted in `dev/smoke.ts`;
   - a length-dependence guard/documentation if windowing is added.

Staged plan:
- **Stage 1:** Tier A variables + `splitTUnits` + V2 count → words/T-unit,
  subordinate/T-unit, SDS with clearly labelled clause-based variables.
- **Stage 2:** clause spans → V3/V4; V10 suffix heuristic with exclusions.
- **Stage 3 (optional):** POS from the local model process (a small tagger
  alongside GPT-2) to replace the suffix heuristics.

## Decisions needed before implementing

1. **V6 mode:** auxiliary-only (the published formula) or all forms (the
   published program)? Default should probably be the formula, with the program
   count shown as a second stat — but that is a call for the project owner.
2. **Length handling:** window to ~200 words and average, show the raw
   length-bound score with a warning, or ship a corrected rate-based variant?
3. **V10:** ship the documented suffix proxy, or leave it out until a tagger is
   available and show a 9-variable partial score instead?
