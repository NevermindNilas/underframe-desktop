// Saved builds on disk: one JSON file in userData, written atomically, validated on read.
// Pure node (no Electron), so it is tested against a temp dir.

import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';

export const FILE_NAME = 'builds.json';
export const MOD_SLOTS = 9;
const FORMAT_VERSION = 1;
const MAX_TEXT = 10_000;
const MAX_NAME = 200;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanMod(m) {
  if (!isObj(m) || typeof m.name !== 'string' || !m.name) return null;
  return { name: str(m.name, MAX_NAME), rank: Math.max(0, Math.round(num(m.rank))) };
}

/** An arcane slot: { name, rank, options?: { stacks?, startingStacks? } } or null. */
function cleanArcane(a) {
  if (!isObj(a) || typeof a.name !== 'string' || !a.name) return null;
  const out = { name: str(a.name, MAX_NAME), rank: Math.max(0, Math.round(num(a.rank))) };
  if (isObj(a.options)) {
    const options = {};
    for (const k of ['stacks', 'startingStacks']) if (Number.isFinite(Number(a.options[k]))) options[k] = Math.round(Number(a.options[k]));
    if (Object.keys(options).length) out.options = options;
  }
  return out;
}

/** An external buff row in underframe.site's shape: { id, name, value, element?, factionValue?, sourceBuild? }. */
export function cleanExternalBuff(b) {
  if (!isObj(b) || typeof b.id !== 'string' || !b.id || !Number.isFinite(Number(b.value))) return null;
  const out = { id: str(b.id, 80), name: str(b.name, MAX_NAME) || str(b.id, 80), value: Number(b.value) };
  if (typeof b.element === 'string' && b.element) out.element = str(b.element, 40);
  if (Number.isFinite(Number(b.factionValue)) && b.factionValue !== null && b.factionValue !== '') out.factionValue = Number(b.factionValue);
  if (typeof b.sourceBuild === 'string' && b.sourceBuild) out.sourceBuild = str(b.sourceBuild, MAX_NAME);
  return out;
}

/** A status on the target before the fight: { type, stacks } with whole stacks of at least 1. */
export function cleanExternalStatus(s) {
  if (!isObj(s) || typeof s.type !== 'string' || !s.type) return null;
  const stacks = Math.round(num(s.stacks));
  return stacks >= 1 ? { type: str(s.type, 40), stacks: Math.min(99, stacks) } : null;
}

const POLARITY_CODE = /^AP_[A-Z]{2,12}$/;

function cleanEnemy(e) {
  const o = isObj(e) ? e : {};
  return {
    preset: str(o.preset, MAX_NAME) || 'Custom',
    level: num(o.level, 1),
    steelPath: Boolean(o.steelPath),
    faction: str(o.faction, MAX_NAME),
    hp: num(o.hp),
    armor: num(o.armor),
    shields: num(o.shields),
    overguard: num(o.overguard),
    headshot: Boolean(o.headshot),
  };
}

function cleanResult(r) {
  if (!isObj(r)) return undefined;
  const out = {};
  for (const k of ['avgDps', 'ttk', 'avgHit', 'firstHitDamage', 'runs']) {
    if (r[k] === null || Number.isFinite(r[k])) out[k] = r[k];
  }
  return out;
}

