import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const MODEL_PORT = Number(process.env.MODEL_PORT ?? 5174);

/**
 * Strip the `/api/model` prefix and hand the rest to the model process.
 *
 * Targets `127.0.0.1` deliberately, not `localhost`: on Windows a stray dev
 * server that auto-incremented onto port 5174 can own `[::1]:5174` while the
 * model owns the wildcard address, and `localhost` may then resolve to the dev
 * server — which answers `/health` with index.html and status 200, so the app
 * fails with a JSON parse error instead of a connection error.
 */
const MODEL_PROXY = {
  target: `http://127.0.0.1:${MODEL_PORT}`,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/model/, ''),
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // Fail loudly instead of drifting onto the next free port. Port 5174 belongs
    // to the model process, and a second dev server that silently takes it makes
    // the proxy resolve to the wrong server (see MODEL_PROXY).
    strictPort: true,
    // On Windows, tools that replace files (git checkout, redirects, some
    // editors) truncate them first. Without awaitWriteFinish the watcher can
    // fire on the 0-byte moment and cache an *empty* transform (serving
    // `const __vite__css = ""`, i.e. a blank page) until the server restarts.
    // A generous stability threshold makes that window vanishingly small.
    watch: {
      ignored: ['**/.tmp/**', '**/.corpus/**', '**/.models/**', '**/dist/**'],
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    },
    // The local surprisal model (`npm run model`) runs as a separate process so
    // it can use native ONNX Runtime. Proxying it keeps the app same-origin.
    proxy: { '/api/model': MODEL_PROXY },
  },
  preview: { proxy: { '/api/model': MODEL_PROXY } },
  build: { target: 'es2020', outDir: 'dist', sourcemap: true },
});
