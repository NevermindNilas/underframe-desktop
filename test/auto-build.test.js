// Auto Build (docs/port-auto-build.md): settings and configs, the candidate filters (blacklist, whitelist, stat and
// elemental blacklists, Exilus, compatibility, capacity), the search on fixtures with a fake scorer (locks, determinism,
// cancellation, the time limit, run counts), the engine worker's score request, the pool, the stored document, and a
// short real-engine run on Braton Prime. Tests that need the private core data skip without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as AS from '../src/shared/auto-build-settings.js';
import * as AB from '../src/shared/auto-build.js';
import { maxRank } from '../src/shared/mods.js';
import { buildAppState } from '../src/shared/engine-input.js';
import * as M from '../src/renderer/model.js';
import { createEnginePool, defaultPoolSize } from '../src/renderer/auto-build-pool.js';
import { runAutoBuildJob } from '../src/renderer/auto-build-job.js';
import { cleanAutoBuildDoc, createAutoBuildStore } from '../src/main/auto-build-store.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const workerFile = fileURLToPath(new URL('../src/renderer/engine.worker.js', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, ctx: M.createContext(data) };
  }
  return cached;
}

/** Braton Prime with a perk in every evolution: the search then picks mods only (the Genesis is always installed). */
const BRATON_PERKS = { evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 1, evolution_4_perk: 1, evolution_5_perk: null };

/** An env for an empty (or given) Braton Prime build with these settings. */
function envFor(patch = {}, { weaponName = 'Braton Prime', build: over = {}, headshot = false } = {}) {
  const { data, ctx } = real();
  const weapon = ctx.weaponByName.get(weaponName);
  const build = M.createBuild(ctx, { weaponName, ...over });
  const enemy = { ...M.resolveEnemy(ctx, build.enemy), headshot };
  const settings = AS.normalizeAutoBuildSettings(patch, data);
  return { env: AB.createAutoBuildEnv({ data, weapon, reload: ctx.reloadByName.get(weapon.name), build, enemy, settings, index: ctx.index }), build, ctx, data };
}

