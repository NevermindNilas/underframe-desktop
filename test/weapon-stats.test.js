// Per-mode weapon stats as underframe.site computes them (src/shared/stats.js): charge timing, bursts, magazines and
// ammo, reload models, crit and status inherited from the normal attack, status duration, Progenitor bonuses, combined
// fire modes (src/shared/fire-modes.js) and weapon passives and options (src/shared/weapon-passives.js). The expected
// numbers were captured from underframe.site's own engine input for the same builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../src/shared/stats.js';
import * as F from '../src/shared/fire-modes.js';
import * as P from '../src/shared/weapon-passives.js';
import { useAccurateAmmo } from '../src/shared/engine-input.js';
import * as M from '../src/renderer/model.js';
import { buildStats, engineInputFor, targetStatusesOf } from '../src/renderer/sim.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';
const rel = (actual, expected, eps = 1e-7) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * eps + 1e-12, `${actual} != ${expected}`);

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, ctx: M.createContext(data) };
  }
  return cached;
}
const RIFLE = [['Serration', 10], ['Split Chamber', 5], ['Point Strike', 5], ['Infected Clip', 5], ['Speed Trigger', 5], ['Hellfire', 5]];
const PISTOL = [['Hornet Strike', 10], ['Barrel Diffusion', 5], ['Pistol Gambit', 5], ['Pathogen Rounds', 5], ['Gunslinger', 5], ['Heated Charge', 5]];
const SHOTGUN = [['Point Blank', 5], ["Hell's Chamber", 5], ['Blunderbuss', 5], ['Contagious Spread', 5], ['Incendiary Coat', 5]];
/** A weapon's modes with these mods, as the Readout computes them (Progenitor default, passives, data). */
function modesOf(weaponName, mods, extra = {}) {
  const { ctx } = real();
  const build = { ...M.createBuild(ctx, { weaponName }), mods: [...mods.map(([name, rank]) => ({ name, rank })), ...Array(9 - mods.length).fill(null)], ...extra };
  return buildStats(ctx, build).modes;
}
const mode = (modes, name) => modes.find(m => m.mode_name === name);

test('charged shots fire once per charge plus release; fire rate mods speed up both', { skip }, () => {
  const m = mode(modesOf('Battacor', RIFLE), 'Secondary Fire');
  rel(m.finalFireRate, 2.6666666666666665);
  assert.deepEqual(m.rangedPhaseTiming, { chargeSeconds: 0.25, releaseSeconds: 0.125, cycleDuration: 0.375 });
  assert.equal(m.burstCount, null);
});

test('bursts: count and delay, the delay shrinking with fire rate where the data says so', { skip }, () => {
  const m = mode(modesOf('Burst Laser Prime', PISTOL), 'Normal Attack');
  assert.equal(m.burstCount, 5);
  rel(m.burstDelay, 0.11627906976744187);
  rel(m.finalFireRate, 2.58);
});

test('beams: status per tick (not combined over beams), magazine in shots, chains', { skip }, () => {
  const m = mode(modesOf('Amprex', RIFLE), 'Normal Attack');
  rel(m.finalStatusChance, 22);
  assert.equal(m.magazineSize, 200);
  assert.equal(m.ammoConsumption, 1);
  assert.equal(m.chainNumber, 3);
  const alt = mode(modesOf('Coda Bassocyst', SHOTGUN), 'Alt-Fire');
  assert.deepEqual([alt.magazineSize, alt.ammoConsumption, alt.minimumAmmo], [6, 1, 1], 'a 4-round shot: 24 rounds are 6 shots');
});

test('reload models: shell by shell, and a battery that recharges after a delay', { skip }, () => {
  const strun = mode(modesOf('Strun', SHOTGUN), 'Normal Attack');
  rel(strun.reloadTime, 3.75);
  const cycron = mode(modesOf('Cycron', PISTOL), 'Normal Attack');
  rel(cycron.reloadTime, 2);
  assert.equal(cycron.magazineSize, 80);
  assert.equal(S.reloadTimeOf({ reload_time: 2.5, reload_delay: 0.2 }, 21, 2), 2.6, 'a fixed part is not sped up');
});

