// Riven mods (src/shared/rivens.js, docs/port-rivens.md): weapon fit, value scaling, ranges, display, validation, the
// modifier buckets and the engine copy, capacity, the saved-build and library stores, the build model and featured
// builds; and, with the private core checked out, the engine parity case of docs/port-rivens.md 10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/shared/rivens.js';
import { indexMods } from '../src/shared/mods.js';
import { collectModifiers, computeWeaponStats, selectableModes } from '../src/shared/stats.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import { capacityUse } from '../src/shared/capacity.js';
import { scaleEnemy } from '../src/shared/enemy.js';
import { normalizeBuild as storeNormalizeBuild, createBuildsStore } from '../src/main/builds-store.js';
import { cleanRiven, cleanRivenLibrary, createRivensStore } from '../src/main/rivens-store.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasData = existsSync(coreDir + 'data/data.json');
const hasEngine = existsSync(coreDir + 'engine/dps_calculator.wasm');
const skip = hasData ? false : 'core submodule not checked out';
const skipEngine = hasEngine && hasData ? false : 'core submodule not checked out';

let cached = null;
function data() {
  cached ??= JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  return cached;
}
const weapon = name => data().weapons.find(w => w.name === name);
/** a ≈ b; the third argument is a tolerance (a number, default 1e-6) or a message. */
const close = (a, b, eps = 1e-6) => {
  const tol = typeof eps === 'number' ? eps : 1e-6;
  assert.ok(Math.abs(a - b) < tol, `${typeof eps === 'string' ? `${eps}: ` : ''}${a} vs ${b}`);
};

/** A Braton riven as stored: rolls before disposition and rank. */
const braton = (over = {}) => ({
  isRiven: true, id: 'riven_1', name: 'Braton Riven Mod', family: 'Braton', disposition: 1.2, rank: 8,
  stats: [
    { name: 'Critical Chance', value: 1.856, unit: '%' },
    { name: 'Multishot', value: 1.114, unit: '%' },
    { name: 'Zoom', value: -0.297, unit: '%' },
  ],
  ...over,
});

// ---------- weapons ----------

test('riven type: rifles, shotguns, pistols and kitgun primaries; none for exalted guns and Sirocco', { skip }, () => {
  assert.equal(R.rivenTypeOf(weapon('Braton Prime')), 'Rifle');
  assert.equal(R.rivenTypeOf(weapon('Kuva Sobek')), 'Shotgun');
  assert.equal(R.rivenTypeOf(weapon('Lex Prime')), 'Pistol');
  assert.equal(R.rivenTypeOf(weapon('Catchmoon (Primary)')), 'Pistol', 'a kitgun primary takes pistol rivens');
  for (const name of ['Artemis Bow', 'Balefire Charger', 'Sirocco']) assert.equal(R.rivenTypeOf(weapon(name)), null, name);
  assert.equal(R.canTakeRiven(null), false);
});

test('riven family: variants share one, with the Dex Furis exception', () => {
  assert.equal(R.rivenFamily('Kuva Sobek'), 'Sobek');
  assert.equal(R.rivenFamily('MK1-Braton'), 'Braton');
  assert.equal(R.rivenFamily('Braton Prime'), 'Braton');
  assert.equal(R.rivenFamily('Dex Furis'), 'Afuris');
  assert.equal(R.rivenFitsWeapon(braton(), { name: 'Braton Prime', type: 'Primary', subtype: 'Rifle' }), true);
  assert.equal(R.rivenFitsWeapon(braton(), { name: 'Lex Prime', type: 'Secondary', subtype: 'Pistol' }), false);
});

// ---------- scaling and ranges ----------

test('value scaling: disposition x (rank + 1) / 9; 1.2 and rank 8 when missing', () => {
  assert.equal(R.rankMultiplier(8), 1);
  close(R.rankMultiplier(0), 1 / 9);
  const stat = { name: 'Critical Chance', value: 1 };
  close(R.effectiveValue(stat, braton()), 1.2);
  close(R.effectiveValue(stat, { isRiven: true }), 1.2, 'no disposition or rank: x1.2');
  close(R.effectiveValue(stat, braton({ disposition: 0.5, rank: 0 })), 0.5 / 9);
  close(R.effectiveValue(stat, braton({ rank: 11, disposition: -1 })), 1.2, 'invalid values fall back');
  close(R.toStored(R.effectiveValue(stat, braton({ disposition: 0.85, rank: 3 })), braton({ disposition: 0.85, rank: 3 })), 1);
});

