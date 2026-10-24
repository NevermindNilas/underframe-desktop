// Charts tab: enemy health over time (Fluent LineChart, step curve; or a table) and damage by hit type.
import { useMemo } from 'react';
import {
  Caption1, MessageBar, MessageBarBody, Spinner, Subtitle2, Table, TableBody, TableCell, TableHeader, TableHeaderCell,
  TableRow, ToggleButton, makeStyles, tokens, webDarkTheme, webLightTheme,
} from '@fluentui/react-components';
import { LineChart } from '@fluentui/react-charts';
import { TableRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived, useMediaQuery, useWindowSize } from '../hooks.js';
import { damageShare, healthSeries } from '../model.js';
import { clipTime, downsample, hasValues, killTime, niceTicks, sampleEvery } from '../charts-data.js';
import { fmtAxis, fmtCompact, fmtInt, fmtNum } from '../format.js';
import { damageTypeColor } from '../palette.js';
import { POOL_DASH, POOL_LABELS, POOL_TOKENS } from '../theme.js';

const SERIES = ['hp', 'shields', 'overguard'];
/** Legend swatches in forced colours, where every series is CanvasText: the shape tells them apart. */
const FORCED_LEGEND_SHAPE = { hp: 'default', shields: 'diamond', overguard: 'dottedLine' };
/** Room under the plot for the built-in legend (the chart sizes itself from its container). */
const LEGEND_HEIGHT = 36;

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalXL },
  head: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS },
  titleBlock: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  captionLine: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minHeight: '20px' },
  caption: { color: tokens.colorNeutralForeground2 },
  spacer: { flexGrow: 1 },
  chart: { width: '100%' },
  tableWrap: { maxHeight: '320px', overflowY: 'auto' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 6fr) auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minHeight: '24px',
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  track: { height: '8px', borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorNeutralStroke3, overflow: 'hidden' },
  fill: { display: 'block', height: '100%', borderRadius: tokens.borderRadiusCircular },
  value: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' },
  muted: { color: tokens.colorNeutralForeground3 },
});

function chartSummary(series, start, killedAt, maxTime) {
  const pools = SERIES.filter(k => hasValues(series.points, k)).map(k => `${POOL_LABELS[k]} from ${fmtInt(start[k])}`);
  return `Enemy health over time, ${fmtNum(maxTime, 1)} seconds: ${pools.join(', ')}; ${killedAt != null ? `killed at ${fmtNum(killedAt, 2)} s` : 'not killed'}.`;
}

