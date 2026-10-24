// Scene-capture mode (UF_SCENES=<dir>): the renderer drives the real UI through a list of states and asks
// main to save a PNG of each; main prints one `UF_SCENES_DONE <json list>` line and exits 0.
// Failures print `UF_SCENES_FAILED <json>` and exit 1.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { consoleDetails, writeLine } from './smoke.js';
import { captureWindow } from './capture.js';

export const SCENES_ARG = '--uf-scenes';
export const SCENES_TIMEOUT_MS = 240_000;

export const scenesDir = (env = process.env) => (env.UF_SCENES ? path.resolve(env.UF_SCENES) : null);

const delay = ms => new Promise(r => setTimeout(r, ms));

/** File-safe scene name. A name that starts with its own number ("04-gallery-search") keeps it. */
export function sceneFileName(index, name) {
  const safe = String(name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'scene';
  return /^\d{2}[a-z]?-/.test(safe) ? `${safe}.png` : `${String(index).padStart(2, '0')}-${safe}.png`;
}

/** Wire scene mode onto a window. Returns {capture(name), done(list), fail(error)} for the IPC handlers. */
/**
 * Optional accessibility scan (UF_AXE=<path to axe.min.js>, a reviewer's local copy; never shipped): runs
 * axe-core in an isolated world on each scene and writes <scene>.axe.json with the violations.
 */
async function axeScan(wc, source) {
  const run = `axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({
    id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
    targets: v.nodes.slice(0, 60).map(n => n.target.join(' ')),
    why: v.nodes.slice(0, 3).map(n => n.failureSummary),
  })))`;
  await wc.executeJavaScriptInIsolatedWorld(4242, [{ code: `${source};
true` }]);
  return wc.executeJavaScriptInIsolatedWorld(4242, [{ code: run }]);
}

export function attachScenes(win, { exit, dir, timeoutMs = SCENES_TIMEOUT_MS, axePath = process.env.UF_AXE }) {
  let axeSource = null;
  let finished = false;
  let index = 0;
  const saved = [];
  const wc = win.webContents;

  async function finish(line, code) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    await writeLine(line);
    exit(code);
  }

  const fail = error => finish(`UF_SCENES_FAILED ${JSON.stringify({ error: String(error), saved })}`, 1);
  const timer = setTimeout(() => fail('timeout'), timeoutMs);

  async function capture(name) {
    if (finished || win.isDestroyed()) return null;
    await mkdir(dir, { recursive: true });
    await delay(250);
    const file = path.join(dir, sceneFileName(++index, name));
    const { png, via } = await captureWindow(win);
    await writeFile(file, png);
    saved.push(file);
    await writeLine(`[scenes] saved ${file} (${via})`);
    if (axePath) {
      try {
        axeSource ??= await readFile(axePath, 'utf8');
        const violations = await axeScan(wc, axeSource);
        await writeFile(file.replace(/.png$/, '.axe.json'), JSON.stringify(violations, null, 2));
        const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        await writeLine(`[axe] ${path.basename(file)}: ${violations.length} violations, ${serious.length} serious or critical${serious.length ? `: ${serious.map(v => `${v.id} (${v.nodes})`).join(', ')}` : ''}`);
      } catch (e) {
        await writeLine(`[axe] scan failed: ${e?.message ?? e}`);
      }
    }
    return file;
  }

  wc.on('console-message', (event, ...legacy) => {
    const { level, message, where } = consoleDetails(event, legacy);
    writeLine(`[renderer] ${level}: ${message}${where ? ` (${where})` : ''}`);
    if (level === 'error' && /^Uncaught\b/.test(message)) fail(`uncaught renderer error: ${message} ${where}`);
  });
  wc.on('render-process-gone', (_e, details) => fail(`renderer gone: ${details?.reason}`));
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (isMainFrame) fail(`load failed: ${description} (${code})`);
  });
  win.on('closed', () => fail('window closed before the scenes finished'));

  /** Scene mode only: zoom the page (the stacked layout at 200%). */
  function zoom(factor) {
    if (finished || win.isDestroyed()) return false;
    const f = Math.min(3, Math.max(0.5, Number(factor) || 1));
    wc.setZoomFactor(f);
    return true;
  }

  /** Scene mode only: emulate CSS media features through the DevTools protocol (forced colours, reduced motion). */
  async function emulate(features) {
    if (finished || win.isDestroyed()) return false;
    const list = (Array.isArray(features) ? features : [])
      .filter(f => f && /^[a-z-]{1,40}$/.test(String(f.name)) && /^[a-z-]{0,40}$/.test(String(f.value)))
      .map(f => ({ name: String(f.name), value: String(f.value) }));
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: list });
    return true;
  }

  return {
    zoom,
    emulate,
    capture,

    done: () => finish(`UF_SCENES_DONE ${JSON.stringify(saved)}`, 0),
    fail,
  };
}
