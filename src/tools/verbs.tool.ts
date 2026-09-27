import type { AnnotationDraft, Stat, Tool } from '../core/types';
import { average, round, splitSentences, tokenizeWords, type WordToken } from '../core/text';

/* ------------------------------------------------------------------ */
/* Lexicon                                                             */
/* ------------------------------------------------------------------ */

/** High-frequency English verbs in base form. */
const BASE_VERBS = `ask avoid accept add admit agree allow answer appear apply argue arrive
believe belong break bring build buy call care carry catch cause change choose claim clean clear
close come compare complain complete consider continue cook count cover create cross cut decide
deliver describe design destroy develop die disagree discover discuss divide draw dream drive drop
earn eat enable encourage enjoy enter exist expect explain explore express fail fall fear feel
fight fill find finish fit fix fly follow forget forgive form gain gather get give go grow guess
handle happen hate hear help hide hit hold hope hurt imagine improve include increase indicate
intend introduce invent invite join jump keep kill know laugh lead learn leave lend let lie like
listen live look lose love manage mark matter mean measure meet mention miss move need notice
obtain offer open order own pass pay perform pick place plan play point prefer prepare present
prevent produce promise protect prove provide pull push put raise reach read realize receive
recognize reduce refuse regard relate remain remember remove repeat reply report request require
rescue respect respond rest result return reveal ride ring rise risk run save say search see seem
sell send serve set shake share shine shoot shop show shut sign sing sit sleep smile solve speak
spend stand start stay steal stick stop study succeed suggest supply support suppose surprise
survive take talk teach tell tend test thank think throw touch train travel treat trust try turn
understand unite use visit wait walk want warn wash watch wear win wish wonder worry write`
  .split(/\s+/)
  .filter(Boolean);

/** Forms that regular morphology rules would get wrong. */
const IRREGULAR: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['went', 'gone'],
  get: ['got', 'gotten'],
  make: ['made'],
  take: ['took', 'taken'],
  come: ['came'],
  see: ['saw', 'seen'],
  know: ['knew', 'known'],
  think: ['thought'],
  give: ['gave', 'given'],
  find: ['found'],
  tell: ['told'],
  say: ['said'],
  run: ['ran'],
  eat: ['ate', 'eaten'],
  write: ['wrote', 'written'],
  read: ['read'],
  feel: ['felt'],
  leave: ['left'],
  bring: ['brought'],
  buy: ['bought'],
  teach: ['taught'],
  catch: ['caught'],
  meet: ['met'],
  pay: ['paid'],
  sit: ['sat'],
  stand: ['stood'],
  understand: ['understood'],
  win: ['won'],
  lose: ['lost'],
  sell: ['sold'],
  send: ['sent'],
  spend: ['spent'],
  build: ['built'],
  hear: ['heard'],
  hold: ['held'],
  keep: ['kept'],
  sleep: ['slept'],
  mean: ['meant'],
  lead: ['led'],
  begin: ['began', 'begun'],
  fall: ['fell', 'fallen'],
  grow: ['grew', 'grown'],
  drive: ['drove', 'driven'],
  speak: ['spoke', 'spoken'],
  choose: ['chose', 'chosen'],
  break: ['broke', 'broken'],
  wear: ['wore', 'worn'],
  draw: ['drew', 'drawn'],
  fly: ['flew', 'flown'],
  forget: ['forgot', 'forgotten'],
  ride: ['rode', 'ridden'],
  ring: ['rang', 'rung'],
  sing: ['sang', 'sung'],
  drink: ['drank', 'drunk'],
  swim: ['swam', 'swum'],
  throw: ['threw', 'thrown'],
  steal: ['stole', 'stolen'],
  hide: ['hid', 'hidden'],
  bite: ['bit', 'bitten'],
  shake: ['shook', 'shaken'],
  shine: ['shone'],
  shoot: ['shot'],
  fight: ['fought'],
  seek: ['sought'],
  deal: ['dealt'],
  dig: ['dug'],
  hang: ['hung'],
  stick: ['stuck'],
  strike: ['struck'],
  sweep: ['swept'],
  weep: ['wept'],
  creep: ['crept'],
  shut: ['shut'],
  cost: ['cost'],
  hurt: ['hurt'],
  quit: ['quit'],
  split: ['split'],
  spread: ['spread'],
  rise: ['rose', 'risen'],
  lie: ['lay', 'lain'],
  hit: ['hit'],
  cut: ['cut'],
  put: ['put'],
  let: ['let'],
  set: ['set'],
};