/** Normalise a build coming from the renderer into the SavedBuild shape. Throws on unusable input. */
export function normalizeBuild(build) {
  if (!isObj(build)) throw new TypeError('build must be an object');
  if (typeof build.weaponName !== 'string' || !build.weaponName) throw new TypeError('build.weaponName is required');
  const mods = Array.from({ length: MOD_SLOTS }, (_, i) => cleanMod(Array.isArray(build.mods) ? build.mods[i] : null));
  const out = {
    id: typeof build.id === 'string' && build.id ? build.id.slice(0, MAX_NAME) : undefined,
    name: str(build.name, MAX_NAME).trim() || build.weaponName,
    weaponName: str(build.weaponName, MAX_NAME),
    modeName: str(build.modeName, MAX_NAME),
    mods,
    // Older builds have none of these three; the renderer fills in the defaults when it reads them.
    ...(Array.isArray(build.arcanes) ? { arcanes: build.arcanes.slice(0, 4).map(cleanArcane) } : {}),
    ...(Array.isArray(build.slotPolarities)
      ? { slotPolarities: Array.from({ length: MOD_SLOTS }, (_, i) => (typeof build.slotPolarities[i] === 'string' && POLARITY_CODE.test(build.slotPolarities[i]) ? build.slotPolarities[i] : null)) }
      : {}),
    ...(typeof build.catalyst === 'boolean' ? { catalyst: build.catalyst } : {}),
    // External buffs and target statuses (docs/port-external-buffs.md); older builds have neither.
    ...(Array.isArray(build.externalBuffs) && build.externalBuffs.length
      ? { externalBuffs: build.externalBuffs.slice(0, 200).map(cleanExternalBuff).filter(Boolean) } : {}),
    ...(Array.isArray(build.externalStatuses) && build.externalStatuses.length
      ? { externalStatuses: build.externalStatuses.slice(0, 30).map(cleanExternalStatus).filter(Boolean) } : {}),
    enemy: cleanEnemy(build.enemy),

    simTime: num(build.simTime, 20),
    notes: str(build.notes),
    updatedAt: typeof build.updatedAt === 'string' ? build.updatedAt : undefined,
  };
  const lastResult = cleanResult(build.lastResult);
  if (lastResult) out.lastResult = lastResult;
  return out;
}

/** A stored build is valid when it has the identity fields and the right mod array. */
export function isValidStoredBuild(b) {
  return isObj(b) && typeof b.id === 'string' && b.id !== '' && typeof b.name === 'string' &&
    typeof b.weaponName === 'string' && b.weaponName !== '' && Array.isArray(b.mods) &&
    b.mods.length === MOD_SLOTS && b.mods.every(m => m === null || (isObj(m) && typeof m.name === 'string')) &&
    isObj(b.enemy) && typeof b.updatedAt === 'string';
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a store rooted at `dir` (app.getPath('userData')).
 * Options are for tests: randomUUID and now() replace the real id and clock.
 */
export function createBuildsStore(dir, { randomUUID = nodeRandomUUID, now = () => new Date() } = {}) {
  const file = path.join(dir, FILE_NAME);
  let cache = null;
  let queue = Promise.resolve();

  /** Serialise all operations so concurrent saves cannot interleave read-modify-write. */
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function backupCorrupt() {
    for (let n = 1; ; n++) {
      const target = path.join(dir, `builds.corrupt-${n}.json`);
      if (!(await exists(target))) {
        await copyFile(file, target);
        return target;
      }
    }
  }

  async function writeAll(builds) {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: FORMAT_VERSION, builds }, null, 2), 'utf8');
    // Windows can briefly refuse the rename while another process (antivirus, indexer) holds the target.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        break;
      } catch (e) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
          await unlink(tmp).catch(() => {});
          throw e;
        }
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
    }
    cache = builds;
  }

  async function load() {
    if (cache) return cache;
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return (cache = []);
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const list = isObj(parsed) && Array.isArray(parsed.builds) ? parsed.builds : null;
    if (!list) {
      await backupCorrupt();
      await writeAll([]);
      return cache;
    }
    const valid = list.filter(isValidStoredBuild);
    if (valid.length !== list.length) {
      // Keep what is usable, but preserve the original so nothing is lost silently.
      await backupCorrupt();
      await writeAll(valid);
      return cache;
    }
    return (cache = valid);
  }

  return {
    file,

    /** All builds, most recently updated first. */
    list: () => serial(async () => [...(await load())].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))),

    /** Insert or replace by id; assigns id and updatedAt. Returns the stored build. */
    save: build => serial(async () => {
      const clean = normalizeBuild(build);
      clean.id ??= randomUUID();
      clean.updatedAt = now().toISOString();
      const builds = (await load()).filter(b => b.id !== clean.id);
      builds.push(clean);
      await writeAll(builds);
      return clean;
    }),

    remove: id => serial(async () => {
      const builds = await load();
      const next = builds.filter(b => b.id !== id);
      if (next.length !== builds.length) await writeAll(next);
    }),
  };
}
