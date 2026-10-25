// Incarnon evolutions (src/shared/incarnon.js, docs/port-incarnon.md): the build field, perk names, the conditional
// perks' ids, stacks and the site's defaults, what the perks do to the stats and the engine input, saved builds, undo
// and Auto build's perk choice. The real-data numbers were captured from underframe.site's engine input for the same
// builds; the synthetic weapon tests need no core data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as I from '../src/shared/incarnon.js';
import * as S from '../src/shared/stats.js';
import { buildAppState } from '../src/shared/engine-input.js';
import * as M from '../src/renderer/model.js';
import { buildStats, engineInputFor } from '../src/renderer/sim.js';
import { cleanIncarnon, normalizeBuild as storeNormalize } from '../src/main/builds-store.js';
import { runAutoBuildJob } from '../src/renderer/auto-build-job.js';
import { autoEvolution, nothingToFill } from '../src/shared/auto-build.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';
const rel = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * eps + 1e-9, `${actual} != ${expected}`);

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, ctx: M.createContext(data) };
  }
  return cached;
}

// ---------- a synthetic weapon: no core data needed ----------

const WEAPON = {
  name: 'Test Rifle', type: 'Primary', subtype: 'Rifle',
  fire_modes: [
    { mode_name: 'Normal Attack', base_damage: 20, innate_elements: { Impact: 10, Puncture: 10 }, crit_chance: 10, crit_multiplier: 2, status_chance: 10, fire_rate: 5, multishot: 1, punch_through: 0, range: 300, projectile_type: 'Hit-Scan', ammo_cost: 1 },
    { mode_name: 'Incarnon Form', base_damage: 40, innate_elements: { Heat: 40 }, crit_chance: 30, crit_multiplier: 2.5, status_chance: 20, fire_rate: 3, multishot: 1, range: 300, projectile_type: 'Hit-Scan', ammo_cost: 1 },
  ],
};
const perk = (description, stats = [], conditional = []) => ({ description, stats, conditional });
const evo = (...perks) => Object.fromEntries(perks.flatMap((p, i) => [
  [`perk_${i + 1}_description`, p.description], [`perk_${i + 1}_stats`, p.stats], [`perk_${i + 1}_conditional_stats`, p.conditional],
]));
const DATA = {
  weapons: [WEAPON],
  mods: [],
  incarnons: [{
    name: 'Test Rifle', incarnon_max_ammo: 50, charge_count: 20, charge_type: 'Weakpoint Hit',
    evolutions: {
      evolution_1_description: ['The Genesis.'],
      evolution_1_stats: [],
      evolution_2: evo(
        perk("Perk 1: Hunter's Mantra: Increase Damage by +10. On Kill: Increase Damage by +5. Stacks up to 3x.",
          [{ Stat: 'base damage', UpgradeType: 'WEAPON_BASE_DAMAGE', Value: 10, OriginalValue: 'Increase Damage by +10' }],
          [{ Stat: 'base damage', UpgradeType: 'WEAPON_BASE_DAMAGE', Value: 5, OriginalValue: 'Increase Damage by +5' }]),
        perk('Perk 2: Daring Reverie Increase Status Chance by +20%. While Aiming: +50% Multishot.',
          [{ Stat: 'status chance', UpgradeType: 'WEAPON_STATUS_CHANCE', Value: 0.2, OriginalValue: '+20%' }],
          [{ Stat: 'multishot', UpgradeType: 'WEAPON_MULTISHOT', Value: 0.5, OriginalValue: '+50% Multishot' }]),
      ),
      evolution_3: {
        ...evo(
          perk('Perk 1: Prelude of Might: With Critical Chance below 20% : Increase Critical Damage Multiplier by +1x.', [],
            [{ Stat: 'critical damage multiplier', UpgradeType: 'WEAPON_CRITICAL_MULTIPLIER', Value: 1, OriginalValue: '+1x' }]),
          perk('Perk 2: Extended Volley: Increase Magazine Capacity by +20.', [{ Stat: 'magazine capacity', UpgradeType: 'WEAPON_MAGAZINE_CAPACITY', Value: 20, OriginalValue: 'by +20' }]),
        ),
        priority: 'perk 2',
      },
    },
  }],
};
const RELOAD = { name: 'Test Rifle', magazine_size: 30, reload_time: 2 };
const statsOf = (incarnon, modeId = 'Normal Attack') => S.computeWeaponStats(WEAPON, Array(9).fill(null), {
  modsByName: new Map(), reload: RELOAD, targetFaction: 'Grineer', data: DATA, incarnon, incarnonContext: { modeId, customFireModes: [], buffs: [] },
});
const modeOf = (stats, name) => stats.modes.find(m => m.mode_name === name);

