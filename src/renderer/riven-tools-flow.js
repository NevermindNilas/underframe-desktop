// The riven tools in the app (docs/port-rivens.md 13): the dialog's state (store.rivenTool), runs through the Auto
// Build worker, applying a proposal as one undo step, the rolls data CSV, rivens read from a screenshot, and the
// riven library's import and export. The searches themselves are src/shared/riven-tools.js.
//
// store.rivenTool: null, or { tool: 'slot'|'auto'|'rolls'|'compare', status: 'setup'|'running'|'done'|'error'|
// 'cancelled', percent, step, detail, runs, elapsedMs, result, error, startSnapshot, compare: { rivens, notes } }.
import { uf } from './platform.js';
import {
  actions, announce, commitBuildForImport as commitBuild, focusLater, notify, storeRivenLibraryFor, store,
} from './controller.js';
import * as M from './model.js';
import * as RV from '../shared/rivens.js';
import * as AS from '../shared/auto-build-settings.js';
import { RIVEN_TOOL_MODES, elementListText } from '../shared/riven-tools.js';
import { recognizeRivens } from '../shared/riven-recognition.js';
import { startAutoBuildWorker } from './auto-build-client.js';
import { proposalsOf } from './riven-tool-job.js';
import { ACCEPT, prepareImage } from './ocr-import.js';
import { fmtInt } from './format.js';
import { gainText } from './auto-build-format.js';

const errorText = e => e?.message ?? String(e);
let token = 0;
let current = null;
let opener = null;
/** The setup's last choices per tool, for the next opening in this session. */
const lastOptions = new Map();

const patch = (t, p) => store.set(s => (t === token && s.rivenTool ? { rivenTool: { ...s.rivenTool, ...p } } : null));
const weaponOf = s => s.ctx?.weaponByName.get(s.build?.weaponName) ?? null;

/** Why a tool can't run on the open build, or null (a weapon without rivens; a riven already equipped). */
export function rivenToolBlock(state, tool) {
  const weapon = weaponOf(state);
  if (!RV.canTakeRiven(weapon)) return `${weapon?.name ?? 'This weapon'} takes no riven.`;
  if (tool !== 'compare' && state.build.mods.some(RV.isRiven)) {
    const name = { slot: 'Slot My Riven', auto: 'Auto Riven', rolls: 'Rolls data' }[tool];
    return `${name} needs a build without a riven: it places one itself. Remove the riven first.`;
  }
  if (tool === 'slot' && !RV.libraryRivensFor(state.rivenLibrary, weapon).length) return `You have no ${RV.rivenFamily(weapon.name)} rivens in your rivens yet. Add one with New riven or from a screenshot.`;
  return null;
}

/** Open the dialog on a tool's setup (the compare opens from a screenshot with its two rivens). */
export function openRivenTool(tool, { compare = null } = {}) {
  const s = store.get();
  if (!s.build || !RIVEN_TOOL_MODES[tool] || s.rivenTool?.status === 'running') return false;
  opener = document.activeElement;
  token++;
  store.set({ rivenTool: { tool, status: 'setup', percent: 0, step: '', detail: '', runs: 0, elapsedMs: 0, result: null, error: null, startSnapshot: M.snapshotOf(s.build), compare, options: lastOptions.get(tool) ?? null } });
  return true;
}

/** Close the dialog; a run in progress is cancelled. Focus goes back to what opened it. */
export function closeRivenTool() {
  if (!store.get().rivenTool) return;
  cancelRivenTool();
  token++;
  store.set({ rivenTool: null });
  const el = opener;
  opener = null;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (el?.isConnected && !el.closest?.('[role="dialog"], [role="alertdialog"]')) el.focus();
    else focusLater('riven-tools-open');
  }));
}

export function cancelRivenTool() {
  if (store.get().rivenTool?.status !== 'running' || !current) return;
  patch(token, { step: 'Cancelling…' });
  current.cancel();
}

/** A different build was opened: a run belongs to the build it started on. */
export function stopRivenTool() {
  if (!store.get().rivenTool) return;
  current?.cancel();
  current = null;
  token++;
  store.set({ rivenTool: null });
}

/** Back to the setup (after a result, an error or a cancel), keeping the choices. */
export function rivenToolSetup() {
  const rt = store.get().rivenTool;
  if (!rt || rt.status === 'running') return;
  patch(token, { status: 'setup', result: null, error: null, percent: 0, step: '', detail: '' });
}

