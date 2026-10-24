// Electron main process: app:// protocol, the window (Mica, custom title bar), and the IPC surface behind window.uf.

import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, session, shell, systemPreferences } from 'electron';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, handleAppProtocol, isAppUrl, registerAppScheme } from './protocol.js';
import { createBuildsStore } from './builds-store.js';
import { checkUpstream, isAllowedExternal } from './external.js';
import { SMOKE_ARG, attachSmoke, isSmoke } from './smoke.js';
import { SCENES_ARG, attachScenes, scenesDir } from './scenes.js';
import { AUTOMATION_SWITCHES, captureVia } from './capture.js';
import { registerOcrIpc } from './ocr/ipc.js';
import { MIN_SIZE, initialSize, themeSourceFrom, titleBarOverlay, wantsMica, windowBackground, zoomFor } from './window-chrome.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const smoke = isSmoke();
const scenes = scenesDir();
const automated = smoke || Boolean(scenes);
const START_URL = `${ORIGIN}/renderer/index.html`;
/** How long the renderer has to answer a close request before the window closes anyway. */
const CLOSE_ANSWER_TIMEOUT_MS = 5000;

// Must happen before ready.
registerAppScheme(protocol);
// Automated runs keep rendering while covered or in the background (captures and timers never stall).
if (automated) for (const [name, value] of AUTOMATION_SWITCHES) app.commandLine.appendSwitch(name, ...(value ? [value] : []));

// Automated runs keep away from the user's builds and skip the single-instance lock.
if (smoke) app.setPath('userData', path.join(os.tmpdir(), 'underframe-desktop-smoke'));
else if (scenes) app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'underframe-desktop-scenes-')));
const primary = automated || app.requestSingleInstanceLock();
if (!primary) app.quit();

let mainWindow = null;
let smokeRun = null;
let scenesRun = null;
let store = null;
let backdrop = 'solid';

const appRoot = () => app.getAppPath();

async function readManifest() {
  return JSON.parse(await readFile(path.join(appRoot(), 'core', 'manifest.json'), 'utf8'));
}

function openExternal(url) {
  if (!isAllowedExternal(url)) return false;
  shell.openExternal(url);
  return true;
}

function highContrastText() {
  try {
    return systemPreferences.getColor('window-text');
  } catch {
    return null;
  }
}

function overlayOptions() {
  return titleBarOverlay({
    dark: nativeTheme.shouldUseDarkColors,
    highContrast: nativeTheme.shouldUseHighContrastColors,
    highContrastText: nativeTheme.shouldUseHighContrastColors ? highContrastText() : null,
  });
}

/** Keep the caption glyphs and the solid fallback colour in step with the system theme, live. */
function syncChrome(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setTitleBarOverlay(overlayOptions());
  } catch {
    // not supported on this platform
  }
  if (backdrop === 'solid') win.setBackgroundColor(windowBackground({ backdrop, dark: nativeTheme.shouldUseDarkColors }));
}

function createWindow() {
  const second = process.env.UF_SECOND_MONITOR === '1';
  const size = initialSize(process.env);
  // Automated runs capture the page, which has no Mica behind it: they use the solid backdrop (UF_CAPTURE_SCREEN=1 keeps Mica).
  const pageCapture = automated && captureVia() === 'page';
  backdrop = wantsMica({
    platform: process.platform, release: os.release(), env: pageCapture ? { ...process.env, UF_NO_MICA: '1' } : process.env,
    highContrast: nativeTheme.shouldUseHighContrastColors,
  }) ? 'mica' : 'solid';
  const options = {
    ...size,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    ...(second ? { x: -3400, y: 40 } : {}),
    show: false,
    backgroundColor: windowBackground({ backdrop, dark: nativeTheme.shouldUseDarkColors }),
    title: 'Underframe Desktop',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayOptions(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
      additionalArguments: [
        `--uf-backdrop=${backdrop}`,
        ...(smoke ? [SMOKE_ARG] : []),
        ...(scenes ? [SCENES_ARG] : []),
        // Scene mode only: fail the boot on purpose to capture the loading and boot error screens.
        ...(scenes && process.env.UF_SCENE_BOOT_ERROR === '1' ? ['--uf-scene-boot-error'] : []),
        // Testing: draw every card as a text card, as when core/images is not installed.
        ...(process.env.UF_NO_CARD_IMAGES === '1' ? ['--uf-no-card-images'] : []),
      ],
    },
  };
  let win;
  try {
    win = new BrowserWindow(backdrop === 'mica' ? { ...options, backgroundMaterial: 'mica' } : options);
  } catch {
    // Mica refused: fall back to the solid window.
    backdrop = 'solid';
    win = new BrowserWindow({ ...options, backgroundColor: windowBackground({ backdrop, dark: nativeTheme.shouldUseDarkColors }) });
  }
  win.once('ready-to-show', () => win.show());
  // Zoom keys work in every build (the packaged app has no menu to carry them): WCAG 1.4.4.
  win.webContents.on('before-input-event', (event, input) => {
    const level = zoomFor(input, win.webContents.getZoomLevel());
    if (level == null) return;
    event.preventDefault();
    win.webContents.setZoomLevel(level);
  });
  if (smoke) smokeRun = attachSmoke(win, { exit: code => app.exit(code) });
  if (scenes) scenesRun = attachScenes(win, { exit: code => app.exit(code), dir: scenes });
  installCloseGuard(win);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadURL(START_URL);
  return win;
}

