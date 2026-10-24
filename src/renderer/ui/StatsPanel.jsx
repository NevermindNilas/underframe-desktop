// Stats tab: the modded weapon sheet for the selected fire mode, with base values and changes marked.
import { Body1Strong, Caption1, Subtitle2, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDownRegular, ArrowUpRegular } from '@fluentui/react-icons';
import { useApp, useDerived, useMediaQuery } from '../hooks.js';
import { fmtNum, fmtPct, fmtSeconds, fmtSignedPct } from '../format.js';
import { byDamageTypeOrder, damageTypeColor } from '../palette.js';

const useStyles = makeStyles({
  head: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalS, marginBottom: tokens.spacingVerticalM },
  caption: { color: tokens.colorNeutralForeground2 },
  total: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: tokens.spacingVerticalXS },
  num: { fontVariantNumeric: 'tabular-nums' },
  types: { listStyle: 'none', margin: `0 0 ${tokens.spacingVerticalL}`, padding: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  type: { display: 'grid', gridTemplateColumns: '12px minmax(0, 5fr) minmax(0, 6fr) 56px', alignItems: 'center', gap: tokens.spacingHorizontalS, minHeight: '24px' },
  swatch: { width: '10px', height: '10px', borderRadius: tokens.borderRadiusSmall },
  track: { height: '8px', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorNeutralStroke3, overflow: 'hidden' },
  fill: { display: 'block', height: '100%', borderRadius: tokens.borderRadiusCircular },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  dl: { margin: 0, display: 'flex', flexDirection: 'column' },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} 0`,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  dd: { margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  valueLine: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXXS },
  up: { color: tokens.colorStatusSuccessForeground1, display: 'inline-flex' },
  down: { color: tokens.colorStatusDangerForeground1, display: 'inline-flex' },
  base: { color: tokens.colorNeutralForeground2 },
  foot: { color: tokens.colorNeutralForeground2, marginTop: tokens.spacingVerticalM, display: 'block' },
});

function Change({ value, base, better = 'up' }) {
  const styles = useStyles();
  if (!Number.isFinite(value) || !Number.isFinite(base) || Math.abs(value - base) < 1e-9) return null;
  const up = value > base;
  const good = better === 'up' ? up : !up;
  return (
    <span className={good ? styles.up : styles.down} role="img" aria-label={up ? 'higher than base' : 'lower than base'}>
      {up ? <ArrowUpRegular /> : <ArrowDownRegular />}
    </span>
  );
}

export function StatsPanel() {
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const faction = useApp(s => s.build.enemy.faction);
  const { stats, statsError } = useDerived();
  if (statsError) return <Caption1>Couldn't compute stats for this mode.</Caption1>;
  const mode = stats?.mode;
  if (!mode) return <Caption1>No damage data for this fire mode.</Caption1>;
  const types = Object.entries(mode.finalDamageTypes).sort((a, b) => byDamageTypeOrder(a[0], b[0]));
  const max = Math.max(1, ...types.map(([, v]) => v));
  const reload = stats.reload;
  const rows = [
    ['Crit chance', fmtPct(mode.finalCritChance), `Base ${fmtPct(mode.baseCritChance)}`, mode.finalCritChance, mode.baseCritChance],
    ['Crit multiplier', `${fmtNum(mode.finalCritMultiplier, 2)}×`, `Base ${fmtNum(mode.baseCritMultiplier, 2)}×`, mode.finalCritMultiplier, mode.baseCritMultiplier],
    ['Status chance', fmtPct(mode.perProjectileStatusChance), `Base ${fmtPct(mode.baseStatusChance)} per projectile`, mode.perProjectileStatusChance, mode.baseStatusChance],
    ['Multishot', fmtNum(mode.finalMultishot, 2), `Base ${fmtNum(Number(mode.multishot) || 1, 2)}`, mode.finalMultishot, Number(mode.multishot) || 1],
    ['Fire rate', `${fmtNum(mode.finalFireRate, 2)}/s`, `Base ${fmtNum(mode.baseFireRate, 2)}/s`, mode.finalFireRate, mode.baseFireRate],
    ['Magazine', reload ? fmtNum(mode.magazineSize, 0) : 'n/a', reload ? `Base ${fmtNum(reload.magazine_size, 0)}` : 'No reload data', reload ? mode.magazineSize : NaN, reload?.magazine_size],
    ['Reload', reload ? fmtSeconds(mode.reloadTime) : 'n/a', reload ? `Base ${fmtSeconds(reload.reload_time)}` : 'No reload data', reload ? mode.reloadTime : NaN, reload?.reload_time, 'down'],
    ['Faction bonus', mode.factionDamage ? fmtSignedPct(mode.factionDamage, 0) : 'None', mode.factionDamage ? `vs ${faction}` : `No bane mod for ${faction}`, mode.factionDamage, 0],
  ];
  return (
    <section aria-labelledby="stats-heading">
      <div className={styles.head}>
        <Subtitle2 as="h3" id="stats-heading">Weapon stats</Subtitle2>
        <Caption1 className={styles.caption}>{mode.mode_name}</Caption1>
      </div>
      <div className={styles.total}>
        <Caption1>Damage per projectile</Caption1>
        <Body1Strong className={styles.num}>{fmtNum(mode.totalFinalDamage, 1)}</Body1Strong>
      </div>
      {types.length ? (
        <ul className={styles.types} aria-label="Damage by type">
          {types.map(([type, v]) => {
            const color = damageTypeColor(type, dark) ?? tokens.colorNeutralForeground3;
            return (
              <li key={type} className={styles.type}>
                <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />
                <Caption1>{type}</Caption1>
                <span className={styles.track} aria-hidden="true">
                  <span className={`${styles.fill} uf-bar-fill`} style={{ width: `${(v / max) * 100}%`, backgroundColor: color }} />
                </span>
                <Caption1 className={styles.value}>{fmtNum(v, 1)}</Caption1>
              </li>
            );
          })}
        </ul>
      ) : <Caption1 as="p">No damage data for this fire mode.</Caption1>}
      <dl className={styles.dl}>
        {rows.map(([label, value, base, now, was, better]) => (
          <div key={label} className={styles.stat}>
            <dt><Caption1>{label}</Caption1></dt>
            <dd className={styles.dd}>
              <span className={styles.valueLine}>
                <Change value={now} base={was} better={better} />
                <Body1Strong className={styles.num}>{value}</Body1Strong>
              </span>
              <Caption1 className={styles.base}>{base}</Caption1>
            </dd>
          </div>
        ))}
      </dl>
      <Caption1 className={styles.foot}>Sheet values before enemy armor and resistances. The simulation accounts for those.</Caption1>
    </section>
  );
}