test('stat ranges: the worked numbers of docs/port-rivens.md 2.3', { skip }, () => {
  const cat = new Map(R.rivenStatCatalogue(data(), weapon('Braton Prime')).map(e => [e.key, e]));
  const cc = R.statRange(cat.get('Critical Chance'), { positives: 2, negatives: 1 });
  close(cc.min, 2.00462, 1e-4);
  close(cc.max, 2.45009, 1e-4);
  const zoom = R.statRange(cat.get('Zoom'), { positive: false, positives: 2, negatives: 1 });
  close(zoom.min, -0.39197, 1e-4);
  close(zoom.max, -0.32070, 1e-4);
  close(R.statRange(cat.get('Damage vs.Grineer'), { positives: 3, negatives: 1 }).mid, 0.50625);
  close(R.statRange(cat.get('Critical Chance'), { positives: 3, negatives: 1 }).min, 1.51867, 1e-4);
  assert.equal(R.statRange(cat.get('Critical Chance'), { positives: 1, negatives: 0 }), null);
  assert.equal(R.statRange(cat.get('Critical Chance'), { positives: 4, negatives: 0 }), null);
  // The catalogue: labels, units, spliced and negative rules.
  assert.equal(cat.get('BaseDamage').label, 'Damage');
  assert.deepEqual([cat.get('Punch Through').unit, cat.get('Punch Through').base], ['m', 2.7]);
  assert.equal(cat.get('Status Damage').spliced, true);
  assert.equal(cat.get('ToxinDamage').negativeAllowed, false);
  assert.equal(cat.get('Zoom').negativeAllowed, true);
  assert.equal(R.rivenStatCatalogue(data(), weapon('Sirocco')).length, 0);
});

test('display: percent, multiplier, negated recoil, metres; labels', () => {
  const r = braton();
  assert.equal(R.rivenStatText({ name: 'Critical Chance', value: 1.85617 }, r), '+222.7% Critical Chance');
  assert.equal(R.rivenStatText({ name: 'Damage vs.Grineer', value: 0.425 }, r), '×1.51 Damage vs. Grineer');
  assert.equal(R.rivenStatText({ name: 'Recoil', value: 0.2967 }, r), '−35.6% Recoil', 'a positive recoil roll reads as less recoil');
  assert.equal(R.rivenStatText({ name: 'Punch Through', value: 3.34, unit: 'm' }, r), '+4.0 m Punch Through');
  assert.equal(R.rivenStatText({ name: 'BaseDamage', value: 1 }, r), '+120.0% Damage');
  assert.equal(R.rivenStatLabel('ToxinDamage'), 'Toxin Damage');
  assert.equal(R.rivenSummary(r), 'Cri+, Mul+, Zoo−');
  // Typed values (as the game shows them) back to effective values.
  close(R.fromDisplayNumber('Critical Chance', '%', 222.7), 2.227);
  close(R.fromDisplayNumber('Damage vs.Grineer', '%', 1.51), 0.51);
  close(R.fromDisplayNumber('Recoil', '%', -35.6), 0.356);
  close(R.fromDisplayNumber('Punch Through', 'm', 4), 4);
});

// ---------- validation ----------

test('validation: the site rules and messages', { skip }, () => {
  const w = weapon('Braton Prime');
  const check = over => R.validateRiven(braton(over), { data: data(), weapon: w });
  const messages = over => check(over).errors.map(e => e.message);
  assert.equal(check({}).ok, true);
  assert.deepEqual(messages({ disposition: 0 }), [R.RIVEN_MESSAGES.disposition]);
  assert.deepEqual(messages({ rank: 9 }), [R.RIVEN_MESSAGES.rank]);
  assert.deepEqual(messages({ rank: 2.5 }), [R.RIVEN_MESSAGES.rank]);
  const s = (name, value) => ({ name, value, unit: '%' });
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Zoom', -0.3)] }).includes(R.RIVEN_MESSAGES.fewPositive));
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Critical Chance', 1)] }).includes(R.RIVEN_MESSAGES.unique));
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), s('Status Damage', 1), s('Weak Point Damage', 1)] }).includes(R.RIVEN_MESSAGES.spliced), 'two spliced stats');
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), s('Status Damage', -0.5)] }).includes(R.RIVEN_MESSAGES.spliced), 'a negative spliced stat');
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), s('Zoom', -0.3), s('Recoil', -0.3)] }).includes(R.RIVEN_MESSAGES.manyNegative));
  assert.ok(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), s('BaseDamage', 1), s('Status Chance', 1)] }).includes(R.RIVEN_MESSAGES.manyPositive));
  assert.deepEqual(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), s('ToxinDamage', -0.3)] }), ['Toxin Damage can\'t be a negative stat.']);
  assert.deepEqual(messages({ stats: [s('Critical Chance', 1), s('Multishot', 1), { name: 'Punch Through', value: -1, unit: 'm' }] }), ['Punch Through can\'t be a negative stat.']);
  assert.deepEqual(messages({ stats: [s('Critical Chance', 1), s('Melee Damage', 1)] }), ['Melee Damage is not a riven stat for Braton Prime.']);
});

