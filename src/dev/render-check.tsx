/**
 * Headless render check.
 *
 * Server-renders the whole app once and asserts that the pieces that matter
 * actually made it into the markup: the toolbar, the highlight preview with
 * resolved annotation ids, the coverage tracks and the results rows. This
 * catches render-time crashes and broken wiring without a browser.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
import { CLEAR_CORPUS } from '../core/data/corpus-norms';
import { HEAT_METRICS } from '../core/heatmap';

const html = renderToStaticMarkup(createElement(App));

const checks: Array<[string, boolean]> = [
  ['brand renders', html.includes('eztext')],
  ['toolbar renders every tool', ['Sentences', 'Verbs', 'Repeated words', 'Readability'].every((name) => html.includes(name))],
  ['metrics render', html.includes('Read time') && html.includes('Annotations')],
  [
    'language metrics render',
    ['Words / sentence', 'Chars / word', '% polysyllabic', '% unfamiliar', 'Syllables / word'].every((label) =>
      html.includes(label),
    ),
  ],
  ['metric tooltips render', html.includes('Dale–Chall list of ~3,000 familiar words')],
  [
    'every heat metric is a clickable toggle',
    (() => {
      // Scoped to metric buttons: toolbar chips carry aria-pressed too.
      const buttons = html.match(/<button[^>]*metric--clickable[^>]*>/g) ?? [];
      return (
        buttons.length === Object.keys(HEAT_METRICS).length &&
        buttons.every((tag) => /aria-pressed="(true|false)"/.test(tag))
      );
    })(),
  ],
  [
    'corpus percentiles render',
    html.includes('data-percentile=') &&
      html.includes(CLEAR_CORPUS.name) &&
      html.includes(`n=${CLEAR_CORPUS.n.toLocaleString('en-US')}`) &&
      !html.includes('\u03C3'),
  ],
  ['preview contains resolved annotations', /data-ann="/.test(html)],
  ['preview contains layer tool ids', /data-tool="/.test(html)],
  ['overlapping layers are nested', (html.match(/data-ann="/g)?.length ?? 0) > 0 && (html.match(/<span class="hl/g)?.length ?? 0) > 3],
  ['coverage strip renders', html.includes('coverage__track')],
  ['result rows render', html.includes('data-row="')],
  ['stat cards render', html.includes('stat__value')],
  ['no unresolved template markers', !html.includes('undefined') && !html.includes('NaN')],
];

let failures = 0;
console.log(`\nrender check — ${html.length} characters of markup\n${'─'.repeat(78)}`);
for (const [label, ok] of checks) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const annotationCount = html.match(/data-ann="/g)?.length ?? 0;
const rowCount = html.match(/data-row="/g)?.length ?? 0;
console.log(`\n  ${annotationCount} rendered highlight spans, ${rowCount} result rows`);
console.log(`  ${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);

if (failures > 0) process.exitCode = 1;