/** Run the open tool with the setup's options. */
export async function startRivenTool(options = {}) {
  const s = store.get();
  const rt = s.rivenTool;
  if (!rt || rt.status === 'running' || !s.autoBuildLibrary) return false;
  const block = rivenToolBlock(s, rt.tool);
  if (block) { patch(token, { status: 'error', error: block }); return false; }
  if (RIVEN_TOOL_MODES[rt.tool].requiresNegative && !options.negativeStat) { patch(token, { status: 'error', error: 'Select a negative stat to continue.' }); return false; }
  lastOptions.set(rt.tool, options);
  const t = ++token;
  const rivens = rt.tool === 'slot' ? RV.libraryRivensFor(s.rivenLibrary, weaponOf(s)) : rt.tool === 'compare' ? rt.compare?.rivens ?? [] : [];
  patch(t, { status: 'running', percent: 0, step: 'Starting', detail: '', runs: 0, elapsedMs: 0, result: null, error: null, options, startSnapshot: M.snapshotOf(s.build) });
  announce(`${RIVEN_TOOL_MODES[rt.tool].title.replace(/ setup$/, '')} started.`);
  let run;
  try {
    run = startAutoBuildWorker({
      job: 'riven', tool: rt.tool, options, rivens: JSON.parse(JSON.stringify(rivens)),
      build: JSON.parse(JSON.stringify(s.build)), settings: AS.effectiveSettings(s.autoBuildLibrary), cores: s.autoBuildLibrary.cores,
      onProgress: p => patch(t, { percent: p.percent, step: p.step, detail: p.detail || '', runs: p.runs, elapsedMs: p.elapsedMs }),
    });
  } catch (e) {
    patch(t, { status: 'error', error: errorText(e) });
    return false;
  }
  current = { token: t, cancel: run.cancel };
  try {
    const r = await run.promise;
    if (t !== token) return false;
    if (r.status === 'cancelled') {
      patch(t, { status: 'cancelled' });
      announce('Cancelled. Nothing changed.');
      return false;
    }
    patch(t, { status: 'done', percent: 100, result: r.result, elapsedMs: r.result.elapsedMs });
    announce(resultSentence(r.result));
    return true;
  } catch (e) {
    if (t !== token) return false;
    patch(t, { status: 'error', error: errorText(e) });
    announce(`Failed: ${errorText(e)}`);
    return false;
  } finally {
    if (current?.token === t) current = null;
  }
}

/** One sentence for the screen reader (and the toast) about a result. */
export function resultSentence(r) {
  const before = r.readout?.before;
  if (r.tool === 'rolls') return `Rolls data ready: ${r.rows.length} rolls. Save the CSV.`;
  if (r.tool === 'auto') return r.improved ? `Auto riven found a riven: ${fmtInt(before)} → ${fmtInt(r.readout.proposals.auto)} DPS.` : r.message;
  if (r.tool === 'slot') return r.best ? `Best slot found: ${fmtInt(before)} → ${fmtInt(r.readout.proposals.best)} DPS.` : 'Your riven is not optimal to slot in this build.';
  return 'Comparison ready.';
}

/** A proposal's mods as build slots: rivens whole (a theoretical riven gets an id of its own), mods as { name, rank }. */
function slotsOf(mods) {
  return mods.map(m => {
    if (!m) return null;
    if (m.isRiven) return RV.normalizeRiven({ ...m, id: m.id && !m.id.startsWith('optimal_riven') ? m.id : RV.newRivenId() });
    return { name: m.name, rank: m.rank, ...(m.stacks != null ? { stacks: m.stacks } : {}) };
  });
}

/**
 * Apply a proposal ('best', 'same', 'auto', '0-best', ...) as one undoable edit, close the dialog and say what changed
 * in a toast with Undo. Refused when the build changed since the run started.
 */
