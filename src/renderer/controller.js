// App controller: loads data and the engine, owns the app state and every action the UI can take.
// No React here: components read the store with useSyncExternalStore and call these actions.
import { createStore } from './store.js';
import { uf } from './platform.js';
import { createEngineClient } from './engine-client.js';
import { buildAppState } from '../shared/engine-input.js';
import { maxRank, conflictingMod } from '../shared/mods.js';
import { arcaneControls, arcaneMaxRank, isArcaneCompatible } from '../shared/arcanes.js';
import { createCardAssets, loadCardAssets } from '../shared/card-assets.js';
import * as M from './model.js';
import { buildStats, engineInputFor } from './sim.js';
import * as H from './history.js';

const PINS_KEY = 'uf.pins';
const BASELINE_KEY = 'uf.pinBaseline';
const LAST_BUILD_KEY = 'uf.lastBuildId';
const UI_KEY = 'uf.ui';
const UPSTREAM_DISMISSED_KEY = 'uf.upstreamDismissed';
const MAX_APP_STATES = 4;
export const SIM_DEBOUNCE_MS = 300;

export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const DEFAULT_UI = {
  libraryOpen: null, // null: decided by window width on first layout
  libraryTab: 'mine',
  librarySort: 'recent',
  featuredType: 'All',
  resultsTab: 'charts',
  compareOpen: false,
  chartAsTable: false,
  // Gallery card size: null follows the window size (docs/arsenal-spec.md 2.1); 'small' | 'medium' | 'large'.
  galleryCardSize: null,
  // Text cards everywhere instead of card images (the gallery's Size menu).
  textCards: false,
  ocrPrivacySeen: false,
};

export const RESULTS_TABS = ['charts', 'stats', 'target', 'notes'];
export const GALLERY_SIZES = { small: 112, medium: 132, large: 168 };

/** Gallery state that is not persisted: the tab, the query and the filter chips. */
export const DEFAULT_GALLERY = {
  tab: 'mods', // 'mods' | 'arcanes' | 'best'
  query: '',
  effects: [],
  pols: [],
  rarities: [],
  fits: true,
  hideEquipped: false,
  sort: 'match',
};

function loadUi() {
  const raw = storageGet(UI_KEY, {});
  const ui = { ...DEFAULT_UI, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['mine', 'featured'].includes(ui.libraryTab)) ui.libraryTab = 'mine';
  if (!(ui.librarySort in M.LIBRARY_SORTS)) ui.librarySort = 'recent';
  if (!['All', 'Primary', 'Secondary'].includes(ui.featuredType)) ui.featuredType = 'All';
  if (!RESULTS_TABS.includes(ui.resultsTab)) ui.resultsTab = 'charts';
  if (ui.galleryCardSize != null && !(ui.galleryCardSize in GALLERY_SIZES)) ui.galleryCardSize = null;
  ui.textCards = Boolean(ui.textCards);
  return ui;
}

const automated = Boolean(uf.smoke || uf.scenes);

export const store = createStore({
  phase: 'loading',
  loading: { text: 'Starting…', received: 0, total: 0 },
  error: null,
  ctx: null,
  manifest: null,
  appInfo: null,
  upstream: null,
  upstreamDismissed: false,
  savedBuilds: [],
  savedStatus: 'loading', // 'loading' | 'ready' | 'error'
  savedError: null,
  build: null,
  snapshot: '',
  history: H.emptyHistory(),
  notices: [],
  saving: false,
  orphanOf: null,
  sim: {
    status: 'idle', key: null, summary: null, prev: null, debug: null, debugEnemy: null, debugTime: null,
    error: null, debugError: null, seq: 0,
    // Which opened build the summary belongs to: the delta never compares two different builds.
    buildGen: 0,
  },
  // Bumped when another build is opened or saved as a copy: text fields re-read the name and notes.
  editorEpoch: 0,
  pins: automated ? [] : M.sanitizePins(storageGet(PINS_KEY, [])),
  baselineId: automated ? null : storageGet(BASELINE_KEY, null),
  sweep: null,
  ui: automated ? { ...DEFAULT_UI } : loadUi(),
  // The slot the gallery equips into: 0-8 (8 = Exilus), M.ARCANE_SLOT, or null (the first empty slot).
  selectedSlot: null,
  gallery: { ...DEFAULT_GALLERY },
  // A mouse drag in progress: { kind: 'mod' | 'arcane', name, from: 'gallery' | slot | 'arcane', over }.
  drag: null,
  // Keyboard pick-up (docs/arsenal-spec.md 6.3): { kind, name, from, at }.
  pickup: null,
  // Screenshot import dialog, see ocr-import.js.
  ocr: null,
  // Card image resolver (core/images/index.json); null until loaded.
  cards: null,
  // The latest polite announcement { text, seq } (the Announcer speaks it; scene mode shows it).
  announcement: null,
  dialog: null, // { type: 'leave' | 'about' | 'shortcuts', ... }
  renamingId: null,
  libraryMode: 'inline', // set by the shell from the window width
  overlayLibraryOpen: false,
});

export const errors = [];
export const timings = {};
/** weaponName -> {ref, promise}; Map order is LRU order. Cleared when the engine worker restarts. */
const appStates = new Map();
const engine = createEngineClient(undefined, { onRestart: () => appStates.clear() });

// ---------- toasts and focus requests (consumed by React components) ----------

const toastListeners = new Set();
let toastSeq = 0;
/** Toasts whose action Ctrl+Z may run (delete, unpin, clear compare): { toastId, at, run, expires }. */
let undoToasts = [];
/** When the working build was last edited (Ctrl+Z picks the newer of a build edit and an undo toast). */
let lastEditAt = 0;

/** Shortcut that moves focus into the notifications (Fluent Toaster `shortcuts.focus`). */
export const TOAST_FOCUS_SHORTCUT = 'Ctrl+M';

/**
 * Show a toast. `intent`: success | info | warning | error. `action`: { label, run }.
 * `ctrlZ`: Ctrl+Z runs the action while the toast is up (it must be an undo), and the body says so.
 * Timeouts follow the spec: success/info 5 s, warning and undo 8 s, errors stay until dismissed.
 * Returns the toast id.
 */
export function notify({ intent = 'info', title, body = null, action = null, timeout, ctrlZ = false }) {
  const t = timeout ?? (intent === 'error' ? -1 : action || intent === 'warning' ? 8000 : 5000);
  const toastId = `t${++toastSeq}`;
  if (ctrlZ && action) {
    const now = Date.now();
    undoToasts = [...undoToasts.filter(u => u.expires > now), { toastId, at: performance.now(), run: action.run, expires: now + t }];
    body = body ? `${body} Press Ctrl+Z to undo.` : 'Press Ctrl+Z to undo.';
    const run = action.run;
    action = { ...action, run: () => { undoToasts = undoToasts.filter(u => u.toastId !== toastId); run(); } };
  }
  for (const fn of toastListeners) fn({ toastId, intent, title, body, action, timeout: t });
  return toastId;
}

/** The undo toast Ctrl+Z should act on, if it is newer than the last build edit. */
function liveUndoToast() {
  const now = Date.now();
  undoToasts = undoToasts.filter(u => u.expires > now);
  const last = undoToasts[undoToasts.length - 1];
  return last && last.at > lastEditAt ? last : null;
}

function dismissToast(toastId) {
  for (const fn of toastListeners) fn({ dismiss: toastId });
}

/** Dismiss every toast (smoke and scene captures use it for clean screenshots). */
export function clearToasts() {
  undoToasts = [];
  for (const fn of toastListeners) fn({ clear: true });
}

