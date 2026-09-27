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

    return { annotations, stats };
  },
};
