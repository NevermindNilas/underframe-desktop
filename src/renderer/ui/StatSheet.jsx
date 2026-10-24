// The weapon stats sheet (docs/declutter-spec.md 4): every modded stat with its base and the change, right under the
// DPS, never in a scroll area of its own. While a Picker card is hovered or focused the Change column becomes
// "If equipped". Each row (and each damage type) opens the Picker searching mods that raise it. The rows are an ARIA
// grid with one tab stop: Up/Down/Home/End move, Enter or Space searches.
import { useMemo } from 'react';
import { Caption1, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp, useDerived, useMediaQuery } from '../hooks.js';
import { damageTypeRows, previewMode, sheetRows } from '../sheet.js';
import { fmtNum } from '../format.js';
import { damageTypeColor } from '../palette.js';

const useStyles = makeStyles({
  sheet: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  // Tall windows: the stats grow (16 px text, 32 px rows), so they stay the focal point, not the chart.
  large: {
    '& [role="rowheader"], & [role="gridcell"]': { fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase400 },
    '& [role="columnheader"]': { fontSize: tokens.fontSizeBase300 },
  },
  grid: { display: 'flex', flexDirection: 'column', outlineStyle: 'none' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 4.5rem 5.25rem 5rem',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  headRow: {
    cursor: 'default',
    ':hover': { backgroundColor: 'transparent' },
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: 0,
    marginBottom: '2px',
  },
  title: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1, whiteSpace: 'nowrap' },
  colHead: { color: tokens.colorNeutralForeground3, textAlign: 'right', whiteSpace: 'nowrap', fontSize: tokens.fontSizeBase200 },
  colPreview: { color: tokens.colorBrandForeground1 },
  label: {
    fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    paddingLeft: tokens.spacingHorizontalXS, borderRadius: tokens.borderRadiusMedium, outlineStyle: 'none', minWidth: 0,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  base: { fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground3, textAlign: 'right', whiteSpace: 'nowrap' },
  value: { fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground1, textAlign: 'right', whiteSpace: 'nowrap' },
  changed: { fontWeight: tokens.fontWeightSemibold },
  change: { fontSize: tokens.fontSizeBase300, textAlign: 'right', whiteSpace: 'nowrap', paddingRight: tokens.spacingHorizontalXS },
  good: { color: tokens.colorStatusSuccessForeground1 },
  // Palette red: 4.5:1 or better on the layer tone in both themes (the status token is 4.28:1 in dark).
  bad: { color: tokens.colorPaletteRedForeground1 },
  same: { color: tokens.colorNeutralForeground3 },
  preview: { fontWeight: tokens.fontWeightSemibold },
  // Damage by type: one stacked bar and a two-column legend.
  bar: {
    display: 'flex', height: '6px', borderRadius: tokens.borderRadiusCircular, overflow: 'hidden', backgroundColor: tokens.colorNeutralStroke3,
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  segment: { height: '100%' },
  legend: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: tokens.spacingHorizontalL },
  legendRow: {
    display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0, borderRadius: tokens.borderRadiusMedium, cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  swatch: { width: '8px', height: '8px', borderRadius: '2px', flexShrink: 0 },
  legendName: {
    flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', outlineStyle: 'none', borderRadius: tokens.borderRadiusMedium,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  legendValue: { color: tokens.colorNeutralForeground1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  legendBase: { color: tokens.colorNeutralForeground3 },
  visuallyHidden: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
});

/** Up/Down/Left/Right/Home/End between the sheet's row headers and type names (one roving tab stop). */
function onNavKey(e) {
  const nav = [...e.currentTarget.querySelectorAll('[data-stat-nav]')];
  const i = nav.indexOf(e.target);
  if (i < 0) return;
  const k = e.key;
  let next = null;
  if (k === 'ArrowDown' || k === 'ArrowRight') next = Math.min(nav.length - 1, i + 1);
  else if (k === 'ArrowUp' || k === 'ArrowLeft') next = Math.max(0, i - 1);
  else if (k === 'Home') next = 0;
  else if (k === 'End') next = nav.length - 1;
  else if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    actions.searchStat(e.target.dataset.token, { opener: e.target });
    return;
  }
  if (next == null) return;
  e.preventDefault();
  nav.forEach((el, n) => el.setAttribute('tabindex', n === next ? '0' : '-1'));
  nav[next].focus();
}

/** `density`: 'compact' (short windows), 'normal', or 'large' (tall windows). */
export function StatSheet({ density = 'normal' }) {
  const compact = density === 'compact';
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const preview = useApp(s => s.preview);
  const faction = build.enemy.faction;
  const { stats, statsError, baseMode } = useDerived();
  const mode = stats?.mode;
  const pv = useMemo(() => (preview ? previewMode(ctx, build, preview) : null), [ctx, build, preview]);
  if (statsError) return <Caption1>Couldn't compute stats for this mode.</Caption1>;
  if (!mode) return <Caption1>No damage data for this fire mode.</Caption1>;
  const rows = sheetRows(mode, baseMode, { hasReload: Boolean(stats.reload), preview: pv });
  const types = damageTypeRows(mode, baseMode);
  const total = types.reduce((a, t) => a + t.value, 0) || 1;
  const previewing = Boolean(pv);
  const rowH = compact ? 24 : density === 'large' ? 32 : 28;
  const tone = v => (v === 'good' ? styles.good : v === 'bad' ? styles.bad : styles.same);
  return (
    <section className={mergeClasses(styles.sheet, density === 'large' && styles.large)} data-testid="stats-rail" aria-label="Weapon stats" onKeyDown={onNavKey}>
      <div
        role="grid"
        aria-label={`Weapon stats, ${mode.mode_name}, per projectile before enemy armor`}
        aria-rowcount={rows.length + 1}
        className={styles.grid}
        data-testid="stat-grid"
      >
        <div role="row" className={mergeClasses(styles.row, styles.headRow)} style={{ minHeight: rowH }}>
          <span role="columnheader" className={styles.title} title="Sheet values per projectile, before enemy armor and resistances. The simulation accounts for those.">Weapon stats</span>
          <span role="columnheader" className={styles.colHead}>Base</span>
          <span role="columnheader" className={styles.colHead}>Modded</span>
          <span role="columnheader" className={mergeClasses(styles.colHead, previewing && styles.colPreview)} data-testid="stat-change-head">
            {previewing ? 'If equipped' : 'Change'}
          </span>
        </div>
        {rows.map((r, i) => {
          const label = r.key === 'faction' ? `Faction (${faction})` : r.label;
          return (
            <div
              key={r.key}
              role="row"
              className={styles.row}
              style={{ minHeight: rowH }}
              data-testid={`stat-row-${r.key}`}
              onClick={e => actions.searchStat(r.token, { opener: e.currentTarget.querySelector('[data-stat-nav]') })}
            >
              <span
                role="rowheader"
                className={styles.label}
                tabIndex={i === 0 ? 0 : -1}
                data-stat-nav=""
                data-token={r.token}
                data-testid={`stat-filter-${r.token}`}
                aria-description={`Find mods that raise ${r.words}`}
              >
                {label}{r.hint ? <span className={styles.visuallyHidden}> {r.hint}</span> : null}
              </span>
              <span role="gridcell" className={styles.base}>{r.baseText}</span>
              <span role="gridcell" className={mergeClasses(styles.value, r.change != null && styles.changed)}>{r.valueText}</span>
              {previewing ? (
                <span role="gridcell" className={mergeClasses(styles.change, r.previewText != null ? mergeClasses(styles.preview, tone(r.previewVerdict)) : styles.same)} data-preview={r.previewText != null ? r.previewVerdict : undefined}>
                  {r.previewText != null ? `${r.previewVerdict === 'good' ? '▲' : r.previewVerdict === 'bad' ? '▼' : ''} ${r.previewText}`.trim() : '—'}
                  {r.previewText != null && r.previewVerdict !== 'same' ? <span className={styles.visuallyHidden}>{r.previewVerdict === 'good' ? ', better' : ', worse'}</span> : null}
                </span>
              ) : (
                <span role="gridcell" className={mergeClasses(styles.change, tone(r.verdict))}>
                  {r.changeText}
                  {r.verdict !== 'same' ? <span className={styles.visuallyHidden}>{r.verdict === 'good' ? ', better' : ', worse'}</span> : null}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {types.length ? (
        <>
          <div className={styles.bar} aria-hidden="true" style={{ marginTop: compact ? 8 : 12, marginBottom: compact ? 4 : 6 }}>
            {types.map(t => (
              <span key={t.type} className={mergeClasses(styles.segment, 'uf-bar-fill')} style={{ width: `${(t.value / total) * 100}%`, backgroundColor: damageTypeColor(t.type, dark) ?? tokens.colorNeutralForeground3 }} />
            ))}
          </div>
          <div role="grid" aria-label="Damage by type, per projectile" className={styles.legend} data-testid="stat-types">
            {types.map(t => (
              <div key={t.type} role="row" className={styles.legendRow} style={{ minHeight: compact ? 22 : 24 }} onClick={e => actions.searchStat(t.token, { opener: e.currentTarget.querySelector('[data-stat-nav]') })} data-testid={`stat-type-${t.token}`}>
                <span className={styles.swatch} style={{ backgroundColor: damageTypeColor(t.type, dark) ?? tokens.colorNeutralForeground3 }} aria-hidden="true" />
                <Caption1
                  role="rowheader"
                  className={styles.legendName}
                  tabIndex={-1}
                  data-stat-nav=""
                  data-token={t.token}
                  data-testid={`stat-filter-${t.token}`}
                  aria-description={`Find ${t.type} mods`}
                >
                  {t.type}
                </Caption1>
                <Caption1 role="gridcell" className={styles.legendValue}>
                  {Math.abs(t.base - t.value) > 1e-9 ? <span className={styles.legendBase}>{fmtNum(t.base, 1)} → </span> : null}
                  {fmtNum(t.value, 1)}
                </Caption1>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
