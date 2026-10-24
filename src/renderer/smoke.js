// Scripted end-to-end check (UF_SMOKE=1) against the real UI. Reports via uf.smokeResult with the same
// shape as before: { ok, weapon, target, avgDps, ttk, runs, checks, errors, timings }.
import { resolvePresetName, ttkText } from './model.js';
import { clearToasts } from './controller.js';

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

/** Key controls must be reachable by the pointer: nothing (like a portal mount node) may sit on top of them. */
function checkPointerReach(errors, checks) {
  const targets = {
    pane: '[data-focus-id="library-toggle"]',
    buildName: '#build-name',
    addMod: '[data-testid="slot-add-4"]',
    pin: '[data-testid="result-card"] button',
    tab: '#tab-stats',
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

/**
 * Open the picker on Slot 5 with a real mouse click (OS-level input from main, not element.click()), check it
 * lists mods and blocks equipped ones, screenshot, close.
 */
async function checkModPicker(app, errors, checks) {
  const button = $('[data-testid="slot-add-4"]');
  if (!button) { errors.push('mod picker: Slot 5 add button not found'); return; }
  const h = hitTest(button);
  const clicked = await app.uf.smokeClick?.(h.x, h.y);
  checks.realClick = Boolean(clicked);
  if (!clicked) button.click();
  const dlg = await waitFor(() => $('[data-testid="mod-picker"]'));
  if (!dlg) { errors.push(`mod picker: a real mouse click on Add mod did not open it (the point hits ${describe(h.hit)})`); return; }
  await waitFor(() => dlg.querySelectorAll('[data-testid="mod-option"]').length);
  const options = dlg.querySelectorAll('[data-testid="mod-option"]');
  const blocked = [...dlg.querySelectorAll('[data-testid="mod-option"][aria-disabled="true"]')].map(n => n.dataset.modName);
  checks.pickerMods = options.length;
  if (!options.length) errors.push('mod picker: no mods listed');
  if (!blocked.includes('Serration')) errors.push('mod picker: equipped Serration is not marked unavailable');
  const serration = dlg.querySelector('[data-testid="mod-option"][data-mod-name="Serration"]');
  if (serration && !/Already in slot 1/.test(serration.textContent)) errors.push('mod picker: Serration does not say "Already in slot 1"');
  const search = dlg.querySelector('input[type="search"]');
  if (!(await waitFor(() => document.activeElement === search, 1000))) {
    const a = document.activeElement;
    errors.push(`mod picker: focus is not in the search box (it is on ${a?.tagName} ${a?.getAttribute('aria-label') ?? a?.textContent?.slice(0, 30) ?? ''})`);
  }
  log(`mod picker lists ${options.length} options, ${blocked.length} unavailable`);
  await capture(app.uf, 'picker', errors);
  const close = dlg.querySelector('button[aria-label="Close"]');
  close?.click();
  await waitFor(() => !$('[data-testid="mod-picker"]'));
  if ($('[data-testid="mod-picker"]')) errors.push('mod picker: did not close');
}

const key = (target, k, opts = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const focusId = () => document.activeElement?.dataset?.focusId ?? document.activeElement?.tagName;

/**
 * Keyboard flow (UX spec 4.7, 5.2, 5.5): Ctrl+6 opens the picker for slot 6 with focus in the search,
 * Down/Up move between the search and the list, Enter equips, focus lands on the slot, Del removes,
 * Ctrl+Z / Ctrl+Y undo and redo, Esc closes the picker.
 */
async function checkKeyboard(app, errors, checks) {
  const { store } = app;
  const slot = 5;
  key(document, '6', { ctrlKey: true });
  const dlg = await waitFor(() => $('[data-testid="mod-picker"]'));
  if (!dlg) { errors.push('keyboard: Ctrl+6 did not open the picker'); return; }
  const search = await waitFor(() => (document.activeElement?.matches?.('[data-testid="mod-picker"] input[type="search"]') ? document.activeElement : null), 1000);
  if (!search) { errors.push('keyboard: picker search is not focused'); return; }
  typeInto(search, 'hammer shot');
  await waitFor(() => dlg.querySelector('[data-testid="mod-option"][data-mod-name="Hammer Shot"]'));
  key(search, 'ArrowDown');
  const first = await waitFor(() => (document.activeElement?.dataset?.testid === 'mod-option' ? document.activeElement : null), 1000);
  if (!first) errors.push('keyboard: Down from the search did not focus the first mod');
  else {
    key(first, 'ArrowUp');
    if (!(await waitFor(() => document.activeElement === search, 1000))) errors.push('keyboard: Up on the first mod did not return to the search');
  }
  key(search, 'Enter');
  await waitFor(() => !$('[data-testid="mod-picker"]'), 2000);
  if ($('[data-testid="mod-picker"]')) errors.push('keyboard: Enter in the search did not equip and close');
  if (store.get().build.mods[slot]?.name !== 'Hammer Shot') errors.push(`keyboard: slot 6 holds ${store.get().build.mods[slot]?.name ?? 'nothing'} after Enter`);
  if (!(await waitFor(() => focusId() === `slot-name-${slot}`, 1500))) errors.push(`keyboard: focus after equip is on ${focusId()}, not the slot`);
  const rank = store.get().build.mods[slot]?.rank;

  key(document.activeElement, 'Delete');
  await waitFor(() => !store.get().build.mods[slot], 1000);
  if (store.get().build.mods[slot]) errors.push('keyboard: Del did not remove the mod');
  if (!(await waitFor(() => focusId() === `slot-add-${slot}`, 1500))) errors.push(`keyboard: focus after remove is on ${focusId()}, not Add mod`);
  key(document.activeElement, 'z', { ctrlKey: true });
  await waitFor(() => store.get().build.mods[slot], 1000);
  const back = store.get().build.mods[slot];
  if (back?.name !== 'Hammer Shot' || back?.rank !== rank) errors.push('keyboard: Ctrl+Z did not restore the mod with its rank');
  key(document.body, 'y', { ctrlKey: true });
  await waitFor(() => !store.get().build.mods[slot], 1000);
  if (store.get().build.mods[slot]) errors.push('keyboard: Ctrl+Y did not redo the removal');

  key(document, '6', { ctrlKey: true });
  const again = await waitFor(() => $('[data-testid="mod-picker"] input[type="search"]'));
  if (again) {
    await waitFor(() => document.activeElement === again, 1000);
    key(document.activeElement ?? again, 'Escape');
    await waitFor(() => !$('[data-testid="mod-picker"]'), 2000);
    if ($('[data-testid="mod-picker"]')) errors.push('keyboard: Esc did not close the picker');
    if (document.activeElement === document.body) errors.push('keyboard: focus was lost to <body> after Esc');
  }
  // F6 cycles the panes: builds -> toolbar -> editor -> results (-> compare when open).
  const paneOf = () => document.activeElement?.closest?.('[data-pane]')?.dataset.pane ?? 'none';
  const panes = [];
  for (let i = 0; i < 5; i++) {
    key(document.activeElement ?? document, 'F6');
    await nextFrame();
    panes.push(paneOf());
  }
  checks.f6 = panes;
  const order = ['builds', 'toolbar', 'editor', 'results'];
  const cycle = panes.join(' ');
  const expected = [0, 1, 2, 3].map(start => [0, 1, 2, 3, 4].map(k => order[(start + k) % 4]).join(' '));
  if (!expected.includes(cycle)) errors.push(`keyboard: F6 visited ${cycle}`);
  checks.keyboard = true;
  log('keyboard flow done');
}

/** Save the build, check the library shows it, then delete it (no confirm), undo, and delete again. */
async function checkSaveRemove(app, errors, checks) {
  const { actions, store, uf } = app;
  const saved = await actions.save();
  if (!saved?.id) { errors.push('save: no saved build returned'); return; }
  const listed = await uf.builds.list();
  if (!listed.some(b => b.id === saved.id)) errors.push('save: saved build is not in uf.builds.list()');
  if (saved.lastResult?.avgDps !== store.get().sim.summary?.avgDps) errors.push('save: lastResult was not stored');
  const item = await waitFor(() => $(`[data-testid="library-item"][aria-current="true"]`));
  if (!item) errors.push('save: the library does not show the saved build as current');
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
    // The results screenshot is taken without scrolling: the card and the chart must already be on screen.
    checks.chartOnScreen = onScreen($('[data-testid="health-chart"]'));
    checks.resultCardOnScreen = onScreen($('[data-testid="result-card"]'));
    checks.slotsOnScreen = [0, 1, 2, 3, 4, 5, 6, 7, 8].every(i => onScreen($(`[data-testid="slot-${i}"]`)));
    if (!checks.resultCardOnScreen) errors.push('result card is not fully on screen');
    // UX spec 2.2 / 8: from 1440x900 up, the chart and all 9 slots are visible without scrolling.
    checks.viewport = `${window.innerWidth}x${window.innerHeight}`;
    const full = window.outerWidth >= 1440 && window.outerHeight >= 900;
    if (full && !checks.chartOnScreen) errors.push(`the health chart is not on screen at ${checks.viewport}`);
    if (full && !checks.slotsOnScreen) errors.push(`not all 9 mod slots are on screen at ${checks.viewport}`);
    checkPointerReach(errors, checks);
    log(`simulated ${summary?.avgDps?.toFixed?.(1)} DPS (chart on screen: ${checks.chartOnScreen}, all slots on screen: ${checks.slotsOnScreen})`);
    // Typography and pointer targets (UX spec 3.3, WCAG 2.5.8).
    const font = getComputedStyle($('[data-testid="avg-dps"]')).fontFamily;
    const bodyFont = getComputedStyle($('[data-testid="slot-0"] button')).fontFamily;
    checks.kpiFont = font.split(',')[0].replace(/"/g, '');
    checks.bodyFont = bodyFont.split(',')[0].replace(/"/g, '');
    if (!/^Segoe UI Variable/.test(checks.bodyFont)) errors.push(`body text font is ${bodyFont}`);
    checks.kpiTabular = getComputedStyle($('[data-testid="avg-dps"]')).fontVariantNumeric.includes('tabular-nums');
    if (!checks.kpiTabular) errors.push('the Average DPS value does not use tabular numerals');
    const small = [];
    for (const el of $$('[data-testid="slot-0"] button, [role="spinbutton"], footer a, footer button')) {
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

    await checkModPicker(app, errors, checks);
    await checkKeyboard(app, errors, checks);
    await checkSaveRemove(app, errors, checks);
    await checkFeatured(app, errors, checks);
    // Clear toasts so the final screenshot shows the app itself.
    clearToasts();
    await sleep(500);
    errors.push(...app.errors);
  } catch (e) {
    errors.push(`smoke: ${e?.message ?? e}`);
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
