// The card gallery (docs/arsenal-spec.md 5): Mods | Arcanes | Best mod tabs, the smart search with tags,
// filter chips, sort and size, and a virtualised grid of card images with keyboard navigation, a details flyout,
// a context menu, drag and drop and the remove zone. It replaces the modal mod picker.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Body1, Body1Strong, Button, Caption1, CounterBadge, Dropdown, Link, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem,
  MenuItemCheckbox, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody, Option,
  Popover, PopoverSurface, PopoverTrigger, Portal, ProgressBar, SearchBox, Spinner, Subtitle2, Tab, TabList, Table, TableBody, TableCell,
  TableHeader, TableHeaderCell, TableRow, Tag, TagGroup, Toolbar, ToolbarButton, ToolbarDivider, ToolbarToggleButton, Tooltip,
  makeStyles, mergeClasses, tokens, useAnnounce,
} from '@fluentui/react-components';
import {
  ChevronDownRegular, CopyRegular, DeleteRegular, DismissRegular, FilterRegular, InfoRegular, ProhibitedRegular, SparkleRegular,
  TextDescriptionRegular,
} from '@fluentui/react-icons';

import { actions, announce, focusLater, store } from '../controller.js';
import { useApp, useDebounced, useDerived, useElementWidth, useScrollState } from '../hooks.js';
import { CARD_RATIO, gridWindow } from '../layout.js';
import { GALLERY_SIZES } from '../controller.js';
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
import { ArtImage, PolarityGlyph, polarityName, useCards, useTextCards } from './art.jsx';

const GAP = 8;
const SORTS = { match: 'Best match', name: 'Name (A-Z)', drain: 'Drain (low to high)', rarity: 'Rarity', gain: 'DPS gain' };
const POL_MENU = ['AP_ATTACK', 'AP_DEFENSE', 'AP_TACTIC', 'AP_POWER', 'AP_WARD', 'AP_PRECEPT', 'AP_UMBRA', 'AP_UNIVERSAL'];

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    position: 'relative',
  },
  header: { display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, paddingTop: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, minWidth: 0, minHeight: '36px' },
  search: { flexGrow: 1, minWidth: '200px', maxWidth: '560px' },
  sort: { minWidth: '150px', width: '170px' },
  count: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' },
  chips: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', minWidth: 0, overflow: 'hidden', paddingLeft: 0, paddingRight: 0 },
  tags: { display: 'flex', gap: '4px', flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0 },
  context: { color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 'auto', minWidth: 0, flexShrink: 1 },
  body: { position: 'relative', flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', outlineStyle: 'none' },
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
  filtersPopover: { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '520px' },
  arcaneFlyoutArt: { width: '100%', height: '120px', backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium, overflow: 'hidden' },
});

/** Gallery card width for the layout and the Size preference. */
export function cardWidthFor(layout, size) {
  return size ? GALLERY_SIZES[size] : layout.cardWidth;
}

/** Search, filters and the current results, shared by the header and the grid. */
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

// ---------- header ----------

