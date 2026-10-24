// Arsenal slot cards (docs/arsenal-spec.md 4.5-4.7, calmed by docs/declutter-spec.md 3): the compact card image of
// the equipped mod with at most a drain + polarity plate (neutral when the polarity matches, red only when it
// doesn't), the rank as shadowed text only below max, and a neutral honesty glyph; the hover/focus action strip; the
// empty, Exilus and arcane states (the arcane's stacks as plain text under the dome); and the drop-target feedback
// for drag and drop and keyboard pick-up. Text cards stand in when an image is missing.
import { useState } from 'react';
import {
  Body1Strong, Button, Caption1, Caption1Strong, Field, Menu, MenuDivider, MenuGroup, MenuGroupHeader,
  MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Popover, PopoverSurface, PopoverTrigger, ProgressBar,
  SpinButton, Switch, Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowDownRegular, ArrowSwapRegular, ArrowUpRegular, BookmarkOffRegular, BookmarkRegular, CircleHalfFillRegular, DeleteRegular,
  DiamondRegular, DismissRegular, EditRegular, InfoRegular, LayerRegular, MoreHorizontalRegular, ProhibitedRegular, SparkleRegular, SubtractRegular,
} from '@fluentui/react-icons';
import { actions, announce, focusLater, store } from '../controller.js';

import { useApp, useDerived } from '../hooks.js';
import { EXILUS_SLOT, arcaneFocusId, arcaneIndexOf, arcaneSlotId, isArcaneSlot, slotLabel } from '../model.js';
import { maxRank, modEffectSummary } from '../../shared/mods.js';
import { SLOT_POLARITIES } from '../../shared/capacity.js';
import { arcaneControls, arcaneMaxRank, arcaneStacksText, arcaneSummary, arcaneSupport, arcanesFor } from '../../shared/arcanes.js';
import { modConditionalControls, modConditionalSummary, modStacksOf, modStacksText } from '../../shared/conditional-mods.js';
import { modRarityFrame } from '../../shared/card-assets.js';
import { RIVEN_CAPACITY_MOD, RIVEN_MAX_RANK, canTakeRiven, isRiven, rivenLines, rivenShortName, rivenSlotBlockReason } from '../../shared/rivens.js';
import { ARCANE_MIME, MOD_MIME, dropInfo } from '../dnd.js';
import { hasNoStats } from './common.jsx';
import { ArtImage, OVERLAY, PolarityGlyph, RARITY_TOKEN, polarityName, useCards, useTextCards } from './art.jsx';

const RARITY_OF_FRAME = { Bronze: 'common', Silver: 'uncommon', Gold: 'rare', Legendary: 'legendary', Riven: 'legendary' };
const BUSY_TIP = 'A best-mod search is running for this slot';
const MATCH_TEXT = { match: 'matches polarity', mismatch: "doesn't match polarity", neutral: null };

// The arch of an arcane: a half-ellipse over a flat base, in the proportions of the arcane art (464x340).
const DOME_RADIUS = '50% 50% 6px 6px / 100% 100% 6px 6px';
const ARCANE_ASPECT = 464 / 340;
// Room under the dome for one line of plain text (rank below max, stacks); the hover pill overlaps the art's flat base
// a little, so a filled dome is as big as an empty one.
const PILL_ROOM = 18;