test('perk names come from the description, with or without a colon after the name', () => {
  assert.deepEqual(I.perkLabel("Perk 1: Hunter's Mantra: Increase Damage by +18.", 1), { name: "Hunter's Mantra", text: 'Increase Damage by +18.' });
  assert.deepEqual(I.perkLabel('Perk 2: Daring Reverie Increase Damage by +24 (Braton).', 2), { name: 'Daring Reverie', text: 'Increase Damage by +24 (Braton).' });
  assert.deepEqual(I.perkLabel('Perk 3: Carnage Reign +40% Direct Damage per Status Type.', 3), { name: 'Carnage Reign', text: '+40% Direct Damage per Status Type.' });
  assert.equal(I.perkLabel('Perk 1: Survivor\'s Edge : Increase Critical Chance by +8%.', 1).name, "Survivor's Edge");
  const evos = I.incarnonEvolutions(DATA.incarnons[0]);
  assert.deepEqual(evos.map(e => [e.number, e.label, e.perks.map(p => p.name), e.priority]),
    [[2, 'Evolution II', ["Hunter's Mantra", 'Daring Reverie'], null], [3, 'Evolution III', ['Prelude of Might', 'Extended Volley'], 2]]);
});

test('the build field: the site\'s shape, cleaned for the weapon; conditional settings only for picked perks', () => {
  assert.equal(I.normalizeIncarnon(DATA, WEAPON, null), null);
  assert.equal(I.normalizeIncarnon(DATA, WEAPON, { evolution_1_active: false, evolution_2_perk: 1 }), null, 'perks need the Genesis');
  assert.equal(I.normalizeIncarnon(DATA, { name: 'Braton' }, { evolution_1_active: true }), null, 'a weapon without evolutions');
  const inc = I.normalizeIncarnon(DATA, WEAPON, {
    evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 7, evolution_4_perk: '2',
    conditionals: { 'Test Rifle_evo2_perk1_basedamage': 9, 'Test Rifle_evo3_perk1_criticaldamagemultiplier': 1, junk: 1 },
  });
  assert.deepEqual(inc, {
    evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: null, evolution_4_perk: null, evolution_5_perk: null,
    conditionals: { 'Test Rifle_evo2_perk1_basedamage': 3 },
  }, 'an unknown perk is dropped; stacks clamp to the perk\'s 3; a setting for an unpicked perk is dropped');
  const defs = I.incarnonConditionals(DATA, WEAPON, inc);
  assert.deepEqual(defs.map(d => [d.id, d.maxStacks, d.label]), [['Test Rifle_evo2_perk1_basedamage', 3, 'Evolution II: base damage']]);
  // Setting a perk drops the old perk's settings; a conditional back to automatic removes it.
  assert.equal(I.withPerk(DATA, WEAPON, inc, 2, 2).conditionals, undefined);
  assert.equal(I.withConditional(DATA, WEAPON, inc, 'Test Rifle_evo2_perk1_basedamage', null).conditionals, undefined);
  assert.equal(I.withConditional(DATA, WEAPON, inc, 'Test Rifle_evo2_perk1_basedamage', 0).conditionals['Test Rifle_evo2_perk1_basedamage'], 0);
  // The main process keeps the same shape (it ships without the data, so it only checks types).
  assert.deepEqual(cleanIncarnon({ ...inc, evolution_5_perk: 'x', extra: 1 }), inc);
  assert.equal(cleanIncarnon({ evolution_1_active: 'yes' }), null);
});

