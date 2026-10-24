// The riven tools (docs/port-rivens.md 13): underframe.site's Slot My Riven, Auto Riven, Get Rolls Data and Left/Right
// compare, behind one "Riven" menu on the Loadout's capacity line. The dialog shows the tool's setup (the site's rolls
// scan sections), its progress with Cancel, then the result: Apply (one undo step), or Save CSV for the rolls data.
// The menu also reads rivens from a screenshot and imports or exports the user's rivens.
//
// Focus never falls to the page: Start moves it to Cancel, a result to its first action, Back or an error to Start.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1, Body1Strong, Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown,
  Field, Input, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar,
  MessageBarBody, Option, ProgressBar, Subtitle2, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow,
  ToggleButton, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular, ArrowUploadRegular, ClipboardPasteRegular, DismissRegular, DocumentArrowDownRegular, EditRegular,
  ImageRegular, InfoRegular, SparkleRegular,
} from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { fmtInt } from '../format.js';
import { GENERAL_SLOTS, slotLabel } from '../model.js';
import * as AS from '../../shared/auto-build-settings.js';
import {
  RIVEN_TOOL_MODES, ROLL_FORCED_LIMIT, ROLL_RUNS, ROLL_SIM_TIME, ROLL_STAT_VALUE, elementListText, rollNegativeStats, rollPositiveStats,
  rollStatLabel, tweakListText,
} from '../../shared/riven-tools.js';
import { canTakeRiven, isRiven, libraryRivensFor, rivenLines, rivenShortName, rivenSummary } from '../../shared/rivens.js';
import { rivenToolBlock } from '../riven-tools-flow.js';
import { DeltaText } from './common.jsx';

const useStyles = makeStyles({
  surface: { width: 'min(760px, 94vw)', maxWidth: 'min(760px, 94vw)' },
  // The content scrolls; its children keep their height (a message bar would otherwise shrink and spill its text).
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxHeight: 'min(70vh, 760px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: tokens.spacingHorizontalXS, '& > *': { flexShrink: 0 } },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  heading: { margin: 0 },
  muted: { color: tokens.colorNeutralForeground2, margin: 0 },
  toggles: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  toggle: { fontWeight: tokens.fontWeightRegular },
  fields: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    alignItems: 'start', '& > *': { minWidth: 0 }, '& .fui-Input': { width: '100%', minWidth: 0, boxSizing: 'border-box' }, '& .fui-Dropdown': { minWidth: 0, width: '100%' },
  },
  switches: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL },
  line: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground2, margin: 0, '& > svg': { flexShrink: 0, marginTop: '2px' } },
  progress: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, padding: `${tokens.spacingVerticalS} 0` },
  dps: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, fontVariantNumeric: 'tabular-nums' },
  dpsValue: { fontSize: tokens.fontSizeBase500, lineHeight: tokens.lineHeightBase500, fontWeight: tokens.fontWeightSemibold },
  riven: {
    display: 'flex', flexDirection: 'column', gap: '2px', padding: tokens.spacingVerticalS, borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3, minWidth: 0, '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  rivenLines: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground1 },
  sides: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: tokens.spacingHorizontalL },
  table: { fontVariantNumeric: 'tabular-nums' },
  // Action labels stay on one line (four buttons fit the footer at 1100 px).
  nowrap: { whiteSpace: 'nowrap', flexShrink: 0 },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: 0 },
});

const ABOUT = {
  slot: 'Tries each of your rivens for this weapon in every slot without a riven and proposes the placement that scores best.',
  auto: 'Imagines a riven rolled at the chosen strength for every set of positive stats, places it where it helps most, then picks the negative stat that costs least.',
  rolls: 'Scores every set of positive stats with the chosen negative in every slot, and saves the list as a CSV file, best first.',
  compare: 'Scores two rivens (a reroll\'s old and new roll) in this build and says which is better.',
};

