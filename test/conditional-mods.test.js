// Conditional mods (src/shared/conditional-mods.js): Galvanized stacks, Condition Overload, the weapon augments'
// special rules, the stored shape and featured builds. Real data and the real engine; skipped without the core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as C from '../src/shared/conditional-mods.js';
import * as X from '../src/shared/external-buffs.js';
import { computeWeaponStats } from '../src/shared/stats.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import { normalizeBuild as storeNormalize } from '../src/main/builds-store.js';
import * as M from '../src/renderer/model.js';
import { buildStats, engineInputFor } from '../src/renderer/sim.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';
const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, ctx: M.createContext(data) };
  }
  return cached;
}
let engineP = null;
function engine() {
  if (!engineP) {
    const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
    engineP = createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  }
  return engineP;
}
const slots = list => [...list.map(([name, rank, stacks]) => ({ name, rank, ...(stacks != null ? { stacks } : {}) })), ...Array(9 - list.length).fill(null)];
const buildOf = (weaponName, list, extra = {}) => ({ ...M.createBuild(real().ctx, { weaponName }), mods: slots(list), ...extra });
const modeOf = (build, name = null) => {
  const s = buildStats(real().ctx, build);
  return name ? s.modes.find(m => m.mode_name === name) : s.mode;
};

async function dps(build) {
  const e = await engine();
  const { ctx, data } = real();
  const input = engineInputFor(ctx, build, { appStateRef: null });
  input.appState = { ...buildAppState(data, ctx.weaponByName.get(build.weaponName), { externalStatuses: build.externalStatuses }), ...(input.appState?.conditionalStats ? { conditionalStats: input.appState.conditionalStats } : {}) };
  const json = JSON.stringify(input);
  let sum = 0;
  for (let s = 1; s <= 8; s++) {
    e.seed_rng(s);
    const r = JSON.parse(e.calculate_dps_wasm(json));
    assert.equal(r.error, undefined, r.error);
    sum += r.avgDps;
  }
  return sum / 8;
}

test('controls: stacks up to the data max, a one-stack conditional is a toggle, no-DPS ones have none', { skip }, () => {
  const { data } = real();
  assert.deepEqual(C.modConditionalControls('Galvanized Chamber', data), { max: 5, trigger: 'On Kill', condition: null, effect: 'On Kill: +2.72727% Multishot per rank for 20s. Stacks up to 5x.' });
  assert.equal(C.modConditionalControls('Laser Sight', data).max, 1);
  assert.equal(C.modConditionalControls('Galvanized Acceleration', data), null, 'projectile speed does nothing for DPS here');
  assert.equal(C.modConditionalControls('Serration', data), null);
  assert.equal(C.modConditionalControls('Sentient Surge', data).max, 4, 'two entries, one control');
});

test('stored stacks: only below max, clamped, only on conditional mods; max is the default', { skip }, () => {
  const { data } = real();
  const g = { name: 'Galvanized Chamber', rank: 10 };
  assert.equal(C.modStacksOf(g, data), 5);
  assert.deepEqual(C.withModStacks(g, 2, data), { ...g, stacks: 2 });
  assert.deepEqual(C.withModStacks({ ...g, stacks: 2 }, 5, data), g, 'max is not stored');
  assert.deepEqual(C.withModStacks(g, 99, data), g);
  assert.deepEqual(C.withModStacks(g, -3, data), { ...g, stacks: 0 });
  assert.deepEqual(C.withModStacks({ name: 'Serration', rank: 10 }, 2, data), { name: 'Serration', rank: 10 });
  assert.equal(C.modStacksText({ ...g, stacks: 1 }, data), '1 stack');
  assert.equal(C.modStacksText({ name: 'Laser Sight', rank: 5, stacks: 0 }, data), 'Off');
  assert.deepEqual(C.modConditionalSummary({ ...g, stacks: 2 }, data), { perStack: '+30% Multishot', total: '+60% Multishot' });
  assert.deepEqual(C.modConditionalSummary({ name: 'Galvanized Aptitude', rank: 10 }, data), { perStack: '+40% damage per status type on the target', total: '+80% damage per status type on the target' });
});

test('Galvanized Chamber: +30% Multishot per stack at rank 10 on top of its own +80%', { skip }, () => {
  for (const [stacks, ms] of [[0, 1.8], [2, 2.4], [undefined, 3.3]]) {
    close(modeOf(buildOf('Braton Prime', [['Galvanized Chamber', 10, stacks]])).finalMultishot, ms, 1e-3);
  }
  // Rank scales the stack value: rank 5 is 6 x 2.727% = 16.4% per stack.
  const at = stacks => modeOf(buildOf('Braton Prime', [['Galvanized Chamber', 5, stacks]])).finalMultishot;
  close(at(undefined) - at(0), 0.0272727 * 6 * 5);
});

test('Condition Overload: Galvanized Aptitude sends +40% per stack to weaponStats, and the engine counts it per status', { skip }, async () => {
  const statuses = [{ type: 'Impact', stacks: 1 }, { type: 'Cold', stacks: 1 }];
  const off = buildOf('Braton Prime', [['Serration', 10], ['Galvanized Aptitude', 10, 0]], { externalStatuses: statuses });
  const on = buildOf('Braton Prime', [['Serration', 10], ['Galvanized Aptitude', 10]], { externalStatuses: statuses });
  assert.equal(modeOf(off).conditionOverload, 0);
  close(modeOf(on).conditionOverload, 0.8);
  const [a, b] = [await dps(off), await dps(on)];
  assert.ok(b > a * 1.8, `${a} -> ${b}: two statuses at +80% each`);
});

