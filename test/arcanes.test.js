// Weapon arcanes: compatibility, rank and stack scaling, and how their effects reach the engine input. Pure: no engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcaneSlotCount, arcaneSlotCategory, arcanesFor, isArcaneCompatible, arcaneMaxRank, rankFactor, arcaneSupport,
  arcaneControls, defaultArcaneOptions, normalizeArcaneEntry, resolveArcanes, arcaneModifiersFor,
  arcaneConditionalStats, arcaneNotes, unsimulatedArcanes, arcaneSummary, arcaneStacksText,
} from '../src/shared/arcanes.js';
import { computeWeaponStats } from '../src/shared/stats.js';
import { buildEngineInput } from '../src/shared/engine-input.js';

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

// A small data.json in the real shapes (data.arcanes + data.conditionals.arcanes). No images.
const RIFLE = '/Lotus/Weapons/Tenno/Rifle/LotusRifle';
const LONGGUN = '/Lotus/Weapons/Tenno/LotusLongGun';
const SHOTGUN = '/Lotus/Weapons/Tenno/Shotgun/LotusShotgun';
const LONGBOW = '/Lotus/Weapons/Tenno/Bows/LotusLongBow';
const PISTOL = '/Lotus/Weapons/Tenno/Pistol/LotusPistol';
const AKIMBO = '/Lotus/Weapons/Tenno/Akimbo/LotusAkimbo';
const arcane = (name, extra = {}) => ({ arcane_name: name, image_url: `https://example.invalid/${name.replace(/ /g, '')}.png`, max_rank_description: `${name} effect`, ...extra });
const data = {
  arcanes: [
    arcane('Primary Merciless', { max_rank_description: 'On Kill/Passive:\n+30% Damage for 4s. Stacks up to 12x.\n+30% Reload Speed' }),
    arcane('Primary Deadhead'),
    arcane('Primary Frostbite'),
    arcane('Primary Plated Round', { native_item_compatibility: [LONGGUN] }),
    arcane('Primary Exhilarate'),
    arcane('Shotgun Vendetta', { native_item_compatibility: [SHOTGUN] }),
    arcane('Longbow Sharpshot', { native_item_compatibility: [LONGBOW] }),
    arcane('Fractalized Reset'),
    arcane('Secondary Merciless'),
    arcane('Secondary Encumber'),
    arcane('Secondary Enervate'),
    arcane('Secondary Fortifier'),
    arcane('Secondary Cryogenic'),
    arcane('Secondary Kinship'),
    arcane('Akimbo Slip Shot', { native_item_compatibility: [AKIMBO] }),
    arcane('Cascadia Flare'),
    arcane('Pax Bolt'),
    arcane('Residual Shock'),
    arcane('Arcane Avenger'),
    arcane('Melee Exposure'),
  ],
  conditionals: {
    arcanes: [
      { name: 'Primary Merciless', type: 'Primary', trigger: 'On Kill', buffs: [{ type: 'Damage', value: 0.3, max_stacks: 12, duration_seconds: 20 }], non_conditional_buffs: [{ type: 'Reload Speed', value: 0.3 }] },
      { name: 'Secondary Merciless', type: 'Secondary', trigger: 'On Kill', buffs: [{ type: 'Damage', value: 0.3, max_stacks: 12 }], non_conditional_buffs: [{ type: 'Reload Speed', value: 0.3 }] },
      { name: 'Primary Deadhead', type: 'Primary', trigger: 'On Headshot Kill', buffs: [{ type: 'Damage', value: 1.2, max_stacks: 3 }, { type: 'Deadhead', value: 1.3 }] },
      { name: 'Primary Frostbite', type: 'Primary', trigger: 'On Cold Status Effect', buffs: [{ type: 'Critical Damage', value: 0.03, max_stacks: 40 }, { type: 'Multishot', value: 0.0225, max_stacks: 40 }] },
      { name: 'Shotgun Vendetta', type: 'Shotgun', trigger: 'On Kill', buffs: [{ type: 'Multishot', value: 1.8, max_stacks: 1 }, { type: 'Reload Speed', value: 0.75, max_stacks: 1 }] },
      { name: 'Longbow Sharpshot', type: 'Bow', trigger: 'On Headshot', buffs: [{ type: 'Sharpshot Bonus', value: 1, max_stacks: 3 }] },
      { name: 'Fractalized Reset', type: 'Primary', trigger: 'On Ability Cast', buffs: [{ type: 'Reload Speed', value: 2.4, max_stacks: 1 }] },
      { name: 'Secondary Encumber', type: 'Secondary', trigger: 'On Proc', buffs: [{ type: 'Random Status Chance', value: 0.24 }] },
      { name: 'Secondary Enervate', type: 'Secondary', trigger: 'On Hit', buffs: [{ type: 'Enervate Crit Chance Bonus', value: 0.1 }] },
      { name: 'Secondary Fortifier', type: 'Secondary', trigger: 'On Hit', buffs: [{ type: 'Overguard Damage Multiplier', value: 8 }] },
      { name: 'Akimbo Slip Shot', type: 'Secondary', trigger: 'While sliding', buffs: [{ type: 'Ammo Efficiency', value: 0.65, max_stacks: 1 }] },
      { name: 'Cascadia Flare', type: 'Secondary', trigger: 'On Heat Status Effect', buffs: [{ type: 'Damage', value: 0.12, max_stacks: 40 }] },
      { name: 'Melee Exposure', type: 'Melee', trigger: 'On Ability Cast', buffs: [{ type: 'External Element Damage', value: 0.6, max_stacks: 4 }] },
    ],
  },
};

