// Screenshot import (docs/arsenal-spec.md 7): the entry points (file, paste, drop, game window), the progress
// steps, recognition through the main process (Windows OCR), the review state and applying it as a new build or
// into the current one. The image stays in memory and is dropped when the dialog closes; nothing is uploaded.
import { recognizeBuild } from '../shared/build-recognition.js';
import { createBuild, newArcane, setArcane, snapshotOf, changeWeapon } from './model.js';
import {
  appliedParts, bandOf, fallbackWeapon, inferSlotPolarities, mergeWithCurrent, pickConflict, reviewFromRecognition, reviewSummary, slotListText,
} from './ocr-review.js';
import { uf } from './platform.js';
import {
  actions, announce, commitBuildForImport, confirmLeave, focusLater, notify, openImportedBuild, store,
} from './controller.js';
import { fmtShortDate } from './format.js';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
export const ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp';
export const STEPS = ['Reading image…', 'Recognising text…', 'Matching mods…'];
export const SLOW_AFTER_MS = 20_000;

/** Error copy per failure (docs/arsenal-spec.md 7.5). `actions`: buttons the dialog offers. */
export const ERRORS = {
  'bad-image': { title: "Couldn't open this image.", body: 'Use a PNG, JPG, WebP or BMP screenshot.', actions: ['choose-file'] },
  'too-large': { title: 'This image is too large.', body: 'Use a screenshot of 25 MB or less.', actions: ['choose-file'] },
  'ocr-unavailable': { title: "Windows text recognition isn't available.", body: 'Add the English (United States) language in Settings > Time & language, then try again.', actions: ['settings', 'retry'] },
  'no-ocr-language': { title: "English text recognition isn't installed.", body: 'Mod names are read in English. Add English (United States) with its optical character recognition feature in Settings > Time & language > Language & region, then try again.', actions: ['settings', 'retry'] },
  'unsupported-platform': { title: "Windows text recognition isn't available.", body: 'Screenshot import needs Windows 10 or 11.', actions: [] },
  'no-text': { title: 'No text was found in this image.', body: "Use a full-size screenshot of the arsenal's Mods screen.", actions: ['choose-file'] },
  'no-mods': { title: 'We found text but no mod names.', body: 'Make sure the game is in English and the screenshot shows the Mods screen.', actions: ['show-text', 'choose-file'] },
  'game-not-found': { title: "Warframe isn't running, or its window is minimised.", body: "Open the arsenal's Mods screen and try again.", actions: ['retry'] },
  'game-minimized': { title: "Warframe isn't running, or its window is minimised.", body: "Open the arsenal's Mods screen and try again.", actions: ['retry'] },
  blank: { title: 'The capture came back blank.', body: 'Switch Warframe to Borderless fullscreen in Display settings and try again.', actions: ['retry'] },
  timeout: { title: 'Recognition took too long and was stopped.', body: 'Try again, or use a smaller screenshot.', actions: ['retry'] },
  'image-too-large': { title: 'This image is too large to recognise.', body: 'Use a screenshot of 4K or smaller.', actions: ['choose-file'] },
  'ocr-failed': { title: "Couldn't read this screenshot.", body: 'Windows text recognition failed. Try again.', actions: ['retry', 'choose-file'] },
};

let runId = 0;
let lastInput = null;
let slowTimer = null;

const isPngOrJpeg = b => (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Decode an image blob: PNG/JPEG bytes for Windows OCR (other formats re-encoded), its size and a data: URL. */
export async function prepareImage(blob) {
  if (blob.size > MAX_IMPORT_BYTES) throw Object.assign(new Error('too large'), { code: 'too-large' });
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw Object.assign(new Error('decode failed'), { code: 'bad-image' });
  }
  const { width, height } = bitmap;
  let bytes = new Uint8Array(await blob.arrayBuffer());
  let shown = blob;
  if (!isPngOrJpeg(bytes)) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    shown = await canvas.convertToBlob({ type: 'image/png' });
    bytes = new Uint8Array(await shown.arrayBuffer());
  }
  const blank = isBlank(bitmap);
  bitmap.close?.();
  return { bytes, width, height, url: await blobToDataUrl(shown), blank };
}

