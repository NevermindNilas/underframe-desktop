// Right column, top: who you are shooting at.
import { h, render, syncValue } from './dom.js';
import { createCombobox } from './combobox.js';
import { CUSTOM_PRESET } from '../model.js';
import { resolveFaction } from '../../shared/factions.js';
import { fmtInt } from '../format.js';

const POOLS = [['hp', 'Health'], ['armor', 'Armor'], ['shields', 'Shields'], ['overguard', 'Overguard']];

function presetGroups(ctx, query) {
  const q = query.trim().toLowerCase();
  const byFaction = new Map();
  for (const name of ctx.presetNames) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const faction = resolveFaction(ctx.presets[name].faction).name;
    if (!byFaction.has(faction)) byFaction.set(faction, []);
    byFaction.get(faction).push({ value: name, label: name, hint: `L${ctx.presets[name].default_level ?? '?'}` });
  }
  const groups = [];
  if (!q || 'custom'.includes(q)) groups.push({ label: 'Your own numbers', items: [{ value: CUSTOM_PRESET, label: CUSTOM_PRESET, hint: 'set stats' }] });
  for (const f of ctx.factionNames) if (byFaction.has(f)) groups.push({ label: f, items: byFaction.get(f) });
  return groups;
}

function toggle(label, onChange, hint) {
  const input = h('input', { type: 'checkbox', class: 'switch-input', role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'switch', title: hint ?? null }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', null, label));
  return { el, input };
}

export function mountTarget(root, app) {
  const { actions } = app;
  const presetBox = createCombobox({
    label: 'Enemy',
    placeholder: 'Search enemies',
    groups: q => presetGroups(app.store.get().ctx, q),
    onPick: name => actions.setTarget({ preset: name }),
  });

  const level = h('input', { class: 'input', type: 'number', min: 1, max: 9999, step: 1, id: 'target-level' });
  level.addEventListener('change', () => actions.setTarget({ level: level.value }));
  const sp = toggle('Steel Path', v => actions.setTarget({ steelPath: v }), 'Steel Path: +250% health and shields');
  const headshot = toggle('Headshots', v => actions.setTarget({ headshot: v }), 'Every shot hits the head');

  const faction = h('select', { class: 'input', id: 'target-faction' });
  faction.addEventListener('change', () => actions.setTarget({ faction: faction.value }));

  const pools = h('div', { class: 'pools' });
  const poolInputs = {};

  render(root,
    h('h2', { class: 'panel-title' }, 'Target'),
    presetBox.el,
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Level'), level),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Faction'), faction)),
    h('div', { class: 'toggles' }, sp.el, headshot.el),
    pools);

  function renderFactions(state) {
    render(faction, state.ctx.factionNames.map(n => h('option', { value: n }, n)));
  }

  function renderPools(state, custom) {
    const { enemy } = app.derived();
    if (custom) {
      if (!pools.classList.contains('editable')) {
        pools.classList.add('editable');
        render(pools, POOLS.map(([k, label]) => {
          const input = h('input', { class: 'input', type: 'number', min: k === 'hp' ? 1 : 0, step: 1 });
          input.addEventListener('change', () => actions.setTarget({ [k]: input.value }));
          poolInputs[k] = input;
          return h('label', { class: `pool pool-${k}` }, h('span', { class: 'pool-label' }, label), input);
        }));
      }
      for (const [k] of POOLS) syncValue(poolInputs[k], enemy[k]);
    } else {
      pools.classList.remove('editable');
      render(pools, POOLS.map(([k, label]) => h('div', { class: `pool pool-${k}` },
        h('span', { class: 'pool-label' }, label),
        h('span', { class: 'pool-value' }, fmtInt(enemy[k])))));
    }
  }

  let factionsDone = false;
  return (state, prev) => {
    const e = state.build.enemy;
    if (e === prev?.build?.enemy && state.ctx === prev?.ctx) return;
    if (!factionsDone) { renderFactions(state); factionsDone = true; }
    const custom = e.preset === CUSTOM_PRESET;
    presetBox.setValue(e.preset);
    syncValue(level, custom ? '' : e.level);
    level.disabled = custom;
    level.placeholder = custom ? 'n/a' : '';
    sp.input.checked = Boolean(e.steelPath);
    sp.input.disabled = custom;
    headshot.input.checked = Boolean(e.headshot);
    if (document.activeElement !== faction) faction.value = e.faction;
    renderPools(state, custom);
  };
}
