// Access to the privileged bridge (window.uf, from the preload). Outside the desktop app (e.g. serving
// src/ from a plain web server while developing the UI) a local fallback keeps the UI usable.

const STORE_KEY = 'uf.dev.builds';
const PRESETS_KEY = 'uf.dev.buffPresets';
const AUTO_BUILD_KEY = 'uf.dev.autoBuild';
const RIVENS_KEY = 'uf.dev.rivens';

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
  appInfo: async () => ({ version: 'dev', electron: null, chrome: null, platform: 'browser', backdrop: 'solid' }),
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
  buffPresets: {
    get: async () => {
      try { return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null') ?? { version: 1, presets: [] }; } catch { return { version: 1, presets: [] }; }
    },
    set: async library => {
      try { localStorage.setItem(PRESETS_KEY, JSON.stringify(library)); } catch { /* storage unavailable */ }
      return library;
    },
  },
  rivens: {
    get: async () => {
      try { return JSON.parse(localStorage.getItem(RIVENS_KEY) ?? 'null') ?? { version: 1, rivens: [] }; } catch { return { version: 1, rivens: [] }; }
    },
    set: async library => {
      try { localStorage.setItem(RIVENS_KEY, JSON.stringify(library)); } catch { /* storage unavailable */ }
      return library;
    },
  },
  autoBuild: {
    get: async () => {
      try { return JSON.parse(localStorage.getItem(AUTO_BUILD_KEY) ?? 'null'); } catch { return null; }
    },
    set: async doc => {
      try { localStorage.setItem(AUTO_BUILD_KEY, JSON.stringify(doc)); } catch { /* storage unavailable */ }
      return doc;
    },
  },
  files: {
    // A download in the browser; opening needs the desktop app.
    saveText: async ({ kind, name, text }) => {
      const url = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { path: name };
    },
    openText: async () => ({ cancelled: true }),
  },
  openExternal: async url => Boolean(window.open(url, '_blank', 'noopener')),
  ocr: {
    recognize: async () => ({ error: { code: 'unsupported-platform', message: 'Only available in the desktop app' } }),
    captureGame: async () => ({ error: { code: 'game-not-found', message: 'Only available in the desktop app' } }),
    clipboardImage: async () => ({ error: { code: 'no-image', message: 'Only available in the desktop app' } }),
    openLanguageSettings: async () => false,
  },
  noCardImages: false,
  smokeOcrImage: async () => null,
  backdrop: 'solid',
  onCloseRequest: () => {},
  closeAnswer: async () => {},
  smoke: false,
  smokeResult: async () => {},
  smokeCapture: async () => null,
  smokeClick: async () => false,
  smokePress: async () => false,
  scenes: false,
  sceneBootError: false,
  sceneCapture: async () => null,
  scenesDone: async () => {},
  scenesFailed: async () => {},
  sceneRequestClose: async () => {},
};

export const uf = window.uf ?? fallback;
export const isDesktop = Boolean(window.uf);
