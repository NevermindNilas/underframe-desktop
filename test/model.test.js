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

test('compare rows measure against the chosen baseline', async () => {
  const { compareRows } = await import('../src/renderer/model.js');
  const pins = [{ id: 'a', avgDps: 100 }, { id: 'b', avgDps: 150 }, { id: 'c', avgDps: 50 }];
  const first = compareRows(pins);
  assert.equal(first[0].baseline, true);
  assert.equal(first[0].delta, null);
  assert.equal(first[1].delta, 0.5);
  const byB = compareRows(pins, 'b');
  assert.equal(byB[1].baseline, true);
  assert.equal(byB[0].delta, -1 / 3);
  assert.equal(compareRows(pins, 'gone')[0].baseline, true, 'an unknown baseline falls back to the first pin');
});

test('pins keep the newest 20 and report what was dropped', async () => {
  const { addPin, MAX_PINS } = await import('../src/renderer/model.js');
  let pins = [];
  for (let i = 0; i < MAX_PINS; i++) ({ pins } = addPin(pins, { id: String(i) }));
  assert.equal(pins.length, MAX_PINS);
  const r = addPin(pins, { id: 'new' });
  assert.equal(r.pins.length, MAX_PINS);
  assert.deepEqual(r.dropped.map(p => p.id), ['0']);
  assert.equal(r.pins.at(-1).id, 'new');
  assert.deepEqual(addPin([], { id: 'x' }).dropped, []);
});

test('result delta is hidden without a previous result or under 0.05%', async () => {
  const { resultDelta } = await import('../src/renderer/model.js');
  assert.equal(resultDelta(110, 100), 0.1);
  assert.equal(resultDelta(90, 100), -0.1);
  assert.equal(resultDelta(100.04, 100), null);
  assert.equal(resultDelta(100, null), null);
  assert.equal(resultDelta(100, 0), null);
});

test('mod candidates explain why a mod is blocked', async () => {
  const { modCandidates } = await import('../src/renderer/model.js');
  const { indexMods } = await import('../src/shared/mods.js');
  const m = (name, extra = {}) => ({ 'Local Name': name, Type: 'PRIMARY', 'Compat Name': 'Rifle', 'Fusion Limit': 5, Stats: [], ...extra });
  const data = {
    mods: [m('Serration'), m('Amalgam Serration'), m('Split Chamber'), m('Hornet Strike', { Type: 'SECONDARY', 'Compat Name': 'Pistol' })],
    incompatible_mods: [{ 'Local Name': 'Serration', 'Incompatible Mods': ['Amalgam Serration'] }],
  };
  const weapon = { name: 'Braton Prime', type: 'Primary', subtype: 'Rifle', fire_modes: [{}] };
  const ctx2 = { data, index: indexMods(data), weaponByName: new Map([[weapon.name, weapon]]), exilus: new Set(), popular: new Set(['Split Chamber']) };
  const b = build({ mods: [null, { name: 'Serration', rank: 10 }, ...emptySlots().slice(2)] });
  const list = modCandidates(ctx2, b, 4);
  const by = Object.fromEntries(list.map(c => [c.name, c]));
  assert.equal(by.Serration.conflict, 'Already in slot 2');
  assert.equal(by['Amalgam Serration'].conflict, 'Conflicts with Serration');
  assert.equal(by['Split Chamber'].conflict, null);
  assert.equal(by['Hornet Strike'], undefined, 'incompatible mods are not offered');
  const own = modCandidates(ctx2, b, 1);
  const serr = own.find(c => c.name === 'Serration');
  assert.equal(serr.conflict, null, 'a slot never conflicts with its own mod');
  assert.equal(serr.equipped, true);
});

test('library sorts and search', async () => {
  const { sortBuilds, matchesBuildQuery } = await import('../src/renderer/model.js');
  const list = [
    { id: '1', name: 'Bravo', weaponName: 'Soma', updatedAt: '2026-01-02', lastResult: { avgDps: 10 } },
    { id: '2', name: 'alpha', weaponName: 'Braton Prime', updatedAt: '2026-01-03' },
    { id: '3', name: 'Charlie', weaponName: 'Lex', updatedAt: '2026-01-01', lastResult: { avgDps: 50 } },
  ];
  assert.deepEqual(sortBuilds(list).map(b => b.id), ['2', '1', '3']);
  assert.deepEqual(sortBuilds(list, 'name').map(b => b.id), ['2', '1', '3']);
  assert.deepEqual(sortBuilds(list, 'dps').map(b => b.id), ['3', '1', '2']);
  assert.equal(matchesBuildQuery(list[1], 'braton'), true);
  assert.equal(matchesBuildQuery({ name: 'X', weaponName: 'Y', tags: ['Beginner'] }, 'begin'), true);
  assert.equal(matchesBuildQuery(list[0], 'zzz'), false);
  assert.equal(matchesBuildQuery(list[0], '  '), true);
});

