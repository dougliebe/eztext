/**
 * Golub Syntactic Density Score (GSDS).
 *
 * Ten weighted variables, summed and divided by the number of T-units:
 *
 * | # | Variable                                  | Weight |
 * |---|-------------------------------------------|--------|
 * | 1 | Words / T-unit (rate)                     | 0.95   |
 * | 2 | Subordinate clauses / T-unit (rate)       | 0.90   |
 * | 3 | Main clause word length (mean)            | 0.20   |
 * | 4 | Subordinate clause word length (mean)     | 0.50   |
 * | 5 | Modals                                    | 0.65   |
 * | 6 | Be / have forms in the auxiliary position | 0.40   |
 * | 7 | Prepositional phrases                     | 0.75   |
 * | 8 | Possessives                               | 0.70   |
 * | 9 | Adverbs of time                           | 0.60   |
 * | 10| Gerunds, participles, absolute phrases    | 0.85   |
 *
 * Sources: Golub (1973), ED091741 (tabulation sheet, decision aids, and a
 * worked example that `scoreGsds` is tested against); Kidder & Golub (1974),
 * ED090304 (the PL/1 program's counting rules); O'Neal et al. (1983), ED237558.
 * See `docs/gsds-feasibility.md` for the extraction audit behind these choices.
 *
 * Variables 1–4 are the literature's known weak point: they need clause
 * structure, so they are computed from `core/syntax.ts`'s heuristics and stay a
 * documented approximation. Variables 5–9 are closed-class lookups. Variable 10
 * reproduces the original program's proxy rule (a >6-letter `-ing`/`-ed`/`-en`
 * word with no be/have within the preceding three words), which the paper
 * itself only ever claimed was "predominantly accurate".
 *
 * The literal formula mixes already-normalised rates with raw counts and then
 * divides the sum by T-units, so the score falls as a document grows even at
 * constant syntax density (Belanger 1978). Valid on the ~200-word samples the
 * instrument was normed on; the tool surfaces that caveat rather than hiding it.
 */
import {
  AUXILIARIES,
  countTokensInRanges,
  findSubordinateClauses,
  looksLikeBaseVerb,
  mergeRanges,
  PREPOSITIONS,
  splitTUnits,
  SUBJECT_PRONOUNS,
  tokenizeSyntax,
  type SubordinateClause,
  type SyntaxToken,
} from './syntax';
import { splitSentences } from './text';
import type { TextRange } from './types';

/* ------------------------------------------------------------------ */
/* The published constants                                             */
/* ------------------------------------------------------------------ */

export const GSDS_WEIGHTS = [0.95, 0.9, 0.2, 0.5, 0.65, 0.4, 0.75, 0.7, 0.6, 0.85] as const;

export const GSDS_VARIABLES = [
  { id: 'wordsPerTUnit', label: 'Words / T-unit', weight: 0.95 },
  { id: 'subordinatePerTUnit', label: 'Subordinate clauses / T-unit', weight: 0.9 },
  { id: 'mainClauseLength', label: 'Main clause word length', weight: 0.2 },
  { id: 'subordinateClauseLength', label: 'Subordinate clause word length', weight: 0.5 },
  { id: 'modals', label: 'Modals', weight: 0.65 },
  { id: 'beHave', label: 'Be / have (auxiliary)', weight: 0.4 },
  { id: 'prepositions', label: 'Prepositional phrases', weight: 0.75 },
  { id: 'possessives', label: 'Possessives', weight: 0.7 },
  { id: 'timeAdverbs', label: 'Adverbs of time', weight: 0.6 },
  { id: 'verbals', label: 'Gerunds, participles, absolutes', weight: 0.85 },
] as const;

export type GsdsVariableId = (typeof GSDS_VARIABLES)[number]['id'];
export type GsdsFrequencies = Record<GsdsVariableId, number>;