const fmtTime = ms => {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const focusSoon = get => requestAnimationFrame(() => requestAnimationFrame(() => get()?.focus()));
const intOr = (text, fallback) => (/^\s*\d+\s*$/.test(String(text)) ? Number(text) : fallback);

/** A riven card in text: its short name and stat lines. */
function RivenText({ riven, title = null, note = null, action = null }) {
  const styles = useStyles();
  return (
    <div className={styles.riven}>
      <Body1Strong>{title ?? rivenShortName(riven)}</Body1Strong>
      <ul className={styles.rivenLines}>{rivenLines(riven).map(l => <li key={l}><Body1>{l}</Body1></li>)}</ul>
      {note ? <Caption1 className={styles.muted}>{note}</Caption1> : null}
      {action}
    </div>
  );
}

/** A set of toggle buttons over choices: [{ value, label }], `selected` a Set. */
function Toggles({ label, hint, items, selected, onChange, max = Infinity, testid }) {
  const styles = useStyles();
  return (
    <section className={styles.section} aria-label={label} data-testid={testid}>
      <Subtitle2 as="h3" className={styles.heading}>{label}</Subtitle2>
      {hint ? <Caption1 className={styles.muted}>{hint}</Caption1> : null}
      {items.length ? (
        <div className={styles.toggles} role="group" aria-label={label}>
          {items.map(it => {
            const on = selected.has(it.value);
            return (
              <ToggleButton
                key={it.value}
                size="small"
                className={styles.toggle}
                checked={on}
                disabled={!on && selected.size >= max}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(it.value); else next.add(it.value);
                  onChange(next, it.value, !on);
                }}
              >
                {it.label}
              </ToggleButton>
            );
          })}
        </div>
      ) : <Caption1 className={styles.muted}>Nothing to choose here.</Caption1>}
    </section>
  );
}