const mode = (extra = {}) => ({ mode_name: 'Normal Attack', base_damage: 100, innate_elements: { Impact: 20, Puncture: 30, Slash: 50 }, crit_chance: 0.2, crit_multiplier: 2, status_chance: 10, fire_rate: 10, multishot: 1, ammo_cost: 1, ...extra });
const weapon = (name, type, subtype, compat, extra = {}) => ({ name, type, subtype, mod_compatibility_types: compat, fire_modes: [mode()], ...extra });
const RIFLE_W = weapon('Braton Prime', 'Primary', 'Rifle', [RIFLE, LONGGUN]);
const SHOTGUN_W = weapon('Hek', 'Primary', 'Shotgun', [SHOTGUN, LONGGUN]);
const BOW_W = weapon('Lenz', 'Primary', 'Bow', [LONGBOW, LONGGUN]);
const PISTOL_W = weapon('Lex Prime', 'Secondary', 'Pistol', [PISTOL]);
const AKIMBO_W = weapon('Akstiletto Prime', 'Secondary', 'Pistol', [AKIMBO, PISTOL]);
const KITGUN_W = weapon('Catchmoon (Secondary)', 'Secondary', 'Pistol', [PISTOL], { is_modular: true });
const MELEE_W = weapon('Skana', 'Melee', 'Sword', []);
const names = list => list.map(a => a.name);

test('guns have one arcane slot, kitguns a second one for Pax and Residual arcanes', () => {
  assert.equal(arcaneSlotCount(RIFLE_W), 1);
  assert.equal(arcaneSlotCount(PISTOL_W), 1);
  assert.equal(arcaneSlotCount(KITGUN_W), 2);
  assert.equal(arcaneSlotCount(MELEE_W), 0);
  assert.equal(arcaneSlotCount(null), 0);
  assert.equal(arcaneSlotCategory(KITGUN_W, 1), 'Kitgun');
  assert.equal(arcaneSlotCategory(KITGUN_W, 0), 'Secondary');
  assert.deepEqual(names(arcanesFor(KITGUN_W, data, 1)), ['Pax Bolt', 'Residual Shock']);
  assert.equal(isArcaneCompatible('Primary Merciless', RIFLE_W, data, 1), false, 'no second slot on a rifle');
});

test('each gun class gets its own arcanes, and class arcanes follow their compatibility list', () => {
  assert.deepEqual(names(arcanesFor(RIFLE_W, data)), ['Fractalized Reset', 'Primary Deadhead', 'Primary Exhilarate', 'Primary Frostbite', 'Primary Merciless', 'Primary Plated Round']);
  assert.ok(names(arcanesFor(SHOTGUN_W, data)).includes('Shotgun Vendetta'));
  assert.ok(!names(arcanesFor(RIFLE_W, data)).includes('Shotgun Vendetta'));
  assert.ok(names(arcanesFor(BOW_W, data)).includes('Longbow Sharpshot'));
  assert.ok(!names(arcanesFor(SHOTGUN_W, data)).includes('Longbow Sharpshot'));
  const pistol = names(arcanesFor(PISTOL_W, data));
  assert.deepEqual(pistol, ['Cascadia Flare', 'Secondary Cryogenic', 'Secondary Encumber', 'Secondary Enervate', 'Secondary Fortifier', 'Secondary Kinship', 'Secondary Merciless']);
  assert.ok(names(arcanesFor(AKIMBO_W, data)).includes('Akimbo Slip Shot'), 'dual pistols take Akimbo Slip Shot');
  for (const n of ['Arcane Avenger', 'Melee Exposure']) assert.equal(isArcaneCompatible(n, RIFLE_W, data), false, `${n} is not a gun arcane`);
});

