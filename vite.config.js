// Builds the React renderer (src/renderer) into build/renderer, served by the app:// protocol at /renderer/.
// The engine worker is copied as is: it is a classic worker that importScripts the engine loader and is
// served with its own CSP, so it must not be bundled or renamed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const workerSource = fileURLToPath(new URL('./src/renderer/engine.worker.js', import.meta.url));

function copyEngineWorker() {
  return {
    name: 'uf-copy-engine-worker',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'engine.worker.js', source: readFileSync(workerSource, 'utf8') });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: '/renderer/',
  publicDir: false,
  plugins: [react(), copyEngineWorker()],
  // The Auto Build worker (src/renderer/auto-build.worker.js) is an ES module worker with its own imports.
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./build/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome140',
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
  },
});
