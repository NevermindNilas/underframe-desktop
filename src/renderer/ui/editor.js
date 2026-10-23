// Center column, top: build name, weapon, fire mode and the nine mod slots.
import { h, render, syncValue } from './dom.js';
import { createCombobox } from './combobox.js';
import { openModPicker, slotLabel, hasNoStats } from './mod-picker.js';
import { SLOT_COUNT, EXILUS_SLOT, WEAPON_GROUPS, weaponMatches, polarityInfo, rarityKey } from '../model.js';
import { maxRank } from '../../shared/mods.js';

export function mountEditor(root, app) {
  const { actions } = app;

  const nameInput = h('input', { class: 'input build-name-input', type: 'text', maxlength: 120, 'aria-label': 'Build name' });
  nameInput.addEventListener('input', () => actions.setName(nameInput.value));
  const saveState = h('span', { class: 'save-state', role: 'status' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', title: 'Save build (Ctrl+S)', onClick: () => actions.save() }, 'Save');
  const notice = h('div', { class: 'notice', hidden: true });

  const weaponBox = createCombobox({
    label: 'Weapon',
    placeholder: 'Search weapons',
    groups: q => {
      const g = weaponMatches(app.store.get().ctx, q);
      return WEAPON_GROUPS.map(label => ({ label, items: g[label].map(w => ({ value: w.name, label: w.name, hint: w.subtype })) }));
    },
    onPick: name => actions.setWeapon(name),
  });

  const modeGroup = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Fire mode' });
  modeGroup.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const btns = [...modeGroup.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = btns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    next.click();
  });

  const slotsEl = h('div', { class: 'slots', role: 'list', 'aria-label': 'Mod slots' });
  const accuracy = h('p', { class: 'accuracy', hidden: true });

  render(root,
    h('div', { class: 'editor-head' },
      nameInput,
      h('div', { class: 'editor-head-actions' }, saveState, saveBtn)),
    notice,
    h('div', { class: 'editor-row' },
      weaponBox.el,
      h('div', { class: 'field' }, h('span', { class: 'field-label', id: 'mode-label' }, 'Fire mode'), modeGroup)),
    h('div', { class: 'section-head' },
      h('h2', { class: 'section-title' }, 'Mods'),
      h('span', { class: 'hint' }, 'Click a slot to choose a mod. Ranks default to max.')),
    slotsEl,
    accuracy);
  modeGroup.setAttribute('aria-labelledby', 'mode-label');

  function slotCard(state, i, partialMap) {
    const slot = state.build.mods[i];
    const label = slotLabel(i);
    const exilus = i === EXILUS_SLOT;
    if (!slot) {
      return h('div', { class: `slot empty${exilus ? ' exilus' : ''}`, role: 'listitem' },
        h('span', { class: 'slot-label' }, label),
        h('button', { class: 'slot-add', type: 'button', dataset: { focus: `add-${i}` }, onClick: () => openModPicker(app, i), 'aria-label': `${label}: add a mod` }, '+ Add mod'),
        h('button', {
          class: 'link-btn small', type: 'button', dataset: { focus: `best-${i}` }, onClick: () => actions.startSweep(i),
          title: 'Simulate every compatible mod here and rank them by DPS gain', 'aria-label': `${label}: find best mod`,
          disabled: state.sweep?.status === 'running',
        }, 'Find best mod'));
    }
    const mod = state.ctx.index.byName.get(slot.name);
    const max = maxRank(mod);
    const pol = polarityInfo(mod?.Polarity);
    const partial = partialMap.get(slot.name) ?? [];
    const noStats = hasNoStats(state.ctx, slot.name);
    return h('div', { class: `slot filled rarity-${rarityKey(mod?.Rarity)}${exilus ? ' exilus' : ''}`, role: 'listitem' },
      h('span', { class: 'slot-label' }, label, h('span', { class: 'pol', title: `${pol.label} polarity` }, pol.symbol)),
      h('button', {
        class: 'slot-name', type: 'button', dataset: { focus: `name-${i}` }, onClick: () => openModPicker(app, i),
        title: `${mod?.Description ?? ''}\n\nClick to change`, 'aria-label': `${label}: ${slot.name}, rank ${slot.rank} of ${max}. Change mod`,
      }, slot.name),
      h('div', { class: 'slot-badges' },
        partial.length ? h('span', { class: 'badge warn', tabindex: '0', title: `Partially simulated. Not modeled: ${partial.join(', ')}` }, 'partially simulated') : null,
        noStats ? h('span', { class: 'badge', tabindex: '0', title: 'This mod has no numeric stats in the data. Its effect is only included if the Underframe engine models it itself.' }, 'engine-only') : null),
      h('div', { class: 'slot-foot' },
        h('div', { class: 'stepper', role: 'group', 'aria-label': `${slot.name} rank` },
          h('button', { class: 'step', type: 'button', 'aria-label': 'Lower rank', dataset: { focus: `dec-${i}` }, disabled: slot.rank <= 0, onClick: () => actions.setRank(i, slot.rank - 1) }, '−'),
          h('span', { class: 'rank', 'aria-live': 'polite' }, `R${slot.rank}`, h('span', { class: 'muted' }, `/${max}`)),
          h('button', { class: 'step', type: 'button', 'aria-label': 'Raise rank', dataset: { focus: `inc-${i}` }, disabled: slot.rank >= max, onClick: () => actions.setRank(i, slot.rank + 1) }, '+')),
        h('button', { class: 'icon-btn', type: 'button', dataset: { focus: `rm-${i}` }, 'aria-label': `Remove ${slot.name}`, title: 'Remove', onClick: () => actions.clearSlot(i) }, '×')));
  }

  function renderSlots(state) {
    const focusKey = slotsEl.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const { partialMap } = app.derived();
    const cards = [];
    for (let i = 0; i < SLOT_COUNT; i++) cards.push(slotCard(state, i, partialMap));
    render(slotsEl, cards);
    if (focusKey) {
      const el = slotsEl.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (el && !el.disabled) el.focus();
      else slotsEl.querySelector(`[data-focus$="-${focusKey.split('-').pop()}"]:not(:disabled)`)?.focus();
    }
    const partialMods = [...partialMap.keys()].filter(n => state.build.mods.some(s => s?.name === n));
    accuracy.hidden = !partialMods.length;
    accuracy.textContent = partialMods.length
      ? `Partially simulated: some stats of ${partialMods.join(', ')} are not modeled, so results may be off for this build.`
      : '';
  }

  function renderModes(state) {
    const { stats } = app.derived();
    const focused = modeGroup.contains(document.activeElement);
    render(modeGroup, (stats?.selectable ?? []).map(m => h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(m.mode_name === state.build.modeName),
      tabindex: m.mode_name === state.build.modeName ? '0' : '-1', onClick: () => actions.setMode(m.mode_name),
    }, m.mode_name)));
    if (focused) modeGroup.querySelector('[aria-checked="true"]')?.focus();
  }

  function renderHead(state) {
    syncValue(nameInput, state.build.name);
    const dirty = app.isDirty();
    const unsaved = !state.build.id;
    saveState.textContent = state.saving ? 'Saving…' : unsaved ? (dirty ? 'Not saved yet · changed' : 'Not saved yet') : dirty ? 'Unsaved changes' : 'Saved';
    saveState.className = `save-state${dirty || unsaved ? ' dirty' : ' clean'}`;
    saveBtn.disabled = state.saving;
  }

  function renderNotice(state) {
    const n = state.buildNotice;
    notice.hidden = !n?.length;
    render(notice, n?.length ? [
      h('ul', null, n.map(t => h('li', null, t))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss note', onClick: () => actions.dismissNotice() }, '×'),
    ] : []);
  }

  return (state, prev) => {
    if (state.build !== prev?.build || state.snapshot !== prev?.snapshot || state.saving !== prev?.saving) renderHead(state);
    if (state.buildNotice !== prev?.buildNotice) renderNotice(state);
    if (state.build?.weaponName !== prev?.build?.weaponName) weaponBox.setValue(state.build.weaponName);
    if (state.build?.weaponName !== prev?.build?.weaponName || state.build?.modeName !== prev?.build?.modeName) renderModes(state);
    if (state.build?.mods !== prev?.build?.mods || state.build?.enemy?.faction !== prev?.build?.enemy?.faction || (state.sweep?.status === 'running') !== (prev?.sweep?.status === 'running')) renderSlots(state);
  };
}

