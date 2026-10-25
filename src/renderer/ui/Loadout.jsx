// The Loadout (docs/declutter-spec.md 1): notices, the weapon and fire mode, capacity, and the arsenal slots: the
// 2x4 grid with the arcane dome on top of the Exilus slot to its right, larger at rest and smaller while picking (the
// Picker then takes the lower area). It never scrolls; the slot size follows the column's width and height.
import { useEffect, useMemo, useState } from 'react';
import {
  Body1, Button, Caption1, Combobox, Dropdown, Link, Menu, MenuDivider, MenuItem, MenuItemCheckbox, MenuList, MenuPopover,
  MenuTrigger, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Option, OptionGroup, Toolbar, ToolbarRadioButton,
  Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import { ArrowResetRegular, DeleteRegular, DismissRegular, ErrorCircleRegular, MoreHorizontalRegular } from '@fluentui/react-icons';
import { actions, store } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { slotSizeFor } from '../layout.js';
import {
  ARCANE_SLOT, EXILUS_SLOT, INCARNON_NOTE, KITGUN_ARCANE_SLOT, WEAPON_GROUPS, buildCapacity, isIncarnonMode, weaponMatches,
} from '../model.js';
import { arcaneSlotCount } from '../../shared/arcanes.js';
import { isKitgun } from '../../shared/mods.js';
import { modeLabel } from '../../shared/fire-modes.js';
import { previewSlots } from '../dnd.js';
import { ArcaneSlot, ModSlot } from './SlotCard.jsx';
import { AutoBuildButton } from './AutoBuildDialog.jsx';
import { AutoFormaButton } from './AutoFormaDialog.jsx';
import { RivenToolsButton } from './RivenToolsDialog.jsx';
import { WeaponOptions } from './WeaponOptions.jsx';

const useStyles = makeStyles({
  loadout: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  // Wraps when the weapon, a long mode list and the capacity don't fit one line (the capacity goes under).
  header: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalS, minWidth: 0, minHeight: '36px', flexWrap: 'wrap' },
  combobox: {
    minWidth: '180px',
    width: '240px',
    maxWidth: '100%',
    flexShrink: 1,
    '& input': { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  },
  modeText: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  modes: { padding: 0, flexShrink: 0 },
  spacer: { flexGrow: 1 },
  visuallyHidden: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  capacity: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, minHeight: '28px', minWidth: 0 },
  // On the weapon's line it takes the room left and is never narrower than its content (the meter's least width and
  // the tools): when that doesn't fit, it wraps to a row of its own, full width, instead of spilling into the Readout.
  capacityCompact: { flexGrow: 1, minWidth: 'max-content' },
  // Pushes the tools to the right end of the line.
  grow: { flexGrow: 1 },
  meterLabel: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  tools: { padding: 0, flexShrink: 0, gap: '2px' },
  track: {
    position: 'relative',
    // Takes the free room first, up to its cap (the spacer before the tools gets what is left).
    flexGrow: 100,
    height: '6px',
    minWidth: '80px',
    // A bar long enough to read at a glance; the rest of the line is left free.
    maxWidth: '320px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralStroke3,
    overflow: 'hidden',
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  // Neutral fill: brand blue is kept for Save, focus and selection (docs/declutter-spec.md 3); red over capacity.
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralForeground3,
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Highlight' },
  },
  fillOver: { backgroundColor: tokens.colorStatusDangerBackground3 },
  value: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: tokens.fontWeightSemibold },
  over: { color: tokens.colorPaletteRedForeground1, display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' },
  // Centred when the slots reach their largest size and the column is wider (1920 px windows).
  slots: { display: 'grid', columnGap: '12px', rowGap: '12px', justifyContent: 'center' },
  notices: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  noticeLine: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
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
  // Several notices, or a short window, collapse into one line so the slots keep their room.
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
        onKeyDown={e => {
          // Nothing typed (the field shows the weapon): Ctrl+Z / Ctrl+Y undo and redo the build, like everywhere else,
          // instead of a text undo that leaves half a name in the field.
          const ctrl = e.ctrlKey || e.metaKey;
          if (!ctrl || e.altKey || query != null) return;
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) { e.preventDefault(); actions.undoLatest(); }
          else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); actions.redo(); }
        }}
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

/**
 * Fire mode beside the weapon: plain text with one mode, a segmented radio toolbar with 2-3 (one tab stop), a
 * dropdown with more. Combined modes (an impact with its explosion, from the data) are listed after the weapon's own.
 */
