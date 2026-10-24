// Undo/redo stack (src/renderer/history.js) and restoring content into a working build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_LIMIT, canRedo, canUndo, emptyHistory, endGroup, record, redo, undo } from '../src/renderer/history.js';
import { contentOf, withContent, snapshotOf, emptySlots } from '../src/renderer/model.js';

test('undo and redo walk the recorded steps', () => {
  let h = emptyHistory();
  assert.equal(canUndo(h), false);
  assert.equal(undo(h, 'a'), null);
  h = record(h, 'a'); // a -> b
  h = record(h, 'b'); // b -> c
  let r = undo(h, 'c');
  assert.equal(r.value, 'b');
  h = r.history;
  r = undo(h, 'b');
  assert.equal(r.value, 'a');
  h = r.history;
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), true);
  r = redo(h, 'a');
  assert.equal(r.value, 'b');
  r = redo(r.history, 'b');
  assert.equal(r.value, 'c');
  assert.equal(redo(r.history, 'c'), null);
});

test('a new edit clears the redo side', () => {
  let h = record(emptyHistory(), 'a');
  h = undo(h, 'b').history;
  assert.equal(canRedo(h), true);
  h = record(h, 'a');
  assert.equal(canRedo(h), false);
});

test('edits in one group make one step until the group ends', () => {
  let h = emptyHistory();
  h = record(h, 'name: ', 'name');
  h = record(h, 'name: M', 'name');
  h = record(h, 'name: My', 'name');
  assert.equal(h.past.length, 1);
  h = endGroup(h);
  h = record(h, 'name: My build', 'name');
  assert.equal(h.past.length, 2);
  h = record(h, 'mods', null);
  h = record(h, 'mods 2', null);
  assert.equal(h.past.length, 4, 'ungrouped edits never merge');
});

test('the stack keeps the last HISTORY_LIMIT steps', () => {
  let h = emptyHistory();
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = record(h, i);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.past[0], 25);
});

test('restoring content keeps the build identity and drops a stale result', () => {
  const before = { name: 'A', weaponName: 'Braton Prime', modeName: 'Auto', mods: emptySlots(), enemy: { preset: 'X' }, simTime: 30, notes: '' };
  const saved = { ...before, name: 'B', mods: [{ name: 'Serration', rank: 10 }, ...emptySlots().slice(1)], id: 'id-1', updatedAt: 't', lastResult: { avgDps: 1 } };
  const restored = withContent(saved, contentOf(before));
  assert.equal(restored.id, 'id-1');
  assert.equal(restored.updatedAt, 't');
  assert.equal('lastResult' in restored, false);
  assert.equal(snapshotOf(restored), snapshotOf(before));
});