/** True when the image is (nearly) all black: what a capture of an exclusive-fullscreen game returns. */
function isBlank(bitmap) {
  try {
    const c = new OffscreenCanvas(64, 36);
    const g = c.getContext('2d');
    g.drawImage(bitmap, 0, 0, 64, 36);
    const px = g.getImageData(0, 0, 64, 36).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 10 || px[i + 1] > 10 || px[i + 2] > 10) return false;
    return true;
  } catch {
    return false;
  }
}

function setOcr(patch) {
  store.set(s => ({ ocr: s.ocr ? { ...s.ocr, ...patch } : null }));
}

function clearSlow() {
  clearTimeout(slowTimer);
  slowTimer = null;
}

/** Open the dialog in its progress state at once (within a frame of the command). */
function begin(source) {
  const id = ++runId;
  clearSlow();
  const prior = store.get().ocr;
  store.set({
    ocr: {
      id, phase: 'progress', source, step: 0, slow: false, image: null, error: null, review: null, lines: [],
      returnFocus: prior?.returnFocus ?? document.activeElement, showUnmatched: false,
    },
  });
  slowTimer = setTimeout(() => { if (store.get().ocr?.id === id) setOcr({ slow: true }); }, SLOW_AFTER_MS);
  return id;
}

const live = id => store.get().ocr?.id === id;

function fail(id, code, message = null) {
  if (!live(id)) return;
  clearSlow();
  const copy = ERRORS[code] ?? ERRORS['ocr-failed'];
  setOcr({ phase: 'error', error: { code, ...copy, detail: message } });
  announce(copy.title);
}

function step(id, n) {
  if (!live(id)) return;
  setOcr({ step: n });
  announce(STEPS[n]);
}

/** Recognise prepared bytes (or an injected OCR result) and move to the review. */
async function recognise(id, image, { ocr = null } = {}) {
  const { ctx } = store.get();
  setOcr({ image: { url: image.url, width: image.width, height: image.height } });
  step(id, 1);
  let result = ocr;
  if (!result) {
    if (!uf.ocr?.recognize) return fail(id, 'unsupported-platform');
    try {
      result = await uf.ocr.recognize(image.bytes);
    } catch (e) {
      return fail(id, 'ocr-failed', e?.message ?? String(e));
    }
  }
  if (!live(id)) return;
  if (result?.error) return fail(id, result.error.code, result.error.message);
  const lines = result?.lines ?? [];
  setOcr({ lines: lines.filter(l => l.pass === 'full').map(l => l.text) });
  if (!lines.length) return fail(id, 'no-text');
  step(id, 2);
  // Let the step render before the matcher (~0.1-0.3 s) runs on this thread.
  await new Promise(r => setTimeout(r, 30));
  if (!live(id)) return;
  let rec;
  try {
    rec = recognizeBuild(result, ctx.data);
  } catch (e) {
    return fail(id, 'ocr-failed', e?.message ?? String(e));
  }
  if (!live(id)) return;
  const review = reviewFromRecognition(ctx, rec);
  if (!review.items.some(i => i.suggestion)) return fail(id, 'no-mods');
  // An unrecognised weapon: the open build's weapon when every kept mod and the arcane fit it (the review says
  // so and asks to check it), else the player picks.
  if (!review.weaponName) Object.assign(review, fallbackWeapon(ctx, review, store.get().build.weaponName));
  clearSlow();
  setOcr({ phase: 'review', review });
  announce(reviewSummary(review));
  // Initial focus: the first thing that needs checking (the weapon, then the items in list order), else Apply.
  const weaponNeedsCheck = !review.weaponName || review.weaponFromCurrent || bandOf(review.weaponConfidence) !== 'high';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const weaponBox = weaponNeedsCheck ? document.querySelector('[data-testid="ocr-weapon"]') : null;
    const first = document.querySelector('[data-testid="ocr-item"][data-band="check"] button, [data-testid="ocr-item"][data-band="low"] button');
    (weaponBox ?? first ?? document.querySelector('[data-testid="ocr-apply-new"]'))?.focus();
  }));
}

