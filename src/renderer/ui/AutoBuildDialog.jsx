// Auto build (docs/port-auto-build.md; docs/declutter-spec.md 4): underframe.site's build optimizer with its configs,
// mod blacklist, whitelist, elemental and stat blacklists. One quiet entry in the Loadout's capacity line (and
// Ctrl+Shift+A) opens this dialog: the run (with what to keep), its progress and Cancel, then the proposed build against
// the current one with Apply (one undo step, Forma included) or Discard. The settings tabs edit the active config;
// Default is read-only. With a result, only the result is shown (no settings under a pending result).
//
// Focus never falls to the page: Run moves it to Cancel, a result to Apply (or Close), a cancel or an error back to
// Run; adding from the blacklist search keeps it in the search box, removing a chip moves it to the next chip.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Body1, Body1Strong, Button, Caption1, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Dropdown, Field, Input, Link, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody,
  MessageBarTitle, Option, Popover, PopoverSurface, ProgressBar, Radio, RadioGroup, Subtitle2, Switch, Tab, TabList,
  ToggleButton, Tooltip, makeStyles, mergeClasses, tokens, useArrowNavigationGroup,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowDownRegular, ArrowResetRegular, ArrowRightRegular, ArrowUpRegular, CheckmarkRegular, CopyRegular, DeleteRegular,
  DismissRegular, EditRegular, ErrorCircleRegular, InfoRegular, LockClosedRegular, MoreHorizontalRegular, SearchRegular, WandRegular,
} from '@fluentui/react-icons';
import { actions, announce, store } from '../controller.js';
import { useApp } from '../hooks.js';
import { fmtInt } from '../format.js';
import { gainText } from '../auto-build-format.js';
import { EXILUS_SLOT, GENERAL_SLOTS, buildCapacity, formaPlanText, slotLabel, targetLabel, withFormaPlan } from '../model.js';
import * as AS from '../../shared/auto-build-settings.js';
import { arcaneSummary, arcaneSupport, indexArcanes, isArcaneCompatible } from '../../shared/arcanes.js';
import { nothingToFill } from '../../shared/auto-build.js';
import { isModCompatible, maxRank } from '../../shared/mods.js';
import { modeLabel } from '../../shared/fire-modes.js';
import { arcaneEntry, buildModIndex, parseQuery, searchEntries, sortResults } from '../../shared/mod-search.js';
import { defaultPoolSize } from '../auto-build-pool.js';
import { ArtImage, PolarityGlyph, RARITY_TOKEN, useCards, useTextCards } from './art.jsx';
import { DeltaText, unmodeledStats } from './common.jsx';

/** The card art is drawn for a dark backdrop (translucent edges): the same dark tone in both themes, as the slots use. */
const ART_BACKDROP = '#1c1c1c';
/** A list shows this many rows of chips until "Show all" (the dialog content is the only scroller). */
const LIST_ROWS = 3;
const CHIP_MIN = 220;

const useStyles = makeStyles({
  surface: { width: 'min(760px, 94vw)', maxWidth: 'min(760px, 94vw)' },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, maxHeight: 'min(70vh, 760px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: tokens.spacingHorizontalXS },
  muted: { color: tokens.colorNeutralForeground2, margin: 0 },
  faint: { color: tokens.colorNeutralForeground3 },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  heading: { margin: 0 },
  headingRow: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: tokens.spacingHorizontalS, minWidth: 0 },
  configRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0 },
  configDropdown: { minWidth: '220px' },
  line: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground2, margin: 0, '& > svg': { flexShrink: 0, marginTop: '2px' } },
  fields: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    alignItems: 'start', '& > *': { minWidth: 0 }, '& .fui-Input': { width: '100%', minWidth: 0, boxSizing: 'border-box' },
    '& .fui-Dropdown': { minWidth: 0, width: '100%' },
  },
  switches: { display: 'flex', flexDirection: 'column', gap: 0 },
  summary: { margin: 0, paddingLeft: tokens.spacingHorizontalL, display: 'flex', flexDirection: 'column', gap: '2px', color: tokens.colorNeutralForeground1 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  // A card chip: the compact card art (or a text card), the name as real text, an action.
  chip: {
    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', columnGap: tokens.spacingHorizontalS,
    minHeight: '40px', padding: `2px ${tokens.spacingHorizontalXS} 2px 2px`, borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3, minWidth: 0,
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  // Text cards (the user's choice, forced colours): no thumb column, the remove button stays at the right edge.
  chipNoThumb: { gridTemplateColumns: 'minmax(0, 1fr) auto', paddingLeft: tokens.spacingHorizontalS },
  thumb: { position: 'relative', width: '64px', height: '32px', borderRadius: tokens.borderRadiusSmall, overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground4, flexShrink: 0 },
  thumbLarge: { width: '96px', height: '48px' },
  // The text card for an item without art: its polarity on a neutral tone, its rarity as a band along the bottom.
  textThumb: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForeground2 },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '3px' },
  chipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  listGrid: { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${CHIP_MIN}px, 1fr))`, gap: tokens.spacingHorizontalS, padding: '2px' },
  resultsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: tokens.spacingHorizontalS, padding: '2px' },
  addCard: {
    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', columnGap: tokens.spacingHorizontalS,
    minHeight: '40px', padding: `2px ${tokens.spacingHorizontalS} 2px 2px`, justifyContent: 'stretch', textAlign: 'left', fontWeight: tokens.fontWeightRegular,
  },
  addCardNoThumb: { gridTemplateColumns: 'minmax(0, 1fr) auto', paddingLeft: tokens.spacingHorizontalS },
  addName: { display: 'flex', flexDirection: 'column', minWidth: 0, '& > *': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
  keep: { justifyContent: 'flex-start', minHeight: '44px', padding: `2px ${tokens.spacingHorizontalS} 2px 2px`, gap: tokens.spacingHorizontalS, fontWeight: tokens.fontWeightRegular, maxWidth: '280px' },
  // Not kept: a dashed outline and the word "Replace" (not a dimmed tint), so the state reads without colour.
  keepOff: { borderStyle: 'dashed', borderColor: tokens.colorNeutralStroke1 },
  keepName: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, '& > *': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' } },
  dps: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, fontVariantNumeric: 'tabular-nums' },
  gain: { color: tokens.colorStatusSuccessForeground1, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  dpsValue: { fontSize: tokens.fontSizeBase600, lineHeight: tokens.lineHeightBase600, fontWeight: tokens.fontWeightSemibold },
  changes: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: tokens.spacingVerticalS },
  // Old card → new card, then the text.
  change: { display: 'grid', gridTemplateColumns: 'auto auto auto minmax(0, 1fr)', alignItems: 'center', columnGap: tokens.spacingHorizontalS, minWidth: 0 },
  changeText: { display: 'flex', flexDirection: 'column', minWidth: 0, '& > *': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
  arrow: { color: tokens.colorNeutralForeground3 },
  // An empty slot before (or after) a change: an outline like the Loadout's empty slots, not a dark card.
  emptyThumb: { backgroundColor: 'transparent', border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`, boxSizing: 'border-box' },
  statToggles: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  error: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground1, margin: 0 },
  popover: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, width: 'min(320px, 86vw)' },
  popoverActions: { display: 'flex', justifyContent: 'flex-end', gap: tokens.spacingHorizontalS },
  progress: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, padding: `${tokens.spacingVerticalS} 0` },
  // Links that stand alone (not inside a sentence) keep the 24 px target height.
  linkTarget: { minHeight: '24px', display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start' },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: 0 },
});