export function onToast(fn) {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

let announceSeq = 0;
/** Polite screen-reader announcement (equip, remove, pick-up, OCR steps). */
export function announce(text) {
  if (!text) return;
  store.set({ announcement: { text: String(text), seq: ++announceSeq } });
}

/** Move focus to the element with data-focus-id=`id` once it is rendered (a few frames at most). */
export function focusLater(id, fallbackId = null) {
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector(`[data-focus-id="${CSS.escape(id)}"]`)
      ?? (fallbackId ? document.querySelector(`[data-focus-id="${CSS.escape(fallbackId)}"]`) : null);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: 'nearest' });
    } else if (++tries < 20) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
}

// ---------- focus around panes that open and close (UX spec 5.6: focus is never lost to <body>) ----------

const paneEl = pane => document.querySelector(`[data-pane="${pane}"]`);
/** Element focused before a pane was opened, per pane: focus goes back there when the pane closes. */
const paneReturn = {};
/** The control that toggles each pane: the fallback focus target when it closes. */
const PANE_TRIGGER = { builds: 'library-toggle', compare: 'compare-toggle' };

const focusable = el => Boolean(el && el !== document.body && el.isConnected && el.getClientRects?.().length);

function rememberFocus(pane) {
  const a = document.activeElement;
  const el = paneEl(pane);
  if (focusable(a) && !el?.contains(a)) paneReturn[pane] = a;
}

/** Whether focus is in `pane` (or already lost to <body>), i.e. would be lost if the pane hid now. */
function focusInPane(pane) {
  const a = document.activeElement;
  return !a || a === document.body || Boolean(paneEl(pane)?.contains(a));
}

/** After `pane` hid: put focus back where it was before the pane opened, else on the pane's trigger. */
function restorePaneFocus(pane, fallbackId = PANE_TRIGGER[pane]) {
  const back = paneReturn[pane];
  paneReturn[pane] = null;
  requestAnimationFrame(() => {
    const a = document.activeElement;
    const lost = !a || a === document.body || !a.isConnected || Boolean(paneEl(pane)?.contains(a));
    if (!lost) return;
    if (focusable(back) && !paneEl(pane)?.contains(back)) back.focus();
    else focusLater(fallbackId);
  });
}

/** Hide a pane; when it held focus, move focus out deliberately. */
function hidePane(pane, hide, fallbackId) {
  const had = focusInPane(pane);
  hide();
  if (had) restorePaneFocus(pane, fallbackId);
  else paneReturn[pane] = null;
}

/**
 * After opening another build: when focus was lost (a dialog closed, or the overlay pane that held it
 * closed), focus the element that started the action, else where focus was before the pane opened,
 * else `fallbackId`.
 */
function settleFocusAfterOpen(prior, fallbackId) {
  requestAnimationFrame(() => {
    const s = store.get();
    const inClosedOverlay = el => s.libraryMode === 'overlay' && !s.overlayLibraryOpen && Boolean(el?.closest?.('[data-pane="builds"]'));
    const a = document.activeElement;
    if (focusable(a) && !inClosedOverlay(a)) return;
    for (const el of [prior, paneReturn.builds]) {
      if (focusable(el) && !inClosedOverlay(el)) {
        el.focus();
        return;
      }
    }
    focusLater(fallbackId);
  });
}

// ---------- derived values (memoized on the build object) ----------

let memo = { build: null, ctx: null };
export function derived() {
  const { ctx, build } = store.get();
  if (memo.build !== build || memo.ctx !== ctx) {
    let stats = null;
    let statsError = null;
    try {
      stats = build && ctx ? buildStats(ctx, build) : null;
    } catch (e) {
      statsError = e?.message ?? String(e);
    }
    memo = {
      build,
      ctx,
      stats,
      statsError,
      enemy: build && ctx ? M.resolveEnemy(ctx, build.enemy) : null,
      partialMap: M.unhandledByMod(stats?.modifiers?.unhandled),
      simKey: build && ctx ? M.simKeyOf(ctx, build) : '',
      capacity: build && ctx ? M.buildCapacity(ctx, build) : null,
    };
  }
  return memo;
}

export const simKey = () => derived().simKey;
export function isDirty(state = store.get()) {
  return Boolean(state.build) && M.snapshotOf(state.build) !== state.snapshot;
}

function setUi(patch) {
  store.set(s => {
    const ui = { ...s.ui, ...patch };
    if (!automated) storageSet(UI_KEY, ui);
    return { ui };
  });
}

function setGallery(patch) {
  store.set(s => ({ gallery: { ...s.gallery, ...patch } }));
}

// ---------- engine plumbing ----------

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
/** Scene mode only: makes the next simulations fail, to capture the error state. */
let injectedSimError = null;
/** Scene mode only: a pause per best-mod candidate, so the running state can be captured. */
let injectedSweepDelay = 0;

function scheduleSim(delay = SIM_DEBOUNCE_MS) {
  clearTimeout(simTimer);
  if (store.get().phase !== 'ready') return;
  store.set(s => ({ sim: { ...s.sim, status: 'pending' } }));
  simTimer = setTimeout(() => { runSim(); }, delay);
}

/**
 * The result the delta badge compares a new summary with: the previous *completed* result of the same
 * opened build (never a superseded run, and never another build's result).
 */
export function previousFor(sim, buildGen) {
  if (sim.buildGen !== buildGen) return null;
  return sim.summary?.ok ? sim.summary : sim.prev;
}

/** Run 8 seeded runs, then one with a debug log for the charts. Resolves to the summary, or null if superseded/failed. */
async function runSim() {
  clearTimeout(simTimer);
  const gen = ++simGen;
  const buildGen = openedBuildGeneration;
  const { ctx, build } = store.get();
  const key = M.simKeyOf(ctx, build);
  const enemy = M.resolveEnemy(ctx, build.enemy);
  const started = performance.now();
  store.set(s => ({ sim: { ...s.sim, status: 'running' } }));
  try {
    const weapon = ctx.weaponByName.get(build.weaponName);
    if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
    if (injectedSimError) throw new Error(injectedSimError);
    const ref = await ensureAppState(weapon);
    const results = await engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false }), M.SIM_SEEDS);
    if (gen !== simGen) return null;
    const summary = M.summarizeRuns(results, build.simTime);
    if (!summary.ok) throw new Error(summary.error);
    store.set(s => ({
      sim: {
        ...s.sim, status: 'running', key, summary, error: null,
        prev: previousFor(s.sim, buildGen),
        buildGen,
        seq: s.sim.seq + 1,
      },
    }));
    flushPendingPin();
    syncLastResult();

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
    // The engine lost an app state we thought it held: forget them all, so Try again caches afresh.
    if (/appStateRef not cached/i.test(message)) appStates.clear();
    store.set(s => ({ sim: { ...s.sim, status: 'error', key, error: message } }));
    if (pendingPin) {
      pendingPin = false;
      notify({ intent: 'warning', title: "Couldn't pin: the simulation failed." });
    }
    return null;
  }
}

// ---------- results that wait for the simulation ----------

/** Ctrl+P pressed while the result was updating: pin once the current result is in. */
let pendingPin = false;

/** The current, completed result of the working build, or null while it is pending, running or failed. */
function currentSummary(s = store.get()) {
  return s.sim.summary?.ok && s.sim.key === simKey() && s.sim.status !== 'error' && s.sim.status !== 'pending' ? s.sim.summary : null;
}

function flushPendingPin() {
  if (!pendingPin || !currentSummary()) return;
  pendingPin = false;
  actions.pinResult();
}

/**
 * A saved, unchanged build whose stored result is missing or out of date (it was saved while its simulation
 * was still running) gets the current result written quietly, so the library shows its DPS.
 */
