// Auto Forma (src/shared/auto-forma.js): the fewest Forma that fit, the ladder of extra Forma, from scratch, ranks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinnedSlot, planForma } from '../src/shared/auto-forma.js';
import { indexMods } from '../src/shared/mods.js';
import { collectModifiers } from '../src/shared/stats.js';
import { innateSlotPolarities } from '../src/shared/capacity.js';

const dataFile = fileURLToPath(new URL('../core/data/data.json', import.meta.url));

const MODS = {
  Serration: { 'Local Name': 'Serration', 'Base Drain': 4, 'Fusion Limit': 10, Polarity: 'AP_ATTACK' }, // 14
  'Split Chamber': { 'Local Name': 'Split Chamber', 'Base Drain': 5, 'Fusion Limit': 5, Polarity: 'AP_ATTACK' }, // 10
  'Point Strike': { 'Local Name': 'Point Strike', 'Base Drain': 4, 'Fusion Limit': 5, Polarity: 'AP_TACTIC' }, // 9
  'Vital Sense': { 'Local Name': 'Vital Sense', 'Base Drain': 4, 'Fusion Limit': 5, Polarity: 'AP_ATTACK' }, // 9
};
const modByName = n => MODS[n];
const none = () => Array(9).fill(null);
const at = (list, rank = null) => {
  const mods = none();
  list.forEach((name, i) => { if (name) mods[i] = { name, rank: rank ?? MODS[name]['Fusion Limit'] }; });
  return mods;
};

test('a build that fits needs no Forma; extra Forma are offered only when they free capacity', () => {
  const r = planForma({ mods: at(['Serration', 'Point Strike']), innate: none(), effective: none(), modByName });
  assert.deepEqual(r.current, { used: 23, capacity: 60, forma: 0 });
  assert.equal(r.options[0].spent, 0);
  assert.equal(r.options[0].spare, 37);
  // Serration first (saves 7), then Point Strike (9 -> 5, saves 4); nothing more after two.
  assert.deepEqual(r.options.map(o => [o.spent, o.used]), [[0, 23], [1, 16], [2, 12]]);
  assert.deepEqual(r.options[1].changes, [{ slot: 0, from: null, to: 'AP_ATTACK' }]);
});

test('the fewest Forma that fit, without a Catalyst', () => {
  // 14 + 10 + 9 + 9 = 42 over 30: Serration (-7) and Split Chamber (-5) fit it at 30 with 2 Forma.
  const r = planForma({ mods: at(['Serration', 'Split Chamber', 'Point Strike', 'Vital Sense']), innate: none(), effective: none(), modByName, catalyst: false });
  assert.equal(r.options[0].spent, 2);
  assert.equal(r.options[0].used, 30);
  assert.deepEqual(r.options[0].changes.map(c => c.slot), [0, 1]);
});

test('a mismatched innate slot is re-polarised to the mod (or cleared) and an exact search beats a greedy one', () => {
  const innate = none();
  innate[0] = 'AP_TACTIC'; // Serration mismatched: 18
  const r = planForma({ mods: at(['Serration']), innate, effective: innate.slice(), modByName, moveMods: false });
  assert.equal(r.current.used, 18);
  assert.deepEqual(r.options.map(o => [o.spent, o.used]), [[0, 18], [1, 7]]);
  assert.deepEqual(r.options[1].polarities[0], 'AP_ATTACK');
  // Moved to an unpolarised slot, it drains 14 with no Forma.
  const moved = planForma({ mods: at(['Serration']), innate, effective: innate.slice(), modByName });
  assert.deepEqual(moved.options.map(o => [o.spent, o.used]), [[0, 14], [1, 7]]);
  assert.equal(moved.options[0].moves.length, 1);
  assert.deepEqual(moved.options[1].moves, []);
});

test('Forma already applied are spent, unless planning from scratch', () => {
  const innate = none();
  const effective = none();
  effective[5] = 'AP_DEFENSE'; // a Forma on an empty slot
  effective[0] = 'AP_ATTACK';
  const mods = at(['Serration']);
  const kept = planForma({ mods, innate, effective, modByName });
  assert.equal(kept.current.forma, 2);
  assert.equal(kept.options[0].spent, 0);
  assert.deepEqual(kept.options[0].changes, []);
  const scratch = planForma({ mods, innate, effective, modByName, fromScratch: true });
  // From scratch the stray Forma on slot 6 isn't needed: 0 Forma fit, 1 (Serration's) frees 7.
  assert.deepEqual(scratch.options.map(o => [o.spent, o.forma, o.used]), [[0, 0, 14], [1, 1, 7]]);
  assert.deepEqual(scratch.options[1].changes, [{ slot: 5, from: 'AP_DEFENSE', to: null }]);
});

test('Progenitor weapons gain capacity per Forma, so a Forma on an empty slot can help', () => {
  const r = planForma({ mods: at(['Serration']), innate: none(), effective: none(), modByName, progenitor: true, catalyst: false, moveMods: false });
  // Each Forma adds 2: the 1st also halves Serration; up to 5 count.
  assert.deepEqual(r.options.map(o => [o.spent, o.capacity, o.used]), [[0, 30, 14], [1, 32, 7], [2, 34, 7], [3, 36, 7], [4, 38, 7], [5, 40, 7]]);
});