function FireMode() {
  const styles = useStyles();
  const { stats } = useDerived();
  // The pick that runs: the build's, or the default when its pick can no longer run (a combined mode's augment left).
  const picked = useApp(s => s.build?.modeName ?? '');
  const modeName = stats?.modeId || picked;
  const modes = (stats?.choices ?? []).map(c => ({ mode_name: c.id, label: c.label, combined: c.combined }));
  const hint = isIncarnonMode(modeName) ? INCARNON_NOTE : undefined;
  if (modes.length <= 1) return <Body1 className={styles.modeText}>{modes[0]?.label ?? 'Normal Attack'}</Body1>;
  if (modes.length > 3) {
    const own = modes.filter(m => !m.combined);
    const combined = modes.filter(m => m.combined);
    return (
      <Dropdown size="medium" aria-label="Fire mode" value={modeLabel(modeName)} selectedOptions={[modeName]} onOptionSelect={(_e, d) => actions.setMode(d.optionValue)} style={{ minWidth: 160 }} data-testid="fire-mode">
        {own.map(m => <Option key={m.mode_name} value={m.mode_name}>{m.label}</Option>)}
        {combined.length ? (
          <OptionGroup label="Combined">
            {combined.map(m => <Option key={m.mode_name} value={m.mode_name} text={m.label}>{m.label}</Option>)}
          </OptionGroup>
        ) : null}
      </Dropdown>
    );
  }
  const toolbar = (
    <Toolbar
      aria-label="Fire mode"
      className={styles.modes}
      checkedValues={{ mode: [modeName] }}
      onCheckedValueChange={(_e, d) => { if (d.name === 'mode' && d.checkedItems[0]) actions.setMode(d.checkedItems[0]); }}
      data-testid="fire-mode"
    >
      {modes.map(m => (
        <ToolbarRadioButton key={m.mode_name} name="mode" value={m.mode_name} appearance="subtle">{m.label}</ToolbarRadioButton>
      ))}
    </Toolbar>
  );
  return hint ? <Tooltip content={hint} relationship="description">{toolbar}</Tooltip> : toolbar;
}