test('the site\'s defaults: the trigger in the perk\'s text, the stats, the fire mode', () => {
  const def = (description, UpgradeType = 'WEAPON_BASE_DAMAGE', maxStacks = 1) => ({ description, stat: { UpgradeType, Stat: 'x' }, maxStacks });
  const stats = [{ mode_name: 'Normal Attack', finalCritChance: 15, finalDamageTypes: { Impact: 10 } }, { mode_name: 'Incarnon Form', finalCritChance: 45, finalDamageTypes: { Heat: 40 } }];
  const at = (d, modeId = 'Normal Attack', more = {}) => I.incarnonDefaultState(d, { weaponStats: stats, modeId, ...more });
  assert.deepEqual(at(def('On Kill: +5 damage. Stacks up to 3x.', 'WEAPON_BASE_DAMAGE', 3)), { isActive: true, stacks: 3, auto: true });
  assert.equal(at(def('While Aiming: +50% Multishot.')).isActive, false);
  assert.equal(at(def('On Equip from Primary: +40% Critical Chance.')).isActive, false);
  assert.equal(at(def('On Headshot: +5% Fire Rate.')).isActive, true);
  assert.equal(at(def('With Critical Chance below 20%: +1x.')).isActive, true, 'the normal attack has 15%');
  assert.equal(at(def('With Critical Chance below 20%: +1x.'), 'Incarnon Form').isActive, false, 'the Incarnon Form has 45%');
  assert.equal(at(def('On Reload From Empty: +100% Reload Speed.')).isActive, true);
  assert.equal(at(def('On Reload From Empty: +100% Reload Speed.'), 'Incarnon Form').isActive, false, 'the Incarnon Form does not reload');
  assert.equal(at(def('On hitting enemies affected by Electricity Status: +0.4 Multishot.')).isActive, false, 'nothing deals Electricity');
  assert.equal(at(def('On hitting enemies affected by Electricity Status: +0.4 Multishot.'), 'Normal Attack', { statuses: [{ type: 'Electricity', stacks: 2 }] }).isActive, true);
  assert.equal(at(def('On hitting enemies affected by Electricity Status: +0.4 Multishot.'), 'Normal Attack', { buffs: [{ id: 'x', element: 'Electricity' }] }).isActive, true);
  assert.equal(at(def('Something unusual.')).isActive, false);
  assert.equal(at(def('Converts status into crit.', 'WEAPON_CRIT_CHANCE_FROM_STATUS_CHANCE')).isActive, true, 'always on');
});