test('modes without their own crit use the normal attack\'s; status duration includes the mode\'s extra time', { skip }, () => {
  const s = mode(modesOf('Staticor', PISTOL), 'Uncharged Explosion');
  rel(s.finalCritChance, 30.800000000000004);
  rel(s.finalCritMultiplier, 2.203663);
  assert.equal(mode(modesOf('Epitaph Prime', PISTOL), 'Uncharged Direct Hit').finalStatusDuration, 10);
});

test('Progenitor: the default Magnetic 25% joins the base, so mods scale it; the build can set its own', { skip }, () => {
  const types = mode(modesOf('Kuva Bramma', RIFLE), 'Charged Shot').finalDamageTypes;
  for (const [t, v] of Object.entries({ Gas: 1122.7305153539062, Impact: 503.29298964140617, Magnetic: 116.14453607109374 })) rel(types[t], v, 1e-9);
  const heat = mode(modesOf('Kuva Bramma', RIFLE, { progenitor: { element: 'Heat', value: 60 } }), 'Charged Shot').finalDamageTypes;
  assert.equal(heat.Magnetic, undefined);
  assert.deepEqual(S.effectiveProgenitor({ is_progenitor: true }, null), { element: 'Magnetic', value: 25 });
  assert.equal(S.effectiveProgenitor({ is_progenitor: false }, { element: 'Heat', value: 60 }), null);
});

test('combined modes: the data\'s impact-and-explosion picks, the site\'s defaults, and the parts they fire', { skip }, () => {
  const { ctx, data } = real();
  const penta = ctx.weaponByName.get('Penta');
  assert.equal(F.defaultModeId(data, penta, []), 'custom:Grenade Impact (Combined)');
  assert.equal(F.defaultModeId(data, penta, [{ name: 'Napalm Grenades', rank: 3 }]), 'custom:Napalm Grenades (Impact + Explosion + Fire Entry)');
  assert.equal(F.baseModeName(data, penta, 'custom:Grenade Impact (Combined)'), 'Grenade Impact');
  assert.deepEqual(F.modesFired(data, penta, 'custom:Grenade Impact (Combined)'), ['Grenade Impact', 'Grenade Detonation']);
  const ogris = ctx.weaponByName.get('Ogris');
  assert.ok(!F.modeChoices(data, ogris, []).some(c => /Nightwatch/.test(c.id)), 'the augment\'s combined mode needs the augment');
  assert.ok(F.modeChoices(data, ogris, [{ name: 'Nightwatch Napalm', rank: 5 }]).some(c => /Nightwatch/.test(c.id)));
  assert.equal(F.resolveModeId(data, ogris, [], 'custom:Nightwatch Napalm (Impact + Explosion + Field)'), 'custom:Rocket Impact (Combined)');
  // A build keeps a combined pick; the engine gets the weapon's combined modes.
  const { build } = M.normalizeBuild(ctx, { weaponName: 'Penta', modeName: 'custom:Grenade Impact (Combined)' });
  assert.equal(build.modeName, 'custom:Grenade Impact (Combined)');
  const input = engineInputFor(ctx, build, { appStateRef: 1 });
  assert.equal(input.simulationParams.selectedModeName, 'custom:Grenade Impact (Combined)');
  assert.ok(input.build.customFireModes.length >= 3);
  assert.equal(input.simulationParams.useAccurateAmmo, false, 'Penta\'s fire patch costs no ammo, so magazines are off');
});