test('normalizeRiven: defaults written, junk dropped, units fixed by stat', () => {
  const r = R.normalizeRiven({ isRiven: true, family: 'Braton', extra: 1, rank: 'x', stats: [{ name: 'Punch Through', value: '2', unit: '%' }, { name: 'Zoom', value: 'n/a' }, 5] });
  assert.deepEqual(r, { isRiven: true, id: '', name: 'Braton Riven Mod', family: 'Braton', disposition: 1.2, rank: 8, stats: [{ name: 'Punch Through', value: 2, unit: 'm' }] });
  assert.equal(R.normalizeRiven({ name: 'Serration' }), null, 'not a riven');
  assert.equal(R.normalizeRiven({ isRiven: true }), null, 'no family');
  // The main process cleaner follows the same rules.
  assert.deepEqual(cleanRiven({ isRiven: true, family: 'Braton', extra: 1, rank: 'x', stats: [{ name: 'Punch Through', value: '2', unit: '%' }, { name: 'Zoom', value: 'n/a' }, 5] }), r);
  assert.deepEqual(cleanRiven(braton()), R.normalizeRiven(braton()));
});

// ---------- the simulation ----------

test('modifiers: each stat to its bucket at its effective value', () => {
  const s = (name, value, unit = '%') => ({ name, value, unit });
  const riven = braton({
    stats: [
      s('BaseDamage', 1), s('Critical Damage', 0.5), s('Fire Rate/Attack Speed', 0.25), s('Status Chance', 0.5), s('Status Duration', 0.5),
      s('ImpactDamage', 1), s('Magazine Capacity', 0.5), s('Reload Speed', 0.5), s('Punch Through', 2, 'm'), s('Weak Point Damage', 1),
      s('Ammo Efficiency', 0.25), s('Projectile Speed', 0.5),
    ],
  });
  const m = collectModifiers([riven], new Map(), 'Grineer');
  close(m.damage, 1.2);
  close(m.critDamage, 0.6);
  close(m.fireRate, 0.3);
  close(m.statusChance, 0.6);
  close(m.statusDuration, 0.6);
  close(m.physical.Impact, 1.2);
  close(m.magazine, 0.6);
  close(m.reload, 0.6);
  close(m.punchThrough, 2.4);
  close(m.weakPointDamage, 1.2);
  close(m.ammoEfficiency, 0.3);
  close(m.projectileSpeed, 0.6);
  const cc = collectModifiers([braton()], new Map(), 'Grineer');
  close(cc.critChance, 1.856 * 1.2);
  close(cc.multishot, 1.114 * 1.2);
  assert.deepEqual(cc.unhandled, ['Braton Riven Mod: Zoom'], 'Zoom is reported, not simulated');
});

test('modifiers: Damage vs. counts only against its own faction; Status Damage, Zoom and Recoil fill no bucket', () => {
  const riven = braton({ stats: [{ name: 'Damage vs.Grineer', value: 0.4 }, { name: 'Status Damage', value: 1 }, { name: 'Recoil', value: 0.3 }, { name: 'Zoom', value: -0.2 }] });
  close(collectModifiers([riven], new Map(), 'Kuva Grineer').factionDamage, 0.48);
  assert.equal(collectModifiers([riven], new Map(), 'Corpus').factionDamage, 0);
  assert.equal(collectModifiers([riven], new Map(), 'Narmer').factionDamage, 0);
  close(collectModifiers([braton({ stats: [{ name: 'Damage vs.Techrot', value: 0.4 }] })], new Map(), 'Techrot').factionDamage, 0.48, 'Techrot rivens count, unlike Bane mods');
  const m = collectModifiers([riven], new Map(), 'Corpus');
  assert.equal(m.statusDamage, 0, 'the engine applies Status Damage from build.mods');
  for (const k of ['damage', 'critChance', 'multishot', 'fireRate', 'statusChance', 'magazine']) assert.equal(m[k], 0, k);
  assert.deepEqual(m.unhandled, ['Braton Riven Mod: Zoom', 'Braton Riven Mod: Recoil']);
});

