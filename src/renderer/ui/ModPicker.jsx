// Mod picker: a modal Dialog with search, effect filters, a list and a detail pane.
// Blocked mods stay focusable (aria-disabled) and show why they can't be picked.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Body1, Body1Strong, Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Dropdown, List, ListItem, MessageBar, MessageBarBody, Option, SearchBox, Subtitle2, Table, TableBody,
  TableCell, TableHeader, TableHeaderCell, TableRow, Toolbar, ToolbarRadioButton, ToolbarRadioGroup, Tooltip,
  createFocusOutlineStyle, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import { DismissRegular, ProhibitedRegular } from '@fluentui/react-icons';
import { actions, store } from '../controller.js';
import { useApp, useWindowSize } from '../hooks.js';
import { EXILUS_SLOT, modCandidates, polarityInfo, slotLabel, sweepKeyOf, sweepView } from '../model.js';
import { EFFECT_CATEGORIES, maxRank, modEffectCategories, modEffectSummary, modEffects } from '../../shared/mods.js';
import { fmtSignedPct } from '../format.js';
import { DeltaBadge, Polarity, hasNoStats, unmodeledStats } from './common.jsx';
import { RankStepper } from './RankStepper.jsx';

const SORTS = { match: 'Best match', name: 'Name', gain: 'DPS gain' };