test('arcane entries list rank, summary, support and controls', () => {
  const m = arcanesFor(RIFLE_W, data).find(a => a.name === 'Primary Merciless');
  assert.equal(m.maxRank, 5);
  assert.equal(m.summary, '+360% Damage (12 stacks), +30% Reload Speed (passive)');
  assert.equal(m.description, 'On Kill/Passive: +30% Damage for 4s. Stacks up to 12x. +30% Reload Speed');
  assert.equal(m.support, 'full');
  assert.deepEqual(m.controls, { stacks: { max: 12, default: 12 }, startingStacks: null, trigger: 'On Kill' });
  assert.equal(m.requires, null);
  assert.equal(arcanesFor(RIFLE_W, data).find(a => a.name === 'Primary Frostbite').requires, 'Cold');
  assert.equal(arcaneMaxRank('Pax Bolt', data), 3);
  assert.equal(arcaneSummary('Primary Merciless', data, 0), '+60% Damage (12 stacks), +5% Reload Speed (passive)');
  assert.equal(arcaneSummary('Secondary Fortifier', data), 'x8 damage to Overguard');
});

test('support levels say honestly what the engine models', () => {
  assert.equal(arcaneSupport('Primary Merciless', data).level, 'full');
  assert.equal(arcaneSupport('Secondary Encumber', data).level, 'full');
  assert.equal(arcaneSupport('Primary Exhilarate', data).level, 'none');
  assert.equal(arcaneSupport('Secondary Kinship', data).level, 'none');
  assert.equal(arcaneSupport('Pax Bolt', data).level, 'none');
  const cryo = arcaneSupport('Secondary Cryogenic', data);
  assert.equal(cryo.level, 'partial');
  assert.match(cryo.note, /max-rank/);
  assert.equal(arcaneSupport('Melee Exposure', data).level, 'none');
});

test('defaults are max rank and max stacks; entries are clamped', () => {
  assert.deepEqual(defaultArcaneOptions('Primary Merciless', data), { stacks: 12 });
  assert.deepEqual(defaultArcaneOptions('Secondary Encumber', data), {}, 'always-on arcanes have no stack control');
  assert.deepEqual(defaultArcaneOptions('Secondary Enervate', data), { stacks: 1, startingStacks: 0 });
  assert.equal(arcaneControls('Shotgun Vendetta', data).stacks.max, 1, 'a one-stack buff is a toggle');
  assert.deepEqual(normalizeArcaneEntry('Primary Merciless', data), { name: 'Primary Merciless', rank: 5, options: { stacks: 12 } });
  assert.deepEqual(normalizeArcaneEntry({ name: 'Primary Merciless', rank: 9, options: { stacks: 99 } }, data), { name: 'Primary Merciless', rank: 5, options: { stacks: 12 } });
  assert.deepEqual(normalizeArcaneEntry({ name: 'Primary Merciless', rank: -2, options: { stacks: -1 } }, data), { name: 'Primary Merciless', rank: 0, options: { stacks: 0 } });
  assert.equal(normalizeArcaneEntry({ name: 'Nope' }, data), null);
  assert.equal(normalizeArcaneEntry(null, data), null);
});

test('rank scales an arcane linearly from 1/6 at rank 0 to full at rank 5', () => {
  close(rankFactor('Primary Merciless', data, 5), 1);
  close(rankFactor('Primary Merciless', data, 0), 1 / 6);
  close(rankFactor('Pax Bolt', data, 0), 1 / 4);
  const r5 = resolveArcanes([{ name: 'Primary Merciless', rank: 5, options: { stacks: 12 } }], RIFLE_W, data);
  close(r5.entries[0].stats.damage, 3.6);
  close(r5.entries[0].stats.reload, 0.3);
  const r0 = resolveArcanes([{ name: 'Primary Merciless', rank: 0, options: { stacks: 12 } }], RIFLE_W, data);
  close(r0.entries[0].stats.damage, 0.6);
  close(r0.entries[0].stats.reload, 0.05);
  const half = resolveArcanes([{ name: 'Primary Merciless', rank: 5, options: { stacks: 6 } }], RIFLE_W, data);
  close(half.entries[0].stats.damage, 1.8);
  close(half.entries[0].stats.reload, 0.3, 1e-9);
  const none = resolveArcanes([{ name: 'Primary Merciless', rank: 5, options: { stacks: 0 } }], RIFLE_W, data);
  assert.equal(none.entries[0].stats.damage, undefined, 'no stacks, no damage');
  close(none.entries[0].stats.reload, 0.3, 1e-9);
  const off = resolveArcanes([{ name: 'Shotgun Vendetta', rank: 5, options: { stacks: 0 } }], SHOTGUN_W, data);
  assert.deepEqual(off.entries[0].stats, {}, 'a toggle at 0 is off');
});

