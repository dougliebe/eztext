/**
 * Real-browser layout regression check.
 *
 * Drives the installed Chrome/Edge through playwright-core (no browser download)
 * against a running dev or preview server:
 *
 *   npm run dev            # in one shell
 *   npm run ui-check       # in another  (override with EZ_URL=...)
 *
 * What it guards against:
 *   1. a drag must not "reset" first — the divider follows the pointer delta
 *      from wherever it already is;
 *   2. pane content must never resize a pane — collapsing/expanding tool panels
 *      or switching result tabs must leave the divider exactly where it was.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const baseUrl = process.env.EZ_URL ?? process.argv[2] ?? 'http://localhost:5173';

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const near = (a, b, tolerance = 0.008) => Math.abs(a - b) <= tolerance;
const pct = (value) => `${(value * 100).toFixed(1)}%`;

const reachable = await fetch(baseUrl)
  .then((response) => response.ok)
  .catch(() => false);

if (!reachable) {
  console.error(`\nNo server at ${baseUrl}. Start one with \`npm run dev\`, then re-run \`npm run ui-check\`.\n`);
  process.exit(1);
}

const executablePath = BROWSERS.find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

/** Visual geometry read straight from the DOM: no app state involved. */
const layout = () =>
  page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`missing ${selector}`);
      return node.getBoundingClientRect();
    };
    const workbench = box('.workbench');
    const top = box('.workbench__top');
    const row = box('.workbench__row');
    const column = box('.workbench__column');
    return {
      workbenchTop: workbench.top,
      workbenchHeight: workbench.height,
      topHeight: top.height,
      bottomHeight: box('.workbench__bottom').height,
      dividerY: box('.splitter--y').y,
      rowWidth: row.width,
      columnWidth: column.width,
      dividerX: box('.splitter--x').x,
    };
  });

const ratioY = (l) => (l.dividerY - l.workbenchTop) / l.workbenchHeight;
const ratioX = (l) => l.columnWidth / l.rowWidth;

const drag = async (axis, steps) => {
  const box = await page.locator(`.splitter--${axis}`).boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  const samples = [];
  for (const offset of steps) {
    await page.mouse.move(axis === 'y' ? startX : startX + offset, axis === 'y' ? startY + offset : startY);
    await page.waitForTimeout(30);
    const l = await layout();
    samples.push(axis === 'y' ? ratioY(l) : ratioX(l));
  }

  await page.mouse.up();
  await page.waitForTimeout(300); // let the debounced persist write land
  return { samples, start: axis === 'y' ? ratioY(await layout()) : ratioX(await layout()) };
};

console.log(`\neztext layout check — ${baseUrl}\n${'─'.repeat(78)}`);
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForSelector('.workbench__top');

// --- 0. the page must actually be styled ---------------------------------
// A stale dev-server transform can serve `const __vite__css = ""`, which looks
// like a layout catastrophe rather than a missing stylesheet. Fail loudly here.
const styling = await page.evaluate(() => {
  const app = document.querySelector('.app');
  const chip = document.querySelector('.chip');
  return {
    sheets: document.styleSheets.length,
    chipRadius: chip ? getComputedStyle(chip).borderRadius : '0px',
    metricValueDisplay: getComputedStyle(document.querySelector('.metric__value')).display,
    appHeight: Math.round(app.getBoundingClientRect().height),
    viewport: window.innerHeight,
  };
});
check(
  'stylesheet is applied',
  styling.sheets > 0 && styling.chipRadius !== '0px' && styling.metricValueDisplay === 'flex',
  `${styling.sheets} sheet(s), chip radius ${styling.chipRadius}, metric value ${styling.metricValueDisplay}`,
);
check(
  'page is not rendering unstyled',
  styling.appHeight <= styling.viewport + 1,
  `app is ${styling.appHeight}px in a ${styling.viewport}px viewport`,
);

// --- 1. the default still matches the intended 62% -----------------------
const initial = await layout();
check('top pane defaults to 62% of the workbench', near(ratioY(initial), 0.62), pct(ratioY(initial)));
check('panes fill the workbench exactly', near(initial.topHeight + initial.bottomHeight + 7, initial.workbenchHeight, 1.5),
  `${initial.topHeight.toFixed(1)} + ${initial.bottomHeight.toFixed(1)} + 7 vs ${initial.workbenchHeight.toFixed(1)}`);

