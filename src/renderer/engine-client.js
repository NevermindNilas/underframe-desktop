// Promise wrapper around engine.worker.js. One worker, requests answered in order.
// If the worker crashes, the requests in flight fail, and the next request starts a fresh worker (and
// loads the engine again), so "Try again" can work. `onRestart` lets the caller drop state it had cached
// in the old worker (the app-state documents).

export function createEngineClient(url = '/renderer/engine.worker.js', { onRestart = () => {}, WorkerImpl = globalThis.Worker } = {}) {
  let worker = null;
  let pending = new Map();
  let nextId = 1;
  let fatal = null;
  /** True once init was requested: a restarted worker loads the engine again before anything else. */
  let wantsInit = false;
  let restarting = null;

  function start() {
    const w = new WorkerImpl(url);
    const mine = pending;
    const failAll = message => {
      if (w !== worker) return;
      fatal = new Error(message);
      for (const p of mine.values()) p.reject(fatal);
      mine.clear();
      try { w.terminate(); } catch { /* already gone */ }
      onRestart();
    };
    w.onmessage = ({ data }) => {
      const p = mine.get(data?.id);
      if (!p) return;
      mine.delete(data.id);
      if (data.ok) p.resolve(data);
      else p.reject(new Error(data.error || 'Engine request failed'));
    };
    w.onerror = e => {
      e?.preventDefault?.();
      failAll(`The engine worker crashed: ${e?.message || 'unknown error'}`);
    };
    w.onmessageerror = () => failAll('The engine worker sent an unreadable message.');
    worker = w;
  }

  function send(msg) {
    const id = nextId++;
    const mine = pending;
    return new Promise((resolve, reject) => {
      mine.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id });
    });
  }

  /** Replace a crashed worker with a fresh one (once, however many requests are waiting). */
  function restart() {
    restarting ??= (async () => {
      pending = new Map();
      fatal = null;
      start();
      onRestart();
      if (wantsInit) await send({ type: 'init' });
    })().finally(() => { restarting = null; });
    return restarting;
  }

  async function request(msg) {
    if (msg.type === 'init') wantsInit = true;
    if (restarting) await restarting;
    if (fatal) await restart();
    return send(msg);
  }

  start();

  return {
    /** Load the wasm engine. */
    init: () => request({ type: 'init' }).then(() => undefined),
    /** Cache the large app-state document under an integer id. */
    cacheAppState: (ref, appState) => request({ type: 'cacheAppState', ref, appState }).then(() => undefined),
    /** Run once per seed. Resolves to one engine result per seed; failed runs are {error}. */
    simulate: (input, seeds) => request({ type: 'simulate', input, seeds }).then(r => r.results),
    terminate: () => {
      fatal = new Error('Engine stopped.');
      for (const p of pending.values()) p.reject(fatal);
      pending.clear();
      worker.terminate();
    },
  };
}
