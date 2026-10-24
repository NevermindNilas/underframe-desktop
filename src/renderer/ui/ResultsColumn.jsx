// Results column: the fixed result card, then Charts | Stats | Best mod tabs over the column's one scroll area.
import { Tab, TabList, makeStyles, tokens } from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { ResultCard } from './ResultCard.jsx';
import { ChartsPanel } from './ChartsPanel.jsx';
import { StatsPanel } from './StatsPanel.jsx';
import { BestModPanel } from './BestModPanel.jsx';

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
 * `part`: 'all' (the column), or in the stacked (zoomed-in) layout 'card' (above the editor) and 'tabs'
 * (below it). Stacked, nothing here scrolls on its own: the shared area does.
 */
export function ResultsColumn({ layout, part = 'all' }) {
  const styles = useStyles();
  const tab = useApp(s => s.ui.resultsTab);
  const sweep = useApp(s => s.sweep);
  const selected = tab === 'best' && !sweep ? 'charts' : tab;
  const pad = `${layout.gutter}px`;
  const bestLabel = sweep?.status === 'running' ? `Best mod ${sweep.done}/${sweep.total}` : 'Best mod';
  if (part === 'card') {
    return (
      <div className={styles.stackedCard} style={{ padding: `${pad} ${pad} 0` }} data-pane="results" role="region" aria-label="Results">
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
        style={{ paddingLeft: `${layout.gutter - 10}px`, paddingRight: pad }}
        selectedValue={selected}
        onTabSelect={(_e, d) => actions.setResultsTab(d.value)}
        aria-label="Result details"
      >
        <Tab value="charts" id="tab-charts" aria-controls="results-panel">Charts</Tab>
        <Tab value="stats" id="tab-stats" aria-controls="results-panel">Stats</Tab>
        {sweep ? <Tab value="best" id="tab-best" aria-controls="results-panel">{bestLabel}</Tab> : null}
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
        {selected === 'charts' ? <ChartsPanel /> : selected === 'stats' ? <StatsPanel /> : <BestModPanel />}
      </div>
    </div>
  );
}
