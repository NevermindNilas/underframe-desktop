// Minimal observable state container. State is replaced, never mutated, so listeners compare by reference.

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    /** Shallow-merge a patch (or the result of fn(state)) and notify listeners. */
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next) return;
      const prev = state;
      state = { ...state, ...next };
      for (const fn of listeners) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
