// The update settings on disk: one JSON file in userData ({ version: 1, auto }), written atomically, validated on
// read. `auto`: check for updates automatically (on unless the user turned it off). Pure node (no Electron), tested
// against a temp dir.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const UPDATE_SETTINGS_FILE = 'update-settings.json';
const VERSION = 1;

/** Only a stored `auto: false` turns automatic checks off; anything else keeps the default. */
export function cleanUpdateSettings(raw) {
  return { version: VERSION, auto: !(raw && typeof raw === 'object' && raw.auto === false) };
}

export function createUpdateSettingsStore(dir) {
  const file = path.join(dir, UPDATE_SETTINGS_FILE);
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function read() {
    try {
      return cleanUpdateSettings(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      // Missing or unreadable: the defaults.
      return cleanUpdateSettings(null);
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
    /** The stored settings, or the defaults. */
    get: () => serial(read),
    /** Merge `patch` into the stored settings; resolves to what was stored. */
    set: patch => serial(async () => {
      const clean = cleanUpdateSettings({ ...(await read()), ...patch });
      await write(clean);
      return clean;
    }),
  };
}
