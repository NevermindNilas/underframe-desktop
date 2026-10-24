// The stage (docs/arsenal-spec.md 4): notices, the weapon header (weapon, Catalyst and Forma, fire mode, More),
// the capacity meter, the special row (Exilus + Arcane) and the 2x4 mod grid. It never scrolls.
import { useMemo, useState } from 'react';
import {
  Body1, Button, Caption1, Combobox, Dropdown, Field, Link, Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger,
  MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Option, OptionGroup, Popover, PopoverSurface, PopoverTrigger,
  Radio, RadioGroup, Switch, Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  ArrowResetRegular, DeleteRegular, DismissRegular, ErrorCircleRegular, MoreHorizontalRegular, ScanTextRegular,
} from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived, useElementWidth } from '../hooks.js';
import { stageSizeFor } from '../layout.js';
import {
  ARCANE_SLOT, EXILUS_SLOT, INCARNON_NOTE, KITGUN_ARCANE_SLOT, WEAPON_GROUPS, isIncarnonMode, slotLabel, weaponMatches,
} from '../model.js';
import { arcaneSlotCount } from '../../shared/arcanes.js';
import { isKitgun } from '../../shared/mods.js';
import { previewSlots } from '../dnd.js';
import { buildCapacity } from '../model.js';
import { chooseFile } from '../ocr-import.js';
import { ArcaneSlot, ModSlot, SlotCaption } from './SlotCard.jsx';
import { polarityName } from './art.jsx';

const useStyles = makeStyles({
  stage: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    boxSizing: 'border-box',
    containerType: 'inline-size',
  },
  header: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalL, minWidth: 0 },
  headerCompact: { alignItems: 'center' },
  weapon: { display: 'flex', flexDirection: 'column', minWidth: 0, flexShrink: 1 },
  combobox: {
    minWidth: '200px',
    width: '260px',
    maxWidth: '100%',
    '& input': { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  },
  meta: { color: tokens.colorNeutralForeground2, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', minHeight: '20px' },
  linkButton: { fontSize: tokens.fontSizeBase200 },
  modes: { flexGrow: 1, display: 'flex', justifyContent: 'center', minWidth: 0 },
  spacer: { flexGrow: 1 },
  visuallyHidden: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  capacity: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, minHeight: '28px' },
  capacityCompact: { minWidth: '200px', width: '240px' },
  meterLabel: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  track: {
    position: 'relative',
    flexGrow: 1,
    height: '8px',
    minWidth: '80px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralStroke3,
    overflow: 'hidden',
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground,
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Highlight' },
  },
  fillOver: { backgroundColor: tokens.colorStatusDangerBackground3 },
  value: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold },
  over: { color: tokens.colorPaletteRedForeground1, display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' },
  slots: { display: 'grid', columnGap: '12px', rowGap: '12px', justifyContent: 'start' },
  cell: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  selectionHint: { color: tokens.colorNeutralForeground2, minHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  notices: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  noticeLine: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  catalystPop: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, maxWidth: '300px' },
});