/** SDS → grade, from the conversion table's line (`grade = (SDS − 0.5) / 0.8 + 1`). */
export function gradeForSds(sds: number): number {
  return 1 + (sds - 0.5) / 0.8;
}

export interface GsdsScore {
  /** Weight × frequency per variable, in `GSDS_VARIABLES` order. */
  contributions: number[];
  total: number;
  sds: number;
  grade: number;
}

/**
 * The formula itself: `Σ weight × frequency`, divided by T-units.
 *
 * Kept separate from the text analysis so the published worked example can be
 * checked without running any heuristics over a document: ED091741's sample
 * ("Fred", 203 words, 16 T-units) lists frequencies
 * `[12.7, .87, 8.2, 6.3, 5, 5, 18, 4, 3, 2]`, whose rounded contributions sum
 * to 42.62 → SDS 2.66 → grade 4.0.
 */
export function scoreGsds(frequencies: readonly number[], tUnits: number): GsdsScore {
  const contributions = GSDS_WEIGHTS.map((weight, index) => weight * (frequencies[index] ?? 0));
  const total = contributions.reduce((sum, value) => sum + value, 0);
  const sds = tUnits > 0 ? total / tUnits : 0;
  return { contributions, total, sds, grade: gradeForSds(sds) };
}

/* ------------------------------------------------------------------ */
/* Lexicons (Golub's tabulation aids, ED091741)                        */
/* ------------------------------------------------------------------ */

const MODALS = new Set(
  `can cannot can't could couldn't may might mightn't will won't would wouldn't shall shan't
should shouldn't must mustn't ought oughtn't`.split(/\s+/),
);

const BE_FORMS = new Set(
  `be am is are was were being been isn't aren't wasn't weren't ain't i'm`.split(/\s+/),
);

const HAVE_FORMS = new Set(`have has had having haven't hasn't hadn't`.split(/\s+/));

/** Pronouns + `'s` that are never possessive nouns. */
const NON_POSSESSIVE_CONTRACTIONS = new Set(
  `it's he's she's that's there's what's who's here's where's how's let's`.split(/\s+/),
);

const POSSESSIVE_PRONOUNS = new Set(
  `my mine your yours his her hers its our ours their theirs`.split(/\s+/),
);

const TIME_ADVERBS = new Set(
  `when then once while whenever soon soonest later now after afterwards lately immediately
yesterday today tonight often always never before beforehand early sometimes forever`
    .split(/\s+/)
    .filter(Boolean),
);

/** Irregular past participles the suffix test cannot catch. */
const IRREGULAR_PARTICIPLES = new Set(
  `been seen done gone made taken given written spoken broken chosen eaten fallen driven hidden
known grown thrown drawn flown shown worn torn born gotten forgotten found held kept left felt built
sent spent lost sold told paid met read heard meant dealt brought bought caught taught thought stood
understood won begun come become run`.split(/\s+/),
);

/** `-ing`/`-ed` words that are almost never verbals (from the old Verbs tool). */
const NOT_VERBALS = new Set(
  `red bed deed indeed greed shed wed fled led need thing king wing ring spring string during
morning evening ceiling clothing nothing something anything everything wedding pudding building
children chicken kitchen citizen specimen earthen
tiring boring interesting exciting amazing annoying outstanding tired excited worried married
supposed used based`.split(/\s+/),
);

/** Words that may sit between `have`/`be` and its participle: `has not gone`. */
const AUX_SKIPS = new Set(
  `not never already just also still always often really finally suddenly now then`.split(/\s+/),
);

/* ------------------------------------------------------------------ */
/* Feature detection                                                   */
/* ------------------------------------------------------------------ */

export type GsdsFeatureKind =
  | 'modal'
  | 'be-have'
  | 'preposition'
  | 'possessive'
  | 'time-adverb'
  | 'verbal';

export interface GsdsFeature extends TextRange {
  kind: GsdsFeatureKind;
  label: string;
  detail: string;
}

