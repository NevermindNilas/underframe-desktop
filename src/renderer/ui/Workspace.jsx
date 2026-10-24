// The workspace (docs/declutter-spec.md 1-2): two columns under the top bar. The Loadout (slots, then the lower area
// that follows the task: Why this DPS at rest, the Picker while picking) and the Readout (DPS, stats, Compare).
// Below 1100 CSS px (zoomed in) everything stacks in one scroll area, Readout first, with a sticky DPS bar. Shows
// the boot skeleton and the boot error state too.
import { useEffect, useState } from 'react';
import {
  Body1, Button, Caption1, Link, MessageBar, MessageBarBody, ProgressBar, Skeleton, SkeletonItem, Subtitle1,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { actions, errors } from '../controller.js';
import { useApp, useDelayedFlag, useDerived, useElementSize } from '../hooks.js';
import { resultDelta, ttkText } from '../model.js';
import { fmtInt } from '../format.js';
import { Loadout } from './Loadout.jsx';
import { Picker } from './Picker.jsx';
import { Readout } from './Readout.jsx';
import { WhyPanel } from './WhyPanel.jsx';
import { DeltaText } from './common.jsx';
import { DISCORD_URL } from './links.js';

const useStyles = makeStyles({
  layer: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  body: { display: 'grid', flexGrow: 1, minHeight: 0, minWidth: 0 },
  loadoutColumn: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  // A zero-height sticky anchor: the bar hangs from it, so showing or hiding the bar never moves the content.
  dpsAnchor: { position: 'sticky', top: 0, zIndex: 3, height: 0, overflow: 'visible' },
  dpsBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minHeight: '44px',
    padding: `0 ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    flexWrap: 'wrap',
  },
  dpsValue: { fontVariantNumeric: 'tabular-nums', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  dpsMeta: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
  // Below 1100 CSS px (zoomed in): one scroll area holding the Readout, the Loadout and the lower area.
  stacked: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    outlineStyle: 'none',
  },
  stackedLower: { display: 'flex', flexDirection: 'column', minHeight: '360px' },
  progress: { position: 'absolute', top: 0, left: 0, right: 0 },
  status: {
    color: tokens.colorNeutralForeground2,
    paddingLeft: tokens.spacingHorizontalXXL,
    paddingTop: tokens.spacingVerticalS,
    minHeight: '16px',
  },
  error: {
    margin: 'auto',
    maxWidth: '560px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalXXL,
  },
  errorIcon: { fontSize: '48px', color: tokens.colorStatusDangerForeground1 },
  errorActions: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  skeleton: { display: 'flex', gap: tokens.spacingHorizontalXXL, padding: tokens.spacingHorizontalXXL, flexGrow: 1, minHeight: 0 },
  skeletonEditor: { flexGrow: 1, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  skeletonGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: tokens.spacingHorizontalM },
  skeletonResults: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

/**
 * Stacked layout (2.5): the headline result stays visible while scrolling down to the slots and the Picker. It
 * shows only once the Readout's own DPS has scrolled out of view, so the DPS is never on screen twice.
 */
function DpsBar({ root }) {
  const styles = useStyles();
  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const hero = document.querySelector('[data-testid="result-card"]');
    if (!root || !hero || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { root, threshold: 0 });
    io.observe(hero);
    return () => io.disconnect();
  }, [root]);
  const sim = useApp(s => s.sim);
  const { simKey } = useDerived();
  const s = sim.summary;
  const busy = sim.status === 'pending' || sim.status === 'running' || sim.key !== simKey;
  const updating = useDelayedFlag(busy, 150);
  const show = s?.ok && !(sim.status === 'error' && sim.key === simKey);
  const delta = show ? resultDelta(s.avgDps, sim.prev?.avgDps) : null;
  if (heroVisible) return <div className={styles.dpsAnchor} />;
  return (
    <div className={styles.dpsAnchor}>
    <div className={styles.dpsBar} data-testid="dps-bar">
      <Caption1>Average DPS</Caption1>
      <span className={styles.dpsValue}>{show ? fmtInt(s.avgDps) : '—'}</span>
      <DeltaText delta={delta} />
      <Caption1 className={styles.dpsMeta}>{show ? `· TTK ${ttkText(s)}` : ''}{updating ? ' · Updating…' : ''}</Caption1>
      <span style={{ flexGrow: 1 }} />
      <Link as="button" onClick={() => document.getElementById('result-card-region')?.scrollIntoView({ block: 'start' })}>Details</Link>
    </div>
    </div>
  );
}

/** The Loadout column: the slots on top, the lower area (Picker or Why this DPS) under them. */
function LoadoutColumn({ layout }) {
  const styles = useStyles();
  const [ref, size] = useElementSize();
  return (
    <div ref={ref} className={styles.loadoutColumn}>
      <Loadout layout={layout} width={size.width} height={size.height || layout.body} />
      <Picker layout={layout}><WhyPanel /></Picker>
    </div>
  );
}

export function Workspace({ layout }) {
  const styles = useStyles();
  const phase = useApp(s => s.phase);
  const [stackedEl, setStackedEl] = useState(null);
  const [stackedRef, stackedSize] = useElementSize();
  return (
    <main className={styles.layer} aria-label="Workspace">
      {phase === 'error' ? <BootError /> : phase === 'loading' ? <BootSkeleton layout={layout} /> : layout.stacked ? (
        <div ref={el => { setStackedEl(el); stackedRef(el); }} className={styles.stacked} data-scroll-region="" aria-label="Build and results" role="region" tabIndex={-1}>
          <DpsBar root={stackedEl} />
          <Readout layout={layout} stacked />
          <Loadout layout={layout} width={stackedSize.width} height={stackedSize.height || layout.body} />
          {stackedEl ? <div className={styles.stackedLower}><Picker layout={layout} scrollEl={stackedEl}><WhyPanel /></Picker></div> : null}
        </div>
      ) : (
        <div className={styles.body} style={{ gridTemplateColumns: `minmax(0, 1fr) ${layout.readoutWidth}px`, gridTemplateRows: 'minmax(0, 1fr)' }}>
          <LoadoutColumn layout={layout} />
          <Readout layout={layout} />
        </div>
      )}
    </main>
  );
}

function BootSkeleton({ layout }) {
  const styles = useStyles();
  const loading = useApp(s => s.loading);
  const determinate = loading.total > 0;
  return (
    <>
      <div style={{ position: 'relative' }}>
        <ProgressBar
          className={styles.progress}
          thickness="medium"
          value={determinate ? Math.min(1, loading.received / loading.total) : undefined}
          aria-label="Loading"
        />
      </div>
      <Caption1 as="p" className={styles.status} role="status" aria-live="polite">{loading.text}</Caption1>
      <Skeleton className={styles.skeleton} aria-label="Loading the build editor">
        <div className={styles.skeletonEditor}>
          <SkeletonItem size={32} style={{ width: '50%' }} />
          <SkeletonItem size={16} style={{ width: '20%' }} />
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 8 }, (_, i) => <SkeletonItem key={i} shape="rectangle" style={{ height: '96px' }} />)}
          </div>
          <SkeletonItem shape="rectangle" style={{ height: '36px' }} />
        </div>
        <div className={styles.skeletonResults} style={{ width: layout.readoutWidth ?? '40%' }}>
          <SkeletonItem shape="rectangle" style={{ height: '96px' }} />
          {Array.from({ length: 8 }, (_, i) => <SkeletonItem key={i} size={20} />)}
        </div>
      </Skeleton>
    </>
  );
}

function BootError() {
  const styles = useStyles();
  const error = useApp(s => s.error);
  const details = [`Error: ${error}`, ...errors.filter(e => !e.includes(error))].join('\n');
  return (
    <div className={styles.error} role="alert">
      <ErrorCircleRegular className={styles.errorIcon} aria-hidden="true" />
      <Subtitle1 as="h1">Underframe Desktop couldn't start</Subtitle1>
      <Body1>The game data or the damage engine failed to load.</Body1>
      <MessageBar intent="error" layout="multiline">
        <MessageBarBody>{error}</MessageBarBody>
      </MessageBar>
      <Caption1>Reinstalling the app usually fixes this if it keeps failing.</Caption1>
      <div className={styles.errorActions}>
        <Button appearance="primary" onClick={() => location.reload()}>Try again</Button>
        <Button onClick={() => actions.copyText(details)}>Copy details</Button>
        <Link onClick={() => actions.openExternal(DISCORD_URL)}>Get help on Discord</Link>
      </div>
    </div>
  );
}
