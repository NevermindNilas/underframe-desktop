// Slot selection, the gallery's target slot, swaps, slot polarities and capacity in the build model (model.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXILUS_SLOT, buildCapacity, contentOf, emptySlots, nextEmptySlot, setSlot, setSlotPolarity, slotBlockReason, slotPolaritiesOf,
  snapshotOf, swapSlots, targetSlotFor, withContent, normalizeBuild, changeWeapon, emptyPolarities,
} from '../src/renderer/model.js';
import { indexMods } from '../src/shared/mods.js';

const mod = (name, drain, pol, rank = 10, type = 'SECONDARY', compat = 'Pistol') => ({
  'Local Name': name, 'Base Drain': drain, Polarity: pol, 'Fusion Limit': rank, Type: type, 'Compat Name': compat, Rarity: 'RARE', Stats: [],
});
const data = {
  mods: [
    mod('Hornet Strike', 4, 'AP_ATTACK'), mod('Barrel Diffusion', 6, 'AP_ATTACK', 5), mod('Lethal Torrent', 6, 'AP_TACTIC', 5),
    mod('Pistol Gambit', 4, 'AP_ATTACK', 5), mod('Primed Pistol Gambit', 4, 'AP_ATTACK'), mod('Steady Hands', 2, 'AP_TACTIC', 3),
  ],
  incompatible_mods: [{ 'Local Name': 'Pistol Gambit', 'Incompatible Mods': ['Primed Pistol Gambit'] }],
  polarities: [{ name: 'Lex Prime', type: 'Weapon', polarities: ['AP_ATTACK', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_TACTIC', 'AP_UNIVERSAL'] }],
  weapons: [], arcanes: [], conditionals: { arcanes: [] },
};
const lex = { name: 'Lex Prime', type: 'Secondary', subtype: 'Pistol', fire_modes: [{ mode_name: 'Normal Attack' }] };
const kuva = { name: 'Kuva Nukor', type: 'Secondary', subtype: 'Pistol', is_progenitor: true, fire_modes: [{ mode_name: 'Normal Attack' }] };
const ctx = {
  data, index: indexMods(data), exilus: new Set(['Steady Hands']),
  weaponByName: new Map([[lex.name, lex], [kuva.name, kuva]]), presets: {},
};
const build = (over = {}) => ({
  name: 'b', weaponName: 'Lex Prime', modeName: 'Normal Attack', mods: emptySlots(), arcanes: [null],
  slotPolarities: emptyPolarities(), catalyst: true, enemy: { preset: 'Custom', hp: 1 }, simTime: 30, notes: '', ...over,
});
const put = (b, slot, name, rank = 10) => setSlot(b, slot, { name, rank });

test('target slot: the selected slot, else an Exilus mod to the empty Exilus slot, else the first empty slot', () => {
  let b = build();
  assert.equal(targetSlotFor(ctx, b, null, 'Hornet Strike'), 0);
  assert.equal(targetSlotFor(ctx, b, 5, 'Hornet Strike'), 5);
  assert.equal(targetSlotFor(ctx, b, null, 'Steady Hands'), EXILUS_SLOT);
  b = put(b, 0, 'Hornet Strike');
  assert.equal(targetSlotFor(ctx, b, null, 'Barrel Diffusion'), 1);
  for (let i = 1; i < 8; i++) b = put(b, i, `M${i}`);
  assert.equal(targetSlotFor(ctx, b, null, 'Barrel Diffusion'), null, 'all general slots full');
  assert.equal(targetSlotFor(ctx, b, 'arcane', 'Barrel Diffusion'), null, 'the arcane slot is not a mod target');
});

test('selection advances to the next empty slot after a fill, wrapping round', () => {
  let b = put(put(build(), 0, 'Hornet Strike'), 2, 'Lethal Torrent');
  assert.equal(nextEmptySlot(b, 0), 1);
  assert.equal(nextEmptySlot(b, 1), 3);
  for (const i of [1, 3, 4, 5, 6]) b = put(b, i, `M${i}`);
  assert.equal(nextEmptySlot(b, 6), 7);
  b = put(b, 7, 'M7');
  assert.equal(nextEmptySlot(b, 7), null);
  assert.equal(nextEmptySlot(put(build(), 3, 'X'), EXILUS_SLOT), 0);
});

test('block reasons: Exilus only, already equipped, conflicts', () => {
  const b = put(put(build(), 1, 'Hornet Strike'), 2, 'Pistol Gambit', 5);
  assert.equal(slotBlockReason(ctx, b, EXILUS_SLOT, 'Hornet Strike'), 'Not an Exilus mod');
  assert.equal(slotBlockReason(ctx, b, 0, 'Hornet Strike'), 'Already in slot 2');
  assert.equal(slotBlockReason(ctx, b, 1, 'Hornet Strike'), null, 'replacing itself');
  assert.equal(slotBlockReason(ctx, b, 0, 'Primed Pistol Gambit'), 'Conflicts with Pistol Gambit');
  assert.equal(slotBlockReason(ctx, b, 2, 'Primed Pistol Gambit'), null, 'replacing the conflicting mod');
  assert.equal(slotBlockReason(ctx, b, EXILUS_SLOT, 'Steady Hands'), null);
});

test('swap keeps ranks and refuses a non-Exilus mod into the Exilus slot', () => {
  const b = put(put(build(), 0, 'Hornet Strike', 7), 3, 'Lethal Torrent', 2);
  const s = swapSlots(ctx, b, 0, 3);
  assert.deepEqual([s.mods[0], s.mods[3]], [{ name: 'Lethal Torrent', rank: 2 }, { name: 'Hornet Strike', rank: 7 }]);
  assert.equal(swapSlots(ctx, b, 0, EXILUS_SLOT), b);
  const ex = put(build(), EXILUS_SLOT, 'Steady Hands', 3);
  assert.equal(swapSlots(ctx, ex, EXILUS_SLOT, 4).mods[4].name, 'Steady Hands', 'an Exilus mod may leave the Exilus slot');
  const both = put(ex, 4, 'Hornet Strike');
  assert.equal(swapSlots(ctx, both, EXILUS_SLOT, 4), both, 'Hornet Strike may not move into the Exilus slot');
});

test('Lex Prime: innate Madurai on slot 8 and Naramon on the Exilus slot; Forma changes drain and the count', () => {
  let b = put(build(), 7, 'Hornet Strike', 10);
  const { innate } = slotPolaritiesOf(ctx, b);
  assert.equal(innate[7], 'AP_ATTACK');
  assert.equal(innate[EXILUS_SLOT], 'AP_TACTIC');
  let cap = buildCapacity(ctx, b);
  assert.equal(cap.perSlot[7].drain, 7, 'Hornet Strike 14 halved');
  assert.equal(cap.forma, 0);
  b = setSlotPolarity(ctx, b, 7, 'AP_TACTIC');
  cap = buildCapacity(ctx, b);
  assert.equal(cap.perSlot[7].drain, 18);
  assert.equal(cap.forma, 1);
  assert.equal(setSlotPolarity(ctx, b, 7, 'AP_ATTACK').slotPolarities[7], null, 'back to innate is no Forma');
  const plain = build();
  assert.equal(setSlotPolarity(ctx, plain, 0, 'AP_UNIVERSAL'), plain, 'clearing an unpolarised slot changes nothing');
});

test('capacity: Catalyst off halves it, progenitor weapons gain per Forma, over capacity is measured', () => {
  let b = build();
  for (let i = 0; i < 8; i++) b = put(b, i, i % 2 ? 'Barrel Diffusion' : 'Hornet Strike', i % 2 ? 5 : 10);
  const cap = buildCapacity(ctx, b);
  assert.equal(cap.capacity, 60);
  assert.equal(cap.used, 4 * 14 + 3 * 11 + 6, 'slot 8 is Madurai: Barrel Diffusion 11 halved');

  assert.equal(cap.over, cap.used - 60);
  assert.equal(buildCapacity(ctx, { ...b, catalyst: false }).capacity, 30);
  let k = build({ weaponName: 'Kuva Nukor' });
  for (let i = 0; i < 3; i++) k = setSlotPolarity(ctx, k, i, 'AP_ATTACK');
  assert.equal(buildCapacity(ctx, k).capacity, 72);
});

test('polarities and the Catalyst are content (undo, unsaved changes) but only when changed', () => {
  const b = build();
  assert.equal('slotPolarities' in contentOf(b), false);
  assert.equal('catalyst' in contentOf(b), false);
  const old = { ...b };
  delete old.slotPolarities;
  delete old.catalyst;
  assert.equal(snapshotOf(old), snapshotOf(b), 'a build saved before polarities existed is unchanged');
  const f = setSlotPolarity(ctx, { ...b, catalyst: false }, 0, 'AP_ATTACK');
  assert.equal(contentOf(f).catalyst, false);
  assert.equal(contentOf(f).slotPolarities[0], 'AP_ATTACK');
  const undone = withContent(f, contentOf(b));
  assert.equal(undone.catalyst, true);
  assert.deepEqual(undone.slotPolarities, emptyPolarities());
});

test('normalizeBuild reads polarities and the Catalyst; a weapon change clears Forma', () => {
  const realCtx = { ...ctx, presets: {} };
  const { build: n } = normalizeBuild(realCtx, { weaponName: 'Lex Prime', mods: [], slotPolarities: ['AP_ATTACK', 'bogus', null], catalyst: false, enemy: { preset: 'Custom', hp: 5 } });
  assert.equal(n.slotPolarities[0], 'AP_ATTACK');
  assert.equal(n.slotPolarities[1], null);
  assert.equal(n.catalyst, false);
  const { build: c } = changeWeapon(realCtx, n, 'Kuva Nukor');
  assert.deepEqual(c.slotPolarities, emptyPolarities());
});
