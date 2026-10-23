import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withEnemyStats, enemyForPreset, updateEnemy, buildToSave, buildAfterSave, snapshotOf, emptySlots } from '../src/renderer/model.js';

const ctx = {
  presets: {
    'Elite Crewman': { base_armor: 0, base_hp: 110, base_level: 1, base_overguard: 0, base_shields: 150, default_level: 145, faction: 'Corpus' },
    Lancer: { base_armor: 100, base_hp: 100, base_level: 1, base_overguard: 0, base_shields: 0, default_level: 50, faction: 'Grineer' },
  },
};

const build = (over = {}) => ({
  name: 'My build', weaponName: 'Braton Prime', modeName: 'Normal Attack', mods: emptySlots(),
  enemy: enemyForPreset(ctx, 'Elite Crewman'), simTime: 30, notes: '', ...over,
});

const result = { avgDps: 1234, ttk: 2.5, avgHit: 50, firstHitDamage: 40, runs: 8 };

test('enemy records have one key order however they were made', () => {
  const fromPreset = enemyForPreset(ctx, 'Elite Crewman');
  // As a saved build comes back from builds.json: headshot last, stats before it.
  const { headshot, ...rest } = fromPreset;
  const reread = withEnemyStats(ctx, { ...rest, headshot });
  assert.equal(JSON.stringify(reread), JSON.stringify(fromPreset));
  const reversed = Object.fromEntries(Object.entries(fromPreset).reverse());
  assert.equal(JSON.stringify(withEnemyStats(ctx, reversed)), JSON.stringify(fromPreset));
  // Switching away and back again is not a change.
  const back = updateEnemy(ctx, updateEnemy(ctx, reread, { preset: 'Lancer' }), { preset: 'Elite Crewman' });
  assert.equal(snapshotOf(build({ enemy: back })), snapshotOf(build({ enemy: reread })));
});

test('custom enemy records keep their numbers in the fixed order', () => {
  const e = updateEnemy(ctx, enemyForPreset(ctx, 'Custom'), { hp: 5000, armor: 300 });
  assert.deepEqual(Object.keys(e), ['preset', 'level', 'steelPath', 'faction', 'hp', 'armor', 'shields', 'overguard', 'headshot']);
  assert.equal(e.hp, 5000);
  assert.equal(e.armor, 300);
});

test('a stale result is not saved with a changed build', () => {
  const b = build({ lastResult: result });
  assert.equal('lastResult' in buildToSave(b, undefined), false);
  assert.deepEqual(buildToSave(b, { ...result, avgDps: 99 }).lastResult.avgDps, 99);
});

test('save trims the name and the working build keeps the trimmed name', () => {
  for (const [name, stored] of [['My build ', 'My build'], ['', 'Untitled build'], ['  ', 'Untitled build']]) {
    const b = build({ name });
    const sent = buildToSave(b, result);
    assert.equal(sent.name, stored);
    const saved = { ...sent, id: 'id-1', updatedAt: '2026-01-01T00:00:00.000Z' };
    const after = buildAfterSave(b, sent, saved);
    assert.equal(after.name, stored);
    assert.equal(after.id, 'id-1');
    assert.equal(snapshotOf(after), snapshotOf(sent), 'build is not dirty right after saving');
    assert.deepEqual(after.lastResult, result);
  }
});

test('edits made while saving are kept and drop the stored result', () => {
  const b = build({ lastResult: { ...result, avgDps: 1 } });
  const sent = buildToSave(b, result);
  const saved = { ...sent, id: 'id-1', updatedAt: 'now' };
  const edited = { ...b, name: 'Renamed', mods: [{ name: 'Serration', rank: 10 }, ...emptySlots().slice(1)] };
  const after = buildAfterSave(edited, sent, saved);
  assert.equal(after.name, 'Renamed');
  assert.equal(after.mods[0].name, 'Serration');
  assert.equal('lastResult' in after, false);
  assert.notEqual(snapshotOf(after), snapshotOf(sent));
  // A save without a result clears an old one on the working build too.
  const noResult = buildAfterSave(b, buildToSave(b, undefined), { ...buildToSave(b, undefined), id: 'id-1', updatedAt: 'now' });
  assert.equal('lastResult' in noResult, false);
});