export function applyRivenTool(key) {
  const s = store.get();
  const rt = s.rivenTool;
  if (rt?.status !== 'done' || !rt.result) return false;
  if (M.snapshotOf(s.build) !== rt.startSnapshot) {
    notify({ intent: 'warning', title: 'The build changed while the riven tool ran.', body: 'Run it again to get a result for the build as it is now.' });
    return false;
  }
  const p = proposalsOf(rt.tool, rt.result).find(x => x.key === key);
  if (!p) return false;
  const before = rt.result.readout?.before;
  const after = rt.result.readout?.proposals?.[key];
  commitBuild({ ...s.build, mods: slotsOf(p.mods) });
  const done = M.snapshotOf(store.get().build);
  closeRivenTool();
  const g = gainText(before, after);
  const title = `Riven applied: ${fmtInt(before)} → ${fmtInt(after)} DPS${g ? ` (${g})` : ''}`;
  announce(`${title}.`);
  notify({
    intent: 'success', title,
    action: { label: 'Undo', run: () => { if (M.snapshotOf(store.get().build) === done) actions.undo(); else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." }); } },
  });
  return true;
}

/** Save the rolls data CSV through the save dialog. */
export async function saveRollsCsv() {
  const r = store.get().rivenTool?.result;
  if (!r?.csv) return false;
  try {
    const out = await uf.files.saveText({ kind: 'csv', name: r.fileName, text: r.csv });
    if (out?.cancelled) return false;
    announce(`Saved the rolls data to ${out.path}.`);
    notify({ intent: 'success', title: 'Rolls data saved.', body: out.path });
    return true;
  } catch (e) {
    notify({ intent: 'error', title: "Couldn't save the rolls data.", body: errorText(e) });
    return false;
  }
}

/** The element change a placement makes, as a sentence, or null. */
export function elementChangeText(r, entry) {
  if (!entry?.changesElements) return null;
  return `Changes the elements from ${elementListText(r.originalElements)} to ${elementListText(entry.elements)}.`;
}

// ---------- rivens from a screenshot ----------

let fileInput = null;
/** The Windows file dialog for one image; resolves to the file or null. */
function chooseImage() {
  return new Promise(resolve => {
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = ACCEPT;
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
    }
    const done = () => {
      fileInput.removeEventListener('change', done);
      window.removeEventListener('focus', late);
      const f = fileInput.files?.[0] ?? null;
      fileInput.value = '';
      resolve(f);
    };
    // A cancelled dialog fires no change: resolve null once the window has focus again.
    const late = () => setTimeout(() => { if (!fileInput.files?.length) done(); }, 400);
    fileInput.addEventListener('change', done);
    window.addEventListener('focus', late, { once: true });
    fileInput.click();
  });
}

/** The image to read: a file from the dialog, the clipboard's, or (smoke) given bytes. */
async function imageFrom(source, bytes = null) {
  if (bytes) return new Blob([bytes], { type: 'image/png' });
  if (source === 'clipboard') {
    const r = await uf.ocr?.clipboardImage?.();
    if (!r || r.error) {
      notify(r?.error?.code === 'no-image'
        ? { intent: 'info', title: "There's no image on the clipboard.", body: 'Copy a screenshot of the riven first (Win+Shift+S).' }
        : { intent: 'error', title: "Couldn't paste the screenshot.", body: r?.error?.message ?? 'The clipboard could not be read.' });
      return null;
    }
    return new Blob([r.png], { type: 'image/png' });
  }
  return chooseImage();
}

/** The slot a riven read from a screenshot goes to: the build's riven's, the selected slot, the first empty one, or null. */
function screenshotSlot(s) {
  const weapon = weaponOf(s);
  const own = s.build.mods.findIndex(RV.isRiven);
  if (own >= 0) return own;
  const sel = s.selectedSlot;
  if (Number.isInteger(sel) && M.GENERAL_SLOTS.includes(sel) && !RV.rivenSlotBlockReason(s.build, weapon, sel)) return sel;
  return M.GENERAL_SLOTS.find(i => !s.build.mods[i]) ?? null;
}

/**
 * Read rivens from a screenshot (docs/port-rivens.md 13.4). One riven opens the riven dialog with what was read, for
 * review; `two` reads two side by side and opens the compare with them. Says what went wrong in a toast.
 */
export async function readRivenScreenshot({ source = 'file', two = false, bytes = null } = {}) {
  const s0 = store.get();
  const weapon = weaponOf(s0);
  if (!RV.canTakeRiven(weapon)) {
    notify({ intent: 'info', title: `${weapon?.name ?? 'This weapon'} takes no riven.` });
    return false;
  }
  const blob = await imageFrom(source, bytes);
  if (!blob) return false;
  announce('Reading the riven…');
  let ocr;
  try {
    const image = await prepareImage(blob);
    ocr = await uf.ocr.recognize(image.bytes);
  } catch (e) {
    ocr = { error: { code: e?.code ?? 'bad-image', message: errorText(e) } };
  }
  if (!ocr || ocr.error) {
    notify({ intent: 'error', title: "Couldn't read the screenshot.", body: ocr?.error?.message ?? 'Windows text recognition failed.' });
    return false;
  }
  const s = store.get();
  if (s.build?.weaponName !== s0.build?.weaponName) return false;
  const found = recognizeRivens(ocr, s.ctx.data, weapon, { two }).filter(r => r.riven);
  const need = two ? 2 : 1;
  if (found.length < need) {
    const text = (ocr.lines ?? []).map(l => l.text).join(' · ').slice(0, 240);
    notify({
      intent: 'warning',
      title: two ? `Found ${found.length ? 'one riven' : 'no rivens'}, not two side by side.` : 'No riven stats were found in this screenshot.',
      body: text ? `Read: ${text}` : 'No text was found. Use a screenshot that shows the riven card and its stats.',
    });
    return false;
  }
  const notes = found.map((f, i) => [
    !two && i === 0 && found.length > 1 ? `The screenshot shows ${found.length} rivens: this is the left one.` : null,
    f.otherFamily ? `The card names a ${f.otherFamily} riven, but the build is ${weapon.name}: it is read as a ${RV.rivenFamily(weapon.name)} riven.` : null,
    f.unread.length ? `Not read: ${f.unread.join(', ')}.` : null,
  ].filter(Boolean).join(' '));
  if (two) {
    openRivenTool('compare', { compare: { rivens: found.slice(0, 2).map(f => ({ ...f.riven, id: RV.newRivenId() })), notes: notes.slice(0, 2) } });
    announce('Two rivens read. Check them, then Compare.');
    return true;
  }
  opener = document.activeElement;
  const slot = screenshotSlot(s);
  store.set({ rivenDialog: { slot, riven: null, initial: found[0].riven, source: 'screenshot', note: notes[0] || null } });
  announce('Riven read from the screenshot. Check the values, then Save.');
  return true;
}

/** Open the riven dialog on one of the compare's rivens (Save puts the edit back into the compare). */
export function editCompareRiven(side) {
  const s = store.get();
  const riven = s.rivenTool?.compare?.rivens?.[side];
  if (!riven) return false;
  const slot = s.build.mods.findIndex(RV.isRiven);
  store.set({ rivenDialog: { slot: slot >= 0 ? slot : M.GENERAL_SLOTS.find(i => !s.build.mods[i]) ?? null, riven, purpose: { kind: 'compare', side } } });
  return true;
}

/** Put an edited riven back into the compare (from saveRiven). */
export function setCompareRiven(side, riven) {
  store.set(s => (s.rivenTool?.compare ? {
    rivenTool: { ...s.rivenTool, status: 'setup', result: null, compare: { ...s.rivenTool.compare, rivens: s.rivenTool.compare.rivens.map((r, i) => (i === side ? riven : r)) } },
  } : null));
}

// ---------- the library's files ----------

/** Save the library as JSON through the save dialog. */
export async function exportRivenLibrary() {
  const lib = store.get().rivenLibrary;
  if (!lib.rivens.length) {
    notify({ intent: 'info', title: 'You have no rivens to export yet.' });
    return false;
  }
  try {
    const out = await uf.files.saveText({ kind: 'json', name: 'underframe-rivens.json', text: RV.rivenLibraryFileText(lib) });
    if (out?.cancelled) return false;
    announce(`Exported ${lib.rivens.length} rivens.`);
    notify({ intent: 'success', title: `Exported ${lib.rivens.length} ${lib.rivens.length === 1 ? 'riven' : 'rivens'}.`, body: out.path });
    return true;
  } catch (e) {
    notify({ intent: 'error', title: "Couldn't export your rivens.", body: errorText(e) });
    return false;
  }
}

/**
 * Import rivens from a JSON file (ours or underframe.site's export): asks Merge or Replace when the library already
 * has rivens (the site's Override / Merge), then saves, with Undo.
 */
export async function importRivenLibrary({ text = null, mode = null } = {}) {
  let file = text;
  if (file == null) {
    try {
      const r = await uf.files.openText({ kind: 'json' });
      if (r?.cancelled) return false;
      file = r.text;
    } catch (e) {
      notify({ intent: 'error', title: "Couldn't open the file.", body: errorText(e) });
      return false;
    }
  }
  let read;
  try {
    read = RV.parseRivenLibraryFile(file);
  } catch (e) {
    notify({ intent: 'error', title: "Couldn't import rivens.", body: errorText(e) });
    return false;
  }
  if (!read.rivens.length) {
    notify({ intent: 'warning', title: 'The file has no usable rivens.' });
    return false;
  }
  const before = store.get().rivenLibrary;
  const choice = mode ?? (before.rivens.length ? await askImportMode(read.rivens.length, before.rivens.length) : 'merge');
  if (!choice) return false;
  const { library, added, skipped } = RV.importRivensInto(before, read.rivens, choice);
  try {
    await storeRivenLibraryFor(library);
  } catch (e) {
    notify({ intent: 'error', title: "Couldn't save the imported rivens.", body: errorText(e) });
    return false;
  }
  const extra = [skipped ? `${skipped} already in your rivens` : null, read.dropped ? `${read.dropped} unreadable` : null].filter(Boolean).join(', ');
  const title = choice === 'override' ? `Replaced your rivens with ${added}.` : `Imported ${added} ${added === 1 ? 'riven' : 'rivens'}.`;
  announce(`${title}${extra ? ` ${extra}.` : ''}`);
  notify({ intent: 'success', title, body: extra || null, action: { label: 'Undo', run: () => { storeRivenLibraryFor(before).catch(() => {}); } } });
  return true;
}

/** Merge or Replace, asked in the app's own dialog (store.dialog); resolves 'merge', 'override' or null. */
function askImportMode(incoming, existing) {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  store.set({ dialog: { type: 'riven-import', incoming, existing, resolve, returnFocus: document.activeElement } });
  return promise;
}