function Notices({ collapse }) {
  const styles = useStyles();
  const notices = useApp(s => s.notices);
  const upstream = useApp(s => s.upstream);
  const dismissed = useApp(s => s.upstreamDismissed);
  const [expanded, setExpanded] = useState(false);
  const all = [
    ...(upstream?.outdated && !dismissed ? [{ id: 'upstream', intent: 'info', items: ['Newer Underframe data is available. Update the app to get the latest weapons and mods.'] }] : []),
    ...notices,
  ];
  if (!all.length) return null;
  const dismiss = n => (n.id === 'upstream' ? actions.dismissUpstream() : actions.dismissNotice(n.id));
  const bar = n => (
    <MessageBar key={n.id} intent={n.intent} layout="multiline">
      <MessageBarBody>
        {n.title ? <MessageBarTitle>{n.title}</MessageBarTitle> : null}
        {n.items.length === 1 ? n.items[0] : <ul className={styles.list}>{n.items.map(t => <li key={t}>{t}</li>)}</ul>}
      </MessageBarBody>
      <MessageBarActions containerAction={<Button appearance="transparent" icon={<DismissRegular />} aria-label="Dismiss notice" onClick={() => dismiss(n)} />} />
    </MessageBar>
  );
  // Several notices, or one that would push the gallery's card row out of view, collapse into one line (2.1).
  if ((collapse || all.length > 1) && !expanded) {
    const intent = all.some(n => n.intent === 'warning') ? 'warning' : 'info';
    return (
      <MessageBar intent={intent} layout="singleline" data-testid="notices-collapsed">
        <MessageBarBody className={styles.noticeLine} title={all.length === 1 ? [all[0].title, ...all[0].items].filter(Boolean).join(' ') : undefined}>
          {all.length === 1 ? (all[0].title ?? all[0].items[0] ?? '') : `${all.length} notices`}
        </MessageBarBody>
        <MessageBarActions containerAction={all.length === 1 ? <Button appearance="transparent" icon={<DismissRegular />} aria-label="Dismiss notice" onClick={() => dismiss(all[0])} /> : undefined}>
          <Button size="small" onClick={() => setExpanded(true)}>Show</Button>
        </MessageBarActions>
      </MessageBar>
    );
  }
  return (
    <div className={styles.notices}>
      {all.map(bar)}
      {expanded ? <Link as="button" onClick={() => setExpanded(false)}>Hide notices</Link> : null}
    </div>
  );
}

function WeaponPicker() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const weaponName = useApp(s => s.build?.weaponName ?? '');
  const [query, setQuery] = useState(null);
  const groups = useMemo(() => weaponMatches(ctx, query ?? ''), [ctx, query]);
  const empty = WEAPON_GROUPS.every(g => !groups[g].length);
  const q = (query ?? '').trim().toLowerCase();
  const kitgun = empty && q.length >= 3 && ctx.data.weapons.some(w => isKitgun(w) && w.name.toLowerCase().includes(q));
  return (
    <>
      <label htmlFor="weapon-combobox" className={styles.visuallyHidden}>Weapon</label>
      <Combobox
        id="weapon-combobox"
        className={styles.combobox}
        appearance="filled-darker"
        value={query ?? weaponName}
        selectedOptions={[weaponName]}
        placeholder="Search weapons"
        onChange={e => setQuery(e.target.value)}
        onOptionSelect={(_e, d) => {
          setQuery(null);
          if (d.optionValue && d.optionValue !== weaponName) actions.setWeapon(d.optionValue);
        }}
        onOpenChange={(_e, d) => { if (!d.open) setQuery(null); }}
        positioning={{ autoSize: 'height' }}
        data-focus-id="weapon"
      >
        {WEAPON_GROUPS.map(g => (groups[g].length ? (
          <OptionGroup key={g} label={g}>
            {groups[g].map(w => (
              <Option key={w.name} value={w.name} text={w.name}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
                  <span>{w.name}</span>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{w.subtype}</Caption1>
                </span>
              </Option>
            ))}
          </OptionGroup>
        ) : null))}
        {empty ? (
          <Option key="none" value="" text="" disabled>
            {kitgun ? "Kitguns aren't supported yet: their stats come from the grip and loader you pick." : `No weapons match "${query}"`}
          </Option>
        ) : null}
      </Combobox>
    </>
  );
}

function WeaponMeta() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const { capacity } = useDerived();
  const weapon = ctx.weaponByName.get(build.weaponName);
  const progenitor = Boolean(weapon?.is_progenitor);
  const rank = progenitor && capacity.forma >= 5 ? 40 : 30;
  return (
    <Caption1 className={styles.meta}>
      <span>{weapon?.subtype ?? weapon?.type}</span>
      <span aria-hidden="true">·</span>
      <span>Rank {rank}</span>
      <span aria-hidden="true">·</span>
      <Popover withArrow positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <Link as="button" className={styles.linkButton} data-testid="catalyst-toggle">{capacity.catalyst ? 'Orokin Catalyst' : 'No Catalyst'}</Link>
        </PopoverTrigger>
        <PopoverSurface className={styles.catalystPop}>
          <Switch
            label="Orokin Catalyst (doubles capacity)"
            checked={capacity.catalyst}
            onChange={(_e, d) => actions.setCatalyst(d.checked)}
          />
          <Caption1>Assumes weapon rank 30{progenitor ? ' (40 after 5 Forma for this weapon)' : ''}. Arcanes don't use capacity.</Caption1>
        </PopoverSurface>
      </Popover>
      <span aria-hidden="true">·</span>
      <span>{capacity.forma} Forma</span>
    </Caption1>
  );
}

