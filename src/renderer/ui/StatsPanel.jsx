// Weapon stats (docs/arsenal-spec.md 3): the modded sheet for the selected fire mode with base values and changes
// marked. As in the arsenal, each stat row is a button that searches the gallery for mods that raise it.
// Shown in the stats rail (left), or as the results rail's Stats tab below 1280 px.
import { Body1Strong, Button, Caption1, Subtitle2, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ArrowDownRegular, ArrowUpRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived, useMediaQuery } from '../hooks.js';
import { fmtNum, fmtPct, fmtSeconds, fmtSignedPct } from '../format.js';
import { byDamageTypeOrder, damageTypeColor } from '../palette.js';

const useStyles = makeStyles({
  head: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalS, marginBottom: tokens.spacingVerticalS, minWidth: 0 },
  caption: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  total: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: tokens.spacingVerticalXS },
  num: { fontVariantNumeric: 'tabular-nums' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    width: '100%',
    minHeight: '32px',
    padding: `2px ${tokens.spacingHorizontalXS}`,
    textAlign: 'left',
    fontWeight: tokens.fontWeightRegular,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: 0,
  },
  label: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  base: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  valueLine: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXXS, justifySelf: 'end' },
  up: { color: tokens.colorStatusSuccessForeground1, display: 'inline-flex' },
  down: { color: tokens.colorStatusDangerForeground1, display: 'inline-flex' },
  types: { listStyle: 'none', margin: `${tokens.spacingVerticalM} 0 0`, padding: 0, display: 'flex', flexDirection: 'column' },
  type: {
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 5fr) minmax(0, 6fr) 52px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    width: '100%',
    minHeight: '28px',
    padding: `0 ${tokens.spacingHorizontalXS}`,
    fontWeight: tokens.fontWeightRegular,
  },
  swatch: { width: '10px', height: '10px', borderRadius: tokens.borderRadiusSmall },
  track: { height: '8px', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorNeutralStroke3, overflow: 'hidden' },
  fill: { display: 'block', height: '100%', borderRadius: tokens.borderRadiusCircular },
  value: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  foot: { color: tokens.colorNeutralForeground2, marginTop: tokens.spacingVerticalM, display: 'block' },
});

/** Gallery search word per stat row (docs/arsenal-spec.md 3). */
export const STAT_TOKENS = {
  'Crit chance': ['cc', 'crit chance'],
  'Crit multiplier': ['cd', 'crit damage'],
  'Status chance': ['sc', 'status chance'],
  Multishot: ['ms', 'multishot'],
  'Fire rate': ['fr', 'fire rate'],
  Magazine: ['mag', 'magazine'],
  Reload: ['reload', 'reload speed'],
  'Faction bonus': ['bane', 'faction damage'],
};
const ELEMENT_TOKEN = { Impact: 'impact', Puncture: 'puncture', Slash: 'slash', Heat: 'heat', Cold: 'cold', Electricity: 'electricity', Toxin: 'toxin', Blast: 'blast', Corrosive: 'corrosive', Gas: 'gas', Magnetic: 'magnetic', Radiation: 'radiation', Viral: 'viral' };

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

export function StatsPanel({ heading = true }) {
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
    ['Crit chance', fmtPct(mode.finalCritChance), `base ${fmtPct(mode.baseCritChance)}`, mode.finalCritChance, mode.baseCritChance],
    ['Crit multiplier', `${fmtNum(mode.finalCritMultiplier, 2)}×`, `base ${fmtNum(mode.baseCritMultiplier, 2)}×`, mode.finalCritMultiplier, mode.baseCritMultiplier],
    ['Status chance', fmtPct(mode.perProjectileStatusChance), `base ${fmtPct(mode.baseStatusChance)} per projectile`, mode.perProjectileStatusChance, mode.baseStatusChance],
    ['Multishot', fmtNum(mode.finalMultishot, 2), `base ${fmtNum(Number(mode.multishot) || 1, 2)}`, mode.finalMultishot, Number(mode.multishot) || 1],
    ['Fire rate', `${fmtNum(mode.finalFireRate, 2)}/s`, `base ${fmtNum(mode.baseFireRate, 2)}/s`, mode.finalFireRate, mode.baseFireRate],
    ['Magazine', reload ? fmtNum(mode.magazineSize, 0) : 'n/a', reload ? `base ${fmtNum(reload.magazine_size, 0)}` : 'No reload data', reload ? mode.magazineSize : NaN, reload?.magazine_size],
    ['Reload', reload ? fmtSeconds(mode.reloadTime) : 'n/a', reload ? `base ${fmtSeconds(reload.reload_time)}` : 'No reload data', reload ? mode.reloadTime : NaN, reload?.reload_time, 'down'],
    ['Faction bonus', mode.factionDamage ? fmtSignedPct(mode.factionDamage, 0) : 'None', mode.factionDamage ? `vs ${faction}` : `No bane mod for ${faction}`, mode.factionDamage, 0],
  ];
  return (
    <section aria-labelledby={heading ? 'stats-heading' : undefined} aria-label={heading ? undefined : 'Weapon stats'} data-testid="stats-rail">
      {heading ? (
        <div className={styles.head}>
          <Subtitle2 as="h2" id="stats-heading">Weapon stats</Subtitle2>
          <Caption1 className={styles.caption}>{mode.mode_name}</Caption1>
        </div>
      ) : null}
      <div className={styles.total}>
        <Caption1>Damage per projectile</Caption1>
        <Body1Strong className={styles.num}>{fmtNum(mode.totalFinalDamage, 1)}</Body1Strong>
      </div>
      <ul className={styles.list} aria-label="Stats">
        {rows.map(([label, value, base, now, was, better]) => {
          const [token, words] = STAT_TOKENS[label];
          return (
            <li key={label}>
              <Tooltip content={`Find mods that raise ${words}`} relationship="description" positioning="after">
                <Button
                  appearance="transparent"
                  className={styles.row}
                  data-testid={`stat-filter-${token}`}
                  onClick={() => actions.searchStat(token)}
                >
                  <span className={styles.label}>
                    <Caption1>{label}</Caption1>
                    <Caption1 className={styles.base}>{base}</Caption1>
                  </span>
                  <span className={styles.valueLine}>
                    <Change value={now} base={was} better={better} />
                    <Body1Strong className={styles.num}>{value}</Body1Strong>
                  </span>
                </Button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {types.length ? (
        <ul className={styles.types} aria-label="Damage by type">
          {types.map(([type, v]) => {
            const color = damageTypeColor(type, dark) ?? tokens.colorNeutralForeground3;
            const token = ELEMENT_TOKEN[type] ?? type.toLowerCase();
            return (
              <li key={type}>
                <Button
                  appearance="transparent"
                  className={styles.type}
                  data-testid={`stat-filter-${token}`}
                  aria-description={`Find ${type} mods`}
                  onClick={() => actions.searchStat(token)}

                >
                  <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />
                  <Caption1 style={{ textAlign: 'left' }}>{type}</Caption1>
                  <span className={styles.track} aria-hidden="true">
                    <span className={mergeClasses(styles.fill, 'uf-bar-fill')} style={{ width: `${(v / max) * 100}%`, backgroundColor: color }} />
                  </span>
                  <Caption1 className={styles.value}>{fmtNum(v, 1)}</Caption1>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : <Caption1 as="p">No damage data for this fire mode.</Caption1>}
      <Caption1 className={styles.foot}>Sheet values before enemy armor and resistances. The simulation accounts for those.</Caption1>
    </section>
  );
}
