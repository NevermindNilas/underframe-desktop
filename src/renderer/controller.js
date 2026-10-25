// App controller: loads data and the engine, owns the app state and every action the UI can take.
// No React here: components read the store with useSyncExternalStore and call these actions.
import { createStore } from './store.js';
import { uf } from './platform.js';
import { createEngineClient } from './engine-client.js';
import { createAppStateCache } from './app-state-cache.js';
import { buildAppState } from '../shared/engine-input.js';
import { maxRank, conflictingMod } from '../shared/mods.js';
import { arcaneControls, arcaneMaxRank, isArcaneCompatible } from '../shared/arcanes.js';
import { withModStacks } from '../shared/conditional-mods.js';
import { effectiveProgenitor } from '../shared/stats.js';
import * as X from '../shared/external-buffs.js';
import * as RV from '../shared/rivens.js';
import { createCardAssets, loadCardAssets } from '../shared/card-assets.js';
import * as M from './model.js';
import { buildStats, engineInputFor, targetStatusesOf } from './sim.js';
import { baseModeOf, weakestSlot } from './sheet.js';
import * as H from './history.js';
import * as AS from '../shared/auto-build-settings.js';
import { startAutoBuildWorker } from './auto-build-client.js';
import { fmtInt } from './format.js';
import { gainText } from './auto-build-format.js';
import * as RTF from './riven-tools-flow.js';
import * as AF from './auto-forma-flow.js';

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
  libraryOpen: null, // null: closed (the inline pane starts closed: docs/declutter-spec.md 5)
  libraryTab: 'mine',
  librarySort: 'recent',
  featuredType: 'All',
  // The lower area at rest, "Why this DPS" (docs/declutter-spec.md 1.1): 'health' | 'hits' | 'notes'.
  whyTab: 'health',
  chartAsTable: false,
  // Gallery card size: null follows the window size (docs/arsenal-spec.md 2.1); 'small' | 'medium' | 'large'.
  galleryCardSize: null,
  // Text cards everywhere instead of card images (the gallery's Size menu).
  textCards: false,
  ocrPrivacySeen: false,
};

export const WHY_TABS = ['health', 'hits', 'notes'];
export const GALLERY_SIZES = { small: 112, medium: 132, large: 168 };

/**
 * Picker state that is not persisted: the tab, the query and the filters. Hide equipped is on by default: the
 * equipped build is in the slot strip right above the cards (docs/declutter-spec.md 1.1).
 */
export const DEFAULT_GALLERY = {
  tab: 'mods', // 'mods' | 'arcanes' | 'best'
  query: '',
  effects: [],
  pols: [],
  rarities: [],
  fits: true,
  hideEquipped: true,
  sort: 'match',
};