async function runFromBlob(id, blob) {
  let image;
  try {
    image = await prepareImage(blob);
  } catch (e) {
    return fail(id, e?.code ?? 'bad-image');
  }
  if (!live(id)) return;
  await recognise(id, image);
}

/** Import from an image File or Blob (file dialog, drop, paste). */
export function importFromBlob(blob, source = 'file') {
  if (store.get().phase !== 'ready') return;
  if (blob.type && !IMAGE_TYPES.includes(blob.type) && !/^image\//.test(blob.type)) {
    const id = begin(source);
    fail(id, 'bad-image');
    return;
  }
  lastInput = { kind: 'blob', blob, source };
  const id = begin(source);
  runFromBlob(id, blob);
}

let fileInput = null;
/** Open the Windows file dialog (PNG, JPG, WebP, BMP). */
export function chooseFile() {
  if (store.get().phase !== 'ready') return;
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = ACCEPT;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) importFromBlob(f, 'file');
    });
    document.body.appendChild(fileInput);
  }
  fileInput.click();
}

/** Ctrl+V or "Paste screenshot": the clipboard image through the main process. */
export async function importFromClipboard({ fromShortcut = false } = {}) {
  if (store.get().phase !== 'ready') return false;
  const r = await uf.ocr?.clipboardImage?.();
  if (!r || r.error) {
    // A shortcut with text on the clipboard is a normal paste somewhere else; say nothing.
    if (fromShortcut && r?.hasText) return false;
    if (r?.error?.code === 'no-image') {
      notify({ intent: 'info', title: "There's no image on the clipboard.", body: 'Copy a screenshot first (Win+Shift+S).' });
    } else {
      notify({ intent: 'error', title: "Couldn't paste the screenshot.", body: r?.error?.message ?? 'The clipboard could not be read.' });
    }
    return false;
  }
  importFromBlob(new Blob([r.png], { type: 'image/png' }), 'paste');
  return true;
}

/** "Read from game window": capture the Warframe window (it may be in the background, not minimised). */
export async function importFromGame() {
  if (store.get().phase !== 'ready') return;
  lastInput = { kind: 'game' };
  const id = begin('game');
  const shot = await uf.ocr?.captureGame?.();
  if (!live(id)) return;
  if (!shot || shot.error) return fail(id, shot?.error?.code ?? 'game-not-found', shot?.error?.message);
  let image;
  try {
    image = await prepareImage(new Blob([shot.png], { type: 'image/png' }));
  } catch (e) {
    return fail(id, e?.code ?? 'bad-image');
  }
  if (image.blank) return fail(id, 'blank');
  await recognise(id, image);
}

/** Smoke and scene mode: run the review on a recorded OCR result (text only) and a synthetic screenshot. */
export async function importRecorded(ocr, { imageUrl = null } = {}) {
  lastInput = { kind: 'recorded', ocr, imageUrl };
  const id = begin('file');
  await new Promise(r => setTimeout(r, 60));
  if (!live(id)) return;
  await recognise(id, { url: imageUrl, width: ocr.width, height: ocr.height, bytes: null }, { ocr });
}

/** Scene mode: show an error state. */
export function showError(code) {
  const id = begin('file');
  fail(id, code);
}

export function retry() {
  const input = lastInput;
  if (!input) return chooseFile();
  if (input.kind === 'blob') return importFromBlob(input.blob, input.source);
  if (input.kind === 'game') return importFromGame();
  if (input.kind === 'recorded') return importRecorded(input.ocr, { imageUrl: input.imageUrl });
  return chooseFile();
}