const names = list => list.map(m => m['Local Name']);
const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** A deterministic stand-in for the engine: every mod and arcane adds a fixed amount (its name's hash). */
function fakeScorer(log = []) {
  return async jobs => {
    log.push(jobs.map(j => j.seeds.length));
    return jobs.map(j => j.mods.reduce((t, m) => t + (m ? 100 + (hash(m.name) % 997) + m.rank : 0), 1000) + (j.arcanes?.[0] ? 50 + (hash(j.arcanes[0].name) % 300) : 0));
  };
}

// ---------- settings ----------

test('settings default to the site\'s values, with the blacklist and whitelist from data.json', () => {
  const data = { blacklist: ['Split Chamber', 'Riven Mod'], whitelist: ['Serration'] };
  const d = AS.defaultAutoBuildSettings(data);
  assert.equal(d.simulationTimeSeconds, 5);
  assert.equal(d.sampleSizeMultiplier, 3);
  assert.equal(d.finalRefinementEnabled, true);
  assert.equal(d.finalRefinementSampleSize, 200);
  assert.equal(d.luckAveragedEnabled, true);
  assert.equal(d.elementalCandidatesEnabled, true);
  assert.equal(d.modBlacklistEnabled, true);
  assert.deepEqual(d.modBlacklist, ['Split Chamber', 'Riven Mod']);
  assert.equal(d.modWhitelistEnabled, false);
  assert.deepEqual(d.modWhitelist, ['Serration']);
  assert.equal(d.costControlEnabled, false);
  assert.equal(d.maxForma, 5);
  assert.equal(d.timeLimitSeconds, AS.TIME_LIMIT_RANGE.default);
});

test('settings are clamped and normalised like the site\'s', () => {
  const data = { blacklist: [], whitelist: ['Serration', 'Hellfire'] };
  const s = AS.normalizeAutoBuildSettings({
    simulationTimeSeconds: 0, sampleSizeMultiplier: 0.01, finalRefinementSampleSize: 0, maxForma: 99, buildForRawDamage: true, buildForStatusDamage: true,
    limitedElementalCandidatesEnabled: true, limitedElementalTargets: ['Viral Heat'], modWhitelistEnabled: true, modWhitelist: [],
    statBlacklist: ['Fire Rate', 'crit chance', 'nonsense'], elementalBlacklist: ['heat', 'Heat', 'none', 'bogus'], timeLimitSeconds: 1,
  }, data);
  assert.equal(s.simulationTimeSeconds, 1);
  assert.equal(s.sampleSizeMultiplier, 0.2);
  assert.equal(s.finalRefinementSampleSize, 1);
  assert.equal(s.maxForma, 10);
  assert.equal(s.buildForStatusDamage, true);
  assert.equal(s.buildForRawDamage, false, 'raw and status are exclusive');
  assert.equal(s.specificElementalCandidatesEnabled, true, 'legacy key migrated');
  assert.deepEqual(s.specificElementalTargets, ['Viral Heat']);
  assert.deepEqual(s.modWhitelist, ['Serration', 'Hellfire'], 'an enabled empty whitelist refills');
  assert.deepEqual(s.statBlacklist, ['speed', 'critChance']);
  assert.deepEqual(s.elementalBlacklist, ['Heat'], 'de-duplicated by element set, empty and unknown dropped');
  assert.equal(s.timeLimitSeconds, AS.TIME_LIMIT_RANGE.min);
  assert.equal(AS.normalizeAutoBuildSettings({ simulationTimeSeconds: 1000, luckAveragedEnabled: 'yes' }, data).simulationTimeSeconds, 300);
  assert.equal(AS.normalizeAutoBuildSettings({ luckAveragedEnabled: 'yes' }, data).luckAveragedEnabled, false, 'only true counts');
  assert.equal(AS.normalizeAutoBuildSettings({ elementalCandidatesEnabled: false, specificElementalCandidatesEnabled: true }, data).specificElementalCandidatesEnabled, false);
});

test('runs per evaluation follow max(1, round(base / 5 x multiplier))', () => {
  assert.deepEqual([5, 10, 20, 30, 40, 50].map(b => AS.runsFor(b, 3)), [3, 6, 12, 18, 24, 30]);
  assert.equal(AS.runsFor(10, 0.2), 1);
  assert.equal(AS.metricOf({ buildForRawDamage: true }), 'avgRawPerShot');
  assert.equal(AS.metricOf({ buildForStatusDamage: true }), 'avgDotPerShot');
  assert.equal(AS.metricOf({}), 'avgDps');
});

test('element targets parse presets, aliases and free combinations', () => {
  assert.deepEqual(AS.parseElementTarget('Viral + Heat'), { name: 'Viral Heat', target: ['Heat', 'Viral'] });
  assert.deepEqual(AS.parseElementTarget('fire, poison'), { name: 'Heat Toxin', target: ['Heat', 'Toxin'] });
  assert.deepEqual(AS.parseElementTarget('None'), { name: 'No Element', target: [] });
  assert.deepEqual(AS.parseElementTarget('corrosive blast'), { name: 'Corrosive Blast', target: ['Blast', 'Corrosive'] });
  assert.equal(AS.parseElementTarget('Viral and stuff'), null);
  assert.equal(AS.blockedByElementalBlacklist(['Heat', 'Viral'], [{ target: ['Heat'] }]), true);
  assert.equal(AS.blockedByElementalBlacklist(['Viral'], [{ target: ['Heat'] }]), false);
  assert.equal(AS.blockedByElementalBlacklist(['Corrosive'], [{ target: ['Corrosive', 'Heat'] }]), false, 'every element of the entry must be there');
});

test('stat families come from UpgradeType and the site\'s name rules', () => {
  const mod = (name, stats, extra = {}) => ({ 'Local Name': name, Stats: stats.map(([UpgradeType, DamageType]) => ({ UpgradeType, DamageType })), ...extra });
  assert.deepEqual([...AS.modStatFamilies(mod('Serration', [['WEAPON_DAMAGE_AMOUNT']]))], ['damage']);
  assert.deepEqual([...AS.modStatFamilies(mod('Split Chamber', [['WEAPON_FIRE_ITERATIONS']]))], ['multishot']);
  assert.deepEqual([...AS.modStatFamilies(mod('Hellfire', [['WEAPON_PERCENT_BASE_DAMAGE_ADDED', 'DT_FIRE']]))], ['heat']);
  assert.deepEqual([...AS.modStatFamilies(mod('Malignant Force', [['WEAPON_PERCENT_BASE_DAMAGE_ADDED', 'DT_POISON'], ['WEAPON_PROC_CHANCE']]))].sort(), ['statusChance', 'toxin']);
  assert.ok(AS.modStatFamilies(mod('Hunter Synergy', [])).has('critChance'));
  assert.ok(AS.modStatFamilies(mod('Semi-Rifle Cannonade', [['WEAPON_DAMAGE_AMOUNT']])).has('speed'));
  assert.equal(AS.normalizeStatKey('Fire Rate / Attack Speed'), 'speed');
  assert.equal(AS.normalizeStatKey('magazine size'), 'magazine');
});

// ---------- configs ----------

test('configs: a locked Default, Your Config active, and the site\'s rules', () => {
  const data = { blacklist: ['A'], whitelist: [] };
  let lib = AS.normalizeAutoBuildLibrary(null, data);
  assert.deepEqual(lib.configs.map(c => [c.id, c.name, c.locked]), [['default', 'Default', true], ['your_config', 'Your Config', false]]);
  assert.equal(lib.activeConfigId, 'your_config');
  assert.equal(AS.updateConfigSettings(lib, 'default', { maxForma: 1 }, data).error, AS.CONFIG_MESSAGES.defaultLocked);
  assert.equal(AS.renameConfig(lib, 'default', 'X').error, AS.CONFIG_MESSAGES.defaultLocked);
  assert.equal(AS.deleteConfig(lib, 'default').error, AS.CONFIG_MESSAGES.defaultLocked);
  assert.equal(AS.deleteConfig(lib, 'your_config').error, AS.CONFIG_MESSAGES.deleteActive);
  assert.equal(AS.addConfig(lib, 'default', null, data).error, AS.CONFIG_MESSAGES.reserved);
  let r = AS.addConfig(lib, 'your config', null, data);
  assert.equal(r.library.configs.at(-1).name, 'your config (2)', 'names are unique, case-insensitively');
  lib = AS.updateConfigSettings(lib, 'your_config', { maxForma: 2, modBlacklist: ['B'] }, data).library;
  r = AS.duplicateConfig(lib, 'your_config', data);
  const copy = r.library.configs.find(c => c.id === r.id);
  assert.equal(copy.name, 'Copy of Your Config');
  assert.equal(copy.settings.maxForma, 2);
  assert.deepEqual(copy.settings.modBlacklist, ['B']);
  lib = r.library;
  assert.equal(AS.moveConfig(lib, r.id, -1).library.configs[1].id, r.id);
  assert.equal(AS.moveConfig(AS.moveConfig(lib, r.id, -1).library, r.id, -1).library.configs[0].id, 'default', 'Default stays first');
  const stored = AS.serializeAutoBuildLibrary(lib);
  assert.ok(stored.configs.every(c => c.id !== 'default'), 'Default is never stored');
  const back = AS.normalizeAutoBuildLibrary(JSON.parse(JSON.stringify(stored)), data);
  assert.deepEqual(back.configs.map(c => c.name), ['Default', 'Your Config', 'Copy of Your Config']);
  assert.equal(back.configs[0].settings.maxForma, 5, 'Default always holds the defaults');
  assert.equal(AS.normalizeAutoBuildLibrary({ activeConfigId: 'gone', configs: [{ id: 'x', name: 'Default' }] }, data).activeConfigId, 'your_config');
});

test('Your Config starts with Cost Control on; Default keeps the site\'s off; the default whitelist skips blacklisted names', () => {
  const data = { blacklist: ['Split Chamber', 'Point Strike'], whitelist: ['Serration', 'Split Chamber', 'Point Strike', 'Vital Sense'] };
  const lib = AS.normalizeAutoBuildLibrary(null, data);
  assert.equal(lib.configs[0].settings.costControlEnabled, false, 'Default is the site\'s defaults');
  assert.equal(lib.configs[1].settings.costControlEnabled, true, 'a first run proposes a build that can be equipped');
  assert.deepEqual(AS.defaultAutoBuildSettings(data).modWhitelist, ['Serration', 'Vital Sense']);
  assert.deepEqual(AS.whitelistOverlap({ ...AS.defaultAutoBuildSettings(data), modWhitelistEnabled: true }), [], 'turning the whitelist on shows no contradiction');
  // A stored Your Config keeps its own choice.
  const stored = AS.normalizeAutoBuildLibrary({ configs: [{ id: 'your_config', name: 'Your Config', settings: { costControlEnabled: false } }] }, data);
  assert.equal(stored.configs[1].settings.costControlEnabled, false);
});

test('the stored document keeps only plain, bounded values', async () => {
  const doc = cleanAutoBuildDoc({
    activeConfigId: 'a', cores: 99, configs: [{ id: 'a', name: 'Mine', settings: { maxForma: 3, x: { nested: 1 }, modBlacklist: ['A', 7, 'B'], 'bad key': 1 } }, { id: 5 }],
  });
  assert.deepEqual(doc, { version: 1, activeConfigId: 'a', configs: [{ id: 'a', name: 'Mine', settings: { maxForma: 3, modBlacklist: ['A', 'B'] } }], cores: null });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uf-autobuild-'));
  try {
    const store = createAutoBuildStore(dir);
    assert.equal(await store.get(), null, 'nothing stored yet');
    await store.set({ activeConfigId: 'a', configs: [{ id: 'a', name: 'Mine', settings: { maxForma: 1 } }], cores: 4 });
    assert.deepEqual(await store.get(), { version: 1, activeConfigId: 'a', configs: [{ id: 'a', name: 'Mine', settings: { maxForma: 1 } }], cores: 4 });
    writeFileSync(store.file, '{ broken');
    assert.equal(await store.get(), null, 'an unreadable file reads as nothing stored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- candidate filtering ----------

test('pools: the default blacklist, rivens, Exilus, compatibility and the Cannonade rule', { skip }, () => {
  const { env, data } = envFor();
  const all = new Set(names(env.pools.allowed));
  for (const n of data.blacklist) assert.ok(!all.has(n), `${n} is blacklisted`);
  assert.ok(!all.has('Semi-Rifle Cannonade'), 'Braton Prime does not take Semi-Cannonade mods');
  assert.ok(names(env.pools.greedy).includes('Serration'));
  assert.deepEqual(names(env.pools.elemental).sort(), ['Hellfire', 'High Voltage', 'Infected Clip', 'Malignant Force', 'Primed Cryo Rounds', 'Rime Rounds', 'Stormbringer', 'Thermite Rounds', 'Wildfire']);
  assert.ok(names(env.pools.greedy).includes('Vile Precision'), 'Exilus mods may go in a normal slot');
  assert.ok(!names(env.pools.refinement).includes('Vile Precision'), 'but are never refinement swaps');
  assert.ok(names(env.pools.greedy).includes('Magnetic Capacity') && !names(env.pools.elemental).includes('Magnetic Capacity'), 'direct Magnetic mods fill, they do not compose');
  assert.ok(env.blacklist.has('Riven Mod'));
  assert.ok(!env.pools.arcanes.includes('Primary Deadhead'), 'no Deadhead without headshots');
  assert.ok(envFor({}, { headshot: true }).env.pools.arcanes.includes('Primary Deadhead'));
  assert.ok(!envFor({ modBlacklist: ['Primary Merciless'] }).env.pools.arcanes.includes('Primary Merciless'), 'the blacklist applies to arcanes');
});

test('pools: whitelist, stat blacklist, and the blacklist switch', { skip }, () => {
  const wl = envFor({ modWhitelistEnabled: true, modWhitelist: ['Serration', 'Hellfire', 'Split Chamber', 'Vital Sense'] }).env;
  assert.deepEqual(names(wl.pools.allowed).sort(), ['Hellfire', 'Serration', 'Vital Sense'], 'whitelisted and not blacklisted (Split Chamber is)');
  const both = envFor({ modWhitelistEnabled: true, modBlacklistEnabled: false, modWhitelist: ['Split Chamber'] }).env;
  assert.deepEqual(names(both.pools.allowed), ['Split Chamber']);
  assert.deepEqual(AS.whitelistOverlap(AS.normalizeAutoBuildSettings({ modWhitelistEnabled: true, modWhitelist: ['Split Chamber', 'Serration'] }, real().data)), ['Split Chamber']);
  const noMs = envFor({ statBlacklistEnabled: true, statBlacklist: ['multishot'] }).env;
  for (const m of noMs.pools.allowed) assert.ok(!(m.Stats ?? []).some(st => /FIRE_ITERATIONS|MULTISHOT/.test(st.UpgradeType)), `${m['Local Name']} changes multishot`);
  const off = envFor({ modBlacklistEnabled: false }).env;
  assert.ok(names(off.pools.allowed).includes('Split Chamber'));
  assert.ok(off.blacklist.has('Riven Mod') && off.blacklist.has('Galvanized Scope'), 'the run-time additions stay');
});

test('element targets: the rifle list, innate completion and the elemental blacklist', { skip }, () => {
  const { env } = envFor();
  assert.deepEqual(AB.elementalTargets(env).map(t => t.name), ['No Element', 'Heat', 'Viral', 'Viral Heat', 'Corrosive', 'Corrosive Heat']);
  const noHeat = envFor({ elementalBlacklistEnabled: true, elementalBlacklist: ['Heat'] }).env;
  assert.deepEqual(AB.elementalTargets(noHeat).map(t => t.name), ['No Element', 'Viral', 'Corrosive']);
  const specific = envFor({ specificElementalCandidatesEnabled: true, specificElementalTargets: ['Radiation'] }).env;
  assert.deepEqual(AB.elementalTargets(specific), [{ name: 'Radiation', target: ['Radiation'] }]);
  assert.deepEqual(AB.elementalTargets(envFor({ elementalCandidatesEnabled: false }).env).map(t => t.name), ['No Element']);
  assert.deepEqual(AB.elementSignature(env, [{ name: 'Hellfire', rank: 5 }, { name: 'Infected Clip', rank: 5 }, { name: 'Stormbringer', rank: 5 }, null, null, null, null, null, null]), ['Electricity', 'Gas']);
});

test('Cost Control: capacity with at most N Forma, re-polarising greedily', { skip }, () => {
  const heavy = ['Serration', 'Primed Shred', 'Vital Sense', 'Hellfire', 'Infected Clip', 'Stormbringer', 'Vigilante Armaments', 'Primed Cryo Rounds']
    .map(n => ({ name: n, rank: maxRank(real().ctx.index.byName.get(n)) }));
  const mods = [...heavy, null];
  assert.equal(AB.fitsCapacity(envFor({ maxForma: 0 }, { build: { catalyst: false } }).env, mods), false);
  assert.equal(AB.fitsCapacity(envFor({ maxForma: 10 }).env, mods), true);
  assert.equal(AB.fitsCapacity(envFor({ maxForma: 0 }).env, Array(9).fill(null)), true);
});

test('Cost Control: the plan lists the Forma it needs, and the build\'s own Forma count toward the maximum', { skip }, () => {
  const { ctx } = real();
  const heavy = ['Serration', 'Primed Shred', 'Vital Sense', 'Hellfire', 'Infected Clip', 'Stormbringer', 'Vigilante Armaments', 'Primed Cryo Rounds']
    .map(n => ({ name: n, rank: maxRank(ctx.index.byName.get(n)) }));
  const mods = [...heavy, null];
  const { env, build } = envFor({ maxForma: 10 });
  const plan = AB.capacityPlan(env, mods);
  assert.ok(plan, 'a fit with at most 10 Forma');
  assert.equal(AB.capacityPlan(envFor({ maxForma: 0 }).env, mods), null, 'none without Forma');
  assert.ok(plan.used <= plan.capacity);
  const changes = AB.formaChanges(env, plan);
  assert.equal(changes.length, plan.added);
  assert.ok(changes.length > 0 && changes.length <= 10, `${changes.length} Forma`);
  for (const c of changes) assert.equal(c.to, ctx.index.byName.get(mods[c.slot].name).Polarity.toUpperCase().replace('AP_WAVE', 'AP_WARD'), 'each slot takes its mod\'s polarity');
  // Applied to the build (as Apply does), the result fits.
  const planned = M.withFormaPlan(ctx, { ...build, mods }, changes);
  const cap = M.buildCapacity(ctx, planned);
  assert.equal(cap.over, 0, `${cap.used} of ${cap.capacity}`);
  assert.equal(cap.forma, plan.forma);
  assert.match(M.formaPlanText(changes)[0], /^Slot \d → \w+ \(.\)$/);
  // A build that already has 8 Forma, with a maximum of 5, may not re-polarise any slot (the site counts them).
  const formad = { slotPolarities: ['AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', 'AP_DEFENSE', null] };
  const eight = envFor({ maxForma: 5 }, { build: formad }).env;
  const p8 = AB.capacityPlan(eight, mods);
  assert.ok(p8 === null || p8.added === 0, 'no new Forma beyond the maximum');
  const p10 = AB.capacityPlan(envFor({ maxForma: 10 }, { build: formad }).env, mods);
  assert.ok(p10 === null || p10.added <= 2, 'with 10 allowed, at most 2 more');
});

test('nothing to fill: every slot kept and the arcane kept; conditional mods are named with their stacks', { skip }, () => {
  const { ctx, data } = real();
  const weapon = ctx.weaponByName.get('Braton Prime');
  const mods = [...['Serration', 'Point Strike', 'Vital Sense', 'Hellfire', 'Infected Clip', 'Stormbringer', 'Split Chamber', 'Galvanized Chamber'].map(n => ({ name: n, rank: 5 })), null];
  const all = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(AB.nothingToFill({ mods, arcanes: [{ name: 'Primary Merciless' }] }, weapon, all, true), true);
  assert.equal(AB.nothingToFill({ mods, arcanes: [{ name: 'Primary Merciless' }] }, weapon, all, false), false, 'the arcane may be replaced');
  assert.equal(AB.nothingToFill({ mods, arcanes: [null] }, weapon, all, true), false, 'an empty arcane slot can be filled');
  assert.equal(AB.nothingToFill({ mods, arcanes: [{ name: 'Primary Merciless' }] }, weapon, new Set([0, 1]), true), false);
  assert.deepEqual(AB.conditionalModStacks(data, mods), ['Galvanized Chamber at 5 stacks (On Kill)']);
  const lower = mods.map(m => (m?.name === 'Galvanized Chamber' ? { ...m, stacks: 2 } : m));
  assert.deepEqual(AB.conditionalModStacks(data, [...lower, { name: 'Laser Sight', rank: 3 }]), ['Galvanized Chamber at 2 stacks (On Kill)', 'Laser Sight on (On Headshot)']);
});

// ---------- the search, with a fake scorer ----------

test('an empty Exilus slot gets an Exilus mod only when it scores higher (not on the site)', { skip }, async () => {
  const { env } = envFor({ finalRefinementEnabled: false }, { build: { incarnon: BRATON_PERKS } });
  assert.deepEqual(env.pools.exilus.map(m => m['Local Name']), ['Vile Precision'], 'the only Exilus mod with a counted stat on Braton Prime');
  const start = { mods: Array(9).fill(null), arcanes: [null] };
  // A scorer that rewards every mod: Vile Precision goes in the Exilus slot.
  const rewarded = await AB.runAutoBuild(env, { start, score: fakeScorer() });
  assert.equal(rewarded.mods[8]?.name, 'Vile Precision');
  // Greedy fill may already have put it in a general slot (Exilus mods fit there too): then it is moved over.
  assert.ok(rewarded.log.some(l => /(Added|Moved) Vile Precision to the Exilus slot/.test(l)), rewarded.log.join('\n'));
  assert.equal(rewarded.mods.filter(m => m?.name === 'Vile Precision').length, 1);
  // One that counts Vile Precision as a loss (its fire rate is a penalty): the slot stays empty, and the log says why.
  const real = fakeScorer();
  const penalised = async jobs => (await real(jobs)).map((v, i) => (jobs[i].mods[8] ? v - 5000 : v));
  const kept = await AB.runAutoBuild(env, { start, score: penalised });
  assert.equal(kept.mods[8], null);
  assert.ok(kept.log.some(l => /no Exilus mod adds damage/.test(l)), kept.log.join('\n'));
  // A full build with only the Exilus slot empty still runs, for that slot alone.
  const full = rewarded.mods.map((m, i) => (i === 8 ? null : m));
  const only = await AB.runAutoBuild(env, { start: { mods: full, arcanes: rewarded.arcanes }, score: fakeScorer() });
  assert.deepEqual(only.mods.slice(0, 8), full.slice(0, 8));
  assert.equal(only.mods[8]?.name, 'Vile Precision');
  assert.equal(only.changed, true);
});

test('the search fills empty slots, keeps locks and the Exilus slot, never uses blacklisted mods', { skip }, async () => {
  const exilus = { name: 'Vile Precision', rank: 3 };
  const startMods = [null, { name: 'Point Strike', rank: 3 }, null, null, null, null, null, null, exilus];
  const { env } = envFor({ modBlacklist: [...real().data.blacklist, 'Serration', 'Primed Shred'], finalRefinementSampleSize: 20 }, { build: { mods: startMods } });
  const res = await AB.runAutoBuild(env, { start: { mods: startMods, arcanes: [null] }, score: fakeScorer() });
  assert.equal(res.mods[1].name, 'Point Strike', 'a filled slot is a lock');
  assert.deepEqual(res.mods[8], exilus, 'the Exilus slot is never touched');
  assert.ok(res.mods.slice(0, 8).every(Boolean), 'every empty general slot is filled');
  const used = res.mods.filter(Boolean).map(m => m.name);
  assert.ok(!used.includes('Serration') && !used.includes('Primed Shred'), used.join(', '));
  assert.equal(new Set(used).size, used.length, 'no mod twice');
  for (const m of used) assert.equal(AB.fitsWeapon(real().ctx.index.byName.get(m), env.weapon), true);
  assert.ok(res.arcanes[0], 'an arcane is chosen');
  assert.ok(res.changed);
});

test('the weapon\'s elemental augment is forced in at max rank and kept; kept slots keep their stacks', { skip }, async () => {
  const { env } = envFor({ finalRefinementSampleSize: 10 }, { weaponName: 'AX-52' });
  assert.deepEqual(names(AB.elementalAugments(env)), ['Biotic Rounds']);
  assert.deepEqual(names(AB.elementalAugments(envFor().env)), [], 'Braton Prime has none');
  const res = await AB.runAutoBuild(env, { start: { mods: [{ name: 'Biotic Rounds', rank: 1 }, ...Array(8).fill(null)], arcanes: [null] }, score: fakeScorer() });
  assert.deepEqual(res.mods[0], { name: 'Biotic Rounds', rank: 5 }, 'ranked up to max and kept in its slot');
  const empty = await AB.runAutoBuild(env, { start: { mods: Array(9).fill(null), arcanes: [null] }, score: fakeScorer() });
  assert.equal(empty.mods.filter(m => m?.name === 'Biotic Rounds').length, 1, 'placed in an empty build');
  assert.ok(empty.log.some(l => /Placed the weapon's elemental augment: Biotic Rounds/.test(l)), empty.log.join(' | '));
  // A kept Galvanized mod is scored at its own stacks.
  const seen = [];
  const { env: braton } = envFor({ finalRefinementSampleSize: 10 });
  await AB.runAutoBuild(braton, { start: { mods: [{ name: 'Galvanized Chamber', rank: 10, stacks: 2 }, ...Array(8).fill(null)], arcanes: [null] }, score: async jobs => { seen.push(...jobs.map(j => j.mods[0])); return fakeScorer()(jobs); } });
  assert.ok(seen.length && seen.every(m => m?.stacks === 2), JSON.stringify(seen[0]));
});

test('the search: whitelist only, elemental blacklist, and a filled arcane slot is kept', { skip }, async () => {
  const whitelist = ['Serration', 'Point Strike', 'Vital Sense', 'Hellfire', 'Stormbringer', 'Infected Clip', 'Cryo Rounds'];
  const { env } = envFor({ modBlacklistEnabled: false, modWhitelistEnabled: true, modWhitelist: whitelist, elementalBlacklistEnabled: true, elementalBlacklist: ['Heat'], finalRefinementSampleSize: 10 });
  const arcane = { name: 'Primary Merciless', rank: 3, options: { stacks: 2 } };
  const res = await AB.runAutoBuild(env, { start: { mods: Array(9).fill(null), arcanes: [arcane] }, score: fakeScorer() });
  for (const m of res.mods.filter(Boolean)) assert.ok(whitelist.includes(m.name), `${m.name} is not whitelisted`);
  assert.ok(!AB.elementSignature(env, res.mods).includes('Heat'), `elements ${AB.elementSignature(env, res.mods)}`);
  assert.deepEqual(res.arcanes[0], arcane, 'the arcane was kept as it was');
});

test('the search is deterministic and uses the site\'s run counts', { skip }, async () => {
  const run = async () => {
    const log = [];
    const { env } = envFor({ finalRefinementSampleSize: 200 }, { build: { incarnon: BRATON_PERKS } });
    const res = await AB.runAutoBuild(env, { start: { mods: Array(9).fill(null), arcanes: [null] }, score: fakeScorer(log) });
    return { res, log };
  };
  const a = await run();
  const b = await run();
  assert.deepEqual(a.res.mods, b.res.mods);
  assert.deepEqual(a.res.arcanes, b.res.arcanes);
  assert.deepEqual(a.log, b.log, 'the same evaluations in the same order');
  const lengths = new Set(a.log.flat());
  for (const n of lengths) assert.ok([10, 3, 6, 18, 30, 200].includes(n), `unexpected run count ${n}`);
  for (const n of [10, 6, 30, 200]) assert.ok(lengths.has(n), `no evaluation with ${n} runs`);
  assert.equal(a.res.runs, a.log.reduce((t, batch) => t + batch.reduce((x, y) => x + y, 0), 0));
});

test('cancelling stops the search at its next check and nothing more is scored', { skip }, async () => {
  const { env } = envFor();
  const signal = { aborted: false };
  let calls = 0;
  const score = async jobs => {
    calls++;
    if (calls === 3) signal.aborted = true;
    return fakeScorer()(jobs);
  };
  await assert.rejects(AB.runAutoBuild(env, { start: { mods: Array(9).fill(null), arcanes: [null] }, score, signal }), err => err instanceof AB.AutoBuildCancelled && err.message === 'Operation cancelled by user.');
  assert.equal(calls, 3);
});

test('the time limit ends the search early with the best build found so far', { skip }, async () => {
  const { env } = envFor({}, { build: { incarnon: BRATON_PERKS } });
  let t = 0;
  let calls = 0;
  const score = async jobs => { calls++; t += 1000; return fakeScorer()(jobs); };
  const res = await AB.runAutoBuild(env, { start: { mods: Array(9).fill(null), arcanes: [null] }, score, now: () => t, deadline: 8000 });
  assert.equal(res.stoppedEarly, true);
  assert.ok(calls < 20, `${calls} scoring calls`);
  assert.ok(res.mods.some(Boolean), 'it still returns a build');
});

test('step 9 swaps Heavy Caliber for Serration without simulating', { skip }, () => {
  const { env } = envFor();
  const mods = [{ name: 'Heavy Caliber', rank: 10 }, ...Array(8).fill(null)];
  assert.equal(AB.qualityOfLifeSwaps(env, { mods, arcanes: [null] }, new Set()).mods[0].name, 'Serration');
  assert.equal(AB.qualityOfLifeSwaps(env, { mods, arcanes: [null] }, new Set([0])).mods[0].name, 'Heavy Caliber', 'a kept slot is not touched');
});

test('search modifiers: floor and single shot', () => {
  const m = AB.floorMode({ finalCritChance: 235, finalStatusChance: 99, perProjectileStatusChance: 150, displayStatusChance: 150, finalMultishot: 2.7 });
  assert.deepEqual([m.finalCritChance, m.finalStatusChance, m.perProjectileStatusChance, m.finalMultishot], [200, 0, 100, 2]);
  assert.equal(AB.floorMode({ finalMultishot: 0.5 }).finalMultishot, 1);
  assert.equal(AB.singleShotMode({ finalFireRate: 9 }).finalFireRate, AB.SINGLE_SHOT_FIRE_RATE);
});

test('jobs split into chunks of at most 10 runs and come back as means', () => {
  const jobs = [{ seeds: Array.from({ length: 25 }, (_, i) => i + 1) }, { seeds: [1, 2] }];
  const tasks = AB.chunkJobs(jobs);
  assert.deepEqual(tasks.map(t => [t.job, t.seeds.length]), [[0, 10], [0, 10], [0, 5], [1, 2]]);
  const means = AB.meansOf(2, tasks, [{ sum: 10, count: 10 }, { sum: 30, count: 10 }, { sum: 0, count: 0 }, { sum: 4, count: 2 }]);
  assert.deepEqual(means, [2, 2]);
  assert.ok(Number.isNaN(AB.meansOf(1, [{ job: 0 }], [{ sum: 0, count: 0 }])[0]));
});

// ---------- the pool ----------

test('the pool hands tasks out dynamically, re-caches after a crash, and stops on terminate', async () => {
  const made = [];
  const createClient = ({ onRestart }) => {
    const c = {
      cached: 0, scored: 0, terminated: false, onRestart,
      init: async () => {},
      cacheAppState: async () => { c.cached++; },
      score: async (input, seeds) => {
        c.scored++;
        await new Promise(r => setTimeout(r, made.indexOf(c) === 0 ? 1 : 5));
        return { sum: seeds.length * Number(input), count: seeds.length, errors: 0, error: null };
      },
      terminate: () => { c.terminated = true; },
    };
    made.push(c);
    return c;
  };
  const pool = createEnginePool({ size: 3, createClient, appState: '{}' });
  await pool.ready;
  assert.deepEqual(made.map(c => c.cached), [1, 1, 1]);
  const out = await pool.run(Array.from({ length: 12 }, (_, i) => ({ input: String(i), seeds: [1, 2], metric: 'avgDps' })));
  assert.deepEqual(out.map(r => r.sum), Array.from({ length: 12 }, (_, i) => 2 * i));
  assert.ok(made[0].scored > made[1].scored, 'the faster worker took more tasks');
  made[1].onRestart();
  await pool.run([{ input: '1', seeds: [1] }, { input: '1', seeds: [1] }, { input: '1', seeds: [1] }]);
  assert.equal(made[1].cached, 2, 'a restarted worker caches the app state again');
  pool.terminate();
  assert.ok(made.every(c => c.terminated));
  await assert.rejects(pool.run([{ input: '1', seeds: [1] }]), /Engine stopped/);
  assert.equal(defaultPoolSize(24), 8);
  assert.equal(defaultPoolSize(4), 3);
  assert.equal(defaultPoolSize(1), 1);
});

// ---------- the real engine ----------

function loadWorker() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const wasm = readFileSync(coreDir + 'engine/dps_calculator.wasm');
  const replies = new Map();
  const self = { createDpsModule, postMessage: msg => replies.get(msg.id)?.(msg) };
  const context = vm.createContext({
    self,
    importScripts: () => { throw new Error('importScripts should not be needed'); },
    fetch: async () => ({ ok: true, arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }),
    console,
  });
  vm.runInContext(readFileSync(workerFile, 'utf8'), context, { filename: workerFile });
  let id = 0;
  return msg => new Promise(resolve => {
    const i = ++id;
    replies.set(i, resolve);
    self.onmessage({ data: { ...msg, id: i } });
  });
}

test('the engine worker\'s score request matches simulate, and uses the prepared path', { skip }, async () => {
  const { env, data, build } = envFor();
  const send = loadWorker();
  assert.equal((await send({ type: 'init' })).ok, true);
  assert.equal((await send({ type: 'cacheAppState', ref: 1, appState: buildAppState(data, env.weapon) })).ok, true);
  const cand = { mods: [{ name: 'Serration', rank: 10 }, { name: 'Hellfire', rank: 5 }, ...Array(7).fill(null)], arcanes: [null] };
  const input = AB.candidateInput(env, cand, { maxTime: build.simTime, plain: true });
  const seeds = [1, 2, 3];
  const scored = await send({ type: 'score', input, seeds, metric: 'avgDps' });
  const simulated = await send({ type: 'simulate', input: JSON.parse(input), seeds });
  assert.equal(scored.ok, true);
  assert.equal(scored.count, 3);
  assert.equal(scored.errors, 0);
  const mean = simulated.results.reduce((t, r) => t + r.avgDps, 0) / 3;
  assert.ok(Math.abs(scored.sum / scored.count - mean) <= Math.abs(mean) * 1e-9, `${scored.sum / scored.count} vs ${mean}`);
});

/** The pool interface over one in-process engine (what the worker pool does, without threads). */
async function enginePool(appState) {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  engine.cache_app_state(1, appState);
  let runs = 0;
  return {
    get runs() { return runs; },
    run: async tasks => tasks.map(t => {
      let sum = 0;
      let count = 0;
      for (const seed of t.seeds) {
        engine.seed_rng(seed);
        const r = JSON.parse(engine.calculate_dps_wasm(t.input));
        runs++;
        if (Number.isFinite(r[t.metric])) { sum += r[t.metric]; count++; }
      }
      return { sum, count, errors: t.seeds.length - count, error: null };
    }),
  };
}

test('a short real run on Braton Prime: whitelisted mods only, better than empty, reproducible', { skip }, async () => {
  const { ctx, data } = real();
  const build = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  const settings = {
    sampleSizeMultiplier: 0.2, finalRefinementEnabled: false, modBlacklistEnabled: true,
    modWhitelistEnabled: true, modWhitelist: ['Serration', 'Point Strike', 'Vital Sense', 'Hellfire', 'Stormbringer', 'Infected Clip', 'Cryo Rounds', 'Split Chamber'],
  };
  const once = async () => {
    const pool = await enginePool(JSON.stringify(buildAppState(data, ctx.weaponByName.get('Braton Prime'))));
    const r = await runAutoBuildJob({ ctx, build, start: { mods: build.mods, arcanes: build.arcanes }, settings, pool });
    return { r, runs: pool.runs };
  };
  const { r, runs } = await once();
  const used = r.mods.filter(Boolean).map(m => m.name);
  assert.ok(used.length >= 4, used.join(', '));
  // The Genesis is always installed, so the empty evolutions get perks too.
  assert.deepEqual([2, 3, 4].map(e => Boolean(r.incarnon?.[`evolution_${e}_perk`])), [true, true, true]);
  for (const n of used) assert.ok(settings.modWhitelist.includes(n) && n !== 'Split Chamber', `${n}`);
  assert.ok(r.after > r.before * 3, `${r.before} -> ${r.after}`);
  assert.equal(r.runs + 16, runs, 'the search runs plus 8 + 8 for before and after');
  const again = (await once()).r;
  assert.deepEqual(again.mods, r.mods);
  assert.equal(again.after, r.after);
});

test('a DPS change reads as a signed percentage, or ×N from 3× up', async () => {
  const { gainText } = await import('../src/renderer/auto-build-format.js');
  assert.equal(gainText(100, 112.3), '+12.3%');
  assert.equal(gainText(100, 90), '−10%');
  assert.equal(gainText(507, 84469), '×166.6');
  assert.equal(gainText(0, 10), '');
});