function ChipMenus({ gallery, compact }) {
  const weaponName = useApp(s => s.build.weaponName);
  const isArcanes = gallery.tab === 'arcanes';
  return (
    <>
      {isArcanes ? null : (
        <>
          <Menu checkedValues={{ effects: gallery.effects }} onCheckedValueChange={(_e, d) => actions.setGallery({ effects: d.checkedItems })}>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton data-testid="gallery-chip-effect" aria-label="Effect filter" icon={<ChevronDownRegular />} iconPosition="after">Effect{gallery.effects.length ? ` (${gallery.effects.length})` : ''}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover><MenuList>{EFFECT_CATEGORIES.map(c => <MenuItemCheckbox key={c} name="effects" value={c}>{c}</MenuItemCheckbox>)}</MenuList></MenuPopover>
          </Menu>
          <Menu checkedValues={{ pols: gallery.pols }} onCheckedValueChange={(_e, d) => actions.setGallery({ pols: d.checkedItems })}>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton data-testid="gallery-chip-polarity" aria-label="Polarity filter" icon={<ChevronDownRegular />} iconPosition="after">Polarity{gallery.pols.length ? ` (${gallery.pols.length})` : ''}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {POL_MENU.map(p => (
                  <MenuItemCheckbox key={p} name="pols" value={p} icon={<PolarityGlyph code={p} size={16} />}>{POLARITY_LABELS[p]}</MenuItemCheckbox>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu checkedValues={{ rarities: gallery.rarities }} onCheckedValueChange={(_e, d) => actions.setGallery({ rarities: d.checkedItems })}>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton data-testid="gallery-chip-rarity" aria-label="Rarity filter" icon={<ChevronDownRegular />} iconPosition="after">Rarity{gallery.rarities.length ? ` (${gallery.rarities.length})` : ''}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>{RARITIES.map(r => <MenuItemCheckbox key={r} name="rarities" value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</MenuItemCheckbox>)}</MenuList>
            </MenuPopover>
          </Menu>
        </>
      )}
      {compact ? null : <ToolbarDivider />}
      <ToolbarToggleButton name="toggles" value="fits" data-testid="gallery-chip-fits" appearance="subtle">
        Fits {weaponName}
      </ToolbarToggleButton>
      <ToolbarToggleButton name="toggles" value="hideEquipped" data-testid="gallery-chip-hide-equipped" appearance="subtle">Hide equipped</ToolbarToggleButton>
    </>
  );
}

function FilterTags({ view, gallery }) {
  const tags = [];
  if (view.exilusScoped) tags.push({ id: 'exilus-scope', label: 'Exilus slot', fixed: true });
  for (const t of view.parsed.tokens) {
    if ((t.kind === 'filter' || t.kind === 'neg' || t.kind === 'phrase') && t.trailing) tags.push({ id: `q:${t.start}`, label: t.label, token: t });
  }
  for (const e of gallery.effects) tags.push({ id: `effect:${e}`, label: `Effect: ${e}`, menu: ['effects', e] });
  for (const p of gallery.pols) tags.push({ id: `pol:${p}`, label: `Polarity: ${POLARITY_LABELS[p]}`, menu: ['pols', p] });
  for (const r of gallery.rarities) tags.push({ id: `rarity:${r}`, label: `Rarity: ${r.charAt(0).toUpperCase()}${r.slice(1)}`, menu: ['rarities', r] });
  if (!tags.length) return null;
  const dismiss = id => {
    const t = tags.find(x => x.id === id);
    if (!t || t.fixed) return;
    if (t.token) actions.setGalleryQuery(removeToken(store.get().gallery.query, t.token));
    else if (t.menu) {
      const [key, value] = t.menu;
      actions.setGallery({ [key]: store.get().gallery[key].filter(v => v !== value) });
    }
  };
  return (
    <TagGroup size="small" onDismiss={(_e, d) => dismiss(d.value)} aria-label="Active filters" style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
      {tags.map(t => (
        <Tag key={t.id} value={t.id} size="small" dismissible={!t.fixed} data-testid={`gallery-chip-${t.id.replace(/[^a-z0-9]+/gi, '-')}`} appearance={t.fixed ? 'brand' : 'outline'}>
          {t.fixed ? 'Exilus slot · showing Exilus mods' : t.label}
        </Tag>
      ))}
    </TagGroup>
  );
}

function GalleryHeader({ view, gallery, compact, count }) {
  const styles = useStyles();
  const sweep = useApp(s => s.sweep);
  const selectedSlot = useApp(s => s.selectedSlot);
  const sweepRunning = sweep?.status === 'running';
  const size = useApp(s => s.ui.galleryCardSize);
  const textCards = useApp(s => s.ui.textCards);
  const { announce: speak } = useAnnounce();
  const settledCount = useDebounced(`${count}|${gallery.query}|${gallery.tab}`, 600);
  const lastSpoken = useRef('');
  useEffect(() => {
    const [n] = settledCount.split('|');
    if (!lastSpoken.current) { lastSpoken.current = settledCount; return; }
    if (lastSpoken.current === settledCount) return;
    lastSpoken.current = settledCount;
    const noun = gallery.tab === 'arcanes' ? 'arcanes' : 'mods';
    speak(Number(n) ? `${n} ${noun}` : `No ${noun} match`, { polite: true });
  }, [settledCount, gallery.tab, speak]);

  const tab = view.tab;
  const isArcanes = tab === 'arcanes';
  const noun = isArcanes ? (count === 1 ? 'arcane' : 'arcanes') : count === 1 ? 'mod' : 'mods';
  const bestLabel = sweepRunning ? `Best mod ${sweep.done}/${sweep.total}` : 'Best mod';
  const filters = gallery.effects.length + gallery.pols.length + gallery.rarities.length + (gallery.hideEquipped ? 1 : 0) + (gallery.fits ? 0 : 1);
  // Operators typed in the search (drain<=10, pol:v, -primed, "a phrase") are active filters too.
  const queryFilters = view.parsed.tokens.filter(t => t.kind === 'filter' || t.kind === 'neg' || t.kind === 'phrase').length;
  const onSearchKey = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = document.querySelector('[data-testid="gallery"] [role="gridcell"] button');
      first?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = view.items.find(i => i.state !== 'blocked' && i.state !== 'equipped') ?? view.items.find(i => i.state !== 'blocked');
      if (!first) return;
      if (first.kind === 'arcane') actions.equipArcane(first.name, Math.max(0, arcaneIndexOf(view.targetSlot)));
      else if (tab === 'best') actions.equipMod(sweep.slot, first.name, null, { focus: false });
      else actions.equipFromGallery(first.name);
    } else if (e.key === 'Escape' && !gallery.query) {
      const sel = store.get().selectedSlot;
      if (sel != null) {
        e.preventDefault();
        const id = isArcaneSlot(sel) ? arcaneFocusId(arcaneIndexOf(sel)) : store.get().build.mods[sel] ? `slot-select-${sel}` : `slot-add-${sel}`;
        document.querySelector(`[data-focus-id="${id}"]`)?.focus();
      }
    }
  };

  const toolbar = (
    <Toolbar
      aria-label="Gallery filters"
      size="small"
      className={styles.chips}
      checkedValues={{ toggles: [...(gallery.fits ? ['fits'] : []), ...(gallery.hideEquipped ? ['hideEquipped'] : [])] }}
      onCheckedValueChange={(_e, d) => {
        if (d.name === 'toggles') actions.setGallery({ fits: d.checkedItems.includes('fits'), hideEquipped: d.checkedItems.includes('hideEquipped') });
      }}
    >
      <ChipMenus gallery={gallery} compact={compact} />
    </Toolbar>
  );

  const bestButton = Number.isInteger(selectedSlot) && tab !== 'best' && !isArcanes ? (
    <Tooltip content={sweepRunning ? 'A best-mod search is already running' : `Test every compatible mod in ${slotLabel(selectedSlot).toLowerCase()} and rank them by DPS gain`} relationship="description">
      <Button size="small" appearance="subtle" icon={<SparkleRegular />} disabledFocusable={sweepRunning} onClick={() => actions.startSweep(selectedSlot)}>
        Find best mod for {selectedSlot === EXILUS_SLOT ? 'Exilus' : `slot ${selectedSlot + 1}`}
      </Button>
    </Tooltip>
  ) : null;

  const tabs = (
    <TabList size="small" selectedValue={tab} onTabSelect={(_e, d) => actions.setGalleryTab(d.value)} aria-label="Gallery">
      <Tab value="mods" data-testid="gallery-tab-mods">{tab === 'mods' ? `Mods ${view.total}` : 'Mods'}</Tab>
      <Tab value="arcanes" data-testid="gallery-tab-arcanes">Arcanes</Tab>
      {sweep ? (
        <Tab value="best" data-testid="gallery-tab-best" icon={sweepRunning ? <Spinner size="extra-tiny" aria-hidden="true" /> : undefined}>{bestLabel}</Tab>
      ) : null}
    </TabList>
  );
  const search = (
    <SearchBox
      size="small"
      className={styles.search}
      input={{ 'data-testid': 'gallery-search', 'data-focus-id': 'gallery-search' }}
      placeholder={isArcanes ? 'Search arcanes' : 'Search mods: name, effect, cc, drain<=6…'}
      aria-label={isArcanes ? 'Search arcanes' : 'Search mods'}
      value={gallery.query}
      onChange={(_e, d) => actions.setGalleryQuery(d.value)}
      onKeyDown={onSearchKey}
    />
  );
  const sort = (
    <Dropdown
      size="small"
      className={styles.sort}
      aria-label="Sort"
      data-testid="gallery-sort"
      value={`Sort: ${SORTS[tab === 'best' ? 'gain' : gallery.sort]}`}
      selectedOptions={[tab === 'best' ? 'gain' : gallery.sort]}
      disabled={tab === 'best'}
      onOptionSelect={(_e, d) => actions.setGallery({ sort: d.optionValue })}
    >
      {Object.entries(SORTS).map(([k, v]) => (
        <Option key={k} value={k} text={v} disabled={k === 'gain' && !view.sortGainEnabled}>
          {k === 'gain' && !view.sortGainEnabled ? 'DPS gain (run Find best mod first)' : v}
        </Option>
      ))}
    </Dropdown>
  );
  const sizeMenu = (
    <Menu
      checkedValues={{ size: [size ?? 'auto'], text: textCards ? ['text'] : [] }}
      onCheckedValueChange={(_e, d) => {
        if (d.name === 'size') actions.setGalleryCardSize(d.checkedItems[0] === 'auto' ? null : d.checkedItems[0]);
        if (d.name === 'text') actions.setTextCards(d.checkedItems.includes('text'));
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Card size" relationship="label"><Button size="small" appearance="subtle" icon={<TextDescriptionRegular />} data-testid="gallery-size" /></Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Card size</MenuGroupHeader>
            <MenuItemRadio name="size" value="auto">Automatic</MenuItemRadio>
            <MenuItemRadio name="size" value="small">Small</MenuItemRadio>
            <MenuItemRadio name="size" value="medium">Medium</MenuItemRadio>
            <MenuItemRadio name="size" value="large">Large</MenuItemRadio>
          </MenuGroup>
          <MenuDivider />
          <MenuItemCheckbox name="text" value="text">Text cards</MenuItemCheckbox>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
  const countText = (
    <Caption1 className={styles.count} role="status" aria-live="off" data-testid="gallery-count">
      {count ? `${count} ${noun}` : `No ${isArcanes ? 'arcanes' : 'mods'} match`}
    </Caption1>
  );

  if (compact) {
    return (
      <div className={styles.header}>
        <div className={styles.row}>
          {tabs}
          {search}
          <Popover withArrow positioning="below-end">
            <PopoverTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<FilterRegular />}
                data-testid="gallery-filters"
                aria-label={filters + queryFilters ? `Filters, ${filters + queryFilters} active` : 'Filters'}
              >
                Filters {filters + queryFilters ? <CounterBadge count={filters + queryFilters} size="small" appearance="filled" color="brand" /> : null}
              </Button>
            </PopoverTrigger>
            <PopoverSurface className={styles.filtersPopover}>
              {toolbar}
              <FilterTags view={view} gallery={gallery} />
              {filters ? <Link as="button" onClick={() => actions.clearGalleryFilters()}>Clear filters</Link> : null}
            </PopoverSurface>
          </Popover>
          {sort}
          {sizeMenu}
          {countText}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.header}>
      <div className={styles.row}>
        {tabs}
        {search}
        {sort}
        {sizeMenu}
        {countText}
      </div>
      <div className={styles.row}>
        {toolbar}
        <FilterTags view={view} gallery={gallery} />
        {filters ? <Link as="button" onClick={() => actions.clearGalleryFilters()} style={{ whiteSpace: 'nowrap' }}>Clear filters</Link> : null}
        {bestButton}
        <Caption1 className={styles.context}>{view.contextText}</Caption1>
      </div>
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
  const baseline = base.dps == null ? '' : base.kind === 'mod' ? `baseline ${fmtInt(base.dps)} DPS with ${base.name}` : `baseline ${fmtInt(base.dps)} DPS with the slot empty`;
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
            <Caption1 className={styles.hint}>{[baseline, 'max rank, 3 seeded runs'].filter(Boolean).join(' · ')}</Caption1>
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
function Flyout({ target, bounds = null, label, onMouseEnter, onMouseLeave, onClose, children }) {
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
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
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

// ---------- the grid ----------

export function Gallery({ layout, scrollEl = null }) {
  const styles = useStyles();
  const { ctx, gallery, view, capacity } = useGallery();
  const sweep = useApp(s => s.sweep);
  const drag = useApp(s => s.drag);
  const cards = useCards();
  const cardsReady = useApp(s => s.cards);
  const textCards = useTextCards();
  const sizePref = useApp(s => s.ui.galleryCardSize);

  const cardW = cardWidthFor(layout, sizePref);
  const cardH = Math.round(cardW * CARD_RATIO);
  const rowH = cardH + GAP;
  const [gridRef, gridWidth] = useElementWidth();
  const [bodyEl, setBodyEl] = useState(null);
  const scrollTarget = scrollEl ?? bodyEl;
  const { scrollTop, viewport } = useScrollState(scrollTarget);
  const gridEl = useRef(null);
  const [offset, setOffset] = useState(0);
  const columns = Math.max(1, Math.floor((gridWidth + GAP) / (cardW + GAP)));
  const items = view.items;
  const target = useGalleryTarget();
  const slotPol = Number.isInteger(target) ? capacity?.polarities?.[target] : null;

  // The grid's top inside the scroll content (the stacked layout scrolls past the stage and results first).
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
    if (item.kind === 'arcane') actions.equipArcane(item.name, Math.max(0, arcaneIndexOf(view.targetSlot)));
    else if (view.tab === 'best' && sweep) {
      if (actions.equipMod(sweep.slot, item.name, null, { focus: false })) announce(`${item.name} equipped in ${slotLabel(sweep.slot).toLowerCase()}. Average DPS updating.`);
    } else actions.equipFromGallery(item.name);
  };

  const openFlyout = (item, el, delay) => {
    clearTimeout(timers.current.close);
    clearTimeout(timers.current.open);
    timers.current.open = setTimeout(() => setFlyout({ item, el }), delay);
  };
  const closeFlyout = (delay = 150) => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => setFlyout(null), delay);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  // The flyout follows the data (a re-render with new items): drop it when its card is gone.
  useEffect(() => { if (flyout && !items.some(i => i.name === flyout.item.name)) setFlyout(null); }, [items]); // eslint-disable-line

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
      if (flyout) { e.preventDefault(); setFlyout(null); return; }
      const sel = store.get().selectedSlot;
      if (sel != null) {
        e.preventDefault();
        const id = isArcaneSlot(sel) ? arcaneFocusId(arcaneIndexOf(sel)) : store.get().build.mods[sel] ? `slot-select-${sel}` : `slot-add-${sel}`;
        document.querySelector(`[data-focus-id="${id}"]`)?.focus();
      }
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
      if (e.target.matches(':focus-visible')) openFlyout(item, e.target, 600);
    },
    onBlur: () => closeFlyout(100),
    onMouseEnter: e => {
      prepareDragImage(item.name, item.kind === 'mod' && !textCards ? cards?.modCompactUrl(item.name) : !textCards ? cards?.arcaneUrl(item.name) : null);
      openFlyout(item, e.currentTarget, 400);
    },
    onMouseLeave: () => closeFlyout(150),
    onContextMenu: e => { e.preventDefault(); setFlyout(null); setMenu({ item, el: e.currentTarget }); },
    onDragStart: e => {
      if (item.state === 'blocked') { e.preventDefault(); return; }
      setFlyout(null);
      clearTimeout(timers.current.open);
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
  const hasFilters = gallery.effects.length + gallery.pols.length + gallery.rarities.length > 0 || gallery.hideEquipped;
  const messages = (
    <div className={styles.messages}>

      {view.tab === 'best' ? <BestHeader /> : null}
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

  const empty = !items.length ? (
    <div className={styles.empty}>
      {view.emptyText && !query ? <Body1>{view.emptyText}</Body1> : (
        <>
          <Body1>{query ? `No ${noun} match "${query}".` : `No ${noun} match these filters.`}</Body1>
          {view.suggestions.length ? (
            <Body1>
              Did you mean {view.suggestions.map((s, i) => (
                <span key={s.word}>{i ? ', ' : ''}<Link as="button" onClick={() => actions.setGalleryQuery(replaceWord(gallery.query, s.word, s.suggestion))}><strong>{s.suggestion}</strong></Link></span>
              ))}?
            </Body1>
          ) : null}
          <div className={styles.emptyActions}>
            {query ? <Button size="small" onClick={() => { actions.setGalleryQuery(''); focusSearch(); }}>Clear search</Button> : null}
            {hasFilters ? <Button size="small" onClick={() => actions.clearGalleryFilters()}>Clear filters</Button> : null}
          </div>
        </>
      )}
    </div>
  ) : null;

  return (
    <section
      className={styles.root}
      style={{ paddingLeft: layout.gutter, paddingRight: layout.gutter, ...(scrollEl ? { flexShrink: 0, flexGrow: 0 } : {}) }}
      data-pane="gallery"
      data-testid="gallery"
      aria-label="Mod gallery"
    >
      {/* Without core/images the context line says so (no banner: it would push the first card row away). */}
      <GalleryHeader
        view={cardsReady && !cardsReady.available ? { ...view, contextText: `Card images aren't installed: showing text cards. ${view.contextText}` } : view}
        gallery={gallery}
        compact={layout.compactHeight && !layout.stacked}
        count={items.length}
      />

      <div
        ref={setBodyEl}
        className={mergeClasses(styles.body, scrollEl && styles.bodyStacked)}
        {...(scrollEl ? {} : { 'data-scroll-region': '' })}
        style={{ paddingTop: 4, paddingBottom: 8 }}
      >
        {messages}
        {empty}
        <div
          ref={el => { gridRef(el); gridEl.current = el; }}
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
        {dragFromSlot ? (
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
                focusLater(`slot-add-${d.from}`);
              }
            }}
          >
            <DeleteRegular aria-hidden="true" style={{ fontSize: 24 }} />
            <span>Drop here to remove {removeName}</span>
          </div>
        ) : null}
      </div>
      {flyout && flyout.el?.isConnected ? (
        <Flyout
          target={flyout.el}
          bounds={bodyEl}
          label={`${flyout.item.name} details`}
          onMouseEnter={() => clearTimeout(timers.current.close)}
          onMouseLeave={() => closeFlyout(150)}
          onClose={() => setFlyout(null)}
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