/**
 * Closing with unsaved changes: main asks the renderer, which answers 'close' (nothing to save) or 'wait'
 * (it shows Save / Don't save / Cancel and calls uf.closeWindow() when the user decides). No answer within
 * 5 s closes the window anyway, so a hung renderer can never keep it open.
 */
function installCloseGuard(win) {
  // Smoke runs end with app.exit; scene runs keep the guard so the "Save changes?" path is captured too.
  let allowClose = smoke;
  let waiting = null;
  win.on('close', event => {
    if (allowClose || win.webContents.isCrashed()) return;
    event.preventDefault();
    if (waiting) return;
    waiting = setTimeout(() => {
      allowClose = true;
      if (!win.isDestroyed()) win.close();
    }, CLOSE_ANSWER_TIMEOUT_MS);
    win.webContents.send('uf:close-request');
  });
  win.closeGuard = {
    answer(kind) {
      clearTimeout(waiting);
      waiting = null;
      if (kind === 'close') {
        allowClose = true;
        if (!win.isDestroyed()) win.close();
      }
    },
  };
}

function buildMenu() {
  if (app.isPackaged) return null;
  return Menu.buildFromTemplate([
    {
      label: 'View',
      // Zoom keys are handled in before-input-event for every build, so they aren't repeated here.
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
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
    backdrop,
  }));
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
  // Screenshot recognition: 'uf:ocr:recognize' and 'uf:ocr:captureGame'.
  registerOcrIpc(handle);
  handle('uf:closeAnswer', kind => {
    mainWindow?.closeGuard?.answer(kind === 'close' ? 'close' : 'wait');
  });
  handle('uf:smokeResult', result => {
    if (smokeRun) smokeRun.report(result);
  });
  handle('uf:smokeCapture', tag => (smokeRun ? smokeRun.capture(tag) : null));
  handle('uf:smokeClick', (x, y) => (smokeRun ? smokeRun.click(x, y) : false));
  handle('uf:smokePress', (key, modifiers) => (smokeRun ? smokeRun.press(String(key), modifiers) : false));
  handle('uf:smokeOcrImage', () => (smokeRun ? smokeRun.ocrImage() : null));

  handle('uf:sceneCapture', name => (scenesRun ? scenesRun.capture(String(name)) : null));
  handle('uf:scenesDone', () => scenesRun?.done());
  handle('uf:sceneZoom', factor => (scenesRun ? scenesRun.zoom(factor) : false));
  handle('uf:sceneEmulate', features => (scenesRun ? scenesRun.emulate(features) : false));

  handle('uf:scenesFailed', error => scenesRun?.fail(String(error)));
  // Scene mode only: close the window the way the caption button does, to capture the close guard.
  handle('uf:sceneRequestClose', () => {
    if (scenesRun && mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
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
  nativeTheme.themeSource = themeSourceFrom(process.env);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  handleAppProtocol(protocol, appRoot());
  store = createBuildsStore(app.getPath('userData'));
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();
  nativeTheme.on('updated', () => syncChrome(mainWindow));
}
