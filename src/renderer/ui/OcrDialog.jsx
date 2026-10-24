// Screenshot import dialog (docs/arsenal-spec.md 7.3-7.6): progress with steps and Cancel, the review (the
// screenshot with numbered region boxes, and the recognised items with confidence, raw text and Replace), the
// error states, and the privacy note. Applying makes a new unsaved build or one undo step in the current build.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion, AccordionHeader, AccordionItem, AccordionPanel, Badge, Body1, Body1Strong, Button, Caption1, Combobox, Dialog,
  DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link, MessageBar, MessageBarActions, MessageBarBody,
  Option, OptionGroup, Popover, PopoverSurface, PopoverTrigger, ProgressBar, SearchBox, Subtitle2, ToggleButton, Tooltip,
  makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, CheckmarkCircleRegular, DismissRegular, LockClosedRegular, PersonRegular, QuestionCircleRegular, SubtractRegular,
  WarningRegular, ZoomInRegular, ZoomOutRegular,
} from '@fluentui/react-icons';
import { useApp } from '../hooks.js';
import { WEAPON_GROUPS, changeWeapon, slotLabel, weaponMatches } from '../model.js';
import { isModCompatible, maxRank } from '../../shared/mods.js';
import { arcaneMaxRank, arcanesFor } from '../../shared/arcanes.js';
import { arcaneEntry, parseQuery, searchEntries, sortResults } from '../../shared/mod-search.js';
import { modIndexFor } from '../gallery-model.js';
import { BAND_LABEL, appliedParts, bandOf, itemProblems, mergeWithCurrent, pickConflict } from '../ocr-review.js';
import * as O from '../ocr-import.js';
import { uf } from '../platform.js';
import { ArtImage, useCards, useTextCards } from './art.jsx';

const BAND_COLOR = { high: tokens.colorStatusSuccessForeground1, check: tokens.colorStatusWarningForeground1, low: tokens.colorNeutralForeground3 };
const BAND_BORDER = { high: 'solid', check: 'dashed', low: 'dotted' };
const BAND_ICON = { high: <CheckmarkCircleRegular />, check: <WarningRegular />, low: <QuestionCircleRegular /> };
const BADGE_COLOR = { high: 'success', check: 'warning', low: 'subtle' };

