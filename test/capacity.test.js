// Mod capacity (src/shared/capacity.js): slot drain against the wiki examples, capacity, innate polarities, Forma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityOf, capacityUse, effectiveSlotPolarities, formaCount, innateSlotPolarities, normalizePolarity, slotDrain,
} from '../src/shared/capacity.js';

const serration = { 'Local Name': 'Serration', 'Base Drain': 4, 'Fusion Limit': 10, Polarity: 'AP_ATTACK' };
const umbral = { 'Local Name': 'Umbral X', 'Base Drain': 6, 'Fusion Limit': 10, Polarity: 'AP_UMBRA' };
const unpolarised = { 'Local Name': 'Plain', 'Base Drain': 4, 'Fusion Limit': 5, Polarity: 'AP_UNIVERSAL' };

test('Serration at rank 10: 14, halved in Madurai, +25% in Naramon (wiki example)', () => {
  assert.deepEqual(slotDrain(serration, 10, null), { drain: 14, base: 14, effect: 'neutral' });
  assert.deepEqual(slotDrain(serration, 10, 'AP_ATTACK'), { drain: 7, base: 14, effect: 'match' });
  assert.deepEqual(slotDrain(serration, 10, 'AP_TACTIC'), { drain: 18, base: 14, effect: 'mismatch' });
  assert.equal(slotDrain(serration, 10, 'AP_UNIVERSAL').effect, 'neutral');
});

test('matching rounds up; mismatching adds a rounded quarter (the wiki table)', () => {
  const at = base => ({ ...serration, 'Base Drain': base });
  assert.equal(slotDrain(at(4), 5, 'AP_ATTACK').drain, 5); // 9 -> 4.5 -> 5
  const plusQuarter = { 1: 0, 2: 1, 5: 1, 6: 2, 9: 2, 10: 3, 13: 3, 14: 4, 16: 4 };
  for (const [d, extra] of Object.entries(plusQuarter)) {
    assert.equal(slotDrain(at(Number(d)), 0, 'AP_DEFENSE').drain, Number(d) + extra, `drain ${d}`);
  }
});

test('Omni matches everything but Umbra; a mod without polarity is never penalised', () => {
  assert.equal(slotDrain(serration, 10, 'AP_ANY').effect, 'match');
  assert.equal(slotDrain(serration, 10, 'AP_OMNI').drain, 7);
  assert.equal(slotDrain(umbral, 10, 'AP_ANY').effect, 'neutral');
  assert.equal(slotDrain(umbral, 10, 'AP_UMBRA').drain, 8);
  assert.equal(slotDrain(unpolarised, 5, 'AP_ATTACK').effect, 'neutral');
});

test('capacity: 60 with a Catalyst, 30 without; progenitor weapons gain up to +20', () => {
  assert.equal(capacityOf({ catalyst: true }), 60);
  assert.equal(capacityOf({ catalyst: false }), 30);
  assert.equal(capacityOf({ catalyst: true, progenitor: true, forma: 3 }), 72);
  assert.equal(capacityOf({ catalyst: true, progenitor: true, forma: 9 }), 80);
  assert.equal(capacityOf({ catalyst: false, progenitor: true, forma: 5 }), 40);
  assert.equal(capacityOf({ catalyst: true, progenitor: false, forma: 5 }), 60);
});

test('innate polarities: general slot i reads index [7..0][i], the Exilus slot index 8 (Lex Prime)', () => {
  const data = { polarities: [
    { name: 'Lex Prime', type: 'Weapon', polarities: ['AP_ATTACK', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_UNIVERSAL', 'AP_TACTIC', 'AP_UNIVERSAL'] },
    { name: 'Lex Prime', type: 'Companion', polarities: ['AP_DEFENSE'] },
  ] };
  const p = innateSlotPolarities(data, { name: 'Lex Prime' });
  assert.equal(p.length, 9);
  assert.equal(p[7], 'AP_ATTACK', 'slot 8 is Madurai');
  assert.equal(p[8], 'AP_TACTIC', 'the Exilus slot is Naramon');
  assert.deepEqual(p.slice(0, 7), Array(7).fill(null));
  assert.deepEqual(innateSlotPolarities(data, { name: 'Unknown' }), Array(9).fill(null));
  assert.equal(innateSlotPolarities(data, { name: 'lex  prime' })[7], 'AP_ATTACK', 'loose name match');
});

test('Forma count and effective polarities: overrides replace innate ones; AP_UNIVERSAL clears a slot', () => {
  const innate = [null, null, null, null, null, null, null, 'AP_ATTACK', 'AP_TACTIC'];
  const none = Array(9).fill(null);
  assert.equal(formaCount(innate, none), 0);
  const o = none.slice();
  o[0] = 'AP_ATTACK';
  o[7] = 'AP_ATTACK'; // same as innate: no Forma
  o[8] = 'AP_UNIVERSAL';
  assert.equal(formaCount(innate, o), 2);
  assert.deepEqual(effectiveSlotPolarities(innate, o), ['AP_ATTACK', null, null, null, null, null, null, 'AP_ATTACK', null]);
  assert.equal(normalizePolarity('AP_WAVE'), 'AP_WARD');
});

test('capacityUse sums slot drains', () => {
  const mods = new Map([['Serration', serration]]);
  const slots = [{ name: 'Serration', rank: 10 }, null, null, null, null, null, null, null, null];
  const r = capacityUse(slots, ['AP_ATTACK', ...Array(8).fill(null)], n => mods.get(n));
  assert.equal(r.used, 7);
  assert.equal(r.perSlot[0].effect, 'match');
  assert.equal(r.perSlot[1], null);
});