test('what perks do: always-on stats change each mode, conditional ones at their stacks, settled in two passes', () => {
  const none = statsOf(null);
  assert.equal(none.incarnon, null);
  const genesis = statsOf({ evolution_1_active: true });
  assert.deepEqual(modeOf(genesis, 'Normal Attack').finalDamageTypes, modeOf(none, 'Normal Attack').finalDamageTypes, 'the Genesis alone adds nothing');
  // Hunter's Mantra: +10 base (20 -> 30, both types scaled), and On Kill +5 x3 on by default: +15 flat on top.
  const a = statsOf({ evolution_1_active: true, evolution_2_perk: 1 });
  const n = modeOf(a, 'Normal Attack');
  assert.deepEqual(n.finalDamageTypes, { Impact: 22.5, Puncture: 22.5 });
  assert.equal(n.incarnonBaseDamageBonus, 25);
  assert.equal(n.base_damage, 30, 'the always-on bonus raises the base; the conditional one only the damage');
  assert.deepEqual(a.incarnon.states, { 'Test Rifle_evo2_perk1_basedamage': { isActive: true, stacks: 3, auto: true } });
  // The user's own setting: one stack.
  const one = modeOf(statsOf({ evolution_1_active: true, evolution_2_perk: 1, conditionals: { 'Test Rifle_evo2_perk1_basedamage': 1 } }), 'Normal Attack');
  assert.deepEqual(one.finalDamageTypes, { Impact: 17.5, Puncture: 17.5 });
  // Daring Reverie: +20% status on every mode's base; its While Aiming multishot stays off.
  const b = statsOf({ evolution_1_active: true, evolution_2_perk: 2 });
  rel(modeOf(b, 'Normal Attack').simulationPerProjectileStatusChance, 30);
  rel(modeOf(b, 'Incarnon Form').simulationPerProjectileStatusChance, 40);
  assert.equal(modeOf(b, 'Normal Attack').finalMultishot, 1);
  // Prelude of Might: +1x base crit multiplier while crit is below 20% (normal 10%: on; it reads the first pass).
  const c = statsOf({ evolution_1_active: true, evolution_3_perk: 1 });
  rel(modeOf(c, 'Normal Attack').baseCritMultiplier, S.quantizeCritMultiplier(3));
  const cInc = statsOf({ evolution_1_active: true, evolution_3_perk: 1 }, 'Incarnon Form');
  rel(modeOf(cInc, 'Incarnon Form').baseCritMultiplier, S.quantizeCritMultiplier(2.5)); // the picked mode has 30%: off
  // Extended Volley: +20 rounds before mods; the Incarnon Form keeps its charge pool.
  const d = statsOf({ evolution_1_active: true, evolution_3_perk: 2 });
  assert.equal(modeOf(d, 'Normal Attack').magazineSize, 50);
  assert.equal(modeOf(d, 'Incarnon Form').magazineSize, 50, 'incarnon_max_ammo');
});

// ---------- the real data, against underframe.site ----------

const RIFLE = [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 }, { name: 'Vital Sense', rank: 5 }, { name: 'Infected Clip', rank: 5 }];
const PISTOL = [{ name: 'Hornet Strike', rank: 10 }, { name: 'Barrel Diffusion', rank: 5 }, { name: 'Pistol Gambit', rank: 5 }, { name: 'Target Cracker', rank: 5 }, { name: 'Pathogen Rounds', rank: 5 }];
function siteBuild(weaponName, mods, incarnon, modeName = null) {
  const { ctx } = real();
  const build = M.createBuild(ctx, { weaponName });
  build.mods = Array.from({ length: 9 }, (_, i) => mods[i] ?? null);
  if (modeName) build.modeName = modeName;
  build.incarnon = I.normalizeIncarnon(ctx.data, ctx.weaponByName.get(weaponName), incarnon);
  return build;
}