function HealthChart({ debug, enemy, simTime, updating }) {
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const forced = useMediaQuery('(forced-colors: active)');
  const asTable = useApp(s => s.ui.chartAsTable);
  const { height } = useWindowSize();
  const series = useMemo(() => healthSeries(debug.debugLog, enemy), [debug, enemy]);
  // The x axis is the simulated time (a hit logged just past it would stretch the axis past the run).
  const points = useMemo(() => clipTime(series.points, simTime), [series, simTime]);
  const killedAt = killTime(points);
  const maxTime = killedAt ?? Math.max(simTime || series.maxTime, 0.001);
  const yAxis = niceTicks(series.maxValue, 4);
  const xAxis = niceTicks(maxTime, 6);
  const pools = SERIES.filter(k => hasValues(series.points, k));
  const summary = chartSummary(series, enemy, killedAt, maxTime);
  const theme = dark ? webDarkTheme : webLightTheme;
  const chartHeight = height < 800 ? 160 : 200;

  const data = useMemo(() => {
    const shown = downsample(points, 400);
    return {
      chartTitle: summary,
      lineChartData: pools.map(k => ({
        legend: POOL_LABELS[k],
        color: forced ? 'CanvasText' : theme[POOL_TOKENS[k]],
        data: shown.map(p => ({ x: p.t, y: p[k] })),
        ...(forced ? { legendShape: FORCED_LEGEND_SHAPE[k] } : {}),
        lineOptions: { curve: 'stepAfter', strokeWidth: 2, ...(forced && POOL_DASH[k] ? { strokeDasharray: POOL_DASH[k] } : {}) },
        hideNonActiveDots: true,
      })),
    };
  }, [points, pools.join(), forced, theme, summary]);

  const rows = useMemo(() => (asTable ? sampleEvery(points, 0.5, maxTime) : []), [asTable, points, maxTime]);

  return (
    <section className={styles.section} aria-labelledby="chart-heading">
      <div className={styles.head}>
        <span className={styles.titleBlock}>
          <Subtitle2 as="h3" id="chart-heading">Enemy health over time</Subtitle2>
          <span className={styles.captionLine}>
            {/* The chart is one seeded run; Time to kill above averages 8 runs, so the caption says so. */}
            <Caption1 className={styles.caption}>{killedAt != null ? `One sample run · killed at ${fmtNum(killedAt, 2)} s` : `One sample run · survived ${simTime} s`}</Caption1>
            {updating ? <Spinner size="extra-tiny" label="Updating chart…" labelPosition="after" /> : null}
          </span>
        </span>
        <span className={styles.spacer} />
        <ToggleButton size="small" appearance="subtle" icon={<TableRegular />} checked={asTable} onClick={() => actions.setChartAsTable(!asTable)}>
          Show as table
        </ToggleButton>
      </div>
      {asTable ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Enemy health samples">
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
      ) : (
        <div className={styles.chart} data-testid="health-chart" style={{ height: chartHeight + LEGEND_HEIGHT }}>
          <LineChart
            data={data}
            height={chartHeight}
            yMaxValue={yAxis.max}
            yAxisTickFormat={v => fmtAxis(v)}
            tickFormat={v => `${fmtNum(Number(v), 1)} s`}
            yMinValue={0}
            xMinValue={0}
            xMaxValue={xAxis.max}
            showRoundOffXTickValues={false}
            tickValues={Array.from({ length: xAxis.count + 1 }, (_, i) => +(i * xAxis.step).toPrecision(12))}
            yAxisTickCount={yAxis.count}
            legendProps={{ allowFocusOnLegends: true }}
            enablePerfOptimization
          />
        </div>
      )}
    </section>
  );
}

function DamageShare({ debug }) {
  const styles = useStyles();
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const rows = useMemo(() => damageShare(debug.debugLog), [debug]);
  return (
    <section className={styles.section} aria-labelledby="share-heading">
      <Subtitle2 as="h3" id="share-heading">Damage by hit type</Subtitle2>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map(r => (
            <li key={r.type} className={styles.row}>
              <Caption1 className={styles.label} title={r.type}>{r.type}</Caption1>
              <span className={styles.track} aria-hidden="true">
                <span
                  className={`${styles.fill} uf-bar-fill`}
                  style={{ width: `${Math.max(1, r.share * 100)}%`, backgroundColor: damageTypeColor(r.type, dark) ?? tokens.colorBrandBackground }}
                />
              </span>
              <Caption1 className={styles.value}>
                {fmtNum(r.share * 100, 1)}% <span className={styles.muted}>· {fmtCompact(r.damage)}</span>
              </Caption1>
            </li>
          ))}
        </ul>
      ) : <Caption1>No hits recorded.</Caption1>}
    </section>
  );
}

export function ChartsPanel() {
  const sim = useApp(s => s.sim);
  const { simKey } = useDerived();
  const busy = sim.status === 'pending' || sim.status === 'running';
  // A failed simulation of the current build never shows an older build's charts as current.
  if (sim.status === 'error' && sim.key === simKey) {
    return <Caption1>Charts appear once this build simulates. See the error above.</Caption1>;
  }
  if (!sim.debug || !sim.debugEnemy) {
    if (sim.debugError) {
      return (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>Charts unavailable: {sim.debugError}. The numbers above are still valid.</MessageBarBody>
        </MessageBar>
      );
    }
    if (sim.status === 'error') return <Caption1>Charts appear once the build simulates.</Caption1>;
    return <Spinner size="tiny" label="Drawing charts…" labelPosition="after" />;
  }
  return (
    <>
      <HealthChart debug={sim.debug} enemy={sim.debugEnemy} simTime={sim.debugTime} updating={busy} />
      <DamageShare debug={sim.debug} />
    </>
  );
}
