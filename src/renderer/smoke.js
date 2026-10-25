// Scripted end-to-end check (UF_SMOKE=1) against the real UI. Reports via uf.smokeResult with the same
// shape as before: { ok, weapon, target, avgDps, ttk, runs, checks, errors, timings }.
// Besides the flows (real clicks through the Picker, keyboard, OCR, save), it checks the declutter targets of
// docs/declutter-spec.md 7: every weapon stat row on screen and unclipped, the controls at rest under a cap, few
// tab stops before the first slot, no gallery at rest, no tinted pills, no text under 12 px.
import { ARCANE_SLOT, buildCapacity, resolvePresetName, ttkText } from './model.js';
import { clearToasts } from './controller.js';
import * as O from './ocr-import.js';
import * as AS from '../shared/auto-build-settings.js';

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
 * Conditional mod stacks: Galvanized Scope in slot 7 starts at max stacks ("×5"); a real click on the chip opens its
 * popover, 0 stacks lowers the DPS and the chip says "×0"; Esc closes it; the slot menu's Stacks… opens it again.
 * The slot is cleared afterwards.
 */
async function checkModStacks(app, errors, checks) {
  const { store, actions, uf } = app;
  const slot = 6;
  const current = () => {
    const s = store.get();
    return s.sim.status === 'done' && s.sim.key === app.simKey() && s.sim.summary?.ok ? s.sim.summary.avgDps : null;
  };
  if (!actions.equipMod(slot, 'Galvanized Scope', 10, { focus: false, quiet: true })) { errors.push('stacks: Galvanized Scope could not be equipped'); return; }
  await actions.runNow();
  const full = await waitFor(current, 15000);
  const chip = await waitFor(() => $(`[data-testid="slot-stacks-${slot}"]`), 2000);
  checks.stacksChip = chip?.textContent ?? null;
  if (chip?.textContent !== '×5') errors.push(`stacks: the chip reads "${chip?.textContent ?? 'nothing'}", expected "×5"`);
  if (!(await realClick(app, chip, errors, 'stacks chip'))) return;
  const popover = await waitFor(() => $('[data-testid="mod-stacks-popover"]'), 2000);
  if (!popover) { errors.push('stacks: a real click on the chip did not open its popover'); return; }
  const input = popover.querySelector('input');
  if (!(await waitFor(() => popover.contains(document.activeElement), 1500))) errors.push(`stacks: focus did not move into the popover (${testIdOfFocus()})`);
  await sleep(250);
  await capture(uf, 'mod-stacks', errors);
  input?.focus();
  input?.select();
  typeInto(input, '0');
  await uf.smokePress('Enter');
  if (!(await waitFor(() => store.get().build.mods[slot]?.stacks === 0, 2000))) errors.push(`stacks: typing 0 left the slot at ${JSON.stringify(store.get().build.mods[slot])}`);
  await actions.runNow();
  const none = await waitFor(current, 15000);
  checks.stacksDps = full && none ? `${Math.round(full)} at 5 stacks, ${Math.round(none)} at 0` : null;
  if (!(none < full)) errors.push(`stacks: 0 stacks did not lower the DPS (${full} -> ${none})`);
  if ($(`[data-testid="slot-stacks-${slot}"]`)?.textContent !== '×0') errors.push(`stacks: the chip reads "${$(`[data-testid="slot-stacks-${slot}"]`)?.textContent}" at 0 stacks`);
  await uf.smokePress('Escape');
  if (!(await waitFor(() => !$('[data-testid="mod-stacks-popover"]'), 1500))) errors.push('stacks: Esc did not close the popover');
  // The keyboard route: the slot menu (Shift+F10) has Stacks….
  $(`[data-testid="slot-select-${slot}"]`)?.focus();
  await uf.smokePress('F10', ['shift']);
  const item = await waitFor(() => $$('[role="menuitem"]').find(m => /^Stacks \(0 stacks\)/.test(m.textContent)), 2000);
  if (!item) errors.push('stacks: the slot menu has no "Stacks (0 stacks)…" item');
  else {
    item.focus();
    await uf.smokePress('Enter');
    if (!(await waitFor(() => $('[data-testid="mod-stacks-popover"]'), 2000))) errors.push('stacks: Stacks… in the slot menu did not open the popover');
    await uf.smokePress('Escape');
    await waitFor(() => !$('[data-testid="mod-stacks-popover"]'), 1500);
  }
  actions.clearSlot(slot, { focus: false });
  await actions.runNow();
  log(`stacks: ${checks.stacksDps}`);
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
    for (let i = 0; i < 20 && !reached; i++) {
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

/** Pointer targets under 24x24 inside an element (buttons, tabs, comboboxes, links), as "name WxH". */
function smallTargetsIn(root) {
  const out = [];
  for (const el of root?.querySelectorAll('button, [role="tab"], [role="combobox"], a[href]') ?? []) {
    if (!painted(el) || el.closest('[data-inline-link]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && (r.width < 24 || r.height < 24)) out.push(`${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
}

/** Regions inside an element that scroll (content taller than the box with overflow auto or scroll). */
function scrollRegionsIn(root) {
  const all = [root, ...(root?.querySelectorAll('*') ?? [])].filter(Boolean);
  return all.filter(el => {
    const o = getComputedStyle(el).overflowY;
    return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 2 && painted(el);
  }).map(el => el.dataset.testid ?? el.getAttribute('aria-label') ?? String(el.className).split(' ')[0]);
}

/** A dialog's pointer targets and scroll regions (docs/declutter-spec.md 3 and 8): 24 px targets, one scroller. */
async function checkDialogLayout(dialog, what, errors, checks) {
  // Measure the settled dialog: its open animation scales the surface for a moment.
  await waitFor(() => !dialog.getAnimations({ subtree: true }).some(x => x.playState === 'running'), 3000);
  const small = smallTargetsIn(dialog);
  const scrolls = scrollRegionsIn(dialog);
  checks[`${what}SmallTargets`] = small;
  checks[`${what}ScrollRegions`] = scrolls.length;
  if (small.length) errors.push(`${what}: pointer targets under 24x24 in the dialog: ${small.join(', ')}`);
  if (scrolls.length > 1) errors.push(`${what}: ${scrolls.length} scroll regions in the dialog (at most 1): ${scrolls.join(', ')}`);
}

const testIdOfFocus = () => document.activeElement?.dataset?.testid ?? document.activeElement?.id ?? document.activeElement?.tagName;

/**
 * External buffs (docs/port-external-buffs.md) with REAL clicks: Buffs in the Readout opens the dialog with focus in
 * the buff search; choose External Fire Rate, type 60, Add: the DPS rises and the footer says so; remove it with the
 * keyboard (focus stays in the list): the DPS is back to the same number; a real Ctrl+Z and Ctrl+Y while the dialog
 * is open; add Viral x10 on the target; Remove all, then its inline Undo; Close: the Readout's summary line (its name
 * starts with its text) and the hero caption say so, and Edit reopens. Cleared afterwards.
 */
async function checkBuffs(app, errors, checks) {
  const { store, actions, uf } = app;
  const current = () => {
    const s = store.get();
    return s.sim.status === 'done' && s.sim.key === app.simKey() && s.sim.summary?.ok ? s.sim.summary.avgDps : null;
  };
  const settledDps = () => waitFor(current, 15000);
  await actions.runNow();
  const base = await settledDps();
  if (!base) { errors.push('buffs: no baseline result'); return; }
  if (!(await realClick(app, $('[data-testid="buffs-open"]'), errors, 'Buffs link'))) return;
  const dialog = await waitFor(() => $('[data-testid="buffs-dialog"]'), 2000);
  if (!dialog) { errors.push('buffs: a real click on Buffs did not open the dialog'); return; }
  if (!/No external statuses configured\./.test(dialog.textContent)) errors.push('buffs: the empty statuses text is missing');
  const combo = $('[data-testid="buff-type"]');
  checks.buffsFocusOnOpen = await waitFor(() => (document.activeElement === combo ? 'buff-type' : null), 1500) ?? testIdOfFocus();
  if (checks.buffsFocusOnOpen !== 'buff-type') errors.push(`buffs: the dialog opened with focus on ${checks.buffsFocusOnOpen}, not the buff search`);
  if (document.getElementById(dialog.getAttribute('aria-describedby') ?? '') == null) errors.push('buffs: the dialog\'s aria-describedby points at nothing');
  await realClick(app, combo, errors, 'buff type combobox');
  typeInto(combo, 'External Fire Rate');
  const option = await waitFor(() => $$('[role="option"]').find(o => o.textContent.startsWith('External Fire Rate')), 2000);
  if (!option) { errors.push('buffs: searching "External Fire Rate" shows no option'); return; }
  await realClick(app, option, errors, 'External Fire Rate option');
  const value = await waitFor(() => $('[data-testid="buff-value"]'), 1500);
  if (!value) { errors.push('buffs: no value field for External Fire Rate'); return; }
  await realClick(app, value, errors, 'buff value');
  typeInto(value, '60');
  await realClick(app, $('[data-testid="buff-add"]'), errors, 'Add buff');
  const row = await waitFor(() => $('[data-testid="buff-row"]'), 2000);
  checks.buffLine = row?.textContent ?? null;
  if (!/External Fire Rate · \+60%/.test(row?.textContent ?? '')) errors.push(`buffs: the list shows "${row?.textContent ?? 'nothing'}", expected "External Fire Rate · +60%"`);
  const raised = await settledDps();
  checks.buffDps = raised ? `${Math.round(base)} -> ${Math.round(raised)}` : null;
  if (!(raised > base * 1.2)) errors.push(`buffs: External Fire Rate 60% did not raise the DPS (${base} -> ${raised})`);
  // The dialog covers the hero: its footer shows the change.
  const footer = await waitFor(() => (/→/.test($('[data-testid="buffs-dps"]')?.textContent ?? '') ? $('[data-testid="buffs-dps"]') : null), 2000);
  checks.buffsFooter = footer?.textContent ?? null;
  if (!footer || !footer.querySelector('[data-testid="dps-delta"]')) errors.push(`buffs: the footer does not show the DPS change ("${$('[data-testid="buffs-dps"]')?.textContent ?? 'nothing'}")`);
  await checkDialogLayout(dialog, 'buffs', errors, checks);
  // Remove with the keyboard (Space on the button): focus stays in the dialog (the list heading once it is empty).
  $('[data-testid="buff-remove"]')?.focus();
  await uf.smokePress('Space');
  if (!(await waitFor(() => !store.get().build.externalBuffs?.length, 2000))) errors.push('buffs: Enter on the remove button kept the buff');
  const afterRemove = await waitFor(() => (document.activeElement && document.activeElement !== document.body ? testIdOfFocus() : null), 1500);
  checks.buffsFocusAfterRemove = afterRemove ?? 'BODY';
  if (!dialog.contains(document.activeElement)) errors.push(`buffs: removing a row moved focus to ${checks.buffsFocusAfterRemove}, outside the dialog`);
  const back = await settledDps();
  if (back !== base) errors.push(`buffs: removing the buff did not bring the DPS back (${base} -> ${back})`);
  // A real Ctrl+Z and Ctrl+Y reach the build while the dialog is open (focus on a button, not a text field).
  $('[data-testid="buffs-close"]')?.focus();
  await uf.smokePress('z', ['control']);
  if (!(await waitFor(() => store.get().build.externalBuffs?.length === 1, 2000))) errors.push('buffs: Ctrl+Z in the dialog did not bring the removed buff back');
  await uf.smokePress('y', ['control']);
  if (!(await waitFor(() => !store.get().build.externalBuffs?.length, 2000))) errors.push('buffs: Ctrl+Y in the dialog did not remove it again');
  await settledDps();
  await realClick(app, $('[data-testid="status-add"]'), errors, 'Add status');
  const status = await waitFor(() => $('[data-testid="status-row"]'), 2000);
  if (!/Viral ×10/.test(status?.textContent ?? '')) errors.push(`buffs: the status list shows "${status?.textContent ?? 'nothing'}", expected "Viral ×10"`);
  const viral = await settledDps();
  checks.statusDps = viral ? `${Math.round(base)} -> ${Math.round(viral)}` : null;
  if (!(viral > base * 1.5)) errors.push(`buffs: Viral x10 on the target did not raise the DPS (${base} -> ${viral})`);
  await capture(app.uf, 'buffs-dialog', errors);
  // Remove all, then its inline Undo (focus moves to it).
  await realClick(app, $('[data-testid="buffs-clear"]'), errors, 'Remove all');
  const undo = await waitFor(() => $('[data-testid="buffs-undo-clear"]'), 2000);
  if (!undo) errors.push('buffs: Remove all shows no inline Undo');
  else {
    if (!/Removed 1 status\./.test($('[data-testid="buffs-cleared"]')?.textContent ?? '')) errors.push(`buffs: Remove all says "${$('[data-testid="buffs-cleared"]')?.textContent}"`);
    if (!(await waitFor(() => document.activeElement === undo, 1500))) errors.push(`buffs: after Remove all focus is on ${testIdOfFocus()}, not Undo`);
    await realClick(app, undo, errors, 'Undo Remove all');
    if (!(await waitFor(() => store.get().build.externalStatuses?.length === 1, 2000))) errors.push('buffs: the inline Undo did not restore the status');
  }
  await settledDps();
  await realClick(app, $('[data-testid="buffs-close"]'), errors, 'Close buffs');
  await waitFor(() => !$('[data-testid="buffs-dialog"]'), 2000);
  await nextFrame();
  await nextFrame();
  if ($('[data-testid="buffs-dialog"]')) errors.push('buffs: Close did not close the dialog');
  const summary = await waitFor(() => $('[data-testid="buffs-summary"]'), 1500);
  checks.buffsSummary = summary?.textContent ?? null;
  if (summary?.textContent !== 'Statuses: 1') errors.push(`buffs: the Readout summary says "${summary?.textContent ?? 'nothing'}", expected "Statuses: 1"`);
  if (summary && !String(summary.getAttribute('aria-label') ?? '').startsWith(summary.textContent)) errors.push(`buffs: the summary's name "${summary.getAttribute('aria-label')}" does not start with its text`);
  checks.heroCaption = $('[data-testid="avg-dps-label"]')?.textContent ?? null;
  if (!/with target statuses/.test(checks.heroCaption ?? '')) errors.push(`buffs: the hero caption says "${checks.heroCaption}", not that statuses are applied`);
  if ($('[data-testid="buffs-open"]')) errors.push('buffs: both the Buffs link and the summary are shown');
  if (document.activeElement !== summary) errors.push(`buffs: closing the dialog left focus on ${focusId()}, not the summary link`);
  await realClick(app, summary, errors, 'buffs summary');
  if (!(await waitFor(() => $('[data-testid="buffs-dialog"]'), 2000))) errors.push('buffs: the summary link did not reopen the dialog');
  actions.clearExternal();
  actions.setBuffsOpen(false);
  await waitFor(() => !$('[data-testid="buffs-dialog"]'), 2000);
  await settledDps();
  if (/with/.test($('[data-testid="avg-dps-label"]')?.textContent ?? '')) errors.push('buffs: the hero caption still mentions external buffs after clearing them');
  log(`buffs: ${checks.buffDps} with fire rate, ${checks.statusDps} with Viral x10`);
}

/**
 * Auto build (docs/port-auto-build.md) with REAL clicks on an empty Braton Prime: the Loadout's Auto build button opens
 * the dialog with focus on Run; the Mods tab's search blacklists Serration (its card chip appears first, focus stays in
 * the search), Delete on a chip moves focus to the next chip; Run with a short budget (smallest sample size, no
 * refinement, 30 s limit; "Your Config" has Cost Control on): focus moves to Cancel, then to Apply; the result never
 * holds Serration, shows the changes as cards and fits the capacity with the Forma it lists; Apply fills the build and
 * its Forma (one undo step) and the Readout's DPS is the result's; on the now complete build Run is disabled; a real
 * Ctrl+Z restores the empty build. Then a long run (the Default config) is cancelled mid-way: nothing changes and focus
 * returns to Run. Close returns focus to the button.
 */
async function checkAutoBuild(app, errors, checks) {
  const { store, actions, uf } = app;
  const settled = () => waitFor(() => {
    const s = store.get();
    return s.sim.status === 'done' && s.sim.key === app.simKey() && s.sim.summary?.ok ? s.sim.summary.avgDps : null;
  }, 15000);
  await actions.newBuild({ force: true });
  actions.closePicker({ focus: false });
  await actions.runNow();
  const emptyDps = await settled();
  const emptyBuild = () => JSON.stringify({ mods: store.get().build.mods, pol: store.get().build.slotPolarities });
  const empty = emptyBuild();
  if (!emptyDps) { errors.push('auto build: no result for the empty build'); return; }
  if (!(await realClick(app, $('[data-testid="auto-build-open"]'), errors, 'Auto build button'))) return;
  const dialog = await waitFor(() => $('[data-testid="auto-build-dialog"]'), 2000);
  if (!dialog) { errors.push('auto build: a real click on the button did not open the dialog'); return; }
  if (AS.activeConfig(store.get().autoBuildLibrary).id !== AS.YOUR_CONFIG_ID) errors.push('auto build: "Your Config" is not the active config at first');
  if (!AS.effectiveSettings(store.get().autoBuildLibrary).costControlEnabled) errors.push('auto build: "Your Config" does not start with Cost Control on');
  checks.autoBuildFocusOnOpen = await waitFor(() => (testIdOfFocus() === 'auto-build-run' ? 'auto-build-run' : null), 1500) ?? testIdOfFocus();
  if (checks.autoBuildFocusOnOpen !== 'auto-build-run') errors.push(`auto build: the dialog opened with focus on ${checks.autoBuildFocusOnOpen}, not Run`);
  if (document.getElementById(dialog.getAttribute('aria-describedby') ?? '') == null) errors.push('auto build: the dialog\'s aria-describedby points at nothing');
  // A short budget, as the Search tab sets it.
  actions.updateAutoBuildSettings({ sampleSizeMultiplier: 0.2, finalRefinementEnabled: false, timeLimitSeconds: 30 });

  // Blacklist Serration through the smart search, with real clicks.
  await realClick(app, $('[data-testid="auto-build-tab-mods"]'), errors, 'Mods tab');
  const box = await waitFor(() => $('[data-testid="auto-build-blacklist-search"]'), 2000);
  if (!box) { errors.push('auto build: no blacklist search box'); return; }
  checks.blacklistCount = $('[data-testid="auto-build-blacklist-count"]')?.textContent ?? null;
  checks.blacklistChipsShown = $$('[data-testid="auto-build-blacklist-item"]').length;
  if (checks.blacklistChipsShown > 12) errors.push(`auto build: the blacklist shows ${checks.blacklistChipsShown} chips at first (3 rows expected)`);
  // The chip grid is one tab stop: a real Tab from its first chip leaves the grid (arrow keys move inside it).
  const firstRemove = $('[data-testid="auto-build-blacklist-remove"]');
  if (firstRemove) {
    // A real click first, so the window has keyboard focus for the real key presses that follow.
    await realClick(app, box, errors, 'blacklist search');
    // The click is delivered asynchronously: wait for it to land before moving focus, or it takes focus back.
    await waitFor(() => document.activeElement === box || box.contains(document.activeElement), 1000);
    await nextFrame();
    firstRemove.focus();
    await nextFrame();
    await uf.smokePress('Right');
    await nextFrame();
    const second = await waitFor(() => (document.activeElement !== firstRemove && document.activeElement?.dataset?.testid === 'auto-build-blacklist-remove' ? document.activeElement : null), 1000);
    if (!second) errors.push(`auto build: the arrow keys do not move between blacklist chips (window focused: ${document.hasFocus()}, focus on ${document.activeElement === firstRemove ? 'the first chip' : testIdOfFocus() ?? document.activeElement?.tagName})`);
    await uf.smokePress('Tab');
    await nextFrame();
    checks.blacklistTabLeavesGrid = !document.activeElement?.closest?.('[data-testid="auto-build-blacklist-item"]');
    if (!checks.blacklistTabLeavesGrid) errors.push('auto build: Tab moves from chip to chip in the blacklist (it should leave the list)');
  }
  await checkDialogLayout(dialog, 'autoBuildMods', errors, checks);
  await realClick(app, box, errors, 'blacklist search');
  typeInto(box, 'serration');
  const add = await waitFor(() => $('[data-testid="auto-build-blacklist-add"][data-name="Serration"]'), 2000);
  if (!add) { errors.push('auto build: searching "serration" offers no Serration card'); return; }
  await realClick(app, add, errors, 'add Serration');
  if (!(await waitFor(() => AS.effectiveSettings(store.get().autoBuildLibrary).modBlacklist.includes('Serration'), 2000))) errors.push('auto build: Serration is not in the blacklist after the click');
  if (!(await waitFor(() => document.activeElement === box, 1500))) errors.push(`auto build: after adding from the search focus is on ${testIdOfFocus()}, not the search box`);
  if (!(await waitFor(() => $('[data-testid="auto-build-blacklist-listed"][data-name="Serration"]'), 1500))) errors.push('auto build: the search does not say Serration is already in the blacklist');
  typeInto(box, '');
  const chip = await waitFor(() => $('[data-testid="auto-build-blacklist-item"][data-name="Serration"]'), 2000);
  if (!chip) errors.push('auto build: the blacklist shows no Serration card');
  else if (store.get().cards?.available && !(await waitFor(() => chip.querySelector('img'), 2000))) errors.push('auto build: the Serration chip has no card image');
  await capture(uf, 'auto-build-blacklist', errors);
  // Delete on a chip removes it and moves focus to the next chip.
  if (chip) {
    const next = chip.nextElementSibling?.dataset?.name;
    chip.querySelector('[data-testid="auto-build-blacklist-remove"]')?.focus();
    await uf.smokePress('Delete');
    if (!(await waitFor(() => !AS.effectiveSettings(store.get().autoBuildLibrary).modBlacklist.includes('Serration'), 2000))) errors.push('auto build: Delete on the Serration chip did not remove it');
    const moved = await waitFor(() => document.activeElement?.closest?.('[data-testid="auto-build-blacklist-item"]')?.dataset?.name, 1500);
    checks.focusAfterChipDelete = moved ?? testIdOfFocus();
    if (!moved || (next && moved !== next)) errors.push(`auto build: after deleting a chip focus is on ${checks.focusAfterChipDelete}, not the next chip (${next})`);
    actions.updateAutoBuildSettings({ modBlacklist: [...AS.effectiveSettings(store.get().autoBuildLibrary).modBlacklist, 'Serration'] });
  }

  // Run: focus moves to Cancel while it runs, then to Apply.
  const started = performance.now();
  let cancelFocused = false;
  await realClick(app, $('[data-testid="auto-build-run"]'), errors, 'Run');
  if (!(await waitFor(() => store.get().autoBuild, 2000))) { errors.push('auto build: Run did not start a run'); return; }
  const end = await waitFor(() => {
    if (testIdOfFocus() === 'auto-build-cancel') cancelFocused = true;
    return ['done', 'error', 'cancelled'].includes(store.get().autoBuild?.status) ? store.get().autoBuild : null;
  }, 60000);
  if (end?.status !== 'done') { errors.push(`auto build: the run ended as ${end?.status ?? 'nothing'}${end?.error ? `: ${end.error}` : ''}`); return; }
  if (!cancelFocused) errors.push('auto build: focus never moved to Cancel while the run went on');
  const r = end.result;
  checks.autoBuild = {
    ms: Math.round(performance.now() - started), runs: r.runs, cores: r.cores, stoppedEarly: r.stoppedEarly,
    dps: `${Math.round(r.before)} -> ${Math.round(r.after)}`, mods: r.mods.filter(Boolean).map(m => m.name).join(', '), arcane: r.arcanes?.[0]?.name ?? null,
    forma: r.formaPlan?.length ?? 0,
  };
  checks.autoBuildFocusOnResult = await waitFor(() => (testIdOfFocus() === 'auto-build-apply' ? 'auto-build-apply' : null), 1500) ?? testIdOfFocus();
  if (checks.autoBuildFocusOnResult !== 'auto-build-apply') errors.push(`auto build: the result left focus on ${checks.autoBuildFocusOnResult}, not Apply`);
  if (r.mods.some(m => m?.name === 'Serration')) errors.push('auto build: the result holds the blacklisted Serration');
  if (r.mods.slice(0, 8).filter(Boolean).length < 8) errors.push(`auto build: only ${r.mods.slice(0, 8).filter(Boolean).length} of 8 slots were filled`);
  if (!(r.after > r.before * 3)) errors.push(`auto build: the result is not much better than the empty build (${r.before} -> ${r.after})`);
  if (Math.abs(r.before - emptyDps) > emptyDps * 1e-6) errors.push(`auto build: its "before" DPS ${r.before} is not the Readout's ${emptyDps}`);
  if ($('[data-testid="auto-build-capacity"]')) errors.push('auto build: with Cost Control on, the result is still over capacity');
  if (r.formaPlan?.length && !$('[data-testid="auto-build-forma"]')) errors.push('auto build: the result needs Forma but does not list them');
  if ($('[data-testid="auto-build-tabs"]') || $('[data-testid="auto-build-config"]')) errors.push('auto build: the settings stay editable under a result');
  const changes = await waitFor(() => $$('[data-testid="auto-build-change"]').length && $$('[data-testid="auto-build-change"]'), 2000);
  if (!changes) errors.push('auto build: the result shows no changes');
  else if (changes.some(c => c.dataset.name === 'Serration')) errors.push('auto build: the result view lists Serration');
  else if (store.get().cards?.available && !changes.some(c => c.querySelector('img'))) errors.push('auto build: the result shows no card images');
  await checkDialogLayout(dialog, 'autoBuildResult', errors, checks);
  await capture(uf, 'auto-build-result', errors);

  // Apply: one undo step, Forma included; the Readout then shows the result's DPS and the build fits.
  await realClick(app, $('[data-testid="auto-build-apply"]'), errors, 'Apply');
  if (!(await waitFor(() => !store.get().autoBuildOpen, 2000))) errors.push('auto build: Apply did not close the dialog');
  if (JSON.stringify(store.get().build.mods) !== JSON.stringify(r.mods)) errors.push('auto build: Apply did not put the proposed mods in the build');
  if ((store.get().build.arcanes?.[0]?.name ?? null) !== (r.arcanes?.[0]?.name ?? null)) errors.push('auto build: Apply did not put the proposed arcane in the build');
  const cap = buildCapacity(store.get().ctx, store.get().build);
  checks.autoBuildCapacity = cap ? `${cap.used} / ${cap.capacity}` : null;
  if (cap && cap.over > 0) errors.push(`auto build: the applied build is ${cap.over} over capacity`);
  const applied = await settled();
  checks.autoBuildApplied = applied ? Math.round(applied) : null;
  if (!applied || Math.abs(applied - r.after) > r.after * 1e-3) errors.push(`auto build: the Readout shows ${applied} DPS, the result said ${r.after}`);
  if (!(await waitFor(() => $$('[data-testid="toast"]').some(t => /Auto build applied/.test(t.textContent)), 2000))) errors.push('auto build: no "Auto build applied" toast');
  // On the now complete build, every slot is kept: Run is disabled and says why.
  actions.setAutoBuildOpen(true);
  const full = await waitFor(() => $('[data-testid="auto-build-run"]'), 2000);
  checks.autoBuildRunOnFullBuild = full?.getAttribute('aria-disabled') ?? null;
  if (full?.getAttribute('aria-disabled') !== 'true') errors.push('auto build: Run is enabled on a complete build with every slot kept');
  if (!/nothing to fill/i.test($('[data-testid="auto-build-keep-text"]')?.textContent ?? '')) errors.push('auto build: the Keep text does not say there is nothing to fill');
  actions.setAutoBuildOpen(false);
  await waitFor(() => !$('[data-testid="auto-build-dialog"]'), 2000);
  // A real Ctrl+Z undoes the whole auto build at once, Forma included.
  document.activeElement?.blur?.();
  await uf.smokePress('z', ['control']);
  if (!(await waitFor(() => emptyBuild() === empty && !store.get().build.arcanes?.[0], 2000))) errors.push('auto build: Ctrl+Z did not restore the empty build (mods and polarities)');
  const back = await settled();
  if (back !== emptyDps) errors.push(`auto build: after undo the DPS is ${back}, not ${emptyDps}`);
  clearToasts();

  // Cancel a long run (the Default config: the site's full settings); focus returns to Run.
  await realClick(app, $('[data-testid="auto-build-open"]'), errors, 'Auto build button (again)');
  await waitFor(() => $('[data-testid="auto-build-dialog"]'), 2000);
  actions.selectAutoBuildConfig(AS.DEFAULT_CONFIG_ID);
  await realClick(app, await waitFor(() => $('[data-testid="auto-build-run"]'), 2000), errors, 'Run (Default)');
  await waitFor(() => (store.get().autoBuild?.runs ?? 0) > 50, 15000);
  const cancelAt = performance.now();
  await realClick(app, $('[data-testid="auto-build-cancel"]'), errors, 'Cancel');
  const cancelled = await waitFor(() => store.get().autoBuild?.status === 'cancelled', 5000);
  checks.autoBuildCancelMs = Math.round(performance.now() - cancelAt);
  if (!cancelled) errors.push(`auto build: Cancel did not stop the run (status ${store.get().autoBuild?.status})`);
  if (emptyBuild() !== empty) errors.push('auto build: a cancelled run changed the build');
  if (!(await waitFor(() => $('[data-testid="auto-build-cancelled"]'), 1500))) errors.push('auto build: the dialog does not say the run was cancelled');
  checks.autoBuildFocusAfterCancel = await waitFor(() => (testIdOfFocus() === 'auto-build-run' ? 'auto-build-run' : null), 1500) ?? testIdOfFocus();
  if (checks.autoBuildFocusAfterCancel !== 'auto-build-run') errors.push(`auto build: after Cancel focus is on ${checks.autoBuildFocusAfterCancel}, not Run`);
  actions.selectAutoBuildConfig(AS.YOUR_CONFIG_ID);
  await realClick(app, $('[data-testid="auto-build-close"]'), errors, 'Close auto build');
  await waitFor(() => !$('[data-testid="auto-build-dialog"]'), 2000);
  await nextFrame();
  await nextFrame();
  if (document.activeElement?.dataset?.testid !== 'auto-build-open') errors.push(`auto build: closing the dialog left focus on ${focusId()}, not the button`);
  actions.discardAutoBuild();
  await settled();
  log(`auto build: ${checks.autoBuild.dps} DPS in ${checks.autoBuild.ms} ms (${checks.autoBuild.runs} runs, ${checks.autoBuild.cores} engines, ${checks.autoBuild.forma} Forma), cancel took ${checks.autoBuildCancelMs} ms`);
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
  // Narrow windows show the library as an overlay drawer (a dialog): let it finish closing before the delete check.
  await waitFor(() => !$('.fui-OverlayDrawer'), 2000);
  if (app.isDirty()) errors.push('save: build still marked as changed');
  log(`saved build ${saved.id}`);
  await capture(uf, 'saved', errors);

  await actions.deleteSaved(saved.id);
  if ((await uf.builds.list()).some(b => b.id === saved.id)) errors.push('remove: build is still stored after delete');
  if (store.get().savedBuilds.some(b => b.id === saved.id)) errors.push('remove: build is still in the library');
  const openDialog = $('[role="alertdialog"], [role="dialog"]');
  if (openDialog) errors.push(`remove: a dialog is open after delete (delete must use undo): ${describe(openDialog)} "${openDialog.textContent.trim().slice(0, 60)}"`);
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

/**
 * Weapon options on a Progenitor weapon: Kuva Bramma shows "Options" (Braton Prime has none); a real click opens the
 * popover with the default Magnetic 25%; picking Heat from the element dropdown with real clicks changes the bonus and
 * the DPS; Esc closes it. The weapon goes back to Braton Prime with its mods afterwards.
 */
async function checkWeaponOptions(app, errors, checks) {
  const { store, actions, uf } = app;
  if ($('[data-testid="weapon-options"]')) errors.push('options: Braton Prime shows weapon options it does not have');
  const before = store.get().build;
  // The featured check leaves the library drawer open; it covers the Loadout.
  actions.setLibraryOpen(false);
  await waitFor(() => !$('.fui-OverlayDrawer'), 2000);
  actions.setWeapon('Kuva Bramma');
  const button = await waitFor(() => $('[data-testid="weapon-options"]'), 3000);
  if (!button) { errors.push('options: no Options button on Kuva Bramma'); return; }
  checks.weaponOptionsLabel = button.getAttribute('aria-label');
  if (!/Magnetic 25%/.test(checks.weaponOptionsLabel ?? '')) errors.push(`options: the button says "${checks.weaponOptionsLabel}", expected the default Magnetic 25%`);
  if (!(await realClick(app, button, errors, 'Options button'))) return;
  const popover = await waitFor(() => $('[data-testid="weapon-options-popover"]'), 2000);
  if (!popover) { errors.push('options: a real click on Options did not open the popover'); return; }
  await capture(uf, 'weapon-options', errors);
  if (!(await realClick(app, $('[data-testid="progenitor-element"]'), errors, 'Progenitor element dropdown'))) return;
  const heat = await waitFor(() => $$('[role="option"]').find(o => o.textContent.trim() === 'Heat'), 2000);
  if (!heat) { errors.push('options: the element list has no Heat'); return; }
  await realClick(app, heat, errors, 'Heat option');
  if (!(await waitFor(() => store.get().build.progenitor?.element === 'Heat', 2000))) errors.push(`options: picking Heat left the bonus at ${JSON.stringify(store.get().build.progenitor)}`);
  await uf.smokePress('Escape');
  await uf.smokePress('Escape');
  if (!(await waitFor(() => !$('[data-testid="weapon-options-popover"]'), 1500))) errors.push('options: Esc did not close the popover');
  checks.weaponOptions = store.get().build.progenitor;
  // Undo back to the build as it was (the weapon change dropped mods that don't fit a bow).
  const target = JSON.stringify(before.mods);
  for (let i = 0; i < 5 && (store.get().build.weaponName !== before.weaponName || JSON.stringify(store.get().build.mods) !== target); i++) actions.undo();
  if (store.get().build.weaponName !== before.weaponName) errors.push('options: undo did not bring the weapon back');
  await waitFor(() => !$('[data-testid="weapon-options"]'), 2000);
  log(`weapon options: ${JSON.stringify(checks.weaponOptions)}`);
}

/**
 * Rivens: picking for an empty general slot, the Picker's "Riven" menu (real clicks) opens "New riven…", the riven
 * dialog opens with focus inside, its layout passes the dialog checks, and Esc closes it.
 */
async function checkRiven(app, errors, checks) {
  const { store, actions, uf } = app;
  const slot = store.get().build.mods.findIndex((m, i) => !m && i < 8);
  if (slot < 0) { errors.push('riven: no empty general slot'); return; }
  actions.selectSlot(slot);
  const button = await waitFor(() => $('[data-testid="picker-rivens"]'), 2000);
  if (!button) { errors.push('riven: no Riven button in the Picker while picking a general slot'); return; }
  if (!(await realClick(app, button, errors, 'Picker Riven button'))) return;
  const item = await waitFor(() => $('[data-testid="picker-riven-new"]'), 2000);
  if (!item) { errors.push('riven: the Riven menu has no "New riven…"'); return; }
  await realClick(app, item, errors, 'New riven');
  const dialog = await waitFor(() => $('[data-testid="riven-dialog"]'), 2000);
  if (!dialog) { errors.push('riven: "New riven…" did not open the riven dialog'); return; }
  if (!(await waitFor(() => dialog.contains(document.activeElement), 1500))) errors.push(`riven: the dialog opened with focus on ${testIdOfFocus()}`);
  await checkDialogLayout(dialog, 'riven', errors, checks);
  if (!dialog.querySelector('[data-testid="riven-polarity"]')) errors.push('riven: the dialog has no polarity picker');
  await capture(uf, 'riven-dialog', errors);
  await uf.smokePress('Escape');
  if (!(await waitFor(() => !$('[data-testid="riven-dialog"]'), 2000))) errors.push('riven: Esc did not close the dialog');
  actions.closePicker?.({ focusSlot: slot });
  checks.riven = true;
  log('riven dialog opens and closes');
}

/**
 * Auto Forma: a build over capacity (no Catalyst), the capacity line's button by a real click, the plans (the fewest
 * Forma first), Apply by a real click fits the build, and Undo puts it back.
 */
async function checkAutoForma(app, errors, checks) {
  const { store, actions, uf } = app;
  await actions.newBuild({ force: true });
  actions.setWeapon(SMOKE_PLAN.weapon);
  // 49 drain against 30: it fits only with Forma (26 with every mod in a matching slot).
  SMOKE_PLAN.mods.forEach(([name, rank], slot) => actions.equipMod(slot, name, rank, { focus: false }));
  actions.closePicker({ focus: false });
  actions.setCatalyst(false);
  await nextFrame();
  const meter = () => $('[data-testid="capacity"]');
  const over = () => Number(meter()?.getAttribute('aria-valuenow')) > Number(meter()?.getAttribute('aria-valuemax'));
  if (!over()) { errors.push('auto forma: the test build is not over capacity'); return; }
  const before = JSON.stringify(store.get().build);
  if (!(await realClick(app, await waitFor(() => $('[data-testid="auto-forma-open"]'), 2000), errors, 'Auto Forma button'))) return;
  const dialog = await waitFor(() => $('[data-testid="auto-forma-dialog"]'), 2000);
  if (!dialog) { errors.push('auto forma: the button did not open the dialog'); return; }
  await checkDialogLayout(dialog, 'auto forma', errors, checks);
  const plans = dialog.querySelectorAll('[data-testid="auto-forma-plans"] input[type="radio"]');
  if (!plans.length) { errors.push(`auto forma: no plans (${dialog.textContent.slice(0, 200)})`); return; }
  checks.autoFormaPlans = plans.length;
  await capture(uf, 'auto-forma', errors);
  if (!(await realClick(app, $('[data-testid="auto-forma-apply"]'), errors, 'Auto Forma Apply'))) return;
  if (!(await waitFor(() => !$('[data-testid="auto-forma-dialog"]'), 2000))) errors.push('auto forma: the dialog stayed open after Apply');
  await nextFrame();
  if (over()) errors.push(`auto forma: still over capacity after Apply (${meter()?.getAttribute('aria-valuetext')})`);
  checks.autoForma = `${meter()?.getAttribute('aria-valuetext')}, ${store.get().build.slotPolarities.filter(Boolean).length} Forma`;
  actions.undo();
  if (JSON.stringify(store.get().build) !== before) errors.push('auto forma: Undo did not bring the build back');
  actions.setCatalyst(true);
  log(`auto forma: ${checks.autoForma}`);
}

/**
 * The riven tools (docs/port-rivens.md 13): the capacity line's Riven menu with real clicks, Auto riven on a short
 * budget (Apply adds a riven, Undo takes it away), Rolls data saved as CSV, and, with UF_SMOKE_RIVEN_IMAGE, two
 * rivens read from a screenshot and compared.
 */
async function checkRivenTools(app, errors, checks) {
  const { store, actions, uf } = app;
  const quick = { sampleCount: 1, simulationTimeSeconds: 1, negativeStat: 'Zoom', excludedStats: ['Punch Through', 'ColdDamage', 'HeatDamage', 'ElectricityDamage', 'ToxinDamage', 'ViralDamage', 'CorrosiveDamage', 'MagneticDamage', 'RadiationDamage', 'GasDamage', 'BlastDamage', 'Damage vs.Corpus', 'Damage vs.Infested', 'Damage vs.Orokin', 'Damage vs.Techrot', 'Damage vs.Scaldra', 'Status Damage', 'Weak Point Damage', 'Weak Point Critical Chance', 'Ammo Efficiency', 'Magazine Reload While Holstered', 'Status Chance', 'Fire Rate/Attack Speed'] };
  await actions.newBuild({ force: true });
  actions.setWeapon(SMOKE_PLAN.weapon);
  SMOKE_PLAN.mods.forEach(([name, rank], slot) => actions.equipMod(slot, name, rank, { focus: false }));
  actions.closePicker({ focus: false });
  await nextFrame();
  if (!(await realClick(app, await waitFor(() => $('[data-testid="riven-tools-open"]'), 2000), errors, 'Riven tools button'))) return;
  const item = await waitFor(() => $('[data-testid="riven-tools-auto"]'), 2000);
  if (!item) { errors.push('riven tools: the Riven menu has no "Auto riven…"'); return; }
  await capture(uf, 'riven-tools-menu', errors);
  await realClick(app, item, errors, 'Auto riven');
  const dialog = await waitFor(() => $('[data-testid="riven-tool-dialog"][data-tool="auto"]'), 2000);
  if (!dialog) { errors.push('riven tools: "Auto riven…" did not open its setup'); return; }
  if (!(await waitFor(() => dialog.contains(document.activeElement), 1500))) errors.push(`riven tools: the setup opened with focus on ${testIdOfFocus()}`);
  await checkDialogLayout(dialog, 'riven tools', errors, checks);
  await capture(uf, 'riven-tools-setup', errors);
  const t0 = performance.now();
  actions.startRivenTool(quick);
  const done = await waitFor(() => (['done', 'error'].includes(store.get().rivenTool?.status) ? store.get().rivenTool : null), 120000);
  checks.autoRivenMs = Math.round(performance.now() - t0);
  if (!done) { errors.push('riven tools: Auto riven did not finish in 120 s'); return; }
  if (done.status === 'error') { errors.push(`riven tools: Auto riven failed: ${done.error}`); return; }
  if (!done.result.improved) { errors.push(`riven tools: Auto riven found nothing: ${done.result.message}`); return; }
  checks.autoRiven = `${Math.round(done.result.readout.before)} -> ${Math.round(done.result.readout.proposals.auto)}`;
  await capture(uf, 'riven-tools-result', errors);
  const apply = await waitFor(() => $('[data-testid="riven-tool-apply-auto"]'), 2000);
  if (!(await realClick(app, apply, errors, 'Auto riven Apply'))) return;
  if (!(await waitFor(() => store.get().build.mods.some(m => m?.isRiven), 2000))) { errors.push('riven tools: Apply did not equip the riven'); return; }
  if ($('[data-testid="riven-tool-dialog"]')) errors.push('riven tools: the dialog stayed open after Apply');
  actions.undo();
  if (store.get().build.mods.some(m => m?.isRiven)) errors.push('riven tools: Undo did not take the riven away');

  // Rolls data: a short scan, then the CSV (automated runs save without a dialog).
  actions.openRivenTool('rolls');
  await waitFor(() => $('[data-testid="riven-tool-dialog"][data-tool="rolls"]'), 2000);
  actions.startRivenTool(quick);
  const rolls = await waitFor(() => (['done', 'error'].includes(store.get().rivenTool?.status) ? store.get().rivenTool : null), 120000);
  if (rolls?.status !== 'done') errors.push(`riven tools: Rolls data ${rolls ? `failed: ${rolls.error}` : 'did not finish'}`);
  else {
    checks.rollsRows = rolls.result.rows.length;
    if (!$('[data-testid="riven-rolls-table"]')) errors.push('riven tools: no rolls table in the result');
    if (!(await actions.saveRollsCsv())) errors.push('riven tools: the CSV was not saved');
  }
  actions.closeRivenTool();

  // Two rivens from a screenshot, compared.
  const bytes = await uf.smokeOcrImage?.('riven');
  if (bytes) {
    const read = await actions.readRivenScreenshot({ bytes, two: true });
    if (!read) errors.push('riven tools: two rivens were not read from UF_SMOKE_RIVEN_IMAGE');
    else {
      const cmp = await waitFor(() => $('[data-testid="riven-tool-dialog"][data-tool="compare"]'), 2000);
      if (!cmp || store.get().rivenTool?.compare?.rivens?.length !== 2) errors.push('riven tools: the compare did not open with two rivens');
      else {
        await capture(uf, 'riven-compare-setup', errors);
        actions.startRivenTool({});
        const c = await waitFor(() => (['done', 'error'].includes(store.get().rivenTool?.status) ? store.get().rivenTool : null), 120000);
        if (c?.status !== 'done') errors.push(`riven tools: the compare ${c ? `failed: ${c.error}` : 'did not finish'}`);
        else {
          checks.rivenCompare = $('[data-testid="riven-compare-summary"]')?.textContent ?? null;
          await capture(uf, 'riven-compare-result', errors);
        }
      }
      actions.closeRivenTool();
    }
    // One riven from the same screenshot: the riven dialog opens with what was read, for review.
    await waitFor(() => !$('[data-testid="riven-tool-dialog"]'), 2000);
    if (!(await actions.readRivenScreenshot({ bytes }))) errors.push('riven tools: no riven was read for the riven dialog');
    else if (!(await waitFor(() => $('[data-testid="riven-screenshot-note"]'), 2000))) errors.push('riven tools: the riven dialog did not open with the screenshot note');
    else {
      checks.rivenFromShot = $$('[data-testid^="riven-row-"]').length;
      await capture(uf, 'riven-from-screenshot', errors);
      actions.closeRivenDialog();
    }
  }
  // The library: import (merge) a riven file, then export it (automated runs save without a dialog).
  const one = { isRiven: true, id: 'smoke_riven', family: 'Braton', disposition: 1.2, rank: 8, stats: [{ name: 'Critical Chance', value: 1, unit: '%' }, { name: 'Multishot', value: 0.6, unit: '%' }] };
  if (!(await actions.importRivenLibrary({ text: JSON.stringify({ rivens: [one] }), mode: 'merge' }))) errors.push('riven tools: importing a riven file failed');
  else if (!store.get().rivenLibrary.rivens.some(r => r.id === 'smoke_riven')) errors.push('riven tools: the imported riven is not in the library');
  else if (!(await actions.exportRivenLibrary())) errors.push('riven tools: exporting the library failed');
  else checks.rivenLibraryFiles = store.get().rivenLibrary.rivens.length;
  await waitFor(() => !$('[data-testid="riven-tool-dialog"]'), 2000);
  checks.rivenTools = true;
  log('riven tools run and apply');
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
    await checkModStacks(app, errors, checks);
    await checkKeyboard(app, errors, checks);
    await checkCompare(app, errors, checks);
    await checkBuffs(app, errors, checks);
    await checkAutoBuild(app, errors, checks);
    await checkSaveRemove(app, errors, checks);
    await checkOcr(app, errors, checks);
    await checkFeatured(app, errors, checks);
    await checkWeaponOptions(app, errors, checks);
    await checkRiven(app, errors, checks);
    await checkRivenTools(app, errors, checks);
    await checkAutoForma(app, errors, checks);
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
