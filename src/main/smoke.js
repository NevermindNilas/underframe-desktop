// Smoke mode (UF_SMOKE=1): the renderer runs a scripted build and reports back; main prints
// one `UF_SMOKE_RESULT <json>` line, optionally saves a screenshot, and exits 0 (ok) or 1.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureVia, captureWindow } from './capture.js';

export const SMOKE_TIMEOUT_MS = 90_000;
export const SMOKE_ARG = '--uf-smoke';

export const isSmoke = (env = process.env) => env.UF_SMOKE === '1';

const delay = ms => new Promise(r => setTimeout(r, ms));

export function writeLine(line) {
  return new Promise(resolve => process.stdout.write(line + '\n', () => resolve()));
}

/** Pull level/message out of a console-message event (object form, with the legacy positional form as fallback). */
export function consoleDetails(event, legacy) {
  const level = event?.level ?? ['verbose', 'info', 'warning', 'error'][legacy[0]] ?? 'info';
  const message = event?.message ?? legacy[1] ?? '';
  const source = event?.sourceId ?? legacy[3] ?? '';
  const line = event?.lineNumber ?? legacy[2] ?? 0;
  return { level, message: String(message), where: source ? `${source}:${line}` : '' };
}

/**
 * Wire smoke mode onto a window. Returns {report(result)} for the IPC handler.
 * `exit(code)` is app.exit; env carries UF_SMOKE_SCREENSHOT.
 */
export function attachSmoke(win, { exit, env = process.env, timeoutMs = SMOKE_TIMEOUT_MS }) {
  let done = false;
  const wc = win.webContents;

  async function savePng(file) {
    const { png } = await captureWindow(win, { via: captureVia(env) });
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await writeFile(file, png);
  }

  /** Extra screenshot mid-flow: <shot dir>/<shot base>-<tag>.png. Returns the path, or null when screenshots are off. */
  async function capture(tag) {
    const shot = env.UF_SMOKE_SCREENSHOT;
    const safe = String(tag ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    if (!shot || !safe || done || win.isDestroyed()) return null;
    const parsed = path.parse(path.resolve(shot));
    const file = path.join(parsed.dir, `${parsed.name}-${safe}.png`);
    await delay(300);
    await savePng(file);
    await writeLine(`[smoke] saved ${file}`);
    return file;
  }

  async function finish(result) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const shot = env.UF_SMOKE_SCREENSHOT;
    if (shot && !win.isDestroyed() && !wc.isCrashed()) {
      try {
        await delay(500);
        await savePng(shot);
      } catch (e) {
        await writeLine(`[smoke] screenshot failed: ${e?.message ?? e}`);
      }
    }
    let json;
    try {
      json = JSON.stringify(result);
    } catch (e) {
      result = { ok: false, error: `unserialisable smoke result: ${e?.message ?? e}` };
      json = JSON.stringify(result);
    }
    await writeLine(`UF_SMOKE_RESULT ${json}`);
    exit(result?.ok === true ? 0 : 1);
  }

  const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);

  wc.on('console-message', (event, ...legacy) => {
    const { level, message, where } = consoleDetails(event, legacy);
    writeLine(`[renderer] ${level}: ${message}${where ? ` (${where})` : ''}`);
    if (level === 'error' && /^Uncaught\b/.test(message)) {
      finish({ ok: false, error: `uncaught renderer error: ${message}`, where });
    }
  });
  wc.on('render-process-gone', (_e, details) => finish({ ok: false, error: `renderer gone: ${details?.reason}`, exitCode: details?.exitCode }));
  wc.on('preload-error', (_e, preloadPath, error) => finish({ ok: false, error: `preload error: ${error?.message ?? error}`, preloadPath }));
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame) finish({ ok: false, error: `load failed: ${description} (${code})`, url });
  });
  win.on('closed', () => finish({ ok: false, error: 'window closed before a smoke result' }));

  /**
   * A real mouse click at page coordinates (CSS px), delivered as OS-level input like a user's click, so
   * anything covering the control (an invisible overlay) gets it instead, as it would for a user.
   */
  async function click(x, y) {
    if (done || win.isDestroyed()) return false;
    const at = { x: Math.round(Number(x) * wc.getZoomFactor()), y: Math.round(Number(y) * wc.getZoomFactor()) };
    wc.sendInputEvent({ type: 'mouseMove', ...at });
    wc.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
    return true;
  }

  /**
   * Real key presses (OS-level input to the page, like the user's keyboard): `key` is an Electron key code ("Tab",
   * "Space"); `modifiers` e.g. ['shift']. Lets smoke check the real Tab order, which DOM focus() calls can't.
   */
  async function press(key, modifiers = []) {
    if (done || win.isDestroyed()) return false;
    // Key input only reaches a focused page: another window (the user's, on a PC in use) may have taken focus.
    if (!win.isFocused()) {
      win.focus();
      wc.focus();
    }
    const mods = (Array.isArray(modifiers) ? modifiers : []).filter(m => ['shift', 'control', 'alt'].includes(m));
    wc.sendInputEvent({ type: 'keyDown', keyCode: String(key), modifiers: mods });
    if (String(key).length === 1) wc.sendInputEvent({ type: 'char', keyCode: String(key), modifiers: mods });
    wc.sendInputEvent({ type: 'keyUp', keyCode: String(key), modifiers: mods });
    return true;
  }

  /**
   * The screenshot named by UF_SMOKE_OCR_IMAGE (UF_SMOKE_RIVEN_IMAGE for kind 'riven': two riven cards side by side),
   * a local test image never shipped, so the smoke run can drive real recognition end to end. Resolves to its bytes,
   * or null when the variable is not set.
   */
  async function ocrImage(kind = 'build') {
    const file = kind === 'riven' ? env.UF_SMOKE_RIVEN_IMAGE : env.UF_SMOKE_OCR_IMAGE;
    if (!file || done) return null;
    return new Uint8Array(await readFile(path.resolve(file)));
  }

  return {
    report: result => finish(result && typeof result === 'object' ? result : { ok: false, error: 'empty smoke result' }),
    capture,
    click,
    press,
    ocrImage,
  };

}
