// The page's side of Auto Build: start the Auto Build worker (src/renderer/auto-build.worker.js), relay its progress,
// resolve with its result, and cancel it (the worker stops its engines; it is terminated either way).

const CANCEL_GRACE_MS = 1500;

/**
 * @param {object} o
 * @param {object} o.build the working build, as plain data
 * @param {{ mods, arcanes }} o.start the starting point (kept slots only)
 * @param {object} o.settings the active config's settings
 * @param {number|null} o.cores engine workers (null: automatic)
 * @param {(p: { percent, step, detail, runs, elapsedMs }) => void} o.onProgress
 * @returns {{ promise: Promise<{ status: 'done', result } | { status: 'cancelled' }>, cancel(): void }}
 */
export function startAutoBuildWorker({ build, start, settings, cores = null, onProgress = () => {} }) {
  // The literal `new Worker(new URL(...), { type: 'module' })` form is what Vite bundles as a module worker.
  const worker = new Worker(new URL('./auto-build.worker.js', import.meta.url), { type: 'module', name: 'auto-build' });
  let finished = false;
  let killTimer = null;
  let settleCancelled = () => {};
  const end = () => {
    finished = true;
    clearTimeout(killTimer);
    try { worker.terminate(); } catch { /* already gone */ }
  };
  const promise = new Promise((resolve, reject) => {
    settleCancelled = () => resolve({ status: 'cancelled' });
    worker.onmessage = ({ data: msg }) => {
      if (finished) return;
      if (msg?.type === 'progress') onProgress(msg);
      else if (msg?.type === 'done') { end(); resolve({ status: 'done', result: msg.result }); }
      else if (msg?.type === 'cancelled') { end(); resolve({ status: 'cancelled' }); }
      else if (msg?.type === 'error') { end(); reject(new Error(msg.message || 'Auto build failed.')); }
    };
    worker.onerror = e => {
      e?.preventDefault?.();
      if (finished) return;
      end();
      reject(new Error(`The Auto build worker stopped: ${e?.message || 'unknown error'}`));
    };
    worker.onmessageerror = () => {
      if (finished) return;
      end();
      reject(new Error('The Auto build worker sent an unreadable message.'));
    };
  });
  worker.postMessage({ type: 'start', build, start, settings, cores });
  return {
    promise,
    cancel() {
      if (finished) return;
      worker.postMessage({ type: 'cancel' });
      // A worker stuck in a long step is ended anyway; the run counts as cancelled.
      killTimer = setTimeout(() => {
        if (finished) return;
        end();
        settleCancelled();
      }, CANCEL_GRACE_MS);
    },
  };
}
