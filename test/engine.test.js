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

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm');
const skip = hasCore ? false : 'core submodule not checked out';

async function setup() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  return { engine, data, index: indexMods(data) };
}

function simulate({ engine, data, index }, weaponName, modSlots, { appStateRef = null, seed = 7, baseHp = 1000 } = {}) {
  const weapon = data.weapons.find(w => w.name === weaponName);
  const reload = data.reload_data.find(r => r.name === weapon.name) ?? null;
  const enemy = { ...scaleEnemy({ base_hp: baseHp, base_armor: 0, base_level: 1, faction: 'Corpus' }, { level: 1 }) };
  const { modes } = computeWeaponStats(weapon, modSlots, { modsByName: index.byName, reload, targetFaction: enemy.faction });
  const input = buildEngineInput({
    weapon, modSlots, weaponStats: modes, enemy, modeName: selectableModes(weapon)[0].mode_name, maxTime: 20, reload,
    appStateRef, appState: appStateRef == null ? buildAppState(data, weapon) : undefined,
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
  // 35 base (1.75 impact, 12.25 puncture, 21 slash); Corpus take +50% puncture
  assert.equal(r.firstHitDamage, 35 + 12.25 * 0.5);
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
