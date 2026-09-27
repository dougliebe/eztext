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

/**
 * Words the common-word list does not carry (a knowledge prevalence, so these
 * are the ones a reader may not know). Ordinary prose has none of them, which is
 * why the unfamiliar-word checks need a document of their own.
 */
const HARD_TEXT = 'The antediluvian brutalist edifice obfuscated the zygote.';

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
// The signals below are properties the theme itself guarantees: the UI is mono
// throughout (it is a data tool) and metric figures are flex rows. Keep them
// theme-neutral — do not assert geometry that a restyle may legitimately change.
const styling = await page.evaluate(() => {
  const app = document.querySelector('.app');
  const chip = document.querySelector('.chip');
  return {
    sheets: document.styleSheets.length,
    chipFont: chip ? getComputedStyle(chip).fontFamily : '',
    metricValueDisplay: getComputedStyle(document.querySelector('.metric__value')).display,
    appHeight: Math.round(app.getBoundingClientRect().height),
    viewport: window.innerHeight,
  };
});
check(
  'stylesheet is applied',
  styling.sheets > 0 && /mono/i.test(styling.chipFont) && styling.metricValueDisplay === 'flex',
  `${styling.sheets} sheet(s), chip font ${styling.chipFont.split(',')[0].trim()}, metric value ${styling.metricValueDisplay}`,
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
    chipColours: Object.fromEntries(
      [...document.querySelectorAll('.metric--clickable')].map((metric) => [
        metric.querySelector('.metric__label').textContent,
        {
          z: Number(metric.querySelector('.metric__chip').dataset.z),
          percentile: Number(metric.querySelector('.metric__chip').dataset.percentile),
          rgb: (getComputedStyle(metric.querySelector('.metric__chip')).color.match(/[\d.]+/g) ?? []).map(Number),
        },
      ]),
    ),
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
  header.percentileChips.join('  '),
);
check(
  'the percentile agrees with the z-score behind it',
  Object.values(header.chipColours).every(({ z, percentile }) => {
    // Φ(z) is monotonic, so the displayed ordinal must track the stored z.
    return Number.isFinite(z) && (z > 0.5 ? percentile > 69 : z < -0.5 ? percentile < 31 : true);
  }),
  Object.values(header.chipColours)
    .map(({ z, percentile }) => `z ${z}→p${percentile}`)
    .join(' '),
);
// The chip's font colour must follow the ramp: the harder metric is warmer.
const coolChip = header.chipColours['Words / sentence']; // z −0.7 on the sample
const warmChip = header.chipColours['Chars / word']; // z +1.4 on the sample
check(
  'chip font colour is coded by z-score',
  coolChip.z < 0 &&
    warmChip.z > 0 &&
    coolChip.rgb[1] > coolChip.rgb[0] &&
    warmChip.rgb[0] > warmChip.rgb[1],
  `z ${coolChip.z} green-dominant, z ${warmChip.z} red-dominant`,
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

  // Hit-testing, not rect comparison: the results body is a scroll container, so
  // its first child can sit geometrically above the pane while being clipped and
  // perfectly un-clickable. What matters is whether anything from the top pane
  // can actually receive a pointer down here.
  const probes = [
    [bottom.left + bottom.width / 2, bottom.top + 12],
    [bottom.left + 40, bottom.top + 40],
    [bottom.left + bottom.width - 40, bottom.top + 40],
  ];
  const hits = probes.map(([x, y]) => {
    const node = document.elementFromPoint(x, y);
    return {
      insideResults: Boolean(node?.closest('.workbench__bottom')),
      what: node ? `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}` : 'none',
    };
  });

  return {
    panesOverlap: top.bottom > bottom.top + 1,
    inputCovers: hits.some((hit) => !hit.insideResults),
    hits,
    where: {
      textarea: `${Math.round(text.top)}–${Math.round(text.bottom)}`,
      topPane: `${Math.round(top.top)}–${Math.round(top.bottom)}`,
      bottomPane: `${Math.round(bottom.top)}–${Math.round(bottom.bottom)}`,
      bodyScroll: Math.round(document.querySelector('.pane--results .pane__body')?.scrollTop ?? 0),
      panels: document.querySelectorAll('.tool-panel').length,
    },
  };
});
check('input and results panes do not overlap', !overlap.panesOverlap, JSON.stringify(overlap.where));
check(
  'nothing from the input pane covers the results pane',
  !overlap.inputCovers,
  overlap.hits.map((hit) => hit.what).join(', '),
);

