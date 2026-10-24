// Small shared pieces: delta badge, what the stat model leaves out per mod, app icon, empty states.
import { Badge, Caption1, Subtitle2, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ArrowDownRegular, ArrowUpRegular } from '@fluentui/react-icons';
import { fmtSignedPct } from '../format.js';
import { collectModifiers } from '../../shared/stats.js';
import { maxRank } from '../../shared/mods.js';
import { unhandledByMod } from '../model.js';

const useStyles = makeStyles({
  numeric: { fontVariantNumeric: 'tabular-nums' },
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
 * Signed % change with an arrow icon; success/danger colour. Hidden when delta is null. Always the medium
 * size (12 px text, the spec's minimum), the same in the result card, compare, the picker and the sweep.
 */
export function DeltaBadge({ delta, tooltip }) {
  const styles = useStyles();
  if (delta == null || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  const badge = (
    <Badge
      appearance="tint"
      color={up ? 'success' : 'danger'}
      size="medium"
      icon={up ? <ArrowUpRegular /> : <ArrowDownRegular />}
      className={styles.numeric}
      aria-label={`${up ? 'up' : 'down'} ${fmtSignedPct(Math.abs(delta)).replace(/^\+/, '')}`}
    >
      {fmtSignedPct(delta)}
    </Badge>
  );
  return tooltip ? <Tooltip content={tooltip} relationship="description">{badge}</Tooltip> : badge;
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

