// Runs real builds through the Underframe engine. Skips when the private core submodule is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indexMods, isModCompatible, isSupportedWeapon } from '../src/shared/mods.js';
import { computeWeaponStats, selectableModes } from '../src/shared/stats.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import { scaleEnemy } from '../src/shared/enemy.js';
import { arcanesFor, arcaneSlotCount, resolveArcanes } from '../src/shared/arcanes.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm');
const skip = hasCore ? false : 'core submodule not checked out';

async function setup() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  return { engine, data, index: indexMods(data) };
}

function simulate({ engine, data, index }, weaponName, modSlots, { appStateRef = null, seed = 7, baseHp = 1000, arcanes: equipped = null, headshot = false } = {}) {
  const weapon = data.weapons.find(w => w.name === weaponName);
  const reload = data.reload_data.find(r => r.name === weapon.name) ?? null;
  const enemy = { ...scaleEnemy({ base_hp: baseHp, base_armor: 0, base_level: 1, faction: 'Corpus' }, { level: 1 }), headshot };
  const arcanes = equipped ? resolveArcanes(equipped, weapon, data) : null;
  const { modes } = computeWeaponStats(weapon, modSlots, { modsByName: index.byName, reload, targetFaction: enemy.faction, arcanes });
  const input = buildEngineInput({
    weapon, modSlots, weaponStats: modes, enemy, modeName: selectableModes(weapon)[0].mode_name, maxTime: 20, reload,
    appStateRef, appState: appStateRef == null ? buildAppState(data, weapon) : undefined, arcanes,
  });
  engine.seed_rng(seed);
  return JSON.parse(engine.calculate_dps_wasm(JSON.stringify(input)));
}

test('engine exposes the expected API', { skip }, async () => {
  const { engine } = await setup();
  for (const fn of ['calculate_dps_wasm', 'cache_app_state', 'clear_app_state_cache', 'seed_rng']) {
    assert.equal(typeof engine[fn], 'function', fn);
  }
});

test('unmodded hit is base damage plus the Corpus puncture weakness', { skip }, async () => {
  const ctx = await setup();
  const r = simulate(ctx, 'Braton Prime', []);
  assert.equal(r.error, undefined);
  // 35 base (1.75 impact, 12.25 puncture, 21 slash), quantized to steps of 35/32 as the game and underframe.site do
  // (2.1875, 12.03125, 20.78125); Corpus take +50% puncture.
  assert.equal(r.firstHitDamage, 35 + 12.03125 * 0.5);
});

test('mods raise DPS and seeds make runs reproducible', { skip }, async () => {
  const ctx = await setup();
  const build = [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 }, { name: 'Infected Clip', rank: 5 }];
  const base = simulate(ctx, 'Braton Prime', []);
  const modded = simulate(ctx, 'Braton Prime', build);
  assert.ok(modded.avgDps > base.avgDps * 3, `${modded.avgDps} vs ${base.avgDps}`);
  assert.deepEqual(simulate(ctx, 'Braton Prime', build, { seed: 3 }), simulate(ctx, 'Braton Prime', build, { seed: 3 }));
});

test('status effects proc and tick, and magazines reload', { skip }, async () => {
  const ctx = await setup();
  // attenuationStatusCap 0 would silently disable every proc; useAccurateAmmo false would never reload.
  const r = simulate(ctx, 'Braton Prime', [{ name: 'Serration', rank: 10 }, { name: 'Infected Clip', rank: 5 }], { baseHp: 1e6 });
  assert.equal(r.error, undefined);
  const types = new Set(r.debugLog.map(e => e.type));
  assert.ok(types.has('Toxin Tick'), `no toxin ticks in ${[...types]}`);
  assert.ok(types.has('Reloading'), `no reloads in ${[...types]}`);
  assert.ok(r.avgDotPerShot > 0);
});

test('weapons without reload data never reload, so their DPS is not cut', { skip }, async () => {
  const ctx = await setup();
  for (const name of ['Fulmin', 'Lizzie']) {
    assert.equal(ctx.data.reload_data.some(r => r.name === name), false, `${name} gained a reload row; pick another weapon`);
    const r = simulate(ctx, name, [], { baseHp: 1e8 });
    assert.equal(r.error, undefined);
    const reloads = r.debugLog.filter(e => e.type === 'Reloading').length;
    assert.equal(reloads, 0, `${name} reloaded ${reloads} times`);
  }
});

