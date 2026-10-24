// External buffs, external statuses and buff presets (docs/port-external-buffs.md). The engine tests run the real
// Underframe engine on Braton Prime and check the DPS moves the way the research probes measured; they skip
// when the private core submodule is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as X from '../src/shared/external-buffs.js';
import { indexMods } from '../src/shared/mods.js';
import { ammoConsumptionOf, computeWeaponStats, selectableModes } from '../src/shared/stats.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import { scaleEnemy } from '../src/shared/enemy.js';
import { cleanExternalBuff, cleanExternalStatus, normalizeBuild as storeNormalize } from '../src/main/builds-store.js';
import { cleanPresetLibrary, createBuffPresetsStore } from '../src/main/buff-presets-store.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';
const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

// A small catalogue in the real shape (data.conditionals.external_buffs + data.external_weapon_buffs).
const data = {
  conditionals: {
    external_buffs: [
      { id: 'arcane_pistoleer', name: 'Arcane Pistoleer', input_type: 'toggle', stats: [{ type: 'infiniteAmmo', multiplier: 1 }] },
      { id: 'ext_fire_rate', name: 'External Fire Rate', input_type: 'percentage', stats: [{ type: 'fireRate', multiplier: 1 }] },
      { id: 'ext_elemental', name: 'External Elemental', input_type: 'elemental', stats: [{ type: 'externalElement', multiplier: 1 }] },
      { id: 'ext_combining_element', name: 'External Combining Element', input_type: 'elemental', stats: [{ type: 'externalCombiningElement', multiplier: 1 }] },
      { id: 'resupply', name: 'Resupply', input_type: 'elemental', stats: [{ type: 'resupplyProc', multiplier: 1 }] },
      { id: 'ext_flat_crit_damage', name: 'External Flat Crit Damage', input_type: 'value', stats: [{ type: 'flatCritDamage', multiplier: 1 }] },
      { id: 'unique_vulnerability', name: 'Unique Enemy Vulnerability Multiplier', input_type: 'percentage', stats: [{ type: 'finalMultiplier', multiplier: 1 }] },
      { id: 'seek', name: 'Seek', input_type: 'percentage', stats: [{ type: 'weakPointDamage', multiplier: 0.75 }] },
      { id: 'roar', name: 'Roar', input_type: 'percentage', stats: [{ type: 'factionDamage', multiplier: 1 }] },
      { id: 'valence_formation', name: 'Valence Formation', input_type: 'elemental_fixed', stats: [{ type: 'externalElement', value: 2.0 }, { type: 'valenceFormationProc' }] },
      { id: 'heat_inherit', name: 'Heat Inherit', input_type: 'heat_inherit', stats: [{ type: 'heatInherit' }] },
      { id: 'corrosive_max_stack', name: 'Corrosive Max Stack Increase', input_type: 'numeric', stats: [{ type: 'corrosiveMaxStacks' }] },
      { id: 'ext_melee_damage', name: 'External Melee Damage%', input_type: 'percentage', stats: [{ type: 'meleeDamage', multiplier: 1 }] },
      { id: 'vigilante_set', name: 'Vigilante Set', input_type: 'percentage', requires_weapon_classes: ['Primary'], stats: [{ type: 'vigilanteSet', multiplier: 1 }] },
      { id: 'hydroid_enhanced_corrosive', name: 'Hydroid Passive', input_type: 'toggle', hidden: true, stats: [{ type: 'hydroidEnhancedCorrosive' }] },
      { id: 'ext_serration', name: 'External Weapon Damage%', input_type: 'percentage', stats: [{ type: 'damage', multiplier: 1 }] },
      { id: 'sonar', name: 'Sonar', input_type: 'percentage', stats: [{ type: 'sonarMultiplier', multiplier: 1 }] },
      { id: 'energized_munitions', name: 'Energized Munitions', input_type: 'percentage', stats: [{ type: 'ammoEfficiency', multiplier: 1, stacking: 'multiplicative' }] },
      { id: 'overdrive', name: 'Overdrive', input_type: 'percentage', stats: [{ type: 'overdriveDamage', multiplier: 1 }] },
    ],
  },
  external_weapon_buffs: {
    warframe_abilities: {
      Roar: [{ buff_id: 'roar', scaling_type: 'strength', scaling_multiplier: 0.5 }],
      Sonar: [{ buff_id: 'sonar', scaling_type: 'strength', scaling_multiplier: 5, instances: 2 }],
      Shock: [{ buff_id: 'ext_elemental', element: 'Electricity', scaling_type: 'strength', scaling_multiplier: 1, requires_augment: 'Shock Trooper' }],
      Redline: [
        { buff_id: 'ext_fire_rate', class: 'Melee', class_type: 'include', scaling_type: 'duration', scaling_multiplier: 0.4 },
        { buff_id: 'ext_fire_rate', class: 'Melee', class_type: 'exclude', scaling_type: 'duration', scaling_multiplier: 0.75 },
      ],
      Prowl: [{ buff_id: 'roar', scaling_type: 'strength', scaling_multiplier: 0.4, cap: 1 }],
      'Thermal Sunder': [{ buff_id: 'ext_elemental', element: 'Blast', scaling_type: 'strength', scaling_rank_values: [0.8, 1, 1.2, 1.5], requires_augment: 'Thermal Transfer' }],
    },
    helminth_abilities: { Roar: [{ buff_id: 'roar', scaling_type: 'strength', scaling_multiplier: 0.3 }] },
    passives: [{ warframe: 'Mesa', source_label: 'Passive', buff_id: 'ext_fire_rate', base_value: 0.15, class: 'Secondary' }],
    arcanes: [
      { name: 'Arcane Precision', buff_id: 'ext_serration', native_weapon_types: ['LotusPistol', 'SlingerPistols'], value: 3, weapon_value_overrides: { Regulators: 1.8 } },
      { name: 'Arcane Tempo', buff_id: 'ext_fire_rate', native_weapon_types: ['LotusShotgun'], value: 0.9 },
    ],
    archon_shards: [
      { type: 'violet', buff_id: 'ext_combining_element', element: 'Electricity', class: 'Primary', class_type: 'include', base_value: 0.3, tau_value: 0.45, per_shard_bonus_types: ['crimson', 'azure', 'violet'], per_shard_base_bonus: 0.1, per_shard_tau_bonus: 0.15, effect_matches: ['Gain +30% Primary Electricity Damage.'] },
    ],
    mods: [
      { name: 'Rifle Amp', buff_id: 'ext_serration', mod_names: ['Rifle Amp'], native_weapon_types: ['LotusRifle'], rank_values: [0.045, 0.09, 0.135, 0.18, 0.225, 0.27], value: 0.27, coaction_scaling: true },
    ],
    native_weapon_family_overrides: { Regulators: ['SlingerPistols'] },
  },
};
const rifle = { name: 'Braton', type: 'Primary', subtype: 'Rifle' };
const shotgun = { name: 'Hek', type: 'Primary', subtype: 'Shotgun' };
const pistol = { name: 'Lex', type: 'Secondary', subtype: 'Pistol' };
const row = (id, value, element) => X.buffFromInput(data, id, { value, element }).row;

