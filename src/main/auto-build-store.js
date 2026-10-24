// Auto Build's configs on disk (docs/port-auto-build.md 9.1): one JSON file in userData, written atomically and
// checked on read. The renderer normalises the settings (src/shared/auto-build-settings.js); this side only keeps the
// shape safe: plain values, bounded sizes, no unknown types. Pure node (no Electron), tested against a temp dir.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTO_BUILD_FILE = 'auto-build.json';
const MAX_CONFIGS = 60;
const MAX_LIST = 2000;
const MAX_STRING = 120;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = MAX_STRING) => (typeof v === 'string' ? v.slice(0, max) : null);

/** Settings values: booleans, finite numbers, short strings and lists of short strings; anything else is dropped. */
function cleanSettings(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 80)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_STRING);
    else if (Array.isArray(v)) out[k] = v.slice(0, MAX_LIST).filter(x => typeof x === 'string').map(x => x.slice(0, MAX_STRING));
  }
  return out;
}

/** The stored document: { version, activeConfigId, configs: [{ id, name, settings }], cores }. */
export function cleanAutoBuildDoc(raw) {
  const r = isObj(raw) ? raw : {};
  const configs = [];
  for (const c of (Array.isArray(r.configs) ? r.configs : []).slice(0, MAX_CONFIGS)) {
    if (!isObj(c)) continue;
    const id = str(c.id, 80);
    const name = str(c.name, 60);
    if (!id || !name) continue;
    configs.push({ id, name, settings: cleanSettings(c.settings) });
  }
  const cores = Number.isInteger(r.cores) && r.cores >= 1 && r.cores <= 64 ? r.cores : null;
  return { version: 1, activeConfigId: str(r.activeConfigId, 80), configs, cores };
}

export function createAutoBuildStore(dir) {
  const file = path.join(dir, AUTO_BUILD_FILE);
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function read() {
    try {
      return cleanAutoBuildDoc(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      // Missing or unreadable: no saved configs (the renderer starts from the defaults).
      return null;
    }
  }

  async function write(doc) {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (e) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
          await unlink(tmp).catch(() => {});
          throw e;
        }
        await new Promise(res => setTimeout(res, 50 * (attempt + 1)));
      }
    }
  }

  return {
    file,
    /** The stored document, or null when there is none yet. */
    get: () => serial(read),
    /** Replace it; resolves to what was stored. */
    set: doc => serial(async () => {
      const clean = cleanAutoBuildDoc(doc);
      await write(clean);
      return clean;
    }),
  };
}