test('cached app state gives the same result as inline app state', { skip }, async () => {
  const ctx = await setup();
  const weapon = ctx.data.weapons.find(w => w.name === 'Braton Prime');
  const ok = JSON.parse(ctx.engine.cache_app_state(1, JSON.stringify(buildAppState(ctx.data, weapon))));
  assert.deepEqual(ok, { ok: true });
  const build = [{ name: 'Serration', rank: 10 }];
  assert.deepEqual(simulate(ctx, 'Braton Prime', build, { appStateRef: 1 }), simulate(ctx, 'Braton Prime', build));
});

test('every supported weapon simulates without throwing', { skip, timeout: 600_000 }, async () => {
  const ctx = await setup();
  const failures = [];
  for (const weapon of ctx.data.weapons.filter(isSupportedWeapon)) {
    const serration = ctx.data.mods.find(m => isModCompatible(m, weapon) && m.Stats?.some(s => s.UpgradeType === 'WEAPON_DAMAGE_AMOUNT'));
    const slots = serration ? [{ name: serration['Local Name'], rank: serration['Fusion Limit'] }] : [];
    try {
      const r = simulate(ctx, weapon.name, slots);
      if (r.error) failures.push(`${weapon.name}: ${r.error}`);
      else if (!(r.avgDps >= 0)) failures.push(`${weapon.name}: avgDps=${r.avgDps}`);
    } catch (e) {
      failures.push(`${weapon.name}: threw ${e?.message ?? e}`);
    }
  }
  assert.deepEqual(failures, []);
});

// ---- Arcanes ----------------------------------------------------------------------------------------------------
const SEEDS = [1, 2, 3, 4];
const meanDps = (ctx, weapon, mods, opts) => {
  const runs = SEEDS.map(seed => simulate(ctx, weapon, mods, { baseHp: 1e6, ...opts, seed }));
  for (const r of runs) assert.equal(r.error, undefined, r.error);
  return runs.reduce((a, r) => a + r.avgDps, 0) / runs.length;
};

test('Primary Merciless at max rank and stacks multiplies damage as expected; rank 0 gives less', { skip }, async () => {
  const ctx = await setup();
  const serration = [{ name: 'Serration', rank: 10 }];
  const base = meanDps(ctx, 'Braton Prime', serration);
  const max = meanDps(ctx, 'Braton Prime', serration, { arcanes: [{ name: 'Primary Merciless', rank: 5, options: { stacks: 12 } }] });
  const r0 = meanDps(ctx, 'Braton Prime', serration, { arcanes: [{ name: 'Primary Merciless', rank: 0, options: { stacks: 12 } }] });
  // +360% damage beside Serration's +165%: hits x (1 + 1.65 + 3.6) / 2.65 = 2.36, plus +30% reload speed and stronger slash ticks.
  const ratio = max / base;
  assert.ok(ratio > 2.2 && ratio < 2.8, `max-rank Merciless ratio ${ratio.toFixed(3)} (${max.toFixed(0)} vs ${base.toFixed(0)})`);
  assert.ok(r0 > base * 1.1 && r0 < max * 0.7, `rank 0 ${r0.toFixed(0)} between ${base.toFixed(0)} and ${max.toFixed(0)}`);
});

test('the cached app state path carries arcane conditionalStats too', { skip }, async () => {
  const ctx = await setup();
  const weapon = ctx.data.weapons.find(w => w.name === 'Braton Prime');
  assert.deepEqual(JSON.parse(ctx.engine.cache_app_state(11, JSON.stringify(buildAppState(ctx.data, weapon)))), { ok: true });
  const opts = { baseHp: 1e6, arcanes: [{ name: 'Primary Merciless', rank: 5 }] };
  const build = [{ name: 'Serration', rank: 10 }];
  assert.deepEqual(simulate(ctx, 'Braton Prime', build, { ...opts, appStateRef: 11 }), simulate(ctx, 'Braton Prime', build, opts));
});