const useStyles = makeStyles({
  surface: {
    width: 'min(1200px, 94vw)',
    maxWidth: 'min(1200px, 94vw)',
    height: 'min(820px, 92vh)',
    maxHeight: 'min(820px, 92vh)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  },
  // The surface is fixed with inset 0, so 'auto' would stretch it to the max height: fit the content instead.
  surfaceSmall: { width: 'min(560px, 94vw)', maxWidth: 'min(560px, 94vw)', height: 'fit-content' },
  body: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, maxHeight: 'none', gap: tokens.spacingVerticalM },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, flexGrow: 1, minHeight: 0, overflow: 'hidden', padding: 0 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  privacy: { display: 'flex', alignItems: 'center', gap: '6px', color: tokens.colorNeutralForeground2 },
  panes: { display: 'flex', gap: tokens.spacingHorizontalL, flexGrow: 1, minHeight: 0 },
  shotPane: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
  shotTools: { display: 'flex', alignItems: 'center', gap: '6px' },
  shotScroll: {
    flexGrow: 1, minHeight: 0, overflow: 'auto', borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  },
  shot: { position: 'relative', flexShrink: 0 },
  shotImg: { display: 'block', width: '100%', height: '100%' },
  region: { position: 'absolute', boxSizing: 'border-box', borderWidth: '2px', pointerEvents: 'none', borderRadius: '2px' },
  regionOn: { borderWidth: '3px' },
  regionTag: {
    position: 'absolute', top: '-18px', left: '-2px', minWidth: '16px', height: '16px', padding: '0 3px', borderRadius: '3px',
    fontSize: '11px', lineHeight: '16px', fontWeight: tokens.fontWeightSemibold, color: '#000', textAlign: 'center',
  },
  unmatched: { position: 'absolute', border: `1px solid ${tokens.colorNeutralStroke1}`, pointerEvents: 'none' },
  list: { width: '480px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, paddingRight: '4px' },
  item: {
    display: 'grid',
    gridTemplateColumns: '24px 96px minmax(0, 1fr)',
    gap: tokens.spacingHorizontalS,
    alignItems: 'start',
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  itemOn: { borderColor: tokens.colorBrandStroke1, backgroundColor: tokens.colorSubtleBackgroundHover },
  num: { fontVariantNumeric: 'tabular-nums', color: tokens.colorNeutralForeground2, paddingTop: '2px' },
  thumb: {
    position: 'relative', width: '96px', height: '48px', borderRadius: tokens.borderRadiusMedium, overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  },
  thumbText: { fontSize: '11px', lineHeight: '13px', padding: '2px', color: tokens.colorNeutralForeground2 },
  itemMain: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  itemHead: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  raw: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rankRow: { display: 'flex', alignItems: 'center', gap: '4px', color: tokens.colorNeutralForeground2 },
  step: { minWidth: '24px', width: '24px', height: '24px', padding: 0 },
  actionsRow: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  problem: { color: tokens.colorStatusWarningForeground1 },
  footCaption: { color: tokens.colorNeutralForeground2, marginRight: 'auto' },
  weaponRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  pickList: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, width: '348px' },
  pickHelp: { color: tokens.colorNeutralForeground2 },
  // Replace: the best matches as labelled card images, two per row.
  pickGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 160px)', gap: '8px 12px', maxHeight: '360px', overflowY: 'auto', overflowX: 'hidden', padding: '4px' },
  pickCard: {
    display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px', margin: 0, border: `${tokens.strokeWidthThin} solid transparent`,
    borderRadius: tokens.borderRadiusMedium, backgroundColor: 'transparent', color: tokens.colorNeutralForeground1, cursor: 'pointer',
    textAlign: 'left', fontFamily: 'inherit',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, borderColor: tokens.colorNeutralStroke1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' },
    '@media (forced-colors: active)': { border: '1px solid CanvasText', ':focus-visible': { outline: '2px solid Highlight' } },
  },
  pickArt: {
    position: 'relative', width: '150px', height: '75px', borderRadius: tokens.borderRadiusSmall, overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  pickName: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '150px' },
  // A pick that clashes with another kept item: dimmed art and a plate saying why (picking it still works).
  pickDim: { opacity: 0.45 },
  pickPlate: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: '2px 4px', fontSize: tokens.fontSizeBase100, lineHeight: tokens.lineHeightBase100,
    backgroundColor: tokens.colorNeutralBackgroundInverted, color: tokens.colorNeutralForegroundInverted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  attention: { color: tokens.colorStatusWarningForeground1, display: 'flex', alignItems: 'center', gap: '4px' },
  progress: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, padding: `${tokens.spacingVerticalL} 0` },
});

function Privacy() {
  const styles = useStyles();
  return (
    <Caption1 className={styles.privacy}>
      <LockClosedRegular aria-hidden="true" />
      Screenshots are read on this PC with Windows' built-in text recognition. Nothing is uploaded, and the image isn't saved.
    </Caption1>
  );
}

function ConfidenceBadge({ band, confidence, chosen = false }) {
  if (chosen) return <Badge appearance="tint" color="brand" icon={<PersonRegular />} size="medium">Chosen by you</Badge>;
  return (
    <Badge appearance="tint" color={BADGE_COLOR[band]} icon={BAND_ICON[band]} size="medium">
      {BAND_LABEL[band]} {confidence ? confidence.toFixed(2) : ''}
    </Badge>
  );
}

/**
 * Replace: a mini gallery search prefilled with the raw text; every match (with no text, every compatible mod or
 * arcane) in a scrolling grid; Enter picks the first. Picks that duplicate or conflict with another kept item sort
 * last and say so.
 */
