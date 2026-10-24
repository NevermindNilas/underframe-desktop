import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineElements, combinationOf } from '../src/shared/damage.js';
import { scaleEnemy, healthMultiplier } from '../src/shared/enemy.js';
import { baneFamilyOfStat, resolveFaction } from '../src/shared/factions.js';
import { statValue, isModCompatible, conflictingMod } from '../src/shared/mods.js';
import { collectModifiers, computeFireMode, selectableModes } from '../src/shared/stats.js';

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test('elements combine in slot order, innate elements last', () => {
  assert.equal(combinationOf('Toxin', 'Electricity'), 'Corrosive');
  assert.deepEqual(combineElements([['Heat', 10], ['Cold', 5]]), { Blast: 15 });
  assert.deepEqual(combineElements([['Heat', 10], ['Cold', 5], ['Toxin', 3]]), { Blast: 15, Toxin: 3 });
  // a later source of an already-combined primary joins that combination
  assert.deepEqual(combineElements([['Heat', 10], ['Cold', 5], ['Heat', 2]]), { Blast: 17 });
  // pre-combined elements never pair
  assert.deepEqual(combineElements([['Radiation', 4], ['Toxin', 3]]), { Radiation: 4, Toxin: 3 });
  assert.deepEqual(combineElements([['Toxin', 1], ['Electricity', 1], ['Heat', 1], ['Cold', 1]]), { Corrosive: 2, Blast: 2 });
});

test('mod values scale with rank', () => {
  assert.equal(statValue({ Value: '0.15' }, 10), 1.65);
  assert.equal(statValue({ Value: '0.15' }, 0), 0.15);
  assert.equal(statValue({ Value: '9', RankValues: [1, 2, 3] }, 5), 3);
});

test('bane stats map to faction families', () => {
  assert.equal(baneFamilyOfStat({ LocTag: '/Lotus/Language/Upgrades/WeaponFactionDamageGrineerDesc' }), 'Grineer');
  assert.equal(baneFamilyOfStat({ LocTag: '/Lotus/Language/Mods/WeaponFactionDamageOrokinDesc' }), 'Corrupted');
  assert.equal(resolveFaction('zariman').name, 'Zariman');
  assert.equal(resolveFaction('corrupted').name, 'Orokin');
  assert.equal(resolveFaction('Kuva Grineer').bane, 'Grineer');
});

test('enemy scaling matches the game curves', () => {
  assert.equal(healthMultiplier('grineer', 0), 1);
  const lvl1 = scaleEnemy({ base_hp: 1000, base_armor: 0, base_shields: 0, base_level: 1, faction: 'grineer' }, { level: 1 });
  assert.deepEqual(lvl1, { faction: 'Grineer', level: 1, hp: 1000, armor: 0, shields: 0, overguard: 0 });
  const hp100 = 1000 * (1 + (24 * Math.sqrt(5) / 5) * 99 ** 0.72);
  const lvl100 = scaleEnemy({ base_hp: 1000, base_armor: 100, base_level: 1, faction: 'grineer' }, { level: 100, steelPath: true });
  assert.equal(lvl100.hp, Math.round(hp100 * 2.5));
  assert.equal(lvl100.armor, Math.round(100 * (1 + 0.4 * 99 ** 0.75)));
  assert.equal(scaleEnemy({ base_armor: 5000, base_level: 1 }, { level: 200 }).armor, 2700);
});

const rifle = { name: 'Kuva Sobek', type: 'Primary', subtype: 'Shotgun', fire_modes: [{ mode_name: 'a' }] };
test('mod compatibility follows type, compat tag and weapon family', () => {
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Shotgun' }, rifle));
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'PRIMARY' }, rifle));
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Sobek' }, rifle), 'an augment fits its family');
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Sobek' }, { ...rifle, name: 'Sobekian' }));
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle' }, rifle));
  assert.ok(!isModCompatible({ Type: 'SECONDARY', 'Compat Name': 'Shotgun' }, rifle));
  // The game's tags: an excluded tag rejects; required tags need one match (on weapons that list their classes).
  const tagged = { name: 'Braton', type: 'Primary', subtype: 'Rifle', compatibility_tags: ['PROJECTILE', 'AUTO'], mod_compatibility_types: ['/Lotus/Weapons/Tenno/Rifle/LotusRifle'], fire_modes: [{ mode_name: 'a' }] };
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle' }, tagged));
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', incompatibility_tags: ['AUTO'] }, tagged));
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', compatibility_tags: ['BEAM'] }, tagged));
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', compatibility_tags: ['BEAM', 'AUTO'] }, tagged));
  // A mod listing native weapon classes fits by that list (Adhesive Blast on launchers).
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Unique', native_item_compatibility: ['/Lotus/Weapons/Tenno/Rifle/LotusRifle'] }, tagged));
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', native_item_compatibility: ['/Lotus/Weapons/Tenno/Bows/LotusBow'] }, tagged));
  // Tainted Mag fits real rifles only; Semi-Cannonade needs a weapon that takes it.
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', 'Local Name': 'Tainted Mag' }, { ...tagged, subtype: 'Sniper' }));
  assert.ok(!isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', 'Local Name': 'Semi-Rifle Cannonade' }, tagged));
  assert.ok(isModCompatible({ Type: 'PRIMARY', 'Compat Name': 'Rifle', 'Local Name': 'Semi-Rifle Cannonade' }, { ...tagged, cannonade_compatible: true }));
  const index = { incompatible: new Map([['Serration', new Set(['Amalgam Serration'])]]) };
  assert.equal(conflictingMod('Serration', ['Amalgam Serration'], index), 'Amalgam Serration');
  assert.equal(conflictingMod('Serration', ['Serration'], index), 'Serration');
  assert.equal(conflictingMod('Serration', ['Split Chamber', null], index), null);
});