for (const tab of ['Stats', 'JSON']) {
  await tryClick(page.locator('.tab', { hasText: new RegExp(`^${tab}`) }));
  await page.waitForTimeout(60);
  const current = await layout();
  check(`the ${tab} tab leaves the divider alone`, near(ratioY(current), ratioY(beforePanels), 0.002),
    `${pct(ratioY(beforePanels))} → ${pct(ratioY(current))}`);
}

// Back to the panels: the JSON tab replaces them, and every check below this
// point that looks for a tool panel would find nothing.
await tryClick(page.locator('.tab', { hasText: /^Stats/ }));
await page.waitForTimeout(80);

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
// The topbar height is read before activation so the check below compares like
// with like — an exact pixel value would only re-assert whatever theme is in
// place, and the theme is free to change.
const topbarBefore = await page.evaluate(() =>
  Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
);
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
check('activating a metric does not resize the topbar', heat.topbar === topbarBefore,
  `${heat.topbar}px vs ${topbarBefore}px before activation`);

await metricButton('Chars / word').click();
await page.waitForTimeout(150);
heat = await heatState();
check('clicking the same metric clears it', heat.active.length === 0 && heat.heatSpans === 0 && heat.legend === null);
check('tool highlights come back', heat.toolHighlights > 3, `${heat.toolHighlights} highlights`);

await metricButton('% unfamiliar').click();
await page.waitForTimeout(150);
heat = await heatState();
check('% unfamiliar shades only unfamiliar words in one colour',
  heat.heatSpans === 0 && heat.heatColours === 0, `${heat.heatSpans} words on ordinary prose`);

// The list is what a typical reader knows, so ordinary prose has nothing to
// shade. Drive the same view with words the list really does not carry.
const SAMPLE = await page.inputValue('.input__area');
await page.fill('.input__area', HARD_TEXT);
await page.waitForTimeout(300);
heat = await heatState();
check('% unfamiliar shades rare words in one colour',
  heat.heatSpans === 5 && heat.heatColours === 1, `${heat.heatSpans} words, ${heat.heatColours} colour(s)`);
await page.fill('.input__area', SAMPLE);
await page.waitForTimeout(300);
heat = await heatState();
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

