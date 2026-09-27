import {
  analyseGsds,
  GSDS_VARIABLES,
  type GsdsFeatureKind,
  type GsdsUnitBreakdown,
  type GsdsVariableId,
} from '../core/gsds';
import { round } from '../core/text';
import type { AnnotationDraft, Stat, Tool } from '../core/types';

const WEIGHT = Object.fromEntries(
  GSDS_VARIABLES.map((variable) => [variable.id, variable.weight]),
) as Record<GsdsVariableId, number>;

const GROUPS: Record<GsdsFeatureKind, string> = {
  modal: 'modal',
  'be-have': 'be/have',
  preposition: 'preposition',
  possessive: 'possessive',
  'time-adverb': 'time-adverb',
  verbal: 'verbal',
};

const VARIABLE_BY_GROUP: Record<GsdsFeatureKind, GsdsVariableId> = {
  modal: 'modals',
  'be-have': 'beHave',
  preposition: 'prepositions',
  possessive: 'possessives',
  'time-adverb': 'timeAdverbs',
  verbal: 'verbals',
};

/** Short labels for the per-unit score decomposition shown in the inspector. */
const SHARE_LABELS: Record<GsdsVariableId, string> = {
  wordsPerTUnit: 'words',
  subordinatePerTUnit: 'subordinate clauses',
  mainClauseLength: 'main-clause words',
  subordinateClauseLength: 'subordinate-clause words',
  modals: 'modals',
  beHave: 'be / have',
  prepositions: 'prepositions',
  possessives: 'possessives',
  timeAdverbs: 'time adverbs',
  verbals: 'gerunds / participles',
};

/** How many of the thing each share is made of, for the inspector's labels. */
function countFor(variable: GsdsVariableId, unit: GsdsUnitBreakdown): number {
  switch (variable) {
    case 'wordsPerTUnit':
      return unit.words;
    case 'subordinatePerTUnit':
      return unit.clauses;
    case 'mainClauseLength':
      return unit.mainWords;
    case 'subordinateClauseLength':
      return unit.subWords;
    case 'modals':
      return unit.counts.modal;
    case 'beHave':
      return unit.counts['be-have'];
    case 'prepositions':
      return unit.counts.preposition;
    case 'possessives':
      return unit.counts.possessive;
    case 'timeAdverbs':
      return unit.counts['time-adverb'];
    case 'verbals':
      return unit.counts.verbal;
  }
}

interface Contributor {
  label: string;
  value: number;
}