test('modifiers: elements in reverse stat order, at the riven\'s slot position', () => {
  const heatToxin = braton({ stats: [{ name: 'ToxinDamage', value: 0.5 }, { name: 'HeatDamage', value: 0.5 }] });
  assert.deepEqual(collectModifiers([heatToxin], new Map(), null).elements.map(([t]) => t), ['Heat', 'Toxin']);
  const infectedClip = { 'Local Name': 'Infected Clip', Stats: [{ UpgradeType: 'WEAPON_PERCENT_BASE_DAMAGE_ADDED', DamageType: 'DT_POISON', Value: 0.15 }] };
  const mods = new Map([['Infected Clip', infectedClip]]);
  const heat = braton({ stats: [{ name: 'HeatDamage', value: 0.5 }] });
  assert.deepEqual(collectModifiers([heat, { name: 'Infected Clip', rank: 5 }], mods, null).elements.map(([t]) => t), ['Heat', 'Toxin']);
  assert.deepEqual(collectModifiers([{ name: 'Infected Clip', rank: 5 }, heat], mods, null).elements.map(([t]) => t), ['Toxin', 'Heat']);
});

test('the engine copy: values scaled, isRiven kept, the input untouched', () => {
  const r = braton({ disposition: 0.9, rank: 5 });
  const before = JSON.stringify(r);
  const e = R.rivenForEngine(r);
  assert.equal(e.isRiven, true);
  close(e.stats[0].value, 1.856 * 0.9 * 6 / 9);
  assert.equal(JSON.stringify(r), before);
  const input = buildEngineInput({
    weapon: { name: 'Braton Prime', type: 'Primary', fire_modes: [] }, modSlots: [{ name: 'Serration', rank: 10 }, null, r],
    weaponStats: [], enemy: { faction: 'Grineer', hp: 1, armor: 0, shields: 0, overguard: 0 }, modeName: 'x', maxTime: 1, appStateRef: 1,
  });
  assert.deepEqual(input.build.mods[0], { name: 'Serration', rank: 10 });
  assert.deepEqual(input.build.mods[1], e);
});

test('capacity: drain 10 + rank, Omni (halved in any polarised slot but Umbra)', () => {
  const at = (rank, pol) => capacityUse([braton({ rank })], [pol], () => null).perSlot[0].drain;
  assert.equal(at(8, 'AP_ATTACK'), 9);
  assert.equal(at(8, null), 18);
  assert.equal(at(8, 'AP_UMBRA'), 18);
  assert.equal(at(0, 'AP_TACTIC'), 5);
});

test('polarity: a riven with one drains as a mod of it; kept by every cleaner, junk dropped', () => {
  const vaz = braton({ polarity: 'AP_DEFENSE' });
  const at = (r, pol) => capacityUse([r], [pol], () => null).perSlot[0];
  assert.equal(at(vaz, 'AP_DEFENSE').drain, 9);
  assert.equal(at(vaz, 'AP_ATTACK').drain, 23);
  assert.equal(at(vaz, null).drain, 18);
  assert.equal(R.rivenPolarity({ polarity: 'naramon' }), 'AP_TACTIC');
  assert.equal(R.rivenPolarity({ polarity: 'AP_UMBRA' }), null);
  assert.equal(R.normalizeRiven(vaz).polarity, 'AP_DEFENSE');
  assert.equal('polarity' in R.normalizeRiven(braton({ polarity: 'nope' })), false);
  assert.equal(cleanRiven(vaz).polarity, 'AP_DEFENSE');
  assert.equal('polarity' in cleanRiven(braton({ polarity: 'AP_UMBRA' })), false);
  assert.equal(R.sameRivenContent(vaz, braton()), false);
  const lib = R.parseRivenLibraryFile(R.rivenLibraryFileText({ version: 1, rivens: [{ ...vaz, id: 'riven_1' }] }));
  assert.equal(lib.rivens[0].polarity, 'AP_DEFENSE');
});

// ---------- storage ----------