function ReplacePicker({ item, weaponName, onPick, children }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const review = useApp(s => s.ocr?.review);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(item.raw ?? item.suggestion ?? '');
  const weapon = ctx.weaponByName.get(weaponName);
  const results = useMemo(() => {
    if (!open) return [];
    const parsed = parseQuery(q);
    if (item.kind === 'arcane') {
      const list = weapon ? arcanesFor(weapon, ctx.data, 0) : [];
      return sortResults(searchEntries(list.map(arcaneEntry), parsed).results, parsed.terms.length ? 'match' : 'name');
    }
    const index = modIndexFor(ctx, weapon?.type ?? 'PRIMARY');
    const fits = weapon ? new Set(index.filter(e => isModCompatible(e.mod, weapon)).map(e => e.name)) : null;
    const scoped = item.slot === 8 ? index.filter(e => ctx.exilus.has(e.name)) : index;
    let { results: r } = searchEntries(scoped, parsed, { fits, onlyFits: Boolean(fits) });
    if (!r.length && parsed.terms.length) {
      // OCR text is often garbled: fall back to the best single word.
      const words = parsed.terms.filter(t => t.length >= 4);
      for (const w of words) {
        r = searchEntries(scoped, parseQuery(w), { fits, onlyFits: Boolean(fits) }).results;
        if (r.length) break;
      }
    }
    const clashes = new Map();
    for (const x of r) {
      const c = review ? pickConflict(ctx, review, item, x.name) : null;
      if (c) clashes.set(x.name, c.reason);
    }
    return sortResults(r, parsed.terms.length ? 'match' : 'name', { blocked: clashes }).map(x => ({ ...x, clash: clashes.get(x.name) ?? null }));
  }, [open, q, item, weapon, ctx, review]);
  const gridRef = useRef(null);
  const pick = name => { onPick(name); setOpen(false); };
  const focusPick = i => gridRef.current?.querySelector(`[data-pick-index="${Math.max(0, Math.min(results.length - 1, i))}"]`)?.focus();
  // Arrow keys move through the two-column grid; Home/End jump; typing goes back to the search box.
  const onGridKey = e => {
    const i = Number(e.target.dataset?.pickIndex);
    if (!Number.isInteger(i)) return;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
    if (move != null) {
      e.preventDefault();
      if (e.key === 'ArrowUp' && i < 2) searchRef.current?.focus();
      else focusPick(i + move);
    } else if (e.key === 'Home') { e.preventDefault(); focusPick(0); }
    else if (e.key === 'End') { e.preventDefault(); focusPick(results.length - 1); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') searchRef.current?.focus();
  };
  const searchRef = useRef(null);
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} withArrow positioning="below-start" trapFocus>
      <PopoverTrigger disableButtonEnhancement>{children}</PopoverTrigger>
      <PopoverSurface aria-label={`Replace ${item.kind === 'arcane' ? 'the arcane' : slotLabel(item.slot).toLowerCase()}`}>
        <div className={styles.pickList}>
          <SearchBox
            ref={searchRef}
            size="small"
            autoFocus
            value={q}
            aria-label={item.kind === 'arcane' ? 'Search arcanes' : 'Search mods'}
            aria-describedby={`ocr-pick-help-${item.key}`}
            onChange={(_e, d) => setQ(d.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                pick(results[0].name);
              } else if (e.key === 'ArrowDown' && results.length) {
                e.preventDefault();
                focusPick(0);
              }
            }}
          />
          <Caption1 id={`ocr-pick-help-${item.key}`} className={styles.pickHelp}>
            {results.length
              ? `${results.length} ${q.trim() ? (results.length === 1 ? 'match' : 'matches') : `compatible ${item.kind === 'arcane' ? 'arcanes' : 'mods'}`}. Enter picks the first; arrow keys move through the cards.`
              : 'No matches.'}
          </Caption1>
          {results.length ? (
            <div ref={gridRef} className={styles.pickGrid} role="listbox" aria-label="Matches" onKeyDown={onGridKey} data-testid="ocr-pick-grid">
              {results.map((r, i) => (
                <PickCard key={r.name} name={r.name} kind={item.kind} index={i} clash={r.clash} onPick={pick} />
              ))}
            </div>
          ) : null}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

/** One Replace result: the labelled card image (compact mod card or arcane art) with its name under it. */
function PickCard({ name, kind, index, clash = null, onPick }) {
  const styles = useStyles();
  const cards = useCards();
  const textCards = useTextCards();
  const url = textCards ? null : kind === 'arcane' ? cards?.arcaneUrl(name) : cards?.modCompactUrl(name);
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      aria-label={clash ? `${name}, ${clash}` : name}
      className={styles.pickCard}
      tabIndex={-1}
      data-pick-index={index}
      data-testid="ocr-pick"
      onClick={() => onPick(name)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(name); } }}
    >
      <span className={styles.pickArt} aria-hidden="true">
        <span className={mergeClasses(styles.thumbText, clash && styles.pickDim)}>{name}</span>
        {url ? <span className={clash ? styles.pickDim : undefined} style={{ position: 'absolute', inset: 0 }}><ArtImage src={url} fit={kind === 'arcane' ? 'contain' : 'cover'} backdrop={tokens.colorNeutralBackground3} /></span> : null}
        {clash ? <span className={styles.pickPlate}>{clash}</span> : null}
      </span>
      <span className={styles.pickName} aria-hidden="true">{name}</span>
    </button>
  );
}



