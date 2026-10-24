// The app states the interactive engine holds: one per weapon and target-status list (external statuses live in the
// cached app state; a top-level copy is ignored). A small LRU with reference counts: every miss caches under a fresh
// ref, and an evicted ref is released only once no run that acquired it is still going, so a run never simulates
// against an app state that was re-cached for another weapon or status list in the meantime.

/**
 * @param {object} o
 * @param {(ref: number, appState: object) => Promise<void>} o.cache engine.cacheAppState
 * @param {(ref: number) => Promise<void>} o.release engine.releaseAppState
 * @param {(weapon: object, statuses: Array) => object} o.appStateOf builds the app state document
 * @param {number} [o.max] entries kept
 */
export function createAppStateCache({ cache, release, appStateOf, max = 4 }) {
  /** key -> { ref, promise, users, evicted }; Map order is LRU order. */
  const entries = new Map();
  let nextRef = 1;

  const free = entry => {
    Promise.resolve()
      .then(() => release(entry.ref))
      .catch(() => { /* the engine may have restarted; nothing to free then */ });
  };

  /**
   * Hold the app state for a weapon and status list: { promise (resolves to its ref), release() }. Call release()
   * once the runs that use the ref are done.
   */
  function acquire(weapon, externalStatuses = []) {
    const statuses = externalStatuses ?? [];
    const key = statuses.length ? `${weapon.name}|${JSON.stringify(statuses)}` : weapon.name;
    let entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    } else {
      const ref = nextRef++;
      entry = { ref, users: 0, evicted: false };
      entry.promise = Promise.resolve().then(() => cache(ref, appStateOf(weapon, statuses))).then(() => ref);
      const self = entry;
      entry.promise.catch(() => { if (entries.get(key) === self) entries.delete(key); });
      entries.set(key, entry);
      while (entries.size > max) {
        const [oldKey, old] = entries.entries().next().value;
        entries.delete(oldKey);
        old.evicted = true;
        if (!old.users) free(old);
      }
    }
    entry.users++;
    const held = entry;
    let done = false;
    return {
      promise: held.promise,
      release() {
        if (done) return;
        done = true;
        held.users--;
        if (held.evicted && !held.users) free(held);
      },
    };
  }

  /** Run `fn(ref)` with the app state held for its duration. */
  async function withAppState(weapon, statuses, fn) {
    const h = acquire(weapon, statuses);
    try {
      return await fn(await h.promise);
    } finally {
      h.release();
    }
  }

  return {
    acquire,
    withAppState,
    /** Forget every entry (the engine restarted or lost its app states); refs are never reused. */
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}