/** The weighted shares of one T-unit, biggest first, labelled with their counts. */
function contributors(unit: GsdsUnitBreakdown): Contributor[] {
  return GSDS_VARIABLES.map((variable) => {
    const count = countFor(variable.id, unit);
    return {
      label: count > 0 ? `${count} ${SHARE_LABELS[variable.id]}` : SHARE_LABELS[variable.id],
      value: unit.shares[variable.id],
    };
  })
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * What the score means, and what each group contributes to it.
 *
 * GSDS is a density instrument, not an error list: a flagged word or span is
 * not a mistake, it is complexity. The descriptions therefore say what the
 * feature does to the score and what a writer usually changes, leaving the
 * goal — simplify or add structure — to the reader.
 */
const SUMMARY =
  'Golub’s density score climbs when clauses carry more embedded structure. The dense view shades ' +
  'the T-units that own most of the score; click one to see which features make it up. Density is ' +
  'not an error — it says where the prose is packed hardest, and therefore where unpacking pays most.';

/**
 * One canonical before → after example per group. Generic on purpose: it shows
 * the shape of the fix so the inspector can answer “what would I do about
 * this?” without pretending to rewrite the user's text.
 */
const GROUP_EXAMPLES: Record<string, string> = {
  dense:
    '“The report, which the team finished after several delays, was published because the editor ' +
    'liked it.” → “The team finished the report after several delays. The editor liked it, so it ' +
    'was published.”',
  modal: '“We might perhaps be able to help.” → “We can help.”',
  'be/have': '“The decision was made by the committee.” → “The committee decided.”',
  preposition: '“the colour of the roof of the house” → “the house’s roof colour”',
  possessive: '“the plan of the team” → “the team’s plan”',
  'time-adverb': '“Then, later, it rained.” → “It rained later.”',
  verbal:
    '“The man running down the road waved.” → “The man who was running down the road waved.”',
  'sub-clause':
    '“Because it rained, we stayed in, although we had planned to walk.” → ' +
    '“It rained, so we stayed in. We had planned to walk.”',
};

const GROUP_DESCRIPTIONS: Record<string, string> = {
  dense:
    'A T-unit that owns an outsized share of the weighted total. That is not a mistake — the score is ' +
    'descriptive — but it is where adjustment pays most: split at a clause boundary, break a ' +
    'preposition chain, or turn a passive into an active clause.',
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
};

/**
 * Golub Syntactic Density Score.
 *
 * The score is ten weighted variables divided by the number of T-units. This
 * tool runs the published formula but does not pretend the extraction is a
 * parse: variables 1–4 come from the T-unit and clause heuristics in
 * `core/syntax.ts`, and variable 10 is the original program's suffix proxy.
 *
 * Two views:
 * - **dense** (default) shades the T-units that own the largest share of the
 *   weighted total, and the inspector decomposes each one exactly — every
 *   variable's share of that unit, summing back to the published total.
 * - **audit** highlights every counted feature so the frequencies can be
 *   checked by hand against the rules in `core/gsds.ts`.
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
    'Golub Syntactic Density Score: shades the densest T-units and breaks down what makes them dense.',
  category: 'structure',
  color: '#0d9488',
  defaultEnabled: true,
  options: [
    {
      kind: 'select',
      id: 'view',
      label: 'Highlight',
      default: 'dense',
      choices: [
        { value: 'dense', label: 'Densest T-units' },
        { value: 'audit', label: 'Every counted feature' },
      ],
      hint: 'Dense view shades the T-units that own most of the score; click one to see the breakdown. Audit view highlights every counted item so the tally can be checked by hand.',
    },
    {
      kind: 'number',
      id: 'top',
      label: 'Dense view: top (%)',
      default: 25,
      min: 5,
      max: 100,
      step: 5,
      hint: 'Share of T-units to shade, ranked by how much of the weighted total they own.',
    },
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
  ],

  run({ text, options }) {
    const mode = String(options.beHave ?? 'auxiliary') === 'all' ? 'all' : 'auxiliary';
    const view = String(options.view ?? 'dense') === 'audit' ? 'audit' : 'dense';
    const topShare = Math.min(100, Math.max(5, Number(options.top ?? 25)));
    const analysis = analyseGsds(text, { beHave: mode });
    const frequencies = analysis.frequencies;
    const contributions = analysis.contributions;
    const ranked = [...analysis.units].sort((a, b) => b.total - a.total || a.ordinal - b.ordinal);
    const densest = ranked[0] ?? null;
    const annotations: AnnotationDraft[] = [];

    if (view === 'audit') {
      for (const feature of analysis.features) {
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
    } else if (densest) {
      const count = Math.max(1, Math.round((analysis.units.length * topShare) / 100));
      const dense = ranked.slice(0, count);
      const maximum = dense[0].total;
      const minimum = dense[dense.length - 1].total;

      for (const unit of dense) {
        const intensity = maximum > minimum ? (unit.total - minimum) / (maximum - minimum) : 1;
        const ratio = analysis.sds > 0 ? unit.total / analysis.sds : 0;
        annotations.push({
          start: unit.start,
          end: unit.end,
          label: `T-unit ${unit.ordinal} · ${unit.words}w`,
          group: 'dense',
          detail:
            `T-unit ${unit.ordinal} of ${analysis.tUnits} contributes ${unit.total.toFixed(2)} of the ` +
            `weighted total (${ratio.toFixed(1)}× the document average of ${analysis.sds.toFixed(2)}). ` +
            `${unit.words} words, ${unit.clauses} subordinate clause${unit.clauses === 1 ? '' : 's'}.`,
          // Shaded against the highlighted set: the densest unit is the darkest,
          // and even the weakest of them stays visible.
          alpha: 0.1 + 0.3 * intensity,
          data: {
            ordinal: unit.ordinal,
            words: unit.words,
            clauses: unit.clauses,
            total: unit.total,
            ratioToAverage: ratio,
            contributors: contributors(unit),
          },
        });
      }
    }

    const contribution = (variable: GsdsVariableId) =>
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
        id: 'gsds.dense',
        label: 'Densest T-unit',
        value: densest ? round(densest.total, 2) : '—',
        hint:
          densest && analysis.sds > 0
            ? `T-unit ${densest.ordinal} of ${analysis.tUnits} · ${densest.words} words · ` +
              `${(densest.total / analysis.sds).toFixed(1)}× the average`
            : 'no T-units to score',
        tone: 'accent',
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

    return {
      annotations,
      stats,
      summary: SUMMARY,
      groupDescriptions: GROUP_DESCRIPTIONS,
      groupExamples: GROUP_EXAMPLES,
    };
  },
};