let syncingResult = false;
async function syncLastResult() {
  const s = store.get();
  const summary = currentSummary(s);
  if (syncingResult || s.saving || !summary || !s.build?.id || isDirty(s)) return;
  const stored = s.savedBuilds.find(b => b.id === s.build.id);
  const last = M.lastResultOf(summary);
  if (!stored || (stored.lastResult && stored.lastResult.avgDps === last.avgDps && stored.lastResult.runs === last.runs)) return;
  if (M.snapshotOf(stored) !== s.snapshot) return;
  syncingResult = true;
  try {
    const saved = await uf.builds.save({ ...stored, lastResult: last });
    store.set(cur => {
      const extra = { savedBuilds: upsertSaved(cur.savedBuilds, saved) };
      if (cur.build?.id === saved.id && !isDirty(cur)) extra.build = { ...cur.build, lastResult: saved.lastResult, updatedAt: saved.updatedAt };
      return extra;
    });
  } catch (e) {
    errors.push(`saving the result: ${errorText(e)}`);
  } finally {
    syncingResult = false;
  }
}

// ---------- best-mod sweep ----------

let sweepToken = 0;

async function startSweep(slot) {
  const { ctx, build, sweep } = store.get();
  if (sweep?.status === 'running' || slot == null || !build) return;
  const token = ++sweepToken;
  const weapon = ctx.weaponByName.get(build.weaponName);
  const current = build.mods[slot]?.name ?? null;
  const candidates = M.modCandidates(ctx, build, slot).filter(c => !c.conflict);
  const baseSlots = M.setSlot(build, slot, null).mods;
  store.set({
    sweep: {
      slot, status: 'running', done: 0, total: candidates.length, results: [], all: [], baseDps: null,
      // Keyed on the build with this slot emptied: equipping a result here doesn't make the others stale.
      key: M.sweepKeyOf(ctx, build, slot), weaponName: build.weaponName, slotModAtStart: current, error: null,
    },
  });
  // The gallery's Best mod tab selects itself (docs/arsenal-spec.md 5.6).
  setGallery({ tab: 'best' });
  const dpsOf = async modSlots => {
    const ref = await ensureAppState(weapon);
    const runs = await engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false, modSlots }), M.SWEEP_SEEDS);
    const s = M.summarizeRuns(runs, build.simTime);
    return s.ok ? s.avgDps : NaN;
  };
  const patch = p => store.set(s => (token === sweepToken && s.sweep ? { sweep: { ...s.sweep, ...p } } : null));
  try {
    if (injectedSimError) throw new Error(injectedSimError);
    const baseDps = await dpsOf(baseSlots);
    if (token !== sweepToken) return;
    if (!Number.isFinite(baseDps)) throw new Error('The baseline simulation failed.');
    patch({ baseDps });
    const results = [];
    for (const c of candidates) {
      if (token !== sweepToken) return;
      const rank = maxRank(c.mod);
      const slots = baseSlots.slice();
      slots[slot] = { name: c.name, rank };
      results.push({ name: c.name, rank, dps: await dpsOf(slots) });
      if (injectedSweepDelay) await new Promise(r => setTimeout(r, injectedSweepDelay));
      if (token !== sweepToken) return;
      const all = M.rankSweep(results, baseDps, Infinity);
      patch({ done: results.length, results: all.slice(0, 10), all });
    }
    const all = M.rankSweep(results, baseDps, Infinity);
    patch({ status: 'done', results: all.slice(0, 10), all });
  } catch (e) {
    patch({ status: 'error', error: e?.message ?? String(e) });
  }
}

function stopSweep(status) {
  sweepToken++;
  store.set(s => ({ sweep: s.sweep && status ? { ...s.sweep, status } : null }));
}

// ---------- build edits and history ----------

/**
 * Replace the working build after an edit. Records an undo step (content before the edit) unless
 * `record` is false; edits with the same `group` (one text-editing session) make one step.
 */
function commitBuild(next, { group = null, resim = true, record = true, extra = {} } = {}) {
  const s = store.get();
  if (!next || next === s.build) return false;
  const history = record ? H.record(s.history, M.contentOf(s.build), group) : s.history;
  lastEditAt = performance.now();
  store.set({ build: next, history, ...extra });
  if (resim && M.simKeyOf(s.ctx, next) !== M.simKeyOf(s.ctx, s.build)) scheduleSim();
  return true;
}

function updateBuild(fn, opts) {
  const { build } = store.get();
  return commitBuild(fn(build), opts);
}

function restoreContent(content) {
  const s = store.get();
  const next = M.withContent(s.build, content);
  store.set({ build: next });
  if (M.simKeyOf(s.ctx, next) !== M.simKeyOf(s.ctx, s.build)) scheduleSim();
}

// ---------- opening builds ----------

/** Ask Save / Don't save / Cancel when the working build has unsaved changes. Resolves true to continue. */
export function confirmLeave() {
  if (!isDirty()) return Promise.resolve(true);
  const existing = store.get().dialog;
  if (existing?.type === 'leave') return existing.promise;
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  store.set({ dialog: { type: 'leave', name: M.buildToSave(store.get().build).name, resolve, promise, returnFocus: document.activeElement } });
  return promise;
}

// Bumped whenever a different build is opened, so an in-flight save can tell it no longer owns the editor.
let openedBuildGeneration = 0;
/** Deleted build id -> id of the new build its open copy was saved as (that delete's Undo then does nothing). */
const orphanSavedAs = new Map();

function openWorkingBuild(build, notices = []) {
  openedBuildGeneration++;
  const s = store.get();
  if (s.sweep) stopSweep(null);
  pendingPin = false;
  store.set({
    build,
    snapshot: M.snapshotOf(build),
    history: H.emptyHistory(),
    notices: notices.filter(n => n?.items?.length),
    orphanOf: null,
    selectedSlot: null,
    pickup: null,
    drag: null,
    gallery: s.gallery.tab === 'best' ? { ...s.gallery, tab: 'mods' } : s.gallery,
    editorEpoch: s.editorEpoch + 1,
    // The delta badge only tracks edits within one build.
    sim: { ...s.sim, prev: null },
    // The overlay pane closes once a build is opened from it.
    ...(s.libraryMode === 'overlay' ? { overlayLibraryOpen: false } : {}),
  });
  scheduleSim();
  if (!automated) storageSet(LAST_BUILD_KEY, build.id ?? null);
}

function noticeFrom(items, { intent = 'warning', title = null, id } = {}) {
  return items?.length ? { id: id ?? `n${Math.random().toString(36).slice(2)}`, intent, title, items } : null;
}

function upsertSaved(list, saved) {
  const i = list.findIndex(b => b.id === saved.id);
  return i >= 0 ? list.map(b => (b.id === saved.id ? saved : b)) : [...list, saved];
}

/** Where focus goes after a library item disappears: the next item, else the previous, else New build. */
function focusAfterRemoval(id) {
  const s = store.get();
  const order = M.sortBuilds(s.savedBuilds, s.ui.librarySort).map(b => b.id);
  const i = order.indexOf(id);
  const next = order[i + 1] ?? order[i - 1];
  return next ? `library-${next}` : 'new-build';
}

const errorText = e => e?.message ?? String(e);

// ---------- actions ----------

