// Renderer bootstrap: loads data and the engine, owns the app state and every action the UI can take.
import { createStore } from './store.js';
import { uf } from './platform.js';
import { createEngineClient } from './engine-client.js';
import { buildAppState } from '../shared/engine-input.js';
import { maxRank, conflictingMod } from '../shared/mods.js';
import * as M from './model.js';
import { buildStats, engineInputFor } from './sim.js';
import { confirmDialog, promptDialog, toast } from './ui/dialogs.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountEditor } from './ui/editor.js';
import { mountTarget } from './ui/target.js';
import { mountStats } from './ui/stats.js';
import { mountResults } from './ui/results.js';
import { mountCompare } from './ui/compare.js';
import { mountSweep } from './ui/sweep.js';
import { mountFooter } from './ui/footer.js';
import { runSmoke } from './smoke.js';

const PINS_KEY = 'uf.pins';
const LAST_BUILD_KEY = 'uf.lastBuildId';
const MAX_APP_STATES = 4;
const SIM_DEBOUNCE_MS = 300;

const $ = sel => document.querySelector(sel);

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const store = createStore({
  phase: 'loading',
  loadingText: 'Starting…',
  error: null,
  ctx: null,
  manifest: null,
  appInfo: null,
  upstream: null,
  savedBuilds: [],
  build: null,
  snapshot: '',
  buildNotice: null,
  sidebarTab: 'mine',
  saving: false,
  sim: { status: 'idle', key: null, summary: null, debug: null, debugEnemy: null, debugTime: null, error: null, debugError: null },
  pins: M.sanitizePins(storageGet(PINS_KEY, [])),
  sweep: null,
});

const errors = [];
const timings = {};
const engine = createEngineClient();

// ---------- derived values (memoized on the build object) ----------

let memo = { build: null };
function derived() {
  const { ctx, build } = store.get();
  if (memo.build !== build) {
    const stats = build ? buildStats(ctx, build) : null;
    memo = {
      build,
      stats,
      enemy: build ? M.resolveEnemy(ctx, build.enemy) : null,
      partialMap: M.unhandledByMod(stats?.modifiers?.unhandled),
      simKey: build ? M.simKeyOf(ctx, build) : '',
    };
  }
  return memo;
}

const simKey = () => derived().simKey;
const isDirty = () => {
  const { build, snapshot } = store.get();
  return Boolean(build) && M.snapshotOf(build) !== snapshot;
};

// ---------- engine plumbing ----------

/** weaponName -> {ref, promise}; Map order is LRU order. */
const appStates = new Map();
let nextRef = 1;

function ensureAppState(weapon) {
  const hit = appStates.get(weapon.name);
  if (hit) {
    appStates.delete(weapon.name);
    appStates.set(weapon.name, hit);
    return hit.promise;
  }
  let ref;
  if (appStates.size >= MAX_APP_STATES) {
    const [oldest, entry] = appStates.entries().next().value;
    appStates.delete(oldest);
    ref = entry.ref;
  } else {
    ref = nextRef++;
  }
  const entry = { ref, promise: engine.cacheAppState(ref, buildAppState(store.get().ctx.data, weapon)).then(() => ref) };
  entry.promise.catch(() => { if (appStates.get(weapon.name) === entry) appStates.delete(weapon.name); });
  appStates.set(weapon.name, entry);
  return entry.promise;
}

let simGen = 0;
let simTimer = null;

function scheduleSim(delay = SIM_DEBOUNCE_MS) {
  clearTimeout(simTimer);
  if (store.get().phase !== 'ready') return;
  store.set(s => ({ sim: { ...s.sim, status: 'pending' } }));
  simTimer = setTimeout(() => { runSim(); }, delay);
}