// --- 1b. the topbar must not grow into the workbench ---------------------
const header = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.metric__label')].map((node) => node.textContent);
  return {
    labels,
    percentileChips: [...document.querySelectorAll('.metric__chip')].map((node) => node.textContent),
    height: document.querySelector('.topbar').getBoundingClientRect().height,
    viewport: window.innerHeight,
  };
});
const requiredMetrics = ['Words / sentence', 'Chars / word', '% polysyllabic', '% unfamiliar', 'Syllables / word'];
check(
  'topbar shows the language metrics',
  requiredMetrics.every((label) => header.labels.includes(label)),
  `${header.labels.length} metrics`,
);
check(
  'each language metric carries a percentile chip',
  header.percentileChips.length === requiredMetrics.length &&
    header.percentileChips.every((chip) => /^(<1st|>99th|\d+(st|nd|rd|th))$/.test(chip)),
  header.percentileChips.join(' '),
);
check(
  'topbar does not squeeze the workbench',
  header.height / header.viewport < 0.15,
  `${Math.round(header.height)}px of ${header.viewport}px`,
);

// --- 2. horizontal drag: no reset, moves with the pointer ----------------
const vertical = await drag('y', [20, 40, 60, 80, 100, 120]);
const rising = vertical.samples.every((value, index) => index === 0 || value >= vertical.samples[index - 1] - 0.001);
check('vertical divider never dips below its start during a drag',
  Math.min(...vertical.samples) >= ratioY(initial) - 0.005,
  `start ${pct(ratioY(initial))}, min ${pct(Math.min(...vertical.samples))}`);
check('vertical divider tracks the pointer monotonically', rising,
  vertical.samples.map(pct).join(' → '));

const expectedY = ratioY(initial) + 120 / initial.workbenchHeight;
check('vertical drag distance matches the pointer', near(vertical.samples.at(-1), expectedY, 0.02),
  `${pct(vertical.samples.at(-1))} vs expected ${pct(expectedY)}`);

// --- 3. the dragged ratio survives a reload ------------------------------
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.workbench__top');
const afterReload = await layout();
check('dragged ratio is restored after reload', near(ratioY(afterReload), vertical.samples.at(-1), 0.01),
  pct(ratioY(afterReload)));

// --- 4. content must not resize the panes --------------------------------
const tryClick = async (locator) => {
  try {
    await locator.click({ timeout: 2500 });
    return true;
  } catch {
    return false;
  }
};

const beforePanels = await layout();
const toggles = page.locator('.tool-panel__toggle');

let collapsedCount = 0;
for (let i = 0, n = await toggles.count(); i < n; i += 1) {
  if (await tryClick(toggles.nth(i))) collapsedCount += 1;
}
const toggleTotal = await toggles.count();
// If the panes overlap, clicks land on the wrong element — that is itself a failure.
check('every tool panel is clickable', collapsedCount === toggleTotal, `${collapsedCount} of ${toggleTotal}`);

await page.waitForTimeout(80);
const collapsed = await layout();
check('collapsing every tool panel leaves the divider alone', near(ratioY(collapsed), ratioY(beforePanels), 0.002),
  `${pct(ratioY(beforePanels))} → ${pct(ratioY(collapsed))}`);

let expandedCount = 0;
for (let i = 0, n = await toggles.count(); i < n; i += 1) {
  if (await tryClick(toggles.nth(i))) expandedCount += 1;
}
await page.waitForTimeout(80);
const expanded = await layout();
check('expanding every tool panel leaves the divider alone', near(ratioY(expanded), ratioY(beforePanels), 0.002),
  `${pct(ratioY(beforePanels))} → ${pct(ratioY(expanded))}`);

// The results pane must own its overflow instead of spilling over the input pane.
const overlap = await page.evaluate(() => {
  const top = document.querySelector('.workbench__top').getBoundingClientRect();
  const bottom = document.querySelector('.workbench__bottom').getBoundingClientRect();
  const text = document.querySelector('.input__area').getBoundingClientRect();
  const toggle = document.querySelector('.tool-panel__toggle');
  const toggleBox = toggle ? toggle.getBoundingClientRect() : null;
  return {
    panesOverlap: top.bottom > bottom.top + 1,
    textareaCoversToggle: Boolean(toggleBox && text.bottom > toggleBox.top && text.top < toggleBox.bottom),
  };
});
check('input and results panes do not overlap', !overlap.panesOverlap);
check('the input textarea does not cover the results pane', !overlap.textareaCoversToggle);

for (const tab of ['Stats', 'JSON', 'Results']) {
  await tryClick(page.locator('.tab', { hasText: new RegExp(`^${tab}`) }));
  await page.waitForTimeout(60);
  const current = await layout();
  check(`the ${tab} tab leaves the divider alone`, near(ratioY(current), ratioY(beforePanels), 0.002),
    `${pct(ratioY(beforePanels))} → ${pct(ratioY(current))}`);
}

// --- 5. same guarantees for the horizontal axis --------------------------
const beforeColumns = await layout();
const horizontal = await drag('x', [25, 50, 75]);
const risingX = horizontal.samples.every((value, index) => index === 0 || value >= horizontal.samples[index - 1] - 0.001);
check('input/preview divider never dips below its start during a drag',
  Math.min(...horizontal.samples) >= ratioX(beforeColumns) - 0.005,
  `start ${pct(ratioX(beforeColumns))}, min ${pct(Math.min(...horizontal.samples))}`);
