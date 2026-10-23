// Classic Web Worker that hosts the Underframe damage engine (Emscripten + embind).
// Protocol: every request carries a numeric `id`, every reply echoes it.
//   {type:'init'}                          -> {id, ok:true} | {id, ok:false, error}
//   {type:'cacheAppState', ref, appState}  -> {id, ok:true} | {id, ok:false, error}
//   {type:'simulate', input, seeds}        -> {id, ok:true, results:[result per seed]}
// Per-run failures come back as {error} entries in `results`. When the input asks for no debug log
// the log is dropped; when it asks for one, each entry keeps everything except the per-status detail.
'use strict';

let engine = null;
let initPromise = null;

function errorText(e) {
  if (e && typeof e === 'object' && 'message' in e) return String(e.message);
  if (typeof e === 'number') return `Engine exception (code ${e})`;
  return String(e);
}

function init() {
  if (!initPromise) {
    initPromise = (async () => {
      if (typeof self.createDpsModule !== 'function') importScripts('/core/engine/dps_calculator.js');
      const res = await fetch('/core/engine/dps_calculator.wasm');
      if (!res.ok) throw new Error(`Could not load the damage engine (HTTP ${res.status}).`);
      const wasmBinary = await res.arrayBuffer();
      engine = await self.createDpsModule({ wasmBinary });
    })();
    initPromise.catch(() => { initPromise = null; });
  }
  return initPromise;
}

function slimLog(log) {
  if (!Array.isArray(log)) return log;
  return log.map(e => ({
    time: e.time, damage: e.damage, type: e.type, critTier: e.critTier, isHeadshot: e.isHeadshot,
    enemy: e.enemy ? { hp: e.enemy.hp, shields: e.enemy.shields, overguard: e.enemy.overguard, armor: e.enemy.armor } : null,
  }));
}

function simulate(input, seeds) {
  const json = JSON.stringify(input);
  const wantLog = Boolean(input?.simulationParams?.generateDebugLog);
  return seeds.map(seed => {
    try {
      engine.seed_rng(seed >>> 0);
      const r = JSON.parse(engine.calculate_dps_wasm(json));
      if (wantLog) r.debugLog = slimLog(r.debugLog);
      else delete r.debugLog;
      return r;
    } catch (e) {
      return { error: errorText(e) };
    }
  });
}

self.onmessage = async ({ data: msg }) => {
  const id = msg?.id;
  try {
    switch (msg?.type) {
      case 'init':
        await init();
        self.postMessage({ id, ok: true });
        break;
      case 'cacheAppState': {
        await init();
        const reply = JSON.parse(engine.cache_app_state(msg.ref | 0, typeof msg.appState === 'string' ? msg.appState : JSON.stringify(msg.appState)));
        self.postMessage(reply?.ok ? { id, ok: true } : { id, ok: false, error: reply?.error ?? 'cache_app_state failed' });
        break;
      }
      case 'simulate':
        await init();
        self.postMessage({ id, ok: true, results: simulate(msg.input, Array.isArray(msg.seeds) && msg.seeds.length ? msg.seeds : [1]) });
        break;
      default:
        self.postMessage({ id, ok: false, error: `Unknown request: ${msg?.type}` });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: errorText(e) });
  }
};