test('engine input for perk builds equals underframe.site\'s (captured)', { skip }, () => {
  const { ctx } = real();
  const check = (build, mode, want) => {
    const input = engineInputFor(ctx, build, { appStateRef: 1 });
    const m = input.weaponStats.find(x => x.mode_name === mode);
    for (const [k, v] of Object.entries(want)) {
      if (k === 'fdt') for (const [t, x] of Object.entries(v)) rel(m.finalDamageTypes[t], x);
      else if (k === 'cs') for (const [f, x] of Object.entries(v)) rel(input.conditionalStats?.[f], x);
      else if (typeof v === 'number') rel(m[k], v);
      else assert.deepEqual(m[k], v, k);
    }
    return input;
  };
  // Braton Prime: Daring Reverie (+4, and +38 with a channeled ability: on), Prelude of Might (crit below 50%: on in the
  // normal form, off in the Incarnon Form).
  const braton = siteBuild('Braton Prime', RIFLE, { evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 1, evolution_4_perk: 2 });
  check(braton, 'Normal Attack', { fdt: { Toxin: 184.9203201759375, Impact: 12.753125529374998, Puncture: 70.1421904115625, Slash: 121.15469252906249 }, finalCritMultiplier: 11.0026862, incarnonBaseDamageBonus: 42, ammoConsumption: 0.5 });
  check({ ...braton, modeName: 'Incarnon Form' }, 'Incarnon Form', { fdt: { Toxin: 268.97501116499996, Impact: 120.57500500499998, Slash: 166.95000692999997 }, finalCritChance: 75, finalCritMultiplier: 6.60161172, magazineSize: 200 });
  // Furis with the user's stacks: Stormburst at 2 of 3, Headcracker at 3 of 5.
  const furis = siteBuild('Furis', PISTOL, { evolution_1_active: true, evolution_2_perk: 2, evolution_3_perk: 2, evolution_4_perk: 1, conditionals: { Furis_evo2_perk2_multishot: 2, Furis_evo4_perk1_firerate: 3 } });
  check(furis, 'Normal Attack', { fdt: { Toxin: 139.2, Puncture: 105.6 }, finalMultishot: 3, finalFireRate: 11.5, magazineSize: 60, incarnonBaseDamageBonus: 28 });
  // Torid: the last shot of a magazine fires 3 more; the ammo pool multishot of the other perk.
  check(siteBuild('Torid', RIFLE, { evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 2, evolution_4_perk: 1 }), 'Grenade Impact', { fdt: { Toxin: 762.7859691628124 }, finalCritChance: 87.5, lastMagazineMultishotBonuses: [{ shots: 1, value: 3 }], incarnonBaseDamageBonus: 51 });
  check(siteBuild('Torid', RIFLE, { evolution_1_active: true, evolution_2_perk: 2, evolution_3_perk: 3, evolution_4_perk: 2 }), 'Grenade Impact', { fdt: { Toxin: 661.7547149690624 }, ammoPoolMultishotDamageMultiplier: 1.6, ammoPoolMultishotInnateProjectiles: 1, magazineSize: 14, simulationPerProjectileStatusChance: 38 });
  // Burston: the magazine's last burst; Latron: Flensing Spikes' armor strip per Puncture status.
  check(siteBuild('Burston', RIFLE, { evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 3, evolution_4_perk: 2 }), 'Normal Attack', { lastMagazineBurstMultishotBonus: 9.5000003, finalCritChance: 70, reloadTime: 2 });
  const latron = check(siteBuild('Latron', RIFLE, { evolution_1_active: true, evolution_2_perk: 2, evolution_3_perk: 2, evolution_4_perk: 1, conditionals: { Latron_evo4_perk1_armorreduction: 1 } }), 'Normal Attack',
    { fdt: { Puncture: 187.65313278937498 }, punctureArmorStrip: 0.2, magazineSize: 30, cs: { armorStripPerHit: 0.2 } });
  assert.equal(latron.enemyConfig.armorStripPerHit, 0.2);
  assert.equal(latron.simulationParams.armorStripPerHit, 0.2);
  // Strun: one variant's status value; projectile speed reaches conditionalStats.
  check(siteBuild('Strun', [{ name: 'Point Blank', rank: 5 }, { name: "Hell's Chamber", rank: 5 }, { name: 'Blunderbuss', rank: 5 }, { name: 'Ravage', rank: 5 }], { evolution_1_active: true, evolution_2_perk: 2, evolution_3_perk: 3, evolution_4_perk: 3 }), 'Normal Attack',
    { finalCritChance: 21.85000069, simulationPerProjectileStatusChance: 9, incarnonBaseDamageBonus: 54, cs: { projectileSpeed: 0.3 } });
  // Felarx: the non-crit damage multiplier the engine reads.
  check(siteBuild('Felarx', [{ name: 'Point Blank', rank: 5 }, { name: "Hell's Chamber", rank: 5 }, { name: 'Blunderbuss', rank: 5 }, { name: 'Ravage', rank: 5 }], { evolution_1_active: true, evolution_2_perk: 1, evolution_3_perk: 1, evolution_4_perk: 1, evolution_5_perk: 1 }), 'Normal Attack',
    { nonCritDamageMultiplier: 20, finalCritChance: 57.0000018, finalMultishot: 8.8 });
});

