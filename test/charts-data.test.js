// Chart helpers (src/renderer/charts-data.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipTime, downsample, killTime, niceMax, niceTicks, sampleEvery } from '../src/renderer/charts-data.js';

const pts = [
  { t: 0, hp: 100, shields: 50, overguard: 0 },
  { t: 0.3, hp: 100, shields: 20, overguard: 0 },
  { t: 0.9, hp: 60, shields: 0, overguard: 0 },
  { t: 1.6, hp: 0, shields: 0, overguard: 0 },
];

test('table samples hold the last value at each step', () => {
  const rows = sampleEvery(pts, 0.5, 2);
  assert.deepEqual(rows.map(r => r.t), [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(rows.map(r => r.hp), [100, 100, 60, 60, 0]);
  assert.deepEqual(rows.map(r => r.shields), [50, 20, 0, 0, 0]);
  assert.deepEqual(sampleEvery([], 0.5, 2), []);
});

test('kill time and axis helpers', () => {
  assert.equal(killTime(pts), 1.6);
  assert.equal(killTime(pts.slice(0, 3)), null);
  assert.equal(niceMax(23000), 25000);
  assert.equal(downsample(pts, 10), pts);
  assert.equal(downsample(Array.from({ length: 1000 }, (_, i) => ({ t: i })), 100).length, 101);
});

test('axis ticks are round and evenly spaced, never 6,250-style steps', () => {
  const y = niceTicks(23000, 4);
  assert.ok([1, 2, 2.5, 5].includes(y.step / 10 ** Math.floor(Math.log10(y.step))), `step ${y.step} is round`);
  assert.ok(y.count <= 4 && y.max >= 23000 && y.max === y.step * y.count);
  assert.deepEqual(niceTicks(23000, 5), { max: 25000, step: 5000, count: 5 });
  assert.deepEqual(niceTicks(30, 6), { max: 30, step: 5, count: 6 }, 'a 30 s run ends the axis at 30 s');
  assert.deepEqual(niceTicks(3.77, 6), { max: 4, step: 1, count: 4 });
  assert.deepEqual(niceTicks(0), { max: 1, step: 0.25, count: 4 });
  for (const v of [1, 7, 99, 101, 260, 6250, 12345, 987654]) {
    const t = niceTicks(v, 4);
    assert.ok(t.max >= v && t.count <= 4 && t.count >= 2, `${v} -> ${JSON.stringify(t)}`);
  }
});

test('points past the simulated time are clipped', () => {
  assert.deepEqual(clipTime(pts, 1).map(p => p.t), [0, 0.3, 0.9]);
  assert.equal(clipTime(pts, 0), pts);
  assert.deepEqual(clipTime([{ t: 5 }], 1), [{ t: 5 }], 'never empty');
});