/** A row read with high confidence and nothing to fix: shown as its name and rank only, until "Review all". */
export const isSureItem = (item, problem) => Boolean(item.keep && item.name && !item.chosen && item.band === 'high' && !problem && !item.droppedFor);

function Item({ item, number, problem, weaponName, active, onActive, reviewAll = false }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const cards = useCards();
  const textCards = useTextCards();
  const shown = item.name ?? item.suggestion;
  const kept = item.keep && item.name;
  const url = shown && !textCards ? (item.kind === 'arcane' ? cards?.arcaneUrl(shown) : cards?.modCompactUrl(shown)) : null;
  const max = shown ? (item.kind === 'arcane' ? arcaneMaxRank(shown, ctx.data) : maxRank(ctx.index.byName.get(shown))) : 0;
  const rank = item.rank == null ? max : Math.min(max, item.rank);
  const where = item.kind === 'arcane' ? 'Arcane' : item.slot === 8 ? 'Exilus' : slotLabel(item.slot);
  const rankText = item.rankSource === 'pips' ? 'Rank from the card' : item.rankSource === 'drain' ? 'Rank from the drain'
    : item.rankSource === 'set' ? 'Rank set by you' : 'Rank assumed max';
  const attention = !kept && !item.suggestion && item.attention;
  // Calm by default (docs/declutter-spec.md 3): a sure row needs no confidence pill, raw text or rank stepper.
  const compact = !reviewAll && isSureItem(item, problem);
  return (
    <div
      className={mergeClasses(styles.item, active && styles.itemOn)}
      data-testid="ocr-item"
      data-band={kept || item.suggestion ? (item.chosen ? 'high' : item.band) : attention ? 'check' : 'none'}
      data-state={item.state ?? null}
      data-key={item.key}
      onMouseEnter={() => onActive(item.key)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(item.key)}
      role="group"
      aria-label={`${number}. ${where}`}
    >
      <Caption1 className={styles.num} aria-hidden="true">{number}</Caption1>
      <span className={styles.thumb} aria-hidden="true">
        <span className={styles.thumbText}>{shown ?? (attention ? '?' : item.state === 'riven' ? 'Riven' : 'Empty')}</span>
        {url ? <span style={{ position: 'absolute', inset: 0, opacity: kept ? 1 : 0.4 }}><ArtImage src={url} fit={item.kind === 'arcane' ? 'contain' : 'cover'} backdrop={tokens.colorNeutralBackground3} /></span> : null}
      </span>
      <div className={styles.itemMain}>
        <div className={styles.itemHead}>
          <Caption1>{where}</Caption1>
          <Body1Strong>{kept ? item.name : item.suggestion ? `Suggestion: ${item.suggestion}` : item.kindNote ?? 'Empty'}</Body1Strong>
          {compact ? <Caption1 className={styles.raw} style={{ fontVariantNumeric: 'tabular-nums' }}>R{rank}/{max}</Caption1> : null}
          {!compact && (item.suggestion || kept) ? <ConfidenceBadge band={item.band} confidence={item.confidence} chosen={Boolean(item.chosen && kept)} /> : null}
          {attention ? <Badge appearance="tint" color="warning" icon={<WarningRegular />} size="medium">Check</Badge> : null}
        </div>
        {item.raw && !(item.chosen && kept) && !compact ? <Caption1 className={styles.raw}>Read as: "{item.raw}"</Caption1> : null}
        {attention ? (
          <Caption1 className={styles.attention}>
            {item.state === 'hidden' ? 'Something covers this slot in the screenshot. '
              : item.kind === 'arcane' && item.state === 'unknown' ? "An arcane's name wasn't readable here (on a translated game client it can't be). "
                : item.state === 'unread' ? `${item.kind === 'arcane' ? 'The arcane socket' : 'This slot'} wasn't found in the screenshot. ` : ''}
            Pick the {item.kind === 'arcane' ? 'arcane' : 'mod'} you see, or Leave empty. Otherwise Apply to current build keeps the build's own.
          </Caption1>
        ) : null}
        {item.droppedFor && !kept ? <Caption1 className={styles.problem}><WarningRegular aria-hidden="true" /> Set aside: you picked {item.droppedFor}, which clashes with it.</Caption1> : null}
        {problem && kept ? <Caption1 className={styles.problem}><WarningRegular aria-hidden="true" /> {problem}. It won't be applied.</Caption1> : null}
        {!kept && item.suggestion ? <Caption1 className={styles.raw}>Low confidence: not applied unless you choose it.</Caption1> : null}
        {kept && !compact ? (
          <div className={styles.rankRow}>
            <Caption1>{rankText}:</Caption1>
            <Button className={styles.step} size="small" appearance="subtle" icon={<SubtractRegular />} aria-label={`Lower ${item.name} rank`} disabled={rank <= 0} onClick={() => O.setItem(item.key, { rank: rank - 1, rankSource: 'set' })} />
            <Caption1 style={{ fontVariantNumeric: 'tabular-nums' }} aria-live="polite">R{rank}/{max}</Caption1>
            <Button className={styles.step} size="small" appearance="subtle" icon={<AddRegular />} aria-label={`Raise ${item.name} rank`} disabled={rank >= max} onClick={() => O.setItem(item.key, { rank: rank + 1, rankSource: 'set' })} />
          </div>
        ) : null}
        <div className={styles.actionsRow}>
          <ReplacePicker item={item} weaponName={weaponName} onPick={name => O.replaceItem(item.key, name)}>
            <Button size="small" appearance={attention ? 'primary' : 'secondary'} data-testid="ocr-replace">{kept || item.suggestion ? 'Replace' : item.kind === 'arcane' ? 'Pick arcane' : 'Pick mod'}</Button>
          </ReplacePicker>
          {kept && !compact ? <Button size="small" appearance="subtle" onClick={() => O.clearItem(item.key)}>Clear</Button> : null}
          {attention ? <Button size="small" appearance="subtle" onClick={() => O.clearItem(item.key)}>Leave empty</Button> : null}
          {!kept && item.suggestion ? <Button size="small" appearance="subtle" onClick={() => O.useSuggestion(item.key)}>Use suggestion</Button> : null}
        </div>
      </div>
    </div>
  );
}

function Screenshot({ ocr, numbered, active, onActive }) {
  const styles = useStyles();
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef(null);
  const img = ocr.image;
  const review = ocr.review;
  const aspect = img?.width && img?.height ? img.width / img.height : 16 / 9;
  const pct = (v, total) => `${(v / total) * 100}%`;
  const box = (b, extra = {}) => ({ left: pct(b.x - 4, img.width), top: pct(b.y - 4, img.height), width: pct(b.w + 8, img.width), height: pct(b.h + 8, img.height), ...extra });
  const regions = numbered.filter(n => n.box);
  return (
    <div className={styles.shotPane}>
      <div className={styles.shotTools}>
        <Tooltip content="Zoom out" relationship="label"><Button size="small" appearance="subtle" icon={<ZoomOutRegular />} disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.5))} /></Tooltip>
        <Caption1 style={{ fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Caption1>
        <Tooltip content="Zoom in" relationship="label"><Button size="small" appearance="subtle" icon={<ZoomInRegular />} disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + 0.5))} /></Tooltip>
        <ToggleButton size="small" appearance="subtle" checked={Boolean(ocr.showUnmatched)} onClick={() => O.toggleUnmatched(!ocr.showUnmatched)}>Show unrecognised text</ToggleButton>
      </div>
      <div
        className={styles.shotScroll}
        ref={scrollRef}
        onWheel={e => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom(z => Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))));
        }}
      >
        {img?.url ? (
          <div className={styles.shot} style={{ width: `${zoom * 100}%`, aspectRatio: String(aspect), maxWidth: zoom === 1 ? '100%' : 'none' }}>
            <img
              className={styles.shotImg}
              src={img.url}
              alt={`Your screenshot, ${img.width} by ${img.height} pixels, with ${regions.length} recognised regions`}
              draggable={false}
            />
            {ocr.showUnmatched ? (review?.unmatched ?? []).filter(u => u.box).map((u, i) => <span key={`u${i}`} className={styles.unmatched} style={box(u.box)} aria-hidden="true" />) : null}
            {regions.map(n => {
              const band = n.band;
              const on = active === n.key;
              return (
                <span
                  key={n.key}
                  className={mergeClasses(styles.region, on && styles.regionOn)}
                  data-testid="ocr-region"
                  data-index={n.number}
                  aria-hidden="true"
                  style={box(n.box, { borderStyle: BAND_BORDER[band], borderColor: BAND_COLOR[band], opacity: active && !on ? 0.4 : 1, pointerEvents: 'auto' })}
                  onMouseEnter={() => onActive(n.key)}
                  onMouseLeave={() => onActive(null)}
                >
                  <span className={styles.regionTag} style={{ backgroundColor: BAND_COLOR[band] === tokens.colorNeutralForeground3 ? '#c8c8c8' : band === 'high' ? '#7FE07A' : '#FFD56B' }}>{n.number}</span>
                </span>
              );
            })}
          </div>
        ) : <Caption1 style={{ padding: 16 }}>No preview.</Caption1>}
      </div>
    </div>
  );
}