// --- 6b. the selection inspector explains the flagged group --------------
// `gsds#0` is the densest dense unit (the tool emits its units first, ranked),
// selected by dispatching the click rather than hit-testing: a token highlight
// or another tool's span can sit on top of the region at any point, so a real
// click would sometimes land on a different annotation.
await page.evaluate(() =>
  document.querySelector('[data-ann="gsds#0"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await page.waitForSelector('.inspector', { timeout: 5000 });
const gsdsInspector = await page.evaluate(() => ({
  tool: document.querySelector('.inspector__eyebrow')?.textContent ?? '',
  detail: document.querySelector('.inspector__detail')?.textContent ?? '',
  example: document.querySelector('.inspector__example')?.textContent ?? '',
  contributors: document.querySelectorAll('.inspector__contributor-list li').length,
}));
check('the inspector names the rule that fired', gsdsInspector.detail.length > 0, gsdsInspector.detail.slice(0, 90));
check('the inspector shows a fix example', gsdsInspector.example.includes('→'), gsdsInspector.example.slice(0, 110));
check('the inspector breaks a dense unit into its shares', gsdsInspector.contributors > 0, `${gsdsInspector.contributors} contributors`);

// Regression: the inspector used to be a sticky overlay inside the scrolling
// results body, so a tall one covered the content. It is a bounded region above
// the scrolling panels now, scrolling internally instead of stacking.
const inspectorGeometry = await page.evaluate(() => {
  const pane = document.querySelector('.pane__inspector');
  const body = document.querySelector('.pane--results .pane__body');
  const paneBox = pane.getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  return {
    overlap: Math.round(paneBox.bottom - bodyBox.top),
    inspectorHeight: Math.round(paneBox.height),
    bodyHeight: Math.round(bodyBox.height),
    scrollable: pane.scrollHeight > pane.clientHeight,
    position: getComputedStyle(document.querySelector('.inspector')).position,
  };
});
// The splitter is parked at 79.5% here, so the results pane is at its smallest;
// any visible panels are enough, what matters is that the inspector never covers
// them.
check(
  'the inspector does not cover the results panels',
  inspectorGeometry.overlap <= 0 && inspectorGeometry.bodyHeight > 0 && inspectorGeometry.position !== 'sticky',
  `inspector ${inspectorGeometry.inspectorHeight}px, panels ${inspectorGeometry.bodyHeight}px, overlap ${inspectorGeometry.overlap}px`,
);
check(
  'a tall inspector scrolls internally',
  inspectorGeometry.scrollable,
  `${inspectorGeometry.inspectorHeight}px capped, content overflows`,
);
await page.locator('.inspector__close').click();
await page.waitForTimeout(100);

// Which annotation wins a preview click is the topmost layer at that point, so
// this only asserts that the click opens the inspector at all.
await page.locator('.hl[data-tool="gsds"]').first().click({ force: true, position: { x: 4, y: 4 } });
await page.waitForSelector('.inspector', { timeout: 5000 });
const opened = await page.evaluate(() => document.querySelector('.inspector__eyebrow')?.textContent ?? '');
check('clicking a highlight opens the inspector', opened.length > 0, opened || 'none');
await page.locator('.inspector__close').click();
await page.waitForTimeout(100);

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
      z: Number(metric.querySelector('.metric__chip')?.dataset.z ?? 'NaN'),
      percentile: Number(metric.querySelector('.metric__chip')?.dataset.percentile ?? 'NaN'),
      rgb: (getComputedStyle(metric.querySelector('.metric__chip')).color.match(/[\d.]+/g) ?? []).map(Number),
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
  `z ${heavyChars.z} → p${heavyChars.percentile} (${heavyChars.tone})`,
);
check(
  'extreme deviations saturate the chip colour',
  heavyChars.rgb[0] > heavyChars.rgb[1] + 80,
  `rgb(${heavyChars.rgb.join(', ')})`,
);

const simple = await chipsFor(
  'The cat sat on the mat. A dog ran to the man. We can go to the sun and the sky. '.repeat(4),
);
const simpleChars = simple.find((metric) => metric.label === 'Chars / word');
const simplePolys = simple.find((metric) => metric.label === '% polysyllabic');
check(
  'very short words push chars/word into the green band',
  simpleChars.tone === 'good',
  `z ${simpleChars.z} → p${simpleChars.percentile} (${simpleChars.tone})`,
);
check(
  'a text with no long words lands in the easy tail',
  simplePolys.tone === 'good',
  `z ${simplePolys.z} → p${simplePolys.percentile} (${simplePolys.tone})`,
);

// --- 8. the surprisal model, if it is running -----------------------------
// Skipped when the local model process is absent, so the suite still runs
// anywhere. Start it with `npm run model` to include these.
//
// The probe checks the content type on purpose: a proxy pointing at the wrong
// server gets *index.html with status 200*, which a naive `response.ok` check
// would treat as success and then fail on with a confusing JSON parse error.
const health = await fetch(`${baseUrl}/api/model/health`)
  .then(async (response) => {
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('json')) {
      return { error: `got ${response.status} ${type.split(';')[0] || 'with no content-type'}` };
    }
    return response.json();
  })
  .catch((error) => ({ error: error.message }));