test('the Latron\'s Deadhead raises the target\'s headshot multiplier (not a forced 1x one)', { skip }, () => {
  const { ctx } = real();
  const build = siteBuild('Latron', RIFLE, { evolution_1_active: true, evolution_2_perk: 2, evolution_3_perk: 3, evolution_4_perk: 2 });
  const input = engineInputFor(ctx, build, { appStateRef: 1 });
  assert.equal(input.enemyConfig.headshotMultiplier, (M.resolveEnemy(ctx, build.enemy).headshotMultiplier ?? 2) + 1);
  assert.equal(input.conditionalStats.externalHeadshotMultiplierBonus, 1);
});

test('saved builds keep their perks: the renderer\'s and the main process\'s cleaning, content and undo', { skip }, () => {
  const { ctx } = real();
  const build = siteBuild('Furis', PISTOL, { evolution_1_active: true, evolution_2_perk: 2, evolution_4_perk: 1, conditionals: { Furis_evo2_perk2_multishot: 2 } });
  const stored = storeNormalize(JSON.parse(JSON.stringify(build)));
  assert.deepEqual(stored.incarnon, build.incarnon);
  const { build: back, warnings } = M.normalizeBuild(ctx, stored);
  assert.deepEqual(warnings, []);
  assert.deepEqual(back.incarnon, build.incarnon);
  // Older builds have none; a weapon without evolutions drops it.
  assert.equal(M.normalizeBuild(ctx, { ...stored, incarnon: undefined }).build.incarnon, null);
  assert.equal(M.normalizeBuild(ctx, { ...stored, weaponName: 'Grakata' }).build.incarnon, null);
  // Content (unsaved changes, undo, the sim key) includes it; restoring content without it removes it.
  assert.deepEqual(M.contentOf(build).incarnon, build.incarnon);
  assert.notEqual(M.simKeyOf(ctx, build), M.simKeyOf(ctx, { ...build, incarnon: null }));
  assert.equal(M.withContent(build, M.contentOf({ ...build, incarnon: null })).incarnon, null);
  assert.deepEqual(M.withContent({ ...build, incarnon: null }, M.contentOf(build)).incarnon, build.incarnon);
  // Another weapon starts without perks.
  assert.equal(M.changeWeapon(ctx, build, 'Lex Prime').build.incarnon, null);
  // The same settings give the same build whatever order they were set in (snapshots compare JSON).
  const { data } = real();
  const weapon = ctx.weaponByName.get('Furis');
  const two = I.withConditional(data, weapon, I.withConditional(data, weapon, build.incarnon, 'Furis_evo4_perk1_firerate', 2), 'Furis_evo2_perk2_multishot', null);
  const reset = I.withConditional(data, weapon, two, 'Furis_evo2_perk2_multishot', 2);
  assert.equal(JSON.stringify(reset), JSON.stringify(I.withConditional(data, weapon, build.incarnon, 'Furis_evo4_perk1_firerate', 2)));
  // A setting of its own still knows the default it overrides ("Automatic" in the picker names that).
  const off = { ...build, incarnon: I.withConditional(data, weapon, build.incarnon, 'Furis_evo4_perk1_firerate', 0) };
  const state = buildStats(ctx, off).incarnon.states.Furis_evo4_perk1_firerate;
  assert.deepEqual([state.isActive, state.auto], [false, false]);
  const auto = buildStats(ctx, build).incarnon.states.Furis_evo4_perk1_firerate;
  assert.deepEqual([state.fallback.isActive, state.fallback.stacks], [auto.isActive, auto.stacks]);
});

