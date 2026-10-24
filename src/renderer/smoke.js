// Scripted end-to-end check (UF_SMOKE=1) against the real UI. Reports via uf.smokeResult with the same
// shape as before: { ok, weapon, target, avgDps, ttk, runs, checks, errors, timings }.
// Besides the flows (real clicks through the Picker, keyboard, OCR, save), it checks the declutter targets of
// docs/declutter-spec.md 7: every weapon stat row on screen and unclipped, the controls at rest under a cap, few
// tab stops before the first slot, no gallery at rest, no tinted pills, no text under 12 px.
import { ARCANE_SLOT, resolvePresetName, ttkText } from './model.js';
import { clearToasts } from './controller.js';
import * as O from './ocr-import.js';

export const SMOKE_PLAN = {
  weapon: 'Braton Prime',
  mods: [['Serration', 10], ['Split Chamber', 5], ['Point Strike', 5], ['Infected Clip', 5]],
  target: 'Elite Crewmen',
};

/** Declutter caps checked at 1440x900 and larger (docs/declutter-spec.md 7). */
export const REST_LIMITS = { controls: 40, tabStopsBeforeSlot: 10, minFontPx: 12 };

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

/** Is the element inside the viewport? */
function onScreen(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

/** Fully visible: in the viewport and not cut by any scrolling or clipping ancestor. */
export function unclipped(el) {
  if (!onScreen(el)) return false;
  const r = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) continue;
    const pr = p.getBoundingClientRect();
    if (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5 || r.left < pr.left - 0.5 || r.right > pr.right + 0.5) return false;
  }
  return true;
}

/** Painted: visible style, size, and not hidden by an ancestor. */
function painted(el) {
  if (!el?.getClientRects().length) return false;
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=combobox], [role=slider], [role=menuitem], [role=link], [role=option], [tabindex]:not([tabindex="-1"])';

/** Outermost visible interactive elements (the reviewers' "controls at rest"). */
export function visibleControls() {
  const inter = $$(INTERACTIVE).filter(el => !el.disabled && painted(el) && unclippedLoose(el));
  return inter.filter(el => !inter.some(o => o !== el && o.contains(el)));
}

/** Not scrolled away inside a clipping ancestor (partly visible counts). */
function unclippedLoose(el) {
  const r = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) continue;
    const pr = p.getBoundingClientRect();
    if (r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1 || r.right <= pr.left + 1 || r.left >= pr.right - 1) return false;
  }
  return true;
}

/**
 * Tab stops (in DOM order) before the first slot of the slot group. A Fluent arrow-key group (a Tabster mover:
 * toolbars, tab lists) is one stop, as Tab treats it.
 */
export function tabStopsBeforeFirstSlot() {
  const stops = $$('button, a[href], input, select, textarea, [tabindex]').filter(el => {
    if (el.disabled || el.getAttribute('tabindex') === '-1' || el.closest('[inert], [aria-hidden="true"]')) return false;
    return painted(el);
  });
  const i = stops.findIndex(el => el.matches('[data-slot-button]'));
  if (i < 0) return Infinity;
  const groups = new Set();
  let n = 0;
  for (const el of stops.slice(0, i)) {
    const mover = [...ancestors(el)].find(a => /"mover"/.test(a.getAttribute?.('data-tabster') ?? ''));
    if (mover) {
      if (groups.has(mover)) continue;
      groups.add(mover);
    }
    n++;
  }
  return n;
}

function* ancestors(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) yield p;
}

/** Text nodes painted below `px` (outside the chart, whose axis ticks are SVG). */
function smallText(px) {
  const out = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const t = n.textContent.trim();
    const p = n.parentElement;
    if (!t || !p || p.closest('script, style')) continue;
    if (!painted(p) || !unclippedLoose(p)) continue;
    const size = parseFloat(getComputedStyle(p).fontSize);
    if (size < px - 0.01) out.push(`${t.slice(0, 24)} ${size}px`);
  }
  return out;
}

/** [r, g, b, a] of a CSS colour string ("rgb(…)" / "rgba(…)"); null for anything else. */
function parseColor(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [r, g, b, a];
}