const useStyles = makeStyles({
  root: {
    position: 'relative',
    borderRadius: tokens.borderRadiusLarge,
    boxSizing: 'border-box',
    minWidth: 0,
  },
  // The card face (text card and image) sits under a transparent button with no text of its own: the button's
  // accessible name carries everything, and nothing visible inside it contradicts that name.
  face: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.borderRadiusLarge,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    textAlign: 'center',
    pointerEvents: 'none',
  },
  primary: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    padding: 0,
    border: 'none',
    borderRadius: tokens.borderRadiusLarge,
    cursor: 'pointer',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    outlineStyle: 'none',
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  textCard: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    padding: '18px 10px 26px',
    boxSizing: 'border-box',
  },
  textName: {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    lineHeight: '18px',
  },
  textEffect: {
    color: tokens.colorNeutralForeground2,
    display: '-webkit-box',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  // A riven's text card: its stat lines, one per line, as many as the slot's height allows.
  rivenLine: { color: tokens.colorNeutralForeground2, lineHeight: '16px', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  art: { position: 'absolute', inset: 0 },
  frame: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.borderRadiusLarge,
    pointerEvents: 'none',
    '@media (forced-colors: active)': { boxShadow: 'none !important', border: '1px solid CanvasText' },
  },
  selected: {
    outline: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '2px',
    '@media (forced-colors: active)': { outlineColor: 'Highlight' },
  },
  plate: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: OVERLAY.scrim,
    fontVariantNumeric: 'tabular-nums',
    border: '1px solid transparent',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText' },
  },
  // A matching polarity is the normal case, so it stays neutral (the ↓ says it); colour is kept for the exception.
  plateMatch: { color: OVERLAY.neutral, '@media (forced-colors: active)': { borderColor: 'CanvasText', borderStyle: 'solid', color: 'CanvasText' } },
  plateMismatch: { color: OVERLAY.mismatch, borderColor: OVERLAY.mismatch, borderStyle: 'dashed', '@media (forced-colors: active)': { borderColor: 'CanvasText', color: 'CanvasText' } },
  plateNeutral: { color: OVERLAY.neutral },
  // Short strip slots (picking at 1100 px): plates hug the corners so the name on the art stays readable.
  plateCompact: { top: '2px', right: '2px', padding: '0 4px' },
  cornerCompact: { top: '2px', left: '2px', width: '18px', height: '18px', fontSize: '12px' },
  arrow: { fontSize: '12px' },
  // Top left, across from the drain plate: the card art prints the mod's name below that row. A neutral glyph, not
  // a coloured badge (docs/declutter-spec.md 3); the Readout's honesty line has the details.
  honesty: {
    position: 'absolute', left: '6px', top: '6px', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: tokens.borderRadiusMedium, backgroundColor: OVERLAY.scrim, color: OVERLAY.neutral,
    pointerEvents: 'none', fontSize: '14px',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', border: '1px solid CanvasText' },
  },
  // A conditional mod's stacks (Galvanized: "×5"; a one-stack conditional: On / Off), top left after the honesty glyph:
  // the hover strip covers the bottom, and this stays reachable while it shows.
  stacksChip: {
    position: 'absolute', left: '4px', top: '4px', height: '24px', minWidth: '24px', padding: '0 6px', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: tokens.borderRadiusMedium, cursor: 'pointer',
    backgroundColor: OVERLAY.scrim, color: OVERLAY.neutral, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
    ':hover': { backgroundColor: 'rgba(0,0,0,0.85)' },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' },
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'ButtonFace', color: 'ButtonText', border: '1px solid ButtonText' },
  },
  stacksChipShifted: { left: '30px' },
  stacksChipCompact: { top: '2px', left: '2px', padding: '0 4px' },
  stacksChipCompactShifted: { left: '22px' },
  stacksOff: { color: 'rgba(255,255,255,0.6)', textDecorationLine: 'line-through' },
  // At rest the rank shows only below max ("3/5"), as shadowed text on the art (no plate); −/+ come with the hover strip.
  rankPlate: {
    position: 'absolute', right: '12px', bottom: '14%', pointerEvents: 'none', lineHeight: '16px',
    textShadow: '0 0 2px #000, 0 0 4px #000, 0 1px 3px #000',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', textShadow: 'none', padding: '0 4px' },
  },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '0 4px',
    backgroundColor: OVERLAY.strip,
    color: OVERLAY.neutral,
    borderBottomLeftRadius: tokens.borderRadiusLarge,
    borderBottomRightRadius: tokens.borderRadiusLarge,
    pointerEvents: 'none',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', borderTop: '1px solid CanvasText' },
  },
  // With the actions shown the strip is [− n/max +] … [best ×]: the pips give way to the number, so nothing overlaps
  // even on 10-rank mods in a 150 px slot. Only the buttons take the pointer: on a 56 px slot the strip covers the
  // middle of the card, and a click between the buttons must still reach the slot.
  stripActive: { justifyContent: 'space-between', height: '28px', gap: '2px' },
  rankText: { color: OVERLAY.neutral, fontVariantNumeric: 'tabular-nums', '@media (forced-colors: active)': { color: 'CanvasText' } },
  actionGroup: { display: 'inline-flex', alignItems: 'center', gap: '2px', '& button': { pointerEvents: 'auto' } },
  action: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: 0,
    color: OVERLAY.neutral,
    ':hover': { color: OVERLAY.neutral, backgroundColor: 'rgba(255,255,255,0.16)' },
    ':hover:active': { color: OVERLAY.neutral, backgroundColor: 'rgba(255,255,255,0.24)' },
    ':disabled': { color: 'rgba(255,255,255,0.4)' },
    '@media (forced-colors: active)': { color: 'ButtonText' },
  },
  more: {
    position: 'absolute',
    top: '4px',
    right: '64px',
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: 0,
    color: OVERLAY.neutral,
    backgroundColor: OVERLAY.scrim,
    ':hover': { color: OVERLAY.neutral, backgroundColor: 'rgba(0,0,0,0.85)' },
  },
  busy: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px', padding: '0 12px',
    backgroundColor: 'rgba(0,0,0,0.72)', color: OVERLAY.neutral, borderRadius: tokens.borderRadiusLarge,
  },
  // Empty slots
  empty: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    color: tokens.colorNeutralForeground3,
    padding: 0,
  },
  emptyCaption: { color: tokens.colorNeutralForeground2 },
  emptyBest: { position: 'absolute', right: '4px', bottom: '4px', minWidth: '24px', width: '24px', height: '24px', padding: 0 },
  // Drag feedback
  accept: { boxShadow: `0 0 0 2px ${tokens.colorNeutralStroke1}` },
  acceptMatch: { boxShadow: `0 0 0 2px ${tokens.colorPaletteGreenBorder2}` },
  acceptMismatch: { boxShadow: `0 0 0 2px ${tokens.colorPaletteRedBorder2}` },
  over: { boxShadow: `0 0 0 3px ${tokens.colorBrandStroke1}` },
  refused: {},
  refusedScrim: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBackgroundOverlay,
    pointerEvents: 'none',
  },
  dropHint: {
    position: 'absolute',
    left: '4px',
    right: '4px',
    bottom: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow4,
    pointerEvents: 'none',
    textAlign: 'center',
  },
  // Projected drain while dragging: the plate shows what the dragged mod would cost here, with a dotted outline
  // so it doesn't read as the equipped mod's own drain.
  plateProjected: { borderStyle: 'dotted', opacity: 1 },
  faceDimmed: { opacity: 0.55 },
  // Arcane slot: shaped like an arcane. A dome (the arcane art's arch, flat base) centred in the cell, with the rank
  // pill under it. Focus, selection and drag rings follow the dome; the name is in the caption above (ArcaneCaption).
  dome: {
    position: 'absolute',
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    boxSizing: 'border-box',
    borderRadius: DOME_RADIUS,
  },
  domeButton: {
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    outlineStyle: 'none',
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: '2px' },
  },
  domeEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
    paddingBottom: '8px',
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground3,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover, borderColor: tokens.colorNeutralStroke1Hover },
    ':disabled': { cursor: 'default', color: tokens.colorNeutralForegroundDisabled, backgroundColor: 'transparent' },
    '@media (forced-colors: active)': { borderColor: 'CanvasText' },
  },
  domeText: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: '0 12px 6px',
    textAlign: 'center',
    border: `${tokens.strokeWidthThick} solid`,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  domeScrim: { backgroundColor: tokens.colorBackgroundOverlay, pointerEvents: 'none' },
  pill: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    height: '22px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 8px',
    borderRadius: '11px',
    backgroundColor: OVERLAY.strip,
    color: OVERLAY.neutral,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', border: '1px solid CanvasText' },
  },
  pillActive: { height: '26px', borderRadius: '13px', padding: '0 2px', gap: '2px', pointerEvents: 'auto' },
  // Under the dome: the rank below max and the stacks, as plain text (docs/declutter-spec.md 3); the stacks open
  // their popover.
  under: {
    position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', maxWidth: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: '4px', color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', minHeight: '18px',
  },
  stacksText: { color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '18px' },
  stacksButton: {
    border: 'none', padding: '0 4px', background: 'none', cursor: 'pointer', borderRadius: tokens.borderRadiusMedium, minHeight: '24px',
    display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', color: tokens.colorNeutralForeground2, fontFamily: 'inherit',
    marginBottom: '-3px',
    ':hover': { color: tokens.colorNeutralForeground1, textDecorationLine: 'underline' },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  popover: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, maxWidth: '300px' },
});