test('the engine gets arcane names; Deadhead below max rank sends a scaled headshot bonus instead', () => {
  const max = resolveArcanes([{ name: 'Primary Deadhead', rank: 5 }], RIFLE_W, data);
  assert.deepEqual(max.engineNames, ['Primary Deadhead']);
  assert.equal(max.headshotBonus, 0);
  close(max.entries[0].stats.damage, 3.6);
  const low = resolveArcanes([{ name: 'Primary Deadhead', rank: 2, options: { stacks: 0 } }], RIFLE_W, data);
  assert.deepEqual(low.engineNames, []);
  close(low.headshotBonus, 0.15);
  assert.equal(arcaneConditionalStats(low, {}).externalHeadshotMultiplierBonus, low.headshotBonus);
});

test('arcanes that do not fit are ignored and reported', () => {
  const r = resolveArcanes([{ name: 'Secondary Merciless', rank: 5 }], RIFLE_W, data);
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.engineNames, []);
  assert.equal(r.notes[0].level, 'none');
  assert.match(r.notes[0].text, /Does not fit Braton Prime/);
  const unknown = resolveArcanes([{ name: 'Made Up' }, null], RIFLE_W, data);
  assert.equal(unknown.notes.length, 1);
  assert.deepEqual(unsimulatedArcanes(resolveArcanes([{ name: 'Primary Exhilarate', rank: 5 }], RIFLE_W, data)), ['Primary Exhilarate']);
});

test('element arcanes only count on a fire mode that deals their element', () => {
  const r = resolveArcanes([{ name: 'Primary Frostbite', rank: 5, options: { stacks: 40 } }], RIFLE_W, data);
  assert.deepEqual(arcaneModifiersFor(r, { Impact: 1, Puncture: 1 }), {});
  const cold = arcaneModifiersFor(r, { Cold: 10 });
  close(cold.critDamage, 1.2);
  close(cold.multishot, 0.9);
  assert.equal(arcaneConditionalStats(r, { Slash: 5 }), null);
  const notes = arcaneNotes(r, { Slash: 5 });
  assert.deepEqual(notes.map(n => [n.name, n.level]), [['Primary Frostbite', 'inactive']]);
  assert.deepEqual(arcaneNotes(r, { Cold: 1 }), []);
});

test('engine-side effects go to their conditionalStats fields, scaled by rank', () => {
  const enc = arcaneConditionalStats(resolveArcanes([{ name: 'Secondary Encumber', rank: 5 }], PISTOL_W, data), {});
  assert.deepEqual(enc, { randomStatusChance: 0.24 });
  const enc0 = arcaneConditionalStats(resolveArcanes([{ name: 'Secondary Encumber', rank: 0 }], PISTOL_W, data), {});
  close(enc0.randomStatusChance, 0.04);
  const fort = arcaneConditionalStats(resolveArcanes([{ name: 'Secondary Fortifier', rank: 0 }], PISTOL_W, data), {});
  close(fort.overguardDamageMultiplier, 1 + 7 / 6);
  const sharp = arcaneConditionalStats(resolveArcanes([{ name: 'Longbow Sharpshot', rank: 5 }], BOW_W, data), {});
  assert.deepEqual(sharp, { sharpshotBonus: 3 });
  const merc = arcaneConditionalStats(resolveArcanes([{ name: 'Primary Merciless', rank: 5 }], RIFLE_W, data), {});
  close(merc.damage, 3.6);
  close(merc.reload, 0.3);
  const ener = resolveArcanes([{ name: 'Secondary Enervate', rank: 5, options: { stacks: 1, startingStacks: 4 } }], PISTOL_W, data);
  assert.equal(ener.startingStacks, 4);
  close(arcaneConditionalStats(ener, {}).enervateCritChanceBonus, 0.1);
});

