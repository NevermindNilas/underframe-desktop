// Parity with underframe.site's own numbers: weaponStats and DPS replayed from inputs captured on the live site
// (Braton Prime with the screenshot's five buffs; Lex Prime with Semi-Pistol Cannonade), the "cannot be modified" stat
// locks, damage and crit multiplier quantization, nonCritDamageMultiplier, Frostbite with a Cold status, the
// refcounted app-state cache, and an Auto build run that no longer pairs a Semi-Cannonade with fire-rate mods.
// Engine and data tests skip when the private core submodule is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as X from '../src/shared/external-buffs.js';
import { indexMods, maxRank } from '../src/shared/mods.js';
import { computeWeaponStats, quantizeCritMultiplier, quantizeDamageTypes } from '../src/shared/stats.js';
import { arcaneModifiersFor, arcaneRequirementMet, resolveArcanes } from '../src/shared/arcanes.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import * as AS from '../src/shared/auto-build-settings.js';
import * as AB from '../src/shared/auto-build.js';
import * as M from '../src/renderer/model.js';
import { runAutoBuildJob } from '../src/renderer/auto-build-job.js';
import { createAppStateCache } from '../src/renderer/app-state-cache.js';
import { resolveModConditionals } from '../src/shared/conditional-mods.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';
const rel = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * eps + 1e-12, `${actual} != ${expected}`);

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, index: indexMods(data) };
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

const row = (id, value, element) => {
  const r = X.buffFromInput(real().data, id, { value, element });
  if (r.error) throw new Error(`${id}: ${r.error}`);
  return r.row;
};

/** The app's stats for a weapon, mods and buff rows, against Grineer. */
function statsFor(weaponName, mods, rows = [], { arcanes = [], statuses = [] } = {}) {
  const { data, index } = real();
  const weapon = data.weapons.find(w => w.name === weaponName);
  const reload = data.reload_data.find(r => r.name === weaponName) ?? null;
  const external = rows.length ? X.reduceExternalBuffs(rows, data, weapon).totals : null;
  const resolved = resolveArcanes(arcanes, weapon, data);
  const { modes } = computeWeaponStats(weapon, mods, { modsByName: index.byName, reload, targetFaction: 'Grineer', external, arcanes: resolved, externalStatuses: statuses });
  return { weapon, reload, external, modes, mode: modes.find(m => m.mode_name === 'Normal Attack') ?? modes[0] };
}

// The enemy the captures ran against (underframe.site's enemyConfig, as captured).
const SITE_ENEMY = {
  faction: 'Grineer', hp: 2100000000, armor: 2700, rawArmor: 2700, shields: 0, overguard: 0, headshotMultiplier: 3, isHeadshot: false,
  headshotAccuracy: 1, headCritEnabled: true, headCritMultiplier: 2, damageResistanceMultiplier: 1, attenuationStatusCap: -1,
};

/** Mean avgDps over seeds 1-8 on the captured enemy, 5 s (the site's capture settings). */
async function siteDps({ weapon, reload, external, modes }, mods) {
  const e = await engine();
  const input = buildEngineInput({
    weapon, modSlots: mods, weaponStats: modes, enemy: SITE_ENEMY, modeName: 'Normal Attack', maxTime: 5, reload,
    appState: buildAppState(real().data, weapon), debugLog: false, external,
  });
  input.enemyConfig = { ...input.enemyConfig, ...SITE_ENEMY };
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

const PROBE = [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 }, { name: 'Vital Sense', rank: 5 }, { name: 'Infected Clip', rank: 5 }];

test('quantization: damage in steps of base / 32, the crit multiplier in steps of 32/4095', () => {
  // Braton Prime's 35 base: 1.75 Impact rounds up to 2 steps of 1.09375, 12.25 Puncture down to 11.
  assert.deepEqual(quantizeDamageTypes({ Impact: 1.75, Puncture: 12.25, Slash: 21 }, 35), { Impact: 2.1875, Puncture: 12.03125, Slash: 20.78125 });
  assert.deepEqual(quantizeDamageTypes({ Heat: 0.1 }, 35), {}, 'a type that rounds to nothing is dropped');
  rel(quantizeCritMultiplier(2), 2.0004884);
  rel(quantizeCritMultiplier(1.5), 1.5003663);
});

