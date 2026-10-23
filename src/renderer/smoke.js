// Scripted end-to-end check (UF_SMOKE=1). Drives the same actions the UI buttons call, then reports via uf.smokeResult.
import { resolvePresetName, ttkText } from './model.js';

export const SMOKE_PLAN = {
  weapon: 'Braton Prime',
  mods: [['Serration', 10], ['Split Chamber', 5], ['Point Strike', 5], ['Infected Clip', 5]],
  target: 'Elite Crewmen',
};

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const frames = async n => { for (let i = 0; i < n; i++) await nextFrame(); };
const log = msg => console.info(`[smoke] ${msg}`);

/** Screenshot hook; a failed capture is reported but does not stop the flow. */
async function capture(uf, tag, errors) {
  try {
    await uf.smokeCapture?.(tag);
  } catch (e) {
    errors.push(`capture ${tag}: ${e?.message ?? e}`);
  }
}

/** Open the picker on the first empty slot through the real button, check it lists mods, screenshot, close. */
async function checkModPicker(app, errors, checks) {
  const button = document.querySelector('[aria-label="Slot 5: add a mod"]');
  if (!button) { errors.push('mod picker: Slot 5 add button not found'); return; }
  button.click();
  await frames(2);
  const dlg = document.querySelector('dialog.mod-picker[open]');
  if (!dlg) { errors.push('mod picker: dialog did not open'); return; }
  const options = dlg.querySelectorAll('.mod-option');
  const disabled = [...dlg.querySelectorAll('.mod-option:disabled .mod-option-name')].map(n => n.textContent);
  checks.pickerMods = options.length;
  if (!options.length) errors.push('mod picker: no mods listed');
  if (!disabled.includes('Serration')) errors.push('mod picker: equipped Serration is not greyed out');
  log(`mod picker lists ${options.length} options, ${disabled.length} greyed out`);
  await capture(app.uf, 'picker', errors);
  dlg.querySelector('.dialog-head .icon-btn')?.click();
  await frames(2);
  if (document.querySelector('dialog.mod-picker[open]')) errors.push('mod picker: did not close');
}

/** Save the build through the Save action, check it is listed, then delete it through the sidebar flow. */
async function checkSaveRemove(app, errors, checks) {
  const { actions, store, uf } = app;
  const saved = await actions.save();
  if (!saved?.id) { errors.push('save: no saved build returned'); return; }
  const listed = await uf.builds.list();
  if (!listed.some(b => b.id === saved.id)) errors.push('save: saved build is not in uf.builds.list()');
  if (saved.lastResult?.avgDps !== store.get().sim.summary?.avgDps) errors.push('save: lastResult was not stored');
  await frames(2);
  if (!document.querySelector('#tabpanel-mine .build-item.current')) errors.push('save: sidebar does not show the saved build');
  if (app.isDirty()) errors.push('save: build still marked as changed');
  log(`saved build ${saved.id}`);
  await capture(uf, 'saved', errors);

  const removing = actions.deleteSaved(saved.id);
  await frames(2);
  const confirm = document.querySelector('dialog[open] .btn.danger');
  if (!confirm) { errors.push('remove: confirm dialog did not open'); document.querySelector('dialog[open]')?.close(); }
  else confirm.click();
  await removing;
  const after = await uf.builds.list();
  if (after.some(b => b.id === saved.id)) errors.push('remove: build is still listed after delete');
  if (store.get().savedBuilds.some(b => b.id === saved.id)) errors.push('remove: build is still in the sidebar');
  checks.saveRemove = true;
  log('save and remove round trip done');
}

/** Show the Featured tab and check it has entries. Left open for the final screenshot. */
async function checkFeatured(app, errors, checks) {
  app.actions.setSidebarTab('featured');
  await frames(2);
  const items = document.querySelectorAll('#tabpanel-featured .build-item');
  checks.featured = items.length;
  if (!items.length) errors.push('featured: list is empty');
  log(`featured list shows ${items.length} builds`);
}

export async function runSmoke(app, { t0 }) {
  const { actions, store, uf, timings } = app;
  const errors = [];
  const checks = {};
  const started = performance.now();
  let summary = null;
  try {
    log('starting scripted build');
    await actions.newBuild({ force: true });
    actions.setWeapon(SMOKE_PLAN.weapon);
    SMOKE_PLAN.mods.forEach(([name, rank], slot) => {
      if (!actions.equipMod(slot, name, rank)) errors.push(`could not equip ${name}`);
    });
    const preset = resolvePresetName(store.get().ctx, SMOKE_PLAN.target);
    if (!preset) errors.push(`target preset not found: ${SMOKE_PLAN.target}`);
    else actions.setTarget({ preset });

    const simStart = performance.now();
    summary = await actions.runNow();
    timings.simMs = Math.round(performance.now() - simStart);
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
    const shown = document.querySelector('[data-testid="avg-dps"]')?.textContent ?? '';
    if (!shown || shown === '—') errors.push('Average DPS is not shown in the UI');
    if (!document.querySelector('.chart-svg path.line')) errors.push('health chart did not render');
    log(`simulated ${summary?.avgDps?.toFixed?.(1)} DPS`);

    // Charts sit below the fold at the default window size: scroll them into view for a screenshot.
    const center = document.querySelector('.col-center');
    document.querySelector('#results')?.scrollIntoView({ block: 'end' });
    await capture(uf, 'results', errors);
    if (center) center.scrollTop = 0;

    await checkModPicker(app, errors, checks);
    await checkSaveRemove(app, errors, checks);
    await checkFeatured(app, errors, checks);
    // Clear toasts so the final screenshot shows the app itself.
    document.querySelectorAll('.toast').forEach(t => t.remove());
    await nextFrame();
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