test('the add form stores fractions for percentages, raw numbers for values, 1 for toggles', () => {
  assert.deepEqual(row('ext_fire_rate', 60), { id: 'ext_fire_rate', name: 'External Fire Rate', value: 0.6 });
  assert.deepEqual(row('resupply', 60, 'Electricity'), { id: 'resupply', name: 'Resupply', value: 0.6, element: 'Electricity' });
  assert.deepEqual(row('ext_flat_crit_damage', 1.2), { id: 'ext_flat_crit_damage', name: 'External Flat Crit Damage', value: 1.2 });
  assert.deepEqual(X.buffFromInput(data, 'arcane_pistoleer').row, { id: 'arcane_pistoleer', name: 'Arcane Pistoleer', value: 1 });
  assert.deepEqual(X.buffFromInput(data, 'heat_inherit', { heat: 225, faction: 55 }).row, { id: 'heat_inherit', name: 'Heat Inherit', value: 2.25, factionValue: 0.55 });
  assert.equal(X.buffFromInput(data, 'corrosive_max_stack', { value: 9 }).row.value, 4, 'clamped to 1-4');
  assert.equal(X.buffFromInput(data, 'ext_fire_rate', { value: 'abc' }).error, 'Please enter a valid number for the buff value.');
  assert.equal(X.buffFromInput(data, 'heat_inherit', { heat: 1 }).error, 'Please enter valid numbers for Heat and Faction values.');
  assert.equal(X.buffFromInput(data, 'resupply', { value: 60 }).error, 'Choose an element.');
  assert.equal(X.buffFromInput(data, 'resupply', { value: 60, element: 'Slash' }).error, 'Choose an element.', 'Resupply takes no physical type');
  assert.ok(X.elementsFor('ext_elemental').includes('Slash'));
  assert.ok(X.elementsFor('external_elemental_vulnerability').includes('Tau'));
});

test('readable lines: name, value, element and source', () => {
  assert.equal(X.buffLine(row('ext_fire_rate', 60), data), 'External Fire Rate · +60%');
  assert.equal(X.buffLine(row('resupply', 60, 'Electricity'), data), 'Resupply · 60% Electricity');
  assert.equal(X.buffLine(row('ext_flat_crit_damage', 1.2), data), 'External Flat Crit Damage · 1.2');
  assert.equal(X.buffLine(X.buffFromInput(data, 'arcane_pistoleer').row, data), 'Arcane Pistoleer · On');
  assert.equal(X.buffLine({ ...row('roar', 50), sourceBuild: 'Roar (Helminth)' }, data), 'Roar · +50% · from Roar (Helminth)');
  // A multiplicative bonus reads as the multiplier it is (×(1 + value)), under the clearer name.
  assert.equal(X.buffLine(row('unique_vulnerability', -20), data), 'Enemy Vulnerability · ×0.8');
  assert.equal(X.statusLine({ type: 'Viral', stacks: 10 }), 'Viral ×10');
});

