import { useMemo, useState } from 'react';
import type { AnalysisRun } from '../core/types';
import { lineCount, splitParagraphs, splitSentences, tokenizeWords } from '../core/text';

interface JsonViewProps {
  text: string;
  analysis: AnalysisRun;
}

/**
 * The machine-readable view of everything the engine produced.
 * Useful for building new tools: run the pipeline, then copy the shape you need.
 */
export function JsonView({ text, analysis }: JsonViewProps) {
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => {
    const payload = {
      document: {
        characters: text.length,
        lines: lineCount(text),
        paragraphs: splitParagraphs(text).length,
        words: tokenizeWords(text).length,
        sentences: splitSentences(text).length,
      },
      tools: Object.values(analysis.byTool).map(({ tool, result }) => ({
        id: tool.id,
        name: tool.name,
        category: tool.category,
        stats: result.stats ?? [],
        annotations: (result.annotations ?? []).map((annotation) => ({
          start: annotation.start,
          end: annotation.end,
          label: annotation.label,
          group: annotation.group,
          detail: annotation.detail,
          data: annotation.data,
        })),
      })),
    };
    return JSON.stringify(payload, null, 2);
  }, [text, analysis]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="json">
      <div className="json__toolbar">
        <span className="muted">
          {analysis.annotations.length} annotations from {Object.keys(analysis.byTool).length} tools
        </span>
        <button type="button" className="btn btn--sm" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy JSON'}
        </button>
      </div>
      <pre className="json__code">{json}</pre>
    </div>
  );
}