check('input/preview divider tracks the pointer monotonically', risingX,
  horizontal.samples.map(pct).join(' → '));

// --- 6. heatmap selection ------------------------------------------------
// Clicking a topbar metric shades the preview by it; clicking it again clears.
const baseTopbarHeight = (await layout()).workbenchTop; // measured before activation
const heatState = () =>
  page.evaluate(() => {
    const colours = new Set(
      [...document.querySelectorAll('.heat')].map((node) => getComputedStyle(node).backgroundColor),
    );
    return {
      active: [...document.querySelectorAll('.metric--active .metric__label')].map((node) => node.textContent),
      heatSpans: document.querySelectorAll('.heat').length,
      heatColours: colours.size,
      toolHighlights: document.querySelectorAll('.hl').length,
      legend: document.querySelector('.heat-legend__label')?.textContent ?? null,
      ramp: Boolean(document.querySelector('.heat-legend__ramp')),
      topbar: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    };
  });
const metricButton = (label) => page.locator('.metric--clickable', { hasText: label }).first();

await metricButton('Words / sentence').click();
await page.waitForTimeout(150);
let heat = await heatState();
check('clicking a metric shades the preview', heat.heatSpans === 11 && heat.legend === 'Words / sentence',
  `${heat.heatSpans} sentence spans`);
check('tool highlights are replaced while shading', heat.toolHighlights === 0);
check('the legend replaces the tool list', heat.ramp && heat.legend === 'Words / sentence');

await metricButton('Chars / word').click();
await page.waitForTimeout(150);
heat = await heatState();
check('selecting another metric switches (one at a time)',
  heat.active.length === 1 && heat.legend === 'Chars / word' && heat.heatSpans === 163,
  `active: ${heat.active.join(', ') || 'none'}, ${heat.heatSpans} spans`);
check('activating a metric does not resize the topbar', heat.topbar === 56, `${heat.topbar}px`);

await metricButton('Chars / word').click();
await page.waitForTimeout(150);
heat = await heatState();
check('clicking the same metric clears it', heat.active.length === 0 && heat.heatSpans === 0 && heat.legend === null);
check('tool highlights come back', heat.toolHighlights > 3, `${heat.toolHighlights} highlights`);

await metricButton('% unfamiliar').click();
await page.waitForTimeout(150);
heat = await heatState();
check('% unfamiliar shades only unfamiliar words in one colour',
  heat.heatSpans === 34 && heat.heatColours === 1, `${heat.heatSpans} words, ${heat.heatColours} colour(s)`);
check('a binary metric hides the ramp', heat.ramp === false);

await metricButton('% polysyllabic').click();
await page.waitForTimeout(150);
heat = await heatState();
check('% polysyllabic shades only 3+ syllable words with a graded ramp',
  heat.heatSpans === 23 && heat.heatColours > 3 && heat.ramp === true,
  `${heat.heatSpans} words, ${heat.heatColours} shades`);

await page.locator('.heat-legend .btn').click();
await page.waitForTimeout(150);
heat = await heatState();
check('the Clear button resets to tool highlighting', heat.heatSpans === 0 && heat.toolHighlights > 3);

// --- 7. percentile tone bands --------------------------------------------
// The sample text sits mid-distribution on every metric, so exercise the tails
// with deliberately extreme documents.
const chipsFor = async (document) => {
  await page.fill('.input__area', document);
  await page.waitForTimeout(400);
  return page.evaluate(() =>
    [...document.querySelectorAll('.metric--clickable')].map((metric) => ({
      label: metric.querySelector('.metric__label').textContent,
      chip: metric.querySelector('.metric__chip')?.textContent ?? null,
      tone: metric.classList.contains('metric--warn')
        ? 'warn'
        : metric.classList.contains('metric--good')
          ? 'good'
          : 'neutral',
    })),
  );
};

const heavy = await chipsFor(
  'Antidisestablishmentarianism internationalization characterization incomprehensibility. '.repeat(6),
);
const heavyChars = heavy.find((metric) => metric.label === 'Chars / word');
check(
  'very long words push chars/word into the amber band',
  heavyChars.tone === 'warn',
  `${heavyChars.chip} (${heavyChars.tone})`,
);

const simple = await chipsFor(
  'The cat sat on the mat. A dog ran to the man. We can go to the sun and the sky. '.repeat(4),
);
const simpleChars = simple.find((metric) => metric.label === 'Chars / word');
const simplePolys = simple.find((metric) => metric.label === '% polysyllabic');
check(
  'very short words push chars/word into the green band',
  simpleChars.tone === 'good',
  `${simpleChars.chip} (${simpleChars.tone})`,
);
check(
  'a text with no long words lands in the easy tail',
  simplePolys.tone === 'good',
  `${simplePolys.chip} (${simplePolys.tone})`,
);

await browser.close();
console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