const useStyles = makeStyles({
  surface: {
    width: 'min(1040px, 92vw)',
    maxWidth: 'min(1040px, 92vw)',
    height: 'min(760px, 88vh)',
    maxHeight: 'min(760px, 88vh)',
    display: 'flex',
    flexDirection: 'column',
    padding: tokens.spacingHorizontalXXL,
    boxSizing: 'border-box',
  },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },
  title: { flexGrow: 1 },
  detailHead: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  body: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, gap: tokens.spacingVerticalM, maxHeight: 'none' },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    flexGrow: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: 0,
  },
  filters: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  search: { flexGrow: 1, minWidth: '260px', maxWidth: '520px' },
  sort: { minWidth: '150px' },
  toolbar: { flexWrap: 'wrap', paddingLeft: 0, paddingRight: 0 },
  panes: { display: 'flex', gap: tokens.spacingHorizontalL, flexGrow: 1, minHeight: 0 },
  listScroll: {
    flexGrow: 1,
    minWidth: 0,
    overflowY: 'auto',
    paddingRight: tokens.spacingHorizontalXS,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  list: { margin: 0, padding: tokens.spacingHorizontalXS, display: 'flex', flexDirection: 'column', gap: '2px' },
  heading: {
    listStyle: 'none',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXXS}`,
    color: tokens.colorNeutralForeground2,
  },
  item: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
    // One Fluent focus ring in every input modality (never Chromium's default outline).
    outlineStyle: 'none',
    ...createFocusOutlineStyle({ style: { outlineRadius: tokens.borderRadiusMedium } }),
  },
  active: { backgroundColor: tokens.colorSubtleBackgroundSelected, ':hover': { backgroundColor: tokens.colorSubtleBackgroundSelected } },
  blocked: { cursor: 'default' },
  blockedName: { color: tokens.colorNeutralForeground3 },
  itemText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  effect: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  reason: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground2 },
  badges: { display: 'flex', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap', justifyContent: 'flex-end' },
  trailing: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', minWidth: '72px', justifyContent: 'flex-end' },
  detail: {
    width: '360px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  detailScroll: { overflowY: 'auto', flexGrow: 1, padding: tokens.spacingHorizontalL, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  detailFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalM,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  meta: { color: tokens.colorNeutralForeground2 },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  notes: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  actions: { display: 'flex', alignItems: 'center', width: '100%', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  actionsHint: { color: tokens.colorNeutralForeground2, flexGrow: 1 },
  empty: { padding: tokens.spacingHorizontalL, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: tokens.spacingVerticalS },
  emptyButtons: { display: 'flex', gap: tokens.spacingHorizontalS },
});

const rarityLabel = r => {
  const s = String(r ?? 'Common').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Sweep gains for this slot, measured the way the Best mod tab shows them, only while the rest of the build
 * is what the search ran against (changing this slot itself doesn't invalidate them).
 */
function useGains(slot) {
  const sweep = useApp(s => s.sweep);
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  return useMemo(() => {
    if (!sweep || sweep.slot !== slot || sweep.status === 'error' || sweep.key !== sweepKeyOf(ctx, build, slot)) return null;
    const { rows } = sweepView(sweep, build.mods[slot]?.name ?? null, Infinity);
    return new Map(rows.filter(r => Number.isFinite(r.gain)).map(r => [r.name, r.gain]));
  }, [sweep, slot, ctx, build]);
}

export function ModPicker() {
  const picker = useApp(s => s.picker);
  if (!picker) return null;
  return <PickerDialog key={picker.slot} slot={picker.slot} />;
}

function PickerDialog({ slot }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const sweepRunning = useApp(s => s.sweep?.status === 'running');
  const { width } = useWindowSize();
  const gains = useGains(slot);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState('match');
  const [activeName, setActiveName] = useState(build.mods[slot]?.name ?? null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const current = build.mods[slot];
  const showDetail = Math.min(1040, width * 0.92) >= 760;

  const candidates = useMemo(() => modCandidates(ctx, build, slot, query), [ctx, build, slot, query]);
  const filtered = useMemo(
    () => (filter === 'All' ? candidates : candidates.filter(c => modEffectCategories(c.mod).includes(filter))),
    [candidates, filter],
  );
  const sections = useMemo(() => {
    const order = list => {
      const out = [...list];
      if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
      if (sort === 'gain' && gains) out.sort((a, b) => (gains.get(b.name) ?? -Infinity) - (gains.get(a.name) ?? -Infinity));
      // Blocked mods go to the end of each section; the sort is stable otherwise.
      return out.sort((a, b) => Number(Boolean(a.conflict)) - Number(Boolean(b.conflict)));
    };
    if (!query.trim() && filter === 'All' && sort === 'match') {
      // Each mod is listed once: common picks first, then every other compatible mod.
      const popular = filtered.filter(c => c.popular);
      const rest = filtered.filter(c => !c.popular);
      return [
        ...(popular.length ? [{ id: 'common', title: 'Common picks', items: order(popular) }] : []),
        ...(rest.length ? [{ id: 'all', title: popular.length ? 'Other compatible mods' : null, items: order(rest) }] : []),
      ];
    }
    return [{ id: 'all', title: null, items: order(filtered) }];
  }, [filtered, query, filter, sort, gains]);

  const firstEquippable = sections.flatMap(s => s.items).find(c => !c.conflict);
  const visible = sections.flatMap(s => s.items);
  // The detail follows the focused or hovered item; when that one is filtered out, the first visible item.
  const active = visible.find(c => c.name === activeName) ?? visible[0] ?? null;

  // Focus starts in the search box (the dialog would otherwise focus its first button).
  useEffect(() => {
    let frames = 0;
    let id = 0;
    const tick = () => {
      if (searchRef.current && document.activeElement !== searchRef.current) searchRef.current.focus();
      if (++frames < 3) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => actions.closePicker();
  const equip = (name, rank) => {
    if (actions.equipMod(slot, name, rank, { focus: false })) actions.closePicker();
  };

  const focusFirstItem = () => listRef.current?.querySelector('[data-testid="mod-option"]')?.focus();

  const onSearchKey = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusFirstItem();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (firstEquippable) equip(firstEquippable.name);
    }
  };

  const onListKey = e => {
    const items = [...(listRef.current?.querySelectorAll('[data-testid="mod-option"]') ?? [])];
    if (e.key === 'ArrowUp' && items[0] === document.activeElement) {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      setQuery(q => q + e.key);
      searchRef.current?.focus();
    }
  };

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const title = slot === EXILUS_SLOT ? 'Choose an Exilus mod' : `Choose a mod for ${slotLabel(slot).toLowerCase()}`;

  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => { if (!d.open) close(); }}>
      <DialogSurface className={styles.surface} data-testid="mod-picker" aria-label={title}>
        <DialogBody className={styles.body}>
          <div className={styles.titleRow}>
            <DialogTitle className={styles.title}>{title}</DialogTitle>
            <Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={close} />
          </div>
          <DialogContent className={styles.content}>
            <div className={styles.filters}>
              <SearchBox
                ref={searchRef}
                autoFocus
                className={styles.search}
                placeholder="Search by name or effect, like crit or toxin"
                aria-label="Search mods"
                value={query}
                onChange={(_e, d) => setQuery(d.value)}
                onKeyDown={onSearchKey}
              />
              <Dropdown
                className={styles.sort}
                aria-label="Sort"
                value={`Sort: ${SORTS[sort]}`}
                selectedOptions={[sort]}
                onOptionSelect={(_e, d) => setSort(d.optionValue)}
              >
                <Option value="match">Best match</Option>
                <Option value="name">Name</Option>
                <Option value="gain" disabled={!gains} text="DPS gain">
                  {gains ? 'DPS gain' : 'DPS gain (run Find best mod to sort by DPS gain)'}
                </Option>
              </Dropdown>
            </div>
            <Toolbar
              aria-label="Effect filters"
              size="small"
              className={styles.toolbar}
              checkedValues={{ effect: [filter] }}
              onCheckedValueChange={(_e, d) => setFilter(d.checkedItems[0] ?? 'All')}
            >
              <ToolbarRadioGroup>
                {['All', ...EFFECT_CATEGORIES].map(c => (
                  <ToolbarRadioButton key={c} name="effect" value={c} appearance="subtle">{c}</ToolbarRadioButton>
                ))}
              </ToolbarRadioGroup>
            </Toolbar>
            <div className={styles.panes}>
              <div className={styles.listScroll} role="region" aria-label="Mods" onKeyDown={onListKey}>
                {total ? (
                  <List navigationMode="items" className={styles.list} ref={listRef} aria-label={`${total} mods`}>
                    {sections.flatMap(section => [
                      section.title ? (
                        <li key={`h-${section.id}`} role="presentation" className={styles.heading}><Caption1>{section.title}</Caption1></li>
                      ) : null,
                      ...section.items.map(c => (
                        <PickerItem
                          key={`${section.id}-${c.name}`}
                          c={c}
                          ctx={ctx}
                          gain={gains?.get(c.name)}
                          active={c.name === active?.name}
                          onActive={() => setActiveName(c.name)}
                          onEquip={() => equip(c.name)}
                        />
                      )),
                    ])}
                  </List>
                ) : (
                  <div className={styles.empty}>
                    <Body1>{query.trim() ? `No mods match "${query.trim()}".` : filter !== 'All' ? `No ${filter.toLowerCase()} mods fit this slot.` : 'No compatible mods for this slot.'}</Body1>
                    <div className={styles.emptyButtons}>
                      {query ? <Button size="small" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear search</Button> : null}
                      {filter !== 'All' ? <Button size="small" onClick={() => setFilter('All')}>Show all effects</Button> : null}
                    </div>
                  </div>
                )}
              </div>
              {showDetail ? <Detail c={active} ctx={ctx} gain={gains?.get(active?.name)} onEquip={equip} key={active?.name ?? 'none'} /> : null}
            </div>
          </DialogContent>
          <DialogActions fluid className={styles.actions}>
            <Caption1 className={styles.actionsHint}>Mods that conflict with your equipped mods can't be selected.</Caption1>
            <Tooltip content={sweepRunning ? 'A best-mod search is already running' : 'Test every compatible mod in this slot and rank them by DPS gain'} relationship="description">
              <Button
                disabledFocusable={sweepRunning}
                onClick={() => {
                  actions.startSweep(slot);
                  requestAnimationFrame(() => document.getElementById('results-panel')?.focus());
                }}
              >
                Find best mod
              </Button>
            </Tooltip>
            {current ? (
              <Button onClick={() => { actions.clearSlot(slot, { focus: false }); close(); }}>Remove {current.name}</Button>
            ) : null}
            <Button onClick={close}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function PickerItem({ c, ctx, gain, active, onActive, onEquip }) {
  const styles = useStyles();
  const blocked = Boolean(c.conflict);
  const max = maxRank(c.mod);
  const effect = modEffectSummary(c.mod, max);
  const partial = unmodeledStats(ctx, c.name);
  const noStats = hasNoStats(ctx, c.name);
  const pol = polarityInfo(c.mod.Polarity);
  const spoken = [
    c.name,
    effect,
    blocked ? `unavailable, ${c.conflict.charAt(0).toLowerCase()}${c.conflict.slice(1)}` : null,
    c.equipped ? 'equipped' : null,
    pol.symbol ? `${pol.label} polarity` : null,
    `drain ${c.mod['Base Drain'] ?? 'unknown'}`,
    partial.length ? 'partially simulated' : null,
    noStats ? 'engine-only' : null,
    Number.isFinite(gain) ? `${fmtSignedPct(gain)} DPS` : null,
  ].filter(Boolean).join(', ');
  return (
    <ListItem
      value={c.name}
      className={mergeClasses(styles.item, active && styles.active, blocked && styles.blocked)}
      aria-disabled={blocked || undefined}
      aria-label={spoken}
      data-testid="mod-option"
      data-mod-name={c.name}
      onFocus={onActive}
      onMouseEnter={onActive}
      onAction={() => { if (!blocked) onEquip(); }}
    >
      <span className={styles.itemText}>
        <Body1Strong className={blocked ? styles.blockedName : undefined}>{c.name}</Body1Strong>
        <Caption1 className={styles.effect}>{effect || 'No description'}</Caption1>
        {blocked ? <Caption1 className={styles.reason}><ProhibitedRegular aria-hidden="true" /> {c.conflict}</Caption1> : null}
      </span>
      <span className={styles.badges}>
        {c.equipped ? <Badge appearance="outline">Equipped</Badge> : null}
        {partial.length ? <Badge appearance="tint" color="warning">Partially simulated</Badge> : null}
        {noStats ? <Badge appearance="tint" color="informative">Engine-only</Badge> : null}
        {Number.isFinite(gain) ? <DeltaBadge delta={Math.abs(gain) < 0.0005 ? null : gain} /> : null}
      </span>
      {/* Polarity and drain, labelled like the slot cards ("V · drain 4"); spoken in the item label. */}
      <Caption1 className={styles.trailing} aria-hidden="true">
        {pol.symbol ? <><span title={`${pol.label} polarity`}>{pol.symbol}</span><span>·</span></> : null}
        <span>drain {c.mod['Base Drain'] ?? '?'}</span>
      </Caption1>
    </ListItem>
  );
}

function Detail({ c, ctx, gain, onEquip }) {
  const styles = useStyles();
  const max = c ? maxRank(c.mod) : 0;
  const [rank, setRank] = useState(max);
  const sweep = store.get().sweep;
  if (!c) {
    return (
      <aside className={styles.detail} aria-label="Mod details">
        <div className={styles.detailScroll}><Caption1>Point at a mod to see its details.</Caption1></div>
      </aside>
    );
  }
  const blocked = Boolean(c.conflict);
  const at0 = modEffects(c.mod, 0);
  const atMax = modEffects(c.mod, max);
  const partial = unmodeledStats(ctx, c.name);
  const noStats = hasNoStats(ctx, c.name);
  const pol = polarityInfo(c.mod.Polarity);
  return (
    <aside className={styles.detail} aria-label={`${c.name} details`}>
      <div className={styles.detailScroll} tabIndex={0} aria-label={`${c.name} details`}>
        <div className={styles.detailHead}>
          <Subtitle2 as="h3" style={{ margin: 0 }}>{c.name}</Subtitle2>
          <Caption1 as="p" className={styles.meta} style={{ margin: 0 }}>
            {rarityLabel(c.mod.Rarity)} · <Polarity polarity={c.mod.Polarity} /> {pol.label} · drain {c.mod['Base Drain'] ?? '?'}
          </Caption1>
        </div>
        <Body1>{String(c.mod.Description ?? '').replace(/\r?\n/g, ' ') || 'No description in the data.'}</Body1>
        {atMax.length ? (
          <Table size="extra-small" aria-label={`${c.name} stats by rank`}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Rank 0</TableHeaderCell>
                <TableHeaderCell>Rank {max}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {atMax.map((v, i) => (
                <TableRow key={v}>
                  <TableCell>{at0[i] ?? '—'}</TableCell>
                  <TableCell>{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <div className={styles.notes}>
          {partial.length ? (
            <MessageBar intent="warning" layout="multiline">
              <MessageBarBody>Partially simulated. Not modelled: {partial.join(', ')}. Results for this build may be off.</MessageBarBody>
            </MessageBar>
          ) : null}
          {noStats ? (
            <MessageBar intent="info" layout="multiline">
              <MessageBarBody>Engine-only. This mod has no numeric stats in the data. Its effect counts only if the Underframe engine models it itself.</MessageBarBody>
            </MessageBar>
          ) : null}
          {blocked ? (
            <MessageBar intent="warning" layout="multiline" icon={<ProhibitedRegular />}>
              <MessageBarBody>Can't equip: {c.conflict}.</MessageBarBody>
            </MessageBar>
          ) : null}
          {Number.isFinite(gain) ? (
            <Caption1>{fmtSignedPct(gain)} DPS in this slot · best-mod search, 3 runs{sweep?.status === 'running' ? ' (search still running)' : ''}</Caption1>
          ) : null}
        </div>
      </div>
      <div className={styles.detailFoot}>
        <RankStepper value={Math.min(rank, max)} max={max} label={`${c.name} rank`} onChange={setRank} disabled={blocked} />
        <Tooltip content={blocked ? c.conflict : `Equip ${c.name} at rank ${Math.min(rank, max)}`} relationship="description">
          <Button appearance="primary" disabledFocusable={blocked} onClick={() => onEquip(c.name, Math.min(rank, max))}>Equip</Button>
        </Tooltip>
      </div>
    </aside>
  );
}