/** The drag or keyboard pick-up in progress, as one shape. */
function useActiveDrag() {
  const drag = useApp(s => s.drag);
  const pickup = useApp(s => s.pickup);
  return drag ?? pickup ?? null;
}

function useSweep(slot) {
  const sweep = useApp(s => s.sweep);
  const running = sweep?.status === 'running';
  return { running, here: running && sweep.slot === slot };
}

/** Common key handling on a slot's primary button. */
function onSlotKeys(e, { slot, value, max, selected, kind = 'mod' }) {
  const pickup = store.get().pickup;
  if (pickup) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.dropPickup(slot); return true; }
    if (e.key === 'Escape') { e.preventDefault(); actions.cancelPickup(); return true; }
    if (e.key === 'Delete' && Number.isInteger(pickup.from)) { e.preventDefault(); actions.removePickup(); return true; }
    return false;
  }
  // Space picks a filled slot's card up (arrows move it, Space or Enter drops it); Enter opens the Picker for it.
  if (e.key === ' ' && value) {
    e.preventDefault();
    actions.startPickup({ kind, name: value.name, from: slot, target: slot });
    return true;
  }
  if (!value) return false;
  const arcane = Math.max(0, arcaneIndexOf(slot));
  const setRank = r => (kind === 'arcane' ? actions.setArcaneRank(arcane, r) : actions.setRank(slot, r));
  const k = e.key;
  if (k === '+' || k === '=') { e.preventDefault(); setRank(value.rank + 1); announceRank(value.name, Math.min(max, value.rank + 1), max); return true; }
  if (k === '-') { e.preventDefault(); setRank(value.rank - 1); announceRank(value.name, Math.max(0, value.rank - 1), max); return true; }
  if (k === 'Home') { e.preventDefault(); setRank(0); announceRank(value.name, 0, max); return true; }
  if (k === 'End') { e.preventDefault(); setRank(max); announceRank(value.name, max, max); return true; }
  if (k === 'Delete' || k === 'Backspace') {
    e.preventDefault();
    if (kind === 'arcane') actions.clearArcane(arcane);
    else actions.clearSlot(slot);
    return true;
  }
  if (k === 'Enter' && e.shiftKey && kind === 'mod') { e.preventDefault(); actions.startSweep(slot); return true; }
  if (e.altKey && e.shiftKey && k.startsWith('Arrow') && kind === 'mod') {
    e.preventDefault();
    e.stopPropagation();
    actions.swapNeighbour(slot, k.slice(5).toLowerCase());
    return true;
  }
  return false;
}

function announceRank(name, rank, max) {
  announce(`${name} rank ${rank} of ${max}`);
}

/** Drag a filled slot (or the arcane): native HTML5 drag with the compact image as the drag image. */
function startDrag(e, { kind, name, from, image }) {
  const mime = kind === 'arcane' ? ARCANE_MIME : MOD_MIME;
  e.dataTransfer.setData(mime, JSON.stringify({ name, from }));
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'move';
  if (image) e.dataTransfer.setDragImage(image, image.width / 2, image.height / 2);
  // State changes after dragstart returns, or Chromium cancels the drag when the DOM under the pointer changes.
  setTimeout(() => actions.setDrag({ kind, name, from }), 0);
}

/** Drop handlers for a slot (mods) or the arcane slot. */
function useDropTarget(slot) {
  const { ctx, build } = { ctx: useApp(s => s.ctx), build: useApp(s => s.build) };
  const { capacity } = useDerived();
  const drag = useApp(s => s.drag);
  const info = drag ? dropInfo(ctx, build, drag, slot, capacity?.polarities) : null;
  const props = {
    onDragOver: e => {
      const d = store.get().drag;
      if (!d) return;
      const i = dropInfo(ctx, store.get().build, d, slot, capacity?.polarities);
      if (!i.accept) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (d.over !== slot) actions.setDrag({ ...d, over: slot });
    },
    onDragLeave: e => {
      const d = store.get().drag;
      if (d?.over === slot && !e.currentTarget.contains(e.relatedTarget)) actions.setDrag({ ...d, over: null });
    },
    onDrop: e => {
      const d = store.get().drag;
      e.preventDefault();
      actions.setDrag(null);
      if (!d) return;
      if (d.kind === 'arcane') {
        if (isArcaneSlot(slot) && actions.equipArcane(d.name, arcaneIndexOf(slot)).ok) focusLater(arcaneFocusId(arcaneIndexOf(slot)));
        return;
      }
      // Focus follows the mod to where it was dropped (spec 9), also for a slot-to-slot swap.
      if (actions.dropMod(d.name, d.from, slot)) focusLater(`slot-select-${slot}`);
    },
  };
  return { info, over: drag?.over === slot, props };
}

/** Outline class for a slot while something is dragged or picked up. */
function dragClass(styles, info, over) {
  if (!info) return null;
  if (!info.accept) return info.reason ? styles.refused : null;
  if (over) return styles.over;
  return info.effect === 'match' ? styles.acceptMatch : info.effect === 'mismatch' ? styles.acceptMismatch : styles.accept;
}

function DrainPlate({ slot, drain, effect, base, polarity, modPolarity, testId = true, projected = null, compact = false }) {
  const styles = useStyles();
  const polName = polarityName(polarity);
  const tip = projected ? `${projected} would drain ${drain} here${effect === 'match' ? ' (matching polarity)' : effect === 'mismatch' ? " (polarity doesn't match)" : ''}`
    : effect === 'match'
    ? `Drain ${drain} (${base} halved by the ${polName} slot)`
    : effect === 'mismatch'
      ? `Drain ${drain} (${base} + 25%, polarity doesn't match the ${polName} slot)`
      : `Drain ${drain}`;
  return (
    <Tooltip content={tip} relationship="description" positioning="above-end">
      <span
        className={mergeClasses(styles.plate, effect === 'match' ? styles.plateMatch : effect === 'mismatch' ? styles.plateMismatch : styles.plateNeutral, projected && styles.plateProjected, compact && styles.plateCompact)}
        data-testid={testId ? `slot-drain-${slot}` : undefined}
        data-match={effect}
        data-projected={projected ? '' : undefined}
        tabIndex={-1}
      >
        {effect === 'match' ? <ArrowDownRegular className={styles.arrow} aria-hidden="true" /> : null}
        {effect === 'mismatch' ? <ArrowUpRegular className={styles.arrow} aria-hidden="true" /> : null}
        <Caption1Strong style={{ color: 'inherit' }}>{drain}</Caption1Strong>
        <PolarityGlyph code={modPolarity} size={14} />
      </span>
    </Tooltip>
  );
}

