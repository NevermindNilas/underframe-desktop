// The engine worker (src/renderer/engine.worker.js) run in a vm context with the real engine. The engine holds
// one app-state document at a time, so going back to an earlier weapon (undo of a weapon change) must still
// simulate: the worker re-caches the document the run names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { indexMods } from '../src/shared/mods.js';
import { computeWeaponStats, selectableModes } from '../src/shared/stats.js';
import { buildAppState, buildEngineInput } from '../src/shared/engine-input.js';
import { scaleEnemy } from '../src/shared/enemy.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const workerFile = fileURLToPath(new URL('../src/renderer/engine.worker.js', import.meta.url));
const skip = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json') ? false : 'core submodule not checked out';

/** The worker script in a sandbox: `send(msg)` resolves to its reply. */
function loadWorker() {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const wasm = readFileSync(coreDir + 'engine/dps_calculator.wasm');
  const replies = new Map();
  const self = {
    createDpsModule,
    postMessage: msg => replies.get(msg.id)?.(msg),
  };
  const context = vm.createContext({
    self,
    importScripts: () => { throw new Error('importScripts should not be needed'); },
    fetch: async () => ({ ok: true, arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }),
    console,
  });
  vm.runInContext(readFileSync(workerFile, 'utf8'), context, { filename: workerFile });
  let id = 0;
  return msg => new Promise(resolve => {
    const i = ++id;
    replies.set(i, resolve);
    self.onmessage({ data: { ...msg, id: i } });
  });
}

test('a run on an earlier weapon\'s app state still works after another weapon was cached', { skip }, async () => {
  const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
  const index = indexMods(data);
  const send = loadWorker();
  const inputFor = (name, ref) => {
    const weapon = data.weapons.find(w => w.name === name);
    const reload = data.reload_data.find(r => r.name === weapon.name) ?? null;
    const enemy = scaleEnemy({ base_hp: 1000, base_armor: 0, base_level: 1, faction: 'Corpus' }, { level: 1 });
    const { modes } = computeWeaponStats(weapon, [], { modsByName: index.byName, reload, targetFaction: enemy.faction });
    return buildEngineInput({
      weapon, modSlots: [], weaponStats: modes, enemy, modeName: selectableModes(weapon)[0].mode_name, maxTime: 20, reload, appStateRef: ref, debugLog: false,
    });
  };
  const weapon = name => data.weapons.find(w => w.name === name);
  assert.equal((await send({ type: 'init' })).ok, true);
  assert.equal((await send({ type: 'cacheAppState', ref: 1, appState: buildAppState(data, weapon('Strun')) })).ok, true);
  const first = await send({ type: 'simulate', input: inputFor('Strun', 1), seeds: [3] });
  assert.equal(first.results[0].error, undefined);
  // A weapon change caches a second document, which evicts the first inside the engine.
  assert.equal((await send({ type: 'cacheAppState', ref: 2, appState: buildAppState(data, weapon('Lex Prime')) })).ok, true);
  const lex = await send({ type: 'simulate', input: inputFor('Lex Prime', 2), seeds: [3] });
  assert.equal(lex.results[0].error, undefined);
  // Undo: back to Strun's ref. Before the fix this failed with "appStateRef not cached; call cache_app_state first."
  const again = await send({ type: 'simulate', input: inputFor('Strun', 1), seeds: [3] });
  assert.equal(again.results[0].error, undefined, again.results[0].error);
  assert.equal(again.results[0].avgDps, first.results[0].avgDps, 'same seed, same weapon, same result');
});