test('replay: Braton Prime with the screenshot\'s buffs matches underframe.site\'s weaponStats and DPS', { skip, timeout: 60_000 }, async () => {
  const rows = [row('resupply', 60, 'Electricity'), row('ext_fire_rate', 60), row('ext_elemental', 298, 'Electricity'), row('ext_combining_element', 240, 'Electricity'), row('ext_flat_crit_damage', 1.2)];
  const s = statsFor('Braton Prime', PROBE, rows);
  // Captured on underframe.site (AppState.calculatedWeaponStats and the engine input it sent).
  const site = { Corrosive: 307.23438775312496, Impact: 5.796875240624999, Puncture: 31.882813823437495, Slash: 55.07031478593749, Electricity: 275.35157392968745 };
  assert.deepEqual(Object.keys(s.mode.finalDamageTypes).sort(), Object.keys(site).sort());
  for (const [t, v] of Object.entries(site)) rel(s.mode.finalDamageTypes[t], v, 1e-9);
  rel(s.mode.finalCritMultiplier, 5.60107448);
  rel(s.mode.baseCritMultiplier, 2.0004884);
  rel(s.mode.finalFireRate, 15.328);
  rel(s.mode.finalMultishot, 1.90000006);
  assert.equal(s.mode.nonCritDamageMultiplier, 0, 'no override, as the site sends it');
  assert.equal(s.mode.guaranteedNonCritDamageMultiplier, 1);
  // The site's input gave 195,148.3 DPS on this enemy (seeds 1-8).
  rel(await siteDps(s, PROBE), 195148.3, 1e-6);
});

test('stat locks: Semi-Cannonade keeps the base fire rate against mods, External Fire Rate and arcanes', { skip, timeout: 60_000 }, async () => {
  const mods = [{ name: 'Semi-Pistol Cannonade', rank: 5 }, { name: 'Lethal Torrent', rank: 5 }, { name: 'Gunslinger', rank: 5 }];
  const s = statsFor('Lex Prime', mods, [row('ext_fire_rate', 60)]);
  // underframe.site: finalFireRate 2.08 (the weapon's own), multishot still modded (Lethal Torrent).
  rel(s.mode.finalFireRate, 2.08);
  rel(s.mode.finalMultishot, 1.6);
  assert.equal(s.mode.fireRateHeld, true, 'the stat lock holds the rate (the engine field fireRateLocked is for mode locks)');
  // The site's input gave 273.7 DPS (the app gave 584.0 before the lock).
  rel(await siteDps(s, mods), 273.7, 2e-4);
  const unlocked = statsFor('Lex Prime', [{ name: 'Gunslinger', rank: 5 }], [row('ext_fire_rate', 60)]);
  assert.ok(unlocked.mode.finalFireRate > 4, 'without the Cannonade, fire rate mods count');
});

test('stat locks: Acuity keeps the base multishot against mods and External Multishot', { skip }, () => {
  const s = statsFor('Braton Prime', [{ name: 'Primary Acuity', rank: 5 }, { name: 'Split Chamber', rank: 5 }], [row('ext_multishot', 50)]);
  assert.equal(s.mode.finalMultishot, 1);
  assert.equal(s.mode.multishotLocked, true);
  assert.ok(statsFor('Braton Prime', [{ name: 'Split Chamber', rank: 5 }]).mode.finalMultishot > 1.8);
});

/** Mean avgDps of a build with conditional-mod stacks and target statuses, on the captured enemy (5 s, seeds 1-8). */
async function conditionalDps(weaponName, mods, statuses = []) {
  const { data, index } = real();
  const e = await engine();
  const weapon = data.weapons.find(w => w.name === weaponName);
  const reload = data.reload_data.find(r => r.name === weaponName) ?? null;
  const conditionals = resolveModConditionals(mods, weapon, data);
  const { modes } = computeWeaponStats(weapon, mods, { modsByName: index.byName, reload, targetFaction: 'Grineer', externalStatuses: statuses, conditionals });
  const input = buildEngineInput({
    weapon, modSlots: mods, weaponStats: modes, enemy: SITE_ENEMY, modeName: 'Normal Attack', maxTime: 5, reload,
    appState: buildAppState(data, weapon, { externalStatuses: statuses }), debugLog: false, conditionals,
  });
  input.enemyConfig = { ...input.enemyConfig, ...SITE_ENEMY };
  const json = JSON.stringify(input);
  let sum = 0;
  for (let s = 1; s <= 8; s++) {
    e.seed_rng(s);
    const r = JSON.parse(e.calculate_dps_wasm(json));
    assert.equal(r.error, undefined, r.error);
    sum += r.avgDps;
  }
  return { dps: sum / 8, modes };
}

