// The workspace layer: a rounded surface holding the build toolbar, the editor and results columns,
// and the compare drawer. Shows the boot skeleton and the boot error state too.
import {
  Body1, Button, Caption1, Link, MessageBar, MessageBarBody, ProgressBar, Skeleton, SkeletonItem, Subtitle1,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { actions, errors } from '../controller.js';
import { useApp } from '../hooks.js';
import { BuildToolbar } from './BuildToolbar.jsx';
import { Editor } from './Editor.jsx';
import { ResultsColumn } from './ResultsColumn.jsx';
import { CompareDrawer } from './CompareDrawer.jsx';

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
  columns: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
  },
  // Under 800 px of height the compare drawer shares the editor's column only.
  leftStack: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 },
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

export function Workspace({ layout }) {
  const styles = useStyles();
  const phase = useApp(s => s.phase);
  return (
    <main className={styles.layer} aria-label="Workspace">
      {phase === 'error' ? <BootError /> : (
        <>
          <BuildToolbar />
          {phase === 'loading' ? <BootSkeleton layout={layout} /> : layout.stacked ? (
            <>
              <div className={styles.stacked} data-scroll-region="" aria-label="Build and results" role="region" tabIndex={-1}>
                <ResultsColumn layout={layout} part="card" />
                <Editor layout={layout} embedded />
                <ResultsColumn layout={layout} part="tabs" />
              </div>
              <CompareDrawer />
            </>
          ) : (
            <>
              <div className={styles.columns}>
                {layout.compactHeight ? (
                  <div className={styles.leftStack}>
                    <Editor layout={layout} />
                    <CompareDrawer />
                  </div>
                ) : <Editor layout={layout} />}
                <ResultsColumn layout={layout} />
              </div>
              {layout.compactHeight ? null : <CompareDrawer />}
            </>
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