/** Run 8 seeded runs, then one with a debug log for the charts. Resolves to the summary, or null if superseded/failed. */
async function runSim() {
  clearTimeout(simTimer);
  const gen = ++simGen;
  const { ctx, build } = store.get();
  const key = M.simKeyOf(ctx, build);
  const enemy = M.resolveEnemy(ctx, build.enemy);
  const started = performance.now();
  store.set(s => ({ sim: { ...s.sim, status: 'running' } }));
  try {
    const weapon = ctx.weaponByName.get(build.weaponName);
    if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
    const ref = await ensureAppState(weapon);
    const results = await engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false }), M.SIM_SEEDS);
    if (gen !== simGen) return null;
    const summary = M.summarizeRuns(results, build.simTime);
    if (!summary.ok) throw new Error(summary.error);
    store.set(s => ({ sim: { ...s.sim, status: 'running', key, summary, error: null } }));

    const ref2 = await ensureAppState(weapon);
    const [debug] = await engine.simulate(engineInputFor(ctx, build, { appStateRef: ref2, debugLog: true }), [M.SIM_SEEDS[0]]);
    if (gen !== simGen) return summary;
    const debugOk = debug && !debug.error && Array.isArray(debug.debugLog);
    store.set(s => ({
      sim: {
        ...s.sim, status: 'done',
        debug: debugOk ? debug : null, debugEnemy: debugOk ? enemy : null, debugTime: build.simTime,
        debugError: debugOk ? null : String(debug?.error ?? 'No debug log returned'),
        ms: performance.now() - started,
      },
    }));
    return summary;
  } catch (e) {
    if (gen !== simGen) return null;
    const message = e?.message ?? String(e);
    errors.push(`simulation: ${message}`);
    store.set(s => ({ sim: { ...s.sim, status: 'error', key, error: message, summary: s.sim.key === key ? s.sim.summary : null } }));
    return null;
  }
}

// ---------- best-mod sweep ----------

let sweepToken = 0;

async function startSweep(slot) {
  const { ctx, build, sweep } = store.get();
  if (sweep?.status === 'running' || build.mods[slot]) return;
  const token = ++sweepToken;
  const weapon = ctx.weaponByName.get(build.weaponName);
  const candidates = M.modCandidates(ctx, build, slot).filter(c => !c.conflict);
  store.set({
    sweep: {
      slot, status: 'running', done: 0, total: candidates.length + 1, results: [], baseDps: null,
      key: M.simKeyOf(ctx, build), weaponName: build.weaponName, error: null,
    },
  });
  const dpsOf = async modSlots => {
    const ref = await ensureAppState(weapon);
    const runs = await engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false, modSlots }), M.SWEEP_SEEDS);
    const s = M.summarizeRuns(runs, build.simTime);
    return s.ok ? s.avgDps : NaN;
  };
  const patch = p => store.set(s => (token === sweepToken && s.sweep ? { sweep: { ...s.sweep, ...p } } : null));
  try {
    const baseDps = await dpsOf(build.mods);
    patch({ baseDps, done: 1 });
    const results = [];
    for (const c of candidates) {
      if (token !== sweepToken) return;
      const rank = maxRank(c.mod);
      const slots = build.mods.slice();
      slots[slot] = { name: c.name, rank };
      results.push({ name: c.name, rank, dps: await dpsOf(slots) });
      patch({ done: results.length + 1, results: M.rankSweep(results, baseDps) });
    }
    patch({ status: 'done', results: M.rankSweep(results, baseDps) });
  } catch (e) {
    patch({ status: 'error', error: e?.message ?? String(e) });
  }
}

function stopSweep(status) {
  sweepToken++;
  store.set(s => ({ sweep: s.sweep && status ? { ...s.sweep, status } : null }));
}

// ---------- actions ----------

function setBuild(build, extra = {}, { resim = true } = {}) {
  store.set({ build, ...extra });
  if (resim) scheduleSim();
}

function updateBuild(fn, opts) {
  const { build } = store.get();
  const next = fn(build);
  if (next && next !== build) setBuild(next, {}, opts);
}

async function confirmDiscard() {
  if (!isDirty()) return true;
  return confirmDialog({
    title: 'Discard unsaved changes?',
    message: `"${store.get().build.name}" has changes that are not saved.`,
    confirmLabel: 'Discard', danger: true,
  });
}

// Bumped whenever a different build is opened, so an in-flight save can tell it no longer owns the editor.
let openedBuildGeneration = 0;

function openWorkingBuild(build, notice = null) {
  openedBuildGeneration++;
  if (store.get().sweep?.status === 'running') stopSweep(null);
  else store.set({ sweep: null });
  setBuild(build, { snapshot: M.snapshotOf(build), buildNotice: notice?.length ? notice : null });
  storageSet(LAST_BUILD_KEY, build.id ?? null);
}

