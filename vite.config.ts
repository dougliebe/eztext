import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
      ignored: ['**/.tmp/**', '**/.corpus/**', '**/dist/**'],
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    },
  },
  build: { target: 'es2020', outDir: 'dist', sourcemap: true },
});
