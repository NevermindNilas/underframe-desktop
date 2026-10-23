// Right column: the modded weapon's sheet stats for the selected fire mode.
import { h, render } from './dom.js';
import { fmtNum, fmtPct, fmtSignedPct, fmtSeconds } from '../format.js';

const TYPE_ORDER = ['Impact', 'Puncture', 'Slash', 'Heat', 'Cold', 'Electricity', 'Toxin', 'Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral', 'Void', 'True'];

export const damageTypeClass = type => `dt-${String(type).toLowerCase().replace(/[^a-z]/g, '')}`;

export function mountStats(root, app) {
  const title = h('h2', { class: 'panel-title' }, 'Weapon stats');
  const body = h('div', { class: 'stats-body' });
  render(root, title, body);

  function update(state) {
    const { stats } = app.derived();
    const mode = stats?.mode;
    if (!mode) {
      render(body, h('p', { class: 'empty' }, 'Pick a weapon to see its stats.'));
      return;
    }
    title.replaceChildren('Weapon stats', h('span', { class: 'panel-sub' }, mode.mode_name));
    const types = Object.entries(mode.finalDamageTypes)
      .sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]));
    const max = Math.max(1, ...types.map(([, v]) => v));
    const hasReload = Boolean(stats.reload);
    const faction = state.build.enemy.faction;

    const rows = [
      ['Crit chance', fmtPct(mode.finalCritChance), `Base ${fmtPct(mode.baseCritChance)}`],
      ['Crit multiplier', `${fmtNum(mode.finalCritMultiplier, 2)}×`, `Base ${fmtNum(mode.baseCritMultiplier, 2)}×`],
      ['Status chance', fmtPct(mode.perProjectileStatusChance), 'Per projectile'],
      ['Multishot', fmtNum(mode.finalMultishot, 2), 'Projectiles per shot'],
      ['Fire rate', `${fmtNum(mode.finalFireRate, 2)}/s`, `Base ${fmtNum(mode.baseFireRate, 2)}/s`],
      ['Magazine', hasReload ? fmtNum(mode.magazineSize, 0) : 'n/a', hasReload ? 'Rounds' : 'No reload data'],
      ['Reload', hasReload ? fmtSeconds(mode.reloadTime) : 'n/a', ''],
      ['Faction bonus', mode.factionDamage ? `${fmtSignedPct(mode.factionDamage, 0)}` : 'None', mode.factionDamage ? `vs ${faction}` : `No bane mod for ${faction}`],
    ];

    render(body,
      h('div', { class: 'dmg' },
        h('div', { class: 'dmg-head' }, h('span', null, 'Damage per projectile'), h('strong', null, fmtNum(mode.totalFinalDamage, 1))),
        types.length ? h('ul', { class: 'dmg-bars', 'aria-label': 'Damage by type' }, types.map(([type, v]) => h('li', { class: `dmg-row ${damageTypeClass(type)}` },
          h('span', { class: 'dmg-label' }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), type),
          h('span', { class: 'dmg-track', 'aria-hidden': 'true' }, h('span', { class: 'dmg-fill', style: { width: `${(v / max) * 100}%` } })),
          h('span', { class: 'dmg-value' }, fmtNum(v, 1)))))
          : h('p', { class: 'empty' }, 'No damage data for this mode.')),
      h('dl', { class: 'stat-list' }, rows.map(([k, v, hint]) => h('div', { class: 'stat' },
        h('dt', null, k),
        h('dd', null, h('span', { class: 'stat-value' }, v), hint ? h('span', { class: 'stat-hint' }, hint) : null)))),
      h('p', { class: 'hint' }, 'Sheet values before enemy armor and resistances. The simulation below accounts for those.'));
  }

  return (state, prev) => {
    if (state.build !== prev?.build) update(state);
  };
}