test('conditional mods: Galvanized stacks, Condition Overload, Double Tap and Wild Frenzy match underframe.site', { skip, timeout: 60_000 }, async () => {
  const m = (name, rank, stacks) => ({ name, rank, ...(stacks != null ? { stacks } : {}) });
  // Captured on underframe.site with these activeConditionals (docs/port-weapon-stats.md 3).
  const cases = [
    ['Braton Prime', [m('Serration', 10), m('Galvanized Chamber', 10, 5), m('Galvanized Scope', 10, 3), m('Point Strike', 5)], [], 1193.8],
    ['Braton Prime', [m('Serration', 10), m('Galvanized Aptitude', 10, 2), m('Infected Clip', 5), m('Cryo Rounds', 5)], [{ type: 'Viral', stacks: 2 }, { type: 'Impact', stacks: 1 }], 2885.4],
    ['Lex Prime', [m('Hornet Strike', 10), m('Galvanized Shot', 10, 2), m('Galvanized Diffusion', 10, 4), m('Lethal Torrent', 5)], [], 1128.1],
    ['Latron', [m('Double Tap', 3, 10), m('Serration', 10), m('Point Strike', 5)], [], 234.6],
    ['Grakata', [m('Wild Frenzy', 5), m('Serration', 10), m('Speed Trigger', 5)], [], 151.5],
  ];
  for (const [weapon, mods, statuses, site] of cases) {
    const { dps } = await conditionalDps(weapon, mods, statuses);
    rel(dps, site, 2e-4);
  }
  // The site's weaponStats for the Galvanized Aptitude build: +80% Condition Overload.
  const { modes } = await conditionalDps('Braton Prime', cases[1][1], cases[1][2]);
  rel(modes[0].conditionOverload, 0.8, 1e-6);
});

test('per-mode locks: hitscan area modes and named modes keep their multishot; Glory, bows and beams', { skip }, () => {
  const ms = [{ name: 'Split Chamber', rank: 5 }];
  const braton = statsFor('Braton Prime', ms).modes;
  assert.ok(braton.find(x => x.mode_name === 'Normal Attack').finalMultishot > 1.8);
  assert.equal(braton.find(x => x.mode_name === 'Incarnon Form AoE').finalMultishot, 1, 'as the site: 1');
  const sobek = statsFor('Sobek', [{ name: 'Hell\'s Chamber', rank: 5 }]).modes;
  assert.equal(sobek.find(x => x.mode_name === 'Acid Shells').multishotLocked, true);
  const glory = statsFor('Glory', [{ name: 'Hornet Strike', rank: 10 }, { name: 'Gunslinger', rank: 5 }]).modes;
  const alt = glory.find(x => x.mode_name === 'Alternate Fire');
  assert.equal(alt.fireRateLocked, true);
  assert.ok(glory.find(x => x.mode_name === 'Normal Attack').totalFinalDamage > 2 * (statsFor('Glory', []).modes[0].totalFinalDamage), 'Hornet Strike counts on the normal attack');
  rel(alt.totalFinalDamage, statsFor('Glory', []).modes.find(x => x.mode_name === 'Alternate Fire').totalFinalDamage, 1e-9);
  const paris = statsFor('Paris', []).modes.find(x => x.mode_name === 'Uncharged Shot');
  assert.equal(paris.finalFireRate, 1000, 'no wait between uncharged shots');
  const phage = statsFor('Phage', [{ name: 'Hell\'s Chamber', rank: 5 }]).modes[0];
  rel(phage.finalMultishot, 6 * 2.2 + 1, 1e-6);
});

test('a Cold status on the target lets Primary Frostbite build stacks (readout and Auto build)', { skip }, () => {
  const { data } = real();
  assert.equal(arcaneRequirementMet('Primary Frostbite', { Impact: 1 }, []), false);
  assert.equal(arcaneRequirementMet('Primary Frostbite', { Impact: 1 }, [{ type: 'Cold', stacks: 10 }]), true);
  assert.equal(arcaneRequirementMet('Primary Blight', { Impact: 1 }, [{ type: 'Toxin', stacks: 10 }]), false, 'the site applies it to Frostbite only');
  const weapon = data.weapons.find(w => w.name === 'Braton Prime');
  const resolved = resolveArcanes([{ name: 'Primary Frostbite', rank: 5 }], weapon, data);
  assert.deepEqual(arcaneModifiersFor(resolved, { Impact: 1 }), {});
  assert.ok(Object.keys(arcaneModifiersFor(resolved, { Impact: 1 }, [{ type: 'Cold', stacks: 1 }])).length > 0);
  // The readout's stats: Frostbite's bonus applies with Cold on the target and no Cold in the build.
  const plain = statsFor('Braton Prime', [{ name: 'Serration', rank: 10 }], [], { arcanes: [{ name: 'Primary Frostbite', rank: 5 }] });
  const cold = statsFor('Braton Prime', [{ name: 'Serration', rank: 10 }], [], { arcanes: [{ name: 'Primary Frostbite', rank: 5 }], statuses: [{ type: 'Cold', stacks: 10 }] });
  assert.notDeepEqual(cold.mode, plain.mode);
  // Auto build offers it with the status.
  const ctx = M.createContext(data);
  const envOf = statuses => {
    const build = { ...M.createBuild(ctx, { weaponName: 'Braton Prime' }), externalStatuses: statuses };
    return AB.createAutoBuildEnv({ data, weapon, reload: ctx.reloadByName.get(weapon.name), build, enemy: M.resolveEnemy(ctx, build.enemy), settings: AS.normalizeAutoBuildSettings({}, data), index: ctx.index });
  };
  const empty = Array(9).fill(null);
  assert.equal(AB.arcaneEligible(envOf([]), 'Primary Frostbite', empty), false);
  assert.equal(AB.arcaneEligible(envOf([{ type: 'Cold', stacks: 10 }]), 'Primary Frostbite', empty), true);
});