/** The tool's setup: the site's rolls scan sections for the mode. Calls onReady(options or null) whenever it changes. */
function Setup({ rt, onOptions }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const lib = useApp(s => s.autoBuildLibrary);
  const library = useApp(s => s.rivenLibrary);
  const weapon = ctx.weaponByName.get(build.weaponName);
  const mode = RIVEN_TOOL_MODES[rt.tool];
  const has = k => mode.sections.includes(k);
  const prev = rt.options ?? {};
  const settings = AS.effectiveSettings(lib);
  const positives = useMemo(() => rollPositiveStats(ctx.data, weapon), [ctx, weapon]);
  const negatives = useMemo(() => rollNegativeStats(ctx.data, weapon), [ctx, weapon]);
  const [protect, setProtect] = useState(() => new Set(prev.protectedSlots ?? []));
  const [skipSlots, setSkipSlots] = useState(() => new Set(prev.excludedSlots ?? []));
  const [excluded, setExcluded] = useState(() => new Set(prev.excludedStats ?? []));
  const [forced, setForced] = useState(() => new Set(prev.forcedPositiveStats ?? []));
  const [negative, setNegative] = useState(prev.negativeStat ?? (rt.tool === 'rolls' && negatives.includes('Zoom') ? 'Zoom' : null));
  const [opt, setOpt] = useState(() => prev.optimization ?? { buildForRawDamage: settings.buildForRawDamage, buildForStatusDamage: !settings.buildForRawDamage && settings.buildForStatusDamage, buildForFloor: false, buildForSingleHit: settings.buildForSingleHit });
  const [keepElements, setKeepElements] = useState(prev.preserveElementalCombo ?? true);
  const [tweaks, setTweaks] = useState(prev.allowMinorBuildTweaks ?? false);
  const [samples, setSamples] = useState(String(prev.sampleCount ?? ROLL_RUNS.default));
  const [simTime, setSimTime] = useState(String(prev.simulationTimeSeconds ?? ROLL_SIM_TIME.default));
  const [strength, setStrength] = useState(String(Math.round((prev.statValue ?? ROLL_STAT_VALUE.default) / 100)));
  const sampleN = intOr(samples, NaN);
  const simN = intOr(simTime, NaN);
  const strengthN = intOr(strength, NaN);
  const bad = {
    samples: !(sampleN >= ROLL_RUNS.min && sampleN <= ROLL_RUNS.max) ? `A whole number from ${ROLL_RUNS.min} to ${ROLL_RUNS.max}` : null,
    simTime: !(simN >= ROLL_SIM_TIME.min && simN <= ROLL_SIM_TIME.max) ? `A whole number of seconds from ${ROLL_SIM_TIME.min} to ${ROLL_SIM_TIME.max}` : null,
    strength: !(strengthN >= 90 && strengthN <= 110) ? 'A whole number from 90 to 110' : null,
  };
  const ok = !(has('samples') && bad.samples) && !(has('simulationTime') && bad.simTime) && !(has('statValue') && bad.strength) && !(mode.requiresNegative && !negative);
  useEffect(() => {
    onOptions(ok ? {
      protectedSlots: [...protect], excludedSlots: [...skipSlots], excludedStats: [...excluded], forcedPositiveStats: [...forced],
      negativeStat: negative, sampleCount: sampleN, simulationTimeSeconds: simN, statValue: strengthN * 100, optimization: opt,
      allowMinorBuildTweaks: tweaks, preserveElementalCombo: keepElements,
    } : null);
  }, [ok, protect, skipSlots, excluded, forced, negative, sampleN, simN, strengthN, opt, tweaks, keepElements]); // eslint-disable-line react-hooks/exhaustive-deps

  const filled = GENERAL_SLOTS.filter(i => build.mods[i] && !isRiven(build.mods[i]));
  const slotItems = list => list.map(i => ({ value: i, label: `${slotLabel(i)}: ${build.mods[i]?.name ?? 'empty'}` }));
  const statItems = positives.map(s => ({ value: s, label: rollStatLabel(s) }));
  const mine = libraryRivensFor(library, weapon);
  return (
    <>
      <Caption1 as="p" className={styles.muted}>{ABOUT[rt.tool]}</Caption1>
      {rt.tool === 'slot' ? (
        <section className={styles.section} aria-label="Your rivens">
          <Subtitle2 as="h3" className={styles.heading}>Your {mine.length} {mine.length === 1 ? 'riven' : 'rivens'}</Subtitle2>
          <Caption1 className={styles.muted}>{mine.map(r => `${rivenShortName(r)} (${rivenSummary(r)})`).join(' · ') || 'None yet.'}</Caption1>
        </section>
      ) : null}
      {has('protected') ? (
        <Toggles label="Protect mods" hint="Protected mods are never replaced by the riven or a tweak." items={slotItems(filled)} selected={protect} onChange={setProtect} testid="riven-tool-protect" />
      ) : null}
      {has('excludeSlots') ? (
        <Toggles label="Never replace" hint="The riven is tried in every other slot without a riven, filled or empty." items={slotItems(GENERAL_SLOTS.filter(i => !isRiven(build.mods[i])))} selected={skipSlots} onChange={setSkipSlots} testid="riven-tool-skip" />
      ) : null}
      {has('positive') && rt.tool !== 'slot' ? (
        <Toggles
          label="Exclude positive stats"
          hint="These stats are never rolled as positives."
          items={statItems}
          selected={excluded}
          onChange={(next, v, on) => { setExcluded(next); if (on && forced.has(v)) { const f = new Set(forced); f.delete(v); setForced(f); } }}
          testid="riven-tool-exclude"
        />
      ) : null}
      {has('forced') ? (
        <Toggles
          label="Force positive stats (optional)"
          hint={`Pick up to ${ROLL_FORCED_LIMIT} stats every roll has.`}
          items={statItems}
          selected={forced}
          max={ROLL_FORCED_LIMIT}
          onChange={(next, v, on) => { setForced(next); if (on && excluded.has(v)) { const e = new Set(excluded); e.delete(v); setExcluded(e); } }}
          testid="riven-tool-force"
        />
      ) : null}
      <div className={styles.fields}>
        {has('negative') ? (
          <Field label={mode.requiresNegative ? 'Negative stat' : 'Negative stat (optional)'} required={mode.requiresNegative} hint={mode.requiresNegative ? 'Every roll has this negative.' : 'Without one, every negative is tried on the best roll.'}>
            <Dropdown
              value={negative ? rollStatLabel(negative) : mode.requiresNegative ? '' : 'Try every negative'}
              placeholder="Pick a negative stat"
              selectedOptions={[negative ?? '']}
              onOptionSelect={(_e, d) => setNegative(d.optionValue || null)}
              listbox={{ style: { maxHeight: 'min(320px, 45vh)' } }}
              data-testid="riven-tool-negative"
            >
              {mode.requiresNegative ? null : <Option value="" text="Try every negative">Try every negative</Option>}
              {negatives.map(s => <Option key={s} value={s} text={rollStatLabel(s)}>{rollStatLabel(s)}</Option>)}
            </Dropdown>
          </Field>
        ) : null}
        {has('samples') ? (
          <Field label="Runs per candidate" validationState={bad.samples ? 'error' : 'none'} validationMessage={bad.samples ?? undefined} hint={bad.samples ? undefined : `${ROLL_RUNS.min}-${ROLL_RUNS.max}; more is steadier and slower`}>
            <Input value={samples} inputMode="numeric" onChange={(_e, d) => setSamples(d.value)} data-testid="riven-tool-samples" />
          </Field>
        ) : null}
        {has('simulationTime') ? (
          <Field label="Simulated seconds per run" validationState={bad.simTime ? 'error' : 'none'} validationMessage={bad.simTime ?? undefined}>
            <Input value={simTime} inputMode="numeric" contentAfter={<Caption1 aria-hidden="true">s</Caption1>} onChange={(_e, d) => setSimTime(d.value)} />
          </Field>
        ) : null}
        {has('statValue') ? (
          <Field label="Roll strength" validationState={bad.strength ? 'error' : 'none'} validationMessage={bad.strength ?? undefined} hint={bad.strength ? undefined : 'Percent of a stat\'s middle roll: 90-110 (110 is a top roll)'}>
            <Input value={strength} inputMode="numeric" contentAfter={<Caption1 aria-hidden="true">%</Caption1>} onChange={(_e, d) => setStrength(d.value)} />
          </Field>
        ) : null}
      </div>
      {has('optimization') || has('preserveElemental') || has('minorTweaks') ? (
        <section className={styles.section} aria-label="Scoring">
          <Subtitle2 as="h3" className={styles.heading}>Scoring</Subtitle2>
          <div className={styles.switches}>
            {has('optimization') ? (
              <>
                <Switch label="Raw damage per shot" checked={opt.buildForRawDamage} onChange={(_e, d) => setOpt(o => ({ ...o, buildForRawDamage: d.checked, buildForStatusDamage: d.checked ? false : o.buildForStatusDamage }))} />
                <Switch label="Status damage per shot" checked={opt.buildForStatusDamage} onChange={(_e, d) => setOpt(o => ({ ...o, buildForStatusDamage: d.checked, buildForRawDamage: d.checked ? false : o.buildForRawDamage }))} />
                <Switch label="Build for floor (100% tiers)" checked={opt.buildForFloor} onChange={(_e, d) => setOpt(o => ({ ...o, buildForFloor: d.checked }))} />
                <Switch label="Single shot" checked={opt.buildForSingleHit} onChange={(_e, d) => setOpt(o => ({ ...o, buildForSingleHit: d.checked }))} />
              </>
            ) : null}
            {has('preserveElemental') ? <Switch label="Keep the build's elements" checked={keepElements} onChange={(_e, d) => setKeepElements(d.checked)} data-testid="riven-tool-keep-elements" /> : null}
            {has('minorTweaks') ? <Switch label="Allow minor build tweaks (up to 3 swaps)" checked={tweaks} onChange={(_e, d) => setTweaks(d.checked)} /> : null}
          </div>
          <Caption1 className={styles.muted}>Mods a tweak may use follow the active Auto build config ("{AS.activeConfig(lib).name}"): its lists and Cost Control.</Caption1>
        </section>
      ) : null}
      {rt.tool === 'compare' ? <CompareSetup rt={rt} /> : null}
    </>
  );
}

