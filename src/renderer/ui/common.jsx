// Small shared pieces: the delta text, what the stat model leaves out per mod, app icon, empty states.
import { Caption1, Subtitle2, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { fmtSignedPct } from '../format.js';
import { collectModifiers } from '../../shared/stats.js';
import { maxRank } from '../../shared/mods.js';
import { unhandledByMod } from '../model.js';

const useStyles = makeStyles({
  numeric: { fontVariantNumeric: 'tabular-nums' },
  delta: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  up: { color: tokens.colorStatusSuccessForeground1 },
  // Palette red, not the status token: it keeps 4.5:1 on the Readout's layer tone in both themes (#E37D80 in dark).
  down: { color: tokens.colorPaletteRedForeground1 },
  empty: {

    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalL} 0`,
    color: tokens.colorNeutralForeground2,
  },
  emptyCentered: { alignItems: 'center', textAlign: 'center' },
  // Spacing comes from the container gap only (UX spec 5.4), not from user-agent <p> margins.
  emptyText: { margin: 0 },
  emptyIcon: { fontSize: '32px', color: tokens.colorNeutralForeground3 },
});

/**
 * "▲ 2.1%": a signed change as coloured text with an arrow, never colour alone and never a tinted pill
 * (docs/declutter-spec.md 3). Nothing when there is no change.
 */
export function DeltaText({ delta, className, title, zeroText = null }) {
  const styles = useStyles();
  if (delta == null || !Number.isFinite(delta)) return null;
  // A change that rounds to 0% is no change: neutral text (or nothing), never a red "▼ 0%".
  if (Math.abs(delta) < 0.0005) {
    return zeroText ? <span className={mergeClasses(styles.numeric, className)} title={title} data-testid="dps-delta-zero">{zeroText}</span> : null;
  }
  const up = delta > 0;
  const size = fmtSignedPct(Math.abs(delta)).replace(/^\+/, '');
  return (
    <span className={mergeClasses(styles.delta, up ? styles.up : styles.down, className)} title={title} aria-label={`${up ? 'up' : 'down'} ${size}`} data-testid="dps-delta">
      {up ? '▲' : '▼'} {size}
    </span>
  );
}

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

/** 16 px app mark drawn with brand tokens. */
export function AppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" style={{ fill: tokens.colorBrandBackground }} />
      <path d="M4 4v5a2.2 2.2 0 0 0 4.4 0V4M10 12V4h3M10 8h2.4" style={{ fill: 'none', stroke: tokens.colorNeutralForegroundOnBrand }} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon, title, explanation and optional actions. */
export function EmptyState({ icon, title, children, actions, centered = false, className }) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.empty, centered && styles.emptyCentered, className)}>
      {icon ? <span className={styles.emptyIcon} aria-hidden="true">{icon}</span> : null}
      {title ? <Subtitle2 as="p" className={styles.emptyText}>{title}</Subtitle2> : null}
      {children ? <Caption1 as="p" className={styles.emptyText}>{children}</Caption1> : null}
      {actions}
    </div>
  );
}