test('the app-state cache gives every miss a fresh ref and releases an evicted one only after its runs end', async () => {
  const cachedRefs = [];
  const released = [];
  const c = createAppStateCache({
    cache: async ref => { cachedRefs.push(ref); },
    release: async ref => { released.push(ref); },
    appStateOf: (w, s) => ({ w: w.name, s }),
    max: 2,
  });
  const w = name => ({ name });
  const held = c.acquire(w('A'), []);
  const refA = await held.promise;
  await c.withAppState(w('A'), [{ type: 'Viral', stacks: 1 }], async () => {});
  await c.withAppState(w('A'), [{ type: 'Viral', stacks: 2 }], async () => {});
  await c.withAppState(w('A'), [{ type: 'Viral', stacks: 3 }], async () => {});
  await new Promise(r => setTimeout(r, 0));
  assert.equal(new Set(cachedRefs).size, cachedRefs.length, 'refs are never reused');
  assert.ok(!released.includes(refA), 'A is still in use by a run, so its ref stays cached');
  held.release();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(released.includes(refA), 'released once the run ends');
  assert.equal(c.size, 2);
  // A hit does not cache again.
  const before = cachedRefs.length;
  await c.withAppState(w('A'), [{ type: 'Viral', stacks: 3 }], async ref => assert.equal(ref, cachedRefs.at(-1)));
  assert.equal(cachedRefs.length, before);
});

test('Auto build on Lex Prime does not pair a Semi-Cannonade with fire-rate mods any more', { skip, timeout: 120_000 }, async t => {
  const { data } = real();
  const ctx = M.createContext(data);
  const build = M.createBuild(ctx, { weaponName: 'Lex Prime' });
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const e = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  e.cache_app_state(1, JSON.stringify(buildAppState(data, ctx.weaponByName.get('Lex Prime'))));
  const pool = {
    run: async tasks => tasks.map(t => {
      let sum = 0;
      let count = 0;
      for (const seed of t.seeds) {
        e.seed_rng(seed);
        const r = JSON.parse(e.calculate_dps_wasm(t.input));
        if (Number.isFinite(r[t.metric])) { sum += r[t.metric]; count++; }
      }
      return { sum, count, errors: t.seeds.length - count, error: null };
    }),
  };
  // The fire-rate mods the reviewers saw paired with the Cannonade, plus more damage, crit, multishot and faction mods
  // than there are slots, so a dead fire-rate mod always has a better alternative.
  const settings = {
    sampleSizeMultiplier: 0.2, finalRefinementEnabled: true, finalRefinementSampleSize: 16, elementalCandidatesEnabled: false, modWhitelistEnabled: true,
    modWhitelist: [
      'Semi-Pistol Cannonade', 'Gunslinger', 'Anemic Agility', 'Lethal Torrent', 'Hornet Strike', 'Primed Pistol Gambit', 'Primed Target Cracker',
      'Creeping Bullseye', 'Augur Pact', 'Primed Expel Grineer', 'Galvanized Diffusion', 'Galvanized Shot',
    ],
  };
  const r = await runAutoBuildJob({ ctx, build, start: { mods: build.mods, arcanes: build.arcanes }, settings, pool });
  const used = r.mods.filter(Boolean).map(m => m.name);
  t.diagnostic(used.join(', '));
  const pureFireRate = ['Gunslinger', 'Anemic Agility'];
  if (used.includes('Semi-Pistol Cannonade')) {
    for (const n of pureFireRate) assert.ok(!used.includes(n), `${n} is dead weight next to Semi-Pistol Cannonade: ${used.join(', ')}`);
  }
  assert.ok(r.after > r.before, `${r.before} -> ${r.after}`);
  // Whatever it picked, its stats lock the fire rate exactly when a Cannonade is in.
  const s = statsFor('Lex Prime', r.mods);
  assert.equal(s.mode.fireRateHeld, used.includes('Semi-Pistol Cannonade'));
  void maxRank;
});
