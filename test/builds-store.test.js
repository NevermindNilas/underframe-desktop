// Saved-build store against a temp dir: save/list/remove, atomic writes, corruption recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuildsStore, normalizeBuild, MOD_SLOTS } from '../src/main/builds-store.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uf-builds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function clock() {
  let ms = Date.parse('2026-01-01T00:00:00Z');
  return () => new Date((ms += 1000));
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const sample = (over = {}) => ({
  name: 'Crit Braton',
  weaponName: 'Braton Prime',
  modeName: 'Auto',
  mods: [{ name: 'Serration', rank: 10 }, null, { name: 'Point Strike', rank: 5 }],
  enemy: { preset: 'Elite Crewmen', level: 100, steelPath: false, faction: 'Corpus', hp: 1, armor: 2, shields: 3, overguard: 0, headshot: false },
  simTime: 20,
  notes: 'test',
  ...over,
});

test('save assigns id and updatedAt, list returns newest first, remove deletes', async t => {
  const dir = await tempDir(t);
  const store = createBuildsStore(dir, { randomUUID: ids(), now: clock() });
  assert.deepEqual(await store.list(), []);

  const a = await store.save(sample());
  assert.equal(a.id, 'id-1');
  assert.equal(a.updatedAt, '2026-01-01T00:00:01.000Z');
  assert.equal(a.mods.length, MOD_SLOTS);
  assert.deepEqual(a.mods.slice(0, 3), [{ name: 'Serration', rank: 10 }, null, { name: 'Point Strike', rank: 5 }]);

  const b = await store.save(sample({ name: 'Second' }));
  assert.deepEqual((await store.list()).map(x => x.id), ['id-2', 'id-1']);

  // saving an existing id replaces it and bumps it to the top
  const a2 = await store.save({ ...a, name: 'Renamed', lastResult: { avgDps: 123.5, ttk: 2, avgHit: 9, firstHitDamage: 8, runs: 5 } });
  assert.equal(a2.id, 'id-1');
  const listed = await store.list();
  assert.deepEqual(listed.map(x => [x.id, x.name]), [['id-1', 'Renamed'], ['id-2', 'Second']]);
  assert.deepEqual(listed[0].lastResult, { avgDps: 123.5, ttk: 2, avgHit: 9, firstHitDamage: 8, runs: 5 });

  await store.remove(b.id);
  await store.remove('missing');
  assert.deepEqual((await store.list()).map(x => x.id), ['id-1']);

  // persisted: a fresh store reads the same thing back, no temp files left behind
  const again = createBuildsStore(dir);
  assert.deepEqual(await again.list(), await store.list());
  assert.deepEqual(await readdir(dir), ['builds.json']);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'builds.json'), 'utf8')).version, 1);
});

test('concurrent saves do not lose builds', async t => {
  const dir = await tempDir(t);
  const store = createBuildsStore(dir);
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.save(sample({ name: `b${i}` }))));
  assert.equal((await createBuildsStore(dir).list()).length, 10);
});

test('save rejects unusable input and normalises the rest', async t => {
  const dir = await tempDir(t);
  const store = createBuildsStore(dir);
  await assert.rejects(store.save(null));
  await assert.rejects(store.save({ name: 'no weapon' }));
  const n = normalizeBuild({ weaponName: 'Braton', mods: 'x', enemy: null, simTime: 'abc', extra: 'dropped' });
  assert.equal(n.name, 'Braton');
  assert.equal(n.mods.length, MOD_SLOTS);
  assert.ok(n.mods.every(m => m === null));
  assert.equal(n.enemy.preset, 'Custom');
  assert.equal(n.simTime, 20);
  assert.equal(n.extra, undefined);
  // the store still works after a rejected save
  assert.equal((await store.save(sample())).weaponName, 'Braton Prime');
});

test('unparseable file is backed up and the store starts empty', async t => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'builds.json'), '{ not json');
  const store = createBuildsStore(dir);
  assert.deepEqual(await store.list(), []);
  assert.equal(await readFile(path.join(dir, 'builds.corrupt-1.json'), 'utf8'), '{ not json');
  await store.save(sample());
  assert.equal((await createBuildsStore(dir).list()).length, 1);

  // a second corruption gets the next free number
  await writeFile(path.join(dir, 'builds.json'), '[]');
  assert.deepEqual(await createBuildsStore(dir).list(), []);
  assert.equal(await readFile(path.join(dir, 'builds.corrupt-2.json'), 'utf8'), '[]');
});

test('invalid entries are dropped, the original is backed up, valid ones survive', async t => {
  const dir = await tempDir(t);
  const first = createBuildsStore(dir);
  const good = await first.save(sample());
  const file = path.join(dir, 'builds.json');
  const original = JSON.stringify({ version: 1, builds: [good, { id: 'bad' }, 'junk'] });
  await writeFile(file, original);
  const store = createBuildsStore(dir);
  assert.deepEqual((await store.list()).map(b => b.id), [good.id]);
  assert.equal(await readFile(path.join(dir, 'builds.corrupt-1.json'), 'utf8'), original);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).builds.length, 1);
});
