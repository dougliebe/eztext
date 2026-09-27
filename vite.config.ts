import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const MODEL_PORT = Number(process.env.MODEL_PORT ?? 5174);

/** Strip the `/api/model` prefix and hand the rest to the model process. */
const MODEL_PROXY = {
  target: `http://localhost:${MODEL_PORT}`,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/model/, ''),
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
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