test('passives: the site\'s defaults (Cantare and Enkaus on), tiers and toggles, engine flags, statuses', { skip }, () => {
  const { ctx, data } = real();
  const cantare = ctx.weaponByName.get('Cantare');
  const on = P.resolveWeaponPassives(data, cantare, M.createBuild(ctx, { weaponName: 'Cantare' }));
  assert.equal(on.totals.cantarePassive, true);
  assert.equal(P.resolveWeaponPassives(data, cantare, { passives: { 'Cantare Passive': 0 } }).totals, null);
  const enkaus = buildStats(ctx, M.createBuild(ctx, { weaponName: 'Enkaus' }));
  rel(enkaus.enemy.hp, M.resolveEnemy(ctx, M.createBuild(ctx).enemy).hp * 0.65);
  assert.ok(enkaus.removedHp > 0, 'the displayed DPS adds the removed health back');
  const lanka = ctx.weaponByName.get('Lanka');
  const scope = entry => P.passiveControl(data.conditionals.passives.find(p => p.name === entry));
  assert.deepEqual([scope('Lanka Scope').kind, scope('Lanka Scope').max], ['tier', 3]);
  const tier3 = P.resolveWeaponPassives(data, lanka, { passives: { 'Lanka Scope': 3 } }).totals;
  rel(tier3.critChance, 0.5);
  const torxica = ctx.weaponByName.get('Dual Coda Torxica');
  const build = { ...M.createBuild(ctx, { weaponName: 'Dual Coda Torxica' }), passives: { 'Dual Coda Torxica Passive': 1 }, externalStatuses: [{ type: 'Cold', stacks: 3 }] };
  assert.deepEqual(targetStatusesOf(ctx, build), [{ type: 'Cold', stacks: 10 }]);
  assert.ok(P.resolveWeaponPassives(data, torxica, build).buffs.some(b => b.id === 'unique_vulnerability'));
});

test('exalted weapons: an extra status proc scaled by ability strength', { skip }, () => {
  const { ctx, data } = real();
  const regulators = ctx.weaponByName.get('Regulators');
  assert.deepEqual(P.resolveWeaponPassives(data, regulators, {}).totals.exaltedProc, { value: 1.5, type: 'add' });
  assert.deepEqual(P.resolveWeaponPassives(data, regulators, { exaltedStrength: 200 }).totals.exaltedProc, { value: 3, type: 'add' });
  const input = engineInputFor(ctx, M.createBuild(ctx, { weaponName: 'Regulators' }), { appStateRef: 1 });
  assert.deepEqual(input.conditionalStats.exaltedProc, { value: 1.5, type: 'add' });
});

test('weapon options are content: stored, cleaned, compared, dropped on a weapon change', { skip }, () => {
  const { ctx } = real();
  const { build } = M.normalizeBuild(ctx, {
    weaponName: 'Kuva Bramma', progenitor: { element: 'Heat', value: 99 }, exaltedStrength: 150, passives: { 'Not A Passive': 1 },
  });
  assert.deepEqual(build.progenitor, { element: 'Heat', value: 60 }, 'capped at 60%');
  assert.equal(build.exaltedStrength, null, 'not an exalted weapon');
  assert.deepEqual(build.passives, {});
  assert.notEqual(M.snapshotOf(build), M.snapshotOf({ ...build, progenitor: null }));
  assert.equal(M.changeWeapon(ctx, build, 'Braton Prime').build.progenitor, null);
  const fresh = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  assert.equal(M.snapshotOf(fresh), M.snapshotOf(M.normalizeBuild(ctx, { ...fresh }).build), 'defaults are left out of the content');
});

test('accurate ammo: on with reload data, off with Infinite Ammo or a free mode, back on for a mode that must count', () => {
  const weapon = { fire_modes: [{ mode_name: 'A', child_mode: ['B'] }, { mode_name: 'B' }] };
  assert.equal(useAccurateAmmo(weapon, [{ mode_name: 'A' }], 'A', { magazine_size: 5 }), true);
  assert.equal(useAccurateAmmo(weapon, [{ mode_name: 'A' }], 'A', null), false);
  assert.equal(useAccurateAmmo(weapon, [{ mode_name: 'A' }], 'A', { magazine_size: 5 }, { infiniteAmmo: true }), false);
  assert.equal(useAccurateAmmo(weapon, [{ mode_name: 'A', disablesAccurateAmmo: true }], 'A', { magazine_size: 5 }), false);
  assert.equal(useAccurateAmmo(weapon, [{ mode_name: 'A', disablesAccurateAmmo: true }, { mode_name: 'B', forceAccurateAmmo: true }], 'A', null), true, 'a child that must count');
});
