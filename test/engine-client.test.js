// Engine client (src/renderer/engine-client.js): a crashed worker is replaced on the next request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngineClient } from '../src/renderer/engine-client.js';

/** A stand-in Worker: answers every message, or crashes when told to. */
function fakeWorkers() {
  const made = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.seen = [];
      this.terminated = false;
      made.push(this);
    }
    postMessage(msg) {
      this.seen.push(msg.type);
      if (this.terminated) return;
      queueMicrotask(() => {
        if (this.crashNext) {
          this.crashNext = false;
          this.onerror?.({ message: 'boom', preventDefault() {} });
          return;
        }
        this.onmessage?.({ data: { id: msg.id, ok: true, results: msg.seeds?.map(s => ({ avgDps: s })) } });
      });
    }
    terminate() { this.terminated = true; }
  }
  return { FakeWorker, made };
}

test('after a worker crash, the next request starts a new worker and loads the engine again', async () => {
  const { FakeWorker, made } = fakeWorkers();
  let restarts = 0;
  const engine = createEngineClient('/w.js', { WorkerImpl: FakeWorker, onRestart: () => { restarts++; } });
  await engine.init();
  assert.deepEqual(await engine.simulate({}, [1, 2]), [{ avgDps: 1 }, { avgDps: 2 }]);

  made[0].crashNext = true;
  await assert.rejects(engine.simulate({}, [3]), /engine worker crashed: boom/);
  assert.equal(made[0].terminated, true);
  assert.equal(restarts, 1, 'cached state is dropped when the worker dies');

  // "Try again": a fresh worker, init first, then the request.
  assert.deepEqual(await engine.simulate({}, [4]), [{ avgDps: 4 }]);
  assert.equal(made.length, 2);
  assert.deepEqual(made[1].seen, ['init', 'simulate']);
  assert.equal(restarts, 2);
});

test('requests waiting on a restart share one new worker', async () => {
  const { FakeWorker, made } = fakeWorkers();
  const engine = createEngineClient('/w.js', { WorkerImpl: FakeWorker });
  await engine.init();
  made[0].crashNext = true;
  await assert.rejects(engine.cacheAppState(1, {}));
  const [a, b] = await Promise.all([engine.simulate({}, [5]), engine.simulate({}, [6])]);
  assert.deepEqual([a, b], [[{ avgDps: 5 }], [{ avgDps: 6 }]]);
  assert.equal(made.length, 2);
  assert.deepEqual(made[1].seen, ['init', 'simulate', 'simulate']);
});