test('multipliers read as multipliers: Sonar is ×5 at 500%, its field says so, and under 100% it warns', () => {
  const cat = {
    conditionals: {
      external_buffs: [
        { id: 'sonar', name: 'Sonar', input_type: 'percentage', stats: [{ type: 'sonarMultiplier', multiplier: 1 }] },
        { id: 'ext_mult_crit_damage', name: 'External Multiplicative Crit Damage', input_type: 'percentage', stats: [{ type: 'multiplicativeCritDamage', multiplier: 1 }] },
        { id: 'arcsphere_elec', name: 'Arcsphere Elec%', input_type: 'percentage', stats: [{ type: 'externalElementNoDot', multiplier: 3 }] },
        { id: 'ext_fire_rate', name: 'External Fire Rate', input_type: 'percentage', stats: [{ type: 'fireRate', multiplier: 1 }] },
      ],
    },
  };
  const sonar = X.buffCatalogue(cat).byId.get('sonar');
  const inputs = X.buffInputs(sonar);
  assert.equal(inputs.label, 'Multiplier (500% = ×5)');
  assert.equal(inputs.initial, '500', 'the field starts at the typical value, never empty (×0)');
  const five = X.buffFromInput(cat, 'sonar', { value: 500 }).row;
  assert.equal(X.buffLine(five, cat), 'Sonar · ×5');
  assert.equal(X.reduceExternalBuffs([five], cat, { type: 'Primary' }).totals.sonarMultiplier, 5);
  // The reviewers typed 10: that is ×0.1, an 87% loss; the form now says so.
  assert.equal(X.buffLine(X.buffFromInput(cat, 'sonar', { value: 10 }).row, cat), 'Sonar · ×0.1');
  assert.match(X.buffValueWarning('sonar', 10), /lowers damage: 10% is ×0\.1/);
  assert.equal(X.buffValueWarning('sonar', 500), null);
  assert.equal(X.buffLine(X.buffFromInput(cat, 'ext_mult_crit_damage', { value: 50 }).row, cat), 'External Crit Damage Multiplier · ×1.5');
  assert.match(X.buffValueWarning('ext_mult_crit_damage', -50), /lowers damage/);
  assert.equal(X.buffValueWarning('ext_fire_rate', -50), null, 'additive buffs are left alone');
  assert.equal(X.buffInputs(X.buffCatalogue(cat).byId.get('ext_fire_rate')).label, undefined);
  // Names that leaked site internals read plainly; the stored row keeps the site's name.
  const arc = X.buffFromInput(cat, 'arcsphere_elec', { value: 50 }).row;
  assert.equal(arc.name, 'Arcsphere Elec%');
  assert.equal(X.buffLine(arc, cat), 'Arcsphere Electricity · +50%');
  assert.equal(X.buffTypeName(X.buffCatalogue(cat).byId.get('arcsphere_elec')), 'Arcsphere Electricity');
});

test('adding replaces a row with the same key; vulnerability rows append; presets add by summing', () => {
  let list = X.addBuff([], row('ext_fire_rate', 60));
  list = X.addBuff(list, row('ext_fire_rate', 30));
  assert.deepEqual(list.map(b => b.value), [0.3], 'replaced, not summed');
  list = X.addBuff(list, row('ext_elemental', 100, 'Heat'));
  list = X.addBuff(list, row('ext_elemental', 50, 'Cold'));
  assert.equal(list.length, 3, 'different elements are different rows');
  list = X.addBuff(list, row('unique_vulnerability', 50));
  list = X.addBuff(list, row('unique_vulnerability', 50));
  assert.equal(list.filter(b => b.id === 'unique_vulnerability').length, 2);
  const merged = X.mergeBuffLists([row('ext_fire_rate', 60), X.buffFromInput(data, 'arcane_pistoleer').row], [row('ext_fire_rate', 30), X.buffFromInput(data, 'arcane_pistoleer').row], data);
  close(merged[0].value, 0.9);
  assert.equal(merged[1].value, 1, 'toggles stay on');
  assert.deepEqual(X.removeBuffAt(list, 0).map(b => b.id)[0], 'ext_elemental');
});

