// Result card: always visible at the top of the results column. Average DPS, its change, spread, TTK,
// hits, target, and the Pin / Run again / Simulated time actions.
import {
  Badge, Body1, Button, Caption1, Caption1Strong, Card, Dropdown, InfoLabel, LargeTitle, Link, MessageBar,
  MessageBarActions, MessageBarBody, Option, Popover, PopoverSurface, PopoverTrigger, ProgressBar, SkeletonItem,
  Skeleton, Subtitle2, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, PinRegular, WarningRegular } from '@fluentui/react-icons';
import { actions, focusLater } from '../controller.js';
import { useApp, useDelayedFlag, useDerived } from '../hooks.js';
import { DURATIONS, INCARNON_NOTE, SIM_SEEDS, isIncarnonMode, resultDelta, ttkText, targetLabel } from '../model.js';
import { fmtInt } from '../format.js';
import { DISPLAY_FONT } from '../theme.js';
import { DeltaBadge } from './common.jsx';

export const WHATS_SIMULATED = "Seeded runs of Underframe's engine: crits, status, armor, shields and overguard. Not yet: arcanes, rivens, conditional mods, incarnon bonuses, melee.";

const useStyles = makeStyles({
  card: {
    position: 'relative',
    flexShrink: 0,
    gap: tokens.spacingVerticalS,
    overflow: 'hidden',
  },
  progress: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minHeight: '24px' },
  label: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  spacer: { flexGrow: 1 },
  valueRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, minHeight: '52px' },
  value: { fontFamily: DISPLAY_FONT, fontVariantNumeric: 'tabular-nums', lineHeight: '52px' },
  spread: { color: tokens.colorNeutralForeground2, minHeight: '16px', fontVariantNumeric: 'tabular-nums' },
  metrics: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr)', gap: tokens.spacingHorizontalM, minHeight: '42px' },
  metric: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  metricValue: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  target: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalS, color: tokens.colorNeutralForeground2, minWidth: 0 },
  targetText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  actions: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  duration: { minWidth: '96px', width: '96px' },
  warn: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, color: tokens.colorStatusWarningForeground1 },
  partialTrigger: {
    padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: tokens.borderRadiusMedium, minHeight: '24px',
    display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
  },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  previous: { color: tokens.colorNeutralForeground2 },
});

function Metric({ label, value, testId, loading }) {
  const styles = useStyles();
  return (
    <div className={styles.metric}>
      <Caption1 className={styles.label}>{label}</Caption1>
      {loading ? <SkeletonItem size={20} style={{ width: '70%' }} /> : (
        <Subtitle2 className={styles.metricValue} data-testid={testId} title={value}>{value}</Subtitle2>
      )}
    </div>
  );
}

function AggregatePartial() {
  const styles = useStyles();
  const { partialMap } = useDerived();
  const mods = useApp(s => s.build.mods);
  const incarnon = useApp(s => isIncarnonMode(s.build.modeName));
  const entries = [...partialMap.entries()].filter(([name]) => mods.some(m => m?.name === name));
  if (!entries.length && !incarnon) return null;
  return (
    <Popover withArrow positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={styles.partialTrigger} aria-label="Partially simulated. Show which mods">
          <Badge appearance="tint" color="warning" icon={<WarningRegular />}>Partially simulated</Badge>
        </button>
      </PopoverTrigger>
      <PopoverSurface style={{ maxWidth: 340 }}>
        <Body1 as="p" style={{ marginTop: 0 }}>Parts of this build aren't modelled, so its results may be off:</Body1>
        <ul className={styles.list}>
          {incarnon ? <li><Body1>Incarnon form: {INCARNON_NOTE}</Body1></li> : null}
          {entries.map(([name, stats]) => <li key={name}><Body1>{name}: {stats.join(', ')}</Body1></li>)}
        </ul>
      </PopoverSurface>
    </Popover>
  );
}

