import type { AnnotationDraft, Stat, Tool } from '../core/types';
import { average, median, round, splitSentences, tokenizeWords } from '../core/text';

/** Population standard deviation — a crude measure of sentence-length rhythm. */
function stdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export const sentencesTool: Tool = {
  id: 'sentences',
  name: 'Sentences',
  description: 'Split the document into sentences and flag the unusually long ones.',
  category: 'structure',
  color: '#4f9cf9',
  defaultEnabled: true,
  options: [
    {
      kind: 'select',
      id: 'mode',
      label: 'Highlight',
      default: 'all',
      choices: [
        { value: 'all', label: 'Every sentence' },
        { value: 'long', label: 'Long sentences only' },
      ],
    },
    {
      kind: 'number',
      id: 'longWords',
      label: 'Long if over (words)',
      default: 25,
      min: 5,
      max: 150,
      step: 1,
      hint: 'Sentences with more words than this are grouped as “long”.',
    },
  ],

  run({ text, options }) {
    const mode = String(options.mode ?? 'all');
    const longWords = Number(options.longWords ?? 25);

    const sentences = splitSentences(text);
    const lengths: number[] = [];
    const annotations: AnnotationDraft[] = [];

    sentences.forEach((range, index) => {
      const slice = text.slice(range.start, range.end);
      const wordCount = tokenizeWords(slice).length;
      const isLong = wordCount > longWords;
      const ordinal = index + 1;
      lengths.push(wordCount);

      annotations.push({
        start: range.start,
        end: range.end,
        label: `Sentence ${ordinal} · ${wordCount}w`,
        group: isLong ? 'long' : 'normal',
        detail: isLong
          ? `Sentence ${ordinal} runs ${wordCount} words — over the ${longWords}-word threshold.`
          : `Sentence ${ordinal}: ${wordCount} words, ${slice.length} characters.`,
        data: { ordinal, wordCount, isLong },
      });
    });

    const visible = mode === 'long' ? annotations.filter((a) => a.group === 'long') : annotations;

    const mean = average(lengths) ?? 0;
    const spread = stdDev(lengths, mean);
    const longest = lengths.length > 0 ? Math.max(...lengths) : 0;
    const longestIndex = lengths.indexOf(longest);
    const longCount = lengths.filter((value) => value > longWords).length;

    const stats: Stat[] = [
      { id: 'sentences.count', label: 'Sentences', value: lengths.length },
      { id: 'sentences.paragraphs', label: 'Long sentences', value: longCount, hint: `> ${longWords} words`, tone: longCount > 0 ? 'warn' : 'good' },
      { id: 'sentences.words.avg', label: 'Avg words / sentence', value: round(mean, 1), tone: mean > 25 ? 'warn' : 'good' },
      { id: 'sentences.words.median', label: 'Median words', value: round(median(lengths) ?? 0, 1) },
      { id: 'sentences.words.max', label: 'Longest sentence', value: `${longest} words`, hint: longestIndex >= 0 ? `Sentence ${longestIndex + 1}` : undefined },
      { id: 'sentences.words.spread', label: 'Length variation', value: round(spread, 1), hint: 'std. dev., words', tone: spread > 12 ? 'warn' : 'neutral' },
    ];

    return { annotations: visible, stats };
  },
};