function WeaponChoice({ review }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const [query, setQuery] = useState(null);
  const groups = useMemo(() => weaponMatches(ctx, query ?? ''), [ctx, query]);
  const supported = review.weaponName && ctx.weaponByName.has(review.weaponName);
  const band = bandOf(review.weaponConfidence);
  return (
    <>
      <div className={styles.weaponRow}>
        <Subtitle2 as="h3" style={{ margin: 0 }}>Weapon</Subtitle2>
        {review.recognisedWeapon && review.weaponName === review.recognisedWeapon ? <ConfidenceBadge band={band} confidence={review.weaponConfidence} /> : null}
      </div>
      <Combobox
        data-testid="ocr-weapon"
        aria-label="Weapon"
        value={query ?? (supported ? review.weaponName : '')}
        selectedOptions={supported ? [review.weaponName] : []}
        placeholder="Pick the weapon"
        onChange={e => setQuery(e.target.value)}
        onOptionSelect={(_e, d) => { setQuery(null); if (d.optionValue) O.setWeapon(d.optionValue); }}
        onOpenChange={(_e, d) => { if (!d.open) setQuery(null); }}
        positioning={{ autoSize: 'height' }}
      >
        {WEAPON_GROUPS.map(g => (groups[g].length ? (
          <OptionGroup key={g} label={g}>
            {groups[g].map(w => <Option key={w.name} value={w.name}>{w.name}</Option>)}
          </OptionGroup>
        ) : null))}
      </Combobox>
      {review.weaponRaw ? <Caption1 className={styles.raw}>Read as: "{review.weaponRaw}"</Caption1> : null}
      {review.recognisedWeapon && !ctx.weaponByName.has(review.recognisedWeapon) && !supported ? (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{review.recognisedWeapon} was recognised, but only primary and secondary guns are supported. Pick a gun to continue.</MessageBarBody>
        </MessageBar>
      ) : null}
      {review.weaponFromCurrent && supported ? (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>The weapon wasn't recognised. Using the open build's weapon, {review.weaponName}, because every recognised mod fits it. Check it.</MessageBarBody>
        </MessageBar>
      ) : null}
      {!review.recognisedWeapon && !supported ? (
        <MessageBar intent="info" layout="multiline"><MessageBarBody>The weapon wasn't recognised. Pick it to continue.</MessageBarBody></MessageBar>
      ) : null}
    </>
  );
}