function upsertSaved(list, saved) {
  const i = list.findIndex(b => b.id === saved.id);
  return i >= 0 ? list.map(b => (b.id === saved.id ? saved : b)) : [...list, saved];
}

const actions = {
  setSidebarTab(tab) {
    store.set({ sidebarTab: tab });
  },

  async newBuild({ force = false } = {}) {
    if (!force && !(await confirmDiscard())) return;
    const { ctx, build } = store.get();
    openWorkingBuild(M.createBuild(ctx, build ? { enemy: build.enemy } : {}));
  },

  async openBuild(id) {
    const { ctx, savedBuilds, build } = store.get();
    if (build?.id === id) return;
    const saved = savedBuilds.find(b => b.id === id);
    if (!saved || !(await confirmDiscard())) return;
    const { build: next, warnings } = M.normalizeBuild(ctx, saved);
    openWorkingBuild(next, warnings);
  },

  async openFeatured(key) {
    const { ctx } = store.get();
    const f = ctx.featured.find(x => x.key === key);
    if (!f || !(await confirmDiscard())) return;
    const { build, notes } = M.buildFromFeatured(ctx, f, store.get().build?.enemy);
    openWorkingBuild(build, notes);
  },

  async renameSaved(id) {
    const saved = store.get().savedBuilds.find(b => b.id === id);
    if (!saved) return;
    const name = await promptDialog({ title: 'Rename build', label: 'Name', value: saved.name, confirmLabel: 'Rename' });
    if (!name || name === saved.name) return;
    try {
      const updated = await uf.builds.save({ ...saved, name });
      const s = store.get();
      const extra = { savedBuilds: upsertSaved(s.savedBuilds, updated) };
      if (s.build?.id === id) {
        const clean = !isDirty();
        extra.build = { ...s.build, name, updatedAt: updated.updatedAt };
        if (clean) extra.snapshot = M.snapshotOf(extra.build);
      }
      store.set(extra);
    } catch (e) {
      toast(`Could not rename: ${e?.message ?? e}`, 'error');
    }
  },

  async duplicateSaved(id) {
    const saved = store.get().savedBuilds.find(b => b.id === id);
    if (!saved) return;
    const { id: _id, updatedAt: _u, ...rest } = saved;
    try {
      const copy = await uf.builds.save({ ...rest, name: `${saved.name} (copy)` });
      store.set(s => ({ savedBuilds: upsertSaved(s.savedBuilds, copy) }));
      toast(`Duplicated as "${copy.name}".`, 'ok');
    } catch (e) {
      toast(`Could not duplicate: ${e?.message ?? e}`, 'error');
    }
  },

  async deleteSaved(id) {
    const saved = store.get().savedBuilds.find(b => b.id === id);
    if (!saved) return;
    const ok = await confirmDialog({
      title: `Delete "${saved.name}"?`, message: 'This removes the saved build. It cannot be undone.', confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await uf.builds.remove(id);
      const s = store.get();
      const extra = { savedBuilds: s.savedBuilds.filter(b => b.id !== id) };
      if (s.build?.id === id) {
        const { id: _id, ...rest } = s.build;
        extra.build = rest;
      }
      store.set(extra);
      toast(s.build?.id === id ? 'Deleted. The build stays open as an unsaved copy.' : 'Build deleted.', 'ok');
    } catch (e) {
      toast(`Could not delete: ${e?.message ?? e}`, 'error');
    }
  },

  setName(name) {
    updateBuild(b => ({ ...b, name }), { resim: false });
  },

  setWeapon(name) {
    const { ctx, build, sweep } = store.get();
    const { build: next, removed } = M.changeWeapon(ctx, build, name);
    if (next === build) return;
    if (sweep) stopSweep(null);
    setBuild(next);
    if (removed.length) toast(`Removed mods that don't fit ${next.weaponName}: ${removed.join(', ')}.`, 'warn');
  },

  setMode(modeName) {
    updateBuild(b => (b.modeName === modeName ? b : { ...b, modeName }));
  },

  /** Equip a mod (rank defaults to max). Returns false and explains when it cannot go in that slot. */
  equipMod(slot, name, rank) {
    const { ctx, build } = store.get();
    const mod = ctx.index.byName.get(name);
    if (!mod) { toast(`Unknown mod: ${name}`, 'error'); return false; }
    if (!M.fitsSlot(ctx, name, slot)) { toast(`${name} is not an Exilus mod.`, 'warn'); return false; }
    const others = build.mods.map((s, i) => (i === slot ? null : s?.name ?? null));
    const conflict = conflictingMod(name, others, ctx.index);
    if (conflict) { toast(conflict === name ? `${name} is already equipped.` : `${name} conflicts with ${conflict}.`, 'warn'); return false; }
    const max = maxRank(mod);
    const r = rank == null ? max : Math.min(max, Math.max(0, Math.round(rank)));
    updateBuild(b => M.setSlot(b, slot, { name, rank: r }));
    return true;
  },

  setRank(slot, rank) {
    updateBuild(b => {
      const s = b.mods[slot];
      if (!s) return b;
      const max = maxRank(store.get().ctx.index.byName.get(s.name));
      const r = Math.min(max, Math.max(0, Math.round(rank)));
      return r === s.rank ? b : M.setSlot(b, slot, { ...s, rank: r });
    });
  },

  clearSlot(slot) {
    updateBuild(b => (b.mods[slot] ? M.setSlot(b, slot, null) : b));
  },

  setTarget(patch) {
    const { ctx } = store.get();
    updateBuild(b => ({ ...b, enemy: M.updateEnemy(ctx, b.enemy, patch) }));
  },

  setDuration(seconds) {
    if (!M.DURATIONS.includes(seconds)) return;
    updateBuild(b => (b.simTime === seconds ? b : { ...b, simTime: seconds }));
  },

  dismissNotice() {
    store.set({ buildNotice: null });
  },

  async save() {
    const s = store.get();
    if (s.saving || !s.build) return null;
    // A result from before the latest edit (or a pending, running or failed sim) is not saved with the build.
    const last = s.sim.summary && s.sim.key === simKey() ? M.lastResultOf(s.sim.summary) : undefined;
    const toSave = M.buildToSave(s.build, last);
    const generation = openedBuildGeneration;
    store.set({ saving: true });
    try {
      const saved = await uf.builds.save(toSave);
      const cur = store.get();
      const stillEditing = generation === openedBuildGeneration;
      store.set({
        saving: false, savedBuilds: upsertSaved(cur.savedBuilds, saved),
        ...(stillEditing && { build: M.buildAfterSave(cur.build, toSave, saved), snapshot: M.snapshotOf(toSave) }),
      });
      storageSet(LAST_BUILD_KEY, saved.id);
      toast(`Saved "${saved.name}".`, 'ok', 2500);
      return saved;
    } catch (e) {
      store.set({ saving: false });
      toast(`Could not save: ${e?.message ?? e}`, 'error');
      return null;
    }
  },

  runNow() {
    return runSim();
  },

  pinResult() {
    const s = store.get();
    if (!s.sim.summary?.ok || s.sim.key !== simKey()) return;
    const pins = [...s.pins, M.makePin(s.build, s.sim.summary, crypto.randomUUID())].slice(-20);
    store.set({ pins });
    storageSet(PINS_KEY, pins);
  },

  unpin(id) {
    const pins = store.get().pins.filter(p => p.id !== id);
    store.set({ pins });
    storageSet(PINS_KEY, pins);
  },

  clearPins() {
    store.set({ pins: [] });
    storageSet(PINS_KEY, []);
  },

  startSweep,
  cancelSweep: () => stopSweep('cancelled'),
  dismissSweep: () => stopSweep(null),

  async openExternal(url) {
    try {
      if (!(await uf.openExternal(url))) toast('That link is not allowed.', 'warn');
    } catch (e) {
      toast(`Could not open link: ${e?.message ?? e}`, 'error');
    }
  },
};

const app = { store, actions, derived, simKey, isDirty, uf, errors, timings };

// ---------- loading ----------

async function fetchJson(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  if (!onProgress || !res.body) return res.json();
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  return JSON.parse(await new Blob(chunks).text());
}

const mb = n => `${(n / 1048576).toFixed(1)} MB`;

async function loadSavedBuilds() {
  try {
    const list = await uf.builds.list();
    return Array.isArray(list) ? list.filter(b => b && typeof b.id === 'string') : [];
  } catch (e) {
    toast(`Could not read saved builds: ${e?.message ?? e}`, 'error');
    return [];
  }
}

function mountUi() {
  const panels = [
    mountSidebar($('#sidebar'), app),
    mountEditor($('#editor'), app),
    mountSweep($('#sweep'), app),
    mountResults($('#results'), app),
    mountCompare($('#compare'), app),
    mountTarget($('#target'), app),
    mountStats($('#stats'), app),
    mountFooter($('#footer'), app),
  ];
  const update = (state, prev) => {
    for (const p of panels) {
      try {
        p(state, prev);
      } catch (e) {
        console.error(e);
        errors.push(`render: ${e?.message ?? e}`);
      }
    }
  };
  store.subscribe(update);
  update(store.get(), null);
}

function showPhase(state) {
  document.body.dataset.phase = state.phase;
  $('#loading-text').textContent = state.loadingText;
  if (state.phase === 'error') $('#error-text').textContent = state.error;
}

function installShortcuts() {
  document.addEventListener('keydown', e => {
    if (store.get().phase !== 'ready' || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); actions.save(); }
    else if (k === 'enter') { e.preventDefault(); actions.runNow(); }
    else if (k === 'n') { e.preventDefault(); actions.newBuild(); }
  });
}