/** Words treated as auxiliaries for grouping purposes. */
const AUXILIARIES = new Set(
  `be am is are was were been being have has had having will would shall should can could may
   might must do does did done doing ought`.split(/\s+/),
);

/** `-ing` / `-ed` words that are almost never verbs. */
const NOT_VERBS = new Set(
  `red bed deed indeed greed shed wed fled led need
   thing king wing ring spring string during morning evening ceiling clothing
   nothing something anything everything wedding pudding building
   tiring boring interesting exciting amazing annoying outstanding
   tired excited worried married supposed used based`
    .split(/\s+/)
    .filter(Boolean),
);

/** Regular + irregular inflections of a base verb. */
function inflections(base: string): string[] {
  const forms = new Set<string>([base]);
  const add = (form: string) => forms.add(form);

  if (base === 'be') {
    for (const form of IRREGULAR.be) add(form);
    return [...forms];
  }

  // Third person singular.
  if (/(?:s|x|z|ch|sh|o)$/.test(base)) add(`${base}es`);
  else if (/[^aeiou]y$/.test(base)) add(`${base.slice(0, -1)}ies`);
  else add(`${base}s`);

  // Past tense / participle, and present participle.
  if (base.endsWith('ie')) {
    add(`${base.slice(0, -2)}ied`);
    add(`${base.slice(0, -2)}ying`);
  } else if (base.endsWith('e')) {
    add(`${base}d`);
    add(`${base.slice(0, -1)}ing`);
  } else if (/[^aeiou]y$/.test(base)) {
    add(`${base.slice(0, -1)}ied`);
    add(`${base}ing`);
  } else {
    add(`${base}ed`);
    add(`${base}ing`);
  }

  // Consonant doubling for short verbs: stop -> stopped / stopping.
  if (base.length <= 5 && /[^aeiouwxy][aeiou][^aeiouwxy]$/.test(base)) {
    add(`${base}${base.slice(-1)}ed`);
    add(`${base}${base.slice(-1)}ing`);
  }

  for (const form of IRREGULAR[base] ?? []) add(form);
  return [...forms];
}

interface LexiconEntry {
  base: string;
  kind: 'verb' | 'auxiliary';
}

const LEXICON: Map<string, LexiconEntry> = (() => {
  const map = new Map<string, LexiconEntry>();
  for (const base of BASE_VERBS) {
    const kind: LexiconEntry['kind'] = AUXILIARIES.has(base) ? 'auxiliary' : 'verb';
    for (const form of inflections(base)) {
      if (!map.has(form)) map.set(form, { base, kind });
    }
  }
  for (const form of AUXILIARIES) {
    if (!map.has(form)) map.set(form, { base: form, kind: 'auxiliary' });
  }
  return map;
})();

/* ------------------------------------------------------------------ */
/* Tool                                                                */
/* ------------------------------------------------------------------ */

interface Hit {
  token: WordToken;
  wordIndex: number;
  base: string;
  group: 'verb' | 'auxiliary' | 'guess';
}

