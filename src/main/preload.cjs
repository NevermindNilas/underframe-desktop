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
  openExternal: url => call('uf:openExternal', String(url)),
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
  // Scene-capture mode (UF_SCENES): save a PNG of the window, then report the list when done.
  scenes,
  sceneBootError: scenes && process.argv.includes('--uf-scene-boot-error'),
  sceneCapture: name => (scenes ? call('uf:sceneCapture', String(name)) : Promise.resolve(null)),
  scenesDone: () => (scenes ? call('uf:scenesDone') : Promise.resolve()),
  scenesFailed: error => (scenes ? call('uf:scenesFailed', String(error)) : Promise.resolve()),
  sceneRequestClose: () => (scenes ? call('uf:sceneRequestClose') : Promise.resolve()),
});