function Review({ ocr }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const [active, setActive] = useState(null);
  const [reviewAll, setReviewAll] = useState(false);
  const review = ocr.review;
  const problems = itemProblems(ctx, review);
  const sure = review.items.filter(it => isSureItem(it, problems.get(it.key))).length;
  const numbered = review.items.map((it, i) => ({ ...it, number: i + 1 }));
  const supported = review.weaponName && ctx.weaponByName.has(review.weaponName);
  const parts = supported ? appliedParts(ctx, review) : null;
  const build = useApp(s => s.build);
  // What Apply to current build would keep of the open build (slots the screenshot said nothing reliable about).
  let kept = null;
  if (parts && build) {
    const current = build.weaponName === parts.weaponName ? build : changeWeapon(ctx, build, parts.weaponName).build;
    const m = mergeWithCurrent(ctx, review, parts, current);
    kept = m.keptSlots.length || m.keptArcane ? O.keptText(m).replace(/^Kept/, 'Apply to current build keeps') : null;
  }
  return (
    <div className={styles.panes}>
      <Screenshot ocr={ocr} numbered={numbered} active={active} onActive={setActive} />
      <div className={styles.list}>
        <WeaponChoice review={review} />
        <div className={styles.weaponRow} style={{ marginTop: 8 }}>
          <Subtitle2 as="h3" style={{ margin: 0, flexGrow: 1 }}>Arcane, Exilus and slots</Subtitle2>
          {sure ? (
            <ToggleButton size="small" appearance="subtle" checked={reviewAll} onClick={() => setReviewAll(v => !v)} data-testid="ocr-review-all">
              {reviewAll ? 'Show less' : `Review all (${sure} read clearly)`}
            </ToggleButton>
          ) : null}
        </div>
        {numbered.map(it => (
          <Item key={it.key} item={it} number={it.number} problem={problems.get(it.key)} weaponName={review.weaponName} active={active === it.key} onActive={setActive} reviewAll={reviewAll} />
        ))}
        {review.unmatched.length ? (
          <Accordion collapsible>
            <AccordionItem value="unmatched">
              <AccordionHeader size="small">Unrecognised text ({review.unmatched.length})</AccordionHeader>
              <AccordionPanel>
                {review.unmatched.map((u, i) => {
                  const target = review.items.find(x => x.kind === 'mod' && !x.name) ?? null;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Caption1 style={{ flexGrow: 1 }}>"{u.raw}"</Caption1>
                      {target ? (
                        <ReplacePicker item={{ ...target, raw: u.raw }} weaponName={review.weaponName} onPick={name => O.replaceItem(target.key, name)}>
                          <Link as="button">Search for this</Link>
                        </ReplacePicker>
                      ) : null}
                    </div>
                  );
                })}
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        ) : null}
        {parts ? <Caption1 className={styles.raw}>Applies {parts.mods.filter(Boolean).length} mods{parts.arcane ? ' and the arcane' : ''}.</Caption1> : null}
        {kept ? <Caption1 className={styles.raw} data-testid="ocr-kept-note">{kept}</Caption1> : null}
        <Caption1 className={styles.raw} data-testid="ocr-polarity-note">
          Slot polarities (Forma) aren't read from screenshots. If the mods don't fit the weapon's capacity, matching polarities are assumed where they'd save the most drain; check them after applying.
        </Caption1>
      </div>
    </div>
  );
}

