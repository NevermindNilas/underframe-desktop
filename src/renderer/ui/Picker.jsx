// The Picker (docs/declutter-spec.md 1.1): the lower area of the Loadout. Its search bar is always there (at rest it
// is the one line "Add or swap mods"; typing in it starts picking, and it keeps its element so no keystroke is
// lost). While picking it adds the Mods | Arcanes | Best for slot N tabs, Filters, the count and Done, a line saying
// where a card goes, and the virtualised card grid (keyboard navigation, context menu, drag and drop) replaces the
// rest view passed as children ("Why this DPS"). The details flyout opens only when asked for (Alt+Enter, the card's
// ⋯, the context menu), never on hover or focus. The remove zone covers the whole area while a slot is dragged.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Body1, Body1Strong, Button, Caption1, Caption1Strong, CounterBadge, Divider, Dropdown, Field, Link, Menu, MenuItem,
  MenuItemCheckbox, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody, Option,
  Popover, PopoverSurface, PopoverTrigger, Portal, ProgressBar, SearchBox, Spinner, Subtitle2, Switch, Tab, TabList, Table, TableBody, TableCell,
  TableHeader, TableHeaderCell, TableRow, Tag, TagGroup, Tooltip,
  makeStyles, mergeClasses, tokens, useAnnounce,
} from '@fluentui/react-components';
import {
  ChevronDownRegular, CopyRegular, DeleteRegular, DismissRegular, FilterRegular, InfoRegular, ProhibitedRegular, SparkleRegular,
} from '@fluentui/react-icons';

import { actions, announce, derived, focusLater, slotFocusId, store } from '../controller.js';
import { useApp, useDebounced, useDerived, useElementSize, useScrollState } from '../hooks.js';
import { pickerCardSize, gridWindow, CARD_GAP } from '../layout.js';
import { GALLERY_SIZES } from '../controller.js';
import { previewMode, previewSummary, sheetRows } from '../sheet.js';
import { polarityDisplayName } from '../../shared/card-assets.js';
import {
  EXILUS_SLOT, SLOT_COUNT, arcaneFocusId, arcaneIndexOf, buildCapacity, isArcaneSlot, slotLabel, swapSlots, sweepKeyOf, sweepView,
} from '../model.js';
import { galleryView } from '../gallery-model.js';
import { EFFECT_CATEGORIES, maxRank, modEffects } from '../../shared/mods.js';
import { slotDrain } from '../../shared/capacity.js';
import { indexArcanes } from '../../shared/arcanes.js';
import { POLARITY_LABELS, RARITIES, removeToken, replaceWord } from '../../shared/mod-search.js';
import { fmtInt, fmtSignedPct } from '../format.js';
import { ARCANE_MIME, MOD_MIME } from '../dnd.js';
import { hasNoStats, unmodeledStats } from './common.jsx';
import { GalleryCard, COMPAT_LABELS, fitFor } from './GalleryCard.jsx';
import { RivenPickerRow } from './RivenPickerRow.jsx';
import { ArtImage, PolarityGlyph, polarityName, useCards, useTextCards } from './art.jsx';