test('max ranks plans for every mod at its max rank; nothing fits says how close it gets', () => {
  const low = at(['Serration', 'Split Chamber', 'Point Strike', 'Vital Sense'], 0);
  const r = planForma({ mods: low, innate: none(), effective: none(), modByName, maxRanks: true, catalyst: false });
  assert.equal(r.raised, 4);
  assert.equal(r.mods[0].rank, 10);
  assert.equal(r.options[0].spent, 2);
  const heavy = at(['Serration', 'Split Chamber', 'Point Strike', 'Vital Sense', 'Serration', 'Split Chamber']);
  const none6 = planForma({ mods: heavy, innate: none(), effective: none(), modByName, catalyst: false });
  assert.deepEqual(none6.options, []);
  assert.deepEqual(none6.best, { used: 34, capacity: 30 });
});

test('a riven slot gets Madurai, or the riven’s own polarity when it has one', () => {
  const mods = none();
  mods[2] = { isRiven: true, family: 'Braton', name: 'Braton Riven Mod', rank: 8 };
  const omni = planForma({ mods, innate: none(), effective: none(), modByName, moveMods: false });
  assert.equal(omni.options.at(-1).polarities[2], 'AP_ATTACK');
  mods[2] = { ...mods[2], polarity: 'AP_DEFENSE' };
  const own = planForma({ mods, innate: none(), effective: none(), modByName, moveMods: false });
  assert.equal(own.options.at(-1).polarities[2], 'AP_DEFENSE');
  assert.equal(own.options.at(-1).used, 9);
});

test('moving a mod to a slot that already matches costs no Forma', () => {
  const innate = none();
  innate[4] = 'AP_ATTACK'; // slot 5 is Madurai; Serration sits in unpolarised slot 1
  const mods = at(['Serration', 'Point Strike']);
  const r = planForma({ mods, innate, effective: innate.slice(), modByName });
  assert.equal(r.options[0].spent, 0);
  assert.equal(r.options[0].used, 7 + 9);
  assert.deepEqual(r.options[0].moves, [{ name: 'Serration', from: 0, to: 4 }]);
  assert.deepEqual(r.options[0].changes, []);
  assert.equal(r.options[0].mods[4].name, 'Serration');
  // A pinned mod (one that adds an element) stays put.
  const kept = planForma({ mods, innate, effective: innate.slice(), modByName, pinned: s => s.name === 'Serration' });
  assert.deepEqual(kept.options[0].moves, []);
  assert.equal(kept.options[0].used, 14 + 9);
  // Without moves, the same.
  assert.deepEqual(planForma({ mods, innate, effective: innate.slice(), modByName, moveMods: false }).options[0].moves, []);
});

test('Umbra Forma only when nothing fits without', () => {
  MODS['Umbral Mod'] = { 'Local Name': 'Umbral Mod', 'Base Drain': 6, 'Fusion Limit': 10, Polarity: 'AP_UMBRA' }; // 16
  try {
    const fits = planForma({ mods: at(['Umbral Mod']), innate: none(), effective: none(), modByName, catalyst: false });
    assert.equal(fits.umbra, false);
    assert.ok(fits.options.every(o => !o.polarities.includes('AP_UMBRA')));
    // 16 + 14 + 10 = 40 over 30: Serration and Split Chamber halved give 16 + 7 + 5 = 28 without Umbra.
    const heavy = at(['Umbral Mod', 'Serration', 'Split Chamber', 'Point Strike', 'Vital Sense']);
    const r = planForma({ mods: heavy, innate: none(), effective: none(), modByName, catalyst: false });
    // 16 + 7 + 5 + 5 + 5 = 38 without Umbra; with it 8 + 22 = 30.
    assert.equal(r.umbra, true);
    assert.equal(r.options[0].used, 30);
    assert.ok(r.options[0].polarities.includes('AP_UMBRA'));
  } finally {
    delete MODS['Umbral Mod'];
  }
});

test('real data: moves keep every element mod in its slot, so the mods add up to the same', { skip: !existsSync(dataFile) && 'no core data' }, () => {
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const { byName } = indexMods(data);
  const innate = innateSlotPolarities(data, { name: 'Lex Prime' });
  const mods = [['Hornet Strike', 10], ['Heated Charge', 5], ['Lethal Torrent', 5], ['Convulsion', 5], ['Barrel Diffusion', 5], ['Pistol Gambit', 5], ['Target Cracker', 5], ['Hollow Point', 5]]
    .map(([name, rank]) => ({ name, rank }));
  mods.forEach(m => assert.ok(byName.get(m.name), m.name));
  mods.push(null);
  const r = planForma({ mods, innate, effective: innate.slice(), modByName: n => byName.get(n), pinned: s => pinnedSlot(byName, s) });
  assert.ok(r.options.length);
  assert.ok(r.options.some(o => o.moves.length), 'some plan moves a mod');
  const before = collectModifiers(mods, byName, null);
  for (const o of r.options) {
    for (const m of o.moves) assert.ok(!pinnedSlot(byName, mods[m.from]), `${m.name} adds an element and moved`);
    assert.deepEqual(collectModifiers(o.mods, byName, null), before);
  }
});
