import { analyseGsds, GSDS_VARIABLES, type GsdsFeatureKind } from '../core/gsds';
import { round } from '../core/text';
import type { AnnotationDraft, Stat, Tool } from '../core/types';

const WEIGHT = Object.fromEntries(
  GSDS_VARIABLES.map((variable) => [variable.id, variable.weight]),
) as Record<(typeof GSDS_VARIABLES)[number]['id'], number>;

const GROUPS: Record<GsdsFeatureKind, string> = {
  modal: 'modal',
  'be-have': 'be/have',
  preposition: 'preposition',
  possessive: 'possessive',
  'time-adverb': 'time-adverb',
  verbal: 'verbal',
};

const VARIABLE_BY_GROUP: Record<GsdsFeatureKind, (typeof GSDS_VARIABLES)[number]['id']> = {
  modal: 'modals',
  'be-have': 'beHave',
  preposition: 'prepositions',
  possessive: 'possessives',
  'time-adverb': 'timeAdverbs',
  verbal: 'verbals',
};

/**
 * What the score means, and what each group contributes to it.
 *
 * GSDS is a density instrument, not an error list: a flagged word is not a
 * mistake, it is complexity. The descriptions therefore say what the feature
 * does to the score and what a writer usually changes, leaving the goal —
 * simplify or add structure — to the reader.
 */
const SUMMARY =
  'Golub’s density score climbs when clauses carry more embedded structure. Higher is denser and ' +
  'harder to read — not an error — and each group below says what it contributes and how a writer ' +
  'usually adjusts it.';

const GROUP_DESCRIPTIONS: Record<string, string> = {
  modal:
    'Modals shade possibility and obligation (can, should, must), and each one expands the verb phrase ' +
    'in Golub’s count. A cluster can sound hedged; where the sentence can commit, one confident modal ' +
    'reads better than three cautious ones.',
  'be/have':
    'Forms of be and have helping another verb carry tense, aspect and passive voice. A passive hides ' +
    'the actor and stacked auxiliaries add words without content, though a passive is right when the ' +
    'actor is unknown. The formula counts only the helping position; the option switches to the 1974 ' +
    'program’s all-forms reading.',
  preposition:
    'A preposition packages a relationship into a phrase instead of a clause (in the morning rather ' +
    'than when morning came) — the compression the score rewards. Long chains (the colour of the roof ' +
    'of the house) are where that turns into soup; breaking the chain is usually clearer.',
  possessive:
    'Possessive nouns and pronouns (the writer’s point, their plan) mark nominal density; the instrument ' +
    'counts only the apostrophe form, so an of-phrase is invisible to it. A possessive is usually the ' +
    'tighter choice — reach for one when an of-chain does the work of a single ’s.',
  'time-adverb':
    'Time words from Golub’s list (then, once, while, soon) anchor events and can stand in for a whole ' +
    'clause. The instrument counts them by form, so while and before are counted here and again as ' +
    'subordinators; a passage dense with them reads as a timeline rather than an argument.',
  verbal:
    'An -ing/-ed/-en word not attached to a helping verb is a reduction: a clause compressed into a ' +
    'modifier (the man running, written by hand). Reductions are efficient, but this is the noisiest ' +
    'variable — participial adjectives are caught too. When a modifier’s subject is unclear, expanding ' +
    'it into a clause is the fix.',
  'sub-clause':
    'Every subordinator or relative pronoun adds a layer of embedding to a main clause (because…, who…). ' +
    'One or two layers read fine; several nested together is where the main thread disappears. Promoting ' +
    'one clause to its own sentence is the usual remedy.',
  't-unit':
    'The T-unit is what the score divides by: one main clause plus everything attached to it, with ' +
    'coordinated main clauses as separate units. The layer is shown so you can see exactly what is being ' +
    'counted — a few long T-units and many short ones can reach the same word count and score differently.',
};