export function ResultCard() {
  const styles = useStyles();
  const sim = useApp(s => s.sim);
  const simTime = useApp(s => s.build.simTime);
  const enemyCfg = useApp(s => s.build.enemy);
  const { simKey } = useDerived();
  const s = sim.summary;
  const current = sim.key === simKey;
  const busy = sim.status === 'pending' || sim.status === 'running' || (!current && sim.status !== 'error');
  const updating = useDelayedFlag(busy && Boolean(s), 150);
  const error = sim.status === 'error' && current;
  const firstLoad = !s?.ok && !error;
  const show = !error && s?.ok;
  const delta = show ? resultDelta(s.avgDps, sim.prev?.avgDps) : null;
  const pinReason = error ? 'Fix the simulation error first' : busy || !s?.ok ? 'Wait for the result to finish updating' : null;

  return (
    <Card className={styles.card} appearance="filled" data-testid="result-card" role="region" aria-label="Result" aria-busy={busy || undefined}>
      {updating || firstLoad ? <ProgressBar className={styles.progress} thickness="medium" aria-hidden="true" /> : null}
      <div className={styles.top}>
        <Caption1Strong className={styles.label}>Average DPS</Caption1Strong>
        <span className={styles.spacer} />
        <AggregatePartial />
        <InfoLabel info={WHATS_SIMULATED} infoButton={{ 'aria-label': "What's simulated" }} />
      </div>
      <div className={styles.valueRow}>
        {firstLoad ? <Skeleton style={{ width: '60%' }}><SkeletonItem size={40} /></Skeleton> : (
          <LargeTitle className={styles.value} data-testid="avg-dps">{show ? fmtInt(s.avgDps) : '—'}</LargeTitle>
        )}
        <DeltaBadge delta={delta} tooltip={sim.prev ? `Previous result: ${fmtInt(sim.prev.avgDps)} DPS` : null} />
      </div>
      {/* Not a live region: the Announcer reads each completed result once (UX spec 5.1). */}
      <Caption1 className={styles.spread}>
        {updating ? 'Updating…' : show ? `${fmtInt(s.minDps)}–${fmtInt(s.maxDps)} across ${s.runs} runs · ${s.maxTime} s each` : error ? 'Simulation failed' : 'Running the first simulation…'}
      </Caption1>
      {error ? (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            Couldn't simulate this build. {sim.error}
            {s?.ok ? <Caption1 as="p" className={styles.previous} style={{ display: 'block', margin: '4px 0 0' }}>Last result {fmtInt(s.avgDps)} DPS was for an earlier version of this build.</Caption1> : null}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => actions.runNow()}>Try again</Button>
          </MessageBarActions>
        </MessageBar>
      ) : null}
      <div className={styles.metrics}>
        <Metric label="Time to kill" testId="ttk" loading={firstLoad} value={show ? (s.ttk == null ? `Not killed in ${s.maxTime} s` : ttkText(s)) : '—'} />
        <Metric label="Average hit" loading={firstLoad} value={show ? fmtInt(s.avgHit) : '—'} />
        <Metric label="First hit" loading={firstLoad} value={show ? fmtInt(s.firstHitDamage) : '—'} />
      </div>
      {show && s.failedRuns ? (
        <Caption1 className={styles.warn}><WarningRegular aria-hidden="true" /> {s.failedRuns} of {SIM_SEEDS.length} runs failed and were left out.</Caption1>
      ) : null}
      <div className={styles.target}>
        <Tooltip content={`vs ${targetLabel(enemyCfg)}`} relationship="description">
          <Caption1 className={styles.targetText}>vs {targetLabel(enemyCfg)}</Caption1>
        </Tooltip>
        <Link
          as="button"
          inline
          onClick={() => {
            document.getElementById('target-card')?.scrollIntoView({ block: 'nearest' });
            focusLater('target-enemy');
          }}
        >
          Change
        </Link>
      </div>
      <div className={styles.actions}>
        <Tooltip content={pinReason ?? 'Pin to compare (Ctrl+P)'} relationship="description">
          <Button icon={<PinRegular />} disabledFocusable={Boolean(pinReason)} onClick={() => actions.pinResult()}>Pin to compare</Button>
        </Tooltip>
        <Tooltip content="Run again (Ctrl+Enter)" relationship="label">
          <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={() => actions.runNow()} />
        </Tooltip>
        <Tooltip content="Simulated time" relationship="description">
          <Dropdown
            className={styles.duration}
            aria-label="Simulated time"
            value={`${simTime} s`}
            selectedOptions={[String(simTime)]}
            onOptionSelect={(_e, d) => actions.setDuration(Number(d.optionValue))}
          >
            {DURATIONS.map(d => <Option key={d} value={String(d)}>{`${d} s`}</Option>)}
          </Dropdown>
        </Tooltip>
      </div>
    </Card>
  );
}

