// Dialog for choosing the mod in one slot.
import { h, arrowNav } from './dom.js';
import { modal } from './dialogs.js';
import { EXILUS_SLOT, modCandidates, polarityInfo, rarityKey, unhandledByMod } from '../model.js';
import { collectModifiers } from '../../shared/stats.js';
import { maxRank } from '../../shared/mods.js';

export const slotLabel = slot => (slot === EXILUS_SLOT ? 'Exilus' : `Slot ${slot + 1}`);

/** Stats of a mod the local stat model ignores, at max rank (cached per mod). */
const partialCache = new Map();
export function unmodeledStats(ctx, modName) {
  if (!partialCache.has(modName)) {
    const mod = ctx.index.byName.get(modName);
    const m = collectModifiers([{ name: modName, rank: maxRank(mod) }], ctx.index.byName, null);
    partialCache.set(modName, unhandledByMod(m.unhandled).get(modName) ?? []);
  }
  return partialCache.get(modName);
}

/** True when a mod has no numeric stats in the data at all: its effect, if any, is up to the engine. */
export function hasNoStats(ctx, modName) {
  return !ctx.index.byName.get(modName)?.Stats?.length;
}

function modOption(ctx, c, onPick) {
  const pol = polarityInfo(c.mod.Polarity);
  const partial = unmodeledStats(ctx, c.name);
  return h('button', {
    class: `mod-option rarity-${rarityKey(c.mod.Rarity)}`, type: 'button', disabled: Boolean(c.conflict),
    'aria-describedby': null, onClick: () => onPick(c.name),
  },
    h('span', { class: 'mod-option-head' },
      h('span', { class: 'mod-option-name' }, c.name),
      h('span', { class: 'mod-tags' },
        partial.length ? h('span', { class: 'badge warn', title: `Not simulated: ${partial.join(', ')}` }, 'partial') : null,
        h('span', { class: 'pol', title: `${pol.label} polarity` }, pol.symbol, ' ', pol.label),
        h('span', { class: 'drain', title: 'Base drain' }, String(c.mod['Base Drain'] ?? '')))),
    h('span', { class: 'mod-option-desc' }, String(c.mod.Description ?? '').replace(/\r?\n/g, ' ') || 'No description'),
    c.conflict ? h('span', { class: 'mod-option-conflict' }, c.conflict) : null);
}

/**
 * Open the picker for a slot. Resolves when the dialog closes.
 * @param {object} app
 * @param {number} slot
 */
export function openModPicker(app, slot) {
  const { ctx, build } = app.store.get();
  const current = build.mods[slot];
  return modal(close => {
    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Search by name or effect (e.g. "crit", "toxin")', 'aria-label': 'Search mods',
    });
    const list = h('div', { class: 'mod-list' });
    arrowNav(list, '.mod-option');
    const pick = name => {
      if (app.actions.equipMod(slot, name)) close(name);
    };

    function fill() {
      const q = search.value;
      const all = modCandidates(ctx, app.store.get().build, slot, q);
      list.replaceChildren();
      if (!all.length) {
        list.append(h('p', { class: 'empty' }, q ? 'No compatible mods match your search.' : 'No compatible mods for this slot.'));
        return;
      }
      const popular = q ? [] : all.filter(c => c.popular);
      if (popular.length) {
        list.append(h('h3', { class: 'list-heading' }, 'Common picks'), h('div', { class: 'mod-grid' }, popular.map(c => modOption(ctx, c, pick))));
        list.append(h('h3', { class: 'list-heading' }, 'All compatible mods'));
      }
      list.append(h('div', { class: 'mod-grid' }, all.map(c => modOption(ctx, c, pick))));
    }

    search.addEventListener('input', fill);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        list.querySelector('.mod-option:not(:disabled)')?.click();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        list.querySelector('.mod-option:not(:disabled)')?.focus();
      }
    });
    fill();
    queueMicrotask(() => search.focus());

    const footer = [];
    if (current) {
      footer.push(h('button', { class: 'btn', type: 'button', onClick: () => { app.actions.clearSlot(slot); close(null); } }, `Remove ${current.name}`));
    } else {
      footer.push(h('button', {
        class: 'btn', type: 'button', title: 'Simulate every compatible mod in this slot and rank them by DPS gain',
        onClick: () => { close(null); app.actions.startSweep(slot); },
      }, 'Find best mod for this slot'));
    }

    return h('div', { class: 'dialog-body wide' },
      h('div', { class: 'dialog-head' },
        h('h2', { class: 'dialog-title' }, `Choose a mod · ${slotLabel(slot)}`,
          slot === EXILUS_SLOT ? h('span', { class: 'muted small' }, ' (Exilus mods only)') : null),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => close(null) }, '×')),
      search,
      list,
      h('div', { class: 'dialog-actions spread' },
        h('span', { class: 'muted small' }, 'Greyed-out mods conflict with one you already have equipped.'),
        h('span', null, footer)));
  }, { className: 'mod-picker' });
}