/**
 * Focus `el` (else the element with `focusId`) once the dialog has gone. Fluent's dialog hands focus back to
 * whatever was focused when it opened (often <body>, or a menu item that no longer exists) a few frames after
 * closing, so this checks again and wins over that.
 */
function focusAfterDialog(el, focusId, fallbackId = null) {
  const go = () => {
    if (el?.isConnected && el.getClientRects?.().length) el.focus();
    else focusLater(focusId, fallbackId);
  };
  requestAnimationFrame(go);
  for (const ms of [120, 320]) {
    setTimeout(() => {
      const a = document.activeElement;
      if (!store.get().ocr && (!a || a === document.body)) go();
    }, ms);
  }
}

/** Close (Cancel, Esc, or after applying). The image is released; focus goes back to the trigger. */
export function close({ restoreFocus = true } = {}) {
  const o = store.get().ocr;
  runId++;
  clearSlow();
  lastInput = null;
  store.set({ ocr: null });
  if (restoreFocus) focusAfterDialog(o?.returnFocus, 'ocr-button');
}

// ---------- review edits ----------

function patchReview(fn) {
  store.set(s => (s.ocr?.review ? { ocr: { ...s.ocr, review: fn(s.ocr.review) } } : null));
}

export function setWeapon(name) {
  patchReview(r => ({ ...r, weaponName: name || null, weaponFromCurrent: false }));
}

export function setItem(key, patch) {
  patchReview(r => ({ ...r, items: r.items.map(i => (i.key === key ? { ...i, ...patch } : i)) }));
}

/**
 * Replace an item with a picked mod or arcane: kept, high confidence (the user chose it). The user's pick wins: a
 * kept item it duplicates or conflicts with is set aside (its reading stays as a suggestion), and that is said.
 */
export function replaceItem(key, name) {
  const review = store.get().ocr?.review;
  const item = review?.items.find(i => i.key === key);
  const clash = item ? pickConflict(store.get().ctx, review, item, name) : null;
  if (clash) {
    setItem(clash.key, { name: null, keep: false, suggestion: clash.name, chosen: false, droppedFor: name });
    announce(`${clash.name} set aside: ${clash.reason.replace(/^Already in/, 'it was already in').replace(/^Conflicts with .*$/, `it conflicts with ${name}`)}.`);
  }
  setItem(key, { name, keep: true, band: 'high', confidence: 1, chosen: true, rank: null, rankSource: 'assumed', cleared: false, droppedFor: null });
}

export function useSuggestion(key) {
  const it = store.get().ocr?.review?.items.find(i => i.key === key);
  if (it?.suggestion) setItem(key, { name: it.suggestion, keep: true });
}

/** Clear an item: the slot is applied empty (Apply to current build empties it too). */
export function clearItem(key) {
  setItem(key, { name: null, keep: false, cleared: true, attention: false, droppedFor: null, kindNote: 'Left empty' });
}

export function toggleUnmatched(on) {
  setOcr({ showUnmatched: Boolean(on) });
}

// ---------- applying ----------

const importNote = (polarity = null) => [
  `Imported from a screenshot on ${fmtShortDate(new Date().toISOString())}. Ranks were read from the card pips where visible and otherwise assumed max; check them.`,
  polaritySentence(polarity),
].filter(Boolean).join(' ');

/** What the notes and the toast say about slot polarities, which screenshots don't show. */
function polaritySentence(p) {
  if (!p) return null;
  if (p.assumed) {
    const given = p.assumed === 1 ? "1 slot was given its mod's polarity" : `${p.assumed} slots were given their mods' polarities`;
    return `Slot polarities aren't read from screenshots: ${given} so the build fits its capacity, as Forma would. Check them.`;
  }
  return "Slot polarities aren't read from screenshots; the weapon's own polarities are used.";
}

