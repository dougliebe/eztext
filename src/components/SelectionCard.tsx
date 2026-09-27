import type { SurprisalScores, ScoredToken, ScoredWord } from '../core/surprisal';
import type { ResolvedAnnotation } from '../core/types';

interface SelectionCardProps {
  selection: ResolvedAnnotation | null;
  /** Live model scores, for the alternatives; absent when the text is unscored. */
  scores: SurprisalScores | null;
  text: string;
  onClose: () => void;
}

/**
 * Inspector for whatever is selected in the preview.
 *
 * Pinned to the top of the results pane so it stays put while the list scrolls
 * beneath it. When the selected range is a scored word it shows the whole
 * distribution the model had at that position — the point of the surprisal tool
 * is not the number, it is *what else the word could have been*.
 */
export function SelectionCard({ selection, scores, text, onClose }: SelectionCardProps) {
  if (!selection) return null;

  const word = scores?.words.find((candidate) => candidate.start === selection.start) ?? null;
  // The alternatives belong to the position where the word was chosen, which is
  // its first piece — a continuation piece would report the wrong distribution.
  const token = word ? (scores?.tokens.find((candidate) => candidate.start === word.start) ?? null) : null;
  const bits = typeof selection.data?.bits === 'number' ? selection.data.bits : null;
  const suggestions = readSuggestions(selection.data);

  return (
    <section className="selection" aria-label="Selected text">
      <header className="selection__head">
        <span className="selection__eyebrow">{selection.toolName}</span>
        <span className="selection__word">{selection.text.trim() || selection.label}</span>
        {bits !== null && (
          <span className="selection__bits" title="Surprisal: −log₂ P(word | preceding text)">
            {bits.toFixed(2)} bits
          </span>
        )}
        <span className="selection__range">
          {selection.start}–{selection.end}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm selection__close"
          onClick={onClose}
          aria-label="Clear selection"
        >
          ✕
        </button>
      </header>

      <p className="selection__context">{contextAround(text, selection.start, selection.end)}</p>

      {word && token ? (
        <Alternatives word={word} token={token} />
      ) : (
        <p className="selection__detail">{selection.detail ?? 'No further detail for this range.'}</p>
      )}

      {suggestions.length > 0 && <Suggestions items={suggestions} />}
    </section>
  );
}

function Alternatives({ word, token }: { word: ScoredWord; token: ScoredToken }) {
  const probability = 2 ** -word.bits;
  const expected = word.expected;

  return (
    <div className="selection__body">
      <div className="selection__stats">
        <Field label="Surprisal" value={`${word.bits.toFixed(2)} bits`} />
        <Field
          label="Probability"
          value={probability < 0.001 ? probability.toExponential(1) : `${(probability * 100).toFixed(2)}%`}
        />
        <Field label="Pieces" value={String(word.tokenCount)} />
        {expected && <Field label="Could have saved" value={`${expected.gain.toFixed(2)} bits`} tone="warn" />}
      </div>

      <p className="selection__detail">
        {expected ? (
          <>
            The model expected <code>{expected.text}</code> here — writing it would have cost{' '}
            {expected.gain.toFixed(2)} bits less.
          </>
        ) : (
          <>The model expected exactly this word, so there is no cheaper alternative to compare against.</>
        )}
      </p>

      {token.alternatives.length > 0 && (
        <table className="alts">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Word the model predicted</th>
              <th scope="col">Probability</th>
              <th scope="col">Bits</th>
              <th scope="col">Bits saved</th>
            </tr>
          </thead>
          <tbody>
            {/* Rank 0 is the model's own first choice; the written word is
                marked where it lands, which is the whole story in one glance. */}
            {token.alternatives.map((alternative, rank) => {
              const written = alternative.text === token.text;
              return (
                <tr key={`${alternative.text}-${rank}`} className={written ? 'alts__row--written' : undefined}>
                  <td className="alts__rank">{rank + 1}</td>
                  <td className="alts__word">
                    {alternative.text.trim() || '␣'}
                    {written && <span className="alts__tag">written</span>}
                  </td>
                  <td className="alts__prob">
                    <span className="alts__bar" style={{ width: `${Math.max(2, alternative.probability * 100)}%` }} />
                    <span className="alts__pct">
                      {alternative.probability < 0.001
                        ? alternative.probability.toExponential(1)
                        : `${(alternative.probability * 100).toFixed(2)}%`}
                    </span>
                  </td>
                  <td className="alts__bits">{alternative.bits.toFixed(2)}</td>
                  <td className="alts__gain">{written ? '—' : alternative.gain.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`selection__stat${tone ? ` selection__stat--${tone}` : ''}`}>
      <span className="selection__stat-label">{label}</span>
      <span className="selection__stat-value">{value}</span>
    </div>
  );
}

/** The selected word in a little surrounding text, so the card reads on its own. */
function contextAround(text: string, start: number, end: number, span = 70): string {
  const from = Math.max(0, start - span);
  const to = Math.min(text.length, end + span);
  const before = text.slice(from, start).replace(/\s+/g, ' ');
  const after = text.slice(end, to).replace(/\s+/g, ' ');
  const word = text.slice(start, end).replace(/\s+/g, ' ');
  return `${from > 0 ? '…' : ''}${before}【${word}】${after}${to < text.length ? '…' : ''}`;
}

/** Display names for the relations a tool can attach to a suggestion. */
const RELATION_LABELS: Record<string, string> = {
  'base form': 'its base word',
  'shorter form': 'a shorter form of it',
  'similar meaning': 'close in meaning',
  'close spelling': 'close in spelling',
};

interface SuggestionRow {
  word: string;
  relation?: string;
}

/**
 * Alternatives a tool attaches to an annotation — the Common words tool's nearest
 * words, for instance.
 *
 * Deliberately tolerant about the payload: a tool may send plain strings or
 * objects carrying `word` (and optionally `relation`), so any tool can offer
 * suggestions without the inspector knowing which tool it is.
 */
function readSuggestions(data: Record<string, unknown> | undefined): SuggestionRow[] {
  const raw = data?.suggestions;
  if (!Array.isArray(raw)) return [];

  const rows: SuggestionRow[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry) rows.push({ word: entry });
      continue;
    }
    if (entry && typeof entry === 'object' && 'word' in entry) {
      const word = String((entry as { word: unknown }).word ?? '');
      const relation = (entry as { relation?: unknown }).relation;
      if (word) rows.push({ word, relation: typeof relation === 'string' ? relation : undefined });
    }
  }
  return rows;
}

function Suggestions({ items }: { items: SuggestionRow[] }) {
  return (
    <div className="selection__body">
      <table className="alts">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Suggestion</th>
            <th scope="col">Relation</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, rank) => (
            <tr key={item.word}>
              <td className="alts__rank">{rank + 1}</td>
              <td className="alts__word">{item.word}</td>
              <td>
                <span className="selection__hint">
                  {item.relation ? (RELATION_LABELS[item.relation] ?? item.relation) : 'similar word'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
