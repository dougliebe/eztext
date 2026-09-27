/**
 * Reading the CLEAR corpus, shared by the norms generators.
 *
 * The corpus ships as an xlsx, which is a zip of XML — read directly here so the
 * project keeps its zero runtime dependencies. Also shared: the download, and
 * locating a column *by header text* rather than by letter, because the workbook
 * has 28 columns and the excerpt text lives in O, not J.
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = resolve(ROOT, '.corpus');
export const XLSX = resolve(CORPUS_DIR, 'CLEAR_corpus_final.xlsx');
const XLSX_URL = 'https://github.com/scrosseye/CLEAR-Corpus/raw/HEAD/CLEAR_corpus_final.xlsx';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(value) {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (match, hex, dec, name) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return ENTITIES[name] ?? match;
  });
}

function readZipEntry(archive, entry) {
  return execFileSync('unzip', ['-p', archive, entry], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

/** The shared string table: one entry per unique string, referenced by index. */
function parseSharedStrings(xml) {
  const strings = [];
  const entry = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let match;
  while ((match = entry.exec(xml))) {
    const inner = match[1] ?? '';
    let text = '';
    const run = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let part;
    while ((part = run.exec(inner))) text += unescapeXml(part[1]);
    strings.push(text);
  }
  return strings;
}

/** Decode one row's cells into a column → value map. */
function parseRowCells(rowInner, sharedStrings) {
  const cells = new Map();
  const cell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;

  while ((match = cell.exec(rowInner))) {
    const attrs = match[1];
    const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
    if (!ref) continue;

    const inner = match[2] ?? '';
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';

    if (type === 's') {
      const index = Number.parseInt(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? '-1', 10);
      cells.set(ref[1], sharedStrings[index] ?? '');
    } else if (type === 'inlineStr') {
      cells.set(ref[1], unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''));
    } else {
      cells.set(ref[1], unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''));
    }
  }

  return cells;
}

async function ensureCorpus() {
  if (existsSync(XLSX) && readFileSync(XLSX).length > 1_000_000) return;

  mkdirSync(CORPUS_DIR, { recursive: true });
  console.log(`downloading CLEAR corpus → ${XLSX}`);
  const response = await fetch(XLSX_URL);
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await new Promise((ok, fail) => {
    const stream = createWriteStream(XLSX);
    stream.on('error', fail);
    stream.on('finish', ok);
    stream.end(buffer);
  });
}

/**
 * Read the workbook.
 *
 * Returns the header map and one entry per row, so callers can pull whichever
 * columns they need (the excerpt text, or the corpus's own readability scores).
 */
export async function readCorpus() {
  await ensureCorpus();

  const sharedStrings = parseSharedStrings(readZipEntry(XLSX, 'xl/sharedStrings.xml'));
  const sheet = readZipEntry(XLSX, 'xl/worksheets/sheet1.xml');

  const rows = [];
  const row = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let match;
  while ((match = row.exec(sheet))) rows.push(parseRowCells(match[1], sharedStrings));

  const headers = rows[0];
  if (!headers) throw new Error('no header row found in sheet1.xml');
  const headerNames = new Map([...headers.entries()].map(([column, value]) => [column, value.trim()]));

  const columnFor = (name) => {
    for (const [column, value] of headerNames) {
      if (value.toLowerCase() === name.toLowerCase()) return column;
    }
    throw new Error(
      `column "${name}" not found. Present: ${[...headerNames.entries()].map(([c, v]) => `${c}=${v}`).join(', ')}`,
    );
  };

  const excerptColumn = columnFor('Excerpt');
  const data = rows.slice(1).map((cells) => cells.get(excerptColumn) ?? '');

  return { headers: headerNames, columnFor, excerpts: data, sharedStrings };
}