/** Honesty on a slot: one neutral glyph; what it means is in the slot's description and the Readout's honesty line. */
function HonestyGlyph({ partial, noStats, compact = false }) {
  const styles = useStyles();
  if (!partial.length && !noStats) return null;
  return (
    <span className={mergeClasses(styles.honesty, compact && styles.cornerCompact)} aria-hidden="true" data-testid="slot-honesty">
      {partial.length ? <CircleHalfFillRegular /> : <InfoRegular />}
    </span>
  );
}

/** Spoken honesty note for a slot's description. */
const honestyText = (partial, noStats) => [
  partial.length ? `Partially simulated: ${partial.join(', ')} not modelled` : null,
  noStats ? 'Engine-only: no numeric stats in the data' : null,
].filter(Boolean).join('. ');

function PolarityMenuItems({ slot }) {
  const innate = useDerived().capacity?.innate?.[slot] ?? null;
  return (
    <MenuGroup>
      <MenuGroupHeader>Slot polarity (Forma)</MenuGroupHeader>
      {SLOT_POLARITIES.map(code => (
        <MenuItemRadio key={code} name="polarity" value={code} icon={<PolarityGlyph code={code} size={16} />}>
          {code === 'AP_UNIVERSAL' ? 'None' : polarityName(code)}{(innate ?? 'AP_UNIVERSAL') === code ? ' (innate)' : ''}
        </MenuItemRadio>
      ))}
      <MenuItem onClick={() => actions.setSlotPolarity(slot, null)}>Reset to innate</MenuItem>
    </MenuGroup>
  );
}

/**
 * The riven items of a slot menu (docs/port-rivens.md 11.5): Edit riven… and the library entry on a riven slot; New
 * riven… on another general slot of a weapon that takes rivens (disabled, with the reason, when another slot has one).
 */
function RivenMenuItems({ slot, value }) {
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const inLibrary = useApp(s => Boolean(value?.id && s.rivenLibrary.rivens.some(r => r.id === value.id)));
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (slot === EXILUS_SLOT || !canTakeRiven(weapon)) return null;
  // Opened after the menu has closed and given focus back, so the dialog returns focus to the slot.
  if (isRiven(value)) {
    return (
      <>
        <MenuItem icon={<EditRegular />} onClick={() => setTimeout(() => actions.openRivenDialog(slot), 0)}>Edit riven…</MenuItem>
        {inLibrary
          ? <MenuItem icon={<BookmarkOffRegular />} onClick={() => actions.removeLibraryRiven(value.id)}>Remove from your rivens</MenuItem>
          : <MenuItem icon={<BookmarkRegular />} onClick={() => actions.saveRivenToLibrary(slot)}>Save to your rivens</MenuItem>}
      </>
    );
  }
  const reason = rivenSlotBlockReason(build, weapon, slot);
  return (
    <MenuItem icon={<EditRegular />} disabled={Boolean(reason)} secondaryContent={reason ?? undefined} onClick={() => setTimeout(() => actions.openRivenDialog(slot), 0)}>
      New riven…
    </MenuItem>
  );
}

