// Scripted end-to-end check (UF_SMOKE=1) against the real UI. Reports via uf.smokeResult with the same
// shape as before: { ok, weapon, target, avgDps, ttk, runs, checks, errors, timings }.
import { ARCANE_SLOT, resolvePresetName, ttkText } from './model.js';
import { clearToasts } from './controller.js';
import * as O from './ocr-import.js';

export const SMOKE_PLAN = {
  weapon: 'Braton Prime',
  mods: [['Serration', 10], ['Split Chamber', 5], ['Point Strike', 5], ['Infected Clip', 5]],
  target: 'Elite Crewmen',
};

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.info(`[smoke] ${msg}`);
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

/** Poll until `fn()` is truthy (checked every animation frame), or give up after `ms`. */
export async function waitFor(fn, ms = 5000) {
  const end = performance.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() > end) return null;
    await nextFrame();
  }
}

/** Screenshot hook; a failed capture is reported but does not stop the flow. */
async function capture(uf, tag, errors) {
  try {
    await uf.smokeCapture?.(tag);
  } catch (e) {
    errors.push(`capture ${tag}: ${e?.message ?? e}`);
  }
}

/** Is the element inside the viewport and not inside a scrolled-away region? */
function onScreen(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

/** Centre of an element, and whether a pointer there reaches it (nothing invisible covers it). */
function hitTest(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, ok: Boolean(hit && (hit === el || el.contains(hit))), hit };
}

const describe = el => (el ? `${el.tagName} ${String(el.className ?? '').slice(0, 40)}${el.hasAttribute?.('data-portal-node') ? ' (portal node)' : ''}` : 'nothing');

/** A real OS-level mouse click (sendInputEvent in main) on an element; reports what the point hits. */
async function realClick(app, el, errors, what) {
  if (!el) { errors.push(`${what}: element not found`); return false; }
  el.scrollIntoView?.({ block: 'nearest' });
  await nextFrame();
  const h = hitTest(el);
  if (!h.ok) { errors.push(`${what}: the pointer can't reach it (covered by ${describe(h.hit)})`); return false; }
  const clicked = await app.uf.smokeClick?.(h.x, h.y);
  if (!clicked) { errors.push(`${what}: the real click was not delivered`); return false; }
  return true;
}

/** Key controls must be reachable by the pointer: nothing (like a portal mount node) may sit on top of them. */
function checkPointerReach(errors, checks) {
  const targets = {
    pane: '[data-focus-id="library-toggle"]',
    buildName: '#build-name',
    emptySlot: '[data-testid="slot-add-4"]',
    gallerySearch: '[data-testid="gallery-search"]',
    galleryCard: '[data-testid="gallery-card"]',
    pin: '[data-testid="result-card"] button',
    tab: '#tab-target',
    ocr: '[data-testid="ocr-button"]',
  };
  const blocked = [];
  for (const [name, sel] of Object.entries(targets)) {
    const el = $(sel);
    if (!el) { blocked.push(`${name}: not found`); continue; }
    const h = hitTest(el);
    if (!h.ok) blocked.push(`${name}: covered by ${describe(h.hit)}`);
  }
  checks.pointerBlocked = blocked;
  if (blocked.length) errors.push(`pointer can't reach: ${blocked.join('; ')}`);
}

