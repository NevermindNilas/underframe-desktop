// The riven library on disk: one JSON file in userData ({ version: 1, rivens }), written atomically, validated on
// read. One library for the user, like buff-presets.json. Also the riven cleaner saved builds use for a riven slot.
// Pure node (no Electron), tested against a temp dir. The rules match src/shared/rivens.js normalizeRiven(), kept
// here because the packaged main process ships src/main only.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RIVENS_FILE = 'rivens.json';
const VERSION = 1;
const MAX_RIVENS = 500;
const MAX_TEXT = 200;
const MAX_STATS = 4;
const MAX_RANK = 8;
const DEFAULT_DISPOSITION = 1.2;
const UNITS = ['%', 'm', 's', ''];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');

/** The unit a riven stat is kept in, as the site fixes it per stat. */
function unitOf(name, unit) {
  if (name === 'Initial Combo') return '';
  if (name === 'Combo Duration') return 's';
  if (['Range', 'Melee Range', 'Punch Through'].includes(name)) return 'm';
  if (name === 'Parry Angle' || name.startsWith('Damage vs.')) return '%';
  return UNITS.includes(unit) ? unit : '%';
}

/**
 * A riven slot or library entry: { isRiven, id, name, family, disposition, rank, stats: [{ name, value, unit }] },
 * or null. Disposition is a number above 0 (else 1.2), rank a whole number 0-8 (else 8), at most 4 stats with a
 * name and a finite value; unknown keys are dropped.
 */
export function cleanRiven(r) {
  if (!isObj(r) || r.isRiven !== true) return null;
  const family = text(r.family) || text(r.name).replace(/ Riven Mod$/, '');
  if (!family) return null;
  const d = typeof r.disposition === 'number' || (typeof r.disposition === 'string' && r.disposition.trim()) ? Number(r.disposition) : NaN;
  const rank = Number(r.rank);
  const stats = (Array.isArray(r.stats) ? r.stats : [])
    .filter(s => isObj(s) && typeof s.name === 'string' && s.name && Number.isFinite(Number(s.value)))
    .slice(0, MAX_STATS)
    .map(s => ({ name: s.name.slice(0, MAX_TEXT), value: Number(s.value), unit: unitOf(s.name, s.unit) }));
  return {
    isRiven: true,
    id: text(r.id),
    name: `${family} Riven Mod`,
    family,
    disposition: Number.isFinite(d) && d > 0 ? d : DEFAULT_DISPOSITION,
    rank: Number.isInteger(rank) && rank >= 0 && rank <= MAX_RANK ? rank : MAX_RANK,
    stats,
  };
}

/** A clean library: rivens with an id, each id once, in the order given. */
export function cleanRivenLibrary(raw) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.rivens) ? raw.rivens : [];
  const ids = new Set();
  const rivens = [];
  for (const r of list.slice(0, MAX_RIVENS)) {
    const riven = cleanRiven(r);
    if (!riven?.id || ids.has(riven.id)) continue;
    ids.add(riven.id);
    rivens.push(riven);
  }
  return { version: VERSION, rivens };
}

export function createRivensStore(dir) {
  const file = path.join(dir, RIVENS_FILE);
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function read() {
    try {
      return cleanRivenLibrary(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      // Missing or unreadable: an empty library (a broken file is replaced on the next save).
      return { version: VERSION, rivens: [] };
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
    /** The library, { version: 1, rivens }. */
    get: () => serial(read),
    /** Replace the whole library; resolves to what was stored. */
    set: library => serial(async () => {
      const clean = cleanRivenLibrary(library);
      await write(clean);
      return clean;
    }),
  };
}
