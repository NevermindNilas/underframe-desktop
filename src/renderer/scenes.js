// Scene-capture mode (UF_SCENES=<dir>): drive the real UI through the states reviewers check and save a PNG
// of each (main writes the files and prints UF_SCENES_DONE <json list>). Uses the same actions as the UI.
import { clearToasts, injectSimError, injectSweepDelay, store } from './controller.js';
import { resolvePresetName, EXILUS_SLOT } from './model.js';
import { waitFor } from './smoke.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);
const log = msg => console.info(`[scenes] ${msg}`);

const FULL_BUILD = [
  ['Serration', 10], ['Split Chamber', 5], ['Point Strike', 5], ['Vital Sense', 5],
  ['Infected Clip', 5], ['Stormbringer', 5], ['Hellfire', 5], ['Cryo Rounds', 5],
];
const EXILUS_MOD = 'Vile Precision';

const simSettled = () => {
  const { sim } = store.get();
  return sim.status === 'done' || sim.status === 'error';
};

async function settle(ms = 350) {
  await waitFor(simSettled, 15000);
  await sleep(ms);
}

/** Type into an input the way a user does, so React sees the change. */
function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function runScenes(app) {
  const { actions, uf } = app;
  const saved = [];
  const shot = async name => {
    clearToasts();
    await sleep(450);
    const file = await uf.sceneCapture(name);
    if (file) saved.push(file);
    log(`captured ${name}`);
  };
  const shotKeepToasts = async name => {
    await sleep(600);
    const file = await uf.sceneCapture(name);
    if (file) saved.push(file);
    log(`captured ${name}`);
  };
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

  try {
    await waitFor(() => $('[data-testid="result-card"]'), 10000);

    // 1. Empty / new build.
    await actions.newBuild({ force: true });
    actions.setWeapon('Braton Prime');
    actions.setTarget({ preset: resolvePresetName(store.get().ctx, 'Elite Crewman') });
    await actions.runNow();
    await settle();
    await shot('empty-new-build');

    // 2. Full build with results.
    FULL_BUILD.forEach(([name, rank], slot) => actions.equipMod(slot, name, rank, { focus: false }));
    actions.equipMod(EXILUS_SLOT, EXILUS_MOD, undefined, { focus: false });
    await actions.runNow();
    await settle();
    // A second edit gives the result card a change badge against the previous result.
    actions.setRank(1, 4);
    await actions.runNow();
    await settle();
    await waitFor(() => $('[data-testid="health-chart"] svg path'), 5000);
    await shot('full-build-results');

    // 3. Mod picker with a search typed.
    actions.openPicker(7);
    const search = await waitFor(() => $('[data-testid="mod-picker"] input'));
    if (search) typeInto(search, 'toxin');
    await sleep(300);
    await shot('picker-search');

    // 4. A conflict shown in the picker: search Serration (equipped in slot 1, Amalgam Serration conflicts).
    if (search) typeInto(search, 'serration');
    await sleep(300);
    const blocked = await waitFor(() => $('[data-testid="mod-option"][aria-disabled="true"][data-mod-name="Amalgam Serration"]')
      ?? $('[data-testid="mod-option"][aria-disabled="true"]'));
    blocked?.focus();
    await sleep(200);
    await shot('picker-conflict');
    actions.closePicker();
    await sleep(300);

    // 5. Sweep running (on a filled slot: "Find a better mod").
    injectSweepDelay(60);
    const sweepDone = actions.startSweep(7);
    await waitFor(() => (store.get().sweep?.done ?? 0) >= 6, 20000);
    await shot('sweep-running');
    injectSweepDelay(0);

    // 6. Sweep results.
    await sweepDone;
    await settle();
    await shot('sweep-results');

    // 6b. Replace with the top result: the other results stay usable, the new mod is marked Equipped.
    {
      const top = store.get().sweep?.all?.find(r => r.name !== store.get().build.mods[7]?.name);
      if (top) actions.equipMod(7, top.name, top.rank, { focus: false });
      await settle();
      await shot('sweep-after-replace');
    }

    // 7. Compare tray with two pins.
    await actions.runNow();
    await settle();
    actions.pinResult();
    actions.setTarget({ steelPath: true });
    await actions.runNow();
    await settle();
    actions.pinResult();
    actions.setCompareOpen(true);
    actions.setResultsTab('charts');
    await sleep(300);
    await shot('compare-two-pins');
    actions.setCompareOpen(false);

    // 8. Featured tab.
    await showLibrary('featured');
    await shot('featured-tab');
    await hideOverlayLibrary();

    // 9. Custom target expanded.
    actions.setTarget({ preset: 'Custom' });
    await actions.runNow();
    await settle();
    document.getElementById('target-card')?.scrollIntoView({ block: 'start' });
    await sleep(300);
    await shot('custom-target');
    actions.setTarget({ preset: resolvePresetName(store.get().ctx, 'Elite Crewman') });
    await actions.runNow();
    await settle();
    document.querySelector('[data-pane="editor"]')?.scrollTo({ top: 0 });

    // 10. A saved build in the library.
    actions.setName('Braton Prime crit and toxin');
    await actions.save();
    await showLibrary('mine');
    await shot('saved-build-library');

    // 11. Delete with the undo toast.
    clearToasts();
    await sleep(300);
    await actions.deleteCurrent();
    await shotKeepToasts('delete-undo-toast');
    await hideOverlayLibrary();

    // 12. Keyboard shortcuts dialog.
    clearToasts();
    actions.openDialog('shortcuts');
    await sleep(300);
    await shot('shortcuts-dialog');
    actions.closeDialog();
    await sleep(200);

    // Extra: the Stats tab and the About dialog.
    actions.setResultsTab('stats');
    await shot('stats-tab');
    actions.setResultsTab('charts');
    actions.openDialog('about');
    await sleep(300);
    await shot('about-dialog');
    actions.closeDialog();

    // Extra: a featured build opened as an unsaved copy (notes filled, unapplied-features notice).
    {
      const ctx = store.get().ctx;
      const featured = ctx.featured.find(f => f.weaponType === 'Primary' && f.description) ?? ctx.featured[0];
      await actions.newBuild({ force: true });
      await settle();
      if (featured) await actions.openFeatured(featured.key);
      await actions.runNow();
      await settle();
      await shot('featured-opened');
    }

    // Extra: closing the window with unsaved changes asks Save / Don't save / Cancel (main's close guard).
    actions.setNotes('Rotation: open with Stormbringer procs.');
    actions.endTextEdit();
    await uf.sceneRequestClose();
    const leave = await waitFor(() => store.get().dialog?.type === 'leave', 6000);
    if (leave) {
      await shot('close-save-changes-dialog');
      await actions.answerLeave('cancel');
      await sleep(300);
    } else {
      throw new Error('closing with unsaved changes did not ask to save');
    }

    // 13. Error state: a simulation error injected only in scene mode.
    injectSimError('Injected by scene capture: the engine rejected this build input.');
    await actions.runNow();
    await settle();
    await shot('simulation-error');
    injectSimError(null);

    log(`done: ${saved.length} scenes`);
    await uf.scenesDone();
  } catch (e) {
    console.error(e);
    await uf.scenesFailed(`scenes: ${e?.message ?? e}`);
  }
}
