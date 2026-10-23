// Compare tray: pinned results side by side, DPS change vs the first pin.
import { h, render } from './dom.js';
import { compareRows } from '../model.js';
import { fmtInt, fmtSignedPct } from '../format.js';

export function mountCompare(root, app) {
  const { actions } = app;
  const body = h('div', { class: 'compare-body' });
  const clearBtn = h('button', { class: 'link-btn small', type: 'button', onClick: () => actions.clearPins() }, 'Clear all');
  render(root,
    h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Compare'), clearBtn),
    body);

  return (state, prev) => {
    if (state.pins === prev?.pins) return;
    clearBtn.hidden = !state.pins.length;
    if (!state.pins.length) {
      render(body, h('p', { class: 'empty' }, 'Pin a result to compare builds, mods or targets side by side.'));
      return;
    }
    const rows = compareRows(state.pins);
    render(body, h('div', { class: 'table-wrap' }, h('table', { class: 'compare' },
      h('thead', null, h('tr', null,
        ['Build', 'Weapon', 'Mode', 'Target', 'Avg DPS', 'vs first', 'TTK', ''].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((r, i) => h('tr', null,
        h('th', { scope: 'row' }, r.buildName, i === 0 ? h('span', { class: 'chip' }, 'baseline') : null),
        h('td', null, r.weaponName),
        h('td', null, r.modeName),
        h('td', null, r.target),
        h('td', { class: 'num' }, fmtInt(r.avgDps)),
        h('td', { class: `num ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}` }, r.delta == null ? '—' : fmtSignedPct(r.delta)),
        h('td', { class: 'num' }, r.ttkText),
        h('td', null, h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove pin ${r.buildName}`, onClick: () => actions.unpin(r.id) }, '×'))))))));
  };
}