function CompareSetup({ rt }) {
  const styles = useStyles();
  const equipped = useApp(s => s.build.mods.some(isRiven));
  const rivens = rt.compare?.rivens ?? [];
  return (
    <>
      <Caption1 as="p" className={styles.muted}>
        {equipped ? 'Each riven is tried in place of the build\'s riven.' : 'Each riven is tried in every general slot.'} Check the stats first: the card doesn't show its disposition (read as 1.2) or rank (read as 8).
      </Caption1>
      <div className={styles.sides} data-testid="riven-compare-rivens">
        {rivens.map((r, i) => (
          <RivenText
            key={r.id || i}
            riven={r}
            title={`${i ? 'Right' : 'Left'}: ${rivenShortName(r)}`}
            note={rt.compare?.notes?.[i] || null}
            action={<Button size="small" icon={<EditRegular />} onClick={() => actions.editCompareRiven(i)} data-testid={`riven-compare-edit-${i}`} style={{ alignSelf: 'flex-start' }}>Edit…</Button>}
          />
        ))}
      </div>
    </>
  );
}

function Progress({ rt }) {
  const styles = useStyles();
  return (
    <section className={styles.progress} aria-label="Progress" data-testid="riven-tool-progress">
      <Field label={rt.step || 'Working'} validationMessage={`${fmtInt(rt.runs)} simulations · ${fmtTime(rt.elapsedMs)}`} validationState="none">
        <ProgressBar value={Math.min(1, (rt.percent ?? 0) / 100)} max={1} thickness="large" />
      </Field>
      <Caption1 className={styles.muted}>{rt.detail || ' '}</Caption1>
    </section>
  );
}

