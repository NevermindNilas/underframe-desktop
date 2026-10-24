// Results rail (docs/arsenal-spec.md 8): the fixed result card, then the tabs Charts | Target | Notes (plus Stats
// below 1280 px, where the stats rail folds away) over the rail's one scroll area.
import { Tab, TabList, makeStyles, tokens } from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { ResultCard } from './ResultCard.jsx';
import { ChartsPanel } from './ChartsPanel.jsx';
import { StatsPanel } from './StatsPanel.jsx';
import { TargetCard } from './TargetCard.jsx';
import { NotesCard } from './NotesCard.jsx';

const useStyles = makeStyles({
  column: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    minHeight: 0,
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  card: { flexShrink: 0 },
  stackedCard: { flexShrink: 0, maxWidth: '720px' },
  stackedTabs: { display: 'flex', flexDirection: 'column', flexShrink: 0, maxWidth: '720px' },
  panelStacked: {
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
  },
  tabs: { flexShrink: 0, paddingTop: tokens.spacingVerticalS },
  panel: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px',
    },
  },
});

/**
 * `part`: 'all' (the rail), or in the stacked (zoomed-in) layout 'card' (first) and 'tabs' (after the stage).
 * Stacked, nothing here scrolls on its own: the shared area does.
 */
export function ResultsColumn({ layout, part = 'all' }) {
  const styles = useStyles();
  const tab = useApp(s => s.ui.resultsTab);
  const showStats = layout.statsFolded;
  const selected = tab === 'stats' && !showStats ? 'charts' : tab;
  const pad = `${layout.gutter}px`;
  if (part === 'card') {
    return (
      <div className={styles.stackedCard} style={{ padding: `${pad} ${pad} 0` }} data-pane="results" role="region" aria-label="Results" id="result-card-region">
        <ResultCard />
      </div>
    );
  }
  const stackedTabs = part === 'tabs';
  return (
    <div
      className={stackedTabs ? styles.stackedTabs : styles.column}
      style={stackedTabs ? undefined : { width: layout.resultsWidth }}
      {...(stackedTabs ? { role: 'region', 'aria-label': 'Result details' } : { 'data-pane': 'results', role: 'region', 'aria-label': 'Results' })}
    >
      {stackedTabs ? null : (
        <div className={styles.card} style={{ padding: `${pad} ${pad} 0` }}>
          <ResultCard />
        </div>
      )}
      <TabList
        className={styles.tabs}
        style={{ paddingLeft: `${Math.max(0, layout.gutter - 10)}px`, paddingRight: pad }}
        selectedValue={selected}
        onTabSelect={(_e, d) => actions.setResultsTab(d.value)}
        aria-label="Result details"
      >
        <Tab value="charts" id="tab-charts" aria-controls="results-panel">Charts</Tab>
        {showStats ? <Tab value="stats" id="tab-stats" aria-controls="results-panel">Stats</Tab> : null}
        <Tab value="target" id="tab-target" aria-controls="results-panel" data-focus-id="tab-target">Target</Tab>
        <Tab value="notes" id="tab-notes" aria-controls="results-panel">Notes</Tab>
      </TabList>
      <div
        className={stackedTabs ? styles.panelStacked : styles.panel}
        style={{ padding: `${tokens.spacingVerticalM} ${pad} ${pad}` }}
        id="results-panel"
        role="tabpanel"
        aria-labelledby={`tab-${selected}`}
        tabIndex={0}
        {...(stackedTabs ? {} : { 'data-scroll-region': '' })}
      >
        {selected === 'charts' ? <ChartsPanel /> : selected === 'stats' ? <StatsPanel /> : selected === 'target' ? <TargetCard bare /> : <NotesCard bare />}
      </div>
    </div>
  );
}