function loadUi() {
  const raw = storageGet(UI_KEY, {});
  const ui = { ...DEFAULT_UI, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['mine', 'featured'].includes(ui.libraryTab)) ui.libraryTab = 'mine';
  if (!(ui.librarySort in M.LIBRARY_SORTS)) ui.librarySort = 'recent';
  if (!['All', 'Primary', 'Secondary'].includes(ui.featuredType)) ui.featuredType = 'All';
  if (!WHY_TABS.includes(ui.whyTab)) ui.whyTab = 'health';
  // Keys of the arsenal layout that no longer exist.
  delete ui.resultsTab;
  delete ui.compareOpen;
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
  // The slot the Picker equips into: 0-8 (8 = Exilus), M.ARCANE_SLOT, or null (the first empty slot).
  selectedSlot: null,
  // Whether the Loadout is picking (the Picker in the lower area, the slots as a strip) or at rest.
  pickerOpen: false,
  // The Picker chose selectedSlot itself (a full build opened with no slot chosen: the weakest mod's slot).
  pickerAuto: false,
  // The Picker card the pointer or focus is on, previewed in the stats sheet: { kind, name, slot } or null.
  preview: null,
  // The target popover (Readout › Change, Ctrl+T) and the Compare dialog (Readout › Expand, Ctrl+J).
  targetOpen: false,
  compareOpen: false,
  // The External buffs dialog (Readout › Buffs) and the user's buff preset library (one per user, on disk).
  buffsOpen: false,
  /** The Average DPS when the External buffs dialog opened: its footer compares the live result with it. */
  buffsBaseline: null,
  buffPresets: { version: 1, presets: [] },
  // Rivens (docs/port-rivens.md): the riven dialog ({ slot, riven: the riven being edited or null for a new one }) and
  // the user's riven library (one per user, on disk).
  rivenDialog: null,
  rivenLibrary: { version: 1, rivens: [] },
  // The riven tools dialog (Slot my riven, Auto riven, Rolls data, the compare): see riven-tools-flow.js.
  rivenTool: null,
  // The Auto Forma dialog ({ options } or null): see auto-forma-flow.js.
  autoForma: null,
  // Auto build (docs/port-auto-build.md): the dialog, the run ({ status, percent, step, detail, runs, elapsedMs, result,
  // error, startSnapshot, ... } or null) and the user's configs (auto-build-settings.js library; null until loaded).
  autoBuildOpen: false,
  autoBuild: null,
  /** A finished result was dropped on reopening because the build had changed since (the Run tab says so). */
  autoBuildDropped: false,
  autoBuildLibrary: null,
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
// Declared before the engine so its restart hook can clear it.
let appStates = null;
const engine = createEngineClient(undefined, { onRestart: () => appStates?.clear() });
/**
 * The interactive engine's app states, one per weapon and target-status list (statuses live in the cached app state;
 * a top-level copy is ignored). Each miss caches a fresh ref, and an evicted ref is released only after the runs that
 * hold it are done (app-state-cache.js). Cleared when the engine worker restarts.
 */
appStates = createAppStateCache({
  cache: (ref, appState) => engine.cacheAppState(ref, appState),
  release: ref => engine.releaseAppState(ref),
  appStateOf: (weapon, statuses) => buildAppState(store.get().ctx.data, weapon, { externalStatuses: statuses }),
  max: MAX_APP_STATES,
});

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

/** The focusable element of a slot: the arcane dome, a filled slot's card, or an empty slot's button. */
export function slotFocusId(build, slot) {
  if (M.isArcaneSlot(slot)) return M.arcaneFocusId(M.arcaneIndexOf(slot));
  return build?.mods?.[slot] ? `slot-select-${slot}` : `slot-add-${slot}`;
}

// ---------- focus around panes that open and close (UX spec 5.6: focus is never lost to <body>) ----------

const paneEl = pane => document.querySelector(`[data-pane="${pane}"]`);
/** Element focused before a pane was opened, per pane: focus goes back there when the pane closes. */
const paneReturn = {};
/** The control that toggles each pane: the fallback focus target when it closes. */
const PANE_TRIGGER = { builds: 'library-toggle' };

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

/** What had focus when the Picker opened (a stat row, a slot), unless it was in the Picker itself. */
let pickerOpener = null;
function rememberPickerOpener(el) {
  pickerOpener = focusable(el) && !el.closest?.('[data-pane="picker"]') ? el : null;
}

/** The slot a Picker opened with no slot chosen targets: null while an empty slot takes cards, else the weakest mod. */
function autoTargetSlot(s) {
  if (!s.build || !s.ctx || M.targetSlotFor(s.ctx, s.build, null, null) != null) return null;
  return weakestSlot(s.ctx, s.build);
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
      // The weapon's own stats (no mods, no arcanes): the sheet's Base column.
      baseMode: build && ctx && stats ? baseModeOf(ctx, build) : null,
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
    const results = await appStates.withAppState(weapon, targetStatusesOf(ctx, build), ref => engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false }), M.SIM_SEEDS));
    if (gen !== simGen) return null;
    const summary = M.summarizeRuns(results, build.simTime, { removedHp: buildStats(ctx, build)?.removedHp ?? 0 });
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

    const [debug] = await appStates.withAppState(weapon, targetStatusesOf(ctx, build), ref => engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: true }), [M.SIM_SEEDS[0]]));
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
  // The Picker opens on "Best for slot N" (docs/declutter-spec.md 1.1).
  setGallery({ tab: 'best' });
  store.set({ pickerOpen: true, selectedSlot: slot, preview: null });
  const dpsOf = async modSlots => {
    const runs = await appStates.withAppState(weapon, targetStatusesOf(ctx, build), ref => engine.simulate(engineInputFor(ctx, build, { appStateRef: ref, debugLog: false, modSlots }), M.SWEEP_SEEDS));
    const s = M.summarizeRuns(runs, build.simTime, { removedHp: buildStats(ctx, build, modSlots)?.removedHp ?? 0 });
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

/** What had focus when the External buffs dialog opened. */
let buffsOpener = null;
/** What had focus when the riven dialog opened. */
let rivenOpener = null;

// ---------- Auto build (docs/port-auto-build.md) ----------

/** What had focus when the Auto build dialog opened. */
let autoBuildOpener = null;
let autoBuildToken = 0;
/** The run in progress: { token, cancel }. */
let autoBuildRun = null;
let autoBuildSaveTimer = null;

/** Cancel a running auto build (if any) and forget its result. */
function stopAutoBuild() {
  autoBuildToken++;
  autoBuildRun?.cancel();
  autoBuildRun = null;
  if (store.get().autoBuild) store.set({ autoBuild: null });
}

/** Keep the library and write it (debounced) through the main process (auto-build.json in userData). */
function setAutoBuildLibrary(library) {
  store.set({ autoBuildLibrary: library });
  clearTimeout(autoBuildSaveTimer);
  autoBuildSaveTimer = setTimeout(() => {
    Promise.resolve(uf.autoBuild?.set?.(AS.serializeAutoBuildLibrary(library))).catch(e => {
      errors.push(`auto build settings: ${errorText(e)}`);
      notify({ intent: 'warning', title: "Couldn't save the Auto build settings.", body: errorText(e) });
    });
  }, 300);
}

/** Apply a library change ({ library } or { error }) from auto-build-settings.js; returns it. */
function autoBuildLibraryChange(r) {
  if (r?.library) setAutoBuildLibrary(r.library);
  return r;
}

async function loadAutoBuild(data) {
  let raw = null;
  // Smoke and scene runs start from the defaults (never from a previous run's edits).
  if (!automated) {
    try {
      raw = await uf.autoBuild?.get?.();
    } catch (e) {
      errors.push(`auto build settings: ${errorText(e)}`);
    }
  }
  store.set({ autoBuildLibrary: AS.normalizeAutoBuildLibrary(raw, data) });
}

async function startAutoBuild({ keepSlots = null, keepArcane = true } = {}) {
  const s = store.get();
  if (!s.build || !s.ctx || !s.autoBuildLibrary || s.autoBuild?.status === 'running') return false;
  const build = s.build;
  const config = AS.activeConfig(s.autoBuildLibrary);
  const settings = config.settings;
  const keep = new Set(keepSlots ?? M.GENERAL_SLOTS.filter(i => build.mods[i]));
  // Kept slots are locks; the Exilus slot is never filled, so its mod always stays.
  const start = {
    mods: build.mods.map((m, i) => (i === M.EXILUS_SLOT || keep.has(i) ? m : null)),
    arcanes: (build.arcanes ?? []).map(a => (keepArcane ? a : null)),
  };
  const token = ++autoBuildToken;
  const patch = p => store.set(cur => (token === autoBuildToken && cur.autoBuild ? { autoBuild: { ...cur.autoBuild, ...p } } : null));
  store.set({
    autoBuildDropped: false,
    autoBuild: {
      status: 'running', percent: 0, step: 'Starting', detail: '', runs: 0, elapsedMs: 0, result: null, error: null,
      startSnapshot: M.snapshotOf(build), configName: config.name, timeLimit: settings.timeLimitSeconds,
    },
  });
  announce('Auto build started.');
  let run;
  try {
    run = startAutoBuildWorker({
      build: JSON.parse(JSON.stringify(build)), start, settings, cores: s.autoBuildLibrary.cores,
      onProgress: p => patch({ percent: p.percent, step: p.step, detail: p.detail || store.get().autoBuild?.detail || '', runs: p.runs, elapsedMs: p.elapsedMs }),
    });
  } catch (e) {
    patch({ status: 'error', error: errorText(e) });
    return false;
  }
  autoBuildRun = { token, cancel: run.cancel };
  try {
    const r = await run.promise;
    if (token !== autoBuildToken) return false;
    if (r.status === 'cancelled') {
      patch({ status: 'cancelled' });
      announce('Auto build cancelled. Nothing changed.');
      return false;
    }
    patch({ status: 'done', percent: 100, result: r.result, elapsedMs: r.result.elapsedMs });
    const g = gainText(r.result.before, r.result.after);
    const text = r.result.changed
      ? `Auto build finished: ${fmtInt(r.result.before)} → ${fmtInt(r.result.after)} DPS${g ? ` (${g})` : ''}`
      : 'Auto build finished: nothing better found';
    if (store.get().autoBuildOpen) announce(r.result.changed ? `${text}. Apply or Discard.` : `${text}.`);
    else {
      // Closed while it ran: a toast says so, with a way back to the result.
      announce(`${text}.`);
      notify({ intent: r.result.changed ? 'success' : 'info', title: text, action: { label: 'Review', run: () => actions.setAutoBuildOpen(true) } });
    }
    return true;
  } catch (e) {
    if (token !== autoBuildToken) return false;
    patch({ status: 'error', error: errorText(e) });
    announce(`Auto build failed: ${errorText(e)}`);
    if (!store.get().autoBuildOpen) notify({ intent: 'error', title: 'Auto build failed.', body: errorText(e), action: { label: 'Review', run: () => actions.setAutoBuildOpen(true) } });
    return false;
  } finally {
    if (autoBuildRun?.token === token) autoBuildRun = null;
  }
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

/** A new or empty build opens picking (docs/declutter-spec.md 1.1), at boot too. */
const opensPicking = build => !build.mods.some(Boolean);

function openWorkingBuild(build, notices = []) {
  openedBuildGeneration++;
  pickerOpener = null;
  const s = store.get();
  if (s.sweep) stopSweep(null);
  // A run belongs to the build it started on (the site cancels too when the selected build changes).
  stopAutoBuild();
  RTF.stopRivenTool();
  pendingPin = false;
  store.set({
    build,
    snapshot: M.snapshotOf(build),
    history: H.emptyHistory(),
    notices: notices.filter(n => n?.items?.length),
    orphanOf: null,
    selectedSlot: null,
    // A build with no mods opens picking (cards go into the first empty slot); one with mods opens at rest.
    pickerOpen: opensPicking(build),
    pickerAuto: false,
    preview: null,
    targetOpen: false,
    buffsOpen: false,
    autoBuildOpen: false,
    autoForma: null,
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
    const isOpen = overlay ? s.overlayLibraryOpen : (s.ui.libraryOpen ?? false);
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
    actions.setLibraryOpen(s.libraryMode === 'overlay' ? !s.overlayLibraryOpen : !(s.ui.libraryOpen ?? false));
  },
  setLibraryTab(tab) { setUi({ libraryTab: tab }); },
  setLibrarySort(sort) { if (sort in M.LIBRARY_SORTS) setUi({ librarySort: sort }); },
  setFeaturedType(type) { setUi({ featuredType: type }); },
  setWhyTab(tab) { if (WHY_TABS.includes(tab)) setUi({ whyTab: tab }); },
  setGalleryCardSize(size) { setUi({ galleryCardSize: size in GALLERY_SIZES ? size : null }); },
  setTextCards(on) { setUi({ textCards: Boolean(on) }); },
  markOcrPrivacySeen() { if (!store.get().ui.ocrPrivacySeen) setUi({ ocrPrivacySeen: true }); },
  /** The Compare dialog (Readout › Expand, Ctrl+J). The dialog returns focus to where it was opened from. */
  setCompareOpen(open) { store.set({ compareOpen: Boolean(open) }); },
  toggleCompare() { actions.setCompareOpen(!store.get().compareOpen); },
  /** The target popover (Readout › Change, Ctrl+T). */
  setTargetOpen(open) { store.set({ targetOpen: Boolean(open) }); },
  setChartAsTable(on) { setUi({ chartAsTable: Boolean(on) }); },

  // ---- The Picker (docs/declutter-spec.md 1.1) ----

  /**
   * Start picking: the slots become a strip and the Picker takes the lower area. `slot` selects where cards go
   * (undefined keeps the selection), `tab` and `query` set the Picker. Focus goes to the search unless `focus` is false.
   */
  openPicker({ slot, tab, query, focus = true, opener } = {}) {
    const s = store.get();
    if (s.phase !== 'ready') return;
    // Focus goes back to what opened the Picker (a stat row) when it closes without a slot the player chose.
    if (!s.pickerOpen) rememberPickerOpener(opener ?? document.activeElement);
    const patch = { pickerOpen: true };
    let sel = slot !== undefined ? slot : s.selectedSlot;
    let auto = slot !== undefined ? false : s.pickerAuto;
    if (slot !== undefined) patch.selectedSlot = slot;
    const nextTab = tab ?? (M.isArcaneSlot(sel) ? 'arcanes' : sel != null && s.gallery.tab === 'arcanes' ? 'mods' : s.gallery.tab);
    // A full build with no slot chosen: target the weakest mod's slot, so cards preview and equip somewhere (the
    // Picker says so above the cards; clicking another slot changes it).
    if (sel == null && nextTab === 'mods') {
      const weakest = autoTargetSlot(s);
      if (weakest != null) {
        sel = weakest;
        auto = true;
        patch.selectedSlot = weakest;
      }
    }
    patch.pickerAuto = sel != null && auto;
    if (nextTab !== s.gallery.tab || query !== undefined) patch.gallery = { ...s.gallery, tab: nextTab, ...(query !== undefined ? { query: String(query) } : {}) };
    store.set(patch);
    if (focus) focusLater('gallery-search');
  },
  /**
   * Back to rest: the Picker closes, the query and the selection clear. Focus goes to `focusSlot` (the slot just
   * filled), else the slot that was selected, else the search bar, when focus was in the Picker or `focus` is true.
   */
  closePicker({ focusSlot, focus = null } = {}) {
    const s = store.get();
    if (!s.pickerOpen && s.selectedSlot == null) return;
    const opener = pickerOpener;
    pickerOpener = null;
    const slot = focusSlot !== undefined ? focusSlot : s.selectedSlot;
    const inPicker = Boolean(document.activeElement?.closest?.('[data-pane="picker"]')) || document.activeElement === document.body;
    store.set({ pickerOpen: false, pickerAuto: false, selectedSlot: null, preview: null, gallery: { ...s.gallery, query: '', tab: s.gallery.tab === 'best' ? 'mods' : s.gallery.tab } });
    if (focus === false || (focus == null && !inPicker)) return;
    // Opened from a stat row and closed without a slot the player chose: focus goes back to that row.
    if (focusSlot === undefined && (s.selectedSlot == null || s.pickerAuto) && focusable(opener)) {
      requestAnimationFrame(() => { if (focusable(opener)) opener.focus(); else focusLater('gallery-search'); });
      return;
    }
    if (slot == null) focusLater('gallery-search');
    else focusLater(slotFocusId(store.get().build, slot));
  },
  /** The Picker card under the pointer or keyboard focus, previewed in the stats sheet (null clears it). */
  setPreview(preview) {
    const cur = store.get().preview;
    if (cur === preview || (cur && preview && cur.name === preview.name && cur.slot === preview.slot && cur.kind === preview.kind)) return;
    store.set({ preview: preview ?? null });
  },

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

  // ---- Weapon options: Progenitor bonus, exalted ability strength, passives (weapon-passives.js) ----
  /** `patch` is { element?, value? }; the bonus starts from the site's default (Magnetic 25%). */
  setProgenitor(patch) {
    const { ctx } = store.get();
    updateBuild(b => {
      const weapon = ctx.weaponByName.get(b.weaponName);
      const current = effectiveProgenitor(weapon, b.progenitor);
      if (!current) return b;
      const next = M.normalizeWeaponOptions(ctx, weapon, { progenitor: { ...current, ...patch } }).progenitor;
      return JSON.stringify(next) === JSON.stringify(b.progenitor) ? b : { ...b, progenitor: next };
    });
  },
  setExaltedStrength(percent) {
    const { ctx } = store.get();
    updateBuild(b => {
      const next = M.normalizeWeaponOptions(ctx, ctx.weaponByName.get(b.weaponName), { exaltedStrength: percent }).exaltedStrength;
      return next === b.exaltedStrength ? b : { ...b, exaltedStrength: next };
    });
  },
  /** A passive's stacks, scope tier or choice (0 is off). */
  setPassive(name, value) {
    const { ctx } = store.get();
    updateBuild(b => {
      const weapon = ctx.weaponByName.get(b.weaponName);
      const cleaned = M.normalizeWeaponOptions(ctx, weapon, { passives: { [name]: value } }).passives;
      if (!(name in cleaned) || b.passives?.[name] === cleaned[name]) return b;
      return { ...b, passives: { ...(b.passives ?? {}), [name]: cleaned[name] } };
    });
  },

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

  /**
   * Select a slot (0-8, M.ARCANE_SLOT) and start picking for it; null clears the selection (cards then go into the
   * first empty slot). The arcane slot switches the Picker to Arcanes. `focusGallery` moves focus to the search.
   */
  selectSlot(slot, { focusGallery = false } = {}) {
    const s = store.get();
    if (s.phase !== 'ready') return;
    const next = M.isArcaneSlot(slot) || (Number.isInteger(slot) && slot >= 0 && slot < M.SLOT_COUNT) ? slot : null;
    if (next == null) {
      store.set({ selectedSlot: null, pickerAuto: false, preview: null });
      return;
    }
    actions.openPicker({ slot: next, focus: focusGallery });
  },
  /** A click (or Enter) on a slot: pick for it, or back to rest when it is the slot already being picked for. */
  toggleSlot(slot) {
    const s = store.get();
    // A click on the slot the Picker chose itself confirms it; a second click goes back to rest.
    if (s.selectedSlot === slot && s.pickerOpen && s.pickerAuto) {
      store.set({ pickerAuto: false });
      focusLater('gallery-search');
    } else if (s.selectedSlot === slot && s.pickerOpen) actions.closePicker({ focusSlot: slot, focus: true });
    else actions.selectSlot(slot, { focusGallery: true });
  },
  setGallery(patch) { setGallery(patch); },
  setGalleryTab(tab) { if (['mods', 'arcanes', 'best'].includes(tab)) setGallery({ tab }); },
  /** The search box: typing opens the Picker (the box keeps its element, so no keystroke is lost). */
  setGalleryQuery(query) {
    setGallery({ query: String(query ?? '') });
    if (String(query ?? '') && !store.get().pickerOpen) actions.openPicker({ focus: false });
  },
  /**
   * A stat row or damage type in the Readout: open the Picker on Mods searching for it. `opener` (the row) gets focus
   * back when the Picker closes without a slot the player chose.
   */
  searchStat(token, { opener } = {}) {
    actions.openPicker({ tab: 'mods', query: token, opener });
  },
  clearGalleryFilters() { setGallery({ effects: [], pols: [], rarities: [], hideEquipped: true, fits: true }); },

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
      actions.closePicker({ focusSlot: target });
      return { ok: true, slot: target };
    }
    const reason = M.slotBlockReason(ctx, build, target, name);
    if (reason) {
      announce(`${name}: ${reason}`);
      return { ok: false, reason };
    }
    const wasEmpty = !build.mods[target];
    actions.equipMod(target, name, null, { focus: false, quiet: true });
    announce(`${name} equipped in ${M.slotLabel(target).toLowerCase()}. Average DPS updating.`);
    const after = M.pickerAfterEquip(store.get().build, target, { wasEmpty, selected: selectedSlot });
    if (after.close) actions.closePicker({ focusSlot: target });
    else store.set({ selectedSlot: after.selectedSlot, pickerAuto: false, preview: null });
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
    // Picking for the arcane slot ends with the arcane in it (docs/declutter-spec.md 1.1).
    if (store.get().pickerOpen && store.get().gallery.tab === 'arcanes') actions.closePicker({ focusSlot: M.arcaneSlotId(i) });
    return { ok: true, slot: i };
  },
  /** A "Best for slot N" card: equip it there and go back to rest, to read the result. */
  equipBest(name) {
    const slot = store.get().sweep?.slot;
    if (!Number.isInteger(slot)) return false;
    const ok = actions.equipMod(slot, name, null, { focus: false });
    if (ok) {
      announce(`${name} equipped in ${M.slotLabel(slot).toLowerCase()}. Average DPS updating.`);
      actions.closePicker({ focusSlot: slot });
    }
    return ok;
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
      const max = s.isRiven ? RV.RIVEN_MAX_RANK : maxRank(store.get().ctx.index.byName.get(s.name));
      const r = Math.min(max, Math.max(0, Math.round(rank)));
      return r === s.rank ? b : M.setSlot(b, slot, { ...s, rank: r });
    });
  },
  /** A conditional mod's assumed stacks (Galvanized: 0 to max; a one-stack conditional: 0 off, 1 on). */
  setModStacks(slot, stacks) {
    const { ctx } = store.get();
    updateBuild(b => {
      const s = b.mods[slot];
      if (!s) return b;
      const next = withModStacks(s, stacks, ctx.data);
      return next.stacks === s.stacks ? b : M.setSlot(b, slot, next);
    });
  },

  clearSlot(slot, { focus = true } = {}) {
    const name = store.get().build.mods[slot]?.name;
    const changed = updateBuild(b => (b.mods[slot] ? M.setSlot(b, slot, null) : b));
    if (changed && name) announce(`Removed ${name}.`);
    if (changed && focus) focusLater(`slot-add-${slot}`);
  },

  // ---- Rivens (docs/port-rivens.md) ----

  // Auto Forma (auto-forma-flow.js).
  openAutoForma() { return AF.openAutoForma(); },
  closeAutoForma() { AF.closeAutoForma(); },
  setAutoFormaOptions(patch) { AF.setAutoFormaOptions(patch); },
  applyAutoForma(index) { return AF.applyAutoForma(index); },

  // Riven tools (docs/port-rivens.md 13; riven-tools-flow.js).
  openRivenTool(tool, opts) { return RTF.openRivenTool(tool, opts); },
  closeRivenTool() { RTF.closeRivenTool(); },
  startRivenTool(options) { return RTF.startRivenTool(options); },
  cancelRivenTool() { RTF.cancelRivenTool(); },
  rivenToolSetup() { RTF.rivenToolSetup(); },
  applyRivenTool(key) { return RTF.applyRivenTool(key); },
  saveRollsCsv() { return RTF.saveRollsCsv(); },
  readRivenScreenshot(opts) { return RTF.readRivenScreenshot(opts); },
  editCompareRiven(side) { return RTF.editCompareRiven(side); },
  exportRivenLibrary() { return RTF.exportRivenLibrary(); },
  importRivenLibrary(opts) { return RTF.importRivenLibrary(opts); },

  /**
   * Open the riven dialog for a mod slot: it edits the riven in the slot, else creates one there. Refused (and said)
   * on a weapon that takes no riven, in the Exilus slot, or when another slot holds the build's riven.
   */
  openRivenDialog(slot) {
    const { ctx, build } = store.get();
    if (!build || !Number.isInteger(slot)) return false;
    const reason = RV.rivenSlotBlockReason(build, ctx.weaponByName.get(build.weaponName), slot);
    if (reason) {
      announce(`${reason}.`);
      notify({ intent: 'info', title: `${reason}.` });
      return false;
    }
    rivenOpener = document.activeElement;
    const current = build.mods[slot];
    store.set({ rivenDialog: { slot, riven: RV.isRiven(current) ? current : null } });
    return true;
  },
  /** Close the riven dialog without saving; focus goes back to what opened it, else to its slot. */
  closeRivenDialog() {
    const d = store.get().rivenDialog;
    if (!d) return;
    store.set({ rivenDialog: null });
    const el = rivenOpener;
    rivenOpener = null;
    // From the compare, focus stays in the riven tools dialog (its Edit button).
    if (d.purpose?.kind === 'compare') {
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-testid="riven-compare-edit-${d.purpose.side}"]`)?.focus()));
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (focusable(el) && !el.closest?.('[role="dialog"], [role="alertdialog"]')) el.focus();
      else if (d.slot != null) focusLater(slotFocusId(store.get().build, d.slot));
    }));
  },
  /**
   * Save the dialog's riven into its slot (one undo step) and, when asked or when the library already has it, into
   * the library. Returns { ok: true } or { ok: false, errors } (validateRiven() errors) and keeps the dialog open.
   */
  saveRiven(riven, { toLibrary = false } = {}) {
    const { ctx, build, rivenDialog, rivenLibrary } = store.get();
    if (!rivenDialog) return { ok: false, errors: [] };
    const weapon = ctx.weaponByName.get(build.weaponName);
    const clean = RV.normalizeRiven({ ...riven, isRiven: true, family: RV.rivenFamily(weapon?.name), id: riven?.id || RV.newRivenId() });
    const check = RV.validateRiven(clean, { data: ctx.data, weapon });
    if (!clean || !check.ok) return { ok: false, errors: check.errors };
    const slot = rivenDialog.slot;
    const toStore = lib => storeRivenLibrary(lib).catch(e => notify({ intent: 'warning', title: "Couldn't save the riven to your rivens.", body: errorText(e) }));
    // A riven of the compare goes back into it; the build is untouched.
    if (rivenDialog.purpose?.kind === 'compare') {
      RTF.setCompareRiven(rivenDialog.purpose.side, clean);
      if (toLibrary) toStore(RV.upsertLibraryRiven(rivenLibrary, clean));
      store.set({ rivenDialog: null });
      announce(`${rivenDialog.purpose.side ? 'Right' : 'Left'} riven updated. Compare again to see the result.`);
      return { ok: true };
    }
    // No slot to put it in (every slot full): it is kept in the user's rivens only.
    if (slot == null) {
      toStore(RV.upsertLibraryRiven(rivenLibrary, clean));
      store.set({ rivenDialog: null });
      announce(`${RV.rivenShortName(clean)} saved to your rivens.`);
      notify({ intent: 'success', title: `Saved ${RV.rivenShortName(clean)} to your rivens.`, body: 'Every slot is full: equip it from the Picker’s Riven menu.' });
      return { ok: true };
    }
    const reason = RV.rivenSlotBlockReason(build, weapon, slot);
    if (reason) return { ok: false, errors: [{ field: 'stats', message: `${reason}.` }] };
    updateBuild(b => M.setSlot(b, slot, clean));
    if (toLibrary || rivenLibrary.rivens.some(r => r.id === clean.id)) toStore(RV.upsertLibraryRiven(rivenLibrary, clean));
    announce(`${RV.rivenShortName(clean)} ${rivenDialog.riven ? 'saved' : 'equipped'} in ${M.slotLabel(slot).toLowerCase()}. Average DPS updating.`);
    store.set({ rivenDialog: null });
    rivenOpener = null;
    if (store.get().pickerOpen) actions.closePicker({ focusSlot: slot, focus: true });
    else focusLater(slotFocusId(store.get().build, slot));
    return { ok: true };
  },
  /** Equip a copy of a library riven in `slot`, else the selected slot, else the first empty general slot. */
  equipLibraryRiven(id, slot = null) {
    const { ctx, build, rivenLibrary, selectedSlot } = store.get();
    const riven = rivenLibrary.rivens.find(r => r.id === id);
    if (!riven) return { ok: false, reason: 'Unknown riven' };
    const weapon = ctx.weaponByName.get(build.weaponName);
    const chosen = Number.isInteger(slot) ? slot : Number.isInteger(selectedSlot) ? selectedSlot : null;
    const target = chosen ?? M.GENERAL_SLOTS.find(i => !build.mods[i]) ?? null;
    // A library riven is checked like a loaded one (family and the site's rules), so it never equips only to be
    // dropped as invalid when the build is reopened.
    const fit = RV.rivenSlotFor(riven, weapon, ctx.data);
    const reason = target == null ? 'All slots are full. Select a slot to replace its mod'
      : !fit.slot ? `Can't equip ${fit.dropped}`
        : RV.rivenSlotBlockReason(build, weapon, target);
    if (reason) {
      announce(`${reason}.`);
      return { ok: false, reason };
    }
    updateBuild(b => M.setSlot(b, target, fit.slot));
    announce(`${RV.rivenShortName(riven)} equipped in ${M.slotLabel(target).toLowerCase()}. Average DPS updating.`);
    actions.closePicker({ focusSlot: target, focus: true });
    return { ok: true, slot: target };
  },
  /** Add the riven in a slot to the library, or update its copy there. A riven without an id gets one. */
  async saveRivenToLibrary(slot) {
    const { build, rivenLibrary } = store.get();
    const riven = build.mods[slot];
    if (!RV.isRiven(riven)) return false;
    let withId = riven;
    if (!riven.id) {
      withId = { ...riven, id: RV.newRivenId() };
      // Not an edit of the build's content worth an undo step: the id only links the slot to the library copy.
      commitBuild(M.setSlot(build, slot, withId), { resim: false, record: false });
    }
    try {
      await storeRivenLibrary(RV.upsertLibraryRiven(rivenLibrary, withId));
    } catch (e) {
      notify({ intent: 'warning', title: "Couldn't save the riven to your rivens.", body: errorText(e) });
      return false;
    }
    announce(`Saved ${RV.rivenShortName(withId)} to your rivens.`);
    notify({ intent: 'success', title: `Saved ${RV.rivenShortName(withId)} to your rivens.` });
    return true;
  },
  /** Remove a riven from the library, with Undo; builds that hold it keep their copy. */
  async removeLibraryRiven(id) {
    const riven = store.get().rivenLibrary.rivens.find(r => r.id === id);
    if (!riven) return false;
    try {
      await storeRivenLibrary(RV.removeLibraryRiven(store.get().rivenLibrary, id));
    } catch (e) {
      notify({ intent: 'warning', title: "Couldn't update your rivens.", body: errorText(e) });
      return false;
    }
    announce(`Removed ${RV.rivenShortName(riven)} from your rivens.`);
    notify({
      intent: 'success',
      title: `Removed ${RV.rivenShortName(riven)} from your rivens`,
      action: { label: 'Undo', run: () => { storeRivenLibrary(RV.upsertLibraryRiven(store.get().rivenLibrary, riven)).catch(() => {}); } },
    });
    return true;
  },

  setTarget(patch) {
    const { ctx } = store.get();
    updateBuild(b => {
      const enemy = M.updateEnemy(ctx, b.enemy, patch);
      return JSON.stringify(enemy) === JSON.stringify(b.enemy) ? b : { ...b, enemy };
    });
  },

  // External buffs and statuses (docs/port-external-buffs.md). Each edit is one undo step and re-simulates.

  /**
   * Open or close the External buffs dialog. Closing puts focus back on what opened it (the Readout's Buffs link,
   * which shows the summary once something is set), as the dialog has no DialogTrigger to do it.
   */
  setBuffsOpen(open) {
    const was = store.get().buffsOpen;
    if (Boolean(open) === was) return;
    if (open) buffsOpener = document.activeElement;
    const sum = store.get().sim.summary;
    store.set({ buffsOpen: Boolean(open), targetOpen: false, ...(open ? { buffsBaseline: sum?.ok ? sum.avgDps : null } : {}) });
    if (!open) {
      const el = buffsOpener;
      buffsOpener = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (focusable(el) && !el.closest?.('[role="dialog"], [role="alertdialog"]')) el.focus();
        else focusLater('buffs-open');
      }));
    }
  },

  /** Add a buff row (from the add form): a row with the same buff (and element, and source) is replaced. */
  addExternalBuff(row) {
    const { ctx } = store.get();
    const clean = X.normalizeBuff(row, ctx.data);
    if (!clean) return false;
    const changed = updateBuild(b => ({ ...b, externalBuffs: X.addBuff(b.externalBuffs ?? [], clean) }));
    if (changed) announce(`Added ${X.buffLine(clean, ctx.data)}.`);
    return changed;
  },

  /** Add every row a source (ability, arcane, shard, ...) gives this weapon, as one undo step. */
  addSourceBuffs(rows) {
    const { ctx } = store.get();
    const clean = X.normalizeBuffList(rows, ctx.data);
    if (!clean.length) return false;
    const changed = updateBuild(b => ({ ...b, externalBuffs: X.addSourceRows(b.externalBuffs ?? [], clean) }));
    if (changed) announce(`Added ${clean.map(r => X.buffLine(r, ctx.data)).join(', ')}.`);
    return changed;
  },

  removeExternalBuff(index) {
    const { ctx, build } = store.get();
    const row = build.externalBuffs?.[index];
    if (!row) return false;
    const changed = updateBuild(b => ({ ...b, externalBuffs: X.removeBuffAt(b.externalBuffs, index) }));
    if (changed) announce(`Removed ${X.buffLine(row, ctx.data)}.`);
    return changed;
  },

  /** Replace the whole buff list (a preset applied, or cleared). */
  setExternalBuffs(list) {
    const { ctx } = store.get();
    const clean = X.normalizeBuffList(list, ctx.data);
    return updateBuild(b => (JSON.stringify(b.externalBuffs ?? []) === JSON.stringify(clean) ? b : { ...b, externalBuffs: clean }));
  },

  /** Remove every external buff and status, as one undo step. */
  clearExternal() {
    const changed = updateBuild(b => (M.hasExternal(b) ? { ...b, externalBuffs: [], externalStatuses: [] } : b));
    if (changed) announce('Removed every external buff and status.');
    return changed;
  },

  /** Add a status already on the target, or change its stacks (one row per status). */
  addExternalStatus(type, stacks) {
    const changed = updateBuild(b => {
      const next = X.addStatus(b.externalStatuses ?? [], type, stacks);
      return JSON.stringify(next) === JSON.stringify(b.externalStatuses ?? []) ? b : { ...b, externalStatuses: next };
    });
    if (changed) announce(`Target starts with ${type} ×${Math.round(Number(stacks))}.`);
    return changed;
  },

  removeExternalStatus(type) {
    const changed = updateBuild(b => ((b.externalStatuses ?? []).some(s => s.type === type)
      ? { ...b, externalStatuses: b.externalStatuses.filter(s => s.type !== type) } : b));
    if (changed) announce(`Removed ${type} from the target.`);
    return changed;
  },

  /**
   * Apply a preset (null: None, which clears the list). `mode` 'overwrite' replaces the list with the preset's
   * rows that suit this weapon; 'add' merges them in, summing matching rows (the site's two choices).
   */
  applyBuffPreset(id, mode = 'overwrite') {
    const { ctx, build, buffPresets } = store.get();
    if (id == null) return actions.setExternalBuffs([]);
    const preset = buffPresets.presets.find(p => p.id === id);
    if (!preset) return false;
    const weapon = ctx.weaponByName.get(build.weaponName);
    const rows = X.presetRowsFor({ ...preset, buffs: X.normalizeBuffList(preset.buffs, ctx.data) }, ctx.data, weapon);
    const next = mode === 'add' ? X.mergeBuffLists(build.externalBuffs ?? [], rows, ctx.data) : rows;
    const changed = actions.setExternalBuffs(next);
    if (changed) announce(`Applied the buff preset "${preset.name}".`);
    return changed;
  },

  /**
   * Save the current buffs as a preset. Resolves to { preset } once stored, { confirm, existing } when a preset
   * of that name exists (call again with replace: true), or { error } with the message to show.
   */
  async saveBuffPreset(name, { replace = false } = {}) {
    const { build, buffPresets } = store.get();
    const r = X.savePreset(buffPresets, name, build.externalBuffs ?? [], { replace });
    if (!r.library) return r;
    return storeBuffPresets(r.library).then(() => ({ preset: r.preset }), e => ({ error: `Couldn't save buff presets: ${errorText(e)}` }));
  },

  async deleteBuffPreset(id) {
    const { buffPresets } = store.get();
    return storeBuffPresets(X.deletePreset(buffPresets, id)).then(() => ({ ok: true }), e => ({ error: `Couldn't save buff presets: ${errorText(e)}` }));
  },

  // ---- Auto build (docs/port-auto-build.md; docs/declutter-spec.md 4) ----

  /** Open or close the Auto build dialog; closing returns focus to what opened it. A run keeps going when it closes. */
  setAutoBuildOpen(open) {
    const s = store.get();
    if (Boolean(open) === s.autoBuildOpen || !s.autoBuildLibrary) return;
    if (open) autoBuildOpener = document.activeElement;
    // A finished run whose build has changed since is out of date: start over, and say so on the Run tab.
    const stale = open && s.autoBuild?.status === 'done' && M.snapshotOf(s.build) !== s.autoBuild.startSnapshot;
    if (open && s.autoBuild && s.autoBuild.status !== 'running' && M.snapshotOf(s.build) !== s.autoBuild.startSnapshot) store.set({ autoBuild: null });
    store.set({ autoBuildOpen: Boolean(open), targetOpen: false, autoBuildDropped: stale });
    if (!open) {
      const el = autoBuildOpener;
      autoBuildOpener = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (focusable(el) && !el.closest?.('[role="dialog"], [role="alertdialog"]')) el.focus();
        else focusLater('auto-build-open');
      }));
    }
  },
  toggleAutoBuild() { actions.setAutoBuildOpen(!store.get().autoBuildOpen); },
  selectAutoBuildConfig(id) { return autoBuildLibraryChange(AS.setActiveConfig(store.get().autoBuildLibrary, id)); },
  /** Change the active config's settings (refused for the locked Default). */
  updateAutoBuildSettings(patch) {
    const { autoBuildLibrary: lib, ctx } = store.get();
    return autoBuildLibraryChange(AS.updateConfigSettings(lib, lib.activeConfigId, patch, ctx.data));
  },
  /** A new config with the active settings; it becomes active, so it can be edited right away. */
  addAutoBuildConfig(name) {
    const { autoBuildLibrary: lib, ctx } = store.get();
    const r = AS.addConfig(lib, name, AS.effectiveSettings(lib), ctx.data);
    return r.library ? autoBuildLibraryChange({ ...r, library: { ...r.library, activeConfigId: r.id } }) : r;
  },
  /** "Copy of X" of a config (the active one by default); the copy becomes active. */
  duplicateAutoBuildConfig(id) {
    const { autoBuildLibrary: lib, ctx } = store.get();
    const r = AS.duplicateConfig(lib, id ?? lib.activeConfigId, ctx.data);
    return r.library ? autoBuildLibraryChange({ ...r, library: { ...r.library, activeConfigId: r.id } }) : r;
  },
  renameAutoBuildConfig(id, name) { return autoBuildLibraryChange(AS.renameConfig(store.get().autoBuildLibrary, id, name)); },
  deleteAutoBuildConfig(id) { return autoBuildLibraryChange(AS.deleteConfig(store.get().autoBuildLibrary, id)); },
  moveAutoBuildConfig(id, dir) { return autoBuildLibraryChange(AS.moveConfig(store.get().autoBuildLibrary, id, dir)); },
  /** Engine workers for a run (a device preference, not part of a config); null is automatic. */
  setAutoBuildCores(n) {
    const lib = store.get().autoBuildLibrary;
    const cores = Number.isInteger(n) && n >= 1 && n <= 64 ? n : null;
    if (lib.cores !== cores) setAutoBuildLibrary({ ...lib, cores });
  },
  /** Run on the open build. `keepSlots`: general slots whose mods stay (default: every filled one); `keepArcane`. */
  startAutoBuild(opts) { return startAutoBuild(opts); },
  cancelAutoBuild() {
    const ab = store.get().autoBuild;
    if (ab?.status !== 'running' || !autoBuildRun) return;
    store.set({ autoBuild: { ...ab, step: 'Cancelling...' } });
    autoBuildRun.cancel();
  },
  /** Forget a finished run (its result is not applied). */
  discardAutoBuild() {
    if (!store.get().autoBuild || store.get().autoBuild.status === 'running') return;
    store.set({ autoBuild: null });
    announce('Discarded the Auto build result.');
  },
  /**
   * Apply the proposed build as one undoable edit, close the dialog, and say what changed in a toast with Undo. Refused
   * when the build changed while the run was going (the result belongs to the build it started from).
   */
  applyAutoBuild() {
    const s = store.get();
    const ab = s.autoBuild;
    if (ab?.status !== 'done' || !ab.result) return false;
    if (M.snapshotOf(s.build) !== ab.startSnapshot) {
      notify({ intent: 'warning', title: 'The build changed while Auto build ran.', body: 'Run it again to get a result for the build as it is now.' });
      return false;
    }
    const r = ab.result;
    if (!r.changed) {
      store.set({ autoBuild: null });
      actions.setAutoBuildOpen(false);
      return false;
    }
    // A kept riven comes back whole (its stats are the slot).
    let next = { ...s.build, mods: r.mods.map(m => (m?.isRiven ? m : m ? { name: m.name, rank: m.rank, ...(m.stacks != null ? { stacks: m.stacks } : {}) } : null)) };
    (r.arcanes ?? []).forEach((a, i) => { next = M.setArcane(s.ctx, next, i, a ?? null); });
    // Cost Control's Forma plan: the slot polarities that make the result fit, in the same undo step.
    next = M.withFormaPlan(s.ctx, next, r.formaPlan);
    commitBuild(next);
    store.set({ autoBuild: null });
    actions.setAutoBuildOpen(false);
    const after = M.snapshotOf(store.get().build);
    const g = gainText(r.before, r.after);
    const title = `Auto build applied: ${fmtInt(r.before)} → ${fmtInt(r.after)} DPS${g ? ` (${g})` : ''}`;
    const forma = r.formaPlan?.length ? `${r.formaPlan.length} Forma: ${M.formaPlanText(r.formaPlan).join(', ')}.` : null;
    announce(`${title}.${forma ? ` ${forma}` : ''}`);
    notify({
      intent: 'success',
      title,
      body: forma,
      action: {
        label: 'Undo',
        run: () => {
          if (M.snapshotOf(store.get().build) === after) actions.undo();
          else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." });
        },
      },
      ctrlZ: true,
    });
    return true;
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
      // Still updating: pin as soon as the current result is in (said, not toasted: the new row is the feedback).
      if (!pendingPin) announce('Pinning once the result finishes updating.');
      pendingPin = true;
      if (s.sim.status !== 'pending' && s.sim.status !== 'running') scheduleSim(0);
      return false;
    }
    const pin = M.makePin({ ...s.build, name: M.buildToSave(s.build).name }, s.sim.summary, crypto.randomUUID(), derived().stats?.mode ?? null, s.ctx.data);
    // The same unchanged result twice is one pin.
    if (s.pins.some(p => M.samePin(p, pin))) {
      announce('Already pinned.');
      return false;
    }
    const { pins, dropped } = M.addPin(s.pins, pin);
    const baselineId = dropped.some(p => p.id === s.baselineId) ? null : s.baselineId;
    store.set({ pins, baselineId });
    if (!automated) { storageSet(PINS_KEY, pins); storageSet(BASELINE_KEY, baselineId); }
    // The new Compare row is the feedback: no toast over the Readout (only dropping the oldest is worth one).
    announce(`Pinned "${pin.buildName}" to compare.`);
    if (dropped.length) notify({ intent: 'info', title: `Compare holds ${M.MAX_PINS} results; removed the oldest.` });
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
    // "Clear all" closes the Compare dialog with the pins: focus goes to Pin in the Readout's Compare section.
    const hadFocus = Boolean(document.activeElement?.closest?.('[data-testid="compare-dialog"]'));
    store.set({ pins: [], baselineId: null, compareOpen: false });
    if (!automated) { storageSet(PINS_KEY, []); storageSet(BASELINE_KEY, null); }
    if (hadFocus) focusLater('pin-current');
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