export const actions = {
  // Library pane
  /** Show or hide the builds pane: a persisted preference when inline, a transient overlay below 1280 px. */
  setLibraryOpen(open) {
    const s = store.get();
    const overlay = s.libraryMode === 'overlay';
    const isOpen = overlay ? s.overlayLibraryOpen : (s.ui.libraryOpen ?? true);
    if (Boolean(open) === Boolean(isOpen)) return;
    const apply = () => (overlay ? store.set({ overlayLibraryOpen: Boolean(open) }) : setUi({ libraryOpen: Boolean(open) }));
    if (open) {
      rememberFocus('builds');
      apply();
    } else {
      hidePane('builds', apply);
    }
  },
  toggleLibrary() {
    const s = store.get();
    actions.setLibraryOpen(s.libraryMode === 'overlay' ? !s.overlayLibraryOpen : !(s.ui.libraryOpen ?? true));
  },
  setLibraryTab(tab) { setUi({ libraryTab: tab }); },
  setLibrarySort(sort) { if (sort in M.LIBRARY_SORTS) setUi({ librarySort: sort }); },
  setFeaturedType(type) { setUi({ featuredType: type }); },
  setResultsTab(tab) { if (RESULTS_TABS.includes(tab)) setUi({ resultsTab: tab }); },
  setGalleryCardSize(size) { setUi({ galleryCardSize: size in GALLERY_SIZES ? size : null }); },
  setTextCards(on) { setUi({ textCards: Boolean(on) }); },
  markOcrPrivacySeen() { if (!store.get().ui.ocrPrivacySeen) setUi({ ocrPrivacySeen: true }); },
  setCompareOpen(open) {
    if (Boolean(open) === Boolean(store.get().ui.compareOpen)) return;
    if (open) {
      rememberFocus('compare');
      setUi({ compareOpen: true });
    } else {
      hidePane('compare', () => setUi({ compareOpen: false }));
    }
  },
  toggleCompare() { actions.setCompareOpen(!store.get().ui.compareOpen); },
  setChartAsTable(on) { setUi({ chartAsTable: Boolean(on) }); },

  async newBuild({ force = false } = {}) {
    const prior = document.activeElement;
    if (!force && !(await confirmLeave())) return false;
    const { ctx, build } = store.get();
    openWorkingBuild(M.createBuild(ctx, build ? { enemy: build.enemy } : {}));
    if (!force) settleFocusAfterOpen(prior, 'build-name');
    return true;
  },

  async openBuild(id) {
    const { ctx, savedBuilds, build } = store.get();
    if (build?.id === id) return true;
    const saved = savedBuilds.find(b => b.id === id);
    const prior = document.activeElement;
    if (!saved || !(await confirmLeave())) return false;
    const { build: next, warnings } = M.normalizeBuild(ctx, saved);
    openWorkingBuild(next, [noticeFrom(warnings)]);
    settleFocusAfterOpen(prior, 'build-name');
    return true;
  },

  async openFeatured(key) {
    const { ctx } = store.get();
    const f = ctx.featured.find(x => x.key === key);
    const prior = document.activeElement;
    if (!f || !(await confirmLeave())) return false;
    const { build, notes } = M.buildFromFeatured(ctx, f, store.get().build?.enemy);
    const [unapplied, ...warnings] = notes;
    openWorkingBuild(build, [
      noticeFrom([`Opened "${f.name}" as an unsaved copy. ${unapplied}`], { intent: 'info', id: 'featured' }),
      noticeFrom(warnings),
    ]);
    settleFocusAfterOpen(prior, 'build-name');
    return true;
  },

  startRename(id) {
    const s = store.get();
    // A rename writes the stored copy, so it waits until a save of the same build has finished.
    if (s.saving && s.build?.id === id) return false;
    store.set({ renamingId: id });
    return true;
  },
  cancelRename() {
    const id = store.get().renamingId;
    store.set({ renamingId: null });
    if (id) focusLater(`library-${id}`);
  },

  /** Inline rename of a saved build. Returns false (and keeps the editor open) when the name is empty. */
  async renameSaved(id, rawName) {
    const name = String(rawName ?? '').trim();
    if (!name) return false;
    const saved = store.get().savedBuilds.find(b => b.id === id);
    store.set({ renamingId: null });
    focusLater(`library-${id}`);
    if (!saved || name === saved.name) return true;
    try {
      const updated = await uf.builds.save({ ...saved, name });
      const s = store.get();
      const extra = { savedBuilds: upsertSaved(s.savedBuilds, updated) };
      if (s.build?.id === id) {
        const clean = !isDirty(s);
        extra.build = { ...s.build, name, updatedAt: updated.updatedAt };
        if (clean) extra.snapshot = M.snapshotOf(extra.build);
      }
      store.set(extra);
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't rename the build.", body: errorText(e) });
    }
    return true;
  },

  async duplicateSaved(id) {
    const saved = store.get().savedBuilds.find(b => b.id === id);
    if (!saved) return null;
    const { id: _id, updatedAt: _u, ...rest } = saved;
    try {
      const copy = await uf.builds.save({ ...rest, name: `${saved.name} (copy)` });
      store.set(s => ({ savedBuilds: upsertSaved(s.savedBuilds, copy) }));
      notify({ intent: 'success', title: `Duplicated as "${copy.name}".` });
      focusLater(`library-${copy.id}`);
      return copy;
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't duplicate the build.", body: errorText(e) });
      return null;
    }
  },

  /** Delete at once; the toast's Undo saves the same build (same id) again. */
  async deleteSaved(id, { focusNext = true } = {}) {
    const saved = store.get().savedBuilds.find(b => b.id === id);
    if (!saved) return false;
    const focusId = focusAfterRemoval(id);
    try {
      await uf.builds.remove(id);
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't delete the build.", body: errorText(e) });
      return false;
    }
    const s = store.get();
    const wasOpen = s.build?.id === id;
    const extra = { savedBuilds: s.savedBuilds.filter(b => b.id !== id), renamingId: null };
    if (wasOpen) {
      const { id: _id, updatedAt: _u, lastResult: _r, ...rest } = s.build;
      extra.build = rest;
      extra.orphanOf = id;
      // Nothing on disk matches the open copy any more: it counts as unsaved, so leaving or closing asks first.
      extra.snapshot = '';
    }
    store.set(extra);
    // From the library: focus moves to the next item. From the toolbar menu, the menu returns focus to its button.
    if (focusNext) focusLater(focusId, 'new-build');
    notify({
      intent: 'success',
      title: `Deleted "${saved.name}"`,
      body: wasOpen ? 'It stays open as an unsaved copy.' : null,
      action: { label: 'Undo', run: () => actions.restoreDeleted(saved) },
      ctrlZ: true,
    });
    return true;
  },

  async restoreDeleted(saved) {
    const s0 = store.get();
    // The open copy was saved again after the delete (as a new build): restoring would duplicate it.
    const resavedAs = orphanSavedAs.get(saved.id);
    if (resavedAs && s0.savedBuilds.some(b => b.id === resavedAs)) {
      notify({ intent: 'info', title: `"${saved.name}" was saved again after the delete, so there's nothing to restore.` });
      focusLater(`library-${resavedAs}`);
      return false;
    }
    try {
      const restored = await uf.builds.save(saved);
      const s = store.get();
      const extra = { savedBuilds: upsertSaved(s.savedBuilds, restored) };
      if (s.orphanOf === saved.id && s.build && !s.build.id) {
        extra.build = { ...s.build, id: restored.id, updatedAt: restored.updatedAt };
        extra.orphanOf = null;
        // Unsaved changes are measured against the restored copy again.
        extra.snapshot = M.snapshotOf(restored);
      }
      store.set(extra);
      focusLater(`library-${restored.id}`, 'build-name');
      return true;
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't restore the build.", body: errorText(e) });
      return false;
    }
  },

  // Current build
  setName(name) { updateBuild(b => (b.name === name ? b : { ...b, name }), { group: 'name', resim: false }); },
  setNotes(notes) { updateBuild(b => (b.notes === notes ? b : { ...b, notes }), { group: 'notes', resim: false }); },
  /** A text field lost focus: the next edit starts a new undo step. */
  endTextEdit() { store.set(s => ({ history: H.endGroup(s.history) })); },

  setWeapon(name) {
    const { ctx, build, sweep } = store.get();
    const { build: next, removed } = M.changeWeapon(ctx, build, name);
    if (next === build) return;
    const sweepWasRunning = sweep?.status === 'running';
    if (sweep) stopSweep(null);
    commitBuild(next);
    const after = M.snapshotOf(next);
    const parts = [];
    if (removed.length) parts.push(`Removed ${removed.length} ${removed.length === 1 ? "mod that doesn't" : "mods that don't"} fit: ${removed.join(', ')}.`);
    if (sweepWasRunning) parts.push('The best-mod search was cancelled.');
    if (parts.length) {
      notify({
        intent: 'warning',
        title: `Switched to ${next.weaponName}.`,
        body: parts.join(' '),
        action: removed.length ? {
          label: 'Undo',
          run: () => {
            if (M.snapshotOf(store.get().build) === after) actions.undo();
            else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." });
          },
        } : null,
      });
    }
  },

  setMode(modeName) { updateBuild(b => (b.modeName === modeName ? b : { ...b, modeName })); },

  /** Equip a mod (rank defaults to max). Returns false and explains when it cannot go in that slot. */
  equipMod(slot, name, rank, { focus = true, quiet = false } = {}) {
    const { ctx, build } = store.get();
    const mod = ctx.index.byName.get(name);
    if (!mod) { if (!quiet) notify({ intent: 'warning', title: `Couldn't equip ${name}: unknown mod.` }); return false; }
    if (!M.fitsSlot(ctx, name, slot)) { if (!quiet) notify({ intent: 'warning', title: `Couldn't equip ${name}: only Exilus mods fit the Exilus slot.` }); return false; }
    const others = build.mods.map((s, i) => (i === slot ? null : s?.name ?? null));
    const conflict = conflictingMod(name, others, ctx.index);
    if (conflict) {
      if (!quiet) notify({ intent: 'warning', title: conflict === name ? `${name} is already equipped.` : `${name} conflicts with ${conflict}.` });
      return false;
    }
    const max = maxRank(mod);
    const r = rank == null ? max : Math.min(max, Math.max(0, Math.round(rank)));
    updateBuild(b => (b.mods[slot]?.name === name && b.mods[slot]?.rank === r ? b : M.setSlot(b, slot, { name, rank: r })));
    if (focus) focusLater(`slot-select-${slot}`);
    return true;
  },

  // ---- Arsenal: slot selection, the gallery, drag and drop (docs/arsenal-spec.md 4-6) ----

  /** Select a slot (0-8, M.ARCANE_SLOT) or null. The arcane slot switches the gallery to Arcanes. */
  selectSlot(slot, { focusGallery = false } = {}) {
    const s = store.get();
    if (s.phase !== 'ready') return;
    const next = M.isArcaneSlot(slot) || (Number.isInteger(slot) && slot >= 0 && slot < M.SLOT_COUNT) ? slot : null;
    const tab = M.isArcaneSlot(next) ? 'arcanes' : next != null && s.gallery.tab === 'arcanes' ? 'mods' : s.gallery.tab;
    store.set({ selectedSlot: next, gallery: tab !== s.gallery.tab ? { ...s.gallery, tab } : s.gallery });
    if (focusGallery) focusLater('gallery-search');
  },
  /** Select the slot, or clear the selection when it is already selected. */
  toggleSlot(slot) {
    actions.selectSlot(store.get().selectedSlot === slot ? null : slot);
  },
  setGallery(patch) { setGallery(patch); },
  setGalleryTab(tab) { if (['mods', 'arcanes', 'best'].includes(tab)) setGallery({ tab }); },
  setGalleryQuery(query) { setGallery({ query: String(query ?? '') }); },
  /** A stat row in the stats rail: put its search word in the gallery search and show Mods. */
  searchStat(token) {
    setGallery({ tab: 'mods', query: token });
    focusLater('gallery-search');
  },
  clearGalleryFilters() { setGallery({ effects: [], pols: [], rarities: [], hideEquipped: false, fits: true }); },

  /**
   * Gallery click, Enter or Space on a mod card: equip into the target slot (the selected slot, else the first empty
   * one) at max rank. An equipped card moves to the selected slot (a swap when it is filled); with no slot
   * selected it stays put. Returns { ok, slot, reason, already? }.
   */
  equipFromGallery(name) {
    const { ctx, build, selectedSlot } = store.get();
    const mod = ctx.index.byName.get(name);
    if (!mod) return { ok: false, reason: 'Unknown mod' };
    const target = M.targetSlotFor(ctx, build, selectedSlot, name);
    if (target == null) {
      const reason = 'All slots are full. Select a slot to replace its mod.';
      notify({ intent: 'info', title: reason });
      announce(reason);
      return { ok: false, reason };
    }
    const from = build.mods.findIndex(m => m?.name === name);
    // An equipped mod only moves when the player chose where: with no slot selected, a click (or a double
    // click) on its card says where it is instead of shuffling it into the first empty slot.
    if (from >= 0 && !(Number.isInteger(selectedSlot) && selectedSlot >= 0 && selectedSlot < M.SLOT_COUNT)) {
      announce(`${name} is already in ${from === M.EXILUS_SLOT ? 'the Exilus slot' : M.slotLabel(from).toLowerCase()}. Select another slot first to move it.`);
      return { ok: true, slot: from, already: true };
    }
    if (from >= 0) {
      if (from === target) return { ok: true, slot: target };
      const next = M.swapSlots(ctx, build, from, target);
      if (next === build) {
        const reason = target === M.EXILUS_SLOT ? 'Not an Exilus mod' : `Can't move ${name} there`;
        announce(reason);
        return { ok: false, reason };
      }
      commitBuild(next);
      announce(`${name} moved to ${M.slotLabel(target).toLowerCase()}. Average DPS updating.`);
      return { ok: true, slot: target };
    }
    const reason = M.slotBlockReason(ctx, build, target, name);
    if (reason) {
      announce(`${name}: ${reason}`);
      return { ok: false, reason };
    }
    const wasEmpty = !build.mods[target];
    actions.equipMod(target, name, null, { focus: false, quiet: true });
    if (selectedSlot === target && wasEmpty) store.set({ selectedSlot: M.nextEmptySlot(store.get().build, target) });
    announce(`${name} equipped in ${M.slotLabel(target).toLowerCase()}. Average DPS updating.`);
    return { ok: true, slot: target };
  },

  /** Drop a mod on a slot: from the gallery it equips (replacing), from a slot it swaps. Returns true on success. */
  dropMod(name, from, to) {
    const { ctx, build } = store.get();
    if (from === to) return false;
    if (Number.isInteger(from)) {
      const next = M.swapSlots(ctx, build, from, to);
      if (next === build) { announce('Not an Exilus mod'); return false; }
      const other = build.mods[to]?.name;
      commitBuild(next);
      announce(other ? `Swapped ${name} with ${other}.` : `${name} moved to ${M.slotLabel(to).toLowerCase()}.`);
      return true;
    }
    const reason = M.slotBlockReason(ctx, build, to, name);
    if (reason) { announce(`${name}: ${reason}`); return false; }
    const ok = actions.equipMod(to, name, null, { focus: false, quiet: true });
    if (ok) announce(`${name} equipped in ${M.slotLabel(to).toLowerCase()}. Average DPS updating.`);
    return ok;
  },

  /** Remove a mod with an Undo toast (a slot dragged out, or Delete in pick-up mode). */
  removeWithUndo(slot) {
    const { build } = store.get();
    const name = build.mods[slot]?.name;
    if (!name) return;
    actions.clearSlot(slot, { focus: false });
    const after = M.snapshotOf(store.get().build);
    announce(`Removed ${name}.`);
    notify({
      intent: 'success',
      title: `Removed ${name}`,
      action: {
        label: 'Undo',
        run: () => {
          if (M.snapshotOf(store.get().build) === after) actions.undo();
          else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." });
        },
      },
    });
  },

  /** Swap a slot's mod with its neighbour in the grid (Alt+Shift+Arrow). */
  swapNeighbour(slot, dir) {
    const { ctx, build } = store.get();
    if (!Number.isInteger(slot) || slot === M.EXILUS_SLOT || !build.mods[slot]) return false;
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    const to = dir === 'left' ? (col > 0 ? slot - 1 : null) : dir === 'right' ? (col < 3 ? slot + 1 : null) : dir === 'up' ? (row > 0 ? slot - 4 : null) : (row < 1 ? slot + 4 : null);
    if (to == null) return false;
    const next = M.swapSlots(ctx, build, slot, to);
    if (next === build) return false;
    commitBuild(next);
    announce(`Swapped with ${M.slotLabel(to).toLowerCase()}.`);
    focusLater(`slot-select-${to}`);
    return true;
  },

  removeAllMods() {
    const { build } = store.get();
    const count = build.mods.filter(Boolean).length;
    if (!count) return;
    updateBuild(b => ({ ...b, mods: M.emptySlots() }));
    const after = M.snapshotOf(store.get().build);
    notify({
      intent: 'success',
      title: `Removed ${count} ${count === 1 ? 'mod' : 'mods'}.`,
      action: { label: 'Undo', run: () => { if (M.snapshotOf(store.get().build) === after) actions.undo(); } },
    });
  },

  setSlotPolarity(slot, code) {
    const { ctx } = store.get();
    updateBuild(b => M.setSlotPolarity(ctx, b, slot, code), { resim: false });
  },
  resetSlotPolarities() {
    updateBuild(b => (b.slotPolarities?.some(p => p != null) ? { ...b, slotPolarities: M.emptyPolarities() } : b), { resim: false });
  },
  setCatalyst(on) {
    updateBuild(b => (Boolean(b.catalyst !== false) === Boolean(on) ? b : { ...b, catalyst: Boolean(on) }), { resim: false });
  },

  // ---- Arcanes ----

  /**
   * Equip an arcane at max rank and max stacks in arcane slot `slot` (0, or a kitgun's 1 for Pax / Residual
   * arcanes); by default the selected arcane slot, else 0. An arcane that only fits the kitgun's other slot goes there.
   */
  equipArcane(name, slot = null) {
    const { ctx, build, selectedSlot } = store.get();
    const weapon = ctx.weaponByName.get(build.weaponName);
    let i = Number.isInteger(slot) ? slot : Math.max(0, M.arcaneIndexOf(selectedSlot));
    if (!isArcaneCompatible(name, weapon, ctx.data, i) && isArcaneCompatible(name, weapon, ctx.data, 1 - i)) i = 1 - i;
    if (!isArcaneCompatible(name, weapon, ctx.data, i)) {
      const reason = `${name} doesn't fit ${build.weaponName}.`;
      announce(reason);
      return { ok: false, reason };
    }
    if (build.arcanes?.[i]?.name === name) return { ok: true, slot: i };
    updateBuild(b => M.setArcane(ctx, b, i, M.newArcane(ctx, name)));
    announce(`${name} equipped in the ${i === 1 ? 'kitgun arcane' : 'arcane'} slot. Average DPS updating.`);
    return { ok: true, slot: i };
  },
  setArcaneRank(slot, rank) {
    const { ctx } = store.get();
    updateBuild(b => {
      const a = b.arcanes?.[slot];
      if (!a) return b;
      const max = arcaneMaxRank(a.name, ctx.data);
      const r = Math.min(max, Math.max(0, Math.round(rank)));
      return r === a.rank ? b : M.setArcane(ctx, b, slot, { ...a, rank: r });
    });
  },
  setArcaneStacks(slot, stacks) {
    const { ctx } = store.get();
    updateBuild(b => {
      const a = b.arcanes?.[slot];
      const c = a ? arcaneControls(a.name, ctx.data).stacks : null;
      if (!a || !c) return b;
      const n = Math.min(c.max, Math.max(0, Math.round(Number(stacks) || 0)));
      return n === a.options?.stacks ? b : M.setArcane(ctx, b, slot, { ...a, options: { ...a.options, stacks: n } });
    });
  },
  clearArcane(slot = 0, { focus = true } = {}) {
    const { ctx } = store.get();
    const name = store.get().build.arcanes?.[slot]?.name;
    const changed = updateBuild(b => (b.arcanes?.[slot] ? M.setArcane(ctx, b, slot, null) : b));
    if (changed && name) announce(`Removed ${name}.`);
    if (changed && focus) focusLater(M.arcaneFocusId(slot));
  },

  // ---- Drag state (pointer) and keyboard pick-up ----
  setDrag(drag) { store.set({ drag }); },
  /** Space on a card or filled slot: pick it up; arrows choose a slot, Enter drops, Delete removes, Esc cancels. */
  startPickup(item) {
    store.set({ pickup: { ...item, at: item.target ?? (item.kind === 'arcane' ? M.ARCANE_SLOT : item.from === 'gallery' ? (M.targetSlotFor(store.get().ctx, store.get().build, store.get().selectedSlot, item.name) ?? 0) : item.from) } });
    announce(`Picked up ${item.name}. Use arrow keys to choose a slot, Enter to drop, Delete to remove, Escape to cancel.`);
    const at = store.get().pickup.at;
    focusLater(M.isArcaneSlot(at) ? M.arcaneFocusId(M.arcaneIndexOf(at)) : store.get().build.mods[at] ? `slot-select-${at}` : `slot-add-${at}`);
  },
  movePickup(at) { store.set(s => (s.pickup ? { pickup: { ...s.pickup, at } } : null)); },
  cancelPickup() {
    const p = store.get().pickup;
    store.set({ pickup: null });
    if (!p) return;
    announce('Cancelled.');
    if (p.from === 'gallery') focusLater(`gallery-card-${p.name}`);
    else if (Number.isInteger(p.from)) focusLater(`slot-select-${p.from}`);
  },
  dropPickup(at = store.get().pickup?.at) {
    const p = store.get().pickup;
    if (!p) return false;
    store.set({ pickup: null });
    let ok = false;
    if (p.kind === 'arcane') ok = M.isArcaneSlot(at) && actions.equipArcane(p.name, M.arcaneIndexOf(at)).ok;
    else if (Number.isInteger(at)) ok = actions.dropMod(p.name, p.from, at);
    const filled = Number.isInteger(at) && store.get().build.mods[at];
    focusLater(M.isArcaneSlot(at) ? M.arcaneFocusId(M.arcaneIndexOf(at)) : filled ? `slot-select-${at}` : `slot-add-${at}`);
    return ok;
  },
  removePickup() {
    const p = store.get().pickup;
    if (!p || !Number.isInteger(p.from)) return;
    store.set({ pickup: null });
    actions.removeWithUndo(p.from);
    focusLater(`slot-add-${p.from}`);
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

  clearSlot(slot, { focus = true } = {}) {
    const name = store.get().build.mods[slot]?.name;
    const changed = updateBuild(b => (b.mods[slot] ? M.setSlot(b, slot, null) : b));
    if (changed && name) announce(`Removed ${name}.`);
    if (changed && focus) focusLater(`slot-add-${slot}`);
  },

  setTarget(patch) {
    const { ctx } = store.get();
    updateBuild(b => {
      const enemy = M.updateEnemy(ctx, b.enemy, patch);
      return JSON.stringify(enemy) === JSON.stringify(b.enemy) ? b : { ...b, enemy };
    });
  },

  setDuration(seconds) {
    if (!M.DURATIONS.includes(seconds)) return;
    updateBuild(b => (b.simTime === seconds ? b : { ...b, simTime: seconds }));
  },

  /**
   * Ctrl+Z: undo the latest thing the user did. That is the newest undo toast (a delete, an unpin, a clear)
   * while it is up and newer than the last build edit; otherwise the last build edit.
   */
  undoLatest() {
    const t = liveUndoToast();
    if (!t) return actions.undo();
    undoToasts = undoToasts.filter(u => u !== t);
    dismissToast(t.toastId);
    t.run();
    return true;
  },

  undo() {
    const s = store.get();
    const r = H.undo(s.history, M.contentOf(s.build));
    if (!r) return false;
    store.set({ history: r.history });
    restoreContent(r.value);
    return true;
  },

  redo() {
    const s = store.get();
    const r = H.redo(s.history, M.contentOf(s.build));
    if (!r) return false;
    store.set({ history: r.history });
    restoreContent(r.value);
    return true;
  },

  dismissNotice(id) {
    store.set(s => ({ notices: s.notices.filter(n => n.id !== id) }));
  },

  async save({ asCopy = false } = {}) {
    const s = store.get();
    if (s.saving || !s.build) return null;
    // A result from before the latest edit (or a pending, running or failed sim) is not saved with the build.
    const last = s.sim.summary && s.sim.key === simKey() && s.sim.status !== 'error' ? M.lastResultOf(s.sim.summary) : undefined;
    let toSave = M.buildToSave(s.build, last);
    if (asCopy) {
      const { id: _id, updatedAt: _u, ...rest } = toSave;
      toSave = { ...rest, name: `${toSave.name} (copy)` };
    }
    const generation = openedBuildGeneration;
    const orphanOf = s.orphanOf;
    store.set({ saving: true });
    try {
      const saved = await uf.builds.save(toSave);
      const cur = store.get();
      const stillEditing = generation === openedBuildGeneration;
      const extra = { saving: false, savedBuilds: upsertSaved(cur.savedBuilds, saved) };
      if (orphanOf && !toSave.id) orphanSavedAs.set(orphanOf, saved.id);
      if (stillEditing) {
        if (asCopy) {
          // The copy becomes the open build, as "Save as" does in Windows apps.
          extra.build = M.buildAfterSave({ ...cur.build, name: toSave.name }, toSave, saved);
          // The name field shows the copy's name even while it has focus.
          extra.editorEpoch = cur.editorEpoch + 1;
        } else {
          extra.build = M.buildAfterSave(cur.build, toSave, saved);
        }
        extra.snapshot = M.snapshotOf(toSave);
        extra.orphanOf = null;
      }
      store.set(extra);
      if (!automated) storageSet(LAST_BUILD_KEY, saved.id);
      notify({ intent: 'success', title: asCopy ? `Saved a copy as "${saved.name}".` : `Saved "${saved.name}".` });
      // Saved while the simulation was still running: store the result once it is in (now, or when it lands).
      if (stillEditing && !saved.lastResult) syncLastResult();
      return saved;
    } catch (e) {
      store.set({ saving: false });
      notify({ intent: 'error', title: "Couldn't save the build.", body: `${errorText(e)} Try again in a moment.` });
      return null;
    }
  },

  saveAsCopy() { return actions.save({ asCopy: true }); },

  async duplicateCurrent() {
    const { build } = store.get();
    if (build?.id && !isDirty()) return actions.duplicateSaved(build.id);
    return actions.saveAsCopy();
  },

  async deleteCurrent() {
    const { build } = store.get();
    if (build?.id) return actions.deleteSaved(build.id, { focusNext: false });
    return false;
  },

  runNow() { return runSim(); },

  pinResult() {
    const s = store.get();
    if (s.sim.status === 'error' && s.sim.key === simKey()) {
      notify({ intent: 'warning', title: "Couldn't pin: fix the simulation error first." });
      return false;
    }
    if (!s.sim.summary?.ok || s.sim.key !== simKey() || s.sim.status === 'pending') {
      // Still updating: pin as soon as the current result is in.
      if (!pendingPin) notify({ intent: 'info', title: 'Pinning once the result finishes updating.' });
      pendingPin = true;
      if (s.sim.status !== 'pending' && s.sim.status !== 'running') scheduleSim(0);
      return false;
    }
    const pin = M.makePin({ ...s.build, name: M.buildToSave(s.build).name }, s.sim.summary, crypto.randomUUID());
    const { pins, dropped } = M.addPin(s.pins, pin);
    const baselineId = dropped.some(p => p.id === s.baselineId) ? null : s.baselineId;
    store.set({ pins, baselineId });
    if (!automated) { storageSet(PINS_KEY, pins); storageSet(BASELINE_KEY, baselineId); }
    notify({
      intent: 'success',
      title: dropped.length ? `Compare holds ${M.MAX_PINS} results; removed the oldest.` : `Pinned "${pin.buildName}" to compare.`,
      body: dropped.length ? `Pinned "${pin.buildName}".` : null,
      action: s.ui.compareOpen ? null : { label: 'Open compare', run: () => actions.setCompareOpen(true) },
    });
    return true;
  },

  setBaseline(id) {
    store.set({ baselineId: id });
    if (!automated) storageSet(BASELINE_KEY, id);
  },

  unpin(id) {
    const s = store.get();
    const index = s.pins.findIndex(p => p.id === id);
    if (index < 0) return;
    const removed = s.pins[index];
    const pins = s.pins.filter(p => p.id !== id);
    store.set({ pins });
    if (!automated) storageSet(PINS_KEY, pins);
    notify({
      intent: 'success',
      title: `Removed "${removed.buildName}" from compare.`,
      action: {
        label: 'Undo',
        run: () => {
          const cur = store.get().pins.filter(p => p.id !== id);
          const restored = [...cur.slice(0, index), removed, ...cur.slice(index)].slice(-M.MAX_PINS);
          store.set({ pins: restored });
          if (!automated) storageSet(PINS_KEY, restored);
        },
      },
      ctrlZ: true,
    });
  },

  clearPins() {
    const { pins, baselineId } = store.get();
    if (!pins.length) return;
    // "Clear all" disappears with the pins: focus goes to "Pin current result" in the empty state.
    const hadFocus = paneEl('compare')?.contains(document.activeElement);
    store.set({ pins: [], baselineId: null });
    if (!automated) { storageSet(PINS_KEY, []); storageSet(BASELINE_KEY, null); }
    if (hadFocus) focusLater('pin-current', PANE_TRIGGER.compare);
    notify({
      intent: 'success',
      title: `Cleared ${pins.length} pinned ${pins.length === 1 ? 'result' : 'results'}.`,
      action: {
        label: 'Undo',
        run: () => {
          // Pins added since the clear stay (newest last, within the limit).
          const cur = store.get();
          const restored = M.mergePins(pins, cur.pins);
          const keepBaseline = restored.some(p => p.id === baselineId) ? baselineId : cur.baselineId;
          store.set({ pins: restored, baselineId: keepBaseline });
          if (!automated) { storageSet(PINS_KEY, restored); storageSet(BASELINE_KEY, keepBaseline); }
        },
      },
      ctrlZ: true,
    });
  },

  startSweep(slot) {
    return startSweep(slot);
  },
  cancelSweep: () => stopSweep('cancelled'),
  dismissSweep() {
    stopSweep(null);
    if (store.get().gallery.tab === 'best') setGallery({ tab: 'mods' });
  },

  openDialog(type) { store.set({ dialog: { type, returnFocus: document.activeElement } }); },
  closeDialog() {
    const d = store.get().dialog;
    store.set({ dialog: null });
    const el = d?.returnFocus;
    if (el && el.isConnected) requestAnimationFrame(() => el.focus());
  },
  /**
   * Answer the "Save changes?" dialog: 'save' | 'discard' | 'cancel'. Cancel returns focus to the trigger;
   * otherwise the action that asked (New build, open a build) places focus once the other build is open.
   * The window-close path has no such action, so focus goes back to the trigger there too.
   */
  async answerLeave(choice) {
    const d = store.get().dialog;
    if (d?.type !== 'leave') return;
    if (choice === 'save') {
      const saved = await actions.save();
      if (!saved) return; // keep the dialog; the error toast explains
    }
    store.set({ dialog: null });
    const el = d.returnFocus;
    if (choice === 'cancel' && el && el.isConnected) requestAnimationFrame(() => el.focus());
    d.resolve(choice !== 'cancel');
    if (choice !== 'cancel') {
      // Whatever follows (opening a build) settles focus in the next frame; this is the safety net.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.isConnected) return;
        if (focusable(el) && !el.closest?.('[data-pane="builds"]')) el.focus();
        else focusLater('build-name');
      }));
    }
  },

  dismissUpstream() {
    const v = store.get().upstream?.remote;
    store.set({ upstreamDismissed: true });
    if (v && !automated) storageSet(UPSTREAM_DISMISSED_KEY, v);
  },

  async reloadSavedBuilds() {
    store.set({ savedStatus: 'loading', savedError: null });
    await loadSavedBuilds();
  },

  async openExternal(url) {
    try {
      if (!(await uf.openExternal(url))) notify({ intent: 'warning', title: "That link isn't allowed." });
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't open the link.", body: errorText(e) });
    }
  },

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify({ intent: 'success', title: 'Copied to the clipboard.' });
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't copy to the clipboard.", body: errorText(e) });
    }
  },
};

