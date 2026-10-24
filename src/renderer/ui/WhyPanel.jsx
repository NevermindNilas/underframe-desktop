// "Why this DPS" (docs/declutter-spec.md 1.1): the lower area of the Loadout at rest. Health over time (a step chart
// of one seeded run, or a table), Damage by hit, and the build's Notes, behind one quiet tab list. It fills the room
// under the slots; nothing in it scrolls at rest except the long notes or the chart's table.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Caption1, Field, MessageBar, MessageBarBody, Spinner, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell,
  TableRow, Textarea, ToggleButton, makeStyles, tokens, webDarkTheme, webLightTheme,
} from '@fluentui/react-components';
import { LineChart } from '@fluentui/react-charts';
import { TableRegular } from '@fluentui/react-icons';
import { actions, store } from '../controller.js';
import { useApp, useDerived, useElementSize, useMediaQuery } from '../hooks.js';
import { damageShare, healthSeries } from '../model.js';
import { clipTime, downsample, hasValues, killTime, niceTicks, sampleEvery } from '../charts-data.js';
import { fmtAxis, fmtCompact, fmtInt, fmtNum } from '../format.js';
import { damageTypeColor } from '../palette.js';
import { POOL_DASH, POOL_LABELS, POOL_TOKENS } from '../theme.js';

const SERIES = ['hp', 'shields', 'overguard'];
const MAX_NOTES = 10_000;
const COUNTER_FROM = 9_000;
/**
 * The chart's height cap: on a large window the room goes to the slots and the stats, not to a single sample run
 * (docs/declutter-spec.md 3).
 */
export const CHART_MAX_HEIGHT = 300;

/**
 * The chart library makes its line paths and hidden highlight circles keyboard stops with no name. The data is one
 * Tab stop away as a table ("Show as table"), so the drawing leaves the tab order: one pass now, and again whenever
 * the chart redraws.
 */
function useChartOutOfTabOrder(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fix = () => {
      for (const n of el.querySelectorAll('svg [tabindex], svg[tabindex], [data-is-focusable="true"]')) {
        if (n.getAttribute('tabindex') !== '-1') n.setAttribute('tabindex', '-1');
        if (n.getAttribute('data-is-focusable') === 'true') n.setAttribute('data-is-focusable', 'false');
      }
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', 'data-is-focusable'] });
    return () => mo.disconnect();
  });
}

const useStyles = makeStyles({
  panel: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingTop: tokens.spacingVerticalS, paddingBottom: tokens.spacingVerticalL },
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minHeight: '32px', flexWrap: 'nowrap', minWidth: 0 },
  title: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap', marginRight: tokens.spacingHorizontalXS },
  spacer: { flexGrow: 1 },
  caption: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  legend: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalM, color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
  legendLine: { width: '14px', height: '2px', display: 'inline-block' },
  body: { position: 'relative', flexGrow: 1, minHeight: 0, outlineStyle: 'none' },
  // The chart's axis labels follow the type ramp (nothing under 12 px: docs/declutter-spec.md 3).
  chart: { '& svg text': { fontSize: '12px !important' } },
  tableWrap: { position: 'absolute', inset: 0, overflowY: 'auto' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  list: { listStyle: 'none', margin: 0, padding: `${tokens.spacingVerticalS} 0 0`, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, maxWidth: '640px' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 6fr) auto', alignItems: 'center', gap: tokens.spacingHorizontalM, minHeight: '24px' },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  track: { height: '6px', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorNeutralStroke3, overflow: 'hidden' },
  fill: { display: 'block', height: '100%', borderRadius: tokens.borderRadiusCircular },
  value: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' },
  muted: { color: tokens.colorNeutralForeground3 },
  notes: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', paddingTop: tokens.spacingVerticalS },
  textarea: { flexGrow: 1, '& textarea': { maxHeight: 'none', height: '100%' } },
  counter: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
});

function chartSummary(series, start, killedAt, maxTime) {
  const pools = SERIES.filter(k => hasValues(series.points, k)).map(k => `${POOL_LABELS[k]} from ${fmtInt(start[k])}`);
  return `Enemy health over time, ${fmtNum(maxTime, 1)} seconds: ${pools.join(', ')}; ${killedAt != null ? `killed at ${fmtNum(killedAt, 2)} s` : 'not killed'}.`;
}