test('normalising migrates legacy ids and names, drops unknown ids, keeps other classes\' buffs', () => {
  assert.deepEqual(X.normalizeBuff({ id: 'ext_elemental_heat', value: 1 }, data), { id: 'ext_elemental', name: 'External Elemental', value: 1, element: 'Heat' });
  assert.equal(X.normalizeBuff({ id: 'ext_serration', name: 'External Serration', value: 1.8, sourceBuild: 'Ash' }, data).name, 'External Weapon Damage%');
  assert.equal(X.normalizeBuff({ id: 'nope', value: 1 }, data), null);
  assert.equal(X.normalizeBuff({ id: 'ext_melee_damage', value: 1 }, data).id, 'ext_melee_damage');
  assert.equal(X.normalizeBuff({ id: 'unique_vulnerability', name: 'Sonar x5', value: 5 }, data).id, 'sonar');
  assert.equal(X.normalizeBuff({ id: 'ext_elemental', value: 1, element: 'fire' }, data).element, 'Heat');
});

test('which buff types a gun is offered: no hidden, melee or other-class types', () => {
  const ids = w => X.offeredBuffTypes(data, w).map(e => e.id);
  assert.ok(ids(rifle).includes('vigilante_set'));
  assert.ok(!ids(pistol).includes('vigilante_set'), 'Vigilante is Primary only');
  assert.ok(!ids(rifle).includes('ext_melee_damage'));
  assert.ok(!ids(rifle).includes('hydroid_enhanced_corrosive'), 'hidden');
  assert.equal(X.buffSupport('ext_melee_damage', rifle, data).level, 'none');
});

test('reduction: sums, multiplies, pushes and keeps the last per field as the site does', () => {
  const { totals, notes, active } = X.reduceExternalBuffs([
    row('ext_fire_rate', 60), row('seek', 100), row('unique_vulnerability', 50), row('unique_vulnerability', 50),
    row('ext_elemental', 30, 'Slash'), row('ext_elemental', 100, 'Electricity'), row('ext_combining_element', 240, 'Electricity'),
    row('resupply', 60, 'Electricity'), row('sonar', 500), row('energized_munitions', 75), row('overdrive', 25), row('overdrive', 30),
    X.buffFromInput(data, 'valence_formation', { element: 'Heat' }).row, row('ext_melee_damage', 100), row('vigilante_set', 50),
  ], data, rifle);
  close(totals.fireRate, 0.6);
  close(totals.weakPointDamage, 0.75);
  assert.deepEqual(totals.finalMultipliers, [1.5, 1.5]);
  close(totals.ipsSlash, 0.3);
  assert.deepEqual(totals.externalElements, [{ element: 'Electricity', value: 1 }, { element: 'Heat', value: 2 }]);
  assert.deepEqual(totals.externalCombiningElements, [{ element: 'Electricity', value: 2.4 }]);
  assert.deepEqual(totals.resupplyProc, [{ value: 0.6, element: 'Electricity' }]);
  assert.equal(totals.sonarActive, true);
  assert.equal(totals.sonarMultiplier, 5);
  assert.deepEqual(totals.ammoEfficiencyMultipliers, [0.75]);
  close(totals.overdriveDamage, 0.3);
  assert.deepEqual(totals.valenceFormationProc, { element: 'Heat' });
  close(totals.vigilanteSetCritTierChance, 0.3, 1e-12);
  assert.deepEqual(notes.map(n => n.name), ['External Melee Damage%']);
  assert.equal(active, 14);
  const cs = X.externalConditionalStats(totals);
  assert.deepEqual(cs.finalMultipliers, [1.5, 1.5, 1.3], 'Overdrive becomes one more final multiplier');
  assert.equal(cs.overdriveDamage, undefined);
  assert.equal(cs.pageflightMultiplier, undefined, 'defaults are left out');
  assert.deepEqual(X.externalModifiers(totals).physical, { Impact: 0, Puncture: 0, Slash: 0.3 });
});

test('conditionalStats from arcanes and buffs merge: numbers add, lists join', () => {
  const merged = X.mergeConditionalStats({ damage: 0.5, externalHeadshotMultiplierBonus: 0.3 }, { damage: 1, finalMultipliers: [1.5], externalHeadshotMultiplierBonus: 0.2 });
  assert.deepEqual(merged, { damage: 1.5, externalHeadshotMultiplierBonus: 0.5, finalMultipliers: [1.5] });
  assert.equal(X.mergeConditionalStats(null, null), null);
  assert.equal(X.strippedArmor(500, { externalArmorStrip: 0.5 }), 250);
  assert.equal(X.strippedArmor(500, { externalArmorStrip: 2 }), 0);
  assert.equal(X.strippedArmor(500, { externalArmorStrip: 0.5 }, true), 500, 'targets immune to armor strip');
});

test('ammo: efficiency caps at 75% as on the site; multiplicative sources cut the rest; infinite ammo is free', () => {
  close(ammoConsumptionOf(1, 1), 0.25);
  close(ammoConsumptionOf(1, 0.5, [0.5]), 0.25);
  close(ammoConsumptionOf(1, 0.2, [0.5]), 0.4);
  assert.equal(ammoConsumptionOf(1, 0, [], true), 0);
});

