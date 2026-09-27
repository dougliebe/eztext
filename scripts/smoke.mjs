/**
 * Compiles the TypeScript dev checks with esbuild and runs them in Node.
 * Keeps the pipeline and the render path testable without a test runner.
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = ['src/dev/smoke.ts', 'src/dev/render-check.tsx'];
const outDir = resolve(root, '.tmp');

mkdirSync(outDir, { recursive: true });

const outputs = [];
let failed = false;

for (const entry of entries) {
  // CJS output keeps Node built-ins (`react-dom/server` requires `stream`)
  // resolvable without a bundler shim.
  const outfile = resolve(outDir, `${basename(entry).replace(/\.[jt]sx?$/, '')}.cjs`);
  outputs.push(outfile);

  await build({
    entryPoints: [resolve(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    jsx: 'automatic',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
}

try {
  for (const outfile of outputs) {
    try {
      await import(pathToFileURL(outfile).href);
    } catch (error) {
      failed = true;
      console.error(`\n${basename(outfile)} threw during import:\n`, error);
    }
  }
} finally {
  for (const outfile of outputs) rmSync(outfile, { force: true });
}

if (failed) process.exitCode = 1;