const normalise = (value: string) => value.replace(/[’ʼ]/g, "'");

const WEIGHT = Object.fromEntries(
  GSDS_VARIABLES.map((variable) => [variable.id, variable.weight]),
) as Record<GsdsVariableId, number>;

const weight = (id: GsdsVariableId) => WEIGHT[id].toFixed(2);

/** `-ed` words that are not participles, so the suffix test cannot claim them. */
const NOT_PARTICIPLES = new Set(
  `hundred sacred wicked naked crooked dogged ragged rugged aged`.split(/\s+/),
);

function looksLikeParticiple(token: SyntaxToken | null | undefined): boolean {
  if (!token) return false;
  const lower = normalise(token.lower);
  if (IRREGULAR_PARTICIPLES.has(lower)) return true;
  if (NOT_PARTICIPLES.has(lower)) return false;
  return lower.length > 4 && /ed$/.test(lower);
}

/** Is this token a form of be/have at all — and which one? */
function beHaveKind(token: SyntaxToken | null | undefined): 'be' | 'have' | null {
  if (!token) return null;
  const lower = normalise(token.lower);
  if (BE_FORMS.has(lower)) return 'be';
  if (HAVE_FORMS.has(lower)) return 'have';
  if (lower.endsWith("'re")) return 'be';
  if (lower.endsWith("'ve")) return 'have';
  const next = token.next && token.next.sentence === token.sentence ? token.next : null;
  if (lower.endsWith("'s")) {
    if (looksLikeParticiple(next) || (next && next.lower.length > 4 && /ing$/.test(next.lower))) {
      return 'be';
    }
  }
  if (lower.endsWith("'d") && looksLikeParticiple(next)) return 'have';
  return null;
}

/** Is the be/have form helping a following verb rather than standing alone? */
function isAuxiliaryUse(tokens: SyntaxToken[], index: number): boolean {
  const source = tokens[index];
  let j = index + 1;
  let skipped = 0;
  while (tokens[j] && skipped < 3 && tokens[j].sentence === source.sentence) {
    const between = normalise(tokens[j].lower);
    if (!AUX_SKIPS.has(between) && !/-ly$/.test(between)) break;
    j += 1;
    skipped += 1;
  }
  const next = tokens[j];
  if (!next || next.sentence !== source.sentence) return false;
  const lower = normalise(next.lower);
  if (lower.length > 4 && /ing$/.test(lower)) return true;
  if (looksLikeParticiple(next)) return true;
  if (lower === 'to' && tokens[j + 1] && looksLikeBaseVerb(normalise(tokens[j + 1].lower))) return true;
  return false;
}

function isPossessive(tokens: SyntaxToken[], index: number, beHaveAuxiliary: boolean): boolean {
  const token = tokens[index];
  const lower = normalise(token.lower);
  if (POSSESSIVE_PRONOUNS.has(lower)) return true;
  if (beHaveAuxiliary || NON_POSSESSIVE_CONTRACTIONS.has(lower)) return false;
  if (lower.endsWith("'s")) return lower.length > 2;
  return token.pluralPossessive;
}

/**
 * A preposition token that heads a phrase *here*.
 *
 * Rejections: `to` before a base verb (infinitive), `for` after a comma (the
 * coordinator, per the original program's FOR routine), `like` after a subject
 * pronoun or auxiliary (the verb), a token already claimed as a clause head,
 * and a sentence-final token (almost always a particle or adverb: `stand up`).
 */