const METRIC_LABEL = { avgDps: 'average DPS', avgRawPerShot: 'raw damage per shot', avgDotPerShot: 'status damage per shot' };
const fmtTime = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const fmtLimit = s => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const ABOUT = 'Auto build looks for the mods and arcane that score best for this build, then shows the result to apply as one undo step.';

/** Focus an element by id or selector once React has rendered (two frames: after Fluent's own focus handling). */
const focusSoon = (find, then) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const el = typeof find === 'function' ? find() : document.querySelector(find);
  if (el) { el.focus(); then?.(el); }
}));

/**
 * A number field: free typing, committed (clamped) on Enter or when focus leaves. A plain Input rather than a
 * SpinButton, whose 24x16 arrows were under the app's 24 px target size.
 */
function NumberField({ label, hint, value, min, max, disabled, onCommit, testId, integer = false }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const v = Number(String(text).trim().replace(',', '.'));
    if (!String(text).trim() || !Number.isFinite(v)) { setText(String(value)); return; }
    const next = Math.min(max, Math.max(min, integer ? Math.round(v) : v));
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <Field label={label} hint={hint}>
      <Input
        value={text}
        inputMode="decimal"
        disabled={disabled}
        onChange={(_e, d) => setText(d.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        data-testid={testId}
      />
    </Field>
  );
}

/** The compact card art for a mod (2:1) or an arcane's picture; a small text card when it has none; nothing with text cards. */
function Thumb({ name, kind = 'mod', large = false }) {
  const styles = useStyles();
  const cards = useCards();
  const ctx = useApp(s => s.ctx);
  const text = useTextCards();
  const [failed, setFailed] = useState(false);
  if (text) return null;
  const url = kind === 'arcane' ? cards?.arcaneUrl(name) : cards?.modCompactUrl(name);
  if (url && !failed) {
    return (
      <span className={mergeClasses(styles.thumb, large && styles.thumbLarge)} aria-hidden="true">
        <ArtImage src={url} fit={kind === 'arcane' ? 'contain' : 'cover'} lazy backdrop={ART_BACKDROP} onFail={() => setFailed(true)} />
      </span>
    );
  }
  // No art for it (melee, Warframe and aura mods have none here): its polarity and a rarity band.
  const mod = kind === 'mod' ? ctx.index.byName.get(name) : null;
  const band = RARITY_TOKEN[String(mod?.Rarity ?? '').toLowerCase()] ?? tokens.colorNeutralStroke1;
  return (
    <span className={mergeClasses(styles.thumb, styles.textThumb, large && styles.thumbLarge)} aria-hidden="true" data-text-thumb="">
      {mod?.Polarity ? <PolarityGlyph code={mod.Polarity} size={large ? 20 : 16} /> : null}
      <span className={styles.band} style={{ backgroundColor: band }} />
    </span>
  );
}

// ---------- configs ----------

function ConfigRow({ disabled }) {
  const styles = useStyles();
  const lib = useApp(s => s.autoBuildLibrary);
  const active = AS.activeConfig(lib);
  const [nameMode, setNameMode] = useState(null); // 'new' | 'rename'
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const index = lib.configs.findIndex(c => c.id === active.id);

  const result = r => {
    if (r?.error) { setMessage(r.error); return false; }
    setMessage(null);
    return true;
  };
  const submitName = () => {
    const r = nameMode === 'new' ? actions.addAutoBuildConfig(name) : actions.renameAutoBuildConfig(active.id, name);
    if (result(r)) {
      setNameMode(null);
      announce(nameMode === 'new' ? `Created the config "${name.trim()}".` : `Renamed the config to "${name.trim()}".`);
    }
  };
  return (
    <section className={styles.section} aria-label="Config">
      <div className={styles.configRow}>
        <Field label="Config" orientation="horizontal">
          <Dropdown
            className={styles.configDropdown}
            value={active.locked ? `${active.name} (read-only)` : active.name}
            selectedOptions={[active.id]}
            disabled={disabled}
            onOptionSelect={(_e, d) => { result(actions.selectAutoBuildConfig(d.optionValue)); }}
            data-testid="auto-build-config"
          >
            {lib.configs.map(c => <Option key={c.id} value={c.id} text={c.name}>{c.locked ? `${c.name} (read-only)` : c.name}</Option>)}
          </Dropdown>
        </Field>
        <Popover open={Boolean(nameMode)} trapFocus withArrow positioning="below-start" onOpenChange={(_e, d) => { if (!d.open) setNameMode(null); }}>
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" icon={<MoreHorizontalRegular />} disabled={disabled} data-testid="auto-build-manage">Manage</Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<AddRegular />} onClick={() => { setName(''); setMessage(null); setNameMode('new'); }}>New config…</MenuItem>
                <MenuItem icon={<CopyRegular />} onClick={() => { if (result(actions.duplicateAutoBuildConfig(active.id))) announce(`Duplicated "${active.name}".`); }} data-testid="auto-build-duplicate">Duplicate</MenuItem>
                <MenuItem icon={<EditRegular />} disabled={active.locked} onClick={() => { setName(active.name); setMessage(null); setNameMode('rename'); }}>Rename…</MenuItem>
                <MenuItem icon={<ArrowUpRegular />} disabled={active.locked || index <= 1} onClick={() => actions.moveAutoBuildConfig(active.id, -1)}>Move up</MenuItem>
                <MenuItem icon={<ArrowDownRegular />} disabled={active.locked || index >= lib.configs.length - 1} onClick={() => actions.moveAutoBuildConfig(active.id, 1)}>Move down</MenuItem>
                <MenuDivider />
                <MenuItem icon={<DeleteRegular />} disabled={active.locked} onClick={() => setConfirmDelete(true)}>Delete…</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <PopoverSurface aria-label={nameMode === 'new' ? 'New config' : 'Rename config'}>
            <form className={styles.popover} onSubmit={e => { e.preventDefault(); submitName(); }}>
              <Field label={nameMode === 'new' ? 'New config name' : 'Config name'} hint={nameMode === 'new' ? 'It starts with the current settings.' : undefined}>
                <Input value={name} maxLength={60} onChange={(_e, d) => { setName(d.value); setMessage(null); }} autoFocus data-testid="auto-build-config-name" />
              </Field>
              <div className={styles.popoverActions}>
                <Button onClick={() => setNameMode(null)}>Cancel</Button>
                <Button appearance="primary" type="submit">{nameMode === 'new' ? 'Create' : 'Rename'}</Button>
              </div>
            </form>
          </PopoverSurface>
        </Popover>
      </div>
      {active.locked ? (
        <div className={styles.configRow}>
          <Caption1 className={styles.line} data-testid="auto-build-locked"><LockClosedRegular aria-hidden="true" /> Viewing "Default" (read-only). Duplicate it to make changes.</Caption1>
          <Button size="small" icon={<CopyRegular />} disabled={disabled} onClick={() => result(actions.duplicateAutoBuildConfig(active.id))}>Duplicate</Button>
        </div>
      ) : (
        <Caption1 className={styles.line}>Editing "{active.name}". Changes are saved as you make them.</Caption1>
      )}
      {message ? <Caption1 role="alert" className={styles.error}><ErrorCircleRegular aria-hidden="true" /> {message}</Caption1> : null}
      <Dialog modalType="alert" open={confirmDelete} onOpenChange={(_e, d) => { if (!d.open) setConfirmDelete(false); }}>
        <DialogSurface aria-describedby="delete-config-body">
          <DialogBody>
            <DialogTitle>Delete config</DialogTitle>
            <DialogContent id="delete-config-body">Delete the auto build config "{active.name}"? Another config becomes the selected one.</DialogContent>
            <DialogActions>
              <Button autoFocus onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  const id = active.id;
                  const other = lib.configs.find(c => c.id !== id && !c.locked) ?? lib.configs[0];
                  actions.selectAutoBuildConfig(other.id);
                  result(actions.deleteAutoBuildConfig(id));
                  setConfirmDelete(false);
                }}
              >
                Delete
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}