/** The slot menu (More button, Shift+F10, context menu). */
function SlotMenu({ slot, value, open, setOpen, here, running, trigger, onStacks = null, stacksText = null }) {
  const polarity = useDerived().capacity?.polarities?.[slot] ?? null;
  return (
    <Menu
      open={open}
      onOpenChange={(_e, d) => setOpen(d.open)}
      positioning="below-end"
      checkedValues={{ polarity: [polarity ?? 'AP_UNIVERSAL'] }}
      onCheckedValueChange={(_e, d) => { if (d.name === 'polarity') actions.setSlotPolarity(slot, d.checkedItems[0]); }}
    >
      <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
      <MenuPopover>
        <MenuList>
          {value ? <MenuItem icon={<ArrowSwapRegular />} onClick={() => actions.selectSlot(slot, { focusGallery: true })}>Change mod</MenuItem> : (
            <MenuItem icon={<AddRegular />} onClick={() => actions.selectSlot(slot, { focusGallery: true })}>Choose a mod</MenuItem>
          )}
          <MenuItem icon={<SparkleRegular />} disabled={running} secondaryContent="Shift+Enter" onClick={() => actions.startSweep(slot)}>
            {value ? 'Find a better mod' : 'Find best mod'}
          </MenuItem>
          {value && onStacks ? (
            // Opens after the menu has closed and given focus back, so the popover keeps it.
            <MenuItem icon={<LayerRegular />} onClick={() => setTimeout(onStacks, 0)}>Stacks ({stacksText})…</MenuItem>
          ) : null}
          <RivenMenuItems slot={slot} value={value} />
          {value ? <MenuItem icon={<DeleteRegular />} secondaryContent="Del" disabled={here} onClick={() => actions.clearSlot(slot)}>Remove</MenuItem> : null}
          <MenuDivider />
          <PolarityMenuItems slot={slot} />
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** One mod slot (0-7 general, 8 Exilus). */
export function ModSlot({ slot, width, height, caption = null, tabbable = true }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const value = useApp(s => s.build?.mods[slot] ?? null);
  const selected = useApp(s => s.selectedSlot === slot);
  const picking = useApp(s => s.pickerOpen);
  const pickup = useApp(s => s.pickup);
  const cards = useCards();
  const textCards = useTextCards();
  const { capacity, partialMap } = useDerived();
  const { running, here } = useSweep(slot);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stacksOpen, setStacksOpen] = useState(false);
  const drop = useDropTarget(slot);
  const active = useActiveDrag();
  const info = active ? dropInfo(ctx, store.get().build, active, slot, capacity?.polarities) : null;
  const over = drop.over || (pickup && pickup.at === slot);
  const polarity = capacity?.polarities?.[slot] ?? null;
  const polName = polarityName(polarity);
  const label = slot === EXILUS_SLOT ? 'Exilus slot' : slotLabel(slot);
  const polarityPart = polName ? `, ${polName} slot` : '';

  const rootClass = mergeClasses(styles.root, selected && styles.selected, dragClass(styles, info, over));
  const rootHandlers = {
    ...drop.props,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => {
      setFocusWithin(true);
      if (store.get().pickup) actions.movePickup(slot);
    },
    onBlur: e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false); },
    onContextMenu: e => { e.preventDefault(); setMenuOpen(true); },
  };

  const dropHint = info && (over || !info.accept) && (info.label || info.reason) ? (
    <>
      {info.accept ? null : <span className={styles.refusedScrim} aria-hidden="true" />}
      <span className={styles.dropHint}>
        {info.accept ? null : <ProhibitedRegular aria-hidden="true" />}
        <Caption1>{info.accept ? info.label : info.reason}</Caption1>
      </span>
    </>
  ) : null;

  if (!value) {
    const name = `${slot === EXILUS_SLOT ? 'Exilus slot' : slotLabel(slot)}${polarityPart}, empty${selected ? ', selected' : ''}`;
    return (
      <div className={rootClass} style={{ width, height }} data-testid={`slot-${slot}`} data-slot={slot} {...rootHandlers}>
        {here ? <SweepBusy slot={slot} /> : (
          <Button
            appearance="subtle"
            className={styles.empty}
            data-testid={`slot-add-${slot}`}
            data-focus-id={`slot-add-${slot}`}
            data-slot-button="" tabIndex={tabbable ? 0 : -1}
            aria-label={name}
            aria-pressed={selected}
            onClick={() => (store.get().pickup ? actions.dropPickup(slot) : actions.toggleSlot(slot))}
            onKeyDown={e => {
              if (onSlotKeys(e, { slot, value: null, max: 0, selected })) return;
              if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); actions.startSweep(slot); }
              if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); setMenuOpen(true); }
            }}
          >
            {polarity ? <PolarityGlyph code={polarity} size={22} /> : <AddRegular aria-hidden="true" />}
            <Caption1 className={styles.emptyCaption}>{caption ?? (slot === EXILUS_SLOT ? 'Exilus' : slotLabel(slot))}</Caption1>
          </Button>
        )}
        {info?.accept && info.drain != null ? (
          <DrainPlate slot={slot} drain={info.drain} effect={info.effect} base={info.drain} polarity={polarity} modPolarity={info.modPolarity} projected={active.name} />
        ) : null}
        {(hover || focusWithin) && !(picking && selected) && !here && !active ? (
          <SlotMenu
            slot={slot}
            value={null}
            open={menuOpen}
            setOpen={setMenuOpen}
            here={here}
            running={running}
            trigger={(
              <Button appearance="transparent" className={styles.emptyBest} icon={<MoreHorizontalRegular />} aria-label={`More options for ${label.toLowerCase()}`} tabIndex={-1} />
            )}
          />
        ) : null}
        {dropHint}
      </div>
    );
  }

  // A riven is not in data.mods: a text card with its stat lines, Omni drain 10 + rank, ranks 0-8 (docs/port-rivens.md).
  const riven = isRiven(value);
  const mod = riven ? RIVEN_CAPACITY_MOD : ctx.index.byName.get(value.name);
  const max = riven ? RIVEN_MAX_RANK : maxRank(mod);
  const lines = riven ? rivenLines(value) : null;
  const shownName = riven ? rivenShortName(value) : value.name;
  const effect = riven ? lines.join(', ') : modEffectSummary(mod, value.rank);
  const d = capacity?.perSlot?.[slot] ?? { drain: (Number(mod?.['Base Drain']) || 0) + value.rank, base: (Number(mod?.['Base Drain']) || 0) + value.rank, effect: 'neutral' };
  const rarity = riven ? 'legendary' : RARITY_OF_FRAME[modRarityFrame(mod)] ?? 'common';
  const partial = partialMap.get(value.name) ?? [];
  const noStats = !riven && hasNoStats(ctx, value.name);
  const imageUrl = !textCards && !riven ? cards?.modCompactUrl(value.name) : null;
  // Stat lines that fit under the name (the text card's padding and the name take about 62 px).
  const rivenRows = riven ? Math.max(0, Math.min(lines.length, Math.floor((height - 62) / 16))) : 0;
  // The target slot of the Picker shows just its ring and name: its actions would cover the name of the mod being
  // replaced in the small strip slot.
  const showActions = (hover || focusWithin) && !(picking && selected) && !here && !active;
  // While a mod is dragged or picked up, every slot that accepts it shows what it would drain there (spec 6.2).
  const shownDrain = info && info.accept && info.drain != null && active?.from !== slot ? info : null;
  const accName = `${label}${polarityPart}: ${shownName}, rank ${value.rank} of ${max}, drain ${d.drain}${MATCH_TEXT[d.effect] ? `, ${MATCH_TEXT[d.effect]}` : ''}${riven && lines.length ? `: ${effect}` : ''}`;
  const descId = `slot-desc-${slot}`;
  const stacks = modConditionalControls(value.name, ctx.data);
  const stacksText = stacks ? modStacksText(value, ctx.data) : null;
  const stacksDesc = stacks ? `Assumes ${stacksText.toLowerCase()}: ${modConditionalSummary(value, ctx.data).total}` : null;

  return (
    <div
      className={rootClass}
      style={{ width, height }}
      data-testid={`slot-${slot}`}
      data-slot={slot}
      draggable={!here}
      onDragStart={e => startDrag(e, { kind: 'mod', name: value.name, from: slot, image: e.currentTarget.querySelector('img') })}
      onDragEnd={() => actions.setDrag(null)}
      {...rootHandlers}
    >
      <span className={mergeClasses(styles.face, shownDrain && !over && styles.faceDimmed)} aria-hidden="true">
        <span className={styles.textCard}>
          <Body1Strong className={styles.textName}>{shownName}</Body1Strong>
          {riven ? lines.slice(0, rivenRows).map(l => <Caption1 key={l} className={styles.rivenLine}>{l}</Caption1>)
            : height >= 80 ? <Caption1 className={styles.textEffect}>{effect}</Caption1> : null}
        </span>
        {imageUrl ? <span className={styles.art}><ArtImage src={imageUrl} backdrop="#161b20" /></span> : null}
      </span>
      <button
        type="button"
        className={styles.primary}
        data-testid={`slot-select-${slot}`}
        data-focus-id={`slot-select-${slot}`}
        data-slot-button="" tabIndex={tabbable ? 0 : -1}
        aria-label={accName}
        aria-describedby={descId}
        aria-pressed={selected}
        onClick={() => (store.get().pickup ? actions.dropPickup(slot) : actions.toggleSlot(slot))}
        onKeyDown={e => {
          if (onSlotKeys(e, { slot, value, max, selected })) return;
          if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); setMenuOpen(true); }
        }}
      />
      <span id={descId} hidden>{[riven ? null : effect, stacksDesc, honestyText(partial, noStats), selected ? 'Selected' : ''].filter(Boolean).join('. ')}</span>
      {/* The card art carries its own rarity frame; only a text card gets ours. */}
      {imageUrl ? null : <span className={styles.frame} style={{ boxShadow: `inset 0 0 0 2px ${RARITY_TOKEN[rarity]}` }} aria-hidden="true" />}
      <DrainPlate
        slot={slot}
        drain={shownDrain ? shownDrain.drain : d.drain}
        effect={shownDrain ? shownDrain.effect : d.effect}
        base={shownDrain ? shownDrain.drain : d.base}
        polarity={polarity}
        modPolarity={shownDrain ? shownDrain.modPolarity : mod?.Polarity}
        projected={shownDrain ? active.name : null}
        compact={height < 70}
      />
      <HonestyGlyph partial={partial} noStats={noStats} compact={height < 70} />
      {stacks && !here ? (
        <ModStacks slot={slot} value={value} controls={stacks} open={stacksOpen} setOpen={setStacksOpen} compact={height < 70} shifted={Boolean(partial.length || noStats)} />
      ) : null}
      {showActions ? (
        <SlotMenu
          slot={slot}
          value={value}
          open={menuOpen}
          setOpen={setMenuOpen}
          here={here}
          running={running}
          onStacks={stacks ? () => setStacksOpen(true) : null}
          stacksText={stacksText}
          trigger={(
            <Button appearance="transparent" className={styles.more} icon={<MoreHorizontalRegular />} aria-label={`More options for ${label.toLowerCase()}`} tabIndex={-1} />
          )}
        />
      ) : menuOpen ? (
        <SlotMenu slot={slot} value={value} open={menuOpen} setOpen={setMenuOpen} here={here} running={running} onStacks={stacks ? () => setStacksOpen(true) : null} stacksText={stacksText} trigger={<span />} />
      ) : null}
      {showActions ? (
        <div className={mergeClasses(styles.strip, styles.stripActive)}>
          <span className={styles.actionGroup}>
            <Tooltip content="Lower rank (−)" relationship="label">
              <Button appearance="transparent" className={styles.action} icon={<SubtractRegular />} tabIndex={-1} data-testid={`slot-rank-dec-${slot}`} disabled={value.rank <= 0} onClick={() => actions.setRank(slot, value.rank - 1)} />
            </Tooltip>
            <Caption1 className={styles.rankText} aria-hidden="true" data-testid={`slot-rank-text-${slot}`}>{value.rank}/{max}</Caption1>
            <Tooltip content="Raise rank (+)" relationship="label">
              <Button appearance="transparent" className={styles.action} icon={<AddRegular />} tabIndex={-1} data-testid={`slot-rank-inc-${slot}`} disabled={value.rank >= max} onClick={() => actions.setRank(slot, value.rank + 1)} />
            </Tooltip>
          </span>
          <span className={styles.actionGroup}>
            <Tooltip content={running ? 'A best-mod search is already running' : `Find best mod for ${label.toLowerCase()}`} relationship="label">
              <Button appearance="transparent" className={styles.action} icon={<SparkleRegular />} tabIndex={-1} data-testid={`slot-best-${slot}`} disabledFocusable={running} onClick={() => actions.startSweep(slot)} />
            </Tooltip>
            <Tooltip content="Remove (Del)" relationship="label">
              <Button appearance="transparent" className={styles.action} icon={<DismissRegular />} tabIndex={-1} data-testid={`slot-remove-${slot}`} onClick={() => actions.clearSlot(slot)} />
            </Tooltip>
          </span>
        </div>
      ) : height >= 70 && value.rank < max ? (
        // Below max only (a maxed mod needs no "5/5"), and not on a short strip slot, whose name must stay readable.
        <Caption1 className={mergeClasses(styles.rankText, styles.rankPlate)} aria-hidden="true" data-testid={`slot-rank-text-${slot}`}>{value.rank}/{max}</Caption1>
      ) : null}
      {here ? <SweepBusy slot={slot} /> : null}
      {dropHint}
    </div>
  );
}