const MODS = new Map([
  ['Serration', { Stats: [{ UpgradeType: 'WEAPON_DAMAGE_AMOUNT', DamageType: 'DT_ANY', Value: '0.15' }] }],
  ['Hellfire', { Stats: [{ UpgradeType: 'WEAPON_PERCENT_BASE_DAMAGE_ADDED', DamageType: 'DT_FIRE', Value: '0.15' }] }],
  ['Cryo Rounds', { Stats: [{ UpgradeType: 'WEAPON_PERCENT_BASE_DAMAGE_ADDED', DamageType: 'DT_FREEZE', Value: '0.15' }] }],
  ['Rupture', { Stats: [{ UpgradeType: 'WEAPON_PERCENT_BASE_DAMAGE_ADDED', DamageType: 'DT_IMPACT', Value: '0.05' }] }],
  ['Split Chamber', { Stats: [{ UpgradeType: 'WEAPON_FIRE_ITERATIONS', DamageType: 'DT_ANY', Value: '0.15' }] }],
  ['Point Strike', { Stats: [{ UpgradeType: 'WEAPON_CRIT_CHANCE', DamageType: 'DT_ANY', Value: '0.25' }] }],
  ['Bane of Grineer', { Stats: [{ UpgradeType: 'GAMEPLAY_FACTION_DAMAGE', DamageType: 'DT_ANY', Value: '0.05', LocTag: '/Lotus/Language/Upgrades/WeaponFactionDamageGrineerDesc' }] }],
]);

test('fire mode stats follow Warframe stacking rules', () => {
  const mode = {
    mode_name: 'Normal', base_damage: 100, crit_chance: 20, crit_multiplier: 2, status_chance: 10, fire_rate: 10, multishot: 1,
    innate_elements: { Impact: 50, Puncture: 50 },
  };
  const slots = [
    { name: 'Serration', rank: 10 }, { name: 'Hellfire', rank: 5 }, { name: 'Cryo Rounds', rank: 5 },
    { name: 'Rupture', rank: 5 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 },
    { name: 'Bane of Grineer', rank: 5 }, null,
  ];
  const m = collectModifiers(slots, MODS, 'Grineer');
  const s = computeFireMode(mode, m, { magazine_size: 30, reload_time: 2 });

  const dmg = 1 + 1.65;
  // Each type is quantized to steps of base / 32 (100 / 32 = 3.125) before the damage multiplier.
  const q = v => Math.round(v / 3.125) * 3.125;
  close(s.finalDamageTypes.Impact, q(50 * 1.3) * dmg);
  close(s.finalDamageTypes.Puncture, q(50) * dmg);
  close(s.finalDamageTypes.Blast, q(100 * 0.9 + 100 * 0.9) * dmg);
  assert.equal(s.finalDamageTypes.Heat, undefined);
  close(s.totalFinalDamage, Object.values(s.finalDamageTypes).reduce((a, b) => a + b));
  close(s.finalMultishot, 1.9);
  close(s.finalCritChance, 20 * 2.5);
  close(s.perProjectileStatusChance, 10);
  close(s.finalStatusChance, (1 - 0.9 ** 1.9) * 100);
  close(s.factionDamage, 0.3);
  assert.equal(collectModifiers(slots, MODS, 'Corpus').factionDamage, 0);
  assert.equal(s.magazineSize, 30);
});

test('child modes are not selectable on their own', () => {
  const w = { fire_modes: [{ mode_name: 'Hit', child_mode: ['Hit AoE'] }, { mode_name: 'Hit AoE' }, { mode_name: 'Alt' }] };
  assert.deepEqual(selectableModes(w).map(m => m.mode_name), ['Hit', 'Alt']);
});