test('saved builds: a riven slot round-trips; junk dropped, out-of-range rank becomes 8', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uf-rivens-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createBuildsStore(dir, { randomUUID: () => 'b1', now: () => new Date('2026-01-01T00:00:00Z') });
  const riven = braton();
  const saved = await store.save({ name: 'R', weaponName: 'Braton Prime', mods: [{ name: 'Serration', rank: 10 }, riven], enemy: {} });
  assert.deepEqual(saved.mods[1], riven);
  const again = createBuildsStore(dir);
  assert.deepEqual((await again.list())[0].mods[1], riven, 'read back from disk');
  const junk = storeNormalizeBuild({ weaponName: 'Braton Prime', mods: [{ ...riven, rank: 12, extra: 'x', stats: [...riven.stats, { name: 'Bad', value: 'x' }] }] });
  assert.deepEqual(junk.mods[0], riven);
});

test('riven library: clean on read, ids unique, written atomically', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uf-rivens-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createRivensStore(dir);
  assert.deepEqual(await store.get(), { version: 1, rivens: [] });
  const stored = await store.set({ rivens: [braton(), braton(), braton({ id: '' }), { name: 'Serration' }, braton({ id: 'riven_2', rank: 3 })] });
  assert.deepEqual(stored.rivens.map(r => [r.id, r.rank]), [['riven_1', 8], ['riven_2', 3]]);
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), stored);
  assert.deepEqual(cleanRivenLibrary(stored), R.normalizeRivenLibrary(stored), 'the renderer reads it the same way');
  const lib = R.upsertLibraryRiven(stored, braton({ rank: 5 }));
  assert.deepEqual(lib.rivens.map(r => [r.id, r.rank]), [['riven_1', 5], ['riven_2', 3]], 'replaced by id');
  assert.deepEqual(R.removeLibraryRiven(lib, 'riven_1').rivens.map(r => r.id), ['riven_2']);
  assert.equal(R.libraryRivensFor(lib, { name: 'Braton Prime', type: 'Primary', subtype: 'Rifle' }).length, 2);
  assert.equal(R.libraryRivensFor(lib, { name: 'Lex', type: 'Secondary', subtype: 'Pistol' }).length, 0);
});

// ---------- the build model ----------

let model = null;
async function modelCtx() {
  if (!model) {
    const M = await import('../src/renderer/model.js');
    model = { M, ctx: M.createContext(data()) };
  }
  return model;
}

test('model: a matching riven is kept; wrong family, a second riven and the Exilus slot are dropped', { skip }, async () => {
  const { M, ctx } = await modelCtx();
  const ok = M.normalizeBuild(ctx, { weaponName: 'Braton Prime', mods: [braton(), { name: 'Serration', rank: 10 }] });
  assert.deepEqual(ok.build.mods[0], braton());
  assert.deepEqual(ok.warnings, []);
  const lex = M.normalizeBuild(ctx, { weaponName: 'Lex Prime', mods: [braton()] });
  assert.equal(lex.build.mods[0], null);
  assert.match(lex.warnings[0], /Braton Riven Mod \(does not fit Lex Prime\)/);
  const two = M.normalizeBuild(ctx, { weaponName: 'Braton Prime', mods: [braton(), braton({ id: 'riven_2' })] });
  assert.equal(two.build.mods[1], null);
  assert.match(two.warnings[0], /only one riven per build/);
  const exilus = M.normalizeBuild(ctx, { weaponName: 'Braton Prime', mods: [null, null, null, null, null, null, null, null, braton()] });
  assert.equal(exilus.build.mods[8], null);
  const invalid = M.normalizeBuild(ctx, { weaponName: 'Braton Prime', mods: [braton({ stats: [{ name: 'Zoom', value: -0.3, unit: '%' }] })] });
  assert.match(invalid.warnings[0], /invalid riven/);
});

test('model: weapon switches keep a riven across variants only; swaps never reach the Exilus slot', { skip }, async () => {
  const { M, ctx } = await modelCtx();
  const b = M.createBuild(ctx, { weaponName: 'Braton', mods: [braton(), null, null, null, null, null, null, null, null] });
  assert.deepEqual(M.changeWeapon(ctx, b, 'Braton Prime').build.mods[0], braton());
  const lex = M.changeWeapon(ctx, b, 'Lex Prime');
  assert.equal(lex.build.mods[0], null);
  assert.deepEqual(lex.removed, ['Braton Riven Mod']);
  assert.equal(M.swapSlots(ctx, b, 0, M.EXILUS_SLOT), b);
  assert.notEqual(M.swapSlots(ctx, b, 0, 3), b);
  // Capacity counts it, and an edit is a content change (undo, unsaved changes).
  assert.equal(M.buildCapacity(ctx, b).perSlot[0].drain, 18);
  assert.notEqual(M.snapshotOf(b), M.snapshotOf(M.setSlot(b, 0, braton({ rank: 7 }))));
});