/**
 * A conditional mod's stacks: a chip on the card ("×5", or On / Off for a one-stack conditional) that opens a popover
 * to set them. Also opened from the slot menu (Stacks…), the keyboard route: the chip is not a tab stop of its own.
 */
function ModStacks({ slot, value, controls, open, setOpen, compact, shifted }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const n = modStacksOf(value, ctx.data);
  const summary = modConditionalSummary(value, ctx.data);
  const toggle = controls.max === 1;
  const trigger = controls.trigger ? `${controls.trigger}${controls.condition ? `, ${controls.condition.toLowerCase()}` : ''}` : null;
  const state = toggle ? (n ? 'conditional on' : 'conditional off') : `${n} of ${controls.max} stacks`;
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} withArrow positioning="below-start" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <button
          type="button"
          tabIndex={-1}
          className={mergeClasses(styles.stacksChip, shifted && styles.stacksChipShifted, compact && styles.stacksChipCompact, compact && shifted && styles.stacksChipCompactShifted)}
          data-testid={`slot-stacks-${slot}`}
          aria-label={`${value.name}: ${state}${trigger ? ` (${trigger})` : ''}. Change`}
          title={`${toggle ? (n ? 'Active' : 'Inactive') : `${n} of ${controls.max} stacks`}${trigger ? ` (${trigger})` : ''}: ${summary.total}`}
        >
          <Caption1Strong className={toggle && !n ? styles.stacksOff : undefined} style={toggle && !n ? undefined : { color: 'inherit' }}>
            {toggle ? (n ? 'On' : 'Off') : `×${n}`}
          </Caption1Strong>
        </button>
      </PopoverTrigger>
      <PopoverSurface className={styles.popover} aria-label={`${value.name} conditional`} data-testid="mod-stacks-popover">
        <Body1Strong>{value.name}</Body1Strong>
        {toggle ? (
          <Switch
            checked={n > 0}
            label={n ? 'Active' : 'Inactive'}
            data-testid="mod-stacks-switch"
            onChange={(_e, d) => actions.setModStacks(slot, d.checked ? 1 : 0)}
          />
        ) : (
          <Field label="Stacks" hint={`0 to ${controls.max}. Each stack: ${summary.perStack}.`}>
            <SpinButton
              value={n}
              min={0}
              max={controls.max}
              data-testid="mod-stacks-input"
              onChange={(_e, d) => {
                const v = d.value ?? Number(d.displayValue);
                if (Number.isFinite(v)) actions.setModStacks(slot, v);
              }}
            />
          </Field>
        )}
        <Caption1>Adds {summary.total}{trigger ? ` (trigger: ${trigger})` : ''}. A newly equipped mod starts at max stacks, as on underframe.site.</Caption1>
      </PopoverSurface>
    </Popover>
  );
}