/** Write the buff preset library through the main process (buff-presets.json in userData), then keep what it stored. */
async function storeBuffPresets(library) {
  const saved = await uf.buffPresets.set(library);
  store.set({ buffPresets: X.normalizePresetLibrary(saved ?? library) });
}

async function loadBuffPresets() {
  try {
    const raw = await uf.buffPresets?.get?.();
    store.set({ buffPresets: X.normalizePresetLibrary(raw) });
  } catch (e) {
    errors.push(`buff presets: ${errorText(e)}`);
  }
}

/** Write the riven library through the main process (rivens.json in userData), then keep what it stored. */
async function storeRivenLibrary(library) {
  const saved = await uf.rivens.set(library);
  store.set({ rivenLibrary: RV.normalizeRivenLibrary(saved ?? library) });
}

async function loadRivenLibrary() {
  // Smoke and scene runs start from an empty library (never from the user's rivens).
  if (automated) return;
  try {
    store.set({ rivenLibrary: RV.normalizeRivenLibrary(await uf.rivens?.get?.()) });
  } catch (e) {
    errors.push(`riven library: ${errorText(e)}`);
  }
}

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
    // Not an error: the browser's note that a ResizeObserver callback (Fluent's popup positioning re-measuring a
    // list as it filters) resized an observed element again within one frame; the rest is delivered next frame.
    if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(String(e.message ?? ''))) return;
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
    await loadBuffPresets();
    await loadRivenLibrary();
    await loadAutoBuild(data);

    let build = M.createBuild(ctx);
    let warnings = [];
    const lastId = storageGet(LAST_BUILD_KEY, null);
    const last = !automated && savedBuilds.find(b => b.id === lastId);
    if (last) ({ build, warnings } = M.normalizeBuild(ctx, last));

    const cards = await cardsP;
    store.set({
      ctx, manifest, build, cards, snapshot: M.snapshotOf(build), notices: [noticeFrom(warnings)].filter(Boolean), phase: 'ready',
      pickerOpen: opensPicking(build),
    });
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
export { commitBuild as commitBuildForImport, openWorkingBuild as openImportedBuild, noticeFrom, setGallery, setUi, storeRivenLibrary as storeRivenLibraryFor };