const key = (target, k, opts = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const focusId = () => document.activeElement?.dataset?.focusId ?? document.activeElement?.tagName;
const card = name => $(`[data-testid="gallery-card"][data-mod-name="${CSS.escape(name)}"], [data-testid="arcane-card"][data-mod-name="${CSS.escape(name)}"]`);

/**
 * The gallery replaces the picker: it is always there, searches, marks equipped and blocked cards, and a REAL
 * mouse click on a card equips it (into the first empty slot, then into a selected slot).
 */
async function checkGallery(app, errors, checks) {
  const { store } = app;
  if ($('[data-testid="mod-picker"]')) errors.push('gallery: the old mod picker is still in the DOM');
  const search = $('[data-testid="gallery-search"]');
  if (!search) { errors.push('gallery: no search box'); return; }
  checks.galleryCards = $$('[data-testid="gallery-card"]').length;
  if (!checks.galleryCards) errors.push('gallery: no cards rendered');
  if (checks.galleryCards >= 60) errors.push(`gallery: ${checks.galleryCards} cards in the DOM (virtualisation should keep it under 60)`);
  checks.galleryImages = $$('[data-testid="gallery"] [role="gridcell"] img').length;

  // Equipped and blocked cards.
  typeInto(search, 'serration');
  const amalgam = await waitFor(() => card('Amalgam Serration'));
  const equipped = card('Serration');
  if (equipped?.dataset.state !== 'equipped') errors.push(`gallery: Serration shows as ${equipped?.dataset.state ?? 'missing'}, not equipped`);
  if (amalgam && (amalgam.dataset.state !== 'blocked' || amalgam.getAttribute('aria-disabled') !== 'true')) errors.push('gallery: Amalgam Serration is not blocked');
  if (amalgam && !/conflicts with Serration/i.test(amalgam.getAttribute('aria-label') ?? '')) errors.push('gallery: the blocked card does not say why');

  // A real click on a card equips it into the first empty slot (slot 5).
  typeInto(search, 'hammer shot');
  const hammer = await waitFor(() => card('Hammer Shot'));
  await sleep(150);
  checks.realClick = await realClick(app, hammer, errors, 'gallery card Hammer Shot');
  if (!(await waitFor(() => store.get().build.mods[4]?.name === 'Hammer Shot', 2000))) {
    errors.push(`gallery: a real click on Hammer Shot left slot 5 with ${store.get().build.mods[4]?.name ?? 'nothing'}`);
  }
  const count = $('[data-testid="gallery-count"]')?.textContent ?? '';
  checks.galleryCount = count;
  if (!/\d+ mods?/.test(count)) errors.push(`gallery: count reads "${count}"`);

  // Select slot 7 with a real click on it, then a real click on a card fills it; the selection moves on.
  await realClick(app, $('[data-testid="slot-add-6"]'), errors, 'empty slot 7');
  if (!(await waitFor(() => store.get().selectedSlot === 6, 1500))) errors.push(`gallery: clicking slot 7 selected ${store.get().selectedSlot}`);
  typeInto(search, 'vital sense');
  const vital = await waitFor(() => card('Vital Sense'));
  await sleep(150);
  await realClick(app, vital, errors, 'gallery card Vital Sense');
  if (!(await waitFor(() => store.get().build.mods[6]?.name === 'Vital Sense', 2000))) errors.push('gallery: Vital Sense did not go into the selected slot 7');
  if (store.get().selectedSlot !== 7) errors.push(`gallery: after filling slot 7 the selection is ${store.get().selectedSlot}, not slot 8`);
  app.actions.selectSlot(null);
  typeInto(search, '');

  // Smart search: operators become tags, did-you-mean.
  typeInto(search, 'cc drain<=10 ');
  const tag = await waitFor(() => $$('[data-testid="gallery"] .fui-Tag').find(t => /Drain at max rank ≤ 10/.test(t.textContent)), 2000);
  if (!tag) errors.push('gallery: "drain<=10" did not become a tag');
  typeInto(search, 'seration');
  const dym = await waitFor(() => $$('[data-testid="gallery"] button, [data-testid="gallery"] a').find(b => b.textContent.trim() === 'Serration'), 2000);
  if (!dym) errors.push('gallery: "seration" offers no "Did you mean Serration"');
  typeInto(search, '');
  await capture(app.uf, 'gallery', errors);
  log(`gallery: ${checks.galleryCards} cards in the DOM, ${checks.galleryImages} images`);
}

/** Capacity meter and slot drain plates. */
function checkCapacity(app, errors, checks) {
  const meter = $('[data-testid="capacity"]');
  if (!meter) { errors.push('capacity: no meter'); return; }
  checks.capacity = `${meter.getAttribute('aria-valuenow')}/${meter.getAttribute('aria-valuemax')}`;
  if (meter.getAttribute('role') !== 'meter') errors.push('capacity: the meter has no meter role');
  const plate = $('[data-testid="slot-drain-0"]');
  if (!plate) errors.push('capacity: slot 1 has no drain plate');
  else if (!['match', 'mismatch', 'neutral'].includes(plate.dataset.match)) errors.push('capacity: the drain plate has no match state');
  checks.slotImage = Boolean($('[data-testid="slot-0"] img'));
}

/** The arcane slot: Ctrl+Shift+9 selects it and shows the Arcanes tab; a real click on a card equips it. */
async function checkArcane(app, errors, checks) {
  const { store } = app;
  key(document, '(', { ctrlKey: true, shiftKey: true, code: 'Digit9' });
  if (!(await waitFor(() => store.get().selectedSlot === ARCANE_SLOT && store.get().gallery.tab === 'arcanes', 1500))) {
    errors.push('arcane: Ctrl+Shift+9 did not select the arcane slot and the Arcanes tab');
    app.actions.selectSlot(ARCANE_SLOT);
  }
  const merciless = await waitFor(() => card('Primary Merciless'), 3000);
  await sleep(150);
  await realClick(app, merciless, errors, 'arcane card Primary Merciless');
  if (!(await waitFor(() => store.get().build.arcanes?.[0]?.name === 'Primary Merciless', 2000))) errors.push('arcane: Primary Merciless was not equipped');
  const before = store.get().sim.summary?.avgDps;
  const after = await app.actions.runNow();
  checks.arcaneDps = after?.avgDps ? Math.round(after.avgDps) : null;
  if (!(after?.avgDps > before)) errors.push(`arcane: DPS did not rise with Primary Merciless (${before} -> ${after?.avgDps})`);
  if (!$('[data-testid="slot-arcane"] [data-testid="slot-arcane-select"]')) errors.push('arcane: the arcane slot shows no equipped arcane');
  app.actions.selectSlot(null);
  app.actions.setGalleryTab('mods');
  log(`arcane equipped: ${checks.arcaneDps} DPS`);
}

/**
 * Keyboard flow (docs/arsenal-spec.md 4.7, 5.3, 10.2): Ctrl+6 selects slot 6 and focuses the gallery search,
 * Enter equips the first result, Del removes, Ctrl+Z / Ctrl+Y undo and redo, F6 cycles the panes.
 */
async function checkKeyboard(app, errors, checks) {
  const { store } = app;
  const slot = 5;
  key(document, '6', { ctrlKey: true, code: 'Digit6' });
  const search = await waitFor(() => (document.activeElement?.dataset?.testid === 'gallery-search' ? document.activeElement : null), 1500);
  if (!search) { errors.push(`keyboard: Ctrl+6 did not focus the gallery search (focus on ${focusId()})`); return; }
  if (store.get().selectedSlot !== slot) errors.push(`keyboard: Ctrl+6 selected ${store.get().selectedSlot}`);
  typeInto(search, 'stormbringer');
  await waitFor(() => card('Stormbringer'));
  key(search, 'ArrowDown');
  const first = await waitFor(() => (document.activeElement?.dataset?.testid === 'gallery-card' ? document.activeElement : null), 1000);
  if (!first) errors.push('keyboard: Down from the search did not focus the first card');
  else {
    key(first, 'ArrowUp');
    if (!(await waitFor(() => document.activeElement === search, 1000))) errors.push('keyboard: Up on the first row did not return to the search');
  }
  key(search, 'Enter');
  if (!(await waitFor(() => store.get().build.mods[slot]?.name === 'Stormbringer', 1500))) errors.push(`keyboard: slot 6 holds ${store.get().build.mods[slot]?.name ?? 'nothing'} after Enter`);
  const rank = store.get().build.mods[slot]?.rank;
  document.querySelector(`[data-focus-id="slot-select-${slot}"]`)?.focus();
  key(document.activeElement, '-');
  if (store.get().build.mods[slot]?.rank !== rank - 1) errors.push('keyboard: - on a slot did not lower the rank');
  key(document.activeElement, 'End');
  key(document.activeElement, 'Delete');
  await waitFor(() => !store.get().build.mods[slot], 1000);
  if (store.get().build.mods[slot]) errors.push('keyboard: Del did not remove the mod');
  if (!(await waitFor(() => focusId() === `slot-add-${slot}`, 1500))) errors.push(`keyboard: focus after remove is on ${focusId()}, not the empty slot`);
  key(document.activeElement, 'z', { ctrlKey: true });
  await waitFor(() => store.get().build.mods[slot], 1000);
  const back = store.get().build.mods[slot];
  if (back?.name !== 'Stormbringer' || back?.rank !== rank) errors.push('keyboard: Ctrl+Z did not restore the mod with its rank');
  key(document.body, 'y', { ctrlKey: true });
  await waitFor(() => !store.get().build.mods[slot], 1000);
  if (store.get().build.mods[slot]) errors.push('keyboard: Ctrl+Y did not redo the removal');
  app.actions.selectSlot(null);
  typeInto(search, '');

  // Arrow keys move between the slot buttons (one group, docs/arsenal-spec.md 4.7).
  const s0 = $('[data-focus-id="slot-select-0"]');
  s0?.focus();
  key(s0, 'ArrowRight');
  const moved = await waitFor(() => (focusId() === 'slot-select-1' || focusId() === 'slot-add-1' ? focusId() : null), 1000);
  checks.slotArrows = Boolean(moved);
  if (!moved) errors.push(`keyboard: ArrowRight on slot 1 moved focus to ${focusId()}`);

  // Alt+Enter on a gallery card opens the details flyout; Esc closes it.
  const firstCard = $('[data-testid="gallery-card"]');
  firstCard?.focus();
  key(firstCard, 'Enter', { altKey: true });
  if (!(await waitFor(() => $('[data-testid="mod-flyout"]'), 1500))) errors.push('keyboard: Alt+Enter did not open the details flyout');
  key(firstCard, 'Escape');
  await waitFor(() => !$('[data-testid="mod-flyout"]'), 1000);
  if ($('[data-testid="mod-flyout"]')) errors.push('keyboard: Esc did not close the flyout');
  if (document.activeElement !== firstCard) errors.push('keyboard: closing the flyout moved focus');

  // F6 cycles the panes: builds -> toolbar -> stats -> stage -> gallery -> results (-> compare when open).
  const paneOf = () => document.activeElement?.closest?.('[data-pane]')?.dataset.pane ?? 'none';
  const panes = [];
  for (let i = 0; i < 7; i++) {
    key(document.activeElement ?? document, 'F6');
    await nextFrame();
    panes.push(paneOf());
  }
  checks.f6 = panes;
  const order = ['builds', 'toolbar', 'stats', 'stage', 'gallery', 'results'].filter(p => document.querySelector(`[data-pane="${p}"]`)?.getClientRects().length);
  const n = order.length;
  const expected = order.map((_, start) => Array.from({ length: 7 }, (__, k) => order[(start + k) % n]).join(' '));
  if (!expected.includes(panes.join(' '))) errors.push(`keyboard: F6 visited ${panes.join(' ')}`);
  checks.keyboard = true;
  log('keyboard flow done');
}

/**
 * Screenshot import: the review on a recorded OCR result (text from the test fixtures, no image), applied as a
 * new build; then, when UF_SMOKE_OCR_IMAGE names a real screenshot, the whole Windows OCR path on it.
 */
async function checkOcr(app, errors, checks) {
  const { store, actions, uf } = app;
  const { recordedImport } = await import('./scenes.js');
  // Start from a clean build so "Open as new build" doesn't stop at "Save changes?".
  await actions.newBuild({ force: true });

  const fx = await recordedImport('braton');
  await O.importRecorded(fx.ocr, { imageUrl: fx.imageUrl });
  const review = await waitFor(() => $('[data-testid="ocr-review"]'), 8000);
  if (!review) { errors.push(`ocr: no review dialog for the recorded fixture (state ${store.get().ocr?.phase} ${store.get().ocr?.error?.code ?? ''})`); O.close({ restoreFocus: false }); return; }
  const items = $$('[data-testid="ocr-item"]');
  checks.ocrItems = items.length;
  if (items.length !== 10) errors.push(`ocr: ${items.length} review items, expected 10 (arcane, Exilus, 8 slots)`);
  checks.ocrRegions = $$('[data-testid="ocr-region"]').length;
  if (!checks.ocrRegions) errors.push('ocr: no region boxes on the screenshot');
  if (!/Nothing is uploaded/.test(review.textContent)) errors.push('ocr: the privacy note is missing');
  await capture(uf, 'ocr-review', errors);
  const apply = $('[data-testid="ocr-apply-new"]');
  apply?.click();
  if (!(await waitFor(() => !store.get().ocr, 3000))) errors.push('ocr: Open as new build did not close the dialog');
  const b = store.get().build;
  const want = fx.expected.slots.map(s => s?.name ?? null);
  const got = b.mods.slice(0, 8).map(m => m?.name ?? null);
  checks.ocrApplied = got;
  if (b.weaponName !== fx.expected.weapon) errors.push(`ocr: the new build's weapon is ${b.weaponName}`);
  const missed = want.filter((n, i) => n && got[i] !== n);
  if (missed.length) errors.push(`ocr: the imported build lacks ${missed.join(', ')}`);
  if (!/^Imported /.test(b.name)) errors.push(`ocr: the new build is called "${b.name}"`);
  if (b.id) errors.push('ocr: the imported build was saved; it must start unsaved');
  if (b.arcanes?.[0]?.name !== fx.expected.arcane) errors.push(`ocr: arcane ${b.arcanes?.[0]?.name ?? 'none'}, expected ${fx.expected.arcane}`);
  log(`ocr (recorded): ${got.filter(Boolean).length} mods imported`);

  // Real Windows OCR on a screenshot file, when one is given (local test image; never in the repo).
  const bytes = await uf.smokeOcrImage?.();
  if (bytes) {
    const started = performance.now();
    O.importFromBlob(new Blob([bytes], { type: 'image/jpeg' }), 'file');
    const progress = await waitFor(() => $('[data-testid="ocr-progress"]'), 1000);
    checks.ocrProgressMs = progress ? Math.round(performance.now() - started) : null;
    if (!progress) errors.push('ocr: no progress state within 1 s');
    const done = await waitFor(() => store.get().ocr?.phase === 'review' || store.get().ocr?.phase === 'error', 40000);
    const o = store.get().ocr;
    if (!done || o?.phase !== 'review') {
      errors.push(`ocr (real): ${o?.phase ?? 'closed'} ${o?.error?.code ?? ''} ${o?.error?.detail ?? ''}`.trim());
    } else {
      const names = o.review.items.filter(i => i.name).map(i => i.name);
      checks.ocrReal = { ms: Math.round(performance.now() - started), weapon: o.review.weaponName, mods: names.length, names };
      if (!o.review.weaponName) errors.push('ocr (real): no weapon recognised');
      if (names.length < 6) errors.push(`ocr (real): only ${names.length} items recognised`);
      await capture(uf, 'ocr-real', errors);
      log(`ocr (real): ${o.review.weaponName}, ${names.length} items in ${checks.ocrReal.ms} ms`);
    }
    O.close({ restoreFocus: false });
  }
  await actions.newBuild({ force: true });
}

/** Save the build, check the library shows it, then delete it (no confirm), undo, and delete again. */
async function checkSaveRemove(app, errors, checks) {
  const { actions, store, uf } = app;
  const saved = await actions.save();
  if (!saved?.id) { errors.push('save: no saved build returned'); return; }
  const listed = await uf.builds.list();
  const stored = listed.find(b => b.id === saved.id);
  if (!stored) errors.push('save: saved build is not in uf.builds.list()');
  if (stored && store.get().build.arcanes?.[0] && stored.arcanes?.[0]?.name !== store.get().build.arcanes[0].name) errors.push('save: the arcane was not stored');
  if (saved.lastResult?.avgDps !== store.get().sim.summary?.avgDps) errors.push('save: lastResult was not stored');
  actions.setLibraryTab('mine');
  actions.setLibraryOpen(true);
  const item = await waitFor(() => $(`[data-testid="library-item"][aria-current="true"]`));
  if (!item) errors.push('save: the library does not show the saved build as current');
  actions.setLibraryOpen(false);
  if (app.isDirty()) errors.push('save: build still marked as changed');
  log(`saved build ${saved.id}`);
  await capture(uf, 'saved', errors);

  await actions.deleteSaved(saved.id);
  if ((await uf.builds.list()).some(b => b.id === saved.id)) errors.push('remove: build is still stored after delete');
  if (store.get().savedBuilds.some(b => b.id === saved.id)) errors.push('remove: build is still in the library');
  if ($('[role="alertdialog"], [role="dialog"]')) errors.push('remove: a confirm dialog opened (delete must use undo)');
  const undo = await waitFor(() => $$('[data-testid="toast"] a, [data-testid="toast"] button').find(b => b.textContent.trim() === 'Undo'));
  if (!undo) errors.push('remove: no Undo action on the delete toast');
  else {
    undo.click();
    const back = await waitFor(() => store.get().savedBuilds.some(b => b.id === saved.id), 3000);
    if (!back) errors.push('remove: Undo did not restore the build with the same id');
    if (store.get().build?.id !== saved.id) errors.push('remove: Undo did not re-attach the open build');
    await actions.deleteSaved(saved.id);
  }
  checks.saveRemove = true;
  log('save, delete, undo and delete round trip done');
}

/** Show the Featured tab and check it has entries. Left open for the final screenshot. */
async function checkFeatured(app, errors, checks) {
  app.actions.setLibraryTab('featured');
  app.actions.setLibraryOpen(true);
  const items = await waitFor(() => $$('[data-testid="featured-item"]').length && $$('[data-testid="featured-item"]'));
  checks.featured = items?.length ?? 0;
  if (!items?.length) errors.push('featured: list is empty');
  log(`featured list shows ${checks.featured} builds`);
}

export async function runSmoke(app, { t0 }) {
  const { actions, store, uf, timings } = app;
  const errors = [];
  const checks = {};
  const started = performance.now();
  let summary = null;
  try {
    log('starting scripted build');
    await waitFor(() => $('[data-testid="result-card"]'));
    await actions.newBuild({ force: true });
    actions.setWeapon(SMOKE_PLAN.weapon);
    SMOKE_PLAN.mods.forEach(([name, rank], slot) => {
      if (!actions.equipMod(slot, name, rank, { focus: false })) errors.push(`could not equip ${name}`);
    });
    const preset = resolvePresetName(store.get().ctx, SMOKE_PLAN.target);
    if (!preset) errors.push(`target preset not found: ${SMOKE_PLAN.target}`);
    else actions.setTarget({ preset });

    const simStart = performance.now();
    summary = await actions.runNow();
    timings.simMs = Math.round(performance.now() - simStart);
    await waitFor(() => store.get().sim.status === 'done', 10000);
    await nextFrame();

    const s = store.get();
    if (s.build.weaponName !== SMOKE_PLAN.weapon) errors.push(`weapon is ${s.build.weaponName}`);
    SMOKE_PLAN.mods.forEach(([name, rank], slot) => {
      const m = s.build.mods[slot];
      if (m?.name !== name || m?.rank !== rank) errors.push(`slot ${slot + 1} holds ${m ? `${m.name} R${m.rank}` : 'nothing'}, expected ${name} R${rank}`);
    });
    if (!summary?.ok) errors.push(`simulation failed: ${s.sim.error ?? 'no result'}`);
    else if (!(summary.avgDps > 0)) errors.push(`avgDps is ${summary.avgDps}`);
    if (!s.sim.debug) errors.push(`no debug run for charts${s.sim.debugError ? `: ${s.sim.debugError}` : ''}`);
    const shown = await waitFor(() => {
      const t = $('[data-testid="avg-dps"]')?.textContent ?? '';
      return t && t !== '—' ? t : null;
    });
    if (!shown) errors.push('Average DPS is not shown in the UI');
    if (!$('[data-testid="ttk"]')?.textContent) errors.push('Time to kill is not shown in the UI');
    const chart = await waitFor(() => $('[data-testid="health-chart"] svg path'), 5000);
    if (!chart) errors.push('health chart did not render');
    // Arsenal layout (docs/arsenal-spec.md 11, item 1): card, chart, all slots, capacity and gallery cards on screen.
    checks.chartOnScreen = onScreen($('[data-testid="health-chart"]'));
    checks.resultCardOnScreen = onScreen($('[data-testid="result-card"]'));
    checks.slotsOnScreen = [0, 1, 2, 3, 4, 5, 6, 7, 8].every(i => onScreen($(`[data-testid="slot-${i}"]`))) && onScreen($('[data-testid="slot-arcane"]'));
    checks.capacityOnScreen = onScreen($('[data-testid="capacity"]'));
    checks.galleryCardsOnScreen = $$('[data-testid="gallery-card"]').filter(onScreen).length;
    if (!checks.resultCardOnScreen) errors.push('result card is not fully on screen');
    checks.viewport = `${window.innerWidth}x${window.innerHeight}`;
    const full = window.outerWidth >= 1440 && window.outerHeight >= 900;
    if (full && !checks.chartOnScreen) errors.push(`the health chart is not on screen at ${checks.viewport}`);
    if (full && !checks.slotsOnScreen) errors.push(`not all 9 mod slots and the arcane slot are on screen at ${checks.viewport}`);
    if (full && !checks.capacityOnScreen) errors.push(`the capacity meter is not on screen at ${checks.viewport}`);
    if (full && checks.galleryCardsOnScreen < 6) errors.push(`only ${checks.galleryCardsOnScreen} gallery cards are fully on screen at ${checks.viewport}`);
    checkPointerReach(errors, checks);
    checkCapacity(app, errors, checks);
    log(`simulated ${summary?.avgDps?.toFixed?.(1)} DPS (chart on screen: ${checks.chartOnScreen}, all slots on screen: ${checks.slotsOnScreen}, ${checks.galleryCardsOnScreen} cards on screen)`);
    // Typography and pointer targets (UX spec 3.3, WCAG 2.5.8).
    const font = getComputedStyle($('[data-testid="avg-dps"]')).fontFamily;
    const bodyFont = getComputedStyle($('[data-testid="slot-select-0"]') ?? document.body).fontFamily;
    checks.kpiFont = font.split(',')[0].replace(/"/g, '');
    checks.bodyFont = bodyFont.split(',')[0].replace(/"/g, '');
    if (!/^Segoe UI Variable/.test(checks.bodyFont)) errors.push(`body text font is ${bodyFont}`);
    checks.kpiTabular = getComputedStyle($('[data-testid="avg-dps"]')).fontVariantNumeric.includes('tabular-nums');
    if (!checks.kpiTabular) errors.push('the Average DPS value does not use tabular numerals');
    const small = [];
    for (const el of $$('[data-testid^="slot-"] button, [data-testid="gallery-card"], footer a, footer button')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.width < 24 || r.height < 24)) small.push(`${el.getAttribute('aria-label') ?? el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    checks.smallTargets = small;
    if (small.length) errors.push(`pointer targets under 24x24: ${small.join(', ')}`);
    checks.windowScrolls = document.scrollingElement.scrollHeight > window.innerHeight || document.scrollingElement.scrollWidth > window.innerWidth;
    if (checks.windowScrolls) errors.push('the window itself scrolls');
    clearToasts();
    await sleep(400);
    await capture(uf, 'results', errors);

    await checkGallery(app, errors, checks);
    await checkArcane(app, errors, checks);
    await checkKeyboard(app, errors, checks);
    await checkSaveRemove(app, errors, checks);
    await checkOcr(app, errors, checks);
    await checkFeatured(app, errors, checks);
    // Clear toasts so the final screenshot shows the app itself.
    clearToasts();
    await sleep(500);
    errors.push(...app.errors);
  } catch (e) {
    errors.push(`smoke: ${e?.message ?? e} ${e?.stack?.split('\n')[1] ?? ''}`);
  }
  timings.smokeMs = Math.round(performance.now() - started);
  timings.totalMs = Math.round(performance.now() - t0);
  const s = store.get();
  const report = {
    ok: errors.length === 0,
    weapon: s.build?.weaponName ?? null,
    target: s.build?.enemy ? `${s.build.enemy.preset} L${s.build.enemy.level}` : null,
    avgDps: summary?.ok ? Math.round(summary.avgDps * 100) / 100 : null,
    ttk: summary?.ok ? ttkText(summary) : null,
    runs: summary?.runs ?? 0,
    checks,
    errors,
    timings,
  };
  log('reporting');
  await uf.smokeResult(report);
  return report;
}
