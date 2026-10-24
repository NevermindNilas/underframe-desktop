// Sandboxed preload (CommonJS): exposes window.uf, a small promise API over IPC.

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const smoke = process.argv.includes('--uf-smoke');
const scenes = process.argv.includes('--uf-scenes');
const backdropArg = process.argv.find(a => a.startsWith('--uf-backdrop='));
const backdrop = backdropArg?.slice('--uf-backdrop='.length) === 'mica' ? 'mica' : 'solid';

contextBridge.exposeInMainWorld('uf', {
  appInfo: () => call('uf:appInfo'),
  checkUpstream: () => call('uf:checkUpstream'),
  builds: {
    list: () => call('uf:builds:list'),
    save: build => call('uf:builds:save', build),
    remove: id => call('uf:builds:remove', id),
  },
  // External-buff presets: { version: 1, presets: [{ id, name, buffs }] }, one library per user.
  buffPresets: {
    get: () => call('uf:buffPresets:get'),
    set: library => call('uf:buffPresets:set', library),
  },
  // The riven library: { version: 1, rivens: [riven] }, one library per user (docs/port-rivens.md).
  rivens: {
    get: () => call('uf:rivens:get'),
    set: library => call('uf:rivens:set', library),
  },
  // Auto Build configs: { version, activeConfigId, configs: [{ id, name, settings }], cores }, or null before the first save.
  autoBuild: {
    get: () => call('uf:autoBuild:get'),
    set: doc => call('uf:autoBuild:set', doc),
  },
  // Text files through the system dialogs. saveText({ kind: 'csv'|'json', name, text }) -> { path } or { cancelled };
  // openText({ kind }) -> { text, name } or { cancelled }.
  files: {
    saveText: req => call('uf:files:saveText', req),
    openText: req => call('uf:files:openText', req),
  },
  openExternal: url => call('uf:openExternal', String(url)),
  /**
   * Screenshot recognition. recognize(bytes): PNG/JPEG bytes (Uint8Array or ArrayBuffer, at most 25 MB) to the
   * OCR result { width, height, language, lines, cards, passes, ms }; captureGame(): the Warframe window as
   * { png: Uint8Array, width, height, title }. Both resolve to { error: { code, message } } on failure.
   */
  ocr: {
    recognize: bytes => call('uf:ocr:recognize', bytes),
    captureGame: () => call('uf:ocr:captureGame'),
    // The clipboard image as { png, width, height, hasText }, or { error: { code: 'no-image' } }.
    clipboardImage: () => call('uf:ocr:clipboardImage'),
    // Opens Settings > Time & language > Language (to add the English OCR language).
    openLanguageSettings: () => call('uf:ocr:openLanguageSettings'),
  },
  /** Testing (UF_NO_CARD_IMAGES=1): every card uses the text card. */
  noCardImages: process.argv.includes('--uf-no-card-images'),
  /** 'mica' when the window has a Mica backdrop (known before first paint), else 'solid'. */
  backdrop,
  /**
   * Close guard: `fn` runs when the user closes the window. Answer with closeAnswer('close') to let it close,
   * or closeAnswer('wait') and later closeAnswer('close') once the user has decided.
   */
  onCloseRequest: fn => {
    ipcRenderer.removeAllListeners('uf:close-request');
    ipcRenderer.on('uf:close-request', () => fn());
  },
  closeAnswer: kind => call('uf:closeAnswer', kind === 'close' ? 'close' : 'wait'),
  smoke,
  smokeResult: result => (smoke ? call('uf:smokeResult', result) : Promise.resolve()),
  // Smoke-only: save a mid-flow screenshot next to UF_SMOKE_SCREENSHOT. Resolves to its path or null.
  smokeCapture: tag => (smoke ? call('uf:smokeCapture', String(tag)) : Promise.resolve(null)),
  // Smoke-only: a real (OS-level) mouse click at page coordinates.
  smokeClick: (x, y) => (smoke ? call('uf:smokeClick', Number(x), Number(y)) : Promise.resolve(false)),
  // Smoke-only: a real (OS-level) key press, e.g. smokePress('Tab', ['shift']).
  smokePress: (key, modifiers = []) => (smoke ? call('uf:smokePress', String(key), Array.isArray(modifiers) ? modifiers.map(String) : []) : Promise.resolve(false)),
  // Smoke-only: the bytes of UF_SMOKE_OCR_IMAGE, or null.
  smokeOcrImage: kind => (smoke ? call('uf:smokeOcrImage', kind === 'riven' ? 'riven' : 'build') : Promise.resolve(null)),

  // Scene-capture mode (UF_SCENES): save a PNG of the window, then report the list when done.
  scenes,
  sceneBootError: scenes && process.argv.includes('--uf-scene-boot-error'),
  sceneCapture: name => (scenes ? call('uf:sceneCapture', String(name)) : Promise.resolve(null)),
  scenesDone: () => (scenes ? call('uf:scenesDone') : Promise.resolve()),
  // Scene-only: page zoom (the stacked layout) and emulated media features (forced colours).
  sceneZoom: factor => (scenes ? call('uf:sceneZoom', Number(factor)) : Promise.resolve(false)),
  sceneEmulate: features => (scenes ? call('uf:sceneEmulate', features) : Promise.resolve(false)),

  scenesFailed: error => (scenes ? call('uf:scenesFailed', String(error)) : Promise.resolve()),
  sceneRequestClose: () => (scenes ? call('uf:sceneRequestClose') : Promise.resolve()),
});