/** Before → after at the build's own simulation settings (what the Readout will show). */
function DpsLine({ r, keyName, label = 'Average DPS' }) {
  const styles = useStyles();
  const before = r.readout?.before;
  const after = r.readout?.proposals?.[keyName];
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return (
    <div className={styles.dps}>
      <Caption1 className={styles.muted}>{label}</Caption1>
      <span className={styles.dpsValue}>{fmtInt(before)} → {fmtInt(after)}</span>
      <DeltaText delta={before > 0 ? (after - before) / before : null} title="Against the current build" zeroText="no change" />
    </div>
  );
}

/** The compare's proposal key for a side: its best, or its best that keeps the elements. */
const compareKey = (i, s, allowElements) => `${i}-${allowElements || !s.best?.changesElements ? 'best' : 'same'}`;
const comparePick = (s, allowElements) => (allowElements ? s.best : s.bestSameElements);

/** The result's buttons: [{ key, label, primary, icon }] (a proposal key to apply, or 'csv'). */
function resultButtons(rt, allowElements) {
  const r = rt.result;
  if (r.tool === 'slot') {
    if (!r.best) return [];
    const showSame = r.best.changesElements && r.bestSameElements;
    return [{ key: 'best', label: showSame ? 'Apply best' : 'Apply', primary: true }, ...(showSame ? [{ key: 'same', label: 'Apply, keep elements' }] : [])];
  }
  if (r.tool === 'auto') return r.improved ? [{ key: 'auto', label: 'Apply', primary: true }] : [];
  if (r.tool === 'rolls') return [{ key: 'csv', label: 'Save CSV…', primary: true, icon: <DocumentArrowDownRegular /> }];
  const dps = r.sides.map((s, i) => (comparePick(s, allowElements) ? r.readout?.proposals?.[compareKey(i, s, allowElements)] : NaN));
  const top = Math.max(...dps.filter(Number.isFinite));
  return r.sides.map((s, i) => (dps[i] > r.readout.before ? { key: compareKey(i, s, allowElements), label: `Equip ${i ? 'right' : 'left'}`, primary: dps[i] >= top } : null)).filter(Boolean);
}

const elementsText = (r, e) => (e?.changesElements ? `Changes the elements from ${elementListText(r.originalElements)} to ${elementListText(e.elements)}.` : null);