const GAP = CARD_GAP;
const SORTS = { match: 'Best match', name: 'Name (A-Z)', drain: 'Drain (low to high)', rarity: 'Rarity', gain: 'DPS gain' };
const POL_MENU = ['AP_ATTACK', 'AP_DEFENSE', 'AP_TACTIC', 'AP_POWER', 'AP_WARD', 'AP_PRECEPT', 'AP_UMBRA', 'AP_UNIVERSAL'];
/** How long the pointer may be off the cards before the If equipped column goes back to Change (no flicker). */
const PREVIEW_CLEAR_MS = 160;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
  },
  bar: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0, minHeight: '36px', flexShrink: 0 },
  search: { flexGrow: 1, minWidth: '160px', maxWidth: 'none' },
  sort: { minWidth: '170px' },
  count: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  // "Slot 3 · Madurai · replacing Point Strike": where a card goes, on its own line so it is never cut off.
  target: { display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0, minHeight: '20px', paddingTop: '6px', flexShrink: 0 },
  targetMain: { color: tokens.colorNeutralForeground1, whiteSpace: 'nowrap', flexShrink: 0 },
  targetNote: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  tabs: { flexShrink: 0 },
  filtersPopover: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, width: '300px' },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  tags: { display: 'flex', gap: '4px', flexWrap: 'wrap', minWidth: 0 },
  body: { position: 'relative', flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', outlineStyle: 'none' },
  rest: { position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  bodyStacked: { overflowY: 'visible' },
  messages: { display: 'flex', flexDirection: 'column', gap: '6px', ':not(:empty)': { paddingBottom: '8px' } },
  hint: { color: tokens.colorNeutralForeground2 },
  grid: { position: 'relative' },
  rowEl: { display: 'flex', gap: `${GAP}px`, position: 'absolute', left: 0, right: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '16px 0' },
  emptyActions: { display: 'flex', gap: '8px' },
  removeZone: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: `2px dashed ${tokens.colorStatusDangerBorder1}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
  },
  removeZoneOver: { backgroundColor: tokens.colorStatusDangerBackground1 },
  flyout: {
    position: 'fixed',
    zIndex: 1000,
    width: 'min(360px, 90vw)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '70vh',
    overflowY: 'auto',
    padding: '12px 16px',
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorTransparentStroke}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow16,
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  flyoutMeta: { color: tokens.colorNeutralForeground2 },
  num: { fontVariantNumeric: 'tabular-nums' },
  bestHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingBottom: '8px' },
  grow: { flexGrow: 1, minWidth: '160px' },
  arcaneFlyoutArt: { width: '100%', height: '120px', backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium, overflow: 'hidden' },
});

/** Search, filters and the current results, shared by the bar and the grid. */
function useGallery() {
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const gallery = useApp(s => s.gallery);
  const selectedSlot = useApp(s => s.selectedSlot);
  const sweep = useApp(s => s.sweep);
  const { capacity } = useDerived();
  const view = useMemo(() => galleryView({
    ctx, build, gallery, selectedSlot, sweep, polarities: capacity?.polarities,
    partial: name => unmodeledStats(ctx, name), engineOnly: name => hasNoStats(ctx, name),
  }), [ctx, build, gallery, selectedSlot, sweep, capacity]);
  return { ctx, build, gallery, selectedSlot, sweep, view, capacity };
}

function focusSearch() {
  document.querySelector('[data-testid="gallery-search"] input, input[data-testid="gallery-search"]')?.focus();
}

/** Close the Picker from inside it: focus returns to the slot it was opened for (else stays in the search bar). */
function closeFromPicker() {
  actions.closePicker({ focus: true });
}

// ---------- the bar ----------

/** Effect, Polarity, Rarity, Fits, Hide equipped, Sort, card size and text cards: one popover (spec 1.1). */
function FiltersPopover({ gallery, view, count }) {
  const styles = useStyles();
  const weaponName = useApp(s => s.build.weaponName);
  const size = useApp(s => s.ui.galleryCardSize);
  const textCards = useApp(s => s.ui.textCards);
  const isArcanes = gallery.tab === 'arcanes';
  const tab = view.tab;
  const filters = gallery.effects.length + gallery.pols.length + gallery.rarities.length + (gallery.hideEquipped ? 0 : 1) + (gallery.fits ? 0 : 1) + (gallery.sort !== 'match' ? 1 : 0);
  const menu = (key, label, options, testId) => (
    <Menu checkedValues={{ [key]: gallery[key] }} onCheckedValueChange={(_e, d) => actions.setGallery({ [key]: d.checkedItems })}>
      <MenuTrigger disableButtonEnhancement>
        <Button size="small" data-testid={testId} icon={<ChevronDownRegular />} iconPosition="after">{label}{gallery[key].length ? ` (${gallery[key].length})` : ''}</Button>
      </MenuTrigger>
      <MenuPopover><MenuList>{options.map(([value, text, icon]) => <MenuItemCheckbox key={value} name={key} value={value} icon={icon}>{text}</MenuItemCheckbox>)}</MenuList></MenuPopover>
    </Menu>
  );
  return (
    <Popover withArrow positioning="below-end" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={<FilterRegular />}
          data-testid="gallery-filters"
          aria-label={filters ? `Filters, ${filters} changed` : 'Filters'}
        >
          Filters{filters ? <CounterBadge count={filters} size="small" appearance="ghost" color="informative" style={{ marginLeft: 4 }} /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={styles.filtersPopover} aria-label="Filters">
        {isArcanes ? null : (
          <div className={styles.filterRow}>
            {menu('effects', 'Effect', EFFECT_CATEGORIES.map(c => [c, c]), 'gallery-chip-effect')}
            {menu('pols', 'Polarity', POL_MENU.map(p => [p, POLARITY_LABELS[p], <PolarityGlyph key={p} code={p} size={16} />]), 'gallery-chip-polarity')}
            {menu('rarities', 'Rarity', RARITIES.map(r => [r, r.charAt(0).toUpperCase() + r.slice(1)]), 'gallery-chip-rarity')}
          </div>
        )}
        <Switch label={`Only cards that fit ${weaponName}`} checked={gallery.fits} onChange={(_e, d) => actions.setGallery({ fits: d.checked })} data-testid="gallery-chip-fits" />
        <Switch label="Hide equipped cards" checked={gallery.hideEquipped} onChange={(_e, d) => actions.setGallery({ hideEquipped: d.checked })} data-testid="gallery-chip-hide-equipped" />
        <Field label="Sort" size="small">
          <Dropdown
            size="small"
            className={styles.sort}
            data-testid="gallery-sort"
            value={SORTS[tab === 'best' ? 'gain' : gallery.sort]}
            selectedOptions={[tab === 'best' ? 'gain' : gallery.sort]}
            disabled={tab === 'best'}
            onOptionSelect={(_e, d) => actions.setGallery({ sort: d.optionValue })}
            inlinePopup
          >
            {Object.entries(SORTS).map(([k, v]) => (
              <Option key={k} value={k} text={v} disabled={k === 'gain' && !view.sortGainEnabled}>
                {k === 'gain' && !view.sortGainEnabled ? 'DPS gain (run Find best mod first)' : v}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Card size" size="small">
          <Dropdown size="small" value={{ auto: 'Automatic', small: 'Small', medium: 'Medium', large: 'Large' }[size ?? 'auto']} selectedOptions={[size ?? 'auto']} onOptionSelect={(_e, d) => actions.setGalleryCardSize(d.optionValue === 'auto' ? null : d.optionValue)} data-testid="gallery-size" inlinePopup>
            <Option value="auto">Automatic</Option>
            <Option value="small">Small</Option>
            <Option value="medium">Medium</Option>
            <Option value="large">Large</Option>
          </Dropdown>
        </Field>
        <Switch label="Text cards instead of card images" checked={textCards} onChange={(_e, d) => actions.setTextCards(d.checked)} />
        <Divider />
        <Caption1 className={styles.count}>{count} {isArcanes ? 'arcanes' : 'mods'} shown{filters ? '' : ' · default filters'}</Caption1>
        {filters ? <Link as="button" onClick={() => actions.clearGalleryFilters()} style={{ alignSelf: 'flex-start' }}>Reset filters</Link> : null}
      </PopoverSurface>
    </Popover>
  );
}

/** Non-default filters and typed operators, as removable tags (at the top of the card grid). */
function FilterTags({ view, gallery }) {
  const styles = useStyles();
  const tags = [];
  if (view.exilusScoped) tags.push({ id: 'exilus-scope', label: 'Exilus slot · showing Exilus mods', fixed: true });
  for (const t of view.parsed.tokens) {
    if ((t.kind === 'filter' || t.kind === 'neg' || t.kind === 'phrase') && t.trailing) tags.push({ id: `q:${t.start}`, label: t.label, token: t });
  }
  for (const e of gallery.effects) tags.push({ id: `effect:${e}`, label: `Effect: ${e}`, menu: ['effects', e] });
  for (const p of gallery.pols) tags.push({ id: `pol:${p}`, label: `Polarity: ${POLARITY_LABELS[p]}`, menu: ['pols', p] });
  for (const r of gallery.rarities) tags.push({ id: `rarity:${r}`, label: `Rarity: ${r.charAt(0).toUpperCase()}${r.slice(1)}`, menu: ['rarities', r] });
  if (!gallery.hideEquipped) tags.push({ id: 'show-equipped', label: 'Showing equipped', set: { hideEquipped: true } });
  if (!gallery.fits) tags.push({ id: 'all-weapons', label: 'All weapons', set: { fits: true } });
  if (!tags.length) return null;
  const dismiss = id => {
    const t = tags.find(x => x.id === id);
    if (!t || t.fixed) return;
    if (t.token) actions.setGalleryQuery(removeToken(store.get().gallery.query, t.token));
    else if (t.set) actions.setGallery(t.set);
    else if (t.menu) {
      const [key, value] = t.menu;
      actions.setGallery({ [key]: store.get().gallery[key].filter(v => v !== value) });
    }
  };
  return (
    <TagGroup size="small" onDismiss={(_e, d) => dismiss(d.value)} aria-label="Active filters" className={styles.tags}>
      {tags.map(t => (
        <Tag key={t.id} value={t.id} size="small" dismissible={!t.fixed} data-testid={`gallery-chip-${t.id.replace(/[^a-z0-9]+/gi, '-')}`} appearance="outline">
          {t.label}
        </Tag>
      ))}
    </TagGroup>
  );
}

/** The search box's placeholder: short, so it fits at any width; where a card goes is the target line's job. */
function placeholderFor({ open, tab }) {
  if (!open) return 'Add or swap mods (Ctrl+F)';
  return tab === 'arcanes' ? 'Search arcanes' : 'Search mods: name, effect, cc, drain<=6';
}

/**
 * Where a card goes, as its own line above the cards (spec 1.1): "Slot 3 · Madurai · replacing Point Strike". When the
 * Picker chose the slot itself (a full build, opened from a stat row, Ctrl+F or typing), it says so and how to change it.
 */
function TargetLine({ view }) {
  const styles = useStyles();
  const build = useApp(s => s.build);
  const auto = useApp(s => s.pickerAuto);
  const selected = useApp(s => s.selectedSlot);
  const { capacity } = useDerived();
  if (view.tab === 'best') return null;
  const slot = view.targetSlot;
  let main;
  let note = null;
  if (view.tab === 'arcanes') {
    const i = Math.max(0, arcaneIndexOf(slot));
    const now = build.arcanes?.[i]?.name;
    main = `${i === 1 ? 'Kitgun arcane slot' : 'Arcane slot'}${now ? ` · replacing ${now}` : ''}`;
  } else if (Number.isInteger(slot)) {
    const pol = polarityDisplayName(capacity?.polarities?.[slot]);
    const now = build.mods[slot]?.name;
    main = [slot === EXILUS_SLOT ? 'Exilus slot' : `Slot ${slot + 1}`, pol, now ? `replacing ${now}` : null].filter(Boolean).join(' · ');
    if (auto) note = '· it adds the least damage on paper. Click another slot to change.';
    else if (selected == null) note = '· the first empty slot. Click a slot to choose another.';
  } else {
    main = 'Choose a slot for the card';
  }
  return (
    <div className={styles.target} data-testid="picker-target" id="picker-target">
      <Caption1Strong className={styles.targetMain}>{main}</Caption1Strong>
      {note ? <Caption1 className={styles.targetNote} title={note}>{note}</Caption1> : null}
    </div>
  );
}

/** The bar: the search alone at rest; tabs, search, Filters, count and Done while picking. */
function PickerBar({ view, gallery, open, count }) {
  const styles = useStyles();
  const sweep = useApp(s => s.sweep);
  const sweepRunning = sweep?.status === 'running';
  const { announce: speak } = useAnnounce();
  const settledCount = useDebounced(`${count}|${gallery.query}|${gallery.tab}|${open}`, 600);
  const lastSpoken = useRef('');
  useEffect(() => {
    const [n, , , isOpen] = settledCount.split('|');
    if (isOpen !== 'true') { lastSpoken.current = ''; return; }
    if (lastSpoken.current === settledCount) return;
    lastSpoken.current = settledCount;
    const noun = gallery.tab === 'arcanes' ? 'arcanes' : 'mods';
    speak(Number(n) ? `${n} ${noun}` : `No ${noun} match`, { polite: true });
  }, [settledCount, gallery.tab, speak]);

  const tab = view.tab;
  const isArcanes = tab === 'arcanes';
  const noun = isArcanes ? (count === 1 ? 'arcane' : 'arcanes') : count === 1 ? 'mod' : 'mods';
  const bestLabel = sweep ? `Best for ${sweep.slot === EXILUS_SLOT ? 'Exilus' : `slot ${sweep.slot + 1}`}${sweepRunning ? ` ${sweep.done}/${sweep.total}` : ''}` : '';
  const onSearchKey = e => {
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      document.querySelector('[data-testid="gallery"] [role="gridcell"] button')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) { actions.openPicker(); return; }
      const first = view.items.find(i => i.state !== 'blocked' && i.state !== 'equipped') ?? view.items.find(i => i.state !== 'blocked');
      if (!first) return;
      if (first.kind === 'arcane') actions.equipArcane(first.name, Math.max(0, arcaneIndexOf(view.targetSlot)));
      else if (tab === 'best') actions.equipBest(first.name);
      else actions.equipFromGallery(first.name);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      closeFromPicker();
    }
  };
  return (
    <div className={styles.bar} data-testid="picker-bar">
      {open ? (
        <TabList className={styles.tabs} size="small" selectedValue={tab} onTabSelect={(_e, d) => actions.setGalleryTab(d.value)} aria-label="Picker">
          <Tab value="mods" data-testid="gallery-tab-mods">Mods</Tab>
          <Tab value="arcanes" data-testid="gallery-tab-arcanes">Arcanes</Tab>
          {sweep ? (
            <Tab value="best" data-testid="gallery-tab-best" icon={sweepRunning ? <Spinner size="extra-tiny" aria-hidden="true" /> : <SparkleRegular />}>{bestLabel}</Tab>
          ) : null}
        </TabList>
      ) : null}
      <SearchBox
        className={styles.search}
        input={{ 'data-testid': 'gallery-search', 'data-focus-id': 'gallery-search' }}
        placeholder={placeholderFor({ open, tab })}
        aria-label={isArcanes && open ? 'Search arcanes' : 'Search mods'}
        aria-describedby={open && tab !== 'best' ? 'picker-target' : undefined}
        aria-expanded={open}
        aria-controls={open ? 'picker-grid' : undefined}
        value={gallery.query}
        onChange={(_e, d) => actions.setGalleryQuery(d.value)}
        onKeyDown={onSearchKey}
      />
      {open ? (
        <>
          <FiltersPopover gallery={gallery} view={view} count={count} />
          <RivenPickerRow view={view} />
          <Caption1 className={styles.count} role="status" aria-live="off" data-testid="gallery-count">
            {count ? `${count} ${noun}` : `No ${isArcanes ? 'arcanes' : 'mods'}`}
          </Caption1>
          <Tooltip content="Done (Esc)" relationship="description">
            <Button appearance="subtle" onClick={closeFromPicker} data-testid="picker-done">Done</Button>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

// ---------- best mod view header (5.6) ----------

function BestHeader() {
  const styles = useStyles();
  const sweep = useApp(s => s.sweep);
  const build = useApp(s => s.build);
  const ctx = useApp(s => s.ctx);
  if (!sweep) return null;
  const label = slotLabel(sweep.slot).toLowerCase();
  const running = sweep.status === 'running';
  const stale = !running && sweep.key !== sweepKeyOf(ctx, build, sweep.slot);
  const { base } = sweepView(sweep, build.mods[sweep.slot]?.name ?? null);
  // Gains only, no second DPS number next to the Readout's: the search is a quick 3-run estimate at max rank, the
  // Readout averages 8 runs at the ranks you set, so the two would differ.
  const against = base.dps == null ? '' : base.kind === 'mod' ? `Gains against ${base.name} at max rank` : 'Gains against the slot left empty';
  const baselineTip = base.dps == null ? null : `Quick estimate: 3 seeded runs per mod at max rank (baseline ${fmtInt(base.dps)} DPS). The Readout averages 8 runs at your ranks, so its number differs.`;
  return (
    <div className={styles.messages}>
      <div className={styles.bestHead}>
        {running ? (
          <>
            <div className={styles.grow}>
              <Caption1>Testing {sweep.done} of {sweep.total} mods for {label}</Caption1>
              <ProgressBar value={sweep.total ? sweep.done / sweep.total : 0} thickness="medium" aria-label={`Testing ${sweep.done} of ${sweep.total} mods`} />
            </div>
            <Button size="small" onClick={() => actions.cancelSweep()}>Cancel</Button>
          </>
        ) : (
          <>
            <Body1Strong>Best mod for {label}</Body1Strong>
            {against ? (
              <Tooltip content={baselineTip} relationship="description">
                <Caption1 className={styles.hint} tabIndex={-1} data-testid="best-baseline">{against} · quick estimate</Caption1>
              </Tooltip>
            ) : null}
            <span style={{ flexGrow: 1 }} />
            <Button size="small" onClick={() => actions.startSweep(sweep.slot)}>Run again</Button>
            <Tooltip content="Close results" relationship="label">
              <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={() => actions.dismissSweep()} />
            </Tooltip>
          </>
        )}
      </div>
      {sweep.status === 'cancelled' ? <Caption1>Cancelled after {sweep.done} of {sweep.total} mods. Showing partial results.</Caption1> : null}
      {sweep.status === 'error' ? (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>Couldn't finish the best-mod search. {sweep.error}</MessageBarBody>
          <MessageBarActions><Button size="small" onClick={() => actions.startSweep(sweep.slot)}>Try again</Button></MessageBarActions>
        </MessageBar>
      ) : null}
      {stale && sweep.status !== 'error' ? (
        <MessageBar intent="warning" layout="singleline">
          <MessageBarBody>Your build changed after this search. Gains may be out of date.</MessageBarBody>
          <MessageBarActions><Button size="small" onClick={() => actions.startSweep(sweep.slot)}>Run again</Button></MessageBarActions>
        </MessageBar>
      ) : null}
      {sweep.total === 0 && !running ? <Caption1>No compatible mods to test for this slot.</Caption1> : null}
    </div>
  );
}

// ---------- details flyout (5.4) ----------

function rankRows(max) {
  if (max <= 5) return Array.from({ length: max + 1 }, (_, i) => i);
  return [...new Set([0, 1, Math.round(max / 2), max])];
}

function ModDetails({ item }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const { capacity } = useDerived();
  const target = useGalleryTarget();
  const [all, setAll] = useState(false);
  const mod = item.mod;
  const max = maxRank(mod);
  const base = Number(mod['Base Drain']) || 0;
  const pol = polarityName(mod.Polarity);
  const slotPol = Number.isInteger(target) ? capacity?.polarities?.[target] : null;
  const ranks = all ? Array.from({ length: max + 1 }, (_, i) => i) : rankRows(max);
  const partial = unmodeledStats(ctx, item.name);
  const noStats = hasNoStats(ctx, item.name);
  const selected = useApp(s => s.selectedSlot);
  const tab = useApp(s => s.gallery.tab);
  // An equipped mod isn't added again: it says where it is, or (with another slot selected) what moving it does.
  const from = item.state === 'equipped' && Number.isInteger(item.slot) ? item.slot : null;
  const where = slot => (slot === EXILUS_SLOT ? 'the Exilus slot' : slotLabel(slot).toLowerCase());
  let capacityText = null;
  if (from != null) {
    const moveTo = tab !== 'best' && Number.isInteger(selected) && selected >= 0 && selected < SLOT_COUNT && selected !== from ? selected : null;
    const moved = moveTo != null ? swapSlots(ctx, build, from, moveTo) : build;
    if (moved !== build) {
      const c = buildCapacity(ctx, moved);
      capacityText = `Moving it to ${where(moveTo)}: ${capacity.used} → ${c.used} / ${c.capacity}${c.used > c.capacity ? ` (${c.used - c.capacity} over)` : ''}`;
    } else capacityText = `Equipped in ${where(from)} · drain ${capacity.perSlot[from]?.drain ?? slotDrain(mod, max, null).drain}`;
  }
  const use = from == null && Number.isInteger(target) ? slotDrain(mod, max, slotPol) : null;
  const without = Number.isInteger(target) ? capacity.used - (capacity.perSlot[target]?.drain ?? 0) : capacity.used;
  const after = use ? without + use.drain : null;
  if (use) capacityText = `Uses ${use.drain} → ${after} / ${capacity.capacity}${after > capacity.capacity ? ` (${after - capacity.capacity} over)` : ''}`;
  const effectsAt = r => modEffects(mod, r).join(', ') || '—';
  return (
    <>
      <Subtitle2 as="h3" style={{ margin: 0 }}>{item.name}</Subtitle2>
      <Caption1 className={styles.flyoutMeta}>
        {[item.entry.rarity.charAt(0).toUpperCase() + item.entry.rarity.slice(1), pol, `drain ${base}-${base + max}`, COMPAT_LABELS[mod['Compat Name']] ?? mod['Compat Name']].filter(Boolean).join(' · ')}
      </Caption1>
      {/* Near the top: on a short gallery the flyout scrolls, and this is what a click does to capacity. */}
      {capacityText ? <Caption1 className={styles.num} data-testid="flyout-capacity">{capacityText}</Caption1> : null}
      <Body1>{String(mod.Description ?? '').replace(/\r?\n/g, ' ') || 'No description in the data.'}</Body1>
      {modEffects(mod, max).length ? (
        <Table size="extra-small" aria-label={`${item.name} by rank`}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell style={{ width: 48 }}>Rank</TableHeaderCell>
              <TableHeaderCell style={{ width: 56 }}>Drain</TableHeaderCell>
              <TableHeaderCell>Effect</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranks.map(r => (
              <TableRow key={r}>
                <TableCell className={styles.num}>{r}</TableCell>
                <TableCell className={styles.num}>{slotDrain(mod, r, slotPol).drain}</TableCell>
                <TableCell>{effectsAt(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {!all && max > 5 ? <Link as="button" onClick={() => setAll(true)}>Show all ranks</Link> : null}
      {partial.length ? <MessageBar intent="warning" layout="multiline"><MessageBarBody>Partially simulated. Not modelled: {partial.join(', ')}.</MessageBarBody></MessageBar> : null}
      {noStats ? <MessageBar intent="info" layout="multiline"><MessageBarBody>Engine-only. This mod has no numeric stats in the data; its effect counts only if the engine models it itself.</MessageBarBody></MessageBar> : null}
      {item.reason ? <MessageBar intent="warning" layout="multiline" icon={<ProhibitedRegular />}><MessageBarBody>Can't equip: {item.reason}.</MessageBarBody></MessageBar> : null}
      {Number.isFinite(item.gain) ? <Caption1>{fmtSignedPct(item.gain)} DPS in {slotLabel(store.get().sweep?.slot ?? target).toLowerCase()} · best-mod search, 3 runs</Caption1> : null}
    </>
  );
}

function ArcaneDetails({ item }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const cards = useCards();
  const textCards = useTextCards();
  const a = item.arcane;
  const effect = indexArcanes(ctx.data).byName.get(a.name)?.effect ?? null;
  const url = !textCards ? cards?.arcaneUrl(a.name) : null;
  return (
    <>
      {url ? <div className={styles.arcaneFlyoutArt}><ArtImage src={url} fit="contain" /></div> : null}
      <Subtitle2 as="h3" style={{ margin: 0 }}>{a.name}</Subtitle2>
      <Caption1 className={styles.flyoutMeta}>Arcane · rank 0-{a.maxRank}{a.controls?.trigger ? ` · ${a.controls.trigger}` : ''}</Caption1>
      <Body1>{a.description}</Body1>
      {effect?.buffs?.length ? (
        <Table size="extra-small" aria-label={`${a.name} buffs`}>
          <TableHeader><TableRow><TableHeaderCell>Buff</TableHeaderCell><TableHeaderCell>Per stack</TableHeaderCell><TableHeaderCell>Max stacks</TableHeaderCell><TableHeaderCell>Duration</TableHeaderCell></TableRow></TableHeader>
          <TableBody>
            {effect.buffs.map((b, i) => (
              <TableRow key={i}>
                <TableCell>{b.type}</TableCell>
                <TableCell className={styles.num}>{Math.abs(b.value) < 5 ? `${Math.round(b.value * 1000) / 10}%` : b.value}</TableCell>
                <TableCell className={styles.num}>{b.max_stacks ?? 1}</TableCell>
                <TableCell className={styles.num}>{b.duration_seconds ? `${b.duration_seconds} s` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <Caption1>{a.support === 'none' ? `Not simulated. ${a.supportNote}` : a.controls?.stacks ? 'Simulated at the stacks you set (max by default).' : 'Simulated as always active.'}{a.support === 'partial' ? ` ${a.supportNote}` : ''}</Caption1>
      {item.reason ? <MessageBar intent="warning" layout="multiline" icon={<ProhibitedRegular />}><MessageBarBody>Can't equip: {item.reason}.</MessageBarBody></MessageBar> : null}
    </>
  );
}

/** The slot gallery cards equip into (for drain previews). */
function useGalleryTarget() {
  const tab = useApp(s => s.gallery.tab);
  const sweep = useApp(s => s.sweep);
  const selected = useApp(s => s.selectedSlot);
  const build = useApp(s => s.build);
  if (tab === 'best' && sweep) return sweep.slot;
  if (Number.isInteger(selected)) return selected;
  return [0, 1, 2, 3, 4, 5, 6, 7].find(i => !build.mods[i]) ?? null;
}

/**
 * The details flyout (5.4): placed after the card (else before it), non-modal, never takes focus.
 * A plain positioned layer in a Fluent portal, so it follows the card exactly in the virtualised grid.
 * It stays below the top of `bounds` (the card grid's scroll area), so it never covers the gallery's own search
 * box and filter buttons; when there is less room below, it scrolls inside.
 */
function Flyout({ target, bounds = null, label, onClose, onMouseEnter, onMouseLeave, children }) {
  const styles = useStyles();
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!target?.isConnected || !ref.current) return;
    const r = target.getBoundingClientRect();
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const gap = 10;
    let left = r.right + gap;
    if (left + w > window.innerWidth - 8) left = r.left - gap - w;
    if (left < 8) left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    const minTop = Math.max(8, bounds?.isConnected ? bounds.getBoundingClientRect().top : 8);
    const top = Math.max(minTop, Math.min(r.top, window.innerHeight - h - 8));
    const maxHeight = Math.max(120, window.innerHeight - top - 8);
    setPos(p => (p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { left, top, maxHeight }));
  });
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    // Asked for, so it stays until dismissed: Esc, a press anywhere else, or another card.
    const onDown = e => { if (!ref.current?.contains(e.target) && !target?.contains?.(e.target)) onClose(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose, target]);
  return (
    <Portal>
      <div
        ref={ref}
        className={styles.flyout}
        style={{ left: pos?.left ?? -10000, top: pos?.top ?? 0, maxHeight: pos?.maxHeight }}
        data-testid="mod-flyout"
        role="region"
        aria-label={label}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </div>
    </Portal>
  );
}

// ---------- drag images ----------

const dragImages = new Map();
/** A 160x80 drag image: the compact card (or a text plate), prepared when the pointer first reaches a card. */
function prepareDragImage(name, url) {
  if (dragImages.has(name)) return;
  const plate = () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, 0, 160, 80);
    g.strokeStyle = '#8a8a8a';
    g.strokeRect(0.5, 0.5, 159, 79);
    g.fillStyle = '#ffffff';
    g.font = '600 13px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name.length > 22 ? `${name.slice(0, 21)}…` : name, 80, 40, 150);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    return img;
  };
  dragImages.set(name, plate());
  if (!url) return;
  const src = new Image();
  src.onload = () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 80;
    c.getContext('2d').drawImage(src, 0, 0, 160, 80);
    const img = new Image();
    img.src = c.toDataURL('image/png');
    dragImages.set(name, img);
  };
  src.src = url;
}

/// ---------- the Picker ----------

/** The slot a card would go into for the stats preview (equipped and blocked cards preview nothing). */
function previewFor(item, view, sweep) {
  if (!item || item.state !== 'ok') return null;
  if (item.kind === 'arcane') return { kind: 'arcane', name: item.name, slot: view.targetSlot };
  const slot = view.tab === 'best' ? sweep?.slot : view.targetSlot;
  return Number.isInteger(slot) ? { kind: 'mod', name: item.name, slot } : null;
}

/**
 * The lower area of the Loadout. `children` is the rest view (Why this DPS). `scrollEl` is the stacked layout's
 * page scroll area (the grid then scrolls with the page).
 */
export function Picker({ layout, scrollEl = null, children }) {
  const styles = useStyles();
  const open = useApp(s => s.pickerOpen);
  const { ctx, gallery, view, capacity } = useGallery();
  const sweep = useApp(s => s.sweep);
  const drag = useApp(s => s.drag);
  const cards = useCards();
  const cardsReady = useApp(s => s.cards);
  const textCards = useTextCards();
  const sizePref = useApp(s => s.ui.galleryCardSize);
  const [bodyEl, setBodyEl] = useState(null);
  const [bodyRef, bodySize] = useElementSize();
  const scrollTarget = scrollEl ?? bodyEl;
  const { scrollTop, viewport } = useScrollState(open ? scrollTarget : null);
  const gridEl = useRef(null);
  const [offset, setOffset] = useState(0);
  // Three full rows when they fit (spec 2.2); the stacked layout scrolls, so it keeps a fixed size.
  const card = scrollEl
    ? pickerCardSize(bodySize.width || 600, 10000, sizePref ? GALLERY_SIZES[sizePref] : 132)
    : pickerCardSize(bodySize.width || 600, Math.max(0, (bodySize.height || 400) - 8 - layout.gutter), sizePref ? GALLERY_SIZES[sizePref] : null);
  const cardW = card.width;
  const cardH = card.height;
  const rowH = cardH + GAP;
  const columns = card.columns;
  const items = open ? view.items : [];
  const target = useGalleryTarget();
  const slotPol = Number.isInteger(target) ? capacity?.polarities?.[target] : null;

  // The grid's top inside the scroll content (messages above it; the stacked layout scrolls past the Loadout first).
  useEffect(() => {
    if (!scrollTarget || !gridEl.current) return;
    const s = scrollTarget.getBoundingClientRect();
    const g = gridEl.current.getBoundingClientRect();
    setOffset(Math.round(g.top - s.top + scrollTarget.scrollTop));
  });

  const win = gridWindow({ count: items.length, columns, rowHeight: rowH, scrollTop, viewport, offset, overscan: 2 });
  const [focusIndex, setFocusIndex] = useState(0);
  const focusName = useRef(null);
  const [flash, setFlash] = useState(null);
  const [flyout, setFlyout] = useState(null); // { item, el }
  const [menu, setMenu] = useState(null); // { item, el }
  const timers = useRef({});

  // Keep focus on the same card (by name) when the list re-filters.
  useEffect(() => {
    if (!focusName.current) return;
    const i = items.findIndex(x => x.name === focusName.current);
    if (i >= 0 && i !== focusIndex) setFocusIndex(i);
    else if (i < 0 && focusIndex >= items.length) setFocusIndex(Math.max(0, items.length - 1));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new picking session starts at the top.
  useEffect(() => {
    if (!open) return;
    setFocusIndex(0);
    focusName.current = null;
    if (bodyEl) bodyEl.scrollTop = 0;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRowIntoView = row => {
    if (!scrollTarget) return;
    const top = offset + row * rowH;
    const bottom = top + cardH;
    if (top < scrollTarget.scrollTop) scrollTarget.scrollTop = top - (scrollEl ? 64 : 0);
    else if (bottom > scrollTarget.scrollTop + scrollTarget.clientHeight) scrollTarget.scrollTop = bottom - scrollTarget.clientHeight + 4;
  };

  const focusCard = useCallback(i => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setFocusIndex(n);
    focusName.current = items[n]?.name ?? null;
    scrollRowIntoView(Math.floor(n / columns));
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector(`[data-testid="gallery"] [data-index="${n}"]`);
      if (el) el.focus();
      else if (++tries < 10) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [items, columns, scrollTarget, offset, rowH]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = item => {
    if (item.state === 'blocked') {
      announce(`${item.name}: ${item.reason}`);
      setFlash(item.name);
      clearTimeout(timers.current.flash);
      timers.current.flash = setTimeout(() => setFlash(null), 1000);
      return;
    }
    clearTimeout(timers.current.preview);
    actions.setPreview(null);
    if (item.kind === 'arcane') actions.equipArcane(item.name, Math.max(0, arcaneIndexOf(view.targetSlot)));
    else if (view.tab === 'best' && sweep) actions.equipBest(item.name);
    else actions.equipFromGallery(item.name);
  };

  // The stats sheet previews the card under the pointer or keyboard focus; focus also says it, after a pause.
  const showPreview = (item, { speak = false } = {}) => {
    clearTimeout(timers.current.preview);
    clearTimeout(timers.current.speak);
    const p = previewFor(item, view, sweep);
    actions.setPreview(p);
    if (speak && p) {
      timers.current.speak = setTimeout(() => {
        const { build } = store.get();
        const d = derived();
        const mode = d.stats?.mode;
        if (!mode || store.get().preview?.name !== p.name) return;
        announce(previewSummary(sheetRows(mode, d.baseMode, { hasReload: Boolean(d.stats.reload), preview: previewMode(ctx, build, p) })));
      }, 700);
    }
  };
  const clearPreview = () => {
    clearTimeout(timers.current.preview);
    clearTimeout(timers.current.speak);
    timers.current.preview = setTimeout(() => actions.setPreview(null), PREVIEW_CLEAR_MS);
  };

  // The flyout covers the cards beside it, so it opens only when asked for and gives way to the next card.
  // The pointer may cross a neighbouring card on its way into the flyout: another card closes it after a short grace.
  const openFlyout = (item, el) => { clearTimeout(timers.current.fly); setFlyout({ item, el }); };
  const leaveFlyoutFor = (item, { now = false } = {}) => {
    clearTimeout(timers.current.fly);
    const close = () => setFlyout(f => (f && f.item.name !== item.name ? null : f));
    if (now) close();
    else timers.current.fly = setTimeout(close, 250);
  };
  const closeFlyoutNow = useCallback(() => setFlyout(null), []);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  // The flyout follows the data (a re-render with new items): drop it when its card is gone.
  useEffect(() => { if (flyout && !items.some(i => i.name === flyout.item.name)) setFlyout(null); }, [items]); // eslint-disable-line
  useEffect(() => { if (!open) { setFlyout(null); setMenu(null); } }, [open]);

  const onGridKey = e => {
    const i = Number(e.target?.dataset?.index);
    if (!Number.isFinite(i)) return;
    const item = items[i];
    const rowStart = i - (i % columns);
    const visibleRows = Math.max(1, Math.floor((scrollTarget?.clientHeight ?? rowH) / rowH));
    const k = e.key;
    if (k === 'ArrowRight') { e.preventDefault(); focusCard(i + 1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); focusCard(i - 1); }
    else if (k === 'ArrowDown') { e.preventDefault(); focusCard(i + columns); }
    else if (k === 'ArrowUp') {
      e.preventDefault();
      if (i < columns) focusSearch();
      else focusCard(i - columns);
    } else if (k === 'Home') { e.preventDefault(); focusCard(e.ctrlKey ? 0 : rowStart); }
    else if (k === 'End') { e.preventDefault(); focusCard(e.ctrlKey ? items.length - 1 : Math.min(items.length - 1, rowStart + columns - 1)); }
    else if (k === 'PageDown') { e.preventDefault(); focusCard(i + visibleRows * columns); }
    else if (k === 'PageUp') { e.preventDefault(); focusCard(i - visibleRows * columns); }
    else if (k === 'Enter' && e.altKey) { e.preventDefault(); setFlyout({ item, el: e.target }); }
    else if (k === 'Enter') { e.preventDefault(); activate(item); }
    else if (k === ' ') {
      e.preventDefault();
      if (item.state !== 'blocked') actions.startPickup({ kind: item.kind, name: item.name, from: item.kind === 'mod' && item.slot != null ? item.slot : 'gallery', target: item.kind === 'arcane' ? view.targetSlot : undefined });
      else activate(item);
    } else if (k === 'Escape') {
      e.preventDefault();
      if (flyout) { setFlyout(null); return; }
      closeFromPicker();
    } else if ((e.shiftKey && k === 'F10') || k === 'ContextMenu') {
      e.preventDefault();
      setMenu({ item, el: e.target });
    } else if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      actions.setGalleryQuery(store.get().gallery.query + k);
      focusSearch();
    }
  };

  const handlersFor = (item, i) => ({
    onClick: () => activate(item),
    onFocus: e => {
      setFocusIndex(i);
      focusName.current = item.name;
      leaveFlyoutFor(item, { now: true });
      showPreview(item, { speak: e.target.matches(':focus-visible') });
    },
    onBlur: () => { clearPreview(); },
    onMouseEnter: () => {
      prepareDragImage(item.name, item.kind === 'mod' && !textCards ? cards?.modCompactUrl(item.name) : !textCards ? cards?.arcaneUrl(item.name) : null);
      leaveFlyoutFor(item);
      showPreview(item);
    },
    onMouseLeave: () => { clearPreview(); },
    onContextMenu: e => { e.preventDefault(); setFlyout(null); setMenu({ item, el: e.currentTarget }); },
    onDragStart: e => {
      if (item.state === 'blocked') { e.preventDefault(); return; }
      setFlyout(null);
      const from = item.kind === 'mod' && item.slot != null ? item.slot : 'gallery';
      e.dataTransfer.setData(item.kind === 'arcane' ? ARCANE_MIME : MOD_MIME, JSON.stringify({ name: item.name, from }));
      e.dataTransfer.setData('text/plain', item.name);
      e.dataTransfer.effectAllowed = 'move';
      const img = dragImages.get(item.name);
      if (img?.complete) e.dataTransfer.setDragImage(img, 80, 40);
      setTimeout(() => actions.setDrag({ kind: item.kind, name: item.name, from }), 0);
    },
    onDragEnd: () => actions.setDrag(null),
  });

  const rows = [];
  for (let r = win.first; r <= win.last; r++) {
    const cells = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      const item = items[i];
      if (!item) break;
      const url = item.kind === 'mod' ? cards?.modFullUrl(item.name) : cards?.arcaneUrl(item.name);
      cells.push(
        <div key={item.name} role="gridcell" aria-colindex={c + 1} style={{ width: cardW, height: cardH }}>
          <GalleryCard
            item={item}
            index={i}
            width={cardW}
            height={cardH}
            textCards={textCards}
            imageUrl={url}
            fit={item.kind === 'mod' ? fitFor(item.mod, slotPol) : null}
            partial={item.kind === 'mod' ? unmodeledStats(ctx, item.name) : null}
            engineOnly={item.kind === 'mod' ? hasNoStats(ctx, item.name) : false}
            tabIndex={i === Math.min(focusIndex, items.length - 1) ? 0 : -1}
            flash={flash === item.name}
            handlers={handlersFor(item, i)}
            onDetails={el => openFlyout(item, el)}
          />
        </div>,
      );
    }
    rows.push(<div key={r} role="row" aria-rowindex={r + 1} className={styles.rowEl} style={{ top: r * rowH, height: cardH }}>{cells}</div>);
  }

  const dragFromSlot = drag && (Number.isInteger(drag.from) || isArcaneSlot(drag.from));
  const [overRemove, setOverRemove] = useState(false);
  const removeName = drag?.name;

  const query = gallery.query.trim();
  const isArcanes = view.tab === 'arcanes';
  const noun = isArcanes ? 'arcanes' : 'mods';
  const hasFilters = gallery.effects.length + gallery.pols.length + gallery.rarities.length > 0 || !gallery.hideEquipped || !gallery.fits;
  const messages = (
    <div className={styles.messages}>
      {view.tab === 'best' ? <BestHeader /> : null}
      <FilterTags view={view} gallery={gallery} />
      {cardsReady && !cardsReady.available ? <Caption1 className={styles.hint}>Card images aren't installed: showing text cards.</Caption1> : null}
      {view.unknown.map(u => (
        <Caption1 key={u.raw} className={styles.hint}>
          {u.message ?? `Unknown filter "${u.key}".`}
          {u.suggestion ? <> Did you mean <Link as="button" onClick={() => actions.setGalleryQuery(gallery.query.replace(u.key, u.suggestion))}>{u.suggestion}</Link>?</> : null}
        </Caption1>
      ))}
      {view.hints.map(h => <Caption1 key={h} className={styles.hint}><InfoRegular aria-hidden="true" /> {h}</Caption1>)}
      {view.suggestions.length && items.length ? (
        <Caption1 className={styles.hint}>
          Did you mean {view.suggestions.map((s, i) => (
            <span key={s.word}>{i ? ', ' : ''}<Link as="button" onClick={() => actions.setGalleryQuery(replaceWord(gallery.query, s.word, s.suggestion))}><strong>{s.suggestion}</strong></Link></span>
          ))}?
        </Caption1>
      ) : null}
    </div>
  );

  const empty = open && !items.length ? (
    <div className={styles.empty}>
      {view.emptyText && !query ? <Body1>{view.emptyText}</Body1> : (
        <>
          <Body1>{query ? `No ${noun} match "${query}".` : `No ${noun} match these filters.`}</Body1>
          {view.hiddenEquipped?.length ? (
            <Body1 data-testid="picker-hidden-equipped">
              {view.hiddenEquipped.map(h => `${h.name} is equipped in ${isArcaneSlot(h.slot) ? 'the arcane slot' : h.slot === EXILUS_SLOT ? 'the Exilus slot' : `slot ${h.slot + 1}`}`).join('; ')} (equipped cards are hidden).
            </Body1>
          ) : null}
          {view.suggestions.length ? (
            <Body1>
              Did you mean {view.suggestions.map((s, i) => (
                <span key={s.word}>{i ? ', ' : ''}<Link as="button" onClick={() => actions.setGalleryQuery(replaceWord(gallery.query, s.word, s.suggestion))}><strong>{s.suggestion}</strong></Link></span>
              ))}?
            </Body1>
          ) : null}
          <div className={styles.emptyActions}>
            {view.hiddenEquipped?.length ? <Button size="small" appearance="primary" onClick={() => actions.setGallery({ hideEquipped: false })} data-testid="picker-show-equipped">Show equipped</Button> : null}
            {query ? <Button size="small" onClick={() => { actions.setGalleryQuery(''); focusSearch(); }}>Clear search</Button> : null}
            {hasFilters ? <Button size="small" onClick={() => actions.clearGalleryFilters()}>Reset filters</Button> : null}
          </div>
        </>
      )}
    </div>
  ) : null;

  const removeZone = dragFromSlot ? (
    <div
      className={mergeClasses(styles.removeZone, overRemove && styles.removeZoneOver)}
      data-testid="drop-remove-zone"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverRemove(true); }}
      onDragLeave={() => setOverRemove(false)}
      onDrop={e => {
        e.preventDefault();
        setOverRemove(false);
        const d = store.get().drag;
        actions.setDrag(null);
        if (!d) return;
        // Focus lands on the emptied slot (spec 9), not on <body> where the removed card was.
        if (isArcaneSlot(d.from)) actions.clearArcane(arcaneIndexOf(d.from));
        else {
          actions.removeWithUndo(d.from);
          focusLater(slotFocusId(store.get().build, d.from));
        }
      }}
    >
      <DeleteRegular aria-hidden="true" style={{ fontSize: 24 }} />
      <span>Drop here to remove {removeName}</span>
    </div>
  ) : null;

  return (
    <section
      className={styles.root}
      style={{ padding: `0 ${layout.gutter}px ${scrollEl ? layout.gutter : 0}px`, ...(scrollEl ? { flexShrink: 0, flexGrow: 0 } : {}) }}
      data-pane="picker"
      aria-label={open ? 'Choose a mod' : 'Why this DPS'}
    >
      <PickerBar view={view} gallery={gallery} open={open} count={view.items.length} />
      {open ? <TargetLine view={view} /> : null}
      {open ? (
        <div
          ref={el => { setBodyEl(el); bodyRef(el); }}
          className={mergeClasses(styles.body, scrollEl && styles.bodyStacked)}
          {...(scrollEl ? {} : { 'data-scroll-region': '' })}
          style={{ paddingTop: 8, paddingBottom: scrollEl ? 0 : layout.gutter }}
          data-testid="gallery"
          id="picker-grid"
        >
          {messages}
          {empty}
          <div
            ref={gridEl}
            className={styles.grid}
            role="grid"
            aria-label={isArcanes ? 'Arcanes' : view.tab === 'best' ? 'Best mods' : 'Mods'}
            aria-rowcount={win.rows}
            aria-colcount={columns}
            style={{ height: Math.max(0, win.rows * rowH - GAP) }}
            onKeyDown={onGridKey}
          >
            {rows}
          </div>
          {removeZone}
        </div>
      ) : (
        <div className={styles.rest}>
          {children}
          {removeZone}
        </div>
      )}
      {flyout && flyout.el?.isConnected ? (
        <Flyout
          target={flyout.el}
          bounds={bodyEl}
          label={`${flyout.item.name} details`}
          onMouseEnter={() => clearTimeout(timers.current.fly)}
          onMouseLeave={e => { if (!flyout.el?.contains?.(e.relatedTarget)) { clearTimeout(timers.current.fly); timers.current.fly = setTimeout(closeFlyoutNow, 250); } }}
          onClose={closeFlyoutNow}
        >
          {flyout.item.kind === 'mod' ? <ModDetails item={flyout.item} /> : <ArcaneDetails item={flyout.item} />}
        </Flyout>
      ) : null}
      {menu ? <CardMenu menu={menu} onClose={() => setMenu(null)} onDetails={() => { setFlyout({ item: menu.item, el: menu.el }); setMenu(null); }} activate={activate} /> : null}
    </section>
  );
}

function CardMenu({ menu, onClose, onDetails, activate }) {
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const selected = useApp(s => s.selectedSlot);
  const sweepRunning = useApp(s => s.sweep?.status === 'running');
  const { capacity } = useDerived();
  const item = menu.item;
  const slots = [0, 1, 2, 3, 4, 5, 6, 7, EXILUS_SLOT];
  return (
    <Menu open positioning={{ target: menu.el, position: 'below', align: 'start' }} onOpenChange={(_e, d) => { if (!d.open) onClose(); }}>
      <MenuPopover>
        <MenuList>
          {item.kind === 'mod' ? (
            <Menu>
              <MenuTrigger disableButtonEnhancement><MenuItem disabled={item.state === 'blocked' && item.slot == null}>Equip in</MenuItem></MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {slots.map(s => {
                    const d = slotDrain(item.mod, maxRank(item.mod), capacity?.polarities?.[s]);
                    const ok = s === EXILUS_SLOT ? ctx.exilus.has(item.name) : true;
                    return (
                      <MenuItem
                        key={s}
                        disabled={!ok}
                        secondaryContent={`drain ${d.drain}`}
                        onClick={() => { actions.dropMod(item.name, item.slot ?? 'gallery', s); onClose(); }}
                      >
                        {s === EXILUS_SLOT ? 'Exilus' : slotLabel(s)}{build.mods[s] ? ` (${build.mods[s].name})` : ''}
                      </MenuItem>
                    );
                  })}
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <MenuItem disabled={item.state === 'blocked'} onClick={() => { activate(item); onClose(); }}>Equip</MenuItem>
          )}
          <MenuItem secondaryContent="Alt+Enter" onClick={onDetails}>Details</MenuItem>
          {item.kind === 'mod' && Number.isInteger(selected) ? (
            <MenuItem icon={<SparkleRegular />} disabled={sweepRunning} onClick={() => { actions.startSweep(selected); onClose(); }}>Find best mod for {slotLabel(selected).toLowerCase()}</MenuItem>
          ) : null}
          <MenuItem icon={<CopyRegular />} onClick={() => { actions.copyText(item.name); onClose(); }}>Copy name</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}