// ---------- the run ----------

function settingsSummary(s, simTime) {
  const runs10 = AS.runsFor(10, s.sampleSizeMultiplier);
  const lines = [
    `Scores ${METRIC_LABEL[AS.metricOf(s)]} over ${s.simulationTimeSeconds} s simulations, ${runs10} ${runs10 === 1 ? 'run' : 'runs'} per candidate${s.finalRefinementEnabled ? `, then a refinement at ${s.finalRefinementSampleSize} runs` : ''}${s.luckAveragedEnabled ? ', luck averaged' : ''}.`,
  ];
  const mods = [
    s.modBlacklistEnabled ? `blacklist of ${s.modBlacklist.length}` : 'no blacklist',
    s.modWhitelistEnabled ? `whitelist of ${s.modWhitelist.length}` : null,
    s.statBlacklistEnabled && s.statBlacklist.length ? `no ${s.statBlacklist.map(k => AS.STAT_FAMILIES.find(f => f.key === k)?.label.toLowerCase()).join(', ')} mods` : null,
  ].filter(Boolean);
  lines.push(`Mods: ${mods.join(', ')}.`);
  const el = !s.elementalCandidatesEnabled ? 'no element combinations'
    : s.specificElementalCandidatesEnabled && s.specificElementalTargets.length ? `only ${s.specificElementalTargets.join(', ')}` : 'the weapon\'s usual combinations';
  lines.push(`Elements: ${el}${s.elementalBlacklistEnabled && s.elementalBlacklist.length ? `; never ${s.elementalBlacklist.join(', ')}` : ''}.`);
  const extra = [
    s.costControlEnabled ? `fits capacity with at most ${s.maxForma} Forma in all (half-rank mods too); Apply sets the Forma it needs` : 'capacity is not checked (Cost Control is off)',
    s.buildForSingleHit ? 'one shot per simulation' : null,
    s.buildForFloor ? 'crit, status and multishot floored to their guaranteed tier' : null,
  ].filter(Boolean);
  lines.push(`Also: ${extra.join('; ')}.`);
  lines.push(`Stops after ${fmtLimit(s.timeLimitSeconds)} at most. The DPS shown afterwards is this build's own ${simTime} s simulation.`);
  return lines;
}

function KeepPicker({ keep, setKeep, keepArcane, setKeepArcane }) {
  const styles = useStyles();
  const build = useApp(s => s.build);
  const filled = GENERAL_SLOTS.filter(i => build.mods[i]);
  const arcane = build.arcanes?.[0];
  const exilus = build.mods[EXILUS_SLOT];
  if (!filled.length && !arcane) {
    return <Body1 as="p" className={styles.muted}>The build is empty: Auto build fills all 8 slots and picks an arcane.</Body1>;
  }
  const kept = filled.filter(i => keep.has(i)).length + (arcane && keepArcane ? 1 : 0);
  const total = filled.length + (arcane ? 1 : 0);
  const empty = GENERAL_SLOTS.length - filled.filter(i => keep.has(i)).length;
  const keepAll = () => { setKeep(new Set(filled)); setKeepArcane(true); announce(`Keeping all ${total}.`); };
  const replaceAll = () => { setKeep(new Set()); setKeepArcane(false); announce('Auto build may replace every mod and the arcane.'); };
  return (
    <section className={styles.section} aria-labelledby="auto-build-keep-heading">
      <div className={styles.headingRow}>
        <Subtitle2 as="h3" id="auto-build-keep-heading" className={styles.heading}>Keep ({kept} of {total})</Subtitle2>
        <Button appearance="subtle" size="small" disabledFocusable={kept === total} onClick={keepAll} data-testid="auto-build-keep-all">Keep all</Button>
        <Button appearance="subtle" size="small" disabledFocusable={kept === 0} onClick={replaceAll} data-testid="auto-build-replace-all">Replace all</Button>
      </div>
      <Caption1 as="p" className={styles.muted} data-testid="auto-build-keep-text">
        {empty || (arcane && !keepArcane) || !arcane
          ? `Ticked mods stay where they are; the others are replaced. ${empty} ${empty === 1 ? 'slot' : 'slots'} will be filled${arcane && !keepArcane ? ', and the arcane chosen again' : !arcane ? ', and an arcane picked' : ''}.`
          : 'Every slot is kept, so there is nothing to fill. Untick mods to let Auto build replace them.'}
        {exilus ? ` ${exilus.name} stays in the Exilus slot, which Auto build never fills.` : ''}
      </Caption1>
      <div className={styles.chips} role="group" aria-labelledby="auto-build-keep-heading">
        {filled.map(i => {
          const on = keep.has(i);
          const name = build.mods[i].name;
          return (
            <ToggleButton
              key={i}
              className={mergeClasses(styles.keep, !on && styles.keepOff)}
              checked={on}
              icon={on ? <CheckmarkRegular /> : undefined}
              title={`${name} (${slotLabel(i).toLowerCase()})`}
              aria-label={`Keep ${name} (${slotLabel(i).toLowerCase()})`}
              onClick={() => setKeep(k => {
                const next = new Set(k);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              })}
              data-testid="auto-build-keep"
            >
              <Thumb name={name} />
              <span className={styles.keepName}>
                <span>{name}</span>
                {on ? null : <Caption1 className={styles.faint}>Replace</Caption1>}
              </span>
            </ToggleButton>
          );
        })}
        {arcane ? (
          <ToggleButton
            className={mergeClasses(styles.keep, !keepArcane && styles.keepOff)}
            checked={keepArcane}
            icon={keepArcane ? <CheckmarkRegular /> : undefined}
            title={`${arcane.name} (arcane)`}
            aria-label={`Keep ${arcane.name} (arcane)`}
            onClick={() => setKeepArcane(v => !v)}
            data-testid="auto-build-keep-arcane"
          >
            <Thumb name={arcane.name} kind="arcane" />
            <span className={styles.keepName}>
              <span>{arcane.name}</span>
              {keepArcane ? null : <Caption1 className={styles.faint}>Replace</Caption1>}
            </span>
          </ToggleButton>
        ) : null}
      </div>
    </section>
  );
}

function Progress() {
  const styles = useStyles();
  const ab = useApp(s => s.autoBuild);
  const limit = ab.timeLimit ?? 300;
  return (
    <section className={styles.progress} aria-label="Auto build progress" data-testid="auto-build-progress">
      <Field label={ab.step || 'Working'} validationMessage={`${fmtInt(ab.runs)} simulations · ${fmtTime(ab.elapsedMs)} of at most ${fmtLimit(limit)}`} validationState="none">
        <ProgressBar value={Math.min(1, (ab.percent ?? 0) / 100)} max={1} thickness="large" />
      </Field>
      <Caption1 className={styles.muted} data-testid="auto-build-detail">{ab.detail || ' '}</Caption1>
    </section>
  );
}