test('arcane stat bonuses add to the mod buckets in weapon stats', () => {
  const opts = { modsByName: new Map(), reload: { magazine_size: 60, reload_time: 2 }, targetFaction: 'Grineer' };
  const plain = computeWeaponStats(RIFLE_W, [], opts).modes[0];
  const arcanes = resolveArcanes([{ name: 'Primary Merciless', rank: 5 }], RIFLE_W, data);
  const merc = computeWeaponStats(RIFLE_W, [], { ...opts, arcanes });
  close(merc.modes[0].totalFinalDamage, plain.totalFinalDamage * 4.6);
  close(merc.modes[0].reloadTime, 2 / 1.3);
  assert.equal(merc.modifiers.damage, 0, 'returned modifiers stay the mods\' own');
  const slip = computeWeaponStats(AKIMBO_W, [], { ...opts, arcanes: resolveArcanes([{ name: 'Akimbo Slip Shot', rank: 5 }], AKIMBO_W, data) });
  close(slip.modes[0].ammoConsumption, 0.35);
});

test('engine input carries arcane names, conditionalStats and Enervate starting stacks', () => {
  const opts = { modsByName: new Map(), reload: { magazine_size: 60, reload_time: 2 }, targetFaction: 'Grineer' };
  const enemy = { faction: 'Grineer', hp: 1000, armor: 0, shields: 0, overguard: 0 };
  const base = { weapon: PISTOL_W, modSlots: [], enemy, modeName: 'Normal Attack', maxTime: 10 };
  const arcanes = resolveArcanes([{ name: 'Secondary Merciless', rank: 5 }], PISTOL_W, data);
  const weaponStats = computeWeaponStats(PISTOL_W, [], { ...opts, arcanes }).modes;
  const inline = buildEngineInput({ ...base, weaponStats, appState: { conditionalStats: {} }, arcanes });
  assert.deepEqual(inline.build.arcanes, ['Secondary Merciless']);
  close(inline.appState.conditionalStats.damage, 3.6);
  assert.equal(inline.conditionalStats, undefined);
  const cached = buildEngineInput({ ...base, weaponStats, appStateRef: 3, arcanes });
  assert.equal(cached.appStateRef, 3);
  close(cached.conditionalStats.damage, 3.6, 1e-9);
  const ener = resolveArcanes([{ name: 'Secondary Enervate', rank: 5, options: { stacks: 1, startingStacks: 6 } }], PISTOL_W, data);
  assert.equal(buildEngineInput({ ...base, weaponStats, appStateRef: 1, arcanes: ener }).simulationParams.secondaryEnervateStartingStacks, 6);
  // Without arcanes the input is what it always was.
  const plain = buildEngineInput({ ...base, weaponStats, appStateRef: 1 });
  assert.deepEqual(plain.build.arcanes, []);
  assert.equal('conditionalStats' in plain, false);
  assert.equal('secondaryEnervateStartingStacks' in plain.simulationParams, false);
  const appState = { conditionalStats: {} };
  assert.equal(buildEngineInput({ ...base, weaponStats, appState }).appState, appState);
});

test('a capped percentage bonus is described in percent, never as hundreds of stacks', () => {
  const capData = {
    ...data,
    arcanes: [...data.arcanes, { arcane_name: 'Primary Overcharge', image_url: null, max_rank_description: 'While at or above 90% Energy: +1% Multishot per point, up to +350%' }],
    conditionals: {
      arcanes: [...data.conditionals.arcanes, { name: 'Primary Overcharge', type: 'Primary', trigger: 'While at or above 90% Energy', details: { bonus_per_rank: 0.01, bonus_type: 'Multishot', max_stacks: 350 } }],
    },
  };
  const c = arcaneControls('Primary Overcharge', capData);
  assert.deepEqual(c.cap, { type: 'Multishot', label: 'Multishot', perStack: 0.01 });
  assert.equal(arcaneStacksText('Primary Overcharge', capData, 350), '+350% Multishot');
  assert.equal(arcaneStacksText('Primary Overcharge', capData, 100), '+100% Multishot');
  assert.doesNotMatch(arcaneSummary('Primary Overcharge', capData), /stacks/);
  // Ordinary stacking and toggled arcanes keep their words.
  assert.equal(arcaneStacksText('Primary Merciless', data, 12), '12 stacks');
  assert.equal(arcaneStacksText('Shotgun Vendetta', data, 1), 'Active');
  assert.equal(arcaneStacksText('Shotgun Vendetta', data, 0), 'Inactive');
});