function installErrorHandlers() {
  window.addEventListener('error', e => {
    errors.push(`error: ${e.message}`);
    if (store.get().phase === 'ready') toast(`Something went wrong: ${e.message}`, 'error');
  });
  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason?.message ?? String(e.reason);
    errors.push(`unhandled rejection: ${msg}`);
    if (store.get().phase === 'ready') toast(`Something went wrong: ${msg}`, 'error');
  });
}

async function boot() {
  const t0 = performance.now();
  store.subscribe((s, prev) => { if (s.phase !== prev.phase || s.loadingText !== prev.loadingText || s.error !== prev.error) showPhase(s); });
  showPhase(store.get());
  installErrorHandlers();
  $('#retry').addEventListener('click', () => location.reload());
  try {
    store.set({ loadingText: 'Starting the damage engine…' });
    const engineReady = engine.init().then(() => { timings.engineInitMs = Math.round(performance.now() - t0); });
    const manifestP = fetchJson('/core/manifest.json');
    const data = await fetchJson('/core/data/data.json', (got, total) =>
      store.set({ loadingText: `Loading game data… ${mb(got)}${total ? ` of ${mb(total)}` : ''}` }));
    timings.dataMs = Math.round(performance.now() - t0);
    store.set({ loadingText: 'Indexing weapons and mods…' });
    const manifest = await manifestP;
    const ctx = M.createContext(data, manifest);
    if (!ctx.weapons.length) throw new Error('The game data contains no supported weapons.');
    store.set({ loadingText: 'Starting the damage engine…' });
    await engineReady;
    store.set({ loadingText: 'Reading your builds…' });
    const savedBuilds = await loadSavedBuilds();

    let build = M.createBuild(ctx);
    let notice = null;
    const lastId = storageGet(LAST_BUILD_KEY, null);
    const last = !uf.smoke && savedBuilds.find(b => b.id === lastId);
    if (last) ({ build, warnings: notice } = M.normalizeBuild(ctx, last));

    store.set({ ctx, manifest, savedBuilds, build, snapshot: M.snapshotOf(build), buildNotice: notice?.length ? notice : null });
    mountUi();
    installShortcuts();
    store.set({ phase: 'ready', loadingText: '' });
    timings.readyMs = Math.round(performance.now() - t0);

    uf.appInfo().then(appInfo => store.set({ appInfo }), () => {});
    uf.checkUpstream().then(upstream => store.set({ upstream }), () => {});

    if (uf.smoke) await runSmoke(app, { t0 });
    else scheduleSim(0);
  } catch (e) {
    const message = e?.message ?? String(e);
    console.error(e);
    errors.push(`boot: ${message}`);
    store.set({ phase: 'error', error: message });
    if (uf.smoke) {
      try {
        await uf.smokeResult({ ok: false, weapon: null, avgDps: null, ttk: null, runs: 0, errors: [...errors], timings });
      } catch { /* main will time out */ }
    }
  }
}

boot();