test('model: pins report a new and an edited riven', { skip }, async () => {
  const { M, ctx } = await modelCtx();
  const summary = { avgDps: 1, ttk: null, maxTime: 30, runs: 1, killedRuns: 0, ok: true };
  const b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  const p0 = M.makePin(b, summary, 'a');
  const p1 = M.makePin(M.setSlot(b, 0, braton()), summary, 'b');
  const p2 = M.makePin(M.setSlot(b, 0, braton({ stats: [...braton().stats.slice(0, 2), { name: 'Recoil', value: -0.3, unit: '%' }] })), summary, 'c');
  const p3 = M.makePin(M.setSlot(b, 0, braton({ rank: 5 })), summary, 'd');
  assert.deepEqual(M.pinChanges(p1, p0), ['+Braton Riven Mod R8']);
  assert.deepEqual(M.pinChanges(p2, p1), ['Braton Riven Mod edited']);
  assert.deepEqual(M.pinChanges(p3, p1), ['Braton Riven Mod R8→R5']);
  assert.equal(M.samePin(p1, M.makePin(M.setSlot(b, 0, braton()), summary, 'e')), true);
});

test('featured builds: a gun build\'s riven is applied and no longer reported as left out', { skip }, async () => {
  const { M, ctx } = await modelCtx();
  const source = { itemName: 'Braton Prime', mods: [{ name: 'Serration', rank: 10 }, { family: 'Braton', id: 'riven_9', isRiven: true, name: 'Braton Riven Mod', stats: braton().stats }] };
  assert.deepEqual(M.unappliedFeatures(source), []);
  const { build, notes } = M.buildFromFeatured(ctx, { name: 'Riven Braton', description: '', source });
  assert.deepEqual(build.mods[1], { ...braton(), id: 'riven_9' }, 'no disposition or rank: 1.2 and 8');
  assert.match(notes[0], /rivens and mod and arcane stacks are/);
  assert.deepEqual(M.unappliedFeatures({ itemName: 'Braton Prime', mods: [{ name: 'Riven Mod', rank: 8 }] }), ['rivens'], 'a riven without its stats is not applied');
  // The site's trusted builds with rivens are all melee: nothing is reported for their rivens either.
  for (const tb of data().trusted_builds.filter(t => t.mods?.some(m => m?.isRiven))) assert.ok(!M.unappliedFeatures(tb).includes('rivens'), tb.name);
});

test('auto build: a kept riven is scored, drained and returned whole', { skip }, async () => {
  const { M, ctx } = await modelCtx();
  const AB = await import('../src/shared/auto-build.js');
  const AS = await import('../src/shared/auto-build-settings.js');
  const riven = braton({ stats: [{ name: 'HeatDamage', value: 0.75, unit: '%' }, { name: 'Multishot', value: 1, unit: '%' }] });
  const build = M.createBuild(ctx, { weaponName: 'Braton Prime', mods: [riven, null, null, null, null, null, null, null, null] });
  const w = ctx.weaponByName.get('Braton Prime');
  const settings = AS.normalizeAutoBuildSettings({ finalRefinementSampleSize: 10 }, ctx.data);
  const env = AB.createAutoBuildEnv({ data: ctx.data, weapon: w, reload: ctx.reloadByName.get(w.name), build, enemy: M.resolveEnemy(ctx, build.enemy), settings, index: ctx.index });
  const seen = [];
  const score = async jobs => {
    seen.push(...jobs.map(j => j.mods[0]));
    return jobs.map(j => j.mods.filter(Boolean).length);
  };
  const res = await AB.runAutoBuild(env, { start: { mods: build.mods, arcanes: [null] }, score });
  assert.ok(seen.length && seen.every(m => m?.isRiven && m.stats.length === 2), 'every candidate carries the riven itself');
  assert.deepEqual(res.mods[0], riven);
  // Its Heat counts in the element plan and its drain (18 unpolarised) in the capacity.
  assert.ok(AB.elementSignature(env, [riven]).includes('Heat'));
  assert.equal(AB.capacityPlan(env, [riven, ...Array(8).fill(null)]).used, 18);
});

