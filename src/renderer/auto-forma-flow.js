// Auto Forma in the app: the dialog's state (store.autoForma), the plans for the open build (src/shared/auto-forma.js)
// and applying one as one undo step (the polarities, the moved mods and any raised ranks together).
//
// store.autoForma: null, or { options: { moveMods, fromScratch, maxRanks } }. The plans are worked out from the build
// as it is each time the dialog renders: the search is exact and takes milliseconds.
import { announce, commitBuildForImport as commitBuild, focusLater, notify, store, actions } from './controller.js';
import * as M from './model.js';
import { pinnedSlot, planForma } from '../shared/auto-forma.js';

export const DEFAULT_AUTO_FORMA_OPTIONS = Object.freeze({ moveMods: true, fromScratch: false, maxRanks: false });
let opener = null;
let lastOptions = DEFAULT_AUTO_FORMA_OPTIONS;

/** The plans for a build (planForma's result) with the dialog's options. */
export function autoFormaFor(ctx, build, options = DEFAULT_AUTO_FORMA_OPTIONS) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  const { innate, effective } = M.slotPolaritiesOf(ctx, build);
  return planForma({
    mods: build.mods,
    innate,
    effective,
    modByName: n => ctx.index.byName.get(n),
    catalyst: build.catalyst !== false,
    progenitor: Boolean(weapon?.is_progenitor),
    fromScratch: options.fromScratch,
    maxRanks: options.maxRanks,
    moveMods: options.moveMods,
    pinned: s => pinnedSlot(ctx.index.byName, s),
  });
}

/** "Serration: slot 1 → slot 5" for each move of a plan. */
export const movesText = moves => (moves ?? []).map(m => `${m.name}: ${M.slotLabel(m.from).toLowerCase()} → ${M.slotLabel(m.to).toLowerCase()}`);

/** Whether a plan changes anything on the build. */
export const planChanges = (plan, raised) => Boolean(plan && (plan.changes.length || plan.moves.length || raised));

export function openAutoForma() {
  const s = store.get();
  if (!s.build || s.autoForma) return false;
  opener = document.activeElement;
  store.set({ autoForma: { options: lastOptions } });
  return true;
}

export function closeAutoForma() {
  if (!store.get().autoForma) return;
  store.set({ autoForma: null });
  const el = opener;
  opener = null;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (el?.isConnected && !el.closest?.('[role="dialog"], [role="alertdialog"]')) el.focus();
    else focusLater('auto-forma-open');
  }));
}

export function setAutoFormaOptions(patch) {
  const af = store.get().autoForma;
  if (!af) return;
  lastOptions = { ...af.options, ...patch };
  store.set({ autoForma: { ...af, options: lastOptions } });
}

/**
 * Apply plan `index` of the build's plans with the dialog's options, as one undoable edit, and say what changed in a
 * toast with Undo. The plan is worked out again here, so it always belongs to the build as it is.
 */
export function applyAutoForma(index) {
  const s = store.get();
  if (!s.autoForma || !s.build) return false;
  const r = autoFormaFor(s.ctx, s.build, s.autoForma.options);
  const plan = r.options[index];
  if (!planChanges(plan, r.raised)) {
    closeAutoForma();
    return false;
  }
  const next = M.withFormaPlan(s.ctx, { ...s.build, mods: plan.mods }, plan.changes);
  commitBuild(next);
  closeAutoForma();
  const after = M.snapshotOf(store.get().build);
  const forma = plan.changes.length;
  const title = `Auto Forma applied: ${forma ? `${forma} Forma` : 'no Forma'}, ${plan.used} / ${plan.capacity} capacity`;
  const body = [
    forma ? `${M.formaPlanText(plan.changes).join(', ')}.` : '',
    plan.moves.length ? `Moved ${movesText(plan.moves).join(', ')}.` : '',
    r.raised ? `${r.raised} ${r.raised === 1 ? 'mod' : 'mods'} raised to max rank.` : '',
  ].filter(Boolean).join(' ');
  announce(`${title}. ${body}`);
  notify({
    intent: 'success',
    title,
    body: body || null,
    action: {
      label: 'Undo',
      run: () => {
        if (M.snapshotOf(store.get().build) === after) actions.undo();
        else notify({ intent: 'info', title: "Couldn't undo: the build changed since. Use Ctrl+Z to step back." });
      },
    },
    ctrlZ: true,
  });
  return true;
}
