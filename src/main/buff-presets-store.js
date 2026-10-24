// The external-buff preset library on disk: one JSON file in userData, written atomically, validated on read.
// The shape is underframe.site's ({ version: 1, presets: [{ id, name, buffs }] }), so a site export loads as is.
// One library for the user, not one per build or weapon class. Pure node (no Electron), tested against a temp dir.

import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanExternalBuff } from './builds-store.js';

export const PRESETS_FILE = 'buff-presets.json';
const VERSION = 1;
const MAX_PRESETS = 500;
const MAX_NAME = 80;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate a library: named presets with unique names (case-insensitive) and ids, clean buff rows, sorted by name. */
export function cleanPresetLibrary(raw, { randomUUID = nodeRandomUUID } = {}) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.presets) ? raw.presets : [];
  const names = new Set();
  const ids = new Set();
  const presets = [];
  for (const p of list.slice(0, MAX_PRESETS)) {
    if (!isObj(p)) continue;
    const name = String(p.name ?? '').trim().slice(0, MAX_NAME);
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const id = typeof p.id === 'string' && p.id && p.id !== '__custom__' && !ids.has(p.id) ? p.id.slice(0, 100) : randomUUID();
    ids.add(id);
    presets.push({ id, name, buffs: (Array.isArray(p.buffs) ? p.buffs : []).slice(0, 200).map(cleanExternalBuff).filter(Boolean) });
  }
  presets.sort((a, b) => a.name.localeCompare(b.name));
  return { version: VERSION, presets };
}

export function createBuffPresetsStore(dir, { randomUUID = nodeRandomUUID } = {}) {
  const file = path.join(dir, PRESETS_FILE);
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function read() {
    try {
      return cleanPresetLibrary(JSON.parse(await readFile(file, 'utf8')), { randomUUID });
    } catch {
      // Missing or unreadable: an empty library (a broken file is replaced on the next save).
      return { version: VERSION, presets: [] };
    }
  }

  async function write(library) {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(library, null, 2), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (e) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
          await unlink(tmp).catch(() => {});
          throw e;
        }
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }

  return {
    file,
    /** The library, { version: 1, presets }. */
    get: () => serial(read),
    /** Replace the whole library; resolves to what was stored. */
    set: library => serial(async () => {
      const clean = cleanPresetLibrary(library, { randomUUID });
      await write(clean);
      return clean;
    }),
  };
}
