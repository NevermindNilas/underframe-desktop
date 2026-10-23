// Access to the privileged bridge (window.uf, from the preload). Outside the desktop app (e.g. serving
// src/ from a plain web server while developing the UI) a local fallback keeps the UI usable.

const STORE_KEY = 'uf.dev.builds';

function readDevBuilds() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeDevBuilds(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

const fallback = {
  appInfo: async () => ({ version: 'dev', electron: null, chrome: null, platform: 'browser' }),
  manifest: async () => (await fetch('/core/manifest.json')).json(),
  checkUpstream: async () => ({ local: null, remote: null, outdated: false, error: 'Only available in the desktop app' }),
  builds: {
    list: async () => readDevBuilds(),
    save: async build => {
      const list = readDevBuilds();
      const saved = { ...build, id: build.id ?? crypto.randomUUID(), updatedAt: new Date().toISOString() };
      const i = list.findIndex(b => b.id === saved.id);
      if (i >= 0) list[i] = saved; else list.push(saved);
      writeDevBuilds(list);
      return saved;
    },
    remove: async id => writeDevBuilds(readDevBuilds().filter(b => b.id !== id)),
  },
  openExternal: async url => Boolean(window.open(url, '_blank', 'noopener')),
  smoke: false,
  smokeResult: async () => {},
  smokeCapture: async () => null,
};

export const uf = window.uf ?? fallback;
export const isDesktop = Boolean(window.uf);