function Progress({ ocr }) {
  const styles = useStyles();
  const n = O.STEPS.length;
  return (
    <div className={styles.progress} data-testid="ocr-progress">
      <ProgressBar value={(ocr.step + 0.5) / n} thickness="large" aria-label="Import progress" />
      <Body1 role="status">{O.STEPS[ocr.step]} (step {ocr.step + 1} of {n})</Body1>
      {ocr.slow ? <MessageBar intent="warning"><MessageBarBody>This is taking longer than usual.</MessageBarBody></MessageBar> : null}
      <Privacy />
    </div>
  );
}

function ErrorState({ ocr }) {
  const styles = useStyles();
  const e = ocr.error;
  const [showText, setShowText] = useState(false);
  return (
    <div className={styles.progress} data-testid="ocr-error" data-code={e.code}>
      <MessageBar intent={e.code === 'no-mods' || e.code === 'no-text' ? 'warning' : 'error'} layout="multiline">
        <MessageBarBody>
          <Body1Strong>{e.title}</Body1Strong> {e.body}
        </MessageBarBody>
        <MessageBarActions>
          {e.actions.includes('choose-file') ? <Button size="small" onClick={() => O.chooseFile()}>Choose another file</Button> : null}
          {e.actions.includes('settings') ? <Button size="small" onClick={() => uf.ocr?.openLanguageSettings?.()}>Open language settings</Button> : null}
          {e.actions.includes('retry') ? <Button size="small" onClick={() => O.retry()}>Try again</Button> : null}
          {e.actions.includes('show-text') && ocr.lines?.length ? <Button size="small" onClick={() => setShowText(v => !v)}>{showText ? 'Hide recognised text' : 'Show recognised text'}</Button> : null}
        </MessageBarActions>
      </MessageBar>
      {showText ? (
        <div style={{ maxHeight: 240, overflowY: 'auto', fontFamily: 'Consolas, monospace', fontSize: 12 }}>
          {ocr.lines.slice(0, 200).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      ) : null}
      <Privacy />
    </div>
  );
}

/**
 * While the dialog is up, Escape closes it and focus can't wander onto the page behind it, whatever surface opened
 * it. (The Import menu closes after its item has opened the dialog and puts focus back on its trigger, behind the
 * modal; Fluent's own Escape handling only sees keys pressed inside the surface.)
 */
function useModalGuard(open, surfaceRef) {
  useEffect(() => {
    if (!open) return undefined;
    // Layers that belong to the dialog: its surface, and portals it opens (Replace popover, weapon list, tooltips).
    const inLayer = el => Boolean(el?.closest?.('[data-ocr-surface], .fui-PopoverSurface, .fui-Listbox, .fui-Tooltip__content, [role="listbox"], [role="menu"]'));
    const firstFocusable = () => surfaceRef.current?.querySelector('[data-testid="ocr-close"]') ?? surfaceRef.current?.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (inLayer(e.target)) return; // inside the dialog, Fluent closes it (or the open popover) itself
      e.preventDefault();
      e.stopPropagation();
      O.close();
    };
    const onFocusIn = e => {
      if (inLayer(e.target)) return;
      firstFocusable()?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [open, surfaceRef]);
}

export function OcrDialog() {
  const styles = useStyles();
  const ocr = useApp(s => s.ocr);
  const ctx = useApp(s => s.ctx);
  const surfaceRef = useRef(null);
  useModalGuard(Boolean(ocr), surfaceRef);
  if (!ocr) return null;
  const review = ocr.phase === 'review' ? ocr.review : null;
  const supported = review && review.weaponName && ctx.weaponByName.has(review.weaponName);
  const title = ocr.phase === 'review' ? 'Review imported build' : ocr.phase === 'error' ? "Couldn't import the screenshot" : 'Importing a screenshot';
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => { if (!d.open) O.close(); }}>
      <DialogSurface
        ref={surfaceRef}
        data-ocr-surface=""
        className={mergeClasses(styles.surface, ocr.phase !== 'review' && styles.surfaceSmall)}
        style={ocr.phase !== 'review' ? { height: 'fit-content', minHeight: 0 } : undefined}
        data-testid={ocr.phase === 'review' ? 'ocr-review' : undefined}
        aria-label={title}
      >
        <DialogBody className={styles.body} style={ocr.phase !== 'review' ? { flexGrow: 0 } : undefined}>

          <div className={styles.titleRow}>
            <DialogTitle>{title}</DialogTitle>
            <Button appearance="subtle" aria-label="Close" data-testid="ocr-close" icon={<DismissRegular />} onClick={() => O.close()} />
          </div>

          <DialogContent className={styles.content}>
            {ocr.phase === 'progress' ? <Progress ocr={ocr} /> : null}
            {ocr.phase === 'error' ? <ErrorState ocr={ocr} /> : null}
            {review ? <Review ocr={ocr} /> : null}
            {review ? <Privacy /> : null}
          </DialogContent>
          <DialogActions fluid>
            {review ? (
              <>
                <Caption1 className={styles.footCaption}>Only items you keep are applied. Slots not read clearly stay empty in a new build; Apply to current build keeps the build's own there.</Caption1>
                <Tooltip content={supported ? 'An unsaved build with these mods' : 'Pick a supported weapon first'} relationship="description">
                  <Button appearance="primary" data-testid="ocr-apply-new" disabledFocusable={!supported} onClick={() => O.applyAsNew()}>Open as new build</Button>
                </Tooltip>
                <Tooltip content={supported ? 'Replace the weapon, mods and arcane of the open build (one undo step)' : 'Pick a supported weapon first'} relationship="description">
                  <Button data-testid="ocr-apply-current" disabledFocusable={!supported} onClick={() => O.applyToCurrent()}>Apply to current build</Button>
                </Tooltip>
              </>
            ) : null}
            <Button onClick={() => O.close()}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
