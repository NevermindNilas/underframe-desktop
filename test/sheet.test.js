// The Readout's weapon stats sheet (src/renderer/sheet.js): base / modded / change rows, the change format and
// direction, damage types, and the "If equipped" preview, on synthetic modes and on the real data (core/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHEET_ROWS, changeOf, damageTypeRows, fmtChange, previewSummary, sheetRows, verdict } from '../src/renderer/sheet.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const haveCore = existsSync(coreDir + 'data/data.json');
const opts = { skip: haveCore ? false : 'core/ (Underframe data) is not checked out' };

const mode = (over = {}) => ({
  totalFinalDamage: 35, finalCritChance: 12, finalCritMultiplier: 2, perProjectileStatusChance: 26, finalStatusDuration: 6,
  finalMultishot: 1, finalFireRate: 9.58, magazineSize: 75, reloadTime: 2.15, finalPunchThrough: 0, factionDamage: 0,
  finalDamageTypes: { Impact: 1.8, Puncture: 12.3, Slash: 20.9 }, ...over,
});

test('every stat row has a search word, a label and a direction; the faction and punch through start at zero', () => {
  assert.equal(SHEET_ROWS.length, 11);
  assert.deepEqual(SHEET_ROWS.map(r => r.token), ['dmg', 'cc', 'cd', 'sc', 'sd', 'ms', 'fr', 'mag', 'reload', 'pt', 'bane']);
  assert.equal(SHEET_ROWS.find(r => r.key === 'reload').better, 'down');
});

test('change: signed percent, × from 3x, nothing when equal or from a zero base', () => {
  assert.equal(changeOf(12, 21), 0.75);
  assert.equal(changeOf(10, 10), null);
  assert.equal(changeOf(0, 5), null);
  assert.equal(fmtChange(0.75), '+75%');
  assert.equal(fmtChange(-0.23), '−23%');
  assert.equal(fmtChange(27.75), '×28.8');
  assert.equal(fmtChange(null), '—');
  assert.equal(verdict(-0.23, 'down'), 'good', 'a faster reload is good');
  assert.equal(verdict(-0.24, 'up'), 'bad');
  assert.equal(verdict(null, 'up'), 'same');
});

test('sheet rows: base, modded and change per row; reload n/a without reload data', () => {
  const base = mode();
  const modded = mode({ totalFinalDamage: 1006.3, finalCritChance: 21, finalFireRate: 7.28, reloadTime: 1.65, factionDamage: 0.55, finalPunchThrough: 1.2 });
  const rows = sheetRows(modded, base);
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.equal(by.critChance.baseText, '12%');
  assert.equal(by.critChance.valueText, '21%');
  assert.equal(by.critChance.changeText, '+75%');
  assert.equal(by.critChance.verdict, 'good');
  assert.equal(by.damage.changeText, '×28.8');
  assert.equal(by.fireRate.verdict, 'bad');
  assert.equal(by.reload.verdict, 'good');
  assert.equal(by.magazine.changeText, '—');
  assert.equal(by.faction.baseText, '—');
  assert.equal(by.faction.valueText, '+55%');
  assert.equal(by.faction.changeText, '+55%');
  assert.equal(by.punchThrough.changeText, '+1.2 m');
  const noReload = Object.fromEntries(sheetRows(modded, base, { hasReload: false }).map(r => [r.key, r]));
  assert.equal(noReload.reload.valueText, 'n/a');
  assert.equal(noReload.magazine.baseText, 'n/a');
});

test('preview: only the rows a candidate changes get an If equipped value, and the summary names the biggest', () => {
  const now = mode({ finalCritChance: 21 });
  const rows = sheetRows(now, mode(), { preview: mode({ finalCritChance: 39, finalFireRate: 7.66 }) });
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.equal(by.critChance.previewText, '39%');
  assert.equal(by.critChance.previewVerdict, 'good');
  assert.equal(by.fireRate.previewVerdict, 'bad');
  assert.equal(by.damage.previewText, null);
  assert.match(previewSummary(rows), /^If equipped: crit chance 21% to 39%, fire rate/);
  assert.equal(previewSummary(sheetRows(now, mode(), { preview: now })), 'If equipped: no stat changes on the sheet');
});

test('damage types: base and modded per type in palette order, elements that only exist modded included', () => {
  const rows = damageTypeRows(mode({ finalDamageTypes: { Impact: 10.9, Puncture: 76.6, Slash: 51, Toxin: 290 } }), mode());
  assert.deepEqual(rows.map(r => r.type), ['Impact', 'Puncture', 'Slash', 'Toxin']);
  assert.equal(rows.find(r => r.type === 'Toxin').base, 0);
  assert.equal(rows.find(r => r.type === 'Toxin').token, 'toxin');
});

test('real data: Braton Prime base vs modded, and a preview of Point Strike in an empty slot', opts, async () => {
  const M = await import('../src/renderer/model.js');
  const S = await import('../src/renderer/sheet.js');
  const { buildStats } = await import('../src/renderer/sim.js');
  const ctx = M.createContext(JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8')));
  let build = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  build = M.setSlot(build, 0, { name: 'Serration', rank: 10 });
  const base = S.baseModeOf(ctx, build);
  const modded = buildStats(ctx, build).mode;
  const rows = S.sheetRows(modded, base, { hasReload: true });
  const dmg = rows.find(r => r.key === 'damage');
  assert.ok(Math.abs(dmg.value / dmg.base - 2.65) < 0.01, `Serration gives +165% damage (${dmg.base} -> ${dmg.value})`);
  assert.equal(rows.find(r => r.key === 'critChance').change, null, 'crit is unchanged');
  const pv = S.previewMode(ctx, build, { kind: 'mod', name: 'Point Strike', slot: 1 });
  const withPreview = S.sheetRows(modded, base, { preview: pv });
  assert.ok(withPreview.find(r => r.key === 'critChance').preview > modded.finalCritChance);
  assert.equal(withPreview.find(r => r.key === 'damage').previewText, null);
  const arc = S.previewMode(ctx, build, { kind: 'arcane', name: 'Primary Merciless', slot: M.ARCANE_SLOT });
  assert.ok(arc, 'an arcane preview computes');
  assert.equal(build.mods[1], null, 'the preview never changes the build');
});

test('paper DPS and the weakest slot: the mod whose removal costs the least damage on paper', opts, async () => {
  const M = await import('../src/renderer/model.js');
  const S = await import('../src/renderer/sheet.js');
  const ctx = M.createContext(JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8')));
  assert.ok(Number.isNaN(S.paperDps(null)));
  assert.equal(S.paperDps({ totalFinalDamage: 10, finalMultishot: 2, finalFireRate: 5, finalCritChance: 0.5, finalCritMultiplier: 3 }), 10 * 2 * 5 * 2);
  let build = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  assert.equal(S.weakestSlot(ctx, build), null, 'no mods, no weakest slot');
  build = M.setSlot(build, 0, { name: 'Serration', rank: 10 });
  build = M.setSlot(build, 1, { name: 'Split Chamber', rank: 5 });
  build = M.setSlot(build, 2, { name: 'Magazine Warp', rank: 5 });
  assert.equal(S.weakestSlot(ctx, build), 2, 'a magazine mod adds no damage on paper');
});