if (!health?.ready) {
  console.log(`\n  (skipping the model checks — ${health?.error ?? 'the model is not ready'})`);
  console.log('  start it with `npm run model`; if it is already running, the dev-server proxy is not reaching it');
} else {
  await page.fill('.input__area', '');
  await page.fill(
    '.input__area',
    'Most writers revise. They cut adjectives, and they move the important words toward the front of the clause. ' +
      'Nevertheless, the writers who revise consistently produce prose that readers understand immediately.',
  );
  await page.waitForTimeout(300);

  const runButton = page.locator('.pane--input .btn', { hasText: /Run model|Re-run|Scoring/ });
  check('the input bar offers a Run control', (await runButton.count()) === 1, await runButton.first().textContent());

  const beforeRun = await page.locator('.hl[data-tool="surprisal"]').count();
  check('nothing is shaded before running', beforeRun === 0, `${beforeRun} shaded words`);

  await runButton.first().click();
  await page.waitForFunction(
    () => /Re-run/.test(document.querySelector('.pane--input .btn')?.textContent ?? ''),
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(400);

  const shaded = await page.locator('.hl[data-tool="surprisal"]').count();
  check('running shades every word', shaded > 20, `${shaded} shaded words`);

  // The ramp runs from the page background to red: opaque mixes, so the colour
  // that lands on screen is the colour that was contrast-checked.
  const ramp = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hl[data-tool="surprisal"]')].map((node) => {
      const style = getComputedStyle(node).backgroundColor;
      const parts = (style.match(/[\d.]+/g) ?? []).map(Number);
      return { style, channels: parts.slice(0, 3), alpha: parts[3] ?? 1 };
    });
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const ink = [27, 27, 27]; // --text, the preview's resting ink
    const luminances = rows.map((row) => luminance(row.channels));
    const ratios = rows.map((row) => contrast(row.channels, ink));
    const sorted = [...ratios].sort((a, b) => a - b);
    return {
      words: rows.length,
      opaque: rows.every((row) => row.alpha === 1),
      mixes: rows.every((row) => row.channels[1] === row.channels[2] && row.channels[0] >= 192),
      steps: new Set(rows.map((row) => row.style)).size,
      darkest: rows[luminances.indexOf(Math.min(...luminances))].style,
      worstRatio: sorted[0],
      medianRatio: sorted[Math.floor(sorted.length / 2)],
      heavy: ratios.filter((ratio) => ratio < 7).length,
      // The same ink on bare paper, for reference.
      paperRatio: contrast([255, 255, 255], ink),
    };
  });

  check('shading is an opaque paper-to-red mix', ramp.opaque && ramp.mixes, `${ramp.words} words, ${ramp.steps} distinct shades`);
  check('the ramp has many steps', ramp.steps > 6, `${ramp.steps} distinct rendered colours`);
  check(
    'every shade keeps the preview ink legible (WCAG AA)',
    ramp.worstRatio >= 4.5,
    `worst ${ramp.worstRatio.toFixed(2)}:1 on ${ramp.darkest} (bare paper is ${ramp.paperRatio.toFixed(1)}:1)`,
  );
  check(
    'the page stays light: the median word barely tints the paper',
    ramp.medianRatio > ramp.paperRatio * 0.75,
    `median ${ramp.medianRatio.toFixed(2)}:1 vs paper ${ramp.paperRatio.toFixed(2)}:1`,
  );
  check(
    'the surprisal panel reports model statistics',
    (await page.locator('.tool-panel', { hasText: 'Surprisal' }).locator('.stat').count()) >= 6,
  );

  // The three model figures carry a percentile against the CLEAR corpus.
  const statChips = await page.evaluate(() =>
    [...document.querySelectorAll('.tool-panel .stat__chip')].map((node) => ({
      text: node.textContent ?? '',
      title: node.getAttribute('title') ?? '',
      colour: getComputedStyle(node).color,
    })),
  );
  check(
    'the model stats show corpus percentiles',
    statChips.length === 3 && statChips.every((chip) => /^(<1st|>99th|\d+(st|nd|rd|th))$/.test(chip.text)),
    statChips.map((chip) => chip.text).join('  '),
  );
  check(
    'each chip names its population in the tooltip',
    statChips.every((chip) => /CLEAR/.test(chip.title) && /\d+ excerpts|n=/.test(chip.title)),
    statChips[0]?.title.replace(/\n/g, ' | '),
  );
  check(
    'chip colour tracks the deviation',
    statChips.every((chip) => /^rgb\(/.test(chip.colour)),
    statChips.map((chip) => chip.colour).join(' '),
  );

  // Editing must invalidate the scores rather than shade stale ranges.
  await page.fill('.input__area', 'A completely different sentence now replaces all of that text entirely.');
  await page.waitForTimeout(500);
  const afterEdit = await page.locator('.hl[data-tool="surprisal"]').count();
  const runLabel = await page.locator('.pane--input .btn').first().textContent();
  check('editing withholds the stale scores', afterEdit === 0, `${afterEdit} shaded words, button says “${runLabel}”`);
  check('and the Run control says so', /edited/i.test(runLabel ?? ''), runLabel ?? '');

  // Back to a scored document, then select the hardest word.
  await page.fill('.input__area', 'Most writers revise. They cut adjectives, and they move the important words.');
  await page.waitForTimeout(200);
  await runButton.first().click();
  await page.waitForFunction(
    () => /Re-run/.test(document.querySelector('.pane--input .btn')?.textContent ?? ''),
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(400);

  const hardest = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.hl[data-tool="surprisal"]')];
    const ranked = nodes
      .map((node) => ({ text: node.textContent.trim(), bits: Number((node.getAttribute('title') ?? '').match(/([\d.]+) bits/)?.[1] ?? 0) }))
      .sort((a, b) => b.bits - a.bits);
    return ranked[0] ?? null;
  });

  await page.locator('.hl[data-tool="surprisal"]', { hasText: hardest.text }).first().click();
  await page.waitForSelector('.inspector', { timeout: 5000 });
  await page.waitForTimeout(200);

  // Clicking the same word again is the way out of the inspector.
  const selectedFirst = await page.evaluate(() => document.querySelector('.inspector__word')?.textContent ?? null);
  await page.locator('.hl[data-tool="surprisal"]', { hasText: hardest.text }).first().click();
  await page.waitForTimeout(200);
  const afterSecondClick = await page.locator('.inspector').count();
  check(
    'clicking the selected word again deselects it',
    selectedFirst !== null && afterSecondClick === 0,
    `first click selected “${selectedFirst}”, second click left ${afterSecondClick} card(s)`,
  );

  // And selecting something else still works, so the toggle is not a one-way trip.
  await page.locator('.hl[data-tool="surprisal"]', { hasText: hardest.text }).first().click();
  await page.waitForSelector('.inspector', { timeout: 5000 });
  await page.waitForTimeout(200);

  // The card now answers "where does the model go next": five continuations of
  // five words, fetched for this selection. It takes the model about a second,
  // hence the generous timeout — and the wait is the point of the check, since a
  // silently empty table would otherwise look like a pass.
  const continuation = await page
    .waitForSelector('.next tbody tr', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(100);

  const card = await page.evaluate(() => ({
    word: document.querySelector('.inspector__word')?.textContent,
    bits: document.querySelector('.inspector__bits')?.textContent,
    range: document.querySelector('.inspector__range')?.textContent ?? '',
    rows: [...document.querySelectorAll('.next tbody tr')].map((tr) =>
      // The phrase cell may carry the "written" tag; it is not part of the phrase.
      [...tr.querySelectorAll('td')].map((td) => {
        const copy = td.cloneNode(true);
        copy.querySelectorAll('.next__tag').forEach((tag) => tag.remove());
        return copy.textContent.trim();
      }),
    ),
    stats: [...document.querySelectorAll('.inspector__stat')].map((node) => ({
      label: node.querySelector('.inspector__stat-label')?.textContent ?? '',
      value: node.querySelector('.inspector__stat-value')?.textContent ?? '',
    })),
  }));

  check(
    'selecting a word shows where the model goes next',
    continuation && card.rows.length >= 3 && card.rows.every((row) => row.length === 3),
    continuation
      ? `${card.rows.length} continuations for “${card.word}”: ${card.rows.map((row) => row[1]).join(' / ').slice(0, 120)}`
      : 'no continuation table appeared within 30 s',
  );
  check(
    'every continuation is a short phrase',
    continuation && card.rows.every((row) => row[1].split(/\s+/).length >= 3 && row[1].split(/\s+/).length <= 6),
    continuation ? card.rows.map((row) => row[1].split(/\s+/).length).join(', ') + ' words' : 'n/a',
  );
  check(
    'continuations are ranked by the probability of the whole phrase',
    continuation &&
      card.rows.every((row, index) => {
        if (index === 0) return true;
        return Number(row[2]) >= Number(card.rows[index - 1][2]);
      }),
    continuation ? card.rows.map((row) => row[2]).join(' ≤ ') : 'n/a',
  );
  check(
    'the card reports the word\'s own numbers',
    ['surprisal', 'probability', 'pieces'].every((label) =>
      card.stats.some((stat) => stat.label.toLowerCase() === label && stat.value.length > 0),
    ),
    card.stats.map((stat) => `${stat.label}=${stat.value}`).join(' '),
  );
  // A regression guard with a specific history: a prompt ending in a bare space
  // leaves GPT-2 holding a token its training text never contains, and it answers
  // with the separator rows of its web corpus. That was 26% of rows before the
  // trailing space was dropped from the prompt.
  check(
    'no continuation is separator junk',
    continuation && card.rows.every((row) => !/[_-]{3,}|\|/.test(row[1])),
    continuation ? card.rows.map((row) => row[1]).join(' / ').slice(0, 140) : 'n/a',
  );

  // The prompt must stop where the selected word *starts*, so the model's first
  // word is its candidate for the slot the writer filled. Asking the model the
  // same question directly is the only way to check the client sliced there —
  // an off-by-one-word prompt looks perfectly plausible in the table.
  const [rangeStart] = (card.range.match(/^(\d+)/) ?? []).map(Number);
  const documentText = await page.inputValue('.input__area');
  const direct = await fetch(`${baseUrl}/api/model/continue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: documentText.slice(0, rangeStart) }),
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const fromApi = (direct?.rows ?? []).map((row) => row.text).join(' | ');
  check(
    'continuations are asked for the text before the word, not after it',
    fromApi.length > 0 && fromApi === card.rows.map((row) => row[1]).join(' | '),
    fromApi === card.rows.map((row) => row[1]).join(' | ')
      ? `“${card.word}” at ${card.range}: the table matches the model asked for the prefix`
      : `table: ${card.rows.map((row) => row[1]).join(' | ').slice(0, 90)} / api: ${fromApi.slice(0, 90)}`,
  );

  check(
    'the results pane lists statistics, not every annotation',
    (await page.locator('.tool-panel .rows').count()) === 0 &&
      (await page.locator('.tool-panel .stat').count()) > 6,
    `${await page.locator('.tool-panel .stat').count()} stat cards, ${await page.locator('.tool-panel .rows').count()} row lists`,
  );

  await page.locator('.inspector__close').click();
  await page.waitForTimeout(150);
  check('the card can be dismissed', (await page.locator('.inspector').count()) === 0);
}

// --- 9. Common words: suggestions -----------------------------------------
// A controlled document: block 8 rewrites the textarea when the model is
// running, so nothing here may depend on what came before.
await page.fill('.input__area', HARD_TEXT);
await page.waitForTimeout(300);
await page.locator('.chip__main', { hasText: 'Common' }).first().click();
await page.waitForTimeout(250);

const flaggedWords = await page.evaluate(() =>
  [...document.querySelectorAll('.hl[data-tool="common-words"]')].map((node) => node.textContent),
);
check(
  'Common words flags what the list does not carry',
  ['antediluvian', 'brutalist', 'edifice', 'obfuscated', 'zygote'].every((word) => flaggedWords.includes(word)),
  flaggedWords.join(' '),
);

// Family and meaning suggestions both land in the tooltip as detail text.
const withDetail = page.locator('.hl[data-tool="common-words"][title*="is not a common word"]');
check('flagged words carry their detail in the tooltip', (await withDetail.count()) > 0);

// "brutalist" is the word the tool has the most to say about: its own base word
// plus meaning neighbours. The word span is the deepest element, so this clicks
// the word rather than the sentence behind it.
await page.locator('.hl[data-tool="common-words"]').filter({ hasText: 'brutalist' }).first().click();
await page.waitForTimeout(250);

const inspector = await page.evaluate(() => {
  const node = document.querySelector('.inspector');
  if (!node) return null;
  return {
    eyebrow: node.querySelector('.inspector__eyebrow')?.textContent?.trim() ?? null,
    word: node.querySelector('.inspector__word')?.textContent?.trim() ?? null,
    suggestions: [...node.querySelectorAll('.alts__word')].map((el) => el.textContent.trim()),
    relations: [...node.querySelectorAll('.inspector__hint')].map((el) => el.textContent.trim()),
    // The last column of each row: p(known), read from the list's probit.
    known: [...node.querySelectorAll('.alts tbody tr')].map((row) => row.lastElementChild?.textContent?.trim() ?? ''),
  };
});
check(
  'clicking a flagged word opens the inspector',
  inspector !== null && (inspector.eyebrow ?? '').includes('Common'),
  `${inspector?.eyebrow} — “${inspector?.word}”`,
);
check('the inspector lists the nearest listed words', (inspector?.suggestions.length ?? 0) > 0, inspector?.suggestions.join(', '));
check(
  'each suggestion says how it relates, and how well known it is',
  inspector !== null &&
    inspector.relations.length === inspector.suggestions.length &&
    (inspector.known ?? []).length === inspector.suggestions.length &&
    (inspector.known ?? []).every((value) => /^\d{1,3}(\.\d)?%$/.test(value)),
  `${inspector?.relations.join(', ')} — known ${inspector?.known?.join(', ')}`,
);

// When the embedding side of the model process is up, the suggestions must be
// the meaning-based ones — that is the point of the whole exercise.
const embedHealth = await fetch(`${baseUrl}/api/model/health`)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
if (embedHealth?.embeddings) {
  check(
    'meaning neighbours come from the embedding model',
    (inspector?.relations ?? []).some((relation) => /meaning/.test(relation)),
    `${inspector?.suggestions.join(', ')} — ${inspector?.relations.join(', ')}`,
  );
} else {
  console.log('\n  (skipping the embedding check — start `npm run model` with the similarity endpoint)');
}

// --- 10. the prevalence threshold -----------------------------------------
// The dial lives in the tool's settings, but it is not a tool-only setting: the
// topbar metric is measured against the same list, so both must move together.
await page.fill('.input__area', SAMPLE);
await page.waitForTimeout(300);
const beforeThreshold = await page.locator('.hl[data-tool="common-words"]').count();
check('ordinary prose is left alone at the floor', beforeThreshold === 0, `${beforeThreshold} flagged`);

await page.locator('.chip', { hasText: 'Common' }).locator('.chip__gear').click();
await page.waitForSelector('#common-words-threshold');
await page.fill('#common-words-threshold', '2');
await page.waitForTimeout(400);

const afterThreshold = await page.locator('.hl[data-tool="common-words"]').count();
const metricWords = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.metric')].find((node) =>
    node.textContent?.includes('unfamiliar'),
  );
  return { value: cell?.querySelector('.metric__value')?.textContent ?? null, title: cell?.getAttribute('title') ?? '' };
});
check(
  'raising the threshold flags words in ordinary prose',
  beforeThreshold === 0 && afterThreshold > 0,
  `${beforeThreshold} → ${afterThreshold} flagged`,
);
check(
  'the topbar metric counts them the same way',
  new RegExp(`${afterThreshold} of `).test(metricWords.title),
  `${metricWords.value} — “${metricWords.title.split('\n')[0]}”`,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('the settings popover closes again', (await page.locator('.popover').count()) === 0);

await browser.close();
console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
