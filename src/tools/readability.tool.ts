import { compareStat } from '../core/stat-norms';
import type { AnnotationDraft, Stat, Tone, Tool } from '../core/types';
import { countSyllables, isStopword, round, splitSentences, tokenizeWords } from '../core/text';

function fleschTone(score: number): Tone {
  if (score >= 60) return 'good';
  if (score >= 40) return 'neutral';
  if (score >= 25) return 'warn';
  return 'bad';
}

function gradeTone(grade: number): Tone {
  if (grade <= 9) return 'good';
  if (grade <= 12) return 'neutral';
  return 'warn';
}

function fleschLabel(score: number): string {
  if (score >= 90) return 'Very easy (5th grade)';
  if (score >= 80) return 'Easy (6th grade)';
  if (score >= 70) return 'Fairly easy (7th grade)';
  if (score >= 60) return 'Plain English (8th–9th grade)';
  if (score >= 50) return 'Fairly difficult (10th–12th grade)';
  if (score >= 30) return 'Difficult (college)';
  return 'Very difficult (college graduate)';
}

export const readabilityTool: Tool = {
  id: 'readability',
  name: 'Readability',
  description: 'Flesch, Flesch–Kincaid and Gunning Fog scores, plus the words driving them.',
  category: 'readability',
  color: '#a78bfa',
  defaultEnabled: true,
  options: [
    { kind: 'boolean', id: 'highlightComplex', label: 'Highlight complex words', default: true, hint: 'Words with at least “complex syllables” syllables.' },
    { kind: 'boolean', id: 'highlightLong', label: 'Highlight long sentences', default: true },
    { kind: 'number', id: 'complexSyllables', label: 'Complex at (syllables)', default: 3, min: 2, max: 6, step: 1 },
    { kind: 'number', id: 'longWords', label: 'Long sentence over (words)', default: 25, min: 5, max: 150, step: 1 },
  ],

  run({ text, options }) {
    const highlightComplex = options.highlightComplex !== false;
    const highlightLong = options.highlightLong !== false;
    const complexSyllables = Number(options.complexSyllables ?? 3);
    const longWords = Number(options.longWords ?? 25);

    const words = tokenizeWords(text);
    const sentenceRanges = splitSentences(text);
    const totalWords = words.length;
    const totalSentences = sentenceRanges.length;

    let totalSyllables = 0;
    let complexWordCount = 0;
    const complexAnnotations: AnnotationDraft[] = [];

    for (const token of words) {
      const syllables = countSyllables(token.lower);
      totalSyllables += syllables;
      const isComplex =
        syllables >= complexSyllables && token.lower.length > 4 && !isStopword(token.lower);
      if (!isComplex) continue;
      complexWordCount += 1;
      if (!highlightComplex) continue;
      complexAnnotations.push({
        start: token.start,
        end: token.end,
        label: token.text,
        group: 'complex',
        detail: `“${token.text}” carries roughly ${syllables} syllables.`,
        data: { syllables },
      });
    }

    const longAnnotations: AnnotationDraft[] = [];
    const sentenceLengths: number[] = [];
    for (const range of sentenceRanges) {
      const wordCount = tokenizeWords(text.slice(range.start, range.end)).length;
      sentenceLengths.push(wordCount);
      if (!highlightLong || wordCount <= longWords) continue;
      longAnnotations.push({
        start: range.start,
        end: range.end,
        label: `${wordCount} words`,
        group: 'long-sentence',
        detail: `This sentence is ${wordCount} words long, which inflates the grade level.`,
        data: { wordCount },
      });
    }

    const wordsPerSentence = totalSentences > 0 ? totalWords / totalSentences : 0;
    const syllablesPerWord = totalWords > 0 ? totalSyllables / totalWords : 0;

    const complexShare = complexWordCount / Math.max(totalWords, 1);
    const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
    const fleschKincaid = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
    const gunningFog = 0.4 * (wordsPerSentence + 100 * complexShare);

    // Comparisons are percentile chips against the CLEAR corpus; the raw counts
    // (long sentences, complex words) deliberately have none, because a count's
    // place in a fixed ~174-word excerpt measures length, not difficulty.
    const stats: Stat[] = [
      {
        id: 'read.flesch',
        label: 'Flesch Reading Ease',
        value: round(flesch, 1),
        hint: fleschLabel(flesch),
        tone: fleschTone(flesch),
        comparison: compareStat('read.flesch', flesch, 'Flesch Reading Ease'),
      },
      {
        id: 'read.fk',
        label: 'Flesch–Kincaid grade',
        value: round(fleschKincaid, 1),
        hint: 'US school grade level',
        tone: gradeTone(fleschKincaid),
        comparison: compareStat('read.fk', fleschKincaid, 'Flesch–Kincaid grade'),
      },
      {
        id: 'read.fog',
        label: 'Gunning Fog',
        value: round(gunningFog, 1),
        hint: `uses ${complexWordCount} complex words`,
        tone: gradeTone(gunningFog),
        comparison: compareStat('read.fog', gunningFog, 'Gunning Fog'),
      },
      {
        id: 'read.syllables',
        label: 'Syllables / word',
        value: round(syllablesPerWord, 2),
        tone: syllablesPerWord > 1.7 ? 'warn' : 'neutral',
        comparison: compareStat('read.syllables', syllablesPerWord, 'Syllables / word'),
      },
      {
        id: 'read.complex.share',
        label: 'Complex words',
        value: `${round(complexShare * 100, 1)}%`,
        hint: `${complexWordCount} of ${totalWords}`,
        comparison: compareStat('read.complex.share', complexShare, 'Complex words'),
      },
      {
        id: 'read.words.sentence',
        label: 'Words / sentence',
        value: round(wordsPerSentence, 1),
        comparison: compareStat('read.words.sentence', wordsPerSentence, 'Words / sentence'),
      },
      {
        id: 'read.long.sentences',
        label: 'Long sentences',
        value: sentenceLengths.filter((length) => length > longWords).length,
        hint: `> ${longWords} words`,
      },
    ];

    return {
      annotations: [...longAnnotations, ...complexAnnotations],
      stats,
      summary:
        'Higher scores mean easier text. The two groups are the things every formula here punishes: ' +
        'long words and long sentences.',
      groupDescriptions: {
        complex:
          'A word of three or more syllables that is not a stopword. Long words raise every formula ' +
          'here; a shorter synonym or unpacking the idea is the usual fix.',
        'long-sentence':
          'A sentence over the word threshold. Length is not automatically bad — long sentences often ' +
          'carry the argument — but they are where readers lose the thread. Splitting at a clause ' +
          'boundary usually helps.',
      },
      groupExamples: {
        complex: '“utilize, demonstrate, facilitate” → “use, show, help”',
        'long-sentence':
          '“The report, which the team finished after several delays, was published because the editor ' +
          'liked it.” → “The team finished the report after several delays. The editor liked it, so it ' +
          'was published.”',
      },
    };
  },
};
