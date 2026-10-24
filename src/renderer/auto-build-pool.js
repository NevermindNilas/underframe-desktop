// A pool of engine workers for Auto Build (docs/port-auto-build.md 10): separate from the interactive engine worker,
// so the live readout stays responsive. Every worker caches the build's app state once; tasks (one candidate, at
// most 10 seeded runs) go out from a queue as workers free up. Terminating the pool stops everything at once.
// Pure apart from the injected client factory (createEngineClient in the app, a fake in tests).

/**
 * @param {object} o
 * @param {number} o.size number of engine workers
 * @param {(opts: { onRestart }) => object} o.createClient an engine client (init, cacheAppState, score, terminate)
 * @param {object|string} o.appState the app state each worker caches as ref 1
 */
export function createEnginePool({ size, createClient, appState }) {
  const APP_STATE_REF = 1;
  let closed = false;
  const workers = Array.from({ length: Math.max(1, size) }, () => {
    const w = { client: null, cached: false };
    // A crashed worker restarts empty: cache the app state again before its next task.
    w.client = createClient({ onRestart: () => { w.cached = false; } });
    return w;
  });
  const ensure = async w => {
    if (w.cached) return;
    await w.client.cacheAppState(APP_STATE_REF, appState);
    w.cached = true;
  };
  const ready = Promise.all(workers.map(async w => {
    await w.client.init();
    await ensure(w);
  }));
  ready.catch(() => {});

  /**
   * Run tasks ({ input, seeds, metric }) and resolve to one { sum, count, errors, error } per task, in order.
   * Rejects with "Engine stopped." once the pool is terminated.
   */
  async function run(tasks) {
    await ready;
    if (closed) throw new Error('Engine stopped.');
    const results = new Array(tasks.length);
    let next = 0;
    const loop = async w => {
      while (!closed) {
        const i = next++;
        if (i >= tasks.length) return;
        const t = tasks[i];
        try {
          await ensure(w);
          results[i] = await w.client.score(t.input, t.seeds, t.metric);
        } catch (e) {
          if (closed) return;
          results[i] = { sum: 0, count: 0, errors: t.seeds.length, error: e?.message ?? String(e) };
        }
      }
    };
    await Promise.all(workers.map(loop));
    if (closed) throw new Error('Engine stopped.');
    return results;
  }

  return {
    size: workers.length,
    ready,
    run,
    terminate() {
      if (closed) return;
      closed = true;
      for (const w of workers) {
        try { w.client.terminate(); } catch { /* already gone */ }
      }
    },
  };
}

/** Default worker count: min(8, logical cores - 1), at least 1 (docs/port-auto-build.md 10). */
export const defaultPoolSize = (cores = globalThis.navigator?.hardwareConcurrency ?? 4) => Math.max(1, Math.min(8, (Number(cores) || 4) - 1));