// ---------- the engine (docs/port-rivens.md 10) ----------

async function engineSetup() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  return { engine, index: indexMods(data()) };
}

function rivenDps({ engine, index }, modSlots, { stripRivenFromMods = false, statusDamageBonus = 0 } = {}) {
  const w = weapon('Braton Prime');
  const reload = data().reload_data.find(r => r.name === w.name) ?? null;
  const enemy = { ...scaleEnemy({ base_hp: 1e6, base_armor: 0, base_level: 1, faction: 'Grineer' }, { level: 1 }), headshot: false };
  const { modes } = computeWeaponStats(w, modSlots, { modsByName: index.byName, reload, targetFaction: enemy.faction });
  const weaponStats = statusDamageBonus ? modes.map(m => ({ ...m, statusDamageBonus: m.statusDamageBonus + statusDamageBonus })) : modes;
  const input = buildEngineInput({
    weapon: w, modSlots, weaponStats, enemy, modeName: selectableModes(w)[0].mode_name, maxTime: 20, reload, appState: buildAppState(data(), w), debugLog: false,
  });
  if (stripRivenFromMods) input.build.mods = input.build.mods.filter(m => !m.isRiven);
  let sum = 0;
  for (const seed of [11, 12]) {
    engine.seed_rng(seed);
    const r = JSON.parse(engine.calculate_dps_wasm(JSON.stringify(input)));
    assert.equal(r.error, undefined, r.error);
    sum += r.avgDps;
  }
  return sum / 2;
}

test('engine: a riven acts through the buckets and, scaled, through build.mods (the site\'s way)', { skip: skipEngine, timeout: 120_000 }, async () => {
  const env = await engineSetup();
  const mods = [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, null, { name: 'Infected Clip', rank: 5 }];
  const riven = braton({ stats: [{ name: 'Critical Chance', value: 1, unit: '%' }, { name: 'BaseDamage', value: 1, unit: '%' }, { name: 'Damage vs.Grineer', value: 0.3, unit: '%' }, { name: 'Zoom', value: -0.4, unit: '%' }] });
  const withRiven = mods.slice();
  withRiven[2] = riven;
  const none = rivenDps(env, mods);
  const bucketsOnly = rivenDps(env, withRiven, { stripRivenFromMods: true });
  const both = rivenDps(env, withRiven);
  assert.ok(bucketsOnly > none * 1.5, `${bucketsOnly} vs ${none}`);
  assert.ok(both > bucketsOnly * 1.05, `the engine copy adds DoT scaling: ${both} vs ${bucketsOnly}`);
});

test('engine: a Status Damage riven counts once, like the same status damage bonus on the weapon', { skip: skipEngine, timeout: 120_000 }, async () => {
  const env = await engineSetup();
  const mods = [{ name: 'Serration', rank: 10 }, { name: 'Infected Clip', rank: 5 }];
  // 1 / 1.2 stored is 1.0 (+100% status damage) at the default disposition.
  const riven = braton({ stats: [{ name: 'Status Damage', value: 1 / 1.2, unit: '%' }] });
  const viaRiven = rivenDps(env, [...mods, riven]);
  const viaBonus = rivenDps(env, mods, { statusDamageBonus: 1 });
  const plain = rivenDps(env, mods);
  assert.ok(viaRiven > plain * 1.05, `${viaRiven} vs ${plain}`);
  assert.ok(Math.abs(viaRiven - viaBonus) / viaBonus < 0.01, `${viaRiven} vs ${viaBonus}`);
});

// ---------- the dialog's draft (src/renderer/riven-draft.js) ----------

