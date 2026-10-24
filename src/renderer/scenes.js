// Scene-capture mode (UF_SCENES=<dir>): drive the real UI through the states reviewers check and save a PNG
// of each (main writes the files and prints UF_SCENES_DONE <json list>). Uses the same actions as the UI.
// The arsenal scenes follow docs/arsenal-spec.md 11.1; the window size picks the set (1440x900 gets them all).
import { clearToasts, injectSimError, injectSweepDelay, store } from './controller.js';
import { ARCANE_SLOT, EXILUS_SLOT, resolvePresetName } from './model.js';
import { recognizeBuild } from '../shared/build-recognition.js';
import * as O from './ocr-import.js';
import { syntheticScreenshot } from './synthetic-shot.js';
import { waitFor } from './smoke.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);
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

/** Equip the full scene build (mods, Forma, Exilus, arcane). */
export function equipFullBuild(actions) {
  FULL_BUILD.forEach(([name, rank, pol], slot) => {
    actions.setSlotPolarity(slot, pol);
    actions.equipMod(slot, name, rank, { focus: false });
  });
  actions.equipMod(EXILUS_SLOT, EXILUS_MOD[0], EXILUS_MOD[1], { focus: false });
  actions.equipArcane(ARCANE);
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
  const shot = async (name, { keepToasts = false, wait = 450 } = {}) => {
    if (!keepToasts) clearToasts();
    await sleep(wait);
    const file = await uf.sceneCapture(name);
    if (file) saved.push(file);
    log(`captured ${name}`);
  };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const size = w >= 1900 ? 'wide' : w >= 1400 ? 'main' : 'small';
  const all = size === 'main';
  const overlay = () => store.get().libraryMode === 'overlay';
  const showLibrary = async tab => {
    actions.setLibraryTab(tab);
    actions.setLibraryOpen(true);
    await sleep(400);
  };
  const hideOverlayLibrary = async () => {
    if (overlay()) {
      actions.setLibraryOpen(false);
      await sleep(300);
    }
  };
  const search = () => $('[data-testid="gallery-search"]');
  const resetGallery = () => {
    actions.setGallery({ tab: 'mods', query: '', effects: [], pols: [], rarities: [], fits: true, hideEquipped: false, sort: 'match' });
    actions.selectSlot(null);
  };

  try {
    await waitFor(() => $('[data-testid="result-card"]'), 10000);
    log(`window ${w}x${h} (${size})`);

    // 01. A new build: no mods, no slot selected, the gallery showing all mods.
    await actions.newBuild({ force: true });
    actions.setWeapon('Braton Prime');
    actions.setTarget({ preset: resolvePresetName(store.get().ctx, 'Elite Crewman') });
    await actions.runNow();
    await settle();
    await waitFor(() => document.querySelectorAll('[data-testid="gallery-card"] img').length > 4, 4000);
    if (all) await shot('01-arsenal-empty', { wait: 900 });

    // 02. A full build with an arcane, Forma (matched and mismatched), results visible.
    equipFullBuild(actions);
    await actions.runNow();
    await settle();
    actions.setRank(2, 2);
    await actions.runNow();
    await settle();
    await waitFor(() => $('[data-testid="health-chart"] svg path'), 5000);
    await shot(size === 'wide' ? '18-1920x1080-full' : size === 'small' ? '19-1100x700-full' : '02-arsenal-full', { wait: 900 });

    if (size === 'small') {
      // The stats fold into a results tab at this width.
      actions.setResultsTab('stats');
      await shot('19b-1100x700-stats-tab');
      actions.setResultsTab('charts');
      // 19e. The compact header has no Catalyst line: the stage's More menu holds the Catalyst and the Forma count.
      $('[data-testid="stage-more"]')?.click();
      await waitFor(() => $('[data-testid="catalyst-menu"]'), 2000);
      await shot('19e-1100x700-stage-menu-catalyst', { wait: 500 });
      key(document.activeElement, 'Escape');
      await sleep(200);
    }

    if (all) {
      // 03. The action bar on slot 3 with the drain tooltip open.
      actions.selectSlot(2);
      await sleep(200);
      $('[data-testid="slot-select-2"]')?.focus();
      await sleep(150);
      const plate = $('[data-testid="slot-drain-2"]');
      plate?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      plate?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await shot('03-slot-hover', { wait: 900 });
      plate?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
      plate?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      document.activeElement?.blur?.();

      actions.selectSlot(null);
    }

    // 04. Search with operators turned into tags.
    resetGallery();
    if (search()) typeInto(search(), 'cc drain<=10 ');
    await shot(all ? '04-gallery-search' : size === 'wide' ? '18b-1920x1080-gallery-search' : '19c-1100x700-gallery-search', { wait: 800 });

    if (all) {
      // 05. Did you mean.
      typeInto(search(), 'seration');
      await shot('05-gallery-did-you-mean', { wait: 600 });
      // 05b. A typo with no fuzzy hit: the suggestion shares the word's first letters (Serration, not Spring-Loaded).
      typeInto(search(), 'serating');
      await shot('05b-gallery-did-you-mean-serating', { wait: 600 });
      // 05c. An operator value that is an Object.prototype key is an unknown value, not a crash.
      typeInto(search(), 'r:constructor ');
      await shot('05c-gallery-unknown-rarity', { wait: 600 });

      // 06. A selected slot, blocked cards with their reasons, Hide equipped off.
      actions.selectSlot(4);
      typeInto(search(), 'multishot');
      await shot('06-gallery-conflict', { wait: 800 });

      // 07. The details flyout on Primed Cryo Rounds.
      actions.selectSlot(null);
      typeInto(search(), 'primed cryo');
      const card = await waitFor(() => $('[data-testid="gallery-card"][data-mod-name="Primed Cryo Rounds"]'), 3000);
      card?.focus();
      key(card, 'Enter', { altKey: true });
      await waitFor(() => $('[data-testid="mod-flyout"]'), 2000);
      await shot('07-mod-flyout', { wait: 700 });
      key(document.activeElement, 'Escape');

      // 07b. The flyout of an equipped mod: where it is, not a doubled capacity.
      const equippedName = store.get().build.mods[0]?.name;
      typeInto(search(), equippedName ?? 'serration');
      const eq = await waitFor(() => $(`[data-testid="gallery-card"][data-mod-name="${equippedName}"]`), 3000);
      eq?.focus();
      key(eq, 'Enter', { altKey: true });
      await waitFor(() => $('[data-testid="mod-flyout"]'), 2000);
      await shot('07b-equipped-mod-flyout', { wait: 700 });
      key(document.activeElement, 'Escape');
    }

    // 08. The Arcanes tab with the arcane slot selected and Primary Merciless equipped.
    resetGallery();
    actions.selectSlot(ARCANE_SLOT);
    await shot(all ? '08-arcanes-tab' : size === 'wide' ? '18c-1920x1080-arcanes-tab' : '19d-1100x700-arcanes-tab', { wait: 900 });
    resetGallery();

    if (all) {
      // 09. A drag in progress (the drag state set directly; native drags can't be scripted).
      actions.setDrag({ kind: 'mod', name: 'Hammer Shot', from: 'gallery', over: 3 });

      await shot('09-drag-in-progress', { wait: 500 });
      actions.setDrag(null);

      // 10. Keyboard pick-up on slot 2, with the announcement shown.
      store.set({ showAnnouncements: true });
      actions.startPickup({ kind: 'mod', name: store.get().build.mods[1].name, from: 1 });
      await sleep(200);
      actions.movePickup(3);
      document.querySelector('[data-focus-id="slot-select-3"]')?.focus();
      await shot('10-keyboard-pickup', { wait: 500 });
      actions.cancelPickup();
      store.set({ showAnnouncements: false });

      // 11-12. Best mod: running, then results.
      injectSweepDelay(60);
      const sweepDone = actions.startSweep(7);
      await waitFor(() => (store.get().sweep?.done ?? 0) >= 6, 20000);
      await shot('11-best-mod-running');
      injectSweepDelay(0);
      await sweepDone;
      await settle();
      await shot('12-best-mod-results', { wait: 900 });
      actions.dismissSweep();

      // 13-15. Screenshot import: progress, review, and the "text but no mods" error.
      const braton = await recordedImport('braton');
      store.set({ ocr: { id: -1, phase: 'progress', source: 'file', step: 1, slow: false, image: null, error: null, review: null, lines: [], returnFocus: null } });
      await shot('13-ocr-progress', { wait: 500 });
      O.close({ restoreFocus: false });
      await O.importRecorded(braton.ocr, { imageUrl: braton.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      await shot('14-ocr-review', { wait: 900 });
      O.close({ restoreFocus: false });
      const vauban = await recordedImport('vauban');
      await O.importRecorded(vauban.ocr, { imageUrl: vauban.imageUrl });
      await waitFor(() => $('[data-testid="ocr-error"]'), 5000);
      await shot('15-ocr-error-no-mods');
      O.close({ restoreFocus: false });

      // 14b. Tiberon Prime: an empty arcane socket is "Empty", not a Check prompt.
      const tiberon = await recordedImport('tiberon');
      await O.importRecorded(tiberon.ocr, { imageUrl: tiberon.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      await shot('14b-ocr-review-empty-arcane', { wait: 900 });
      O.close({ restoreFocus: false });
      // 14c. Kuva Sobek (Japanese client): the arcane's name isn't readable; Apply to current build keeps the
      // open build's arcane and covered slots, and says so.
      const sobek = await recordedImport('sobek');
      await O.importRecorded(sobek.ocr, { imageUrl: sobek.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      (await waitFor(() => $('[data-testid="ocr-kept-note"]'), 3000).catch(() => null))?.scrollIntoView({ block: 'end' });
      await shot('14c-ocr-review-unreadable-arcane', { wait: 900 });
      O.close({ restoreFocus: false });
      // 14d. Replace on Braton's slot 2: Serration clashes with Amalgam Serration and says so.
      await O.importRecorded(braton.ocr, { imageUrl: braton.imageUrl });
      await waitFor(() => $('[data-testid="ocr-review"]'), 5000);
      $('[data-key="slot-1"] [data-testid="ocr-replace"]')?.click();
      const pickSearch = await waitFor(() => $('input[aria-describedby="ocr-pick-help-slot-1"]'), 3000);
      if (pickSearch) typeInto(pickSearch, 'serration');
      await shot('14d-ocr-replace-clash', { wait: 900 });
      key(document.activeElement, 'Escape');
      O.close({ restoreFocus: false });

      // 16. Over capacity: the Catalyst off.
      actions.setCatalyst(false);
      await shot('16-over-capacity');
      actions.setCatalyst(true);

      // 17. Text cards everywhere (what the app shows without core/images).
      actions.setTextCards(true);
      await shot('17-text-cards', { wait: 600 });
      // 17b. Arcanes without art use the text card layout too.
      actions.setGalleryQuery('');
      actions.setGalleryTab('arcanes');
      await shot('17b-arcane-text-cards', { wait: 600 });
      actions.setGalleryTab('mods');
      actions.setTextCards(false);

      // 21. Forced colours (Windows high contrast), emulated.
      await uf.sceneEmulate([{ name: 'forced-colors', value: 'active' }]);
      await shot('21-forced-colors', { wait: 800 });
      await uf.sceneEmulate([]);
      await sleep(300);

      // Regression scenes from the previous redesign.
      await actions.runNow();
      await settle();
      actions.pinResult();
      actions.setTarget({ steelPath: true });
      await actions.runNow();
      await settle();
      actions.pinResult();
      actions.setCompareOpen(true);
      await sleep(300);
      await shot('22-compare-two-pins', { wait: 600 });
      actions.setCompareOpen(false);

      actions.setResultsTab('target');
      await shot('23-target-tab');
      actions.setResultsTab('notes');
      actions.setNotes('Rotation: open with Stormbringer procs.');
      actions.endTextEdit();
      await shot('24-notes-tab');
      actions.setResultsTab('charts');

      await showLibrary('featured');
      await shot('25-featured-tab');
      await hideOverlayLibrary();

      actions.setName('Braton Prime crit and toxin');
      await actions.save();
      await showLibrary('mine');
      await shot('26-saved-build-library');
      clearToasts();
      await sleep(300);
      await actions.deleteCurrent();
      await shot('27-delete-undo-toast', { keepToasts: true, wait: 600 });
      await hideOverlayLibrary();

      clearToasts();
      actions.openDialog('shortcuts');
      await shot('28-shortcuts-dialog');
      actions.closeDialog();
      await sleep(200);

      {
        const ctx = store.get().ctx;
        const featured = ctx.featured.find(f => f.weaponType === 'Primary' && f.source?.arcanes?.length) ?? ctx.featured[0];
        await actions.newBuild({ force: true });
        await settle();
        if (featured) await actions.openFeatured(featured.key);
        await actions.runNow();
        await settle();
        await shot('29-featured-opened', { wait: 700 });
      }

      injectSimError('Injected by scene capture: the engine rejected this build input.');
      await actions.runNow();
      await settle();
      await shot('30-simulation-error');
      injectSimError(null);
      await actions.runNow();

      // 31. A gallery card with keyboard focus: the focus ring is drawn inside the card, over the art.
      resetGallery();
      typeInto(search(), 'cc ');
      const focusCard = await waitFor(() => $('[data-testid="gallery-card"]'), 3000);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
      focusCard?.focus();
      // Before the details flyout (600 ms after keyboard focus) covers the card.
      await shot('31-gallery-card-keyboard-focus', { wait: 250 });
      focusCard?.blur();

      // (32, the kitgun arcane slots, is gone: kitguns aren't offered until grip and loader parts are composed.)
    }

    if (size === 'wide') {
      // 20. The stacked layout: 1920x1080 at 200% zoom, scrolled to the gallery with the sticky DPS bar.
      resetGallery();
      await uf.sceneZoom(2);
      await sleep(800);
      await shot('20-stacked-zoom200', { wait: 600 });
      const area = $('[data-scroll-region][role="region"]');
      const gallery = $('[data-testid="gallery"]');
      if (area && gallery) area.scrollTop = gallery.offsetTop + 200;
      await shot('20b-stacked-zoom200-gallery', { wait: 700 });
      await uf.sceneZoom(1);
    }

    log(`done: ${saved.length} scenes`);
    await uf.scenesDone();
  } catch (e) {
    console.error(e);
    await uf.scenesFailed(`scenes: ${e?.message ?? e}`);
  }
}