test('external statuses: one row per type, whole stacks of at least 1, Corrosive past 10 with the max-stack buff', () => {
  let s = X.addStatus([], 'Viral', 10);
  s = X.addStatus(s, 'Viral', 4);
  assert.deepEqual(s, [{ type: 'Viral', stacks: 4 }]);
  assert.deepEqual(X.addStatus(s, 'Cold', 0), s, 'ignored, as on the site');
  assert.deepEqual(X.addStatus(s, 'Nope', 3), s);
  assert.deepEqual(X.normalizeStatuses([{ type: 'fire', stacks: 2.6 }, { type: 'Heat', stacks: 3 }]), [{ type: 'Heat', stacks: 3 }]);
  assert.equal(X.maxStacksFor('Viral', []), 10);
  assert.equal(X.maxStacksFor('Corrosive', [row('corrosive_max_stack', 3)]), 13);
});

test('sources: strength scales the value, filters pick the weapons, augments gate rows', () => {
  const sources = X.allSources(data);
  const roar = sources.find(s => s.key === 'ability:Roar');
  assert.deepEqual(X.sourceRows(roar, { strength: 200 }, rifle, data), [{ id: 'roar', name: 'Roar', value: 1, sourceBuild: 'Roar' }]);
  const helminth = sources.find(s => s.key === 'helminth:Roar');
  assert.equal(X.sourceRows(helminth, { strength: 100 }, rifle, data)[0].sourceBuild, 'Roar (Helminth)');
  const prowl = sources.find(s => s.key === 'ability:Prowl');
  assert.equal(X.sourceRows(prowl, { strength: 400 }, rifle, data)[0].value, 1, 'capped');
  const redline = sources.find(s => s.key === 'ability:Redline');
  assert.deepEqual(X.sourceRows(redline, { duration: 100 }, rifle, data).map(r => r.value), [0.75], 'only the non-melee row reaches a gun');
  const sonar = sources.find(s => s.key === 'ability:Sonar');
  assert.equal(X.sourceRows(sonar, { strength: 100 }, rifle, data).length, 2, 'two instances');
  const shock = sources.find(s => s.key === 'ability:Shock');
  assert.deepEqual(X.sourceRows(shock, { strength: 100, augments: {} }, rifle, data), [], 'needs Shock Trooper');
  assert.equal(X.sourceRows(shock, { strength: 100, augments: { 'Shock Trooper': true } }, rifle, data)[0].element, 'Electricity');
  const sunder = sources.find(s => s.key === 'ability:Thermal Sunder');
  close(X.sourceRows(sunder, { strength: 100, augmentRank: 3, augments: { 'Thermal Transfer': true } }, rifle, data)[0].value, 1.5);
  const mesa = sources.find(s => s.key === 'passive:Mesa Passive');
  assert.deepEqual(X.sourceRows(mesa, {}, rifle, data), [], 'Mesa\'s passive is for secondaries');
  assert.equal(X.sourceRows(mesa, {}, pistol, data)[0].value, 0.15);
  const precision = sources.find(s => s.key === 'arcane:Arcane Precision');
  assert.equal(X.sourceRows(precision, {}, { name: 'Regulators', type: 'Secondary' }, data)[0].value, 1.8, 'weapon override, native family override');
  const tempo = sources.find(s => s.key === 'arcane:Arcane Tempo');
  assert.equal(X.sourceRows(tempo, {}, rifle, data).length, 0);
  assert.equal(X.sourceRows(tempo, {}, shotgun, data).length, 1);
  const shard = sources.find(s => s.kind === 'shard');
  close(X.sourceRows(shard, { tauforged: true, shardTypes: 5, shardCount: 1 }, rifle, data)[0].value, 0.45 + 0.75);
  close(X.sourceRows(shard, { tauforged: false, shardTypes: 1, shardCount: 2 }, rifle, data)[0].value, 0.8);
  const amp = sources.find(s => s.kind === 'mod');
  close(X.sourceRows(amp, { modRank: 5, coaction: true }, rifle, data)[0].value, 0.27 * 1.15 ** 2);
  assert.ok(X.sourcesFor(data, rifle).every(s => X.sourceRows(s, X.defaultSourceOptions(s), rifle, data).length));
  // Re-adding a source replaces its rows; another source's rows of the same buff stay.
  let list = X.addSourceRows([], X.sourceRows(roar, { strength: 100 }, rifle, data));
  list = X.addSourceRows(list, X.sourceRows(roar, { strength: 200 }, rifle, data));
  list = X.addSourceRows(list, X.sourceRows(helminth, { strength: 100 }, rifle, data));
  assert.deepEqual(list.map(r => [r.sourceBuild, r.value]), [['Roar', 1], ['Roar (Helminth)', 0.3]]);
});

