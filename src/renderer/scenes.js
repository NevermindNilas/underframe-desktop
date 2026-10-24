// Scene-capture mode (UF_SCENES=<dir>): drive the real UI through the states reviewers check and save a PNG
// of each (main writes the files and prints UF_SCENES_DONE <json list>). Uses the same actions as the UI.
// The scenes follow docs/declutter-spec.md 8: rest and picking, and every disclosure (Picker, target popover, run
// menu, Compare, Why this DPS, menus, dialogs). The window size picks the set (1440x900 gets them all).
import { clearToasts, injectSimError, injectSweepDelay, store } from './controller.js';
import { ARCANE_SLOT, EXILUS_SLOT, resolvePresetName } from './model.js';
import { recognizeBuild } from '../shared/build-recognition.js';
import * as O from './ocr-import.js';
import { syntheticScreenshot } from './synthetic-shot.js';
import { waitFor } from './smoke.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const log = msg => console.info(`[scenes] ${msg}`);

/** A Braton Prime build with an arcane and Forma: matched and mismatched polarities, under capacity. */
export const FULL_BUILD = [
  ['Serration', 10, 'AP_ATTACK'], ['Split Chamber', 5, 'AP_ATTACK'], ['Point Strike', 3, 'AP_ATTACK'], ['Vital Sense', 2, 'AP_DEFENSE'],
  ['Infected Clip', 5, 'AP_TACTIC'], ['Stormbringer', 5, 'AP_TACTIC'], ['Hellfire', 5, 'AP_TACTIC'], ['Cryo Rounds', 5, 'AP_DEFENSE'],
];
const EXILUS_MOD = ['Vile Precision', 3];
const ARCANE = 'Primary Merciless';

const simSettled = () => {
  const { sim } = store.get();
  return sim.status === 'done' || sim.status === 'error';
};

async function settle(ms = 350) {
  await waitFor(simSettled, 15000);
  await sleep(ms);
}

function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const key = (target, k, opts = {}) => target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

/** Equip the full scene build (mods, Forma, Exilus, arcane), at rest. */
export function equipFullBuild(actions) {
  FULL_BUILD.forEach(([name, rank, pol], slot) => {
    actions.setSlotPolarity(slot, pol);
    actions.equipMod(slot, name, rank, { focus: false });
  });
  actions.equipMod(EXILUS_SLOT, EXILUS_MOD[0], EXILUS_MOD[1], { focus: false });
  actions.equipArcane(ARCANE);
  actions.closePicker({ focus: false });
}

/** A recorded OCR result from the test fixtures (text only) and a synthetic screenshot for it. */
export async function recordedImport(name) {
  const fixtures = {
    braton: () => import('../../test/fixtures/ocr/braton-prime-1920x1080.json'),
    vauban: () => import('../../test/fixtures/ocr/vauban-warframe-2560x1080.json'),
    tiberon: () => import('../../test/fixtures/ocr/tiberon-prime-2560x1440.json'),
    sobek: () => import('../../test/fixtures/ocr/kuva-sobek-2560x1080.json'),
  };
  const mod = await fixtures[name]();
  const fx = mod.default ?? mod;
  const rec = recognizeBuild(fx.ocr, store.get().ctx.data);
  const imageUrl = await syntheticScreenshot(fx.ocr, rec, store.get().cards);
  return { ocr: fx.ocr, imageUrl, expected: fx.expected };
}

