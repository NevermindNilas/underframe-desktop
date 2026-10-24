// The workspace layer (docs/arsenal-spec.md 2): the build toolbar over the arsenal body grid: the stats rail and
// the stage side by side, the gallery under both, the results rail on the right over the full height, and the
// compare drawer over the gallery area only. Below 1100 px everything stacks in one scroll area with a sticky
// DPS bar. Shows the boot skeleton and the boot error state too.
import { useState } from 'react';
import {
  Body1, Button, Caption1, Link, MessageBar, MessageBarBody, ProgressBar, Skeleton, SkeletonItem, Subtitle1,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { actions, errors } from '../controller.js';
import { useApp, useDelayedFlag, useDerived } from '../hooks.js';
import { resultDelta, ttkText } from '../model.js';
import { fmtInt } from '../format.js';
import { BuildToolbar } from './BuildToolbar.jsx';
import { ResultsColumn } from './ResultsColumn.jsx';
import { CompareDrawer } from './CompareDrawer.jsx';
import { Stage } from './Stage.jsx';
import { Gallery } from './Gallery.jsx';
import { StatsPanel } from './StatsPanel.jsx';
import { DeltaBadge } from './common.jsx';

export const DISCORD_URL = 'https://discord.gg/SNFv5KFQgR';
export const UNDERFRAME_URL = 'https://www.underframe.site';

const useStyles = makeStyles({
  layer: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--uf-layer)',
    borderTopLeftRadius: tokens.borderRadiusXLarge,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    overflow: 'hidden',
    position: 'relative',
  },
  body: {
    display: 'grid',
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
  },
  // The stats rail scrolls inside the stage's row without making it taller.
  statsCell: { position: 'relative', minHeight: 0, minWidth: 0, gridRow: 1, gridColumn: 1 },
  stats: {
    position: 'absolute',
    inset: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    boxSizing: 'border-box',
    outlineStyle: 'none',
  },
  stageCell: { gridRow: 1, minWidth: 0 },
  lower: { gridRow: 2, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  resultsCell: { gridRow: '1 / span 2', display: 'flex', minHeight: 0 },
  dpsBar: {
    position: 'sticky',
    top: 0,
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minHeight: '48px',
    padding: `0 ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    flexWrap: 'wrap',
  },
  dpsValue: { fontVariantNumeric: 'tabular-nums', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  dpsMeta: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
  // Below 1100 CSS px (zoomed in): one scroll area holding the result card, the editor and the result tabs.
  stacked: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    outlineStyle: 'none',
  },
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

/** Stacked layout (2.5): the headline result stays visible while scrolling to the gallery. */
function DpsBar() {
  const styles = useStyles();
  const sim = useApp(s => s.sim);
  const { simKey } = useDerived();
  const s = sim.summary;
  const busy = sim.status === 'pending' || sim.status === 'running' || sim.key !== simKey;
  const updating = useDelayedFlag(busy, 150);
  const show = s?.ok && !(sim.status === 'error' && sim.key === simKey);
  const delta = show ? resultDelta(s.avgDps, sim.prev?.avgDps) : null;
  return (
    <div className={styles.dpsBar} data-testid="dps-bar">
      <Caption1>Average DPS</Caption1>
      <span className={styles.dpsValue}>{show ? fmtInt(s.avgDps) : '—'}</span>
      <DeltaBadge delta={delta} />
      <Caption1 className={styles.dpsMeta}>{show ? `· TTK ${ttkText(s)}` : ''}{updating ? ' · Updating…' : ''}</Caption1>
      <span style={{ flexGrow: 1 }} />
      <Link as="button" onClick={() => document.getElementById('result-card-region')?.scrollIntoView({ block: 'start' })}>Details</Link>
    </div>
  );
}

export function Workspace({ layout }) {
  const styles = useStyles();
  const phase = useApp(s => s.phase);
  const [stackedEl, setStackedEl] = useState(null);
  const columns = [layout.statsWidth ? `${layout.statsWidth}px` : null, 'minmax(0, 1fr)', `${layout.resultsWidth}px`].filter(Boolean).join(' ');
  const statsCol = layout.statsWidth ? 1 : 0;
  return (
    <main className={styles.layer} aria-label="Workspace">
      {phase === 'error' ? <BootError /> : (
        <>
          <BuildToolbar compactToolbar={layout.statsFolded} />
          {phase === 'loading' ? <BootSkeleton layout={layout} /> : layout.stacked ? (
            <>
              <div ref={setStackedEl} className={styles.stacked} data-scroll-region="" aria-label="Build and results" role="region" tabIndex={-1}>
                <DpsBar />
                <ResultsColumn layout={layout} part="card" />
                <Stage layout={layout} />
                <ResultsColumn layout={layout} part="tabs" />
                {stackedEl ? <Gallery layout={layout} scrollEl={stackedEl} /> : null}
              </div>
              <CompareDrawer />
            </>
          ) : (
            <div className={styles.body} style={{ gridTemplateColumns: columns, gridTemplateRows: 'auto minmax(0, 1fr)' }}>
              {layout.statsWidth ? (
                <div className={styles.statsCell}>
                  <aside
                    className={styles.stats}
                    style={{ padding: `${layout.gutter}px ${Math.max(8, layout.gutter - 8)}px ${layout.gutter}px ${layout.gutter}px` }}
                    data-pane="stats"
                    data-scroll-region=""
                    aria-label="Weapon stats"
                  >
                    <StatsPanel />
                  </aside>
                </div>
              ) : null}
              <div className={styles.stageCell} style={{ gridColumn: statsCol + 1 }}>
                <Stage layout={layout} />
              </div>
              <div className={styles.lower} style={{ gridColumn: `1 / span ${statsCol + 1}` }} data-lower-area="">
                <Gallery layout={layout} />
                <CompareDrawer />
              </div>
              <div className={styles.resultsCell} style={{ gridColumn: statsCol + 2 }}>
                <ResultsColumn layout={layout} />
              </div>
            </div>
          )}
        </>
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
            {Array.from({ length: 8 }, (_, i) => <SkeletonItem key={i} shape="rectangle" style={{ height: '128px' }} />)}
          </div>
          <SkeletonItem shape="rectangle" style={{ height: '72px' }} />
        </div>
        <div className={styles.skeletonResults} style={{ width: layout.resultsWidth ?? '40%' }}>
          <SkeletonItem shape="rectangle" style={{ height: '190px' }} />
          <SkeletonItem size={32} style={{ width: '60%' }} />
          <SkeletonItem shape="rectangle" style={{ height: '200px' }} />
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