/** Rough width of a horizontal radio group (circle, gap and label at 14 px Segoe UI). */
const radiosWidth = modes => modes.reduce((w, m) => w + 40 + String(m.mode_name).length * 7.4, 0);

function FireMode({ compact, room = Infinity }) {
  const { stats } = useDerived();
  const modeName = useApp(s => s.build?.modeName ?? '');
  const modes = stats?.selectable ?? [];
  const hint = isIncarnonMode(modeName) ? INCARNON_NOTE : undefined;
  if (modes.length <= 1) {
    return compact ? null : (
      <Field label="Fire mode" hint={hint} size="small">
        <Body1>{modes[0]?.mode_name ?? 'Normal Attack'}</Body1>
      </Field>
    );
  }
  // Radios that would wrap onto a second line (taking stage height from the gallery) become a dropdown.
  if (modes.length > 3 || compact || radiosWidth(modes) > room) {
    return (
      <Field label={compact ? undefined : 'Fire mode'} hint={compact ? undefined : hint} size="small">
        <Dropdown size="small" aria-label="Fire mode" value={modeName} selectedOptions={[modeName]} onOptionSelect={(_e, d) => actions.setMode(d.optionValue)} style={{ minWidth: 140 }}>
          {modes.map(m => <Option key={m.mode_name} value={m.mode_name}>{m.mode_name}</Option>)}
        </Dropdown>
      </Field>
    );
  }
  return (
    <Field label="Fire mode" hint={hint} size="small">
      <RadioGroup layout="horizontal" value={modeName} onChange={(_e, d) => actions.setMode(d.value)}>
        {modes.map(m => <Radio key={m.mode_name} value={m.mode_name} label={m.mode_name} />)}
      </RadioGroup>
    </Field>
  );
}

/** The capacity meter (4.2): a custom bar because it must show overflow; previews the drop while dragging. */
export function CapacityMeter({ compact }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const drag = useApp(s => s.drag);
  const pickup = useApp(s => s.pickup);
  const { capacity } = useDerived();
  const active = drag ?? pickup;
  const target = drag?.over ?? pickup?.at;
  const preview = active && Number.isInteger(target) ? previewSlots(ctx, build, active, target) : null;
  const cap = preview ? buildCapacity(ctx, build, preview) : capacity;
  const pct = Math.min(1, cap.used / Math.max(1, cap.capacity));
  return (
    <div className={mergeClasses(styles.capacity, compact && styles.capacityCompact)}>
      <Caption1 className={styles.meterLabel} id="capacity-label">Capacity</Caption1>
      <div
        className={styles.track}
        role="meter"
        aria-labelledby="capacity-label"
        aria-valuemin={0}
        aria-valuemax={cap.capacity}
        aria-valuenow={cap.used}
        aria-valuetext={`${cap.used} of ${cap.capacity} capacity used${cap.over ? `, ${cap.over} over` : ''}`}
        data-testid="capacity"
      >
        <span className={mergeClasses(styles.fill, cap.over > 0 && styles.fillOver)} style={{ width: `${pct * 100}%` }} />
      </div>
      <Body1 className={styles.value} style={cap.over ? { color: tokens.colorPaletteRedForeground1 } : undefined}>{cap.used} / {cap.capacity}</Body1>
      {cap.over ? (
        <Caption1 className={styles.over}><ErrorCircleRegular aria-hidden="true" /> {cap.over} over capacity</Caption1>
      ) : null}
      {/* The compact header has no Catalyst line: say when the capacity isn't doubled (the More menu toggles it). */}
      {compact && !cap.over && !capacity.catalyst ? <Caption1 className={styles.meterLabel} data-testid="catalyst-off">No Catalyst</Caption1> : null}
    </div>
  );
}