test('target labels name everything the result depends on, headshots and custom pools included', async () => {
  const { targetLabel, updateEnemy } = await import('../src/renderer/model.js');
  const crew = enemyForPreset(ctx, 'Elite Crewman');
  assert.equal(targetLabel(crew), 'Elite Crewman · L145 · Corpus');
  assert.equal(targetLabel({ ...crew, steelPath: true, headshot: true }), 'Elite Crewman · L145 · Steel Path · Corpus · Headshots');
  const custom = updateEnemy(ctx, enemyForPreset(ctx, 'Custom'), { hp: 57000, shields: 33000, armor: 0 });
  const label = targetLabel(custom);
  assert.match(label, /^Custom target · 57k health · 33k shields · 0 armor · /);
  assert.equal(label.split(custom.faction).length - 1, 1, 'the faction appears once');
  assert.notEqual(targetLabel({ ...custom, hp: 1000 }), label, 'different custom pools give different labels');
});

test('pins say what changed against the baseline', async () => {
  const { makePin, pinChanges, compareRows } = await import('../src/renderer/model.js');
  const summary = { avgDps: 100, ttk: 2, ok: true, runs: 8, killedRuns: 8, maxTime: 30 };
  const base = build({ mods: [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, ...emptySlots().slice(2)] });
  const a = makePin(base, summary, 'a');
  const b = makePin({
    ...base,
    mods: [{ name: 'Serration', rank: 0 }, null, { name: 'Hellfire', rank: 5 }, ...emptySlots().slice(3)],
    enemy: { ...base.enemy, steelPath: true, headshot: true },
  }, { ...summary, avgDps: 50 }, 'b');
  assert.deepEqual(pinChanges(b, a), ['Serration R10→R0', '+Hellfire R5', '−Split Chamber', 'Steel Path on', 'Headshots on']);
  assert.deepEqual(pinChanges(a, a), []);
  assert.equal(pinChanges({ id: 'old' }, a), null, 'pins saved before this feature have no config');
  const rows = compareRows([a, b, { ...a, id: 'c' }]);
  assert.equal(rows[0].changesText, '—', 'the baseline row already carries the Baseline badge');
  assert.match(rows[1].changesText, /^Serration R10→R0, \+Hellfire R5/);
  assert.equal(rows[2].changesText, 'Same setup');
});

test('undoing "Clear all" keeps pins added since', async () => {
  const { mergePins } = await import('../src/renderer/model.js');
  const cleared = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(mergePins(cleared, [{ id: 'c' }]).map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(mergePins(cleared, [{ id: 'b' }, { id: 'c' }]).map(p => p.id), ['a', 'b', 'c'], 'no duplicates');
  assert.deepEqual(mergePins(cleared, [{ id: 'c' }], 2).map(p => p.id), ['b', 'c'], 'the newest stay within the limit');
});

test('best-mod gains: against the mod in the slot, else the empty slot; the equipped mod is always listed', async () => {
  const { sweepView } = await import('../src/renderer/model.js');
  const all = Array.from({ length: 12 }, (_, i) => ({ name: `M${i}`, rank: 5, dps: 2000 - i * 100 }));
  const sweep = { baseDps: 1000, all };
  const empty = sweepView(sweep, null);
  assert.equal(empty.base.kind, 'empty');
  assert.equal(empty.rows.length, 10);
  assert.equal(empty.rows[0].gain, 1);
  // M11 is in the slot and ranks 12th: it is appended with its place, and gains are measured against it.
  const filled = sweepView(sweep, 'M11');
  assert.deepEqual(filled.base, { kind: 'mod', name: 'M11', dps: 900, rank: 5 });
  assert.equal(filled.rows.length, 11);
  assert.deepEqual([filled.rows.at(-1).name, filled.rows.at(-1).place, filled.rows.at(-1).equipped], ['M11', 12, true]);
  assert.ok(Math.abs(filled.rows[0].gain - (2000 - 900) / 900) < 1e-9);
  // After Replace with #1, the same numbers stay valid, now measured against M0, which is marked equipped.
  const swapped = sweepView(sweep, 'M0');
  assert.equal(swapped.rows[0].equipped, true);
  assert.equal(swapped.rows[0].gain, 0);
  assert.equal(swapped.rows.length, 10);
});

test('the best-mod search is keyed on the build without the searched slot', async () => {
  const { sweepKeyOf, setSlot } = await import('../src/renderer/model.js');
  const ctx3 = { ...ctx, presetNames: Object.keys(ctx.presets) };
  const b = build({ mods: [{ name: 'Serration', rank: 10 }, ...emptySlots().slice(1)] });
  const key = sweepKeyOf(ctx3, b, 1);
  assert.equal(sweepKeyOf(ctx3, setSlot(b, 1, { name: 'Split Chamber', rank: 5 }), 1), key, 'equipping a result in that slot keeps it current');
  assert.notEqual(sweepKeyOf(ctx3, setSlot(b, 0, null), 1), key, 'changing another slot makes it stale');
  assert.notEqual(sweepKeyOf(ctx3, { ...b, simTime: 60 }, 1), key);
});

test('incarnon modes are flagged as partly simulated', async () => {
  const { isIncarnonMode } = await import('../src/renderer/model.js');
  assert.equal(isIncarnonMode('Incarnon Form'), true);
  assert.equal(isIncarnonMode('Normal Attack'), false);
  assert.equal(isIncarnonMode(undefined), false);
});