test('weapon augments: Double Tap multiplies, Wild Frenzy fixes the fire rate, Sentient Barrage crits the charged shot', { skip }, () => {
  const { ctx, data } = real();
  const latron = ctx.weaponByName.get('Latron');
  const dt = C.resolveModConditionals(slots([['Double Tap', 3]]), latron, data);
  assert.deepEqual(dt.totals.finalMultipliers.map(v => Math.round(v * 100) / 100), [5], '20 stacks of +20% at rank 3');
  assert.equal(dt.totals.damage, 0);
  const cs = buildEngineInput({ weapon: latron, modSlots: slots([['Double Tap', 3]]), weaponStats: [], enemy: { faction: 'Grineer' }, modeName: 'Normal Attack', maxTime: 1, appState: {}, conditionals: dt }).appState.conditionalStats;
  assert.deepEqual(cs.finalMultipliers.map(v => Math.round(v * 100) / 100), [5]);

  const grakata = modeOf(buildOf('Grakata', [['Wild Frenzy', 5], ['Speed Trigger', 5]]));
  assert.equal(grakata.finalFireRate, 80);
  assert.equal(grakata.fireRateLocked, true);
  assert.notEqual(modeOf(buildOf('Grakata', [['Wild Frenzy', 5, 0], ['Speed Trigger', 5]])).finalFireRate, 80);

  const battacor = buildOf('Battacor', [['Sentient Barrage', 5]]);
  const plain = buildOf('Battacor', [['Sentient Barrage', 5, 0]]);
  assert.ok(modeOf(battacor, 'Secondary Fire').finalCritChance > modeOf(plain, 'Secondary Fire').finalCritChance);
  assert.equal(modeOf(battacor, 'Normal Attack').finalCritChance, modeOf(plain, 'Normal Attack').finalCritChance, 'not on the normal attack');
});

test('elements and always-on parts: Biotic Rounds adds Viral and Magnetic; Lasting Purity needs no stacks', { skip }, () => {
  const biotic = modeOf(buildOf('AX-52', [['Biotic Rounds', 5]])).finalDamageTypes;
  assert.ok(biotic.Viral > 0 && biotic.Magnetic > 0, JSON.stringify(biotic));
  const { ctx, data } = real();
  const vulkar = ctx.weaponByName.get('Vulkar');
  const lp = C.resolveModConditionals(slots([['Lasting Purity', 3]]), vulkar, data);
  assert.deepEqual(lp.totals.finalMultipliers.map(v => Math.round(v * 100) / 100), [1.6]);
  assert.equal(C.modConditionalControls('Lasting Purity', data), null, 'nothing to set');
});

test('totals merge: sums add, multipliers multiply, lists join, flags combine', () => {
  const a = { ...X.emptyExternalTotals(), multishot: 0.5, multiplicativeCritChance: 1.5, finalMultipliers: [2], infiniteAmmo: true };
  const b = { ...X.emptyExternalTotals(), multishot: 1, multiplicativeCritChance: 2, finalMultipliers: [3], corrosiveMaxStacks: 12, fireRateOverride: 80 };
  const m = X.mergeExternalTotals(a, b);
  assert.equal(m.multishot, 1.5);
  assert.equal(m.multiplicativeCritChance, 3);
  assert.deepEqual(m.finalMultipliers, [2, 3]);
  assert.equal(m.infiniteAmmo, true);
  assert.equal(m.corrosiveMaxStacks, 12);
  assert.equal(m.fireRateOverride, 80);
  assert.equal(X.mergeExternalTotals(null, b), b);
  assert.equal(X.mergeExternalTotals(a, null), a);
});

test('builds keep stacks: normalizeBuild, the builds store, pins, and featured builds read activeConditionals', { skip }, () => {
  const { ctx } = real();
  const raw = { weaponName: 'Braton Prime', mods: [{ name: 'Galvanized Chamber', rank: 10, stacks: 2 }, { name: 'Galvanized Scope', rank: 10, stacks: 9 }, { name: 'Serration', rank: 10, stacks: 1 }] };
  const { build } = M.normalizeBuild(ctx, raw);
  assert.deepEqual(build.mods.slice(0, 3), [{ name: 'Galvanized Chamber', rank: 10, stacks: 2 }, { name: 'Galvanized Scope', rank: 10 }, { name: 'Serration', rank: 10 }]);
  assert.deepEqual(storeNormalize(raw).mods[0], { name: 'Galvanized Chamber', rank: 10, stacks: 2 });
  assert.notEqual(M.snapshotOf(build), M.snapshotOf({ ...build, mods: build.mods.map((m, i) => (i === 0 ? { name: m.name, rank: m.rank } : m)) }), 'stacks are content (undo, unsaved changes)');
  assert.equal(M.makePin(build, { avg: 1 }, 'p').config.mods[0].stacks, 2);

  const tb = { itemName: 'Braton Prime', mods: [{ name: 'Galvanized Chamber', rank: 10 }, { name: 'Galvanized Aptitude', rank: 10 }, { name: 'Galvanized Scope', rank: 10 }], activeConditionals: { 'Galvanized Chamber': { isActive: true, stacks: 3 }, 'Galvanized Aptitude': { isActive: false, stacks: 2 } } };
  assert.deepEqual(M.featuredMods(ctx, tb).map(m => m.stacks), [3, 0, undefined], 'off is 0; no state is max');
  assert.deepEqual(M.unappliedFeatures(tb), [], 'mod conditionals are applied');
  assert.deepEqual(M.unappliedFeatures({ ...tb, activeConditionals: { 'Paris Prime_evo2_perk2_basedamage': { isActive: true, stacks: 1 } } }), ['conditionals']);
});