function StageMenu({ compact }) {
  const hasMods = useApp(s => s.build?.mods.some(Boolean));
  const hasForma = useApp(s => s.build?.slotPolarities?.some(p => p != null));
  const { capacity } = useDerived();
  // Under 800 px the header drops the "Rank 30 · Orokin Catalyst · N Forma" line: the Catalyst lives here then.
  const checkedValues = { catalyst: capacity?.catalyst ? ['on'] : [] };
  return (
    <Menu
      positioning="below-end"
      checkedValues={checkedValues}
      onCheckedValueChange={(_e, d) => { if (d.name === 'catalyst') actions.setCatalyst(d.checkedItems.includes('on')); }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="More" relationship="label">
          <Button appearance="subtle" icon={<MoreHorizontalRegular />} data-testid="stage-more" />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<DeleteRegular />} disabled={!hasMods} onClick={() => actions.removeAllMods()}>Remove all mods</MenuItem>
          <MenuItem icon={<ArrowResetRegular />} disabled={!hasForma} onClick={() => actions.resetSlotPolarities()}>Reset slot polarities</MenuItem>
          <MenuItem icon={<ScanTextRegular />} secondaryContent="Ctrl+I" onClick={() => chooseFile()}>Import from screenshot…</MenuItem>
          {compact ? (
            <>
              <MenuDivider />
              <MenuItemCheckbox name="catalyst" value="on" secondaryContent={`${capacity?.forma ?? 0} Forma`} data-testid="catalyst-menu">
                Orokin Catalyst (doubles capacity)
              </MenuItemCheckbox>
            </>
          ) : null}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function SelectionHint() {
  const styles = useStyles();
  const selected = useApp(s => s.selectedSlot);
  const pickup = useApp(s => s.pickup);
  const polarities = useDerived().capacity?.polarities;
  let text = '';
  if (pickup) text = `Moving ${pickup.name}: arrow keys choose a slot, Enter drops, Delete removes, Esc cancels.`;
  else if (selected === ARCANE_SLOT) text = 'Arcane slot selected. Click an arcane in the gallery to put it here.';
  else if (selected === KITGUN_ARCANE_SLOT) text = 'Kitgun arcane slot selected. Click a Pax or Residual arcane in the gallery to put it here.';
  else if (selected != null) {
    const pol = polarityName(polarities?.[selected]);
    text = `${selected === EXILUS_SLOT ? 'Exilus slot' : slotLabel(selected)}${pol ? ` (${pol})` : ''} selected. Click a card in the gallery to put it here.`;
  }
  return <Caption1 className={styles.selectionHint} aria-live="off">{text}</Caption1>;
}

/**
 * Arrow keys between the slot buttons by their position on screen (docs/arsenal-spec.md 4.7): left/right along a
 * row, up/down to the nearest slot in the next row. Alt/Shift/Ctrl arrows are left to the slot (swap, ranks).
 */
function moveBetweenSlots(e) {
  const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const dir = keys[e.key];
  if (!dir || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const from = e.target.closest?.('[data-slot-button]');
  if (!from) return;
  const all = [...e.currentTarget.querySelectorAll('[data-slot-button]')].filter(el => el.getClientRects().length);
  const c = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
  };
  const a = c(from);
  let best = null;
  for (const el of all) {
    if (el === from) continue;
    const b = c(el);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = dir[0] ? dx * dir[0] : dy * dir[1];
    const across = dir[0] ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4 || (dir[0] && across > a.h / 2)) continue;
    const score = along + across * 2;
    if (!best || score < best.score) best = { el, score };
  }
  if (!best) return;
  e.preventDefault();
  best.el.focus();
}

/** The stage. `layout` from layoutFor(); the slot size comes from the stage's own width. */
export function Stage({ layout }) {
  const styles = useStyles();
  const [ref, width] = useElementWidth();
  const noticeCount = useApp(s => s.notices.length + (s.upstream?.outdated && !s.upstreamDismissed ? 1 : 0));
  const { size, collapse } = stageSizeFor(layout, width || 600, noticeCount);
  const compact = layout.compactHeight;
  const g = layout.gutter;
  const selected = useApp(s => s.selectedSlot);
  // One Tab stop for the slot group: the slot last focused (else the selected one, else the Exilus slot).
  const [rove, setRove] = useState(null);
  const current = rove ?? selected ?? EXILUS_SLOT;
  const onFocusSlot = e => {
    const el = e.target.closest?.('[data-slot]');
    if (!el) return;
    const v = el.dataset.slot;
    setRove(v === 'arcane' ? ARCANE_SLOT : v === 'arcane-1' ? KITGUN_ARCANE_SLOT : Number(v));
  };
  const columns = size.columns;
  const cellStyle = { width: size.width };
  const gridTemplate = `repeat(${columns}, ${size.width}px)`;
  const exilusInfo = 'Only Exilus mods fit here.';
  const arcaneInfo = 'Primary or secondary arcanes. Assumes an Arcane Adapter is fitted.';
  const kitgunArcaneInfo = 'Kitguns have a second arcane slot for Pax and Residual arcanes.';
  const weaponName = useApp(s => s.build?.weaponName);
  const weapon = useApp(s => s.ctx?.weaponByName.get(weaponName));
  const twoArcanes = arcaneSlotCount(weapon) > 1;

  return (
    <section
      ref={ref}
      className={styles.stage}
      style={{ padding: g, gap: compact ? 8 : 12 }}
      data-pane="stage"
      aria-label="Build stage"
    >
      <Notices collapse={collapse} />
      <div className={mergeClasses(styles.header, compact && styles.headerCompact)} style={{ minHeight: compact ? 44 : 48 }}>
        <div className={styles.weapon}>
          <WeaponPicker />
          {compact ? null : <WeaponMeta />}
        </div>
        <div className={styles.modes}><FireMode compact={compact} room={(width || 600) - 2 * g - 260 - 32 - 2 * 16} /></div>
        {compact ? <CapacityMeter compact /> : null}
        <StageMenu compact={compact} />
      </div>
      {compact ? null : <CapacityMeter />}
      <div role="group" aria-label="Mod slots" onKeyDown={moveBetweenSlots} onFocus={onFocusSlot}>
        <div className={styles.slots} style={{ gridTemplateColumns: gridTemplate }}>
          {/* The captions stay at every size (16 px): they name the special row's two unlabeled-looking cards. */}
          <div className={styles.cell} style={cellStyle}>
            <SlotCaption info={exilusInfo} about="Exilus">Exilus</SlotCaption>
            <ModSlot slot={EXILUS_SLOT} width={size.width} height={size.height} caption="Exilus" tabbable={current === EXILUS_SLOT} />
          </div>
          <div className={styles.cell} style={cellStyle}>
            <SlotCaption info={arcaneInfo} about="Arcane">Arcane</SlotCaption>
            <ArcaneSlot width={size.width} height={size.height} tabbable={current === ARCANE_SLOT} />
          </div>
          {twoArcanes ? (
            <div className={styles.cell} style={cellStyle}>
              <SlotCaption info={kitgunArcaneInfo} about="kitgun arcane">Kitgun arcane</SlotCaption>
              <ArcaneSlot index={1} width={size.width} height={size.height} tabbable={current === KITGUN_ARCANE_SLOT} />
            </div>
          ) : null}
          {columns === 4 ? <div style={{ gridColumn: `span ${twoArcanes ? 1 : 2}` }} aria-hidden="true" /> : null}
          {columns === 2 && twoArcanes ? <div aria-hidden="true" /> : null}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className={styles.cell} style={cellStyle}>
              <ModSlot slot={i} width={size.width} height={size.height} tabbable={current === i} />

            </div>
          ))}
        </div>
      </div>
      {compact ? null : <SelectionHint />}
    </section>
  );
}
