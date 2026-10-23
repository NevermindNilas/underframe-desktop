// Promise wrapper around engine.worker.js. One worker, requests answered in order.

export function createEngineClient(url = '/renderer/engine.worker.js') {
  const worker = new Worker(url);
  const pending = new Map();
  let nextId = 1;
  let fatal = null;

  worker.onmessage = ({ data }) => {
    const p = pending.get(data?.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data);
    else p.reject(new Error(data.error || 'Engine request failed'));
  };
  const failAll = message => {
    fatal = new Error(message);
    for (const p of pending.values()) p.reject(fatal);
    pending.clear();
  };
  worker.onerror = e => {
    e.preventDefault?.();
    failAll(`The engine worker crashed: ${e.message || 'unknown error'}`);
  };
  worker.onmessageerror = () => failAll('The engine worker sent an unreadable message.');

  function request(msg) {
    if (fatal) return Promise.reject(fatal);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id });
    });
  }

  return {
    /** Load the wasm engine. */
    init: () => request({ type: 'init' }).then(() => undefined),
    /** Cache the large app-state document under an integer id. */
    cacheAppState: (ref, appState) => request({ type: 'cacheAppState', ref, appState }).then(() => undefined),
    /** Run once per seed. Resolves to one engine result per seed; failed runs are {error}. */
    simulate: (input, seeds) => request({ type: 'simulate', input, seeds }).then(r => r.results),
    terminate: () => { failAll('Engine stopped.'); worker.terminate(); },
  };
}
