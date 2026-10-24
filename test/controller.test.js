// App controller (src/renderer/controller.js) in node: window.uf, the engine worker and the bits of DOM
// it touches are stand-ins. Covers the state bugs found in review: delete/restore of the open build, saves
// during a pending simulation, best-mod staleness, compare undo, the delta across builds, Ctrl+Z on undo
// toasts, focus after the "Save changes?" dialog, and Ctrl+P while updating.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const haveCore = existsSync(coreDir + 'data/data.json') && existsSync(coreDir + 'manifest.json');
const opts = { skip: haveCore ? false : 'core/ (Underframe data) is not checked out' };

// ---------- stand-ins ----------

/** Saved builds on "disk". */
const disk = new Map();
let saveDelay = 0;
const fakeUf = {
  smoke: false,
  scenes: false,
  backdrop: 'solid',
  appInfo: async () => ({ version: 'test' }),
  checkUpstream: async () => ({ outdated: false }),
  builds: {
    list: async () => [...disk.values()],
    save: async b => {
      if (saveDelay) await new Promise(r => setTimeout(r, saveDelay));
      const saved = { ...structuredClone(b), id: b.id ?? `id-${disk.size + 1}-${Math.random().toString(36).slice(2, 6)}`, updatedAt: new Date().toISOString() };
      disk.set(saved.id, saved);
      return structuredClone(saved);
    },
    remove: async id => { disk.delete(id); },
  },
  openExternal: async () => true,
  onCloseRequest: () => {},
  closeAnswer: async () => {},
};

/** The engine worker: deterministic results from the input; can be held to keep a simulation pending. */
const engineState = { held: false, queue: [], workers: 0, crashNext: false };
class FakeWorker {
  constructor() { engineState.workers++; }
  postMessage(msg) {
    const answer = () => {
      let data = { id: msg.id, ok: true };
      if (msg.type === 'simulate') {
        const text = JSON.stringify(msg.input);
        let h = 0;
        for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100000;
        data = {
          ...data,
          results: msg.seeds.map(seed => ({
            avgDps: 1000 + (h % 5000) + seed, ttk: '2.50s', avgHit: 100, firstHitDamage: 90,
            ...(msg.input.debugLog || msg.input.debug_log ? { debugLog: [] } : {}),
          })),
        };
      }
      this.onmessage?.({ data });
    };
    if (engineState.crashNext && msg.type === 'simulate') {
      engineState.crashNext = false;
      setTimeout(() => this.onerror?.({ message: 'test crash', preventDefault() {} }), 0);
      return;
    }
    if (engineState.held && msg.type === 'simulate') engineState.queue.push(answer);
    else setTimeout(answer, 0);
  }
  terminate() {}
}
const release = () => {
  engineState.held = false;
  for (const a of engineState.queue.splice(0)) setTimeout(a, 0);
};

