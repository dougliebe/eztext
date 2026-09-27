import { useEffect, useRef, useState } from 'react';
import { continueFrom, type Continuation } from '../core/model-client';
import type { ScoredWord, SurprisalScores } from '../core/surprisal';
import type { ResolvedAnnotation } from '../core/types';

interface InspectorProps {
  selection: ResolvedAnnotation | null;
  /** Live model scores, for the alternatives; absent when the text is unscored. */
  scores: SurprisalScores | null;
  /**
   * Whether an active tool is asking for model scores. The model's output — the
   * word's own bits, the continuation table — is only shown when it is, so
   * turning the Surprisal tool off turns off everything it draws here, even for
   * a selection from another tool that happens to start at a scored offset.
   */
  modelActive: boolean;
  text: string;
  /** Canonical before → after example for the selected annotation's group. */
  example?: string;
  onClose: () => void;
}

/**
 * Inspector for whatever is selected in the preview.
 *
 * Pinned to the top of the results pane so it stays put while the list scrolls
 * beneath it. When the selected range is a scored word it shows the whole
 * distribution the model had at that position — the point of the surprisal tool
 * is not the number, it is *what else the word could have been*.
 *
 * The model sections belong to the Surprisal tool and appear only while it is
 * active. Selecting a readability word that happens to sit at a scored offset
 * shows the readability detail, not the model's answer about a word the reader
 * is not currently being shown.
 */
