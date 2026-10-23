// Best-mod search for one empty slot: progress, cancel, ranked results with Equip.
import { h, render } from './dom.js';
import { slotLabel } from './mod-picker.js';
import { fmtInt, fmtSignedPct } from '../format.js';

export function mountSweep(root, app) {
  const { actions } = app;
  root.hidden = true;

  return (state, prev) => {
    if (state.sweep === prev?.sweep && state.build?.mods === prev?.build?.mods) return;
    const sw = state.sweep;
    root.hidden = !sw;
    if (!sw) { root.replaceChildren(); return; }
    const running = sw.status === 'running';
    const pct = sw.total ? Math.round((sw.done / sw.total) * 100) : 0;
    const slotFree = !state.build.mods[sw.slot];
    const stale = sw.key !== app.simKey();
    render(root,
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title' }, `Best mod for ${slotLabel(sw.slot)}`),
        running
          ? h('button', { class: 'btn', type: 'button', onClick: () => actions.cancelSweep() }, 'Cancel')
          : h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close best-mod results', onClick: () => actions.dismissSweep() }, '×')),
      running || sw.status === 'cancelled' ? h('div', { class: 'progress-row' },
        h('progress', { max: sw.total, value: sw.done, 'aria-label': 'Best mod search progress' }),
        h('span', { class: 'muted small' }, running ? `Testing ${sw.done} of ${sw.total} mods (${pct}%)…` : `Cancelled after ${sw.done} of ${sw.total}.`)) : null,
      sw.status === 'error' ? h('p', { class: 'error-text', role: 'alert' }, sw.error) : null,
      stale && !running ? h('p', { class: 'warn-text' }, 'The build changed since this search ran; gains may be out of date.') : null,
      sw.results.length ? h('ol', { class: 'sweep-list' }, sw.results.map(r => h('li', { class: 'sweep-row' },
        h('span', { class: 'sweep-name' }, r.name, h('span', { class: 'muted small' }, ` R${r.rank}`)),
        h('span', { class: `sweep-gain ${r.gain > 0 ? 'up' : r.gain < 0 ? 'down' : ''}` }, fmtSignedPct(r.gain)),
        h('span', { class: 'sweep-dps muted' }, `${fmtInt(r.dps)} DPS`),
        h('button', {
          class: 'btn small', type: 'button', disabled: !slotFree || sw.weaponName !== state.build.weaponName,
          title: slotFree ? `Equip ${r.name} in ${slotLabel(sw.slot)}` : 'That slot is no longer empty',
          onClick: () => actions.equipMod(sw.slot, r.name, r.rank),
        }, 'Equip'))))
        : (!running ? h('p', { class: 'empty' }, 'No results.') : null),
      sw.baseDps != null ? h('p', { class: 'hint' }, `Baseline ${fmtInt(sw.baseDps)} DPS with the slot empty. Each mod tested at max rank over 3 seeded runs.`) : null);
  };
}