/**
 * Golub Syntactic Density Score.
 *
 * The score is ten weighted variables divided by the number of T-units. This
 * tool runs the published formula but does not pretend the extraction is a
 * parse: variables 1–4 come from the T-unit and clause heuristics in
 * `core/syntax.ts`, and variable 10 is the original program's suffix proxy.
 * Each annotation says which rule fired, and the stats carry the weight and
 * contribution of every variable, so the number is auditable rather than
 * oracular.
 *
 * Two known properties are surfaced instead of hidden:
 * - the literal formula is sample-length dependent (already-normalised rates
 *   are divided by T-units again), so long documents carry a warning;
 * - the hand formula counts be/have only in the auxiliary position while the
 *   1974 program counted every form — an option, with both counts reported.
 */
export const gsdsTool: Tool = {
  id: 'gsds',
  name: 'Syntactic density',
  description:
    'Golub Syntactic Density Score: ten weighted syntax features, with the rule and count behind every number.',
  category: 'structure',
  color: '#0d9488',
  defaultEnabled: true,
  options: [
    {
      kind: 'select',
      id: 'beHave',
      label: 'Be / have',
      default: 'auxiliary',
      choices: [
        { value: 'auxiliary', label: 'Auxiliary position (formula)' },
        { value: 'all', label: 'Every form (1974 program)' },
      ],
      hint: 'The published formula counts be/have only when it helps a following verb; the original program counted every form and scored higher. ED090304 measured r = .96 against hand scoring.',
    },
    {
      kind: 'boolean',
      id: 'subClauses',
      label: 'Highlight subordinate clauses',
      default: true,
    },
    { kind: 'boolean', id: 'tUnits', label: 'Highlight T-units', default: false },
    {
      kind: 'boolean',
      id: 'verbals',
      label: 'Highlight gerunds / participles',
      default: true,
      hint: 'The proxy rule is noisy on participial adjectives; the count stays in the stats either way.',
    },
  ],

  run({ text, options }) {
    const mode = String(options.beHave ?? 'auxiliary') === 'all' ? 'all' : 'auxiliary';
    const analysis = analyseGsds(text, { beHave: mode });
    const frequencies = analysis.frequencies;
    const contributions = analysis.contributions;
    const showClauses = options.subClauses !== false;
    const showTUnits = options.tUnits === true;
    const showVerbals = options.verbals !== false;

    const annotations: AnnotationDraft[] = [];
    for (const feature of analysis.features) {
      if (feature.kind === 'verbal' && !showVerbals) continue;
      const variable = VARIABLE_BY_GROUP[feature.kind];
      annotations.push({
        start: feature.start,
        end: feature.end,
        label: feature.label,
        group: GROUPS[feature.kind],
        detail: feature.detail,
        data: { variable, weight: WEIGHT[variable] },
      });
    }

    if (showClauses) {
      analysis.clauseRanges.forEach((clause, index) => {
        annotations.push({
          start: clause.start,
          end: clause.end,
          label: `clause · ${clause.connector}`,
          group: 'sub-clause',
          detail:
            `Subordinate clause ${index + 1}, introduced by “${clause.connector}”. Its words count toward ` +
            'variable 4 and its existence toward variable 2. Spans run to the next comma, semicolon or ' +
            'T-unit end, so a relative clause without punctuation may be over-captured.',
          data: { connector: clause.connector },
        });
      });
    }

    if (showTUnits) {
      analysis.tUnitRanges.forEach((unit, index) => {
        annotations.push({
          start: unit.start,
          end: unit.end,
          label: `T-unit ${index + 1} · ${unit.words}w`,
          group: 't-unit',
          detail:
            `T-unit ${index + 1}: ${unit.words} words. A T-unit is one main clause plus everything ` +
            'subordinate attached to it; coordinated main clauses split into separate T-units.',
          data: { ordinal: index + 1, words: unit.words },
        });
      });
    }

    const contribution = (variable: keyof typeof WEIGHT) =>
      `× ${WEIGHT[variable].toFixed(2)} → ${round(contributions[variable], 2)}`;
    const lengthBound = analysis.words > 400;

    const stats: Stat[] = [
      {
        id: 'gsds.score',
        label: 'Syntactic Density Score',
        value: round(analysis.sds, 2),
        hint: lengthBound
          ? 'weighted total ÷ T-units · length-bound: the instrument was normed on ~200-word samples'
          : 'weighted total ÷ T-units',
        tone: lengthBound ? 'warn' : 'accent',
      },
      {
        id: 'gsds.grade',
        label: 'Grade equivalent',
        value: analysis.tUnits > 0 ? Math.round(analysis.grade) : '—',
        hint:
          analysis.tUnits > 0
            ? `linear ${round(analysis.grade, 1)} · Golub's table covers SDS 0.5 (grade 1) to 10.9 (grade 14)`
            : 'no T-units to score',
      },
      {
        id: 'gsds.total',
        label: 'Weighted total',
        value: round(analysis.total, 2),
        hint: `Σ weight × frequency over ${analysis.tUnits} T-units`,
      },
      {
        id: 'gsds.counts',
        label: 'Words / sentences',
        value: `${analysis.words} / ${analysis.sentences}`,
        hint: `${analysis.tUnits} T-units`,
      },
      {
        id: 'gsds.wtu',
        label: 'Words / T-unit',
        value: round(frequencies.wordsPerTUnit, 2),
        hint: `variable 1 · ${contribution('wordsPerTUnit')}`,
      },
      {
        id: 'gsds.subtu',
        label: 'Sub clauses / T-unit',
        value: round(frequencies.subordinatePerTUnit, 2),
        hint: `variable 2 · ${contribution('subordinatePerTUnit')} · ${analysis.subordinateClauses} clauses`,
      },
      {
        id: 'gsds.main',
        label: 'Main clause length',
        value: round(frequencies.mainClauseLength, 2),
        hint: `variable 3 · ${contribution('mainClauseLength')} · heuristic clause spans`,
      },
      {
        id: 'gsds.sublen',
        label: 'Sub clause length',
        value: round(frequencies.subordinateClauseLength, 2),
        hint: `variable 4 · ${contribution('subordinateClauseLength')} · heuristic clause spans`,
      },
      {
        id: 'gsds.modals',
        label: 'Modals',
        value: frequencies.modals,
        hint: `variable 5 · ${contribution('modals')}`,
      },
      {
        id: 'gsds.behave',
        label: mode === 'all' ? 'Be / have (all forms)' : 'Be / have (auxiliary)',
        value: frequencies.beHave,
        hint: `variable 6 · ${contribution('beHave')} · ${
          mode === 'all'
            ? 'the hand formula would count fewer'
            : `${analysis.beHaveAll} forms in total, including copulas and possessives`
        }`,
      },
      {
        id: 'gsds.prep',
        label: 'Prepositional phrases',
        value: frequencies.prepositions,
        hint: `variable 7 · ${contribution('prepositions')}`,
      },
      {
        id: 'gsds.poss',
        label: 'Possessives',
        value: frequencies.possessives,
        hint: `variable 8 · ${contribution('possessives')}`,
      },
      {
        id: 'gsds.time',
        label: 'Adverbs of time',
        value: frequencies.timeAdverbs,
        hint: `variable 9 · ${contribution('timeAdverbs')} · counted by form, as the instrument did`,
      },
      {
        id: 'gsds.verbals',
        label: 'Gerunds / participles',
        value: frequencies.verbals,
        hint: `variable 10 · ${contribution('verbals')} · proxy rule, expect false positives`,
      },
    ];

    return { annotations, stats, summary: SUMMARY, groupDescriptions: GROUP_DESCRIPTIONS };
  },
};
