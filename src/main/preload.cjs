// Sandboxed preload (CommonJS): exposes window.uf, a small promise API over IPC.

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const smoke = process.argv.includes('--uf-smoke');

contextBridge.exposeInMainWorld('uf', {
  appInfo: () => call('uf:appInfo'),
  manifest: () => call('uf:manifest'),
  checkUpstream: () => call('uf:checkUpstream'),
  builds: {
    list: () => call('uf:builds:list'),
    save: build => call('uf:builds:save', build),
    remove: id => call('uf:builds:remove', id),
  },
  openExternal: url => call('uf:openExternal', String(url)),
  smoke,
  smokeResult: result => (smoke ? call('uf:smokeResult', result) : Promise.resolve()),
  // Smoke-only: save a mid-flow screenshot next to UF_SMOKE_SCREENSHOT. Resolves to its path or null.
  smokeCapture: tag => (smoke ? call('uf:smokeCapture', String(tag)) : Promise.resolve(null)),
});
