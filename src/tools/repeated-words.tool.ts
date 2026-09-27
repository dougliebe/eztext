import type { AnnotationDraft, Stat, Tool } from '../core/types';
import { isStopword, round, tokenizeWords } from '../core/text';

export const repeatedWordsTool: Tool = {
  id: 'repeats',
  name: 'Repeated words',
  description: 'Surface words that appear several times, a common sign of a thin vocabulary.',
  category: 'lexical',
  color: '#f2749c',
  defaultEnabled: false,
  options: [
    { kind: 'number', id: 'minCount', label: 'Minimum occurrences', default: 3, min: 2, max: 20, step: 1 },
    { kind: 'number', id: 'minLength', label: 'Minimum word length', default: 4, min: 1, max: 15, step: 1 },
    { kind: 'boolean', id: 'ignoreStopwords', label: 'Ignore stop words', default: true, hint: 'Skips the, and, of, …' },
    { kind: 'boolean', id: 'caseSensitive', label: 'Case sensitive', default: false },
  ],

  run({ text, options }) {
    const minCount = Number(options.minCount ?? 3);
    const minLength = Number(options.minLength ?? 4);
    const ignoreStopwords = options.ignoreStopwords !== false;
    const caseSensitive = options.caseSensitive === true;

    const tokens = tokenizeWords(text);
    const occurrences = new Map<string, number[]>();

    tokens.forEach((token, index) => {
      if (token.lower.length < minLength) return;
      if (!/[a-z]/i.test(token.lower)) return;
      if (ignoreStopwords && isStopword(token.lower)) return;
      const key = caseSensitive ? token.text : token.lower;
      const list = occurrences.get(key);
      if (list) list.push(index);
      else occurrences.set(key, [index]);
    });

    const repeated = [...occurrences.entries()]
      .filter(([, indices]) => indices.length >= minCount)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    const annotations: AnnotationDraft[] = [];
    for (const [word, indices] of repeated) {
      indices.forEach((index, occurrence) => {
        const token = tokens[index];
        annotations.push({
          start: token.start,
          end: token.end,
          label: word,
          group: word,
          detail: `“${word}” appears ${indices.length} times — this is occurrence ${occurrence + 1}.`,
          data: { word, count: indices.length, occurrence: occurrence + 1 },
        });
      });
    }
    annotations.sort((a, b) => a.start - b.start);

    const repeatedTokens = repeated.reduce((sum, [, indices]) => sum + indices.length, 0);
    const contentWords = tokens.filter((token) => !(ignoreStopwords && isStopword(token.lower))).length;
    const top = repeated[0];

    const stats: Stat[] = [
      { id: 'repeats.types', label: 'Repeated words', value: repeated.length, hint: `≥ ${minCount}×` },
      { id: 'repeats.tokens', label: 'Occurrences', value: repeatedTokens, tone: 'accent' },
      {
        id: 'repeats.share',
        label: 'Share of words',
        value: contentWords > 0 ? `${round((repeatedTokens / contentWords) * 100, 1)}%` : '—',
        hint: 'of counted words are repeats',
        tone: repeatedTokens / Math.max(contentWords, 1) > 0.2 ? 'warn' : 'neutral',
      },
      {
        id: 'repeats.top',
        label: 'Most repeated',
        value: top ? top[0] : '—',
        hint: top ? `${top[1].length}×` : undefined,
      },
      {
        id: 'repeats.toplist',
        label: 'Top repeats',
        value: repeated.length > 0 ? repeated.slice(0, 5).map(([word]) => word).join(', ') : '—',
      },
      { id: 'repeats.unique', label: 'Distinct words', value: occurrences.size },
    ];

    return { annotations, stats };
  },
};