test('dialog draft: typed in-game values become stored rolls; an untouched edit keeps the exact rolls', { skip }, async () => {
  const D = await import('../src/renderer/riven-draft.js');
  const w = weapon('Braton Prime');
  const env = { data: data(), weapon: w, family: 'Braton' };
  const draft = D.draftFrom(null);
  assert.deepEqual([draft.disposition, draft.rank, draft.rows.length], ['1.2', 8, 2]);
  const typed = { ...draft, rows: [{ ...draft.rows[0], stat: 'Critical Chance', text: '222.7' }, { ...draft.rows[1], stat: 'Damage vs.Grineer', text: '×1.51' }, { ...D.emptyRow(false), stat: 'Recoil', text: '+30' }] };
  const issues = D.draftIssues(typed, env);
  assert.equal(issues.ok, true, JSON.stringify([...issues.rows.values(), ...issues.messages]));
  close(issues.riven.stats[0].value, 2.227 / 1.2);
  close(issues.riven.stats[1].value, 0.51 / 1.2);
  close(issues.riven.stats[2].value, -0.3 / 1.2, 'a negative recoil roll shows as more recoil');
  // The usual range for this 2 + 1 riven, and a value outside it is a note, not an error.
  assert.equal(D.rowRange(typed, typed.rows[0], env).text, '+200.5% to +245.0%');
  assert.equal(D.rowRange({ ...typed, rows: [{ ...typed.rows[0], text: '300' }, ...typed.rows.slice(1)] }, { ...typed.rows[0], text: '300' }, env).outside, true);
  // Wrong signs, a missing stat, the site's riven-wide rules.
  const wrong = D.draftIssues({ ...typed, rows: [{ ...typed.rows[0], text: '-10' }, typed.rows[1], { ...typed.rows[2], text: '-30' }] }, env);
  assert.deepEqual([...wrong.rows.values()], ['A positive stat needs a value above 0.', 'A negative Recoil stat shows as a plus value (more recoil).']);
  assert.deepEqual(D.draftIssues({ ...draft, rows: [{ ...draft.rows[0], text: '5' }] }, env).rows.size, 1, 'text without a stat');
  assert.deepEqual(D.draftIssues({ ...typed, disposition: '0' }, env).disposition, R.RIVEN_MESSAGES.disposition);
  assert.deepEqual(D.draftIssues({ ...typed, rows: typed.rows.slice(1) }, env).messages, [R.RIVEN_MESSAGES.fewPositive]);
  assert.equal(D.canAddRow(typed, false), false);
  assert.equal(D.canAddRow(typed, true), true);
  // Editing a saved riven without changes gives back its exact rolls; a new disposition keeps the typed values.
  const again = D.draftFrom(braton());
  assert.deepEqual(D.draftIssues(again, env).riven.stats, braton().stats);
  const lower = D.draftIssues({ ...again, disposition: '0.6' }, env).riven;
  close(R.effectiveValue(lower.stats[0], lower), R.effectiveValue(braton().stats[0], braton()), 1e-4);
  assert.equal(D.parseTyped('−35,6 %'), -35.6);
  assert.ok(Number.isNaN(D.parseTyped('abc')));
});

test('library files: ours and the site\'s export read back; merge skips copies, renames taken ids; override replaces', async () => {
  const RV = await import('../src/shared/rivens.js');
  const a = { isRiven: true, id: 'riven_1', family: 'Braton', disposition: 1.2, rank: 8, stats: [{ name: 'Critical Chance', value: 1, unit: '%' }, { name: 'Multishot', value: 0.5, unit: '%' }] };
  const b = { ...a, id: 'riven_2', stats: [{ name: 'BaseDamage', value: 1, unit: '%' }, { name: 'Multishot', value: 0.5, unit: '%' }] };
  const lib = RV.normalizeRivenLibrary({ rivens: [a] });
  const text = RV.rivenLibraryFileText(lib);
  assert.deepEqual(RV.parseRivenLibraryFile(text).rivens, lib.rivens);
  const site = JSON.stringify({ builds: [], rivens: [b, { ...a, id: '' }, { nope: true }] });
  let n = 0;
  const read = RV.parseRivenLibraryFile(site, { newId: () => `new${++n}` });
  assert.equal(read.rivens.length, 2);
  assert.equal(read.dropped, 1);
  assert.equal(read.rivens[1].id, 'new1');
  assert.throws(() => RV.parseRivenLibraryFile('{}'), /no rivens list/);
  assert.throws(() => RV.parseRivenLibraryFile('nope'), /isn't JSON/);
  const merged = RV.importRivensInto(lib, [a, { ...b, id: 'riven_1' }], 'merge', { newId: () => 'fresh' });
  assert.equal(merged.added, 1);
  assert.equal(merged.skipped, 1);
  assert.deepEqual(merged.library.rivens.map(r => r.id), ['riven_1', 'fresh']);
  const over = RV.importRivensInto(lib, [b], 'override');
  assert.deepEqual(over.library.rivens.map(r => r.id), ['riven_2']);
});