test('Secondary Merciless, Secondary Encumber and Primary Frostbite simulate on fitting weapons', { skip }, async () => {
  const ctx = await setup();
  const pistol = [{ name: 'Hornet Strike', rank: 10 }, { name: 'Pistol Pestilence', rank: 5 }];
  const lex = meanDps(ctx, 'Lex Prime', pistol);
  const merciless = meanDps(ctx, 'Lex Prime', pistol, { arcanes: [{ name: 'Secondary Merciless', rank: 5 }] });
  assert.ok(merciless > lex * 1.5, `Secondary Merciless ${merciless.toFixed(0)} vs ${lex.toFixed(0)}`);
  const encumber = simulate(ctx, 'Lex Prime', pistol, { baseHp: 1e6, arcanes: [{ name: 'Secondary Encumber', rank: 5 }] });
  assert.equal(encumber.error, undefined);
  const procTypes = r => new Set(r.debugLog.filter(e => /Tick$/.test(e.type)).map(e => e.type));
  assert.ok(procTypes(encumber).size >= procTypes(simulate(ctx, 'Lex Prime', pistol, { baseHp: 1e6 })).size, 'Encumber adds random statuses');
  const cold = [{ name: 'Serration', rank: 10 }, { name: 'Cryo Rounds', rank: 5 }];
  const braton = meanDps(ctx, 'Braton Prime', cold);
  const frostbite = meanDps(ctx, 'Braton Prime', cold, { arcanes: [{ name: 'Primary Frostbite', rank: 5 }] });
  assert.ok(frostbite > braton * 1.3, `Frostbite with Cold ${frostbite.toFixed(0)} vs ${braton.toFixed(0)}`);
  // Without Cold damage its stacks never build.
  const noCold = [{ name: 'Serration', rank: 10 }];
  assert.equal(meanDps(ctx, 'Braton Prime', noCold, { arcanes: [{ name: 'Primary Frostbite', rank: 5 }] }), meanDps(ctx, 'Braton Prime', noCold));
});

test('Deadhead\'s headshot bonus (by name at max rank, as a scaled bonus below it) grows with rank', { skip }, async () => {
  const ctx = await setup();
  const build = [{ name: 'Serration', rank: 10 }];
  const at = rank => meanDps(ctx, 'Braton Prime', build, { headshot: true, arcanes: [{ name: 'Primary Deadhead', rank, options: { stacks: 0 } }] });
  const none = meanDps(ctx, 'Braton Prime', build, { headshot: true });
  const r5 = at(5);
  const r0 = at(0);
  assert.ok(r5 > none * 1.2, `rank 5 ${r5.toFixed(0)} vs ${none.toFixed(0)}`);
  assert.ok(r0 > none && r0 < r5, `rank 0 ${r0.toFixed(0)} between ${none.toFixed(0)} and ${r5.toFixed(0)}`);
});

test('every arcane offered for each gun class simulates without an engine error', { skip, timeout: 600_000 }, async () => {
  const ctx = await setup();
  const reps = {
    Rifle: 'Braton Prime', Shotgun: 'Hek', Bow: 'Lenz', Sniper: 'Vectis Prime', Speargun: null,
    Pistol: 'Lex Prime', 'Dual pistols': 'Akstiletto Prime', Thrown: null, Kitgun: 'Catchmoon (Secondary)',
  };
  const bySubtype = sub => ctx.data.weapons.find(w => isSupportedWeapon(w) && w.subtype === sub)?.name;
  reps.Speargun = bySubtype('Speargun');
  reps.Thrown = bySubtype('Thrown');
  const failures = [];
  let count = 0;
  for (const [cls, name] of Object.entries(reps)) {
    const weapon = ctx.data.weapons.find(w => w.name === name);
    assert.ok(weapon, `${cls}: ${name} not in data`);
    const serration = ctx.data.mods.find(m => isModCompatible(m, weapon) && m.Stats?.some(s => s.UpgradeType === 'WEAPON_DAMAGE_AMOUNT'));
    const mods = serration ? [{ name: serration['Local Name'], rank: serration['Fusion Limit'] }] : [];
    for (let slot = 0; slot < arcaneSlotCount(weapon); slot++) {
      for (const a of arcanesFor(weapon, ctx.data, slot)) {
        const arcanes = Array(slot + 1).fill(null);
        arcanes[slot] = { name: a.name, rank: a.maxRank };
        try {
          const r = simulate(ctx, name, mods, { baseHp: 1e5, arcanes, headshot: true });
          count++;
          if (r.error) failures.push(`${cls} ${name} + ${a.name}: ${r.error}`);
          else if (!(r.avgDps >= 0)) failures.push(`${cls} ${name} + ${a.name}: avgDps=${r.avgDps}`);
        } catch (e) {
          failures.push(`${cls} ${name} + ${a.name}: threw ${e?.message ?? e}`);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(count > 60, `only ${count} arcane runs`);
});