/** The applied mods with polarities inferred for them (see inferSlotPolarities). */
function withPolarities(ctx, build, parts) {
  const p = inferSlotPolarities(ctx, parts.weaponName, parts.mods, { catalyst: build.catalyst !== false });
  return { build: { ...build, slotPolarities: p.slotPolarities }, polarity: p };
}

/** "Open as new build": an unsaved build named "Imported <Weapon> build", after the unsaved-changes guard. */
export async function applyAsNew() {
  const o = store.get().ocr;
  const { ctx } = store.get();
  if (!o?.review || !ctx.weaponByName.has(o.review.weaponName)) return false;
  const parts = appliedParts(ctx, o.review);
  // The "Save changes?" dialog can't sit on top of this one: hide it while asking, bring it back on Cancel.
  store.set({ ocr: null });
  if (!(await confirmLeave())) {
    store.set({ ocr: o });
    return false;
  }
  let build = createBuild(ctx, {
    weaponName: parts.weaponName,
    name: `Imported ${parts.weaponName} build`,
    notes: importNote(),
    enemy: store.get().build?.enemy,
  });
  build = { ...build, mods: parts.mods };
  const inferred = withPolarities(ctx, build, parts);
  build = { ...inferred.build, notes: importNote(inferred.polarity) };
  if (parts.arcane) build = setArcane(ctx, build, 0, { ...newArcane(ctx, parts.arcane.name), rank: parts.arcane.rank });
  openImportedBuild(build);
  runId++;
  clearSlow();
  lastInput = null;
  announce(`Opened ${build.name} with ${parts.mods.filter(Boolean).length} mods.`);
  focusAfterDialog(null, 'build-name');
  return true;
}

/** What Apply to current build keeps of the open build: "Kept the build's own mods in slots 1 and 5 and its arcane, …". */
export function keptText(merged) {
  const what = [];
  if (merged.keptSlots.length) what.push(`${merged.keptSlots.length === 1 ? 'mod' : 'mods'} in ${slotListText(merged.keptSlots)}`);
  if (merged.keptArcane) what.push('arcane');
  if (!what.length) return null;
  return `Kept the build's own ${what.join(' and its ')}, which the screenshot didn't show clearly.`;
}

/** "Apply to current build": weapon, mods and arcane replaced in one undo step; target, mode and notes kept. */
export function applyToCurrent() {
  const s = store.get();
  const o = s.ocr;
  const { ctx } = s;
  if (!o?.review || !ctx.weaponByName.has(o.review.weaponName)) return false;
  const parts = appliedParts(ctx, o.review);
  let next = s.build;
  if (next.weaponName !== parts.weaponName) next = changeWeapon(ctx, next, parts.weaponName).build;
  // Slots the screenshot said nothing reliable about keep the build's own mod and arcane (see keepsCurrent).
  const merged = mergeWithCurrent(ctx, o.review, parts, next);
  next = { ...next, mods: merged.mods };
  const inferred = withPolarities(ctx, next, { ...parts, mods: merged.mods });
  next = inferred.build;
  if (!merged.keptArcane) next = setArcane(ctx, next, 0, parts.arcane ? { ...newArcane(ctx, parts.arcane.name), rank: parts.arcane.rank } : null);
  const before = snapshotOf(s.build);
  const changed = commitBuildForImport(next);
  close({ restoreFocus: false });
  focusAfterDialog(null, 'slot-select-0', 'slot-add-0');
  const count = parts.mods.filter(Boolean).length;
  const name = s.build.name?.trim() || 'Untitled build';
  if (changed) {
    const after = snapshotOf(store.get().build);
    notify({
      intent: 'success',
      title: `Imported ${count} ${count === 1 ? 'mod' : 'mods'} into "${name}"`,
      body: [keptText(merged), polaritySentence(inferred.polarity)].filter(Boolean).join(' '),
      action: {
        label: 'Undo',
        run: () => {
          if (snapshotOf(store.get().build) === after) actions.undo();
          else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." });
        },
      },
    });
  }
  return before !== snapshotOf(store.get().build);
}