/** The colour actually behind an element: every ancestor's background composited over the window's. */
function backgroundBehind(el) {
  const chain = [];
  for (let e = el; e; e = e.parentElement) chain.unshift(e);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  let bg = dark ? [32, 32, 32] : [243, 243, 243];
  for (const e of chain) {
    const c = parseColor(getComputedStyle(e).backgroundColor);
    if (!c || !c[3]) continue;
    bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
  }
  return bg;
}

const luminance = rgb => {
  const [r, g, b] = rgb.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio of an element's text against what is behind it. */
export function textContrast(el) {
  const fg = parseColor(getComputedStyle(el).color);
  if (!fg) return Infinity;
  const [a, b] = [luminance(fg.slice(0, 3)), luminance(backgroundBehind(el))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
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
    search: '[data-testid="gallery-search"]',
    pin: '[data-testid="pin-current"]',
    target: '[data-testid="target-change"]',
    statRow: '[data-testid="stat-row-critChance"]',
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

/**
 * The rest state (docs/declutter-spec.md 7): the weapon stats are first-class (every row and every damage type on
 * screen, unclipped, in the Readout next to the DPS), no gallery cards, few controls and tab stops, no pills, no
 * text under 12 px.
 */
function checkRest(app, errors, checks, full) {
  const rows = $$('[data-testid^="stat-row-"]');
  const types = $$('[data-testid^="stat-type-"]');
  checks.statRows = `${rows.filter(unclipped).length}/${rows.length}`;
  checks.statTypes = `${types.filter(unclipped).length}/${types.length}`;
  if (rows.length !== 11) errors.push(`stats: ${rows.length} stat rows, expected 11`);
  const clipped = [...rows, ...types].filter(el => !unclipped(el)).map(el => el.dataset.testid);
  if (clipped.length) errors.push(`stats: not fully on screen at ${window.innerWidth}x${window.innerHeight}: ${clipped.join(', ')}`);
  const hero = $('[data-testid="avg-dps"]');
  const grid = $('[data-testid="stat-grid"]');
  if (hero && grid) {
    const a = hero.getBoundingClientRect();
    const b = grid.getBoundingClientRect();
    checks.dpsToStats = { dx: Math.round(Math.abs(b.left - a.left)), dy: Math.round(b.top - a.bottom) };
    if (checks.dpsToStats.dx > 40 || checks.dpsToStats.dy > 200) errors.push(`stats: the table is ${checks.dpsToStats.dx} px across and ${checks.dpsToStats.dy} px down from the DPS`);
  }
  checks.galleryCardsAtRest = $$('[data-testid="gallery-card"]').length;
  if (checks.galleryCardsAtRest) errors.push(`rest: ${checks.galleryCardsAtRest} gallery cards on screen while not picking`);
  checks.slotLayout = $('[data-testid="slots"]')?.dataset.layout;
  if (checks.slotLayout !== 'grid') errors.push(`rest: the slots are a ${checks.slotLayout}, not the grid`);
  const controls = visibleControls();
  checks.controlsAtRest = controls.length;
  checks.tabStopsBeforeSlot = tabStopsBeforeFirstSlot();
  checks.badgesAtRest = $$('.fui-Badge').filter(painted).length;
  checks.smallText = smallText(REST_LIMITS.minFontPx);
  checks.scrollRegionsAtRest = $$('[data-scroll-region]').filter(el => painted(el) && el.scrollHeight > el.clientHeight + 2).map(el => el.getAttribute('aria-label') ?? el.dataset.pane ?? el.dataset.testid ?? el.tagName);
  if (checks.badgesAtRest) errors.push(`rest: ${checks.badgesAtRest} tinted badges on screen`);
  // The signed changes (green and red Change cells, the DPS delta) keep 4.5:1 in both themes (WCAG 1.4.3).
  const signed = [
    ...$$('[data-testid="stat-grid"] [role="row"] [role="gridcell"]:last-child').filter(el => el.textContent.trim() && el.textContent.trim() !== '—'),
    ...$$('[data-testid="dps-delta"]'),
  ].filter(painted);
  const low = signed.map(el => ({ el, c: textContrast(el) })).filter(x => x.c < 4.5);
  checks.signedContrast = signed.length ? Math.round(Math.min(...signed.map(textContrast)) * 100) / 100 : null;
  if (low.length) errors.push(`contrast: signed changes under 4.5:1: ${low.map(x => `${x.el.textContent.trim()} ${x.c.toFixed(2)}`).join(', ')}`);
  if (checks.smallText.length) errors.push(`rest: text under ${REST_LIMITS.minFontPx} px: ${checks.smallText.slice(0, 6).join(', ')}`);
  if (full) {
    if (checks.controlsAtRest > REST_LIMITS.controls) errors.push(`rest: ${checks.controlsAtRest} controls on screen (cap ${REST_LIMITS.controls})`);
    if (checks.tabStopsBeforeSlot > REST_LIMITS.tabStopsBeforeSlot) errors.push(`rest: ${checks.tabStopsBeforeSlot} tab stops before the first slot (cap ${REST_LIMITS.tabStopsBeforeSlot})`);
    if (checks.scrollRegionsAtRest.length) errors.push(`rest: regions that scroll at rest: ${checks.scrollRegionsAtRest.join(', ')}`);
  }
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
const search = () => $('[data-testid="gallery-search"]');

/**
 * The Picker: a REAL click on an empty slot opens it (the slots become a strip, the cards appear), a REAL click on a
 * card equips it and moves on to the next empty slot; equipped and blocked cards; smart search; the stats preview;
 * Esc goes back to rest with focus on the slot.
 */
async function checkPicker(app, errors, checks) {
  const { store, actions } = app;
  if ($('[data-testid="mod-picker"]')) errors.push('picker: the old modal mod picker is in the DOM');

  // A real click on an empty slot starts picking for it.
  await realClick(app, $('[data-testid="slot-add-4"]'), errors, 'empty slot 5');
  if (!(await waitFor(() => store.get().pickerOpen && store.get().selectedSlot === 4, 1500))) errors.push(`picker: clicking slot 5 left pickerOpen=${store.get().pickerOpen}, selected ${store.get().selectedSlot}`);
  const cardsShown = await waitFor(() => $$('[data-testid="gallery-card"]').length, 3000);
  checks.pickerCards = cardsShown ?? 0;
  if (!cardsShown) errors.push('picker: no cards rendered after selecting a slot');
  if (checks.pickerCards >= 60) errors.push(`picker: ${checks.pickerCards} cards in the DOM (virtualisation should keep it under 60)`);
  checks.pickerFullCards = $$('[data-testid="gallery-card"]').filter(unclipped).length;
  if (window.outerWidth >= 1440 && window.outerHeight >= 900 && checks.pickerFullCards < 15) errors.push(`picker: only ${checks.pickerFullCards} cards fully visible while picking (want 15 or more)`);
  if ($('[data-testid="slots"]')?.dataset.layout !== 'strip') errors.push('picker: the slots did not become the strip');
  if (!(await waitFor(() => document.activeElement === search(), 1000))) errors.push(`picker: focus is on ${focusId()}, not the search`);
  checks.galleryImages = $$('[data-testid="gallery"] [role="gridcell"] img').length;

  // Equipped mods are hidden by default; with Hide equipped off they show as equipped, and conflicts as blocked.
  typeInto(search(), 'serration');
  const amalgam = await waitFor(() => card('Amalgam Serration'));
  if (card('Serration')) errors.push('picker: the equipped Serration shows although Hide equipped is on by default');
  if (amalgam && (amalgam.dataset.state !== 'blocked' || amalgam.getAttribute('aria-disabled') !== 'true')) errors.push('picker: Amalgam Serration is not blocked');
  if (amalgam && !/conflicts with Serration/i.test(amalgam.getAttribute('aria-label') ?? '')) errors.push('picker: the blocked card does not say why');
  actions.setGallery({ hideEquipped: false });
  const equipped = await waitFor(() => card('Serration'), 1500);
  if (equipped?.dataset.state !== 'equipped') errors.push(`picker: Serration shows as ${equipped?.dataset.state ?? 'missing'}, not equipped`);
  actions.setGallery({ hideEquipped: true });

  // Focusing a card previews it in the stats sheet ("If equipped": Vital Sense raises the crit multiplier).
  typeInto(search(), 'vital sense');
  const cd = await waitFor(() => card('Vital Sense'), 2000);
  cd?.focus();
  // The smoke window may not have OS focus (focus events then wait for it): send the focus event React listens to.
  cd?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  if (!(await waitFor(() => /If equipped/.test($('[data-testid="stat-change-head"]')?.textContent ?? ''), 1500))) errors.push('picker: focusing a card did not turn the Change column into If equipped');
  checks.previewRows = $$('[data-preview]').length;
  checks.previewCells = $$('[data-preview]').map(e => `${e.closest('[role=row]')?.dataset.testid}:${e.dataset.preview}`);
  if (!$('[data-testid="stat-row-critMultiplier"] [data-preview="good"]')) errors.push('picker: the preview does not show Vital Sense raising the crit multiplier');
  cd?.blur();

  // A real click on a card equips it into the selected slot 5, and picking moves on to slot 6.
  typeInto(search(), 'hammer shot');
  const hammer = await waitFor(() => card('Hammer Shot'));
  const count = $('[data-testid="gallery-count"]')?.textContent ?? '';
  checks.galleryCount = count;
  if (!/\d+ mods?/.test(count)) errors.push(`picker: count reads "${count}"`);
  await sleep(150);
  checks.realClick = await realClick(app, hammer, errors, 'card Hammer Shot');
  if (!(await waitFor(() => store.get().build.mods[4]?.name === 'Hammer Shot', 2000))) errors.push(`picker: a real click on Hammer Shot left slot 5 with ${store.get().build.mods[4]?.name ?? 'nothing'}`);
  if (store.get().selectedSlot !== 5 || !store.get().pickerOpen) errors.push(`picker: after filling slot 5 the selection is ${store.get().selectedSlot} (open ${store.get().pickerOpen}), not slot 6`);

  // Select slot 7 with a real click in the strip, then a real click on a card fills it.
  await realClick(app, $('[data-testid="slot-add-6"]'), errors, 'empty slot 7');
  if (!(await waitFor(() => store.get().selectedSlot === 6, 1500))) errors.push(`picker: clicking slot 7 selected ${store.get().selectedSlot}`);
  typeInto(search(), 'vital sense');
  const vital = await waitFor(() => card('Vital Sense'));
  await sleep(150);
  await realClick(app, vital, errors, 'card Vital Sense');
  if (!(await waitFor(() => store.get().build.mods[6]?.name === 'Vital Sense', 2000))) errors.push('picker: Vital Sense did not go into the selected slot 7');
  if (store.get().selectedSlot !== 7) errors.push(`picker: after filling slot 7 the selection is ${store.get().selectedSlot}, not slot 8`);

  // Smart search: operators become tags, did-you-mean.
  typeInto(search(), 'cc drain<=10 ');
  const tag = await waitFor(() => $$('[data-testid="gallery"] .fui-Tag').find(t => /Drain at max rank ≤ 10/.test(t.textContent)), 2000);
  if (!tag) errors.push('picker: "drain<=10" did not become a tag');
  typeInto(search(), 'seration');
  const dym = await waitFor(() => $$('[data-testid="gallery"] button, [data-testid="gallery"] a').find(b => b.textContent.trim() === 'Serration'), 2000);
  if (!dym) errors.push('picker: "seration" offers no "Did you mean Serration"');
  await capture(app.uf, 'picker', errors);

  // Esc in the search: back to rest, the query cleared, focus on the slot the Picker was for (slot 8).
  search().focus();
  key(search(), 'Escape');
  if (!(await waitFor(() => !store.get().pickerOpen, 1000))) errors.push('picker: Esc did not close the Picker');
  if (!(await waitFor(() => focusId() === 'slot-add-7', 1500))) errors.push(`picker: after Esc focus is on ${focusId()}, not slot 8`);
  if (store.get().gallery.query) errors.push('picker: closing kept the search text');
  if ($$('[data-testid="gallery-card"]').length) errors.push('picker: cards are still shown after closing');

  // A real click on a filled slot opens it for a swap; equipping there goes back to rest.
  await realClick(app, $('[data-testid="slot-select-1"]'), errors, 'filled slot 2');
  if (!(await waitFor(() => store.get().pickerOpen && store.get().selectedSlot === 1, 1500))) errors.push('picker: clicking a filled slot did not open the Picker for it');
  typeInto(search(), 'heavy caliber');
  const caliber = await waitFor(() => card('Heavy Caliber'), 2000);
  if (caliber) await realClick(app, caliber, errors, 'card Heavy Caliber');
  if (!(await waitFor(() => !store.get().pickerOpen && store.get().build.mods[1]?.name === 'Heavy Caliber', 2000))) errors.push(`picker: a swap left pickerOpen=${store.get().pickerOpen} with slot 2 = ${store.get().build.mods[1]?.name}`);
  actions.undo();
  log(`picker: ${checks.pickerCards} cards in the DOM, ${checks.pickerFullCards} fully visible, ${checks.galleryImages} images`);
}

/** Capacity meter and slot drain plates. */
function checkCapacity(app, errors, checks) {
  const meter = $('[data-testid="capacity"]');
  if (!meter) { errors.push('capacity: no meter'); return; }
  checks.capacity = `${meter.getAttribute('aria-valuenow')}/${meter.getAttribute('aria-valuemax')}`;
  if (meter.getAttribute('role') !== 'meter') errors.push('capacity: the meter has no meter role');
  if (!$('[data-testid="capacity-menu"]')) errors.push('capacity: no Catalyst and Forma menu');
  const plate = $('[data-testid="slot-drain-0"]');
  if (!plate) errors.push('capacity: slot 1 has no drain plate');
  else if (!['match', 'mismatch', 'neutral'].includes(plate.dataset.match)) errors.push('capacity: the drain plate has no match state');
  checks.slotImage = Boolean($('[data-testid="slot-0"] img'));
}

/** The arcane slot: Ctrl+Shift+9 opens the Picker on Arcanes; a real click on a card equips it and ends picking. */
async function checkArcane(app, errors, checks) {
  const { store } = app;
  key(document, '(', { ctrlKey: true, shiftKey: true, code: 'Digit9' });
  if (!(await waitFor(() => store.get().selectedSlot === ARCANE_SLOT && store.get().gallery.tab === 'arcanes' && store.get().pickerOpen, 1500))) {
    errors.push('arcane: Ctrl+Shift+9 did not open the Picker on Arcanes for the arcane slot');
    app.actions.selectSlot(ARCANE_SLOT);
  }
  const merciless = await waitFor(() => card('Primary Merciless'), 3000);
  await sleep(150);
  await realClick(app, merciless, errors, 'arcane card Primary Merciless');
  if (!(await waitFor(() => store.get().build.arcanes?.[0]?.name === 'Primary Merciless', 2000))) errors.push('arcane: Primary Merciless was not equipped');
  if (store.get().pickerOpen) errors.push('arcane: equipping the arcane did not end picking');
  const before = store.get().sim.summary?.avgDps;
  const after = await app.actions.runNow();
  checks.arcaneDps = after?.avgDps ? Math.round(after.avgDps) : null;
  if (!(after?.avgDps > before)) errors.push(`arcane: DPS did not rise with Primary Merciless (${before} -> ${after?.avgDps})`);
  if (!$('[data-testid="slot-arcane"] [data-testid="slot-arcane-select"]')) errors.push('arcane: the arcane slot shows no equipped arcane');
  app.actions.setGalleryTab('mods');
  log(`arcane equipped: ${checks.arcaneDps} DPS`);
}

/**
 * Keyboard flow: Ctrl+6 opens the Picker for slot 6 with focus in the search, Enter equips the first result, Del
 * removes, Ctrl+Z / Ctrl+Y undo and redo, the stats grid roves and searches, Ctrl+T and Ctrl+J open the target and
 * Compare, F6 cycles the panes.
 */
async function checkKeyboard(app, errors, checks) {
  const { store, actions } = app;
  const slot = 5;
  key(document, '6', { ctrlKey: true, code: 'Digit6' });
  const input = await waitFor(() => (document.activeElement?.dataset?.testid === 'gallery-search' ? document.activeElement : null), 1500);
  if (!input) { errors.push(`keyboard: Ctrl+6 did not focus the Picker search (focus on ${focusId()})`); return; }
  if (store.get().selectedSlot !== slot || !store.get().pickerOpen) errors.push(`keyboard: Ctrl+6 selected ${store.get().selectedSlot}, open ${store.get().pickerOpen}`);
  typeInto(input, 'stormbringer');
  await waitFor(() => card('Stormbringer'));
  key(input, 'ArrowDown');
  const first = await waitFor(() => (document.activeElement?.dataset?.testid === 'gallery-card' ? document.activeElement : null), 1000);
  if (!first) errors.push('keyboard: Down from the search did not focus the first card');
  else {
    key(first, 'Enter', { altKey: true });
    if (!(await waitFor(() => $('[data-testid="mod-flyout"]'), 1500))) errors.push('keyboard: Alt+Enter did not open the details flyout');
    key(first, 'Escape');
    await waitFor(() => !$('[data-testid="mod-flyout"]'), 1000);
    if ($('[data-testid="mod-flyout"]')) errors.push('keyboard: Esc did not close the flyout');
    if (document.activeElement !== first) errors.push('keyboard: closing the flyout moved focus');
    key(first, 'ArrowUp');
    if (!(await waitFor(() => document.activeElement === input, 1000))) errors.push('keyboard: Up on the first row did not return to the search');
  }
  key(input, 'Enter');
  if (!(await waitFor(() => store.get().build.mods[slot]?.name === 'Stormbringer', 1500))) errors.push(`keyboard: slot 6 holds ${store.get().build.mods[slot]?.name ?? 'nothing'} after Enter`);
  actions.closePicker({ focus: false });
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
  key(document.body, 'z', { ctrlKey: true });
  await waitFor(() => store.get().build.mods[slot], 1000);

  // Arrow keys move between the slot buttons (one group).
  const s0 = $('[data-focus-id="slot-select-0"]');
  s0?.focus();
  key(s0, 'ArrowRight');
  const moved = await waitFor(() => (focusId() === 'slot-select-1' || focusId() === 'slot-add-1' ? focusId() : null), 1000);
  checks.slotArrows = Boolean(moved);
  if (!moved) errors.push(`keyboard: ArrowRight on slot 1 moved focus to ${focusId()}`);

  // Space on a filled slot picks its card up; ArrowRight carries it to the next slot and Space drops it (a swap).
  const names = () => [store.get().build.mods[0]?.name, store.get().build.mods[1]?.name];
  const before = names();
  const first0 = $('[data-focus-id="slot-select-0"]');
  first0?.focus();
  key(first0, ' ');
  if (!store.get().pickup) errors.push('keyboard: Space on a filled slot did not pick its card up');
  else {
    key(document.activeElement, 'ArrowRight');
    await waitFor(() => focusId() === 'slot-select-1', 1000);
    key(document.activeElement, ' ');
    const swapped = await waitFor(() => names()[0] === before[1] && names()[1] === before[0], 1500);
    checks.spacePickup = Boolean(swapped);
    if (!swapped) errors.push(`keyboard: Space, ArrowRight, Space did not swap slots 1 and 2 (${names().join(' | ')})`);
    else actions.undo();
  }
  if (store.get().pickup) actions.cancelPickup();

  // Real Tab presses from the build name reach the slots, even after the arcane's stacks button had focus.
  $('[data-testid="arcane-stacks"]')?.focus();
  await nextFrame();
  $('#build-name')?.focus();
  const tabPath = [];
  let reached = false;
  if (await app.uf.smokePress?.('Tab')) {
    for (let i = 0; i < 16 && !reached; i++) {
      if (i) await app.uf.smokePress('Tab');
      // Tabster's dummy stops hand focus on within a frame or two: wait for the real stop.
      await waitFor(() => document.activeElement && document.activeElement !== document.body && !document.activeElement.hasAttribute('data-tabster-dummy'), 300);
      await nextFrame();
      tabPath.push(document.activeElement?.dataset?.focusId ?? document.activeElement?.dataset?.testid ?? document.activeElement?.tagName);
      reached = Boolean(document.activeElement?.matches?.('[data-slot-button]'));
    }
    checks.realTabToSlot = reached ? tabPath.length : 'not reached';
    checks.realTabPath = tabPath.join(' > ');
    if (!reached) errors.push(`keyboard: real Tab presses from the build name never reach a slot (${tabPath.join(' > ')})`);
  }

  // The stats grid: one tab stop, Down moves to the next row, Enter opens the Picker searching that stat.
  const firstRow = $('[data-testid="stat-filter-dmg"]');
  firstRow?.focus();
  key(firstRow, 'ArrowDown');
  if (!(await waitFor(() => document.activeElement?.dataset?.testid === 'stat-filter-cc', 800))) errors.push(`keyboard: Down in the stats grid went to ${document.activeElement?.dataset?.testid}`);
  key(document.activeElement, 'Enter');
  if (!(await waitFor(() => store.get().pickerOpen && store.get().gallery.query === 'cc', 1500))) errors.push(`keyboard: Enter on Crit chance did not search "cc" (query "${store.get().gallery.query}")`);
  // Esc in the search goes back to the stat row that opened the Picker.
  const box = await waitFor(() => (document.activeElement === search() ? search() : null), 1000);
  key(box ?? search(), 'Escape');
  if (!(await waitFor(() => !store.get().pickerOpen, 1000))) errors.push('keyboard: Esc after a stat row did not close the Picker');
  if (!(await waitFor(() => document.activeElement?.dataset?.testid === 'stat-filter-cc', 1500))) errors.push(`keyboard: after Esc focus is on ${document.activeElement?.dataset?.testid ?? focusId()}, not the Crit chance row that opened the Picker`);
  actions.closePicker({ focus: false });

  // Ctrl+T opens the target popover; Esc closes it.
  key(document.body, 't', { ctrlKey: true });
  if (!(await waitFor(() => $('[data-testid="target-card"]'), 1500))) errors.push('keyboard: Ctrl+T did not open the target popover');
  actions.setTargetOpen(false);
  await waitFor(() => !$('[data-testid="target-card"]'), 1000);

  // F6 cycles the panes: (builds ->) top bar -> loadout -> picker -> readout.
  $('[data-focus-id="slot-select-0"]')?.focus();
  const paneOf = () => document.activeElement?.closest?.('[data-pane]')?.dataset.pane ?? 'none';
  const panes = [];
  for (let i = 0; i < 5; i++) {
    key(document.activeElement ?? document, 'F6');
    await nextFrame();
    panes.push(paneOf());
  }
  checks.f6 = panes;
  const order = ['builds', 'topbar', 'loadout', 'picker', 'readout'].filter(p => document.querySelector(`[data-pane="${p}"]`)?.getClientRects().length);
  const n = order.length;
  const expected = order.map((_, start) => Array.from({ length: 5 }, (__, k) => order[(start + k) % n]).join(' '));
  if (!expected.includes(panes.join(' '))) errors.push(`keyboard: F6 visited ${panes.join(' ')}`);
  checks.keyboard = true;
  log('keyboard flow done');
}

/** Compare: Pin in the Readout, Ctrl+J opens the full table, a row per pin. */
async function checkCompare(app, errors, checks) {
  const { store, actions } = app;
  await actions.runNow();
  await waitFor(() => store.get().sim.status === 'done', 8000);
  await realClick(app, $('[data-testid="pin-current"]'), errors, 'Pin');
  if (!(await waitFor(() => store.get().pins.length >= 1, 2000))) errors.push('compare: a real click on Pin pinned nothing');
  checks.compareRows = await waitFor(() => $$('[data-testid="compare-row"]').length, 1500) ?? 0;
  if (!checks.compareRows) errors.push('compare: the pin is not listed in the Readout');
  if ($$('[data-testid="toast"]').some(t => /Pinned/.test(t.textContent))) errors.push('compare: pinning raised a toast over the Readout');
  const pinsBefore = store.get().pins.length;
  actions.pinResult();
  if (store.get().pins.length !== pinsBefore) errors.push('compare: pinning the same unchanged result twice added a second pin');
  key(document.body, 'j', { ctrlKey: true });
  if (!(await waitFor(() => $('[data-testid="compare-grid"]'), 2000))) errors.push('compare: Ctrl+J did not open the Compare table');
  actions.setCompareOpen(false);
  await waitFor(() => !$('[data-testid="compare-grid"]'), 1500);
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
    if (!store.get().pickerOpen) errors.push('a new, empty build did not open picking');
    actions.setWeapon(SMOKE_PLAN.weapon);
    SMOKE_PLAN.mods.forEach(([name, rank], slot) => {
      if (!actions.equipMod(slot, name, rank, { focus: false })) errors.push(`could not equip ${name}`);
    });
    const preset = resolvePresetName(store.get().ctx, SMOKE_PLAN.target);
    if (!preset) errors.push(`target preset not found: ${SMOKE_PLAN.target}`);
    else actions.setTarget({ preset });
    actions.closePicker({ focus: false });

    const simStart = performance.now();
    summary = await actions.runNow();
    timings.simMs = Math.round(performance.now() - simStart);
    await waitFor(() => store.get().sim.status === 'done', 10000);
    await nextFrame();
    document.activeElement?.blur?.();

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
    await sleep(300);
    // The Loadout | Readout layout at rest (docs/declutter-spec.md 7).
    checks.viewport = `${window.innerWidth}x${window.innerHeight}`;
    const full = window.outerWidth >= 1440 && window.outerHeight >= 900;
    checks.chartOnScreen = onScreen($('[data-testid="health-chart"]'));
    checks.resultCardOnScreen = onScreen($('[data-testid="result-card"]'));
    checks.slotsOnScreen = [0, 1, 2, 3, 4, 5, 6, 7, 8].every(i => onScreen($(`[data-testid="slot-${i}"]`))) && onScreen($('[data-testid="slot-arcane"]'));
    checks.capacityOnScreen = onScreen($('[data-testid="capacity"]'));
    checks.creditOnScreen = unclipped($('[data-testid="credit"]'));
    if (!checks.resultCardOnScreen) errors.push('the DPS and time to kill are not fully on screen');
    if (full && !checks.chartOnScreen) errors.push(`the health chart is not on screen at ${checks.viewport}`);
    if (full && !checks.slotsOnScreen) errors.push(`not all 9 mod slots and the arcane slot are on screen at ${checks.viewport}`);
    if (full && !checks.capacityOnScreen) errors.push(`the capacity meter is not on screen at ${checks.viewport}`);
    if (!checks.creditOnScreen) errors.push('the credit line is not on screen');
    if ($('footer')) errors.push('a status bar footer is still rendered');
    checkRest(app, errors, checks, full);
    checkPointerReach(errors, checks);
    checkCapacity(app, errors, checks);
    log(`simulated ${summary?.avgDps?.toFixed?.(1)} DPS (stat rows ${checks.statRows}, ${checks.controlsAtRest} controls, ${checks.tabStopsBeforeSlot} tab stops before the first slot)`);
    // Typography and pointer targets (UX spec 3.3, WCAG 2.5.8).
    const font = getComputedStyle($('[data-testid="avg-dps"]')).fontFamily;
    const bodyFont = getComputedStyle($('[data-testid="slot-select-0"]') ?? document.body).fontFamily;
    checks.kpiFont = font.split(',')[0].replace(/"/g, '');
    checks.bodyFont = bodyFont.split(',')[0].replace(/"/g, '');
    if (!/^Segoe UI Variable/.test(checks.bodyFont)) errors.push(`body text font is ${bodyFont}`);
    checks.kpiTabular = getComputedStyle($('[data-testid="avg-dps"]')).fontVariantNumeric.includes('tabular-nums');
    if (!checks.kpiTabular) errors.push('the Average DPS value does not use tabular numerals');
    const small = [];
    // Links inside a sentence (the credit) are exempt (WCAG 2.5.8, inline).
    for (const el of $$('[data-testid^="slot-"] button, [data-testid="gallery-card"], [data-pane="topbar"] button, [data-testid="readout"] button').filter(b => !b.closest('[data-testid="credit"]'))) {
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

    await checkPicker(app, errors, checks);
    await checkArcane(app, errors, checks);
    await checkKeyboard(app, errors, checks);
    await checkCompare(app, errors, checks);
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