/** The capacity the result needs with its Forma plan applied: { cap, over }. */
function resultCapacity(ctx, build, r) {
  const planned = withFormaPlan(ctx, { ...build, mods: r.mods }, r.formaPlan);
  return buildCapacity(ctx, planned);
}

/** The proposed build against the current one: DPS (the Readout's own settings), capacity and Forma, the slots that change, honesty. */
function ResultView() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const r = useApp(s => s.autoBuild.result);
  const delta = r.before > 0 ? (r.after - r.before) / r.before : null;
  const changes = [];
  GENERAL_SLOTS.forEach(i => {
    const a = build.mods[i];
    const b = r.mods[i];
    if ((a?.name ?? null) !== (b?.name ?? null) || (a?.rank ?? null) !== (b?.rank ?? null)) changes.push({ key: `s${i}`, where: slotLabel(i), kind: 'mod', from: a, to: b });
  });
  const a0 = build.arcanes?.[0] ?? null;
  const b0 = r.arcanes?.[0] ?? null;
  if ((a0?.name ?? null) !== (b0?.name ?? null)) changes.push({ key: 'arcane', where: 'Arcane', kind: 'arcane', from: a0, to: b0 });
  const cap = resultCapacity(ctx, build, r);
  const forma = formaPlanText(r.formaPlan);
  const partial = r.mods.filter(Boolean).map(m => ({ name: m.name, stats: unmodeledStats(ctx, m.name) })).filter(x => x.stats.length);
  const arcaneNote = b0 && arcaneSupport(b0.name, ctx.data).level !== 'full' ? b0.name : null;
  const conditional = r.conditionalMods ?? [];
  const nothing = !r.runs;
  return (
    <section className={styles.section} aria-labelledby="auto-build-result-heading" data-testid="auto-build-result">
      <Subtitle2 as="h3" id="auto-build-result-heading" tabIndex={-1} className={styles.heading}>
        {nothing ? 'Nothing to fill' : r.changed ? 'Proposed build' : 'No better build found'}
      </Subtitle2>
      <div className={styles.dps}>
        <Caption1 className={styles.muted}>Average DPS</Caption1>
        <span className={styles.dpsValue} data-testid="auto-build-dps">{r.changed ? `${fmtInt(r.before)} → ${fmtInt(r.after)}` : fmtInt(r.before)}</span>
        {!r.changed ? null : delta != null && r.after / r.before >= 3
          ? <span className={styles.gain} aria-label={`up ${gainText(r.before, r.after)}`}>▲ {gainText(r.before, r.after)}</span>
          : <DeltaText delta={delta} title="Against the current build" zeroText="no change" />}
      </div>
      {nothing ? (
        <Body1 as="p" className={styles.muted} data-testid="auto-build-nothing">Every slot and the arcane were kept, so Auto build had nothing to fill. Untick mods under Keep to let it replace them.</Body1>
      ) : (
        <Caption1 as="p" className={styles.muted}>
          Both numbers are this build's own {build.simTime} s simulation, 8 runs, as the Readout shows it. The search scored {fmtInt(r.runs)} simulations of {r.settings.simulationTimeSeconds} s with {r.cores} engines in {fmtTime(r.elapsedMs)}.
        </Caption1>
      )}
      {r.changed && cap.over > 0 ? (
        <MessageBar intent="warning" layout="multiline" data-testid="auto-build-capacity">
          <MessageBarBody>
            <MessageBarTitle>{cap.over} over capacity</MessageBarTitle>
            This build needs {cap.used} of {cap.capacity} capacity{r.formaPlan?.length ? ' even with the Forma below' : ' with its slot polarities'}.{' '}
            {r.settings.costControlEnabled
              ? 'The mods you kept already need more than the capacity allows; untick some under Keep, or allow more Forma under Search.'
              : 'Cost Control is off, so capacity was not checked. Turn it on under Search to get a build that fits.'}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {r.changed && forma.length ? (
        <Caption1 as="p" className={styles.line} data-testid="auto-build-forma">
          <InfoRegular aria-hidden="true" /> {forma.length} Forma to fit {cap.used} of {cap.capacity} capacity: {forma.join(', ')}. Apply sets these polarities too.
        </Caption1>
      ) : null}
      {r.stoppedEarly ? <Caption1 as="p" className={styles.line} data-testid="auto-build-stopped"><InfoRegular aria-hidden="true" /> Stopped at the {fmtLimit(r.settings.timeLimitSeconds)} limit: this is the best build found so far.</Caption1> : null}
      {!nothing && !r.changed ? <Body1 as="p" className={styles.muted}>Auto build found nothing better than the current build.</Body1> : null}
      {r.changed ? (
        <>
          <Subtitle2 as="h4" className={styles.heading}>{changes.length} {changes.length === 1 ? 'change' : 'changes'}</Subtitle2>
          <ul className={styles.changes} data-testid="auto-build-changes">
            {changes.map(c => (
              <li key={c.key} className={styles.change} data-testid="auto-build-change" data-name={c.to?.name ?? ''}>
                {c.from ? <Thumb name={c.from.name} kind={c.kind} /> : <span className={mergeClasses(styles.thumb, styles.emptyThumb)} aria-hidden="true" />}
                <ArrowRightRegular aria-hidden="true" className={styles.arrow} />
                {c.to ? <Thumb name={c.to.name} kind={c.kind} /> : <span className={mergeClasses(styles.thumb, styles.emptyThumb)} aria-hidden="true" />}
                <span className={styles.changeText} title={`${c.where}: ${c.from?.name ?? 'empty'} → ${c.to?.name ?? 'empty'}`}>
                  <Body1Strong>{c.to ? `${c.to.name}${c.kind === 'mod' && c.to.rank !== maxRank(ctx.index.byName.get(c.to.name)) ? ` R${c.to.rank}` : ''}` : 'Empty'}</Body1Strong>
                  <Caption1 className={styles.muted}>{c.where}{c.from ? ` · replaces ${c.from.name}` : ' · was empty'}</Caption1>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {conditional.length ? (
        <Caption1 as="p" className={styles.line} data-testid="auto-build-conditional">
          <InfoRegular aria-hidden="true" /> Scored with {conditional.join(', ')}, as underframe.site does. After applying, change the stacks from the slot.
        </Caption1>
      ) : null}
      {partial.length || arcaneNote ? (
        <Caption1 as="p" className={styles.line}>
          <InfoRegular aria-hidden="true" />
          Partially simulated: {[...partial.map(p => `${p.name} (${p.stats.join(', ').toLowerCase()})`), ...(arcaneNote ? [`${arcaneNote} (${arcaneSupport(arcaneNote, ctx.data).note})`] : [])].join('; ')}.
        </Caption1>
      ) : null}
    </section>
  );
}

function RunPanel({ keep, setKeep, keepArcane, setKeepArcane }) {
  const styles = useStyles();
  const ab = useApp(s => s.autoBuild);
  const dropped = useApp(s => s.autoBuildDropped);
  const lib = useApp(s => s.autoBuildLibrary);
  const simTime = useApp(s => s.build.simTime);
  const enemy = useApp(s => s.build.enemy);
  const weaponName = useApp(s => s.build.weaponName);
  const modeName = useApp(s => s.build.modeName);
  const buffs = useApp(s => (s.build.externalBuffs?.length ?? 0) + (s.build.externalStatuses?.length ?? 0));
  const settings = AS.effectiveSettings(lib);
  if (ab?.status === 'running') return <Progress />;
  return (
    <>
      {ab?.status === 'error' ? (
        <MessageBar intent="error" layout="multiline"><MessageBarBody>Auto build failed: {ab.error}</MessageBarBody></MessageBar>
      ) : null}
      {ab?.status === 'cancelled' ? <Body1 as="p" className={styles.muted} data-testid="auto-build-cancelled">Cancelled. Nothing changed.</Body1> : null}
      {dropped && !ab ? <Caption1 as="p" className={styles.line} data-testid="auto-build-dropped"><InfoRegular aria-hidden="true" /> The build changed, so the last result was dropped. Run again.</Caption1> : null}
      <Caption1 as="p" className={styles.muted}>
        Fills {weaponName}'s empty slots with the mods and arcane that score best against {targetLabel(enemy)}, with the {modeLabel(modeName)} fire mode
        {buffs ? ', this build\'s external buffs and target statuses' : ''}. The Exilus slot is never filled.
      </Caption1>
      <ul className={styles.summary} aria-label="Settings" data-testid="auto-build-summary">
        {settingsSummary(settings, simTime).map(l => <li key={l}><Body1>{l}</Body1></li>)}
      </ul>
      <KeepPicker keep={keep} setKeep={setKeep} keepArcane={keepArcane} setKeepArcane={setKeepArcane} />
    </>
  );
}

// ---------- settings: search ----------

function SearchPanel({ locked }) {
  const styles = useStyles();
  const lib = useApp(s => s.autoBuildLibrary);
  const simTime = useApp(s => s.build.simTime);
  const s = AS.effectiveSettings(lib);
  const set = patch => actions.updateAutoBuildSettings(patch);
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
  const auto = defaultPoolSize(cores);
  const metric = AS.metricOf(s);
  return (
    <section className={styles.section} aria-label="Search settings">
      <div className={styles.fields}>
        <NumberField label="Search simulation (s)" hint={`Per candidate, 1 to 300. The build's own is ${simTime} s.`} value={s.simulationTimeSeconds} min={1} max={300} integer disabled={locked} onCommit={v => set({ simulationTimeSeconds: v })} testId="auto-build-sim-time" />
        <NumberField label="Sample size multiplier" hint={`${AS.runsFor(10, s.sampleSizeMultiplier)} runs per candidate, ${AS.runsFor(50, s.sampleSizeMultiplier)} for the top 3.`} value={s.sampleSizeMultiplier} min={0.2} max={1000} disabled={locked} onCommit={v => set({ sampleSizeMultiplier: v })} testId="auto-build-multiplier" />
        <NumberField label="Time limit (s)" hint="Stops and keeps the best build found so far." value={s.timeLimitSeconds} min={AS.TIME_LIMIT_RANGE.min} max={AS.TIME_LIMIT_RANGE.max} integer disabled={locked} onCommit={v => set({ timeLimitSeconds: v })} testId="auto-build-time-limit" />
        <Field label="Engines" hint="Simulations run in parallel. A setting of this computer, for every config.">
          <Dropdown
            value={lib.cores ? String(lib.cores) : `Automatic (${auto})`}
            selectedOptions={[lib.cores ? String(lib.cores) : 'auto']}
            onOptionSelect={(_e, d) => actions.setAutoBuildCores(d.optionValue === 'auto' ? null : Number(d.optionValue))}
            data-testid="auto-build-cores"
          >
            <Option value="auto" text={`Automatic (${auto})`}>Automatic ({auto})</Option>
            {Array.from({ length: cores }, (_, i) => i + 1).map(n => <Option key={n} value={String(n)}>{String(n)}</Option>)}
          </Dropdown>
        </Field>
      </div>
      <div className={styles.switches}>
        <Switch label="Final refinement pass" checked={s.finalRefinementEnabled} disabled={locked} onChange={(_e, d) => set({ finalRefinementEnabled: d.checked })} data-testid="auto-build-refinement" />
        {s.finalRefinementEnabled ? (
          <div className={styles.fields}>
            <NumberField label="Refinement sample size" hint="Runs per candidate while refining (not multiplied)." value={s.finalRefinementSampleSize} min={1} max={10000} integer disabled={locked} onCommit={v => set({ finalRefinementSampleSize: v })} />
          </div>
        ) : null}
        <Switch label="Luck averaged (seeded runs: the same settings give the same build)" checked={s.luckAveragedEnabled} disabled={locked} onChange={(_e, d) => set({ luckAveragedEnabled: d.checked })} />
        <Switch label="Build for single shot/hit (one shot per simulation)" checked={s.buildForSingleHit} disabled={locked} onChange={(_e, d) => set({ buildForSingleHit: d.checked })} />
        <Switch label="Build for floor (crit, status and multishot at their guaranteed tier)" checked={s.buildForFloor} disabled={locked} onChange={(_e, d) => set({ buildForFloor: d.checked })} />
        <Switch label="Cost control (fit capacity with Forma; half-rank mods too)" checked={s.costControlEnabled} disabled={locked} onChange={(_e, d) => set({ costControlEnabled: d.checked })} data-testid="auto-build-cost-control" />
        {s.costControlEnabled ? (
          <div className={styles.fields}>
            <NumberField label="Maximum Forma" hint="In all, the build's existing Forma included (0 to 10). Apply sets the ones the result needs." value={s.maxForma} min={0} max={10} integer disabled={locked} onCommit={v => set({ maxForma: v })} />
          </div>
        ) : null}
      </div>
      <Field label="Score by">
        <RadioGroup
          layout="horizontal"
          value={metric}
          disabled={locked}
          onChange={(_e, d) => set({ buildForRawDamage: d.value === 'avgRawPerShot', buildForStatusDamage: d.value === 'avgDotPerShot' })}
        >
          <Radio value="avgDps" label="Average DPS" />
          <Radio value="avgRawPerShot" label="Raw damage per shot" />
          <Radio value="avgDotPerShot" label="Status damage per shot" />
        </RadioGroup>
      </Field>
    </section>
  );
}

// ---------- settings: elements ----------

/** One list of element targets: its chips, and one Add box that offers the presets and takes any combination. */
function TargetListEditor({ field, label, locked, testId }) {
  const styles = useStyles();
  const lib = useApp(s => s.autoBuildLibrary);
  const list = AS.effectiveSettings(lib)[field];
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const parsed = AS.parseTargetList(list);
  const has = t => parsed.some(p => p.target.join() === t.target.join());
  const write = next => actions.updateAutoBuildSettings({ [field]: next });
  const remove = name => write(list.filter(l => AS.parseElementTarget(l)?.name !== name));
  const add = raw => {
    const t = AS.parseElementTarget(raw);
    if (!t) { setError(`"${raw}" isn't an element or a combination of elements.`); return; }
    setError(null);
    setText('');
    if (!has(t)) { write([...list, t.name]); announce(`Added ${t.name} to ${label.toLowerCase()}.`); }
  };
  const presets = AS.ELEMENT_PRESETS.filter(p => !has(p));
  const q = text.trim().toLowerCase();
  const shown = q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;
  return (
    <div className={styles.section} data-testid={testId}>
      <Field label={`Add to ${label.toLowerCase()}`} hint="A preset, or any combination: “Viral Heat”, “Corrosive, Blast”." validationState={error ? 'none' : undefined} validationMessage={error ?? undefined} validationMessageIcon={error ? <ErrorCircleRegular /> : undefined}>
        <Combobox
          freeform
          value={text}
          selectedOptions={[]}
          placeholder="Element or combination"
          disabled={locked}
          onChange={e => { setText(e.target.value); setError(null); }}
          onOptionSelect={(_e, d) => { if (d.optionValue) add(d.optionValue); }}
          // Enter with the list closed adds what was typed; with it open, the highlighted option is chosen.
          onKeyDown={e => { if (e.key === 'Enter' && text.trim() && e.currentTarget.getAttribute('aria-expanded') !== 'true') { e.preventDefault(); add(text); } }}
          data-testid={`${testId}-add`}
        >
          {shown.map(p => <Option key={p.name} value={p.name}>{p.name}</Option>)}
          {text.trim() && !shown.some(p => p.name.toLowerCase() === q) ? <Option key="__free" value={text.trim()} text={text.trim()}>{`Add “${text.trim()}”`}</Option> : null}
        </Combobox>
      </Field>
      {parsed.length ? (
        <div className={styles.chips} role="list" aria-label={label}>
          {parsed.map(t => (
            <span role="listitem" key={t.name}>
              <Button size="small" appearance="secondary" icon={<DismissRegular />} iconPosition="after" disabled={locked} aria-label={`Remove ${t.name}`} onClick={() => remove(t.name)}>{t.name}</Button>
            </span>
          ))}
        </div>
      ) : <Caption1 className={styles.faint}>None yet.</Caption1>}
    </div>
  );
}

function ElementsPanel({ locked }) {
  const styles = useStyles();
  const lib = useApp(s => s.autoBuildLibrary);
  const s = AS.effectiveSettings(lib);
  const set = patch => actions.updateAutoBuildSettings(patch);
  return (
    <section className={styles.section} aria-label="Element settings">
      <Switch label="Elemental candidates (try element combinations in the first empty slots)" checked={s.elementalCandidatesEnabled} disabled={locked} onChange={(_e, d) => set({ elementalCandidatesEnabled: d.checked })} />
      {s.elementalCandidatesEnabled ? (
        <>
          <Switch label="Only these element targets" checked={s.specificElementalCandidatesEnabled} disabled={locked} onChange={(_e, d) => set({ specificElementalCandidatesEnabled: d.checked })} />
          {s.specificElementalCandidatesEnabled ? <TargetListEditor field="specificElementalTargets" label="Element targets" locked={locked} testId="auto-build-targets" /> : null}
        </>
      ) : <Caption1 className={styles.muted}>No element mods are placed, but mods that add Radiation or Magnetic directly can still be chosen.</Caption1>}
      <Switch label="Elemental blacklist" checked={s.elementalBlacklistEnabled} disabled={locked} onChange={(_e, d) => set({ elementalBlacklistEnabled: d.checked })} data-testid="auto-build-element-blacklist" />
      {s.elementalBlacklistEnabled ? (
        <>
          <Caption1 className={styles.muted}>Skips any build whose elements include all of a listed combination ("Heat" rules out every build with Heat).</Caption1>
          <TargetListEditor field="elementalBlacklist" label="Elemental blacklist" locked={locked} testId="auto-build-element-list" />
        </>
      ) : null}
    </section>
  );
}

// ---------- settings: mods ----------

function useSearchIndex(withArcanes) {
  const ctx = useApp(s => s.ctx);
  return useMemo(() => {
    // Every mod, as on the site: the lists are not limited to one weapon (they apply at run time).
    const mods = buildModIndex(ctx.data.mods.filter(m => m['Local Name']), { exilus: ctx.exilus, popular: ctx.popular });
    if (!withArcanes) return mods;
    const arcanes = [...indexArcanes(ctx.data).byName.values()].map(a => arcaneEntry({
      name: a.name, summary: arcaneSummary(a.name, ctx.data), description: a.description, maxRank: 5, controls: null,
    }));
    return [...mods, ...arcanes, arcaneEntry({ name: 'Riven Mod', summary: 'Any riven mod', description: '', maxRank: 8 })];
  }, [ctx, withArcanes]);
}

/** Columns of a chip grid at its current width (auto-fill of CHIP_MIN px columns). */
function useGridColumns(ref) {
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (w) setCols(Math.max(1, Math.floor((w + 8) / (CHIP_MIN + 8))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return cols;
}

/**
 * Add and remove names with the smart mod search; the list as card chips. Only the entries that apply to this weapon
 * are listed at first (the rest behind a disclosure), three rows at a time, as one tab stop with arrow keys.
 */
function ModListEditor({ field, defaults, withArcanes, locked, noun, testId }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const lib = useApp(s => s.autoBuildLibrary);
  const weaponName = useApp(s => s.build.weaponName);
  const text = useTextCards();
  const list = AS.effectiveSettings(lib)[field];
  const [query, setQuery] = useState('');
  const [others, setOthers] = useState(false);
  const [all, setAll] = useState(false);
  // Names added while the dialog is open come first, so a new chip is always in view.
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);
  const gridRef = useRef(null);
  const cols = useGridColumns(gridRef);
  const arrows = useArrowNavigationGroup({ axis: 'grid-linear', memorizeCurrent: true });
  const index = useSearchIndex(withArcanes);
  const inList = useMemo(() => new Set(list), [list]);
  const weapon = ctx.weaponByName.get(weaponName);
  const isArcane = name => !ctx.index.byName.has(name);
  const applies = useCallback(name => {
    if (name === 'Riven Mod') return true;
    const mod = ctx.index.byName.get(name);
    if (mod) return isModCompatible(mod, weapon);
    return isArcaneCompatible(name, weapon, ctx.data, 0);
  }, [ctx, weapon]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const { results: r } = searchEntries(index, parsed);
    // This weapon's own first, then the rest, each by match; ones already listed say so instead of vanishing.
    return sortResults(r, 'match').sort((a, b) => Number(!applies(a.name)) - Number(!applies(b.name))).slice(0, 18);
  }, [query, index, parsed, applies]);
  const sorted = useMemo(() => {
    const fresh = recent.filter(n => inList.has(n));
    return [...fresh, ...list.filter(n => !fresh.includes(n)).sort((a, b) => a.localeCompare(b))];
  }, [list, recent, inList]);
  const own = sorted.filter(n => recent.includes(n) || applies(n));
  const rest = sorted.filter(n => !recent.includes(n) && !applies(n));
  const matching = useMemo(() => {
    if (!query.trim()) return null;
    const { results: r } = searchEntries(index.filter(e => inList.has(e.name)), parsed);
    const hit = new Set(r.map(x => x.name));
    return sorted.filter(n => hit.has(n) || n.toLowerCase().includes(query.trim().toLowerCase()));
  }, [sorted, query, index, inList, parsed]);
  const pool = matching ?? (others ? sorted : own);
  const limit = LIST_ROWS * cols;
  const shown = all || matching ? pool : pool.slice(0, limit);
  const write = next => actions.updateAutoBuildSettings({ [field]: next });
  const add = name => {
    write([...list, name]);
    setRecent(r => [name, ...r.filter(n => n !== name)]);
    announce(`Added ${name} to the ${noun}.`);
    // The card leaves the results: keep focus in the search box, its text selected for the next search.
    focusSoon(() => inputRef.current, el => el.select?.());
  };
  const remove = name => {
    const i = shown.indexOf(name);
    write(list.filter(n => n !== name));
    announce(`Removed ${name} from the ${noun}.`);
    // Focus the next chip's remove button, else the one before, else the search box.
    focusSoon(() => {
      const buttons = [...(gridRef.current?.querySelectorAll(`[data-testid="${testId}-remove"]`) ?? [])];
      return buttons[Math.min(i, buttons.length - 1)] ?? inputRef.current;
    });
  };
  const same = list.length === defaults.length && list.every((n, i) => n === defaults[i]);
  const weaponWord = weapon?.name ?? 'this weapon';
  return (
    <div className={styles.section} data-testid={testId}>
      <div className={styles.row}>
        <Field label={`Add to the ${noun}`} style={{ flexGrow: 1, minWidth: 240 }}>
          <Input
            ref={inputRef}
            value={query}
            contentBefore={<SearchRegular aria-hidden="true" />}
            placeholder={withArcanes ? 'Search mods and arcanes: name, effect, cc' : 'Search mods: name, effect, cc'}
            disabled={locked}
            onChange={(_e, d) => setQuery(d.value)}
            data-testid={`${testId}-search`}
          />
        </Field>
        <Button icon={<ArrowResetRegular />} disabled={locked || same} onClick={() => { write(defaults); announce(`Reset the ${noun} to its ${defaults.length} defaults.`); }}>Reset to defaults</Button>
      </div>
      {query.trim() ? (
        results.length ? (
          <div className={styles.resultsGrid} role="list" aria-label="Search results">
            {results.map(r => {
              const listed = inList.has(r.name);
              return (
                <span role="listitem" key={r.name}>
                  <Button
                    className={mergeClasses(styles.addCard, text && styles.addCardNoThumb)}
                    style={{ width: '100%' }}
                    disabled={locked}
                    disabledFocusable={listed}
                    onClick={() => { if (!listed) add(r.name); }}
                    aria-label={listed ? `${r.name}: already in the ${noun}` : `Add ${r.name} to the ${noun}`}
                    title={r.name}
                    data-testid={listed ? `${testId}-listed` : `${testId}-add`}
                    data-name={r.name}
                  >
                    <Thumb name={r.name} kind={r.entry.kind === 'arcane' ? 'arcane' : 'mod'} />
                    <span className={styles.addName}>
                      <span>{r.name}</span>
                      {listed ? <Caption1 className={styles.faint}>Already in the {noun}</Caption1> : null}
                    </span>
                    {listed ? <CheckmarkRegular aria-hidden="true" /> : <AddRegular aria-hidden="true" />}
                  </Button>
                </span>
              );
            })}
          </div>
        ) : <Caption1 className={styles.faint}>Nothing matches "{query.trim()}".</Caption1>
      ) : null}
      <div className={styles.headingRow}>
        <Caption1 className={styles.muted} data-testid={`${testId}-count`}>
          {matching ? `${matching.length} of ${list.length} in the ${noun} match.`
            : `${list.length} in the ${noun}; ${own.length} apply to ${weaponWord}.`}
        </Caption1>
        {!matching && rest.length ? (
          <Button appearance="subtle" size="small" aria-expanded={others} onClick={() => setOthers(v => !v)} data-testid={`${testId}-others`}>
            {others ? `Hide the ${rest.length} for other weapon types` : `Show ${rest.length} for other weapon types`}
          </Button>
        ) : null}
      </div>
      {shown.length ? (
        <div ref={gridRef} className={styles.listGrid} role="list" aria-label={`The ${noun}`} {...arrows}>
          {shown.map(name => (
            <div role="listitem" key={name} className={mergeClasses(styles.chip, text && styles.chipNoThumb)} data-testid={`${testId}-item`} data-name={name} title={name}>
              <Thumb name={name} kind={isArcane(name) ? 'arcane' : 'mod'} />
              <Body1 className={styles.chipName}>{name}</Body1>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                disabled={locked}
                aria-label={`Remove ${name} from the ${noun}`}
                onClick={() => remove(name)}
                onKeyDown={e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(name); } }}
                data-testid={`${testId}-remove`}
              />
            </div>
          ))}
        </div>
      ) : <Caption1 className={styles.faint}>{list.length ? (matching ? 'None of them match.' : `None apply to ${weaponWord}.`) : `No items in the ${noun}.`}</Caption1>}
      {!matching && pool.length > limit ? (
        <Button appearance="subtle" size="small" className={styles.linkTarget} aria-expanded={all} onClick={() => setAll(v => !v)} data-testid={`${testId}-all`}>
          {all ? 'Show fewer' : `Show all ${pool.length}`}
        </Button>
      ) : null}
    </div>
  );
}

function ModsPanel({ locked }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const lib = useApp(s => s.autoBuildLibrary);
  const s = AS.effectiveSettings(lib);
  const defaults = useMemo(() => AS.defaultAutoBuildSettings(ctx.data), [ctx]);
  const set = patch => actions.updateAutoBuildSettings(patch);
  const overlap = AS.whitelistOverlap(s);
  return (
    <section className={styles.section} aria-label="Mod lists">
      <Switch label="Mod blacklist" checked={s.modBlacklistEnabled} disabled={locked} onChange={(_e, d) => set({ modBlacklistEnabled: d.checked })} data-testid="auto-build-blacklist-switch" />
      <Caption1 className={styles.muted}>Auto build never uses these. Arcanes count too. Rivens are never used{s.modBlacklistEnabled ? '' : '; with the list off, only rivens and (without headshots) the headshot-only items are left out'}.</Caption1>
      {s.modBlacklistEnabled ? <ModListEditor field="modBlacklist" defaults={defaults.modBlacklist} withArcanes locked={locked} noun="blacklist" testId="auto-build-blacklist" /> : null}
      <Switch label="Mod whitelist" checked={s.modWhitelistEnabled} disabled={locked} onChange={(_e, d) => set({ modWhitelistEnabled: d.checked })} data-testid="auto-build-whitelist-switch" />
      {s.modWhitelistEnabled ? (
        <>
          <Caption1 className={styles.muted}>Auto build only uses these mods (it never forces one in). The blacklist still applies.</Caption1>
          {overlap.length ? (
            <Caption1 className={styles.line} data-testid="auto-build-overlap"><InfoRegular aria-hidden="true" /> {overlap.length} whitelisted {overlap.length === 1 ? 'mod is' : 'mods are'} also blacklisted and won't be used: {overlap.slice(0, 6).join(', ')}{overlap.length > 6 ? '…' : ''}.</Caption1>
          ) : null}
          <ModListEditor field="modWhitelist" defaults={defaults.modWhitelist} withArcanes={false} locked={locked} noun="whitelist" testId="auto-build-whitelist" />
        </>
      ) : null}
      <Switch label="Stat blacklist" checked={s.statBlacklistEnabled} disabled={locked} onChange={(_e, d) => set({ statBlacklistEnabled: d.checked })} />
      {s.statBlacklistEnabled ? (
        <>
          <Caption1 className={styles.muted}>Skips mods that change these stats.</Caption1>
          <div className={styles.statToggles} role="group" aria-label="Stat blacklist">
            {AS.STAT_FAMILIES.map(f => {
              const on = s.statBlacklist.includes(f.key);
              return (
                <ToggleButton key={f.key} size="small" checked={on} icon={on ? <CheckmarkRegular /> : undefined} disabled={locked} onClick={() => set({ statBlacklist: on ? s.statBlacklist.filter(k => k !== f.key) : [...s.statBlacklist, f.key] })}>
                  {f.label}
                </ToggleButton>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------- the dialog ----------

export function AutoBuildDialog() {
  const styles = useStyles();
  const open = useApp(s => s.autoBuildOpen);
  const ready = useApp(s => Boolean(s.build && s.ctx && s.autoBuildLibrary));
  const ab = useApp(s => s.autoBuild);
  const lib = useApp(s => s.autoBuildLibrary);
  const build = useApp(s => s.build);
  const ctx = useApp(s => s.ctx);
  const [tab, setTab] = useState('run');
  const [keep, setKeep] = useState(() => new Set());
  const [keepArcane, setKeepArcane] = useState(true);
  const runRef = useRef(null);
  const cancelRef = useRef(null);
  const applyRef = useRef(null);
  const status = ab?.status ?? null;
  const running = status === 'running';
  const done = status === 'done';
  // Every filled slot is kept by default, each time the dialog opens and whenever the mods change.
  const filledKey = build ? build.mods.map(m => m?.name ?? '').join('|') : '';
  useEffect(() => {
    if (!open || !build) return;
    setKeep(new Set(GENERAL_SLOTS.filter(i => build.mods[i])));
    setKeepArcane(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open and on a different set of mods only
  }, [open, filledKey]);
  useEffect(() => { if (running) setTab('run'); }, [running]);
  // The dialog opens on its primary action: Run, or Apply (Close) with a result. (Not autoFocus: Run sits in a Tooltip,
  // whose focus handler is not ready while React mounts it.)
  useEffect(() => {
    if (open) focusSoon(() => (store.get().autoBuild?.status === 'done' ? applyRef.current : store.get().autoBuild?.status === 'running' ? cancelRef.current : runRef.current));
  }, [open]);
  // Focus follows the run: Cancel while it runs, Apply (or Close) with a result, Run after a cancel or an error.
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (!open || prev === status) return;
    if (status === 'running') focusSoon(() => cancelRef.current);
    else if (status === 'done') focusSoon(() => applyRef.current);
    else if (prev === 'running') focusSoon(() => runRef.current);
  }, [open, status]);
  // Esc closes the dialog even when focus fell to the page.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      if (e.key === 'Escape' && !e.defaultPrevented && (document.activeElement === document.body || !document.activeElement)) {
        e.preventDefault();
        actions.setAutoBuildOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!ready) return null;
  const locked = AS.activeConfig(lib).locked;
  const weapon = ctx.weaponByName.get(build.weaponName);
  const idle = nothingToFill(build, weapon, keep, keepArcane);
  const run = () => { if (!idle) actions.startAutoBuild({ keepSlots: [...keep], keepArcane }); };
  const over = done && ab.result.changed ? resultCapacity(ctx, build, ab.result).over : 0;
  return (
    <Dialog open={open} onOpenChange={(_e, d) => actions.setAutoBuildOpen(d.open)}>
      <DialogSurface className={styles.surface} aria-describedby="auto-build-about" data-testid="auto-build-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.setAutoBuildOpen(false)} />}>
            Auto build
          </DialogTitle>
          <span id="auto-build-about" className={styles.srOnly}>{ABOUT}</span>
          <DialogContent className={styles.content}>
            {done ? <ResultView /> : (
              <>
                <ConfigRow disabled={running} />
                <TabList selectedValue={tab} onTabSelect={(_e, d) => setTab(d.value)} data-testid="auto-build-tabs">
                  <Tab value="run" data-testid="auto-build-tab-run">Run</Tab>
                  <Tab value="search" disabled={running} data-testid="auto-build-tab-search">Search</Tab>
                  <Tab value="elements" disabled={running} data-testid="auto-build-tab-elements">Elements</Tab>
                  <Tab value="mods" disabled={running} data-testid="auto-build-tab-mods">Mods</Tab>
                </TabList>
                {tab === 'run' ? <RunPanel keep={keep} setKeep={setKeep} keepArcane={keepArcane} setKeepArcane={setKeepArcane} /> : null}
                {tab === 'search' ? <SearchPanel locked={locked} /> : null}
                {tab === 'elements' ? <ElementsPanel locked={locked} /> : null}
                {tab === 'mods' ? <ModsPanel locked={locked} /> : null}
              </>
            )}
          </DialogContent>
          <DialogActions>
            {running ? (
              <Button ref={cancelRef} onClick={() => actions.cancelAutoBuild()} disabled={/Cancelling/.test(ab.step)} data-testid="auto-build-cancel">{/Cancelling/.test(ab.step) ? 'Stopping…' : 'Cancel'}</Button>
            ) : done ? (
              ab.result.changed ? (
                <>
                  <Button onClick={() => { actions.discardAutoBuild(); focusSoon(() => runRef.current); }} data-testid="auto-build-discard">Discard</Button>
                  <Button ref={applyRef} appearance="primary" onClick={() => actions.applyAutoBuild()} data-testid="auto-build-apply">
                    {over > 0 ? `Apply (${over} over capacity)` : 'Apply'}
                  </Button>
                </>
              ) : <Button ref={applyRef} appearance="primary" onClick={() => { actions.discardAutoBuild(); actions.setAutoBuildOpen(false); }} data-testid="auto-build-close">Close</Button>
            ) : (
              <>
                <Button onClick={() => actions.setAutoBuildOpen(false)} data-testid="auto-build-close">Close</Button>
                <Tooltip content={idle ? 'Untick mods under Keep to let Auto build replace them' : `Run with "${AS.activeConfig(lib).name}"`} relationship="description">
                  <Button
                    ref={runRef}
                    appearance="primary"
                    icon={<WandRegular />}
                    disabledFocusable={idle}
                    onClick={() => { setTab('run'); run(); }}
                    data-testid="auto-build-run"
                  >
                    {ab ? 'Run again' : 'Run'}
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

/**
 * The entry point (docs/declutter-spec.md 4): a quiet button on the Loadout's capacity line. While a run goes on with
 * the dialog closed, or a result waits, it says so ("Auto build · 45%", "Auto build · result").
 */
export function AutoBuildButton() {
  const ab = useApp(s => s.autoBuild);
  const open = useApp(s => s.autoBuildOpen);
  const ready = useApp(s => Boolean(s.autoBuildLibrary));
  const status = !open && ab?.status === 'running' ? ` · ${Math.round(ab.percent ?? 0)}%` : !open && ab?.status === 'done' ? ' · result' : '';
  return (
    <Tooltip content="Fill the empty slots with the best mods (Ctrl+Shift+A)" relationship="description">
      <Button
        appearance="subtle"
        size="small"
        icon={<WandRegular />}
        disabled={!ready}
        onClick={() => actions.setAutoBuildOpen(true)}
        data-testid="auto-build-open"
        data-focus-id="auto-build-open"
        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {`Auto build${status}`}
      </Button>
    </Tooltip>
  );
}
