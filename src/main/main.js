// Electron main process: app:// protocol, the window, and the IPC surface behind window.uf.

import { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, handleAppProtocol, isAppUrl, registerAppScheme } from './protocol.js';
import { createBuildsStore } from './builds-store.js';
import { checkUpstream, isAllowedExternal } from './external.js';
import { SMOKE_ARG, attachSmoke, isSmoke } from './smoke.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = isSmoke();
const START_URL = `${ORIGIN}/renderer/index.html`;

// Must happen before ready.
registerAppScheme(protocol);

// Smoke runs keep away from the user's builds and skip the single-instance lock.
if (smoke) app.setPath('userData', path.join(os.tmpdir(), 'underframe-desktop-smoke'));
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.quit();

let mainWindow = null;
let smokeRun = null;
let store = null;

const appRoot = () => app.getAppPath();

async function readManifest() {
  return JSON.parse(await readFile(path.join(appRoot(), 'core', 'manifest.json'), 'utf8'));
}

function openExternal(url) {
  if (!isAllowedExternal(url)) return false;
  shell.openExternal(url);
  return true;
}

function createWindow() {
  const second = process.env.UF_SECOND_MONITOR === '1';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    ...(second ? { x: -3400, y: 40 } : {}),
    show: false,
    backgroundColor: '#0f1115',
    title: 'Underframe Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
      additionalArguments: smoke ? [SMOKE_ARG] : [],
    },
  });
  win.once('ready-to-show', () => win.show());
  if (smoke) smokeRun = attachSmoke(win, { exit: code => app.exit(code) });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadURL(START_URL);
  return win;
}

function buildMenu() {
  if (app.isPackaged) return null;
  return Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
  ]);
}

/** Every IPC call must come from our own page. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame?.url ?? '';
    if (!isAppUrl(url)) throw new Error(`refused IPC ${channel} from ${url || 'unknown frame'}`);
    return fn(...args);
  });
}

function registerIpc() {
  handle('uf:appInfo', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
  }));
  handle('uf:manifest', () => readManifest());
  handle('uf:checkUpstream', async () => {
    let local = null;
    try {
      local = (await readManifest()).dataVersion ?? null;
    } catch {}
    return checkUpstream(local, { fetch: (url, opts) => net.fetch(url, opts) });
  });
  handle('uf:builds:list', () => store.list());
  handle('uf:builds:save', build => store.save(build));
  handle('uf:builds:remove', async id => {
    await store.remove(String(id));
  });
  handle('uf:openExternal', url => openExternal(url));
  handle('uf:smokeResult', result => {
    if (smokeRun) smokeRun.report(result);
  });
  handle('uf:smokeCapture', tag => (smokeRun ? smokeRun.capture(tag) : null));
}

/** Lock down every web contents: no navigation off app://local, no new windows, no webviews, no permissions. */
function hardenContents() {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
  });
}

/** Permissions the page may use; everything else is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => app.quit());

if (primary) {
  hardenContents();
  app.whenReady().then(start);
}

function start() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  handleAppProtocol(protocol, appRoot());
  store = createBuildsStore(app.getPath('userData'));
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();
}