export const verbsTool: Tool = {
  id: 'verbs',
  name: 'Verbs',
  description: 'Find verbs, measure verb density, and report the words between them.',
  category: 'grammar',
  color: '#ffb454',
  defaultEnabled: true,
  options: [
    { kind: 'boolean', id: 'includeAuxiliaries', label: 'Include auxiliaries', default: true, hint: 'be / have / do / will / can …' },
    { kind: 'boolean', id: 'includeGuesses', label: 'Guess unknown -ing / -ed words', default: false, hint: 'Flags any -ing/-ed word not in the lexicon, marked as a guess.' },
  ],

  run({ text, options }) {
    const includeAuxiliaries = options.includeAuxiliaries !== false;
    const includeGuesses = options.includeGuesses === true;

    const words = tokenizeWords(text);
    const hits: Hit[] = [];
    const counts = new Map<string, number>();

    words.forEach((token, wordIndex) => {
      const entry = LEXICON.get(token.lower);
      let group: Hit['group'] | null = null;
      let base = token.lower;

      if (entry) {
        group = entry.kind;
        base = entry.base;
      } else if (
        includeGuesses &&
        /(?:ing|ed)$/.test(token.lower) &&
        token.lower.length >= 5 &&
        !NOT_VERBS.has(token.lower)
      ) {
        group = 'guess';
      }

      if (!group) return;
      if (group === 'auxiliary' && !includeAuxiliaries) return;

      hits.push({ token, wordIndex, base, group });
      if (group === 'verb') counts.set(base, (counts.get(base) ?? 0) + 1);
    });

    const annotations: AnnotationDraft[] = hits.map((hit, index) => ({
      id: `verbs#${index}`,
      start: hit.token.start,
      end: hit.token.end,
      label: hit.token.text,
      group: hit.group,
      detail:
        hit.group === 'guess'
          ? `“${hit.token.text}” ends in -ing/-ed but is not in the built-in verb list — treated as a guess.`
          : hit.group === 'auxiliary'
            ? `Auxiliary form of “${hit.base}”.`
            : `Form of “${hit.base}”.`,
      data: { base: hit.base, kind: hit.group, wordIndex: hit.wordIndex },
    }));

    // Gap analysis: how many word tokens sit between consecutive detected verbs.
    const gaps: number[] = [];
    let longestGap = -1;
    let longestGapAt = -1;
    for (let i = 1; i < hits.length; i += 1) {
      const gap = hits[i].wordIndex - hits[i - 1].wordIndex - 1;
      gaps.push(gap);
      if (gap > longestGap) {
        longestGap = gap;
        longestGapAt = i;
      }
    }

    const verbCount = hits.filter((hit) => hit.group !== 'auxiliary').length;
    const sentenceCount = splitSentences(text).length;
    const avgGap = average(gaps);
    const topVerb = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

    let longestGapHint: string | undefined;
    if (longestGapAt > 0) {
      const from = hits[longestGapAt - 1].token.end;
      const to = hits[longestGapAt].token.start;
      const snippet = text.slice(from, to).trim().replace(/\s+/g, ' ');
      if (snippet) {
        const clipped = snippet.length > 48 ? snippet.slice(0, 48) + '\u2026' : snippet;
        longestGapHint = '\u201C' + clipped + '\u201D';
      }
    }

    const stats: Stat[] = [
      {
        id: 'verbs.count',
        label: 'Verbs',
        value: hits.length,
        hint: includeAuxiliaries ? `includes ${hits.length - verbCount} auxiliary` : 'auxiliaries hidden',
      },
      {
        id: 'verbs.density',
        label: 'Verbs / 100 words',
        value: words.length > 0 ? round((hits.length / words.length) * 100, 1) : 0,
        tone: 'accent',
      },
      {
        id: 'verbs.gap.avg',
        label: 'Avg words between verbs',
        value: avgGap === null ? '—' : round(avgGap, 1),
        hint: `${gaps.length} gap${gaps.length === 1 ? '' : 's'}`,
        tone: 'accent',
      },
      {
        id: 'verbs.gap.max',
        label: 'Longest verb-free stretch',
        value: longestGap < 0 ? '—' : `${longestGap} words`,
        hint: longestGapHint,
        tone: longestGap >= 12 ? 'warn' : 'neutral',
      },
      {
        id: 'verbs.per.sentence',
        label: 'Verbs / sentence',
        value: sentenceCount > 0 ? round(hits.length / sentenceCount, 2) : 0,
      },
      {
        id: 'verbs.top',
        label: 'Most used verb',
        value: topVerb ? topVerb[0] : '—',
        hint: topVerb ? `${topVerb[1]}×` : undefined,
      },
      { id: 'verbs.unique', label: 'Distinct verbs', value: counts.size },
    ];

    return { annotations, stats };
  },
};