export async function runScenes(app) {
  const { actions, uf } = app;
  const saved = [];
  // Each scene names what must be on screen (a selector or a check); a scene whose state never shows fails the run
  // instead of saving a picture of the wrong state.
  const shot = async (name, { keepToasts = false, wait = 450, expect = null } = {}) => {
    if (!keepToasts) clearToasts();
    await sleep(wait);
    if (expect) {
      const check = typeof expect === 'string' ? () => $(expect) : expect;
      if (!(await waitFor(check, 4000))) throw new Error(`scene ${name}: its state never showed (${typeof expect === 'string' ? expect : 'check'})`);
    }
    const file = await uf.sceneCapture(name);
    if (file) saved.push(file);
    log(`captured ${name}`);
  };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const size = w >= 1900 ? 'wide' : w >= 1400 ? 'main' : 'small';
  const all = size === 'main';
  // The folder names the window size, so every size uses the same scene names.
  const tag = name => name;
  const overlay = () => store.get().libraryMode === 'overlay';
  const showLibrary = async tab => {
    actions.setLibraryTab(tab);
    actions.setLibraryOpen(true);
    await sleep(400);
  };
  const hideLibrary = async () => {
    actions.setLibraryOpen(false);
    await sleep(300);
  };
  const search = () => $('[data-testid="gallery-search"]');
  const resetPicker = () => {
    actions.setGallery({ tab: 'mods', query: '', effects: [], pols: [], rarities: [], fits: true, hideEquipped: true, sort: 'match' });
    actions.closePicker({ focus: false });
  };
  const blur = () => document.activeElement?.blur?.();
  const escape = () => key(document.activeElement ?? document.body, 'Escape');

  try {
    await waitFor(() => $('[data-testid="result-card"]'), 10000);
    log(`window ${w}x${h} (${size})`);

    // 01. A new build: no mods, so it opens picking (cards go into the first empty slot).
    await actions.newBuild({ force: true });
    actions.setWeapon('Braton Prime');
    actions.setTarget({ preset: resolvePresetName(store.get().ctx, 'Elite Crewman') });
    await actions.runNow();
    await settle();
    await waitFor(() => document.querySelectorAll('[data-testid="gallery-card"] img').length > 4, 4000);
    blur();
    await shot(tag('01-new-build-picking'), { wait: 900, expect: '[data-testid="gallery-card"]' });

    // 02. The full build at rest: slots, Why this DPS, and the Readout with every stat.
    equipFullBuild(actions);
    await actions.runNow();
    await settle();
    actions.setRank(2, 3);
    await actions.runNow();
    await settle();
    await waitFor(() => $('[data-testid="health-chart"] svg path'), 5000);
    blur();
    await shot(tag('02-rest-full'), { wait: 900, expect: () => $('[data-testid="slots"][data-layout="grid"]') && $('[data-testid="health-chart"] svg path') });

    // 03. Picking for slot 3 (a real slot click's action), with the stats previewing a card.
    actions.selectSlot(2, { focusGallery: true });
    await waitFor(() => document.querySelectorAll('[data-testid="gallery-card"]').length > 4, 4000);
    blur();
    await shot(tag('03-picking-slot3'), { wait: 900, expect: () => $('[data-testid="slots"][data-layout="strip"]') && /Slot 3/.test($('[data-testid="picker-target"]')?.textContent ?? '') });
    actions.setPreview({ kind: 'mod', name: 'Primed Bane of Corpus', slot: 2 });
    await shot(tag('03b-picking-preview'), { wait: 500, expect: () => /If equipped/.test($('[data-testid="stat-change-head"]')?.textContent ?? '') });
    actions.setPreview(null);

    // 03c. A stat row on the full build: the Picker targets the weakest mod's slot and says so above the cards.
    actions.closePicker({ focus: false });
    actions.searchStat('cc');
    await waitFor(() => store.get().pickerOpen, 2000);
    blur();
    await shot(tag('03c-stat-row-auto-target'), { wait: 800, expect: () => /replacing/.test($('[data-testid="picker-target"]')?.textContent ?? '') });
    actions.closePicker({ focus: false });
    actions.selectSlot(2, { focusGallery: false });

    // 04. Search with operators turned into tags.
    typeInto(search(), 'cc drain<=10 ');
    await shot(tag('04-picker-search-tags'), { wait: 800, expect: '[data-testid="gallery"] .fui-Tag' });

    // 05. The Arcanes tab with the arcane slot selected.
    resetPicker();
    actions.selectSlot(ARCANE_SLOT);
    blur();
    await shot(tag('05-picker-arcanes'), { wait: 900, expect: '[data-testid="arcane-card"]' });
    resetPicker();

    // 06. The target popover from the Readout.
    actions.setTargetOpen(true);
    await waitFor(() => $('[data-testid="target-card"]'), 2000);
    await shot(tag('06-target-popover'), { wait: 700, expect: '[data-testid="target-card"]' });
    actions.setTargetOpen(false);
    await sleep(200);

    // 07. Two pins in the Readout's Compare, then the Compare dialog.
    actions.pinResult();
    actions.setTarget({ steelPath: true });
    await actions.runNow();
    await settle();
    actions.pinResult();
    actions.setTarget({ steelPath: false });
    await actions.runNow();
    await settle();
    blur();
    await shot(tag('07-compare-section'), { wait: 500, expect: () => store.get().pins.length >= 2 && document.querySelectorAll('[data-testid="compare-row"]').length >= 1 && !$('[data-testid="catalyst-menu"]') });
    actions.setCompareOpen(true);
    await waitFor(() => $('[data-testid="compare-grid"]'), 2000);
    await shot(tag('07b-compare-dialog'), { wait: 700, expect: '[data-testid="compare-grid"]' });
    actions.setCompareOpen(false);
    await sleep(300);

    // 08. The capacity menu (Catalyst, Forma, Remove all).
    $('[data-testid="capacity-menu"]')?.click();
    await waitFor(() => $('[data-testid="catalyst-menu"]'), 2000);
    await shot(tag('08-capacity-menu'), { wait: 500, expect: '[data-testid="catalyst-menu"]' });
    escape();
    await sleep(200);

    // 35. External buffs (docs/port-external-buffs.md): the quiet Buffs link at rest, the dialog empty, with the
    // site screenshot's list, its presets menu and its statuses; then the Readout's summary line.
    {
      const ctx = store.get().ctx;
      actions.clearExternal();
      await actions.runNow();
      await settle();
      blur();
      await shot(tag('35-buffs-entry-rest'), { wait: 500, expect: '[data-testid="buffs-open"]' });
      actions.setBuffsOpen(true);
      await shot(tag('35b-buffs-dialog-empty'), { wait: 700, expect: '[data-testid="buffs-dialog"]' });
      const { buffFromInput } = await import('../shared/external-buffs.js');
      for (const [id, value, element] of [['resupply', 60, 'Electricity'], ['ext_fire_rate', 60], ['ext_elemental', 298, 'Electricity'], ['ext_combining_element', 240, 'Electricity'], ['ext_flat_crit_damage', 1.2]]) {
        actions.addExternalBuff(buffFromInput(ctx.data, id, { value, element }).row);
      }
      await actions.runNow();
      await settle();
      const content = () => $('[data-testid="buffs-dialog"] .fui-DialogContent');
      const scrollTo = sel => {
        const c = content();
        const el = $(sel);
        if (c && el) c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - 8;
      };
      scrollTo('#buff-list-heading');
      blur();
      await shot(tag('35c-buffs-dialog-list'), { wait: 600, expect: () => document.querySelectorAll('[data-testid="buff-row"]').length === 5 });
      await actions.saveBuffPreset('Screenshot set');
      const screenshotSet = store.get().build.externalBuffs;
      actions.setExternalBuffs([buffFromInput(ctx.data, 'roar', { value: 50 }).row, buffFromInput(ctx.data, 'eclipse', { value: 200 }).row]);
      await actions.saveBuffPreset('Roar and Eclipse');
      actions.setExternalBuffs(screenshotSet);
      await actions.runNow();
      await settle();
      if (content()) content().scrollTop = 0;
      $('[data-testid="preset-select"]')?.click();
      await shot(tag('35d-buffs-presets-menu'), { wait: 600, expect: '[role="listbox"]' });
      $('[data-testid="preset-select"]')?.click();
      await waitFor(() => !$('[role="listbox"]'), 2000);
      await sleep(200);
      actions.addExternalStatus('Viral', 10);
      actions.addExternalStatus('Cold', 10);
      await actions.runNow();
      await settle();
      scrollTo('#status-heading');
      blur();
      await shot(tag('35e-buffs-statuses'), { wait: 600, expect: () => document.querySelectorAll('[data-testid="status-row"]').length === 2 });
      // Sonar is a multiplier: it reads "×5", its field says so, and a value under 100% warns.
      {
        if (content()) content().scrollTop = 0;
        const combo = $('[data-testid="buff-type"]');
        combo?.click();
        typeInto(combo, 'Sonar');
        const option = await waitFor(() => $('[role="option"][data-key="type:sonar"]'), 2000);
        option?.click();
        const value = await waitFor(() => $('[data-testid="buff-value"]'), 2000);
        if (value) typeInto(value, '10');
        blur();
        await shot(tag('35h-buffs-sonar-warning'), { wait: 600, expect: '[data-testid="buff-warning"]' });
      }
      // Remove all, with its inline Undo.
      $('[data-testid="buffs-clear"]')?.click();
      await waitFor(() => $('[data-testid="buffs-undo-clear"]'), 2000);
      blur();
      await shot(tag('35i-buffs-removed-undo'), { wait: 600, expect: '[data-testid="buffs-undo-clear"]' });
      $('[data-testid="buffs-undo-clear"]')?.click();
      await waitFor(() => store.get().build.externalBuffs?.length === 5, 2000);
      await actions.runNow();
      await settle();
      if (all) {
        // A source: Roar from a Warframe, with its Ability Strength input and what it adds.
        if (content()) content().scrollTop = 0;
        const combo = $('[data-testid="buff-type"]');
        combo?.click();
        typeInto(combo, 'Roar');
        const option = await waitFor(() => $('[role="option"][data-key="ability:Roar"]'), 2000);
        option?.click();
        const strength = await waitFor(() => $('[data-testid="source-strength"]'), 2000);
        if (strength) typeInto(strength, '250');
        blur();
        await shot('35f-buffs-source-roar', { wait: 600, expect: () => /Adds Roar \+125%/.test($('[data-testid="source-preview"]')?.textContent ?? '') });
      }
      actions.setBuffsOpen(false);
      await sleep(300);
      blur();
      await shot(tag('35g-buffs-summary-rest'), { wait: 600, expect: '[data-testid="buffs-summary"]' });
      actions.clearExternal();
      await actions.runNow();
      await settle();
    }

    if (size === 'wide') {
      // The builds pane inline (it starts closed).
      await showLibrary('mine');
      await shot(tag('09-library-inline'), { wait: 600 });
      await hideLibrary();
    }

    if (all) {
      // 10. The action strip on slot 3 (keyboard focus) with the drain tooltip open, at rest.
      $('[data-testid="slot-select-2"]')?.focus();
      await sleep(150);
      const plate = $('[data-testid="slot-drain-2"]');
      plate?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      plate?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await shot('10-slot-focus-actions', { wait: 900, expect: '[data-testid="slot-rank-dec-2"]' });
      plate?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
      plate?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      blur();

      // 11. Did you mean.
      actions.openPicker({ focus: false });
      typeInto(search(), 'seration');
      await shot('11-picker-did-you-mean', { wait: 600, expect: () => store.get().pickerOpen && /seration/.test(store.get().gallery.query) });
      typeInto(search(), 'serating');
      await shot('11b-picker-did-you-mean-serating', { wait: 600 });
      typeInto(search(), 'r:constructor ');
      await shot('11c-picker-unknown-rarity', { wait: 600 });

      // 12. A selected slot, blocked cards with their reasons, equipped cards shown (Hide equipped off).
      resetPicker();
      actions.selectSlot(4);
      actions.setGallery({ hideEquipped: false });
      typeInto(search(), 'multishot');
      blur();
      await shot('12-picker-blocked-and-equipped', { wait: 800 });

      // 13. The details flyout on Primed Cryo Rounds; 13b on an equipped mod (where it is, not a doubled capacity).
      actions.selectSlot(null);
      typeInto(search(), 'primed cryo');
      let card = await waitFor(() => $('[data-testid="gallery-card"][data-mod-name="Primed Cryo Rounds"]'), 3000);
      card?.focus();
      key(card, 'Enter', { altKey: true });
      await waitFor(() => $('[data-testid="mod-flyout"]'), 2000);
      await shot('13-card-flyout', { wait: 700, expect: '[data-testid="mod-flyout"]' });
      key(document.activeElement, 'Escape');
      const equippedName = store.get().build.mods[0]?.name;
      typeInto(search(), equippedName ?? 'serration');
      card = await waitFor(() => $(`[data-testid="gallery-card"][data-mod-name="${equippedName}"]`), 3000);
      card?.focus();
      key(card, 'Enter', { altKey: true });
      await waitFor(() => $('[data-testid="mod-flyout"]'), 2000);
      await shot('13b-equipped-card-flyout', { wait: 700, expect: '[data-testid="mod-flyout"]' });
      key(document.activeElement, 'Escape');
      resetPicker();

      // 13c. Searching for an equipped mod with Hide equipped on: the empty state says where it is.
      actions.openPicker({ focus: false });
      typeInto(search(), 'hell');
      blur();
      await shot('13c-hidden-equipped', { wait: 600, expect: '[data-testid="picker-hidden-equipped"]' });
      resetPicker();

      // 14. The Filters popover.
      actions.openPicker({ focus: false });
      $('[data-testid="gallery-filters"]')?.click();
      await sleep(400);
      await shot('14-picker-filters', { wait: 500 });
      escape();
      resetPicker();

      // 15. A drag in progress from a card to slot 4 (the drag state set directly; native drags can't be scripted),
      // and a slot dragged out: the lower area becomes the remove zone.
      actions.openPicker({ focus: false });
      actions.setDrag({ kind: 'mod', name: 'Hammer Shot', from: 'gallery', over: 3 });
      await shot('15-drag-card-to-slot', { wait: 500 });
      actions.setDrag(null);
      resetPicker();
      actions.setDrag({ kind: 'mod', name: store.get().build.mods[5].name, from: 5, over: null });
      await shot('15b-drag-slot-to-remove', { wait: 500 });
      actions.setDrag(null);

      // 16. Keyboard pick-up on slot 2, with the announcement shown.
      store.set({ showAnnouncements: true });
      actions.startPickup({ kind: 'mod', name: store.get().build.mods[1].name, from: 1 });
      await sleep(200);
      actions.movePickup(3);
      document.querySelector('[data-focus-id="slot-select-3"]')?.focus();
      await shot('16-keyboard-pickup', { wait: 500 });
      actions.cancelPickup();
      store.set({ showAnnouncements: false });

      // 17-18. Best mod: running, then results (the Picker opens on "Best for slot 8").
      injectSweepDelay(60);
      const sweepDone = actions.startSweep(7);
      await waitFor(() => (store.get().sweep?.done ?? 0) >= 6, 20000);
      blur();
      await shot('17-best-mod-running');
      injectSweepDelay(0);
      await sweepDone;
      await settle();
      blur();
      await shot('18-best-mod-results', { wait: 900, expect: () => store.get().sweep?.status === 'done' && $('[data-testid="gallery-tab-best"]') });
      actions.dismissSweep();
      resetPicker();

      // 19-21. Screenshot import: progress, review, and the "text but no mods" error.
      const braton = await recordedImport('braton');
      store.set({ ocr: { id: -1, phase: 'progress', source: 'file', step: 1, slow: false, image: null, error: null, review: null, lines: [], returnFocus: null } });
      await shot('19-ocr-progress', { wait: 500 });
      O.close({ restoreFocus: false });
      await O.importRecorded(braton.ocr, { imageUrl: braton.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      await shot('20-ocr-review', { wait: 900, expect: '[data-testid="ocr-review"]' });
      O.close({ restoreFocus: false });
      const vauban = await recordedImport('vauban');
      await O.importRecorded(vauban.ocr, { imageUrl: vauban.imageUrl });
      await waitFor(() => $('[data-testid="ocr-error"]'), 5000);
      await shot('21-ocr-error-no-mods');
      O.close({ restoreFocus: false });
      const tiberon = await recordedImport('tiberon');
      await O.importRecorded(tiberon.ocr, { imageUrl: tiberon.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      await shot('20b-ocr-review-empty-arcane', { wait: 900 });
      O.close({ restoreFocus: false });
      const sobek = await recordedImport('sobek');
      await O.importRecorded(sobek.ocr, { imageUrl: sobek.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      (await waitFor(() => $('[data-testid="ocr-kept-note"]'), 3000).catch(() => null))?.scrollIntoView({ block: 'end' });
      await shot('20c-ocr-review-unreadable-arcane', { wait: 900 });
      O.close({ restoreFocus: false });
      await O.importRecorded(braton.ocr, { imageUrl: braton.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      $('[data-key="slot-1"] [data-testid="ocr-replace"]')?.click();
      const pickSearch = await waitFor(() => $('input[aria-describedby="ocr-pick-help-slot-1"]'), 3000);
      if (pickSearch) typeInto(pickSearch, 'serration');
      await shot('20d-ocr-replace-clash', { wait: 900 });
      key(document.activeElement, 'Escape');
      O.close({ restoreFocus: false });

      // 22. Over capacity: the Catalyst off.
      actions.setCatalyst(false);
      blur();
      await shot('22-over-capacity');
      actions.setCatalyst(true);

      // 23. Why this DPS: Damage by hit, the chart as a table, and Notes.
      actions.setWhyTab('hits');
      await shot('23-why-damage-by-hit');
      actions.setWhyTab('health');
      actions.setChartAsTable(true);
      await shot('23b-why-health-table');
      actions.setChartAsTable(false);
      actions.setWhyTab('notes');
      actions.setNotes('Rotation: open with Stormbringer procs.');
      actions.endTextEdit();
      await shot('23c-why-notes');
      actions.setWhyTab('health');

      // 24. The run menu and Run details; the honesty Details popover.
      $('[data-testid="run-menu"]')?.click();
      await waitFor(() => $('[data-testid="run-details"]'), 2000);
      await shot('24-run-menu', { wait: 400 });
      escape();
      await sleep(200);
      actions.openDialog('run');
      await shot('24b-run-details', { wait: 500 });
      actions.closeDialog();
      await sleep(200);
      $('[data-testid="honesty-details"]')?.click();
      await sleep(400);
      await shot('24c-honesty-details', { wait: 300 });
      $('[data-testid="honesty-details"]')?.click();
      blur();
      await sleep(200);

      // 25. Text cards everywhere (what the app shows without core/images), at rest and in the Arcanes tab.
      actions.setTextCards(true);
      blur();
      await shot('25-text-cards', { wait: 600 });
      actions.selectSlot(ARCANE_SLOT);
      blur();
      await shot('25b-arcane-text-cards', { wait: 600 });
      resetPicker();
      actions.setTextCards(false);

      // 26. Forced colours (Windows high contrast), emulated, at rest and picking.
      await uf.sceneEmulate([{ name: 'forced-colors', value: 'active' }]);
      blur();
      await shot('26-forced-colors', { wait: 800 });
      actions.selectSlot(3);
      blur();
      await shot('26b-forced-colors-picking', { wait: 800, expect: () => $('[data-testid="slots"][data-layout="strip"]') && !store.get().ocr });
      resetPicker();
      await uf.sceneEmulate([]);
      await sleep(300);

      // 27-30. Library, delete with undo, shortcuts.
      await showLibrary('featured');
      await shot('27-featured-tab');
      await hideLibrary();
      actions.setName('Braton Prime crit and toxin');
      await actions.save();
      await showLibrary('mine');
      await shot('28-saved-build-library');
      clearToasts();
      await sleep(300);
      await actions.deleteCurrent();
      await shot('29-delete-undo-toast', { keepToasts: true, wait: 600 });
      if (overlay()) await hideLibrary();
      clearToasts();
      actions.openDialog('shortcuts');
      await shot('30-shortcuts-dialog');
      actions.closeDialog();
      await sleep(200);

      // 31. A featured build opened.
      {
        const ctx = store.get().ctx;
        const featured = ctx.featured.find(f => f.weaponType === 'Primary' && f.source?.arcanes?.length) ?? ctx.featured[0];
        await actions.newBuild({ force: true });
        await settle();
        if (featured) await actions.openFeatured(featured.key);
        await actions.runNow();
        await settle();
        blur();
        await shot('31-featured-opened', { wait: 700 });
      }

      // 32. The simulation error.
      injectSimError('Injected by scene capture: the engine rejected this build input.');
      await actions.runNow();
      await settle();
      blur();
      await shot('32-simulation-error');
      injectSimError(null);
      await actions.runNow();
      await settle();

      // 33. A card with keyboard focus: the focus ring is drawn inside the card, over the art.
      actions.openPicker({ focus: false });
      typeInto(search(), 'cc ');
      const focusCard = await waitFor(() => $('[data-testid="gallery-card"]'), 3000);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
      focusCard?.focus();
      // The details flyout no longer opens on focus (Alt+Enter asks for it): the If equipped column previews instead.
      await shot('33-card-keyboard-focus', { wait: 500, expect: () => !$('[data-testid="mod-flyout"]') });
      focusCard?.blur();
      resetPicker();
    }

    if (size !== 'wide') {
      // 36. Auto build (docs/port-auto-build.md): the quiet entry at rest, the dialog's Run tab with what to keep, the
      // search settings, the element lists, the blacklist editor with a search, the read-only Default, a run in
      // progress, a result, and the applied build with its Undo toast.
      const openTab = name => $(`[data-testid="auto-build-tab-${name.toLowerCase()}"]`)?.click();
      const dialogContent = () => $('[data-testid="auto-build-dialog"] .fui-DialogContent');
      await actions.newBuild({ force: true });
      actions.setWeapon('Braton Prime');
      equipFullBuild(actions);
      await actions.runNow();
      await settle();
      blur();
      await shot(tag('36-auto-build-entry-rest'), { wait: 500, expect: '[data-testid="auto-build-open"]' });
      actions.setAutoBuildOpen(true);
      blur();
      await shot(tag('36b-auto-build-run-tab'), { wait: 700, expect: () => $('[data-testid="auto-build-summary"]') && $$('[data-testid="auto-build-keep"]').length === 8 });
      openTab('Search');
      blur();
      await shot(tag('36c-auto-build-search'), { wait: 600, expect: '[data-testid="auto-build-multiplier"]' });
      actions.updateAutoBuildSettings({
        specificElementalCandidatesEnabled: true, specificElementalTargets: ['Viral', 'Viral Heat', 'Corrosive'],
        elementalBlacklistEnabled: true, elementalBlacklist: ['Heat Toxin', 'Corrosive Blast'],
      });
      openTab('Elements');
      blur();
      await shot(tag('36d-auto-build-elements'), { wait: 600, expect: '[data-testid="auto-build-element-list"]' });
      actions.updateAutoBuildSettings({ specificElementalCandidatesEnabled: false, elementalBlacklistEnabled: false });
      openTab('Mods');
      const box = await waitFor(() => $('[data-testid="auto-build-blacklist-search"]'), 2000);
      if (box) typeInto(box, 'serration');
      await waitFor(() => document.querySelectorAll('[data-testid="auto-build-blacklist-add"] img').length > 1, 3000);
      blur();
      await shot(tag('36e-auto-build-blacklist-search'), { wait: 700, expect: '[data-testid="auto-build-blacklist-add"][data-name="Serration"]' });
      if (box) typeInto(box, '');
      if (dialogContent()) dialogContent().scrollTop = 0;
      await waitFor(() => document.querySelectorAll('[data-testid="auto-build-blacklist-item"] img').length > 3, 3000);
      blur();
      // At rest the blacklist lists the entries for this weapon type, three rows at a time.
      await shot(tag('36f-auto-build-blacklist'), { wait: 700, expect: () => $$('[data-testid="auto-build-blacklist-item"]').length >= 3 && $('[data-testid="auto-build-blacklist-others"]') });
      if (all) {
        $('[data-testid="auto-build-blacklist-others"]')?.click();
        $('[data-testid="auto-build-blacklist-all"]')?.click();
        await sleep(300);
        blur();
        await shot('36f2-auto-build-blacklist-all', { wait: 900, expect: () => $$('[data-testid="auto-build-blacklist-item"]').length > 100 });
        $('[data-testid="auto-build-blacklist-all"]')?.click();
        $('[data-testid="auto-build-blacklist-others"]')?.click();
      }
      if (all) {
        actions.selectAutoBuildConfig('default');
        openTab('Search');
        blur();
        await shot('36g-auto-build-default-locked', { wait: 600, expect: '[data-testid="auto-build-locked"]' });
        actions.selectAutoBuildConfig('your_config');
      }
      // Every slot kept on the full build: nothing to fill, so Run is disabled and says why.
      openTab('Run');
      blur();
      await shot(tag('36k-auto-build-nothing-to-fill'), { wait: 600, expect: () => $('[data-testid="auto-build-run"]')?.getAttribute('aria-disabled') === 'true' });
      $('[data-testid="auto-build-replace-all"]')?.click();
      blur();
      await shot(tag('36l-auto-build-replace-all'), { wait: 600, expect: () => $$('[data-testid="auto-build-keep"]').every(b => b.getAttribute('aria-pressed') === 'false') });
      actions.setAutoBuildOpen(false);
      await sleep(300);

      // A run in progress (the site's full settings on an empty build), captured early and then cancelled.
      await actions.newBuild({ force: true });
      actions.closePicker({ focus: false });
      await actions.runNow();
      await settle();
      actions.setAutoBuildOpen(true);
      await sleep(300);
      actions.startAutoBuild();
      await waitFor(() => (store.get().autoBuild?.runs ?? 0) > 3000, 20000);
      blur();
      await shot(tag('36h-auto-build-running'), { wait: 200, expect: '[data-testid="auto-build-progress"]' });
      actions.cancelAutoBuild();
      await waitFor(() => store.get().autoBuild?.status === 'cancelled', 5000);

      // A result: the smallest sample size, no refinement.
      actions.updateAutoBuildSettings({ sampleSizeMultiplier: 0.2, finalRefinementEnabled: false });
      actions.startAutoBuild();
      await waitFor(() => ['done', 'error'].includes(store.get().autoBuild?.status), 60000);
      await waitFor(() => document.querySelectorAll('[data-testid="auto-build-change"] img').length > 6, 3000);
      blur();
      await shot(tag('36i-auto-build-result'), { wait: 700, expect: '[data-testid="auto-build-result"]' });
      actions.applyAutoBuild();
      await settle();
      blur();
      await shot(tag('36j-auto-build-applied'), { keepToasts: true, wait: 700, expect: () => !store.get().autoBuildOpen && store.get().build.mods.some(Boolean) });
      actions.undo();
      clearToasts();
      await settle();
      if (all) {
        // Cost Control off: the result may be over capacity, and says so above the changes (and on Apply).
        actions.updateAutoBuildSettings({ costControlEnabled: false });
        actions.setAutoBuildOpen(true);
        actions.startAutoBuild();
        await waitFor(() => ['done', 'error'].includes(store.get().autoBuild?.status), 60000);
        blur();
        await shot('36m-auto-build-over-capacity', { wait: 700, expect: '[data-testid="auto-build-result"]' });
        actions.discardAutoBuild();
        actions.setAutoBuildOpen(false);
        // A run that finishes with the dialog closed raises a toast with Review.
        actions.startAutoBuild();
        await waitFor(() => ['done', 'error'].includes(store.get().autoBuild?.status), 60000);
        blur();
        await shot('36n-auto-build-finished-toast', { keepToasts: true, wait: 700, expect: () => $$('[data-testid="toast"]').some(t => /Auto build finished/.test(t.textContent)) });
        actions.discardAutoBuild();
        clearToasts();
        actions.updateAutoBuildSettings({ costControlEnabled: true });
      }
      actions.updateAutoBuildSettings({ sampleSizeMultiplier: 3, finalRefinementEnabled: true });
      await settle();
    }

    if (size === 'wide') {
      // 34. The stacked layout: 1920x1080 at 200% zoom: the Readout first, then scrolled to the slots.
      resetPicker();
      await uf.sceneZoom(2);
      await sleep(800);
      await shot(tag('34-stacked-zoom200'), { wait: 600 });
      const area = $('[data-scroll-region][role="region"]');
      const slots = $('[data-testid="slots"]');
      if (area && slots) area.scrollTop = slots.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop - 60;
      await shot(tag('34b-stacked-zoom200-slots'), { wait: 700 });
      await uf.sceneZoom(1);
    }

    log(`done: ${saved.length} scenes`);
    await uf.scenesDone();
  } catch (e) {
    console.error(e);
    await uf.scenesFailed(`scenes: ${e?.message ?? e}`);
  }
}