test('presets: the site\'s library shape, unique names, Custom when nothing matches, rows filtered per weapon', () => {
  let ids = 0;
  const newId = () => `p${++ids}`;
  const lib = X.normalizePresetLibrary({ version: 1, presets: [{ name: ' Zeta ', buffs: [row('ext_fire_rate', 60)] }, { name: 'zeta', buffs: [] }, { name: '', buffs: [] }, { id: '__custom__', name: 'Alpha', buffs: [row('ext_melee_damage', 100), row('roar', 50)] }] }, { data, newId });
  assert.deepEqual(lib.presets.map(p => [p.id, p.name]), [['p2', 'Alpha'], ['p1', 'Zeta']]);
  assert.equal(X.matchingPreset(lib, [row('ext_fire_rate', 60)])?.name, 'Zeta');
  assert.equal(X.matchingPreset(lib, [row('ext_fire_rate', 61)]), null, 'Custom');
  assert.deepEqual(X.presetRowsFor(lib.presets[0], data, rifle).map(b => b.id), ['roar'], 'melee rows dropped when applied to a gun');
  assert.equal(X.savePreset(lib, 'x', []).error, 'Add at least one buff before saving a preset.');
  assert.equal(X.savePreset(lib, '  ', [row('roar', 1)]).error, 'Enter a name for the buff preset.');
  assert.equal(X.savePreset(lib, 'ZETA', [row('roar', 1)]).confirm, 'Replace the existing buff preset "Zeta"?');
  const replaced = X.savePreset(lib, 'ZETA', [row('roar', 1)], { replace: true, newId });
  assert.equal(replaced.preset.id, 'p1', 'replacing keeps the id');
  assert.equal(replaced.library.presets.length, 2);
  assert.equal(X.savePreset(lib, 'x'.repeat(100), [row('roar', 1)], { newId }).preset.name.length, 80);
  assert.deepEqual(X.deletePreset(lib, 'p1').presets.map(p => p.name), ['Alpha']);
});