/** The pools the chart draws, killed-at time and table rows, for the header caption and the chart. */
function useHealth(debug, enemy, simTime) {
  const series = useMemo(() => healthSeries(debug.debugLog, enemy), [debug, enemy]);
  const points = useMemo(() => clipTime(series.points, simTime), [series, simTime]);
  const killedAt = killTime(points);
  const maxTime = killedAt ?? Math.max(simTime || series.maxTime, 0.001);
  const pools = SERIES.filter(k => hasValues(series.points, k));
  return { series, points, killedAt, maxTime, pools, summary: chartSummary(series, enemy, killedAt, maxTime) };
}

function HealthChart({ health, height, asTable }) {
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const forced = useMediaQuery('(forced-colors: active)');
  const { series, points, maxTime, pools, summary } = health;
  const yAxis = niceTicks(series.maxValue, 4);
  const xAxis = niceTicks(maxTime, 6);
  const theme = dark ? webDarkTheme : webLightTheme;
  const data = useMemo(() => {
    const shown = downsample(points, 400);
    return {
      chartTitle: summary,
      lineChartData: pools.map(k => ({
        legend: POOL_LABELS[k],
        color: forced ? 'CanvasText' : theme[POOL_TOKENS[k]],
        data: shown.map(p => ({ x: p.t, y: p[k] })),
        lineOptions: { curve: 'stepAfter', strokeWidth: 2, ...(forced && POOL_DASH[k] ? { strokeDasharray: POOL_DASH[k] } : {}) },
        hideNonActiveDots: true,
      })),
    };
  }, [points, pools.join(), forced, theme, summary]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (asTable ? sampleEvery(points, 0.5, maxTime) : []), [asTable, points, maxTime]);
  const chartRef = useRef(null);
  useChartOutOfTabOrder(chartRef);

  if (asTable) {
    return (
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Enemy health samples" data-scroll-region="">
        <Table size="extra-small" aria-label={summary}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Time</TableHeaderCell>
              {pools.map(k => <TableHeaderCell key={k} className={styles.num}>{POOL_LABELS[k]}</TableHeaderCell>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.t}>
                <TableCell>{fmtNum(r.t, 1)} s</TableCell>
                {pools.map(k => <TableCell key={k} className={styles.num}>{fmtInt(r[k])}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (height < 90) return <Caption1 className={styles.caption}>Make the window taller to see the chart, or show it as a table.</Caption1>;
  return (
    <div ref={chartRef} data-testid="health-chart" className={styles.chart} style={{ height }}>
      <LineChart
        data={data}
        height={height}
        hideLegend
        yMaxValue={yAxis.max}
        yAxisTickFormat={v => fmtAxis(v)}
        tickFormat={v => `${fmtNum(Number(v), 1)} s`}
        yMinValue={0}
        xMinValue={0}
        xMaxValue={xAxis.max}
        showRoundOffXTickValues={false}
        tickValues={Array.from({ length: xAxis.count + 1 }, (_, i) => +(i * xAxis.step).toPrecision(12))}
        yAxisTickCount={yAxis.count}
        enablePerfOptimization
      />
    </div>
  );
}

function DamageShare({ debug }) {
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const rows = useMemo(() => damageShare(debug.debugLog), [debug]);
  if (!rows.length) return <Caption1>No hits recorded.</Caption1>;
  return (
    <ul className={styles.list} aria-label="Damage by hit type, one sample run">
      {rows.map(r => (
        <li key={r.type} className={styles.row}>
          <Caption1 className={styles.label} title={r.type}>{r.type}</Caption1>
          <span className={styles.track} aria-hidden="true">
            <span className={`${styles.fill} uf-bar-fill`} style={{ width: `${Math.max(1, r.share * 100)}%`, backgroundColor: damageTypeColor(r.type, dark) ?? tokens.colorNeutralForeground3 }} />
          </span>
          <Caption1 className={styles.value}>
            {fmtNum(r.share * 100, 1)}% <span className={styles.muted}>· {fmtCompact(r.damage)}</span>
          </Caption1>
        </li>
      ))}
    </ul>
  );
}

/** The build's notes: part of the build (unsaved changes and undo), never re-simulated. */
function Notes() {
  const styles = useStyles();
  const notes = useApp(s => s.build.notes ?? '');
  const epoch = useApp(s => s.editorEpoch);
  const [value, setValue] = useState(notes);
  const [focused, setFocused] = useState(false);
  // Focused, the field keeps its own text; another build opening replaces it at once (see the name field).
  useEffect(() => { if (!focused) setValue(notes); }, [notes, focused]);
  useEffect(() => { setValue(store.get().build?.notes ?? ''); }, [epoch]);
  return (
    <div className={styles.notes}>
      <Field
        style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
        hint={value.length >= COUNTER_FROM ? <span className={styles.counter}>{value.length.toLocaleString()} of {MAX_NOTES.toLocaleString()} characters</span> : undefined}
      >
        <Textarea
          aria-label="Notes"
          className={styles.textarea}
          resize="none"
          maxLength={MAX_NOTES}
          value={value}
          placeholder="Add notes about this build, like the rotation or which enemies it's for."
          onFocus={() => setFocused(true)}
          onChange={(_e, d) => {
            setValue(d.value);
            actions.setNotes(d.value);
          }}
          onBlur={() => {
            setFocused(false);
            actions.endTextEdit();
          }}
          data-testid="notes"
        />
      </Field>
    </div>
  );
}

export function WhyPanel() {
  const styles = useStyles();
  const tab = useApp(s => s.ui.whyTab);
  const asTable = useApp(s => s.ui.chartAsTable);
  const sim = useApp(s => s.sim);
  const { simKey } = useDerived();
  const [bodyRef, body] = useElementSize();
  const busy = sim.status === 'pending' || sim.status === 'running';
  const failed = sim.status === 'error' && sim.key === simKey;
  const ready = Boolean(!failed && sim.debug && sim.debugEnemy);
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const h = useMemo(() => (ready ? { debug: sim.debug, enemy: sim.debugEnemy, time: sim.debugTime } : null), [ready, sim.debug, sim.debugEnemy, sim.debugTime]);
  const healthData = useHealthSafe(h);
  const theme = dark ? webDarkTheme : webLightTheme;

  let content;
  if (tab === 'notes') content = <Notes />;
  else if (failed) content = <Caption1>Charts appear once this build simulates. See the error in the Readout.</Caption1>;
  else if (!ready) {
    content = sim.debugError
      ? <MessageBar intent="warning" layout="multiline"><MessageBarBody>Charts unavailable: {sim.debugError}. The numbers are still valid.</MessageBarBody></MessageBar>
      : sim.status === 'error' ? <Caption1>Charts appear once the build simulates.</Caption1> : <Spinner size="tiny" label="Drawing charts…" labelPosition="after" />;
  } else if (tab === 'hits') content = <DamageShare debug={sim.debug} />;
  else content = <HealthChart health={healthData} height={Math.min(CHART_MAX_HEIGHT, Math.max(0, body.height - 4))} asTable={asTable} />;

  return (
    <div className={styles.panel} data-testid="why-panel">
      <div className={styles.head}>
        <span className={styles.title} id="why-heading">Why this DPS</span>
        <TabList size="small" selectedValue={tab} onTabSelect={(_e, d) => actions.setWhyTab(d.value)} aria-labelledby="why-heading">
          <Tab value="health" data-testid="why-tab-health">Health over time</Tab>
          <Tab value="hits" data-testid="why-tab-hits">Damage by hit</Tab>
          <Tab value="notes" data-testid="why-tab-notes">Notes</Tab>
        </TabList>
        <span className={styles.spacer} />
        {tab === 'health' && healthData ? (
          <>
            {asTable ? null : (
              <span className={styles.legend} aria-hidden="true">
                {healthData.pools.map(k => (
                  <span key={k} className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ backgroundColor: theme[POOL_TOKENS[k]] }} />{POOL_LABELS[k]}
                  </span>
                ))}
              </span>
            )}
            <Caption1 className={styles.caption}>
              {/* The chart is one seeded run; the Readout's time to kill averages 8 runs, so the caption says so. */}
              {healthData.killedAt != null ? `One run · killed at ${fmtNum(healthData.killedAt, 2)} s` : `One run · survived ${sim.debugTime} s`}
            </Caption1>
            {busy ? <Spinner size="extra-tiny" aria-label="Updating chart" /> : null}
            <ToggleButton size="small" appearance="subtle" icon={<TableRegular />} checked={asTable} onClick={() => actions.setChartAsTable(!asTable)} aria-label="Show as table" title="Show as table" />
          </>
        ) : tab === 'hits' && ready ? <Caption1 className={styles.caption}>One sample run</Caption1> : null}
      </div>
      <div ref={bodyRef} className={styles.body} role="tabpanel" aria-label={tab === 'notes' ? 'Notes' : tab === 'hits' ? 'Damage by hit' : 'Health over time'}>
        {content}
      </div>
    </div>
  );
}

/** useHealth for possibly-missing data (hooks can't be conditional). */
function useHealthSafe(h) {
  const empty = useMemo(() => ({ debugLog: [] }), []);
  const start = useMemo(() => ({ hp: 0, shields: 0, overguard: 0 }), []);
  const v = useHealth(h?.debug ?? empty, h?.enemy ?? start, h?.time ?? 0);
  return h ? v : null;
}