test('featured builds bring their perks and the conditional states they set themselves', { skip }, () => {
  const { ctx } = real();
  const featured = M.featuredBuilds(ctx).find(f => f.weaponName === 'Kunai' && f.source.incarnon?.evolution_1_active);
  if (!featured) return;
  const { build, notes } = M.buildFromFeatured(ctx, featured);
  assert.equal(build.incarnon.evolution_2_perk, featured.source.incarnon.evolution_2_perk);
  for (const [id, s] of Object.entries(featured.source.activeConditionals)) {
    if (!id.startsWith('Kunai_evo') || s.auto !== false) continue;
    const def = I.incarnonConditionals(ctx.data, ctx.weaponByName.get('Kunai'), build.incarnon).find(d => d.id === id);
    if (def) assert.equal(build.incarnon.conditionals[id], s.isActive ? Math.min(def.maxStacks, def.maxStacks > 1 ? s.stacks : 1) : 0, id);
  }
  assert.ok(!notes[0].includes('incarnon settings'), notes[0]);
});

/** The pool interface over one in-process engine (as test/auto-build.test.js). */
async function enginePool(appState) {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  engine.cache_app_state(1, appState);
  return {
    engine,
    run: async tasks => tasks.map(t => {
      let sum = 0;
      let count = 0;
      for (const seed of t.seeds) {
        engine.seed_rng(seed);
        const r = JSON.parse(engine.calculate_dps_wasm(t.input));
        if (Number.isFinite(r[t.metric])) { sum += r[t.metric]; count++; }
      }
      return { sum, count, errors: t.seeds.length - count, error: null };
    }),
  };
}

test('Auto build picks perks for empty evolutions (data priority first), keeps chosen ones, and turns their conditionals on', { skip }, async () => {
  const { ctx, data } = real();
  const weapon = ctx.weaponByName.get('Furis');
  const build = { ...M.createBuild(ctx, { weaponName: 'Furis' }), incarnon: I.normalizeIncarnon(data, weapon, { evolution_1_active: true, evolution_3_perk: 2 }) };
  assert.deepEqual(autoEvolution(data, weapon, build.incarnon).locked, new Map([[3, 2]]));
  assert.equal(nothingToFill({ ...build, mods: Array(9).fill({ name: 'x' }) }, weapon, new Set([0, 1, 2, 3, 4, 5, 6, 7]), true, data), false, 'an empty evolution is something to do');
  const settings = { sampleSizeMultiplier: 0.2, finalRefinementEnabled: false, modWhitelistEnabled: true, modWhitelist: ['Hornet Strike', 'Barrel Diffusion', 'Pistol Gambit', 'Target Cracker'] };
  const pool = await enginePool(JSON.stringify(buildAppState(data, weapon)));
  const r = await runAutoBuildJob({ ctx, build, start: { mods: build.mods, arcanes: build.arcanes }, settings, pool });
  assert.equal(r.incarnon.evolution_3_perk, 2, 'kept');
  assert.equal(r.incarnon.evolution_4_perk, 3, 'the data\'s priority (perk 3)');
  assert.ok([1, 2].includes(r.incarnon.evolution_2_perk), 'scored');
  assert.ok(r.log.some(l => /picked \d perks?/.test(l)), r.log.join('\n'));
  // A picked perk with a conditional part comes with it on, as the site writes it after a run.
  for (const def of I.incarnonConditionals(data, weapon, r.incarnon)) {
    if (def.evolution === 3) continue;
    assert.ok(r.incarnon.conditionals?.[def.id] > 0, def.id);
  }
  assert.ok(r.after > r.before, `${r.before} -> ${r.after}`);
  // The result view's "after" is what the Readout shows once applied: its input, the 8 seeded runs, the average.
  const applied = { ...build, mods: r.mods, arcanes: r.arcanes, incarnon: r.incarnon };
  assert.ok(buildStats(ctx, applied).incarnon, 'perks count');
  const input = JSON.stringify(engineInputFor(ctx, applied, { appStateRef: 1, debugLog: false }));
  const readout = M.SIM_SEEDS.reduce((sum, seed) => {
    pool.engine.seed_rng(seed);
    return sum + JSON.parse(pool.engine.calculate_dps_wasm(input)).avgDps;
  }, 0) / M.SIM_SEEDS.length;
  assert.ok(Math.abs(readout - r.after) <= Math.max(1e-6, r.after * 1e-9), `Readout ${readout} vs after ${r.after}`);
});
