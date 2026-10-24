// The Readout (docs/declutter-spec.md 4): what the build does, in one column. The DPS hero (delta as text, TTK),
// the target line (Change opens the target popover; Buffs, or the buffs summary while some are set, the External
// buffs dialog) with the run menu, the honesty line, the weapon stats sheet
// with damage by type, Compare (pins, Expand opens the full table) and the credit line. On the layer tone, no
// cards, no pills.
import { useMemo } from 'react';
import {
  Body1, Button, Caption1, LargeTitle, Link, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuItemRadio, MenuList,
  MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody, Popover, PopoverSurface, PopoverTrigger, ProgressBar,
  Skeleton, SkeletonItem, Subtitle2, Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular, ArrowExpandRegular, CircleHalfFillRegular, InfoRegular, MoreHorizontalRegular, PinRegular, WarningRegular,
} from '@fluentui/react-icons';
import { actions, simKey } from '../controller.js';
import { useApp, useDelayedFlag, useDerived } from '../hooks.js';
import {
  DURATIONS, INCARNON_NOTE, SIM_SEEDS, compareRows, isIncarnonMode, resultDelta, simErrorText, targetLabel, ttkText,
} from '../model.js';
import { fmtInt } from '../format.js';
import { buffLine, statusLine } from '../../shared/external-buffs.js';
import { DISPLAY_FONT } from '../theme.js';
import { DeltaText, hasNoStats } from './common.jsx';
import { StatSheet } from './StatSheet.jsx';
import { TargetForm } from './TargetForm.jsx';
import { UNDERFRAME_URL } from './links.js';