function SweepBusy({ slot }) {
  const styles = useStyles();
  return (
    <Tooltip content={BUSY_TIP} relationship="description">
      <div className={styles.busy} tabIndex={0} aria-disabled="true" aria-label={`${slotLabel(slot)}: finding best mod`} data-focus-id={`slot-busy-${slot}`}>
        <Caption1 style={{ color: 'inherit' }}>Finding best mod…</Caption1>
        <ProgressBar thickness="medium" aria-hidden="true" />
      </div>
    </Tooltip>
  );
}

/** "Primary Merciless" -> "Merciless": the weapon already says which kind of arcane it is. */
const shortArcaneName = name => name.replace(/^(Primary|Secondary) (?=\S)/, '');

/**
 * An arcane slot (docs/arsenal-spec.md 4.6), shaped like an arcane: a dome in the art's proportions with the rank pill
 * under it. `index` 0, or 1 for a kitgun's Pax / Residual slot.
 */
export function ArcaneSlot({ width, height, tabbable = true, index = 0 }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const slotId = arcaneSlotId(index);
  const slotKey = index === 1 ? 'arcane-1' : 'arcane';
  const focusId = arcaneFocusId(index);
  const slotName = index === 1 ? 'Kitgun arcane slot' : 'Arcane slot';
  const selected = useApp(s => s.selectedSlot === slotId);
  const picking = useApp(s => s.pickerOpen);
  const pickup = useApp(s => s.pickup);
  const cards = useCards();
  const textCards = useTextCards();
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const drop = useDropTarget(slotId);
  const active = useActiveDrag();
  const weapon = ctx.weaponByName.get(build.weaponName);
  const value = build.arcanes?.[index] ?? null;
  const info = active ? dropInfo(ctx, build, active, slotId, null) : null;
  const over = drop.over || (pickup && pickup.at === slotId);
  const any = weapon ? arcanesFor(weapon, ctx.data, index).length > 0 : false;
  const rootHandlers = {
    ...drop.props,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => { setFocusWithin(true); if (store.get().pickup) actions.movePickup(slotId); },
    onBlur: e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false); },
  };
  const domeH = Math.max(24, height - PILL_ROOM);
  const domeW = Math.min(width, Math.round(domeH * ARCANE_ASPECT));
  const domeSize = { width: domeW, height: domeH };
  // Selection and drag feedback ring the dome, not the cell.
  const ring = mergeClasses(styles.dome, selected && styles.selected, dragClass(styles, info, over));
  const dropHint = info && (over || !info.accept) && (info.label || info.reason) ? (
    <>
      {info.accept ? null : <span className={mergeClasses(styles.dome, styles.domeScrim)} style={domeSize} aria-hidden="true" />}
      <span className={styles.dropHint}>
        {info.accept ? null : <ProhibitedRegular aria-hidden="true" />}
        <Caption1>{info.accept ? info.label : info.reason}</Caption1>
      </span>
    </>
  ) : null;

  if (!any || !value) {
    const unavailable = !any;
    const button = (
      <button
        type="button"
        className={mergeClasses(styles.dome, styles.domeButton, styles.domeEmpty)}
        style={domeSize}
        data-focus-id={focusId}
        data-testid={unavailable ? undefined : `slot-${slotKey}-select`}
        data-slot-button="" tabIndex={tabbable ? 0 : -1}
        aria-disabled={unavailable || undefined}
        aria-label={unavailable ? `${slotName}, unavailable`
          : `${slotName}${index === 1 ? ' (Pax and Residual arcanes)' : ''}, empty${selected ? ', selected' : ''}`}
        aria-pressed={unavailable ? undefined : selected}
        onClick={unavailable ? undefined : () => (store.get().pickup ? actions.dropPickup(slotId) : actions.toggleSlot(slotId))}
        onKeyDown={unavailable ? undefined : e => { onSlotKeys(e, { slot: slotId, value: null, max: 0, selected, kind: 'arcane' }); }}
      >
        <DiamondRegular aria-hidden="true" style={{ fontSize: 20 }} />
        <Caption1 className={styles.emptyCaption}>{unavailable ? 'No arcanes' : index === 1 ? 'Kitgun arcane' : 'Arcane'}</Caption1>
      </button>
    );
    return (
      <div className={styles.root} style={{ width, height }} data-testid={`slot-${slotKey}`} data-slot={slotKey} {...(unavailable ? {} : rootHandlers)}>
        <span className={ring} style={domeSize} aria-hidden="true" />
        {unavailable ? (
          <Tooltip content={`No arcanes for ${weapon?.subtype ?? 'this weapon'}s in the data`} relationship="description">{button}</Tooltip>
        ) : button}
        {unavailable ? null : dropHint}
      </div>
    );
  }

  const max = arcaneMaxRank(value.name, ctx.data);
  const controls = arcaneControls(value.name, ctx.data);
  const support = arcaneSupport(value.name, ctx.data);
  const summary = arcaneSummary(value.name, ctx.data, value.rank);
  const imageUrl = !textCards ? cards?.arcaneUrl(value.name) : null;
  const showActions = (hover || focusWithin) && !(picking && selected) && !active;
  const stacks = value.options?.stacks;
  const stacksText = arcaneStacksText(value.name, ctx.data, stacks, value.rank);
  const assumes = controls.stacks ? (controls.stacks.max === 1 ? stacksText : `Assumes ${stacksText}`) : null;
  const accName = `${slotName}: ${value.name}, rank ${value.rank} of ${max}${assumes ? `, ${assumes.charAt(0).toLowerCase()}${assumes.slice(1)}${controls.cap && controls.trigger ? ` (${controls.trigger.toLowerCase()})` : ''}` : ''}`;
  const descId = `slot-desc-${slotKey}`;

  return (
    <div
      className={styles.root}
      style={{ width, height }}
      data-testid={`slot-${slotKey}`}
      data-slot={slotKey}
      draggable
      onDragStart={e => startDrag(e, { kind: 'arcane', name: value.name, from: slotId, image: e.currentTarget.querySelector('img') })}
      onDragEnd={() => actions.setDrag(null)}
      {...rootHandlers}
    >
      <span className={ring} style={domeSize} aria-hidden="true">
        {imageUrl ? (
          <ArtImage src={imageUrl} fit="contain" />
        ) : (
          <span className={mergeClasses(styles.dome, styles.domeText)} style={{ ...domeSize, borderColor: RARITY_TOKEN.legendary }}>
            <Caption1Strong>{shortArcaneName(value.name)}</Caption1Strong>
          </span>
        )}
      </span>
      <Tooltip content={value.name} relationship="inaccessible" positioning="above">
        <button
          type="button"
          className={mergeClasses(styles.dome, styles.domeButton)}
          style={domeSize}
          data-focus-id={focusId}
          data-testid={`slot-${slotKey}-select`}
          data-slot-button="" tabIndex={tabbable ? 0 : -1}
          aria-label={accName}
          aria-describedby={descId}
          aria-pressed={selected}
          onClick={() => (store.get().pickup ? actions.dropPickup(slotId) : actions.toggleSlot(slotId))}
          onKeyDown={e => { onSlotKeys(e, { slot: slotId, value, max, selected, kind: 'arcane' }); }}
        />
      </Tooltip>
      <span id={descId} hidden>{`${summary}${selected ? '. Selected' : ''}`}</span>
      {showActions ? (
        // On the art's flat base, so the text under the dome (and its stacks button) stays reachable on hover.
        <div className={mergeClasses(styles.pill, styles.pillActive)} style={{ bottom: PILL_ROOM }}>
          <Tooltip content="Lower rank (−)" relationship="label">
            <Button appearance="transparent" className={styles.action} icon={<SubtractRegular />} tabIndex={-1} data-testid={`slot-rank-dec-${slotKey}`} disabled={value.rank <= 0} onClick={() => actions.setArcaneRank(index, value.rank - 1)} />
          </Tooltip>
          <Caption1 className={styles.rankText} aria-hidden="true">{value.rank}/{max}</Caption1>
          <Tooltip content="Raise rank (+)" relationship="label">
            <Button appearance="transparent" className={styles.action} icon={<AddRegular />} tabIndex={-1} data-testid={`slot-rank-inc-${slotKey}`} disabled={value.rank >= max} onClick={() => actions.setArcaneRank(index, value.rank + 1)} />
          </Tooltip>
          <Tooltip content="Remove (Del)" relationship="label">
            <Button appearance="transparent" className={styles.action} icon={<DismissRegular />} tabIndex={-1} data-testid={`slot-remove-${slotKey}`} onClick={() => actions.clearArcane(index)} />
          </Tooltip>
        </div>
      ) : null}
      {picking ? null : (
        // Plain text under the dome: the rank only below max, then the stacks (they open their popover).
        <span className={styles.under}>
          {value.rank < max ? <Caption1 className={styles.stacksText} aria-hidden="true">{value.rank}/{max}</Caption1> : null}
          {controls.stacks || support.level !== 'full' ? (
            <Popover withArrow positioning="below-end">
              <PopoverTrigger disableButtonEnhancement>
                <button
                  type="button"
                  className={styles.stacksButton}
                  aria-label={`${assumes ?? (support.level === 'none' ? 'Not simulated' : 'Partially simulated')}: ${value.name} options`}
                  data-testid={index === 1 ? 'arcane-1-stacks' : 'arcane-stacks'}
                  title={assumes ?? undefined}
                >
                  {support.level !== 'full' ? (support.level === 'none' ? <InfoRegular aria-hidden="true" /> : <CircleHalfFillRegular aria-hidden="true" />) : null}
                  <Caption1 className={styles.stacksText}>{controls.stacks ? stacksText : support.level === 'none' ? 'Not simulated' : 'Partly simulated'}</Caption1>
                </button>
              </PopoverTrigger>
              <PopoverSurface className={styles.popover}>
                {controls.stacks ? (
                  <Field
                    label={controls.cap ? `${controls.cap.label} bonus, in % points` : controls.stacks.max === 1 ? 'Active (1) or off (0)' : 'Stacks'}
                    hint={controls.cap ? `0 to ${controls.stacks.max} (${stacksText} at rank ${value.rank})` : `0 to ${controls.stacks.max}`}
                  >
                    <SpinButton
                      value={stacks ?? 0}
                      min={0}
                      max={controls.stacks.max}
                      onChange={(_e, d) => {
                        const v = d.value ?? Number(d.displayValue);
                        if (Number.isFinite(v)) actions.setArcaneStacks(index, v);
                      }}
                    />
                  </Field>
                ) : null}
                <Caption1>Uptime: {controls.cap ? 'the bonus you set' : controls.stacks ? 'the stacks you set' : 'always active'}{controls.trigger ? ` (trigger: ${controls.trigger})` : ''}.</Caption1>
                {support.level !== 'full' ? <Caption1>{support.level === 'none' ? 'Not simulated.' : 'Partially simulated.'} {support.note}</Caption1> : null}
              </PopoverSurface>
            </Popover>
          ) : null}
        </span>
      )}
      {dropHint}
    </div>
  );
}