/** Scene mode only: make simulations fail (to capture the error state), or pass null to stop. */
export function injectSimError(message) {
  if (!uf.scenes) return;
  injectedSimError = message;
}

/** Scene mode only: slow the best-mod search down (ms per candidate), or 0 to stop. */
export function injectSweepDelay(ms) {
  if (!uf.scenes) return;
  injectedSweepDelay = Math.max(0, Number(ms) || 0);
}

// ---------- loading ----------

async function fetchJson(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status}).`);
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
    const savedBuilds = Array.isArray(list) ? list.filter(b => b && typeof b.id === 'string') : [];
    store.set({ savedBuilds, savedStatus: 'ready', savedError: null });
    return savedBuilds;
  } catch (e) {
    store.set({ savedBuilds: [], savedStatus: 'error', savedError: errorText(e) });
    return [];
  }
}

/** Unexpected runtime errors: a persistent error toast with Copy details; the app stays usable. */
function reportUnexpected(message, stack) {
  if (store.get().phase !== 'ready') return;
  const details = [`Error: ${message}`, stack, `App: ${store.get().appInfo?.version ?? '?'}`].filter(Boolean).join('\n');
  notify({ intent: 'error', title: `Something went wrong: ${message}`, action: { label: 'Copy details', run: () => actions.copyText(details) } });
}

function installErrorHandlers() {
  window.addEventListener('error', e => {
    errors.push(`error: ${e.message}`);
    reportUnexpected(e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason?.message ?? String(e.reason);
    errors.push(`unhandled rejection: ${msg}`);
    reportUnexpected(msg, e.reason?.stack);
  });
}

function installCloseGuard() {
  uf.onCloseRequest?.(() => {
    if (store.get().phase !== 'ready' || !isDirty()) {
      uf.closeAnswer('close');
      return;
    }
    uf.closeAnswer('wait');
    confirmLeave().then(ok => { if (ok) uf.closeAnswer('close'); });
  });
}

let booted = false;

/** Load data, the engine and saved builds; then hand over to smoke or scene mode when asked. */
export async function boot({ onReady } = {}) {
  if (booted) return;
  booted = true;
  const t0 = performance.now();
  installErrorHandlers();
  installCloseGuard();
  const loading = patch => store.set(s => ({ loading: { ...s.loading, ...patch } }));
  try {
    loading({ text: 'Starting the damage engine…' });
    if (uf.scenes && uf.sceneBootError) {
      // Scene mode only (UF_SCENE_BOOT_ERROR=1): show the loading screen, then fail like a missing data file.
      loading({ text: 'Loading game data… 1.2 MB of 5.1 MB', received: 1.2, total: 5.1 });
      await new Promise(r => setTimeout(r, 800));
      await uf.sceneCapture('boot-loading');
      throw new Error("Couldn't load /core/data/data.json (HTTP 404). Injected by scene capture.");
    }
    const engineReady = engine.init().then(() => { timings.engineInitMs = Math.round(performance.now() - t0); });
    const manifestP = fetchJson('/core/manifest.json');
    const data = await fetchJson('/core/data/data.json', (received, total) =>
      loading({ text: `Loading game data… ${mb(received)}${total ? ` of ${mb(total)}` : ''}`, received, total }));
    timings.dataMs = Math.round(performance.now() - t0);
    loading({ text: 'Indexing weapons and mods…', received: 0, total: 0 });
    const manifest = await manifestP;
    const ctx = M.createContext(data, manifest);
    if (!ctx.weapons.length) throw new Error('The game data contains no supported weapons.');
    loading({ text: 'Starting the damage engine…' });
    // Card images (core/images/index.json): text cards until it arrives; missing images stay text cards.
    const cardsP = uf.noCardImages ? Promise.resolve(createCardAssets(null)) : loadCardAssets({ fetch: (u, o) => fetch(u, o) });
    await engineReady;
    loading({ text: 'Reading your builds…' });
    const savedBuilds = await loadSavedBuilds();

    let build = M.createBuild(ctx);
    let warnings = [];
    const lastId = storageGet(LAST_BUILD_KEY, null);
    const last = !automated && savedBuilds.find(b => b.id === lastId);
    if (last) ({ build, warnings } = M.normalizeBuild(ctx, last));

    const cards = await cardsP;
    store.set({ ctx, manifest, build, cards, snapshot: M.snapshotOf(build), notices: [noticeFrom(warnings)].filter(Boolean), phase: 'ready' });
    timings.readyMs = Math.round(performance.now() - t0);

    uf.appInfo().then(appInfo => store.set({ appInfo }), () => {});
    uf.checkUpstream().then(upstream => {
      const dismissed = !automated && upstream?.remote && storageGet(UPSTREAM_DISMISSED_KEY, null) === upstream.remote;
      store.set({ upstream, upstreamDismissed: Boolean(dismissed) });
    }, () => {});

    if (onReady) await onReady({ t0 });
    else scheduleSim(0);
  } catch (e) {
    const message = errorText(e);
    console.error(e);
    errors.push(`boot: ${message}`);
    store.set({ phase: 'error', error: message });
    if (uf.smoke) {
      try {
        await uf.smokeResult({ ok: false, weapon: null, avgDps: null, ttk: null, runs: 0, errors: [...errors], timings });
      } catch { /* main will time out */ }
    }
    if (uf.scenes && uf.sceneBootError) {
      await new Promise(r => setTimeout(r, 500));
      await uf.sceneCapture('boot-error');
      await uf.scenesDone();
    } else if (uf.scenes) {
      uf.scenesFailed(`boot: ${message}`);
    }
  }
}

export const app = { store, actions, derived, simKey, isDirty, uf, errors, timings, notify, injectSimError, announce };
export { commitBuild as commitBuildForImport, openWorkingBuild as openImportedBuild, noticeFrom, setGallery, setUi };