export function Inspector({ selection, scores, modelActive, text, example, onClose }: InspectorProps) {
  // Before the early return: hooks cannot come and go with the selection.
  const continuations = useContinuation(text, selection, modelActive && scores !== null);
  if (!selection) return null;

  // Scores describe the *text*, so the lookup by offset would also match a word
  // selected by another tool; `modelActive` keeps that tool's output out.
  const word = modelActive
    ? scores?.words.find((candidate) => candidate.start === selection.start) ?? null
    : null;
  const bits = typeof selection.data?.bits === 'number' ? selection.data.bits : null;
  const suggestions = readSuggestions(selection.data);

  // Optional per-annotation breakdown (GSDS dense units): the weighted shares
  // that make this range dense, biggest first, with the words that earned them.
  const contributors = Array.isArray(selection.data?.contributors)
    ? (
        selection.data.contributors as Array<{ label?: unknown; value?: unknown; words?: unknown }>
      ).flatMap((entry) => {
        if (!entry || typeof entry.label !== 'string' || typeof entry.value !== 'number') return [];
        const words = Array.isArray(entry.words)
          ? entry.words.filter((word): word is string => typeof word === 'string')
          : [];
        return [{ label: entry.label, value: entry.value, words }];
      })
    : [];

  return (
    <section className="inspector" aria-label="Inspector">
      <header className="inspector__head">
        <span className="inspector__eyebrow">{selection.toolName}</span>
        <span className="inspector__word">{selection.text.trim() || selection.label}</span>
        {bits !== null && (
          <span className="inspector__bits" title="Surprisal: −log₂ P(word | preceding text)">
            {bits.toFixed(2)} bits
          </span>
        )}
        <span className="inspector__range">
          {selection.start}–{selection.end}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm inspector__close"
          onClick={onClose}
          aria-label="Clear selection"
        >
          ✕
        </button>
      </header>

      {word ? <WordStats word={word} /> : <p className="inspector__detail">{selection.detail ?? 'No further detail for this range.'}</p>}

      {contributors.length > 0 && (
        <div className="inspector__contributors">
          <span className="inspector__contributors-label">What makes it dense</span>
          <ul className="inspector__contributor-list">
            {contributors.map((entry) => (
              <li key={entry.label}>
                <span>
                  {entry.label}
                  {entry.words.length > 0 && (
                    <span className="inspector__contributor-words"> — {entry.words.join(', ')}</span>
                  )}
                </span>
                <span className="inspector__contributor-value">{entry.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {example && (
        <p className="inspector__example">
          <span className="inspector__example-label">Example fix</span>
          <span>{example}</span>
        </p>
      )}

      {modelActive && (
        <Continuations
          rows={continuations.rows}
          pending={continuations.pending}
          enabled={scores !== null}
          written={selection.text.trim()}
        />
      )}

      {suggestions.length > 0 && <Suggestions items={suggestions} />}
    </section>
  );
}

/**
 * Where the model would take the sentence, starting *at* the selection.
 *
 * The prompt stops where the selected word starts, so the model's first word is
 * its candidate for the slot the writer filled — which is what makes this cover
 * the surprising word rather than talking about what follows it. For "I want to
 * eat ␣salmon␣", the question is "I want to eat …", and the answers are salmon's
 * replacements and whatever the model would have written after them.
 *
 * Requested per selection rather than computed with the run: five branches take
 * the model about a second, which is fine for one deliberate click and far too
 * much to pay for every keystroke.
 */
function useContinuation(text: string, selection: ResolvedAnnotation | null, enabled: boolean) {
  const cache = useRef(new Map<string, Continuation[]>());
  const [fetched, setFetched] = useState<{ key: string; rows: Continuation[] } | null>(null);
  const [pending, setPending] = useState(false);

  const prefix = selection ? text.slice(0, selection.start) : '';
  // Keyed on the text the model actually sees (its tail) as well as the offset,
  // so editing *after* the selection — which cannot change the continuation —
  // reuses the answer, while editing before it does not.
  const key = selection ? `${selection.start}\u0000${prefix.slice(-48)}` : '';

  useEffect(() => {
    if (!key || !enabled) {
      setPending(false);
      return;
    }

    const cached = cache.current.get(key);
    if (cached) {
      setFetched({ key, rows: cached });
      setPending(false);
      return;
    }

    const controller = new AbortController();
    setPending(true);
    // A click that is immediately followed by another click should pay for one
    // continuation, not two: the model process computes what it is given.
    const timer = window.setTimeout(() => {
      void continueFrom(prefix, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        setPending(false);
        if (!result) return;
        cache.current.set(key, result.rows);
        setFetched({ key, rows: result.rows });
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, prefix, enabled]);

  return { rows: fetched && fetched.key === key ? fetched.rows : null, pending };
}

function Continuations({
  rows,
  pending,
  enabled,
  written,
}: {
  rows: Continuation[] | null;
  pending: boolean;
  enabled: boolean;
  /** The word the writer actually used, so the model's branch matching it can be marked. */
  written: string;
}) {
  return (
    <div className="inspector__body">
      <p className="inspector__lead">
        Where the model goes next
        {rows && rows.length > 0 && <span className="inspector__hint">from the selected word on</span>}
      </p>

      {!enabled ? (
        <p className="inspector__detail">
          Run the model to see the phrases it would write from here.
        </p>
      ) : rows === null ? (
        <p className="inspector__detail" aria-busy={pending || undefined}>
          {pending ? 'Asking the model…' : 'The model process stopped, so there is no continuation to show.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="inspector__detail">Nothing before this point for the model to continue from.</p>
      ) : (
        <table className="next">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Next words</th>
              <th scope="col">Bits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rank) => {
              // A row that opens with the writer's own word is the model agreeing:
              // where it lands is the whole story of how expected this word was.
              const mine = sameWord(firstWord(row.text), written);
              return (
                <tr key={row.text} className={mine ? 'next__row--written' : undefined}>
                  <td className="next__rank">{rank + 1}</td>
                  <td className="next__text">
                    {row.text}
                    {mine && <span className="next__tag">written</span>}
                  </td>
                  <td className="next__bits" title="−log₂ P of the whole phrase">
                    {row.bits.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const firstWord = (phrase: string) => phrase.split(' ')[0] ?? '';

/** Compare on letters only, so "revise" matches "revise." and "Revise". */
function sameWord(a: string, b: string): boolean {
  const clean = (value: string) => value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  const left = clean(a);
  const right = clean(b);
  return left.length > 0 && left === right;
}

/**
 * The selected word's own numbers.
 *
 * Only figures about the word that was written: how much it cost, how likely it
 * was, how many pieces it took. What the model expected *instead* is the
 * continuation table's job now — it answers that from the same prompt the phrases
 * come from, and it names the written word when the model offered it. A second
 * "cheaper word" here would answer the same question from the whole-document
 * distribution instead of the table's shortened context, so the two would
 * sometimes disagree in front of the reader.
 */
function WordStats({ word }: { word: ScoredWord }) {
  const probability = 2 ** -word.bits;

  return (
    <div className="inspector__body">
      <div className="inspector__stats">
        <Field label="Surprisal" value={`${word.bits.toFixed(2)} bits`} />
        <Field
          label="Probability"
          value={probability < 0.001 ? probability.toExponential(1) : `${(probability * 100).toFixed(2)}%`}
        />
        <Field label="Pieces" value={String(word.tokenCount)} />
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`inspector__stat${tone ? ` inspector__stat--${tone}` : ''}`}>
      <span className="inspector__stat-label">{label}</span>
      <span className="inspector__stat-value">{value}</span>
    </div>
  );
}

/** Display names for the relations a tool can attach to a suggestion. */
const RELATION_LABELS: Record<string, string> = {
  'base form': 'its base word',
  'shorter form': 'a shorter form of it',
  'similar meaning': 'close in meaning',
};

interface SuggestionRow {
  word: string;
  relation?: string;
  /** Probability a reader knows the word, 0–1, when the tool supplies it. */
  known?: number;
}

/**
 * Alternatives a tool attaches to an annotation — the Common words tool's nearest
 * words, for instance.
 *
 * Deliberately tolerant about the payload: a tool may send plain strings or
 * objects carrying `word` (and optionally `relation` and `known`), so any tool
 * can offer suggestions without the inspector knowing which tool it is.
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
      const known = (entry as { known?: unknown }).known;
      if (word) {
        rows.push({
          word,
          relation: typeof relation === 'string' ? relation : undefined,
          known: typeof known === 'number' && Number.isFinite(known) ? known : undefined,
        });
      }
    }
  }
  return rows;
}

function Suggestions({ items }: { items: SuggestionRow[] }) {
  return (
    <div className="inspector__body">
      <table className="alts alts--compact">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Suggestion</th>
            <th scope="col">Relation</th>
            <th scope="col" title="Probability a reader knows the word">
              Known
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, rank) => (
            <tr key={item.word}>
              <td className="alts__rank">{rank + 1}</td>
              <td className="alts__word">{item.word}</td>
              <td>
                <span className="inspector__hint">
                  {item.relation ? (RELATION_LABELS[item.relation] ?? item.relation) : 'similar word'}
                </span>
              </td>
              {/* One decimal on purpose: the ceiling is 99.5%, and rounding it to
                  "100%" would claim a certainty the survey does not have. */}
              <td className="alts__bits">
                {item.known === undefined ? '—' : `${(item.known * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
