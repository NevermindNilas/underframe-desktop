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