function Result({ rt, allowElements, setAllowElements }) {
  const styles = useStyles();
  const build = useApp(s => s.build);
  const r = rt.result;
  const where = (slot, mods = build.mods) => `${slotLabel(slot)}${mods[slot] && !isRiven(mods[slot]) ? `, replacing ${mods[slot].name}` : ', an empty slot'}`;
  const settingsNote = <Caption1 as="p" className={styles.muted}>Average DPS is this build's own {build.simTime} s simulation, 8 runs, as the Readout shows it. The search ran {fmtInt(r.runs)} simulations in {fmtTime(r.elapsedMs ?? r.ms)}.</Caption1>;
  let body = null;
  if (r.tool === 'slot') {
    if (!r.best) body = <Body1 as="p" data-testid="riven-tool-none">Your riven is not optimal to slot in this build: no placement beats it.</Body1>;
    else {
      const showSame = r.best.changesElements && r.bestSameElements;
      body = (
        <>
          <RivenText riven={r.best.riven} note={`Best in ${where(r.best.slot)}.`} />
          <DpsLine r={r} keyName="best" />
          {r.best.changesElements ? <Caption1 as="p" className={styles.line}><InfoRegular aria-hidden="true" /> {elementsText(r, r.best)}</Caption1> : null}
          {showSame ? (
            <>
              <Subtitle2 as="h3" className={styles.heading}>Keeping the elements</Subtitle2>
              <RivenText riven={r.bestSameElements.riven} note={`In ${where(r.bestSameElements.slot)}.`} />
              <DpsLine r={r} keyName="same" />
            </>
          ) : null}
          {settingsNote}
        </>
      );
    }
  } else if (r.tool === 'auto') {
    if (!r.improved) body = <Body1 as="p" data-testid="riven-tool-none">{r.message}</Body1>;
    else {
      body = (
        <>
          <RivenText riven={r.riven} title={`Proposed riven: ${rivenShortName(r.riven)}`} note={`In ${where(r.slot)}. Rolled at ${Math.round((r.options?.statValue ?? 11000) / 100)}% of each stat's middle roll, disposition 1.2, rank 8.`} />
          <DpsLine r={r} keyName="auto" />
          {r.tweaks?.length ? <Caption1 as="p" className={styles.line}><InfoRegular aria-hidden="true" /> Minor tweaks: {tweakListText(r.tweaks).replace(/ \| /g, ', ')}.</Caption1> : null}
          {settingsNote}
        </>
      );
    }
  } else if (r.tool === 'rolls') {
    const top = r.rows.slice(0, 10);
    body = (
      <>
        <Body1 as="p">{fmtInt(r.rows.length)} rolls scored against the build ({fmtInt(r.baseline)} in the search's runs). The best 10:</Body1>
        <Table size="small" className={styles.table} aria-label="Best rolls" data-testid="riven-rolls-table">
          <TableHeader><TableRow><TableHeaderCell>Positives</TableHeaderCell><TableHeaderCell>Replaces</TableHeaderCell><TableHeaderCell>Gain</TableHeaderCell></TableRow></TableHeader>
          <TableBody>
            {top.map(row => (
              <TableRow key={`${row.slot}:${row.positives.join('|')}`}>
                <TableCell>{row.positives.map(rollStatLabel).join(' + ')}</TableCell>
                <TableCell>{row.replaced ?? `${slotLabel(row.slot)} (empty)`}</TableCell>
                <TableCell>{Number.isFinite(row.finalGain) ? `${row.finalGain >= 0 ? '+' : ''}${row.finalGain.toFixed(2)}%` : '—'}{row.tweaks?.length ? ` (${row.tweaks.length} ${row.tweaks.length === 1 ? 'tweak' : 'tweaks'})` : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Caption1 as="p" className={styles.muted}>The CSV has every roll, with the site's columns. The search ran {fmtInt(r.runs)} simulations.</Caption1>
      </>
    );
  } else if (r.tool === 'compare') {
    const pick = s => comparePick(s, allowElements);
    const key = (i, s) => compareKey(i, s, allowElements);
    const changes = r.sides.some(s => s.best?.changesElements);
    const dps = (i, s) => r.readout?.proposals?.[key(i, s)];
    const vals = r.sides.map((s, i) => (pick(s) ? dps(i, s) : NaN));
    const summary = !vals.some(Number.isFinite) ? 'No viable slots were found for either riven.'
      : vals.every(v => !(v > r.readout.before)) ? 'Neither riven improves DPS over the build.'
        : Math.abs((vals[0] || 0) - (vals[1] || 0)) < 0.5 ? 'Both rivens perform equally well.'
          : (vals[0] || 0) > (vals[1] || 0) ? `The left riven is better by ${fmtInt(vals[0] - (vals[1] || 0))} DPS.` : `The right riven is better by ${fmtInt(vals[1] - (vals[0] || 0))} DPS.`;
    body = (
      <>
        <Body1Strong as="p" data-testid="riven-compare-summary">{summary}</Body1Strong>
        {changes ? <Switch label="Allow element changes" checked={allowElements} onChange={(_e, d) => setAllowElements(d.checked)} /> : null}
        <div className={styles.sides}>
          {r.sides.map((s, i) => {
            const e = pick(s);
            return (
              <div key={i} className={styles.section}>
                <RivenText riven={(e ?? s.best)?.riven ?? rt.compare.rivens[i]} title={`${i ? 'Right' : 'Left'}: ${rivenShortName(rt.compare.rivens[i])}`} note={e ? `Best in ${where(e.slot)}.` : 'No placement keeps the elements.'} />
                {e ? <DpsLine r={r} keyName={key(i, s)} /> : null}
                {e?.changesElements ? <Caption1 className={styles.line}><InfoRegular aria-hidden="true" /> {elementsText(r, e)}</Caption1> : null}
              </div>
            );
          })}
        </div>
        {settingsNote}
      </>
    );
  }
  return <section className={styles.section} aria-label="Result" data-testid="riven-tool-result">{body}</section>;
}

export function RivenToolsDialog() {
  const styles = useStyles();
  const rt = useApp(s => s.rivenTool);
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const rivenLibrary = useApp(s => s.rivenLibrary);
  const [options, setOptions] = useState(null);
  const [allowElements, setAllowElements] = useState(true);
  const startRef = useRef(null);
  const cancelRef = useRef(null);
  const firstRef = useRef(null);
  const status = rt?.status;
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (!rt || prev === status) return;
    if (status === 'running') focusSoon(() => cancelRef.current);
    else if (status === 'done') focusSoon(() => firstRef.current ?? document.querySelector('[data-testid="riven-tool-close"]'));
    else if (prev === 'running' || prev === 'done') focusSoon(() => startRef.current);
  }, [rt, status]);
  if (!rt || !ctx || !build) return null;
  const mode = RIVEN_TOOL_MODES[rt.tool];
  const block = rivenToolBlock({ ctx, build, rivenLibrary }, rt.tool);
  const running = status === 'running';
  const done = status === 'done' && rt.result;
  const run = () => { if (options && !block) actions.startRivenTool(options); };
  const title = mode.title.replace(/ setup$/, '');
  const act = b => (b.key === 'csv' ? actions.saveRollsCsv() : actions.applyRivenTool(b.key));
  return (
    <Dialog open onOpenChange={(_e, d) => { if (!d.open) actions.closeRivenTool(); }}>
      <DialogSurface className={styles.surface} aria-describedby="riven-tool-about" data-testid="riven-tool-dialog" data-tool={rt.tool}>
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.closeRivenTool()} />}>
            {status === 'setup' || status === 'error' || status === 'cancelled' ? mode.title : title}
          </DialogTitle>
          <span id="riven-tool-about" className={styles.srOnly}>{ABOUT[rt.tool]}</span>
          <DialogContent className={styles.content}>
            {block ? <MessageBar intent="info" layout="multiline" data-testid="riven-tool-block"><MessageBarBody>{block}</MessageBarBody></MessageBar> : null}
            {status === 'error' ? <MessageBar intent="error" layout="multiline" data-testid="riven-tool-error"><MessageBarBody>{title} failed: {rt.error}</MessageBarBody></MessageBar> : null}
            {status === 'cancelled' ? <Body1 as="p" className={styles.muted}>Cancelled. Nothing changed.</Body1> : null}
            {running ? <Progress rt={rt} /> : done ? <Result rt={rt} allowElements={allowElements} setAllowElements={setAllowElements} /> : <Setup key={rt.tool} rt={rt} onOptions={setOptions} />}
          </DialogContent>
          <DialogActions>
            {running ? (
              <Button ref={cancelRef} onClick={() => actions.cancelRivenTool()} disabled={/Cancelling/.test(rt.step)} data-testid="riven-tool-cancel">{/Cancelling/.test(rt.step) ? 'Stopping…' : 'Cancel'}</Button>
            ) : done ? (
              <>
                <Button onClick={() => actions.rivenToolSetup()} data-testid="riven-tool-back">Back</Button>
                <Button onClick={() => actions.closeRivenTool()} data-testid="riven-tool-close">Close</Button>
                {resultButtons(rt, allowElements).map((b, i) => (
                  <Button key={b.key} ref={i === 0 ? firstRef : undefined} className={styles.nowrap} appearance={b.primary ? 'primary' : 'secondary'} icon={b.icon} onClick={() => act(b)} data-testid={`riven-tool-apply-${b.key}`}>{b.label}</Button>
                ))}
              </>
            ) : (
              <>
                <Button onClick={() => actions.closeRivenTool()} data-testid="riven-tool-close">Close</Button>
                <Tooltip content={block ?? (options ? `Run ${title}` : mode.requiresNegative ? 'Pick a negative stat, and fix the numbers marked' : 'Fix the numbers marked')} relationship="description">
                  <Button ref={startRef} appearance="primary" icon={<SparkleRegular />} disabledFocusable={!options || Boolean(block)} onClick={run} data-testid="riven-tool-start">
                    {status === 'setup' && !rt.result ? mode.start : 'Run again'}
                  </Button>
                </Tooltip>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** The "Riven" menu on the Loadout's capacity line, shown for weapons that take rivens. */
export function RivenToolsButton() {
  const ctx = useApp(s => s.ctx);
  const weaponName = useApp(s => s.build?.weaponName);
  const count = useApp(s => s.rivenLibrary.rivens.length);
  const ready = useApp(s => Boolean(s.autoBuildLibrary));
  const weapon = ctx?.weaponByName.get(weaponName);
  if (!canTakeRiven(weapon)) return null;
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Riven tools: slot your riven, find the best roll, compare two rivens" relationship="description">
          <Button appearance="subtle" size="small" icon={<SparkleRegular />} disabled={!ready} data-testid="riven-tools-open" data-focus-id="riven-tools-open" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            Riven
          </Button>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Find the best riven</MenuGroupHeader>
            <MenuItem onClick={() => actions.openRivenTool('slot')} data-testid="riven-tools-slot">Slot my riven…</MenuItem>
            <MenuItem onClick={() => actions.openRivenTool('auto')} data-testid="riven-tools-auto">Auto riven…</MenuItem>
            <MenuItem onClick={() => actions.openRivenTool('rolls')} data-testid="riven-tools-rolls">Rolls data (CSV)…</MenuItem>
          </MenuGroup>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>From a screenshot</MenuGroupHeader>
            <MenuItem icon={<ImageRegular />} onClick={() => actions.readRivenScreenshot({ source: 'file' })} data-testid="riven-tools-shot-file">Read a riven: image file…</MenuItem>
            <MenuItem icon={<ClipboardPasteRegular />} onClick={() => actions.readRivenScreenshot({ source: 'clipboard' })}>Read a riven: clipboard</MenuItem>
            <MenuItem icon={<ImageRegular />} onClick={() => actions.readRivenScreenshot({ source: 'file', two: true })}>Compare two rivens: image file…</MenuItem>
            <MenuItem icon={<ClipboardPasteRegular />} onClick={() => actions.readRivenScreenshot({ source: 'clipboard', two: true })}>Compare two rivens: clipboard</MenuItem>
          </MenuGroup>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>Your rivens ({count})</MenuGroupHeader>
            <MenuItem icon={<ArrowUploadRegular />} onClick={() => actions.importRivenLibrary()} data-testid="riven-tools-import">Import rivens…</MenuItem>
            <MenuItem icon={<ArrowDownloadRegular />} disabled={!count} onClick={() => actions.exportRivenLibrary()} data-testid="riven-tools-export">Export your rivens…</MenuItem>
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