function isPreposition(tokens: SyntaxToken[], index: number, clauseHeads: Set<number>): boolean {
  const token = tokens[index];
  const lower = normalise(token.lower);
  if (!PREPOSITIONS.has(lower)) return false;
  if (clauseHeads.has(index)) return false;
  const next = token.next;
  if (!next || next.sentence !== token.sentence) return false;
  if (lower === 'to' && looksLikeBaseVerb(normalise(next.lower))) return false;
  if (lower === 'for' && token.before.includes(',')) return false;
  if (lower === 'like') {
    const prev = token.prev;
    if (prev) {
      const previous = normalise(prev.lower);
      if (SUBJECT_PRONOUNS.has(previous) || MODALS.has(previous) || AUXILIARIES.has(previous)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The original program's proxy for gerunds/participles/absolutes (ED090304,
 * routine VERBAL): `-ing`/`-ed`/`-en`, longer than six characters, with no form
 * of have/be in the preceding three words. Deliberately not "fixed" here — the
 * score is comparable only if the rule is the published one.
 */
function isVerbal(tokens: SyntaxToken[], index: number): boolean {
  const token = tokens[index];
  const lower = normalise(token.lower);
  if (lower.length <= 6) return false;
  if (!/(?:ing|ed|en)$/.test(lower)) return false;
  if (NOT_VERBALS.has(lower) || beHaveKind(token) !== null) return false;
  for (let j = Math.max(0, index - 3); j < index; j += 1) {
    if (beHaveKind(tokens[j]) !== null) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export interface GsdsOptions {
  /**
   * `auxiliary` is the published formula (be/have in the helping position);
   * `all` is what the 1974 program actually counted (every form). ED090304
   * measured the gap: r = .96 with hand scoring, machine scores running higher.
   */
  beHave: 'auxiliary' | 'all';
}

/**
 * One T-unit's exact contribution to the document's weighted total.
 *
 * `shares` partitions the published variable contributions exactly: for the
 * structural variables a share is the weight times the unit's local rate, for
 * the count variables the weight times the unit's raw count, and each share
 * sums across the document to `contributions[variable]`. `total` is therefore
 * that unit's share of the published `total`, so ranking units by it ranks them
 * by how much of the score they own — which is what “the densest areas” means
 * here. The structural rates are the document's (words/T-unit is uniform), so
 * the split is an attribution, not a claim that a unit could be scored alone.
 */
export interface GsdsUnitBreakdown {
  /** 1-based position in the document. */
  ordinal: number;
  start: number;
  end: number;
  words: number;
  clauses: number;
  mainWords: number;
  subWords: number;
  counts: Record<GsdsFeatureKind, number>;
  shares: GsdsFrequencies;
  total: number;
}

export interface GsdsAnalysis {
  words: number;
  sentences: number;
  tUnits: number;
  subordinateClauses: number;
  frequencies: GsdsFrequencies;
  contributions: GsdsFrequencies;
  total: number;
  sds: number;
  grade: number;
  /** Atomic highlights: one per counted lexical item. */
  features: GsdsFeature[];
  /** Per-T-unit decomposition of the weighted total, in document order. */
  units: GsdsUnitBreakdown[];
  /** T-unit spans with their word counts, for the optional structural layer. */
  tUnitRanges: Array<TextRange & { words: number }>;
  clauseRanges: SubordinateClause[];
  /** Union of clause ranges — the spans whose words are not main-clause words. */
  mergedClauseRanges: TextRange[];
  /** Be/have forms with no auxiliary test — the 1974 program's count. */
  beHaveAll: number;
}

export function analyseGsds(text: string, options: Partial<GsdsOptions> = {}): GsdsAnalysis {
  const mode = options.beHave ?? 'auxiliary';
  const tokens = tokenizeSyntax(text);
  const sentences = splitSentences(text).length;
  const units = splitTUnits(tokens);
  const clauses = findSubordinateClauses(text, tokens, units);
  const clauseHeads = new Set(clauses.map((clause) => clause.connectorIndex));
  const mergedClauseRanges = mergeRanges(clauses);

  const features: GsdsFeature[] = [];
  let beHaveAll = 0;
  const counts: Record<GsdsFeatureKind, number> = {
    modal: 0,
    'be-have': 0,
    preposition: 0,
    possessive: 0,
    'time-adverb': 0,
    verbal: 0,
  };

  const add = (kind: GsdsFeatureKind, token: SyntaxToken, detail: string) => {
    counts[kind] += 1;
    features.push({ kind, start: token.start, end: token.end, label: token.text, detail });
  };

  tokens.forEach((token, index) => {
    const lower = normalise(token.lower);

    const beHave = beHaveKind(token);
    if (beHave) beHaveAll += 1;

    if (MODALS.has(lower) || lower.endsWith("'ll")) {
      add('modal', token, `“${token.text}” is on Golub's modal list. Variable 5 (weight ${weight('modals')}).`);
    }

    if (beHave && (mode === 'all' || isAuxiliaryUse(tokens, index))) {
      const kind = beHave === 'have' ? 'have' : 'be';
      const qualifier = mode === 'all' ? 'form of' : 'auxiliary form of';
      add(
        'be-have',
        token,
        `“${token.text}” is a ${qualifier} ${kind}. Variable 6 (weight ${weight('beHave')})${
          mode === 'all' ? '; counting every form is the 1974 program’s rule, not the hand formula' : ''
        }.`,
      );
    }

    if (isPreposition(tokens, index, clauseHeads)) {
      add(
        'preposition',
        token,
        `“${token.text}” heads a prepositional phrase. Variable 7 (weight ${weight('prepositions')}).`,
      );
    }

    const auxiliary = Boolean(beHave) && isAuxiliaryUse(tokens, index);
    if (isPossessive(tokens, index, auxiliary)) {
      const kind = POSSESSIVE_PRONOUNS.has(lower) ? 'pronoun' : 'noun';
      add(
        'possessive',
        token,
        `“${token.text}” is a possessive ${kind}. Variable 8 (weight ${weight('possessives')}).`,
      );
    }

    if (TIME_ADVERBS.has(lower)) {
      const alsoSubordinator = clauseHeads.has(index);
      add(
        'time-adverb',
        token,
        `“${token.text}” is on Golub's adverbs-of-time list. Variable 9 (weight ${weight('timeAdverbs')})${
          alsoSubordinator ? '; it also introduces a subordinate clause, so the instrument counts it twice' : ''
        }.`,
      );
    }

    if (isVerbal(tokens, index)) {
      add(
        'verbal',
        token,
        `“${token.text}” looks like an unbound -ing/-ed/-en modifier. Variable 10 (weight ${weight('verbals')}); ` +
          'the proxy rule is the original program’s, so expect false positives on participial adjectives.',
      );
    }
  });

  const tUnits = units.length;
  const words = tokens.length;
  const subordinateClauses = clauses.length;
  const subordinateWords = countTokensInRanges(tokens, mergedClauseRanges);
  const frequencies: GsdsFrequencies = {
    wordsPerTUnit: tUnits > 0 ? words / tUnits : 0,
    subordinatePerTUnit: tUnits > 0 ? subordinateClauses / tUnits : 0,
    mainClauseLength: tUnits > 0 ? (words - subordinateWords) / tUnits : 0,
    subordinateClauseLength: subordinateClauses > 0 ? subordinateWords / subordinateClauses : 0,
    modals: counts.modal,
    beHave: counts['be-have'],
    prepositions: counts.preposition,
    possessives: counts.possessive,
    timeAdverbs: counts['time-adverb'],
    verbals: counts.verbal,
  };

  const score = scoreGsds(
    GSDS_VARIABLES.map((variable) => frequencies[variable.id]),
    tUnits,
  );
  const contributions = Object.fromEntries(
    GSDS_VARIABLES.map((variable, index) => [variable.id, score.contributions[index]]),
  ) as GsdsFrequencies;

  // Attribute each part of the score to the T-unit that owns it. Features and
  // clauses are in document order and units tile the words, so one forward
  // pointer per pass is enough.
  const zeroShares = () =>
    Object.fromEntries(GSDS_VARIABLES.map((variable) => [variable.id, 0])) as GsdsFrequencies;
  const breakdowns: GsdsUnitBreakdown[] = units.map((unit, index) => ({
    ordinal: index + 1,
    start: unit.start,
    end: unit.end,
    words: unit.wordEnd - unit.wordStart,
    clauses: 0,
    mainWords: 0,
    subWords: 0,
    counts: { modal: 0, 'be-have': 0, preposition: 0, possessive: 0, 'time-adverb': 0, verbal: 0 },
    shares: zeroShares(),
    total: 0,
  }));

  const assign = <T>(items: T[], start: (item: T) => number, apply: (unit: GsdsUnitBreakdown, item: T) => void) => {
    let pointer = 0;
    for (const item of items) {
      const at = start(item);
      while (pointer < breakdowns.length - 1 && at >= breakdowns[pointer].end) pointer += 1;
      const unit = breakdowns[pointer];
      if (unit && at >= unit.start && at < unit.end) apply(unit, item);
    }
  };

  assign(features, (feature) => feature.start, (unit, feature) => {
    unit.counts[feature.kind] += 1;
  });
  assign(clauses, (clause) => clause.start, (unit) => {
    unit.clauses += 1;
  });

  let clauseRange = 0;
  for (const token of tokens) {
    while (clauseRange < mergedClauseRanges.length && token.start >= mergedClauseRanges[clauseRange].end) {
      clauseRange += 1;
    }
    const insideClause =
      clauseRange < mergedClauseRanges.length && token.start >= mergedClauseRanges[clauseRange].start;
    if (!insideClause) continue;
    let pointer = 0;
    while (pointer < breakdowns.length - 1 && token.start >= breakdowns[pointer].end) pointer += 1;
    const unit = breakdowns[pointer];
    if (unit && token.start >= unit.start && token.start < unit.end) unit.subWords += 1;
  }

  for (const unit of breakdowns) {
    unit.mainWords = unit.words - unit.subWords;
    // The structural variables enter the published total as rates, so their
    // shares are rates too; the count variables enter as raw counts, so their
    // shares stay at full weight × count. That is what makes the shares sum to
    // the published contributions rather than to a fraction of them.
    unit.shares = {
      wordsPerTUnit: WEIGHT.wordsPerTUnit * (tUnits > 0 ? unit.words / tUnits : 0),
      subordinatePerTUnit: WEIGHT.subordinatePerTUnit * (tUnits > 0 ? unit.clauses / tUnits : 0),
      mainClauseLength: WEIGHT.mainClauseLength * (tUnits > 0 ? unit.mainWords / tUnits : 0),
      subordinateClauseLength:
        subordinateClauses > 0 ? WEIGHT.subordinateClauseLength * (unit.subWords / subordinateClauses) : 0,
      modals: WEIGHT.modals * unit.counts.modal,
      beHave: WEIGHT.beHave * unit.counts['be-have'],
      prepositions: WEIGHT.prepositions * unit.counts.preposition,
      possessives: WEIGHT.possessives * unit.counts.possessive,
      timeAdverbs: WEIGHT.timeAdverbs * unit.counts['time-adverb'],
      verbals: WEIGHT.verbals * unit.counts.verbal,
    };
    unit.total = GSDS_VARIABLES.reduce((sum, variable) => sum + unit.shares[variable.id], 0);
  }

  return {
    words,
    sentences,
    tUnits,
    subordinateClauses,
    frequencies,
    contributions,
    total: score.total,
    sds: score.sds,
    grade: score.grade,
    features,
    units: breakdowns,
    tUnitRanges: units.map((unit) => ({ start: unit.start, end: unit.end, words: unit.wordEnd - unit.wordStart })),
    clauseRanges: clauses,
    mergedClauseRanges,
    beHaveAll,
  };
}