test('the builds store keeps external buffs and statuses; the preset store round-trips the library', async () => {
  const saved = storeNormalize({
    weaponName: 'Braton', mods: [], enemy: {},
    externalBuffs: [{ id: 'resupply', name: 'Resupply', value: 0.6, element: 'Electricity', extra: 1 }, { id: 'x' }],
    externalStatuses: [{ type: 'Viral', stacks: 10 }, { type: 'Cold', stacks: 0 }],
  });
  assert.deepEqual(saved.externalBuffs, [{ id: 'resupply', name: 'Resupply', value: 0.6, element: 'Electricity' }]);
  assert.deepEqual(saved.externalStatuses, [{ type: 'Viral', stacks: 10 }]);
  assert.equal(storeNormalize({ weaponName: 'Braton', mods: [], enemy: {} }).externalBuffs, undefined, 'older builds stay as they were');
  assert.equal(cleanExternalBuff({ id: 'heat_inherit', value: 2.25, factionValue: 0.55 }).factionValue, 0.55);
  assert.equal(cleanExternalStatus({ type: 'Heat', stacks: 150 }).stacks, 99);
  assert.deepEqual(cleanPresetLibrary([{ name: 'A', buffs: [] }, { name: 'a', buffs: [] }], { randomUUID: () => 'id' }), { version: 1, presets: [{ id: 'id', name: 'A', buffs: [] }] });

  const dir = mkdtempSync(path.join(os.tmpdir(), 'uf-presets-'));
  try {
    const store = createBuffPresetsStore(dir, { randomUUID: () => 'fixed' });
    assert.deepEqual(await store.get(), { version: 1, presets: [] });
    await store.set({ version: 1, presets: [{ name: 'Mine', buffs: [{ id: 'roar', name: 'Roar', value: 0.5 }] }] });
    assert.deepEqual(await store.get(), { version: 1, presets: [{ id: 'fixed', name: 'Mine', buffs: [{ id: 'roar', name: 'Roar', value: 0.5 }] }] });
    writeFileSync(store.file, '{ broken');
    assert.deepEqual(await store.get(), { version: 1, presets: [] }, 'an unreadable file reads as empty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the real engine ----------

async function setup() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  const real = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  return { engine, data: real, index: indexMods(real) };
}

const MODS = [
  { name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 },
  { name: 'Vital Sense', rank: 5 }, { name: 'Infected Clip', rank: 5 },
];

/** Braton Prime with the probe build, vs a level 1 Grineer with 1e6 HP, 20 s, seed 11 (the doc's section 9). */
function simulate({ engine, data: real, index }, { buffs = [], statuses = [], armor = 0, appStateRef = null } = {}) {
  const weapon = real.weapons.find(w => w.name === 'Braton Prime');
  const reload = real.reload_data.find(r => r.name === weapon.name) ?? null;
  const enemy = scaleEnemy({ base_hp: 1e6, base_armor: armor, base_level: 1, faction: 'Grineer' }, { level: 1 });
  const rows = buffs.map(([id, value, element]) => X.buffFromInput(real, id, { value, element }).row);
  const external = rows.length ? X.reduceExternalBuffs(rows, real, weapon).totals : null;
  const { modes } = computeWeaponStats(weapon, MODS, { modsByName: index.byName, reload, targetFaction: 'Grineer', external });
  const appState = buildAppState(real, weapon, { externalStatuses: statuses });
  if (appStateRef != null) engine.cache_app_state(appStateRef, JSON.stringify(appState));
  const input = buildEngineInput({
    weapon, modSlots: MODS, weaponStats: modes, enemy, modeName: selectableModes(weapon)[0].mode_name, maxTime: 20, reload,
    appStateRef, appState: appStateRef == null ? appState : undefined, debugLog: false, external,
  });
  engine.seed_rng(11);
  const r = JSON.parse(engine.calculate_dps_wasm(JSON.stringify(input)));
  assert.equal(r.error, undefined, r.error);
  return r;
}

const gain = (r, base) => r.avgDps / base.avgDps - 1;

// These are the app's own numbers (regression values) after the parity fixes (damage quantization,
// nonCritDamageMultiplier 0). The independent check is the next test, which replays underframe.site's own captures.
test('engine: external buffs move DPS as the probes measured (Braton Prime)', { skip, timeout: 120_000 }, async () => {
  const ctx = await setup();
  const base = simulate(ctx);
  close(base.avgDps, 9196.1, 1);
  // Fire rate is folded into weaponStats (the engine ignores it as a conditionalStats field): +50.9%.
  close(gain(simulate(ctx, { buffs: [['ext_fire_rate', 60]] }), base), 0.509, 0.002);
  // External Elemental 100% Electricity: +26.8% DPS, +51.6% first hit (weaponStats plus the DoT list).
  const elec = simulate(ctx, { buffs: [['ext_elemental', 100, 'Electricity']] });
  close(gain(elec, base), 0.268, 0.002);
  close(elec.firstHitDamage / base.firstHitDamage - 1, 0.516, 0.002);
  // External Combining Element 240% Electricity joins Infected Clip's Toxin into Corrosive: first hit 179.7 -> 556.5.
  const combining = simulate(ctx, { buffs: [['ext_combining_element', 240, 'Electricity']] });
  close(gain(combining, base), 1.176, 0.002);
  close(combining.firstHitDamage, 556.5, 0.1);
  // Flat crit damage adds to the final crit multiplier: +21.4%.
  close(gain(simulate(ctx, { buffs: [['ext_flat_crit_damage', 1.2]] }), base), 0.214, 0.002);
  // Resupply is an extra proc the engine applies itself: DPS +152.1%, first hit unchanged.
  const resupply = simulate(ctx, { buffs: [['resupply', 60, 'Electricity']] });
  close(gain(resupply, base), 1.521, 0.002);
  close(resupply.firstHitDamage, base.firstHitDamage, 1e-6);
  // The screenshot's list together.
  const all = simulate(ctx, { buffs: [['resupply', 60, 'Electricity'], ['ext_fire_rate', 60], ['ext_elemental', 298, 'Electricity'], ['ext_combining_element', 240, 'Electricity'], ['ext_flat_crit_damage', 1.2]] });
  close(all.avgDps, 283018.9, 5);
  // External Armor Strip lowers the target's armor (the engine ignores it as a conditionalStats field).
  const armored = simulate(ctx, { armor: 500 });
  assert.ok(simulate(ctx, { armor: 500, buffs: [['ext_armor_strip', 50]] }).avgDps > armored.avgDps * 1.15);
});

test('engine: external statuses count only in the cached app state, and Viral x10 is +325%', { skip, timeout: 120_000 }, async () => {
  const ctx = await setup();
  const base = simulate(ctx, { appStateRef: 1 });
  const viral = simulate(ctx, { appStateRef: 2, statuses: [{ type: 'Viral', stacks: 10 }] });
  close(gain(viral, base), 3.25, 0.002);
  const cold = simulate(ctx, { appStateRef: 3, statuses: [{ type: 'Cold', stacks: 10 }] });
  close(gain(cold, base), 0.179, 0.002);
  close(cold.firstHitDamage, base.firstHitDamage, 1e-6);
});

// ---------- the build model (real data) ----------

test('model: buffs and statuses are build content (undo, unsaved changes), re-simulate, and pin as changes', { skip }, async () => {
  const M = await import('../src/renderer/model.js');
  const real = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  const ctx = M.createContext(real);
  const plain = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  assert.deepEqual(plain.externalBuffs, []);
  assert.equal(JSON.stringify(M.contentOf(plain)).includes('external'), false, 'left out while empty, so older builds compare equal');
  const fire = X.buffFromInput(real, 'ext_fire_rate', { value: 60 }).row;
  const buffed = { ...plain, externalBuffs: [fire], externalStatuses: [{ type: 'Viral', stacks: 10 }] };
  assert.notEqual(M.snapshotOf(buffed), M.snapshotOf(plain));
  assert.notEqual(M.simKeyOf(ctx, buffed), M.simKeyOf(ctx, plain));
  assert.equal(M.simKeyOf(ctx, { ...plain, externalBuffs: [] }), M.simKeyOf(ctx, plain));
  // Undo restores content: content without buffs means none.
  assert.deepEqual(M.withContent(buffed, M.contentOf(plain)).externalBuffs, []);
  assert.deepEqual(M.withContent(plain, M.contentOf(buffed)).externalStatuses, [{ type: 'Viral', stacks: 10 }]);
  // Saved and read back.
  const { build: reread } = M.normalizeBuild(ctx, storeNormalize({ ...buffed, id: 'x' }));
  assert.deepEqual(reread.externalBuffs, [fire]);
  assert.deepEqual(reread.externalStatuses, [{ type: 'Viral', stacks: 10 }]);
  // Compare pins record them and say what differs.
  const summary = { avgDps: 1, ttk: 1, runs: 8 };
  const a = M.makePin(plain, summary, 'a', null, real);
  const b = M.makePin(buffed, summary, 'b', null, real);
  assert.deepEqual(M.pinChanges(b, a), ['+External Fire Rate · +60%', '+Viral ×10']);
  assert.equal(a.config.externalBuffs, undefined);
});

test('model: featured builds bring their external buffs and statuses, and say so', { skip }, async () => {
  const M = await import('../src/renderer/model.js');
  const real = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  const ctx = M.createContext(real);
  const withBuffs = ctx.featured.filter(f => f.source.externalBuffs?.length || f.source.externalStatuses?.length);
  assert.ok(withBuffs.length >= 20, `${withBuffs.length} featured gun builds carry external buffs or statuses`);
  for (const f of withBuffs) {
    const { build, notes } = M.buildFromFeatured(ctx, f);
    assert.equal(build.externalBuffs.length, (f.source.externalBuffs ?? []).length, f.name);
    assert.equal(build.externalStatuses.length, (f.source.externalStatuses ?? []).length, f.name);
    assert.ok(!M.unappliedFeatures(f.source).includes('external buffs'), f.name);
    assert.ok(notes.some(n => /are applied; Buffs in the Readout lists them\./.test(n)), f.name);
  }
});

test('engine: every buff type and source offered for a rifle and a pistol simulates without an engine error', { skip, timeout: 300_000 }, async () => {
  const ctx = await setup();
  const { engine, data: real, index } = ctx;
  for (const name of ['Braton Prime', 'Lex Prime']) {
    const weapon = real.weapons.find(w => w.name === name);
    const reload = real.reload_data.find(r => r.name === weapon.name) ?? null;
    const enemy = scaleEnemy({ base_hp: 1e5, base_armor: 300, base_level: 1, faction: 'Grineer' }, { level: 1 });
    const lists = [
      ...X.offeredBuffTypes(real, weapon).map(e => {
        const inputs = X.buffInputs(e);
        return [X.buffFromInput(real, e.id, { value: inputs.value === 'percent' ? 50 : 2, element: X.elementsFor(e.id)[3], heat: 225, faction: 55 }).row];
      }),
      ...X.sourcesFor(real, weapon).map(s => X.sourceRows(s, X.defaultSourceOptions(s), weapon, real)),
    ];
    const appState = buildAppState(real, weapon, { externalStatuses: [{ type: 'Corrosive', stacks: 10 }, { type: 'Viral', stacks: 10 }] });
    engine.cache_app_state(9, JSON.stringify(appState));
    for (const rows of lists) {
      const external = X.reduceExternalBuffs(rows, real, weapon).totals;
      const { modes } = computeWeaponStats(weapon, [], { modsByName: index.byName, reload, targetFaction: 'Grineer', external });
      const input = buildEngineInput({ weapon, modSlots: [], weaponStats: modes, enemy, modeName: selectableModes(weapon)[0].mode_name, maxTime: 5, reload, appStateRef: 9, debugLog: false, external });
      engine.seed_rng(1);
      const r = JSON.parse(engine.calculate_dps_wasm(JSON.stringify(input)));
      assert.equal(r.error, undefined, `${name} with ${rows.map(b => b.id).join(', ')}: ${r.error}`);
      assert.ok(Number.isFinite(r.avgDps) && r.avgDps > 0, `${name} with ${rows.map(b => b.id).join(', ')}: ${r.avgDps}`);
    }
  }
});