/** Minimal DOM: focus requests are recorded, and one element stands for "the control that was focused". */
const focusRequests = [];
const body = { tagName: 'BODY' };
const makeEl = name => ({
  name, tagName: 'BUTTON', isConnected: true, focused: 0,
  getClientRects: () => [{}], closest: () => null, contains: () => false,
  focus() { this.focused++; globalThis.document.activeElement = this; },
});
globalThis.window = { uf: fakeUf, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  body,
  activeElement: body,
  querySelector(sel) {
    const m = /data-focus-id="([^"]+)"/.exec(sel);
    if (m) focusRequests.push(m[1]);
    return null;
  },
  querySelectorAll: () => [],
};
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.CSS = { escape: s => s };
globalThis.Worker = FakeWorker;
globalThis.fetch = async url => {
  const file = url === '/core/manifest.json' ? 'manifest.json' : 'data/data.json';
  const buf = readFileSync(coreDir + file);
  return new Response(buf, { headers: { 'content-length': String(buf.length) } });
};

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${fn}`);
    await tick(5);
  }
}

let C;
let M;
const toasts = [];
before(async () => {
  if (!haveCore) return;
  C = await import('../src/renderer/controller.js');
  M = await import('../src/renderer/model.js');
  C.onToast(t => toasts.push(t));
  await C.boot({ onReady: async () => {} });
  assert.equal(C.store.get().phase, 'ready', C.store.get().error);
});

const actions = new Proxy({}, { get: (_t, k) => C.actions[k] });
const store = { get: () => C.store.get() };
const lastToast = () => toasts.filter(t => t.title).at(-1);
async function fresh() {
  release();
  saveDelay = 0;
  await actions.newBuild({ force: true });
  await actions.runNow();
  document.activeElement = body;
}

test('deleting the open build leaves an unsaved copy that leaving asks about; Undo re-attaches it', opts, async () => {
  await fresh();
  actions.equipMod(0, 'Serration', 10, { focus: false });
  await actions.runNow();
  const saved = await actions.save();
  assert.equal(C.isDirty(), false);
  await actions.deleteSaved(saved.id);
  assert.equal(store.get().build.id, undefined);
  assert.equal(C.isDirty(), true, 'the orphaned copy counts as unsaved');
  const leaving = C.confirmLeave();
  assert.equal(store.get().dialog?.type, 'leave', 'New build or closing would ask first');
  await actions.answerLeave('cancel');
  assert.equal(await leaving, false);
  assert.equal(await actions.restoreDeleted(saved), true);
  assert.equal(store.get().build.id, saved.id);
  assert.equal(C.isDirty(), false, 'measured against the restored copy again');
});

test('Undo of a delete does nothing once the open copy was saved again as a new build', opts, async () => {
  await fresh();
  actions.setName('Resave test');
  const saved = await actions.save();
  await actions.deleteSaved(saved.id);
  const resaved = await actions.save();
  assert.notEqual(resaved.id, saved.id);
  assert.equal(await actions.restoreDeleted(saved), false);
  assert.deepEqual(store.get().savedBuilds.filter(b => b.name === saved.name).map(b => b.id), [resaved.id], 'no duplicate');
  assert.match(lastToast().title, /nothing to restore/);
});

test('a build saved while its simulation is pending gets its result stored once the run lands', opts, async () => {
  await fresh();
  engineState.held = true;
  actions.equipMod(1, 'Split Chamber', 5, { focus: false });
  const run = actions.runNow();
  const saved = await actions.save();
  assert.equal(saved.lastResult, undefined, 'nothing current to save yet');
  release();
  const summary = await run;
  await until(() => disk.get(saved.id)?.lastResult);
  assert.equal(disk.get(saved.id).lastResult.avgDps, summary.avgDps);
  assert.equal(store.get().savedBuilds.find(b => b.id === saved.id).lastResult.avgDps, summary.avgDps);
  assert.equal(C.isDirty(), false);
});

test('the delta badge never compares two different builds', opts, async () => {
  await fresh();
  actions.equipMod(0, 'Serration', 10, { focus: false });
  await actions.runNow();
  assert.ok(store.get().sim.prev, 'an edit within one build has a previous result');
  await actions.newBuild({ force: true });
  assert.equal(store.get().sim.prev, null);
  await actions.runNow();
  assert.equal(store.get().sim.prev, null, 'the first result of the new build has nothing to compare with');
  actions.equipMod(0, 'Serration', 10, { focus: false });
  await actions.runNow();
  assert.ok(store.get().sim.prev);
});

test('equipping a best-mod result keeps the other results current', opts, async () => {
  await fresh();
  actions.equipMod(0, 'Serration', 10, { focus: false });
  await actions.startSweep(2);
  const { sweep, ctx } = store.get();
  assert.equal(sweep.status, 'done');
  const pick = sweep.all[1].name;
  assert.equal(actions.equipMod(2, pick, undefined, { focus: false }), true);
  assert.equal(store.get().sweep.key, M.sweepKeyOf(ctx, store.get().build, 2), 'not stale after Equip');
  actions.setRank(0, 3);
  assert.notEqual(store.get().sweep.key, M.sweepKeyOf(ctx, store.get().build, 2), 'stale after another slot changes');
  actions.dismissSweep();
});

test('Undo after "Clear all" keeps pins added since; Ctrl+Z runs it while the toast is up', opts, async () => {
  await fresh();
  actions.clearPins();
  actions.pinResult();
  const first = store.get().pins[0].id;
  actions.clearPins();
  assert.equal(store.get().pins.length, 0);
  assert.match(lastToast().body, /Ctrl\+Z/);
  actions.pinResult();
  const added = store.get().pins[0].id;
  assert.equal(actions.undoLatest(), true, 'Ctrl+Z undoes the clear');
  assert.deepEqual(store.get().pins.map(p => p.id), [first, added], 'cleared pin back first, the newer pin kept');
  assert.ok(toasts.some(t => t.dismiss), 'the undone toast is dismissed');
});

test('Ctrl+Z prefers a build edit made after the undo toast', opts, async () => {
  await fresh();
  actions.pinResult();
  actions.clearPins();
  await tick(2);
  actions.setDuration(10);
  assert.equal(actions.undoLatest(), true);
  assert.equal(store.get().build.simTime, 30, 'the newer build edit is undone');
  assert.equal(store.get().pins.length, 0, 'the older clear is left alone');
});

test('Ctrl+Z restores a library delete while its toast is up', opts, async () => {
  await fresh();
  const other = await actions.save({ asCopy: true });
  await actions.newBuild({ force: true });
  await actions.deleteSaved(other.id);
  assert.equal(disk.has(other.id), false);
  assert.equal(actions.undoLatest(), true);
  await until(() => disk.has(other.id));
  assert.ok(store.get().savedBuilds.some(b => b.id === other.id), 'restored with the same id');
});

test('after "Don\'t save", focus goes back to the control that started the action', opts, async () => {
  await fresh();
  actions.setNotes('dirty');
  assert.equal(C.isDirty(), true);
  const nameField = makeEl('build-name-field');
  document.activeElement = nameField;
  const done = actions.newBuild();
  await until(() => store.get().dialog?.type === 'leave');
  document.activeElement = body; // the dialog took focus and is about to close
  await actions.answerLeave('discard');
  assert.equal(await done, true);
  await tick(20);
  assert.ok(nameField.focused >= 1, 'focus returned to the name field');
  assert.equal(document.activeElement, nameField);
});

test('Ctrl+P while the result is updating pins once it is in', opts, async () => {
  await fresh();
  actions.clearPins();
  engineState.held = true;
  actions.equipMod(3, 'Point Strike', 5, { focus: false });
  const run = actions.runNow();
  assert.equal(actions.pinResult(), false);
  assert.match(lastToast().title, /once the result finishes/);
  release();
  await run;
  await until(() => store.get().pins.length === 1);
  assert.equal(store.get().pins[0].avgDps, store.get().sim.summary.avgDps);
});

test('rename waits for a save of the same build to finish', opts, async () => {
  await fresh();
  const saved = await actions.save();
  saveDelay = 30;
  actions.setNotes('more');
  const saving = actions.save();
  assert.equal(actions.startRename(saved.id), false);
  await saving;
  assert.equal(actions.startRename(saved.id), true);
  actions.cancelRename();
});

test('a crashed engine worker is replaced, so Try again works', opts, async () => {
  await fresh();
  const before = engineState.workers;
  engineState.crashNext = true;
  actions.equipMod(4, 'Hellfire', 5, { focus: false });
  assert.equal(await actions.runNow(), null);
  assert.equal(store.get().sim.status, 'error');
  assert.match(store.get().sim.error, /crashed/);
  const again = await actions.runNow();
  assert.ok(again?.ok, 'the retry simulates on a fresh worker');
  assert.equal(engineState.workers, before + 1);
  assert.equal(store.get().sim.status, 'done');
});