const useStyles = makeStyles({
  readout: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    backgroundColor: 'var(--uf-layer)',
    overflowY: 'auto',
    overflowX: 'hidden',
    borderTopLeftRadius: tokens.borderRadiusXLarge,
  },
  stacked: { overflowY: 'visible', borderRadius: 0, flexShrink: 0 },
  progress: { position: 'absolute', top: 0, left: 0, right: 0 },
  hero: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: tokens.spacingHorizontalL, minWidth: 0 },
  heroLeft: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  heroRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  label: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  valueRow: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalM, minWidth: 0 },
  dps: { fontFamily: DISPLAY_FONT, fontVariantNumeric: 'tabular-nums', fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap' },
  ttk: { fontFamily: DISPLAY_FONT, fontVariantNumeric: 'tabular-nums', fontSize: tokens.fontSizeBase500, lineHeight: tokens.lineHeightBase500, fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap' },
  line: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0, minHeight: '28px' },
  target: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  spacer: { flexGrow: 1 },
  linkTarget: { minHeight: '24px', display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  honesty: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground2, minWidth: 0, minHeight: '24px' },
  honestyText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  targetSurface: { width: 'min(440px, 90vw)', maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' },
  section: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  compareHead: {
    display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minHeight: '32px',
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`, paddingTop: tokens.spacingVerticalXS,
  },
  compareTitle: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap' },
  pinRow: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 5rem 4.5rem 4.5rem', alignItems: 'center', columnGap: tokens.spacingHorizontalS,
    minHeight: '24px', fontVariantNumeric: 'tabular-nums',
  },
  pinName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  pinNum: { textAlign: 'right', whiteSpace: 'nowrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  credit: { color: tokens.colorNeutralForeground3, marginTop: 'auto', marginBottom: 0, marginLeft: 0, marginRight: 0, paddingTop: tokens.spacingVerticalM },
  pinList: { listStyle: 'none', margin: 0, padding: 0 },
});

const NONE = Object.freeze([]);

/** What isn't modelled in this build: mods, arcanes, the incarnon form. Null when everything is. */
function useHonesty() {
  const { partialMap, stats } = useDerived();
  const ctx = useApp(s => s.ctx);
  const mods = useApp(s => s.build.mods);
  const incarnon = useApp(s => isIncarnonMode(s.build.modeName));
  const entries = [...partialMap.entries()].filter(([name]) => mods.some(m => m?.name === name));
  const engineOnly = mods.filter(m => m && hasNoStats(ctx, m.name)).map(m => m.name);
  const arcaneNotes = (stats?.arcaneNotes ?? []).filter(n => n.level !== 'inactive');
  // External buffs this app does not simulate (melee, AoE, Hall of Mirrors, ...), kept on the build.
  const externalNotes = stats?.externalNotes ?? [];
  // The external buffs and target statuses the result includes (they are simulated; the popover names them).
  const ctxData = ctx.data;
  const buffs = useApp(s => s.build.externalBuffs ?? NONE);
  const statuses = useApp(s => s.build.externalStatuses ?? NONE);
  const applied = [...buffs.map(b => buffLine(b, ctxData)), ...statuses.map(statusLine)].join('; ');
  const count = entries.length + engineOnly.length + arcaneNotes.length + externalNotes.length + (incarnon ? 1 : 0);
  return count ? { entries, engineOnly, arcaneNotes, externalNotes, incarnon, count, applied } : null;
}

/** "◐ Partially simulated: 2 mods · Details" (spec 4): a neutral line, the list in a popover. */
function HonestyLine() {
  const styles = useStyles();
  const h = useHonesty();
  if (!h) return null;
  const things = h.entries.length + h.engineOnly.length + h.arcaneNotes.length + h.externalNotes.length;
  const what = [things ? `${things} ${things === 1 ? 'item' : 'items'} approximated` : null, h.incarnon ? 'incarnon form not modelled' : null].filter(Boolean).join(', ');
  return (
    <div className={styles.honesty} data-testid="honesty-line">
      <CircleHalfFillRegular aria-hidden="true" />
      <Caption1 className={styles.honestyText}>Partially simulated: {what}</Caption1>
      <Popover withArrow positioning="below-end">
        <PopoverTrigger disableButtonEnhancement>
          <Link as="button" className={styles.linkTarget} data-testid="honesty-details" aria-label="Partially simulated: show details">Details</Link>
        </PopoverTrigger>
        <PopoverSurface style={{ maxWidth: 360 }}>
          <Body1 as="p" style={{ marginTop: 0 }}>Parts of this build aren't modelled, so its results may be off:</Body1>
          <ul className={styles.list}>
            {h.incarnon ? <li><Body1>Incarnon form: {INCARNON_NOTE}</Body1></li> : null}
            {h.entries.map(([name, list]) => <li key={name}><Body1>{name}: {list.join(', ')}</Body1></li>)}
            {h.engineOnly.map(name => <li key={`e-${name}`}><Body1>{name}: no numeric stats in the data; it counts only if the engine models it itself.</Body1></li>)}
            {h.arcaneNotes.map(n => <li key={`${n.name}-${n.level}`}><Body1>{n.name}: {n.level === 'none' ? 'not simulated. ' : 'partially simulated. '}{n.text}</Body1></li>)}
            {h.externalNotes.map((n, i) => <li key={`x-${i}-${n.name}`}><Body1>External buff {n.name}: {n.text}</Body1></li>)}
          </ul>
          {h.applied ? <Body1 as="p" style={{ marginBottom: 0 }} data-testid="honesty-external">Also applied: {h.applied}. Buffs lists them.</Body1> : null}
        </PopoverSurface>
      </Popover>
    </div>
  );
}

/** Run again, Simulated time and Run details (the result's settings, in one menu). */
function RunMenu() {
  const simTime = useApp(s => s.build.simTime);
  return (
    <Menu
      positioning="below-end"
      checkedValues={{ duration: [String(simTime)] }}
      onCheckedValueChange={(_e, d) => { if (d.name === 'duration') actions.setDuration(Number(d.checkedItems[0])); }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Simulation" relationship="label">
          <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} data-testid="run-menu" />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<ArrowClockwiseRegular />} secondaryContent="Ctrl+Enter" onClick={() => actions.runNow()}>Run again</MenuItem>
          <MenuItem icon={<InfoRegular />} onClick={() => actions.openDialog('run')} data-testid="run-details">Run details and what's simulated</MenuItem>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>Simulated time</MenuGroupHeader>
            {DURATIONS.map(d => <MenuItemRadio key={d} name="duration" value={String(d)}>{`${d} s per run`}</MenuItemRadio>)}
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/**
 * The External buffs entry, on the target line: a quiet "Buffs" link at rest; while buffs or target statuses are
 * set, the same link is their summary ("Buffs: 3 · Statuses: 1"), so the Readout gains no line.
 */
function BuffsLink() {
  const styles = useStyles();
  const buffs = useApp(s => s.build.externalBuffs?.length ?? 0);
  const statuses = useApp(s => s.build.externalStatuses?.length ?? 0);
  const summary = [buffs ? `Buffs: ${buffs}` : null, statuses ? `Statuses: ${statuses}` : null].filter(Boolean).join(' · ');
  const spoken = [buffs ? `${buffs} external ${buffs === 1 ? 'buff' : 'buffs'}` : null, statuses ? `${statuses} target ${statuses === 1 ? 'status' : 'statuses'}` : null].filter(Boolean).join(' and ');
  return (
    <Link
      as="button"
      className={styles.linkTarget}
      data-focus-id="buffs-open"
      data-testid={summary ? 'buffs-summary' : 'buffs-open'}
      // The accessible name starts with the visible text (WCAG 2.5.3, label in name).
      aria-label={summary ? `${summary}, ${spoken}. Edit external buffs and target statuses` : 'Buffs: external buffs and target statuses'}
      title={summary ? `${spoken}: edit` : undefined}
      onClick={() => actions.setBuffsOpen(true)}
    >
      {summary || 'Buffs'}
    </Link>
  );
}

function TargetLine() {
  const styles = useStyles();
  const enemyCfg = useApp(s => s.build.enemy);
  const open = useApp(s => s.targetOpen);
  const label = targetLabel(enemyCfg);
  return (
    <div className={styles.line}>
      <Caption1 className={styles.target} title={`vs ${label}`} data-testid="target-line">vs {label}</Caption1>
      <Popover open={open} onOpenChange={(_e, d) => actions.setTargetOpen(d.open)} positioning="below-start" trapFocus withArrow>
        <PopoverTrigger disableButtonEnhancement>
          <Link as="button" className={styles.linkTarget} data-focus-id="target-change" data-testid="target-change">Change</Link>
        </PopoverTrigger>
        <PopoverSurface className={styles.targetSurface} aria-label="Target">
          <TargetForm />
        </PopoverSurface>
      </Popover>
      <BuffsLink />
      <span className={styles.spacer} />
      <RunMenu />
    </div>
  );
}

function Hero({ compact }) {
  const styles = useStyles();
  const sim = useApp(s => s.sim);
  // The DPS is no longer the weapon's alone while external buffs or target statuses are set: the caption says so.
  const external = useApp(s => {
    const b = s.build.externalBuffs?.length ?? 0;
    const t = s.build.externalStatuses?.length ?? 0;
    return b && t ? 'external buffs and statuses' : b ? 'external buffs' : t ? 'target statuses' : '';
  });
  const { simKey: key } = useDerived();
  const s = sim.summary;
  const current = sim.key === key;
  const busy = sim.status === 'pending' || sim.status === 'running' || (!current && sim.status !== 'error');
  const error = sim.status === 'error' && current;
  const firstLoad = !s?.ok && !error;
  const show = !error && s?.ok;
  const delta = show ? resultDelta(s.avgDps, sim.prev?.avgDps) : null;
  return (
    <>
      <div className={styles.hero} aria-busy={busy || undefined}>
        <div className={styles.heroLeft}>
          <Caption1 className={styles.label} data-testid="avg-dps-label">Average DPS{external ? ` · with ${external}` : ''}</Caption1>
          <div className={styles.valueRow}>
            {firstLoad ? <Skeleton style={{ width: 180 }}><SkeletonItem size={compact ? 32 : 40} /></Skeleton> : (
              <LargeTitle className={styles.dps} style={compact ? { fontSize: 32, lineHeight: '40px' } : { fontSize: 40, lineHeight: '52px' }} data-testid="avg-dps">
                {show ? fmtInt(s.avgDps) : '—'}
              </LargeTitle>
            )}
            <DeltaText delta={delta} title={sim.prev ? `Previous run: ${fmtInt(sim.prev.avgDps)} DPS` : undefined} />
          </div>
        </div>
        <div className={styles.heroRight}>
          <Caption1 className={styles.label}>Time to kill</Caption1>
          {firstLoad ? <SkeletonItem size={20} style={{ width: 64 }} /> : (
            <span className={styles.ttk} data-testid="ttk">{show ? (s.ttk == null ? `> ${s.maxTime} s` : ttkText(s)) : '—'}</span>
          )}
        </div>
      </div>
      {error ? (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            Couldn't simulate this build. {simErrorText(sim.error)}
            {s?.ok ? <Caption1 as="p" style={{ display: 'block', margin: '4px 0 0' }}>Last result {fmtInt(s.avgDps)} DPS was for an earlier version of this build.</Caption1> : null}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => actions.runNow()}>Try again</Button>
          </MessageBarActions>
        </MessageBar>
      ) : null}
      {show && s.failedRuns ? (
        <Caption1 className={styles.honesty}><WarningRegular aria-hidden="true" /> {s.failedRuns} of {SIM_SEEDS.length} runs failed and were left out.</Caption1>
      ) : null}
    </>
  );
}

/** Compare (spec 4): Pin and Expand, then the first pins against the baseline; the rest is in the Expand dialog. */
function CompareSection({ limit, compact = false }) {
  const styles = useStyles();
  const pins = useApp(s => s.pins);
  const baselineId = useApp(s => s.baselineId);
  const sim = useApp(s => s.sim);
  useApp(s => s.build);
  const canPin = sim.summary?.ok && sim.key === simKey() && sim.status === 'done';
  const rows = useMemo(() => compareRows(pins, baselineId), [pins, baselineId]);
  const shown = rows.slice(0, limit);
  return (
    <section className={styles.section} aria-labelledby="compare-heading" data-testid="compare-section">
      <div className={styles.compareHead}>
        <Subtitle2 as="h2" id="compare-heading" className={styles.compareTitle}>Compare</Subtitle2>
        <Caption1 className={styles.muted}>{pins.length ? `${pins.length} pinned` : 'Nothing pinned'}</Caption1>
        <span className={styles.spacer} />
        <Tooltip content={canPin ? 'Pin this result (Ctrl+P)' : 'Pins once the result is in (Ctrl+P)'} relationship="description">
          <Button size="small" appearance="subtle" icon={<PinRegular />} onClick={() => actions.pinResult()} data-focus-id="pin-current" data-testid="pin-current">Pin</Button>
        </Tooltip>
        <Tooltip content="All pins side by side (Ctrl+J)" relationship="description">
          <Button size="small" appearance="subtle" icon={<ArrowExpandRegular />} disabledFocusable={!pins.length} onClick={() => actions.setCompareOpen(true)} data-focus-id="compare-expand" data-testid="compare-expand">Expand</Button>
        </Tooltip>
      </div>
      {shown.length ? (
        <ul className={styles.pinList} aria-label="Pinned results">
          {shown.map(r => (
            <li key={r.id} className={styles.pinRow} data-testid="compare-row">
              <Caption1 className={styles.pinName} title={`${r.buildName} · ${r.changesText}`}>
                {r.baseline ? <><strong>Baseline</strong> · {r.buildName}</> : r.changesText === '—' || r.changesText === 'Same setup' ? r.buildName : r.changesText}
              </Caption1>
              <Caption1 className={styles.pinNum}>{fmtInt(r.avgDps)}</Caption1>
              <Caption1 className={mergeClasses(styles.pinNum, styles.muted)}>{r.ttkText}</Caption1>
              <span className={styles.pinNum}>{r.delta == null || Math.abs(r.delta) < 0.0005 ? <Caption1 className={styles.muted}>—</Caption1> : <DeltaText delta={r.delta} />}</span>
            </li>
          ))}
          {/* On a short window the header's "N pinned" and Expand say it, so the credit line keeps its room. */}
          {rows.length > shown.length && !compact ? <li><Caption1 className={styles.muted}>{rows.length - shown.length} more in Expand</Caption1></li> : null}
        </ul>
      ) : null}
    </section>
  );
}

function Credit() {
  const styles = useStyles();
  return (
    <Caption1 as="p" className={styles.credit} data-testid="credit">
      Damage engine and game data by Underframe (<Link inline onClick={() => actions.openExternal(UNDERFRAME_URL)}>underframe.site</Link>), used with permission. Not affiliated with Digital Extremes.
    </Caption1>
  );
}

export function Readout({ layout, stacked = false }) {
  const styles = useStyles();
  const sim = useApp(s => s.sim);
  const { simKey: key } = useDerived();
  const busy = sim.status === 'pending' || sim.status === 'running' || (sim.key !== key && sim.status !== 'error');
  const updating = useDelayedFlag(busy && Boolean(sim.summary), 150);
  const compact = layout.compactHeight || stacked;
  const g = layout.gutter;
  return (
    <section
      className={mergeClasses(styles.readout, stacked && styles.stacked)}
      style={{ padding: `${compact ? 12 : 20}px ${g}px ${compact ? 10 : 16}px`, gap: compact ? 6 : 10 }}
      data-pane="readout"
      aria-label="Readout"
      data-testid="readout"
      id="result-card-region"
      {...(stacked ? {} : { 'data-scroll-region': '' })}
    >
      {updating ? <ProgressBar className={styles.progress} thickness="medium" aria-hidden="true" /> : null}
      <div data-testid="result-card" role="group" aria-label="Result">
        <Hero compact={compact} />
        <TargetLine />
        <HonestyLine />
      </div>
      <StatSheet density={compact ? 'compact' : layout.tall ? 'large' : 'normal'} />
      {/* On a short window one pinned row is shown (the rest are in Expand), so the credit line stays on screen. */}
      <CompareSection limit={compact ? 1 : layout.body >= 1000 ? 6 : 3} compact={compact} />
      <Credit />
    </section>
  );
}