/** Catalyst, Forma reset and Remove all: the capacity line's menu (the build mechanics, in one place). */
function CapacityMenu() {
  const hasMods = useApp(s => s.build?.mods.some(Boolean));
  const hasForma = useApp(s => s.build?.slotPolarities?.some(p => p != null));
  const { capacity } = useDerived();
  return (
    <Menu
      positioning="below-end"
      checkedValues={{ catalyst: capacity?.catalyst ? ['on'] : [] }}
      onCheckedValueChange={(_e, d) => { if (d.name === 'catalyst') actions.setCatalyst(d.checkedItems.includes('on')); }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Catalyst, Forma and more" relationship="label">
          <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} data-testid="capacity-menu" />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItemCheckbox name="catalyst" value="on" data-testid="catalyst-menu">Orokin Catalyst (doubles capacity)</MenuItemCheckbox>
          <MenuDivider />
          <MenuItem icon={<ArrowResetRegular />} disabled={!hasForma} secondaryContent={`${capacity?.forma ?? 0} Forma`} onClick={() => actions.resetSlotPolarities()}>Reset slot polarities</MenuItem>
          <MenuItem icon={<DeleteRegular />} disabled={!hasMods} onClick={() => actions.removeAllMods()}>Remove all mods</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** The capacity meter: a custom bar because it must show overflow; previews the drop while dragging. */
export function CapacityMeter({ compact = false }) {
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
        aria-valuetext={`${cap.used} of ${cap.capacity} capacity used${cap.over ? `, ${cap.over} over` : ''}${capacity.catalyst ? '' : ', no Catalyst'}`}
        data-testid="capacity"
      >
        <span className={mergeClasses(styles.fill, cap.over > 0 && styles.fillOver)} style={{ width: `${pct * 100}%` }} />
      </div>
      <Body1 className={styles.value} style={cap.over ? { color: tokens.colorPaletteRedForeground1 } : undefined}>{cap.used} / {cap.capacity}</Body1>
      {cap.over ? <Caption1 className={styles.over}><ErrorCircleRegular aria-hidden="true" /> {cap.over} over</Caption1> : null}
      {/* Capacity isn't doubled: say so where the number is (the menu toggles it). */}
      {!cap.over && !capacity.catalyst ? <Caption1 className={styles.meterLabel} data-testid="catalyst-off">No Catalyst</Caption1> : null}
      <span className={styles.grow} />
      {/* Auto build's one quiet entry point (docs/declutter-spec.md 4), next to the build mechanics. The tools are one
          toolbar: one tab stop, arrow keys between them. */}
      <Toolbar aria-label="Build tools" size="small" className={styles.tools} data-testid="build-tools">
        <AutoBuildButton />
        <AutoFormaButton />
        <RivenToolsButton />
        <CapacityMenu />
      </Toolbar>
    </div>
  );
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

/**
 * The slots: slots 1-4 then Arcane, slots 5-8 then Exilus (a kitgun's second arcane beside the first). Narrow stacked
 * layouts put Arcane and Exilus on a row above the slots.
 */
function Slots({ size, picking }) {
  const styles = useStyles();
  const selected = useApp(s => s.selectedSlot);
  const weaponName = useApp(s => s.build?.weaponName);
  const weapon = useApp(s => s.ctx?.weaponByName.get(weaponName));
  const twoArcanes = arcaneSlotCount(weapon) > 1;
  // One Tab stop for the slot group: the slot last focused (else the selected one, else slot 1).
  const [rove, setRove] = useState(null);
  // A slot chosen without focusing it (Ctrl+1-9, a stat row's target) becomes the group's tab stop too, so Tab and
  // Shift+Tab from the Picker reach it.
  useEffect(() => { if (selected != null) setRove(selected); }, [selected]);
  const current = rove ?? selected ?? 0;
  const onFocusSlot = e => {
    // Only the slot buttons move the tab stop: a control inside a slot (the arcane's stacks) is its own stop, and
    // moving the slot stop to it would leave Tab with no way into the slots.
    if (!e.target.matches?.('[data-slot-button]')) return;
    const el = e.target.closest?.('[data-slot]');
    if (!el) return;
    const v = el.dataset.slot;
    setRove(v === 'arcane' ? ARCANE_SLOT : v === 'arcane-1' ? KITGUN_ARCANE_SLOT : Number(v));
  };
  // Esc on a slot while picking goes back to rest (a pick-up's own Esc is handled by the slot first).
  const onKeyDown = e => {
    if (e.key === 'Escape' && !e.defaultPrevented && store.get().pickerOpen && !store.get().pickup) {
      e.preventDefault();
      actions.closePicker({ focus: false });
      return;
    }
    moveBetweenSlots(e);
  };
  const w = { width: size.width };
  const mod = i => <div key={i} style={w}><ModSlot slot={i} width={size.width} height={size.height} tabbable={current === i} /></div>;
  const exilus = <div key="exilus" style={w}><ModSlot slot={EXILUS_SLOT} width={size.width} height={size.height} caption="Exilus" tabbable={current === EXILUS_SLOT} /></div>;
  const arcane = <div key="arcane" style={w}><ArcaneSlot width={size.width} height={size.height} tabbable={current === ARCANE_SLOT} /></div>;
  const arcane2 = twoArcanes ? <div key="arcane-1" style={w}><ArcaneSlot index={1} width={size.width} height={size.height} tabbable={current === KITGUN_ARCANE_SLOT} /></div> : null;
  const side = size.columns >= 5;
  const columns = side ? 5 + (twoArcanes ? 1 : 0) : size.columns;
  let children;
  if (side) {
    children = [...[0, 1, 2, 3].map(mod), arcane, arcane2, ...[4, 5, 6, 7].map(mod), exilus, twoArcanes ? <div key="gap" aria-hidden="true" /> : null];
  } else {
    const special = twoArcanes ? 3 : 2;
    const rest = (columns - (special % columns)) % columns;
    children = [arcane, arcane2, exilus, rest ? <div key="gap" style={{ gridColumn: `span ${rest}` }} aria-hidden="true" /> : null, ...[0, 1, 2, 3, 4, 5, 6, 7].map(mod)];
  }
  return (
    <div role="group" aria-label="Mod slots" onKeyDown={onKeyDown} onFocus={onFocusSlot} data-testid="slots" data-layout={picking ? 'strip' : 'grid'}>
      <div className={styles.slots} style={{ gridTemplateColumns: `repeat(${columns}, ${size.width}px)` }}>{children}</div>
    </div>
  );
}

/**
 * The Loadout's upper part. `width` and `height` are the Loadout column's size (the Picker below takes the rest).
 */
export function Loadout({ layout, width, height }) {
  const styles = useStyles();
  const picking = useApp(s => s.pickerOpen);
  const g = layout.gutter;
  const size = slotSizeFor({ width: width || 800, height: height || layout.body, gutter: g, picking, stacked: layout.stacked });
  // While picking, capacity joins the weapon's line when there is room for both (it saves a row for the cards).
  const oneLine = picking && (width || 800) >= 780;
  return (
    <section
      className={styles.loadout}
      style={{ padding: `${g}px ${g}px ${picking ? 12 : 16}px`, gap: picking ? 12 : layout.compactHeight ? 10 : 14 }}
      data-pane="loadout"
      aria-label="Loadout"
    >
      <Notices collapse={layout.compactHeight || picking} />
      <div className={styles.header}>
        <WeaponPicker />
        <FireMode />
        <WeaponOptions />
        {oneLine ? <CapacityMeter compact /> : <span className={styles.spacer} />}
      </div>
      {oneLine ? null : <CapacityMeter />}
      <Slots size={size} picking={picking} />
    </section>
  );
}
