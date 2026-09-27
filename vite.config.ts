import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // On Windows, tools that replace files (git checkout, redirects, some
    // editors) truncate them first. Without awaitWriteFinish the watcher can
    // fire on the 0-byte moment and cache an empty transform for that module,
    // which serves a blank app until the dev server is restarted.
    watch: { awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } },
  },
  build: { target: 'es2020', outDir: 'dist', sourcemap: true },
});
