// One gallery card (docs/arsenal-spec.md 5.3): the full card image (or the text card), the state overlays
// (equipped, gain, polarity-fit hint, honesty badges, the blocked reason plate) and drag start. A card image prints
// its effect too small to read at gallery size, so the max-rank effect sits over that part of the art as real text
// (docs/declutter-spec.md 1.1); the ⋯ on hover opens the details flyout.
import { memo, useState } from 'react';
import {
  Body1Strong, Caption1, Caption1Strong, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  ArrowDownRegular, ArrowUpRegular, CheckmarkCircleFilled, CircleHalfFillRegular, InfoRegular, MoreHorizontalRegular, ProhibitedRegular,
} from '@fluentui/react-icons';
import { maxRank, modEffectSummary } from '../../shared/mods.js';
import { slotDrain } from '../../shared/capacity.js';
import { fmtSignedPct } from '../format.js';
import { EXILUS_SLOT, slotLabel } from '../model.js';
import { ArtImage, OVERLAY, PolarityGlyph, RARITY_TOKEN, RankPips, imageFailed, polarityName } from './art.jsx';

export const COMPAT_LABELS = {
  PRIMARY: 'Primary', SECONDARY: 'Secondary', Rifle: 'Rifle', 'Rifle (No Aoe)': 'Rifle', Sniper: 'Sniper', Bow: 'Bow',
  Shotgun: 'Shotgun', Pistol: 'Pistol', 'Pistol (No Aoe)': 'Pistol', Thrown: 'Thrown', Tome: 'Tome',
};

const FOCUS_RING = `inset 0 0 0 2px ${tokens.colorStrokeFocus2}, inset 0 0 0 4px ${tokens.colorStrokeFocus1}`;

const useStyles = makeStyles({
  cell: { position: 'relative', display: 'block' },
  // The card is a picture with a transparent button over it: the button has no text of its own, so its
  // accessible name (cardLabel) is the whole story and nothing visible contradicts it.
  card: {
    position: 'relative',
    display: 'block',
    width: '100%',
    height: '100%',
    borderRadius: tokens.borderRadiusLarge,
    overflow: 'hidden',
    textAlign: 'left',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow4,
    transitionProperty: 'box-shadow, transform',
    transitionDuration: '120ms',
    ':hover': { boxShadow: `${tokens.shadow8}, 0 0 0 1px ${tokens.colorNeutralStroke1Hover}`, transform: 'translateY(-1px)' },
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms', ':hover': { transform: 'none' } },
    '@media (forced-colors: active)': { border: '1px solid CanvasText' },
  },
  hit: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    padding: 0,
    border: 'none',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    outlineStyle: 'none',
    // The keyboard focus ring is drawn inside the card, on this button (the topmost layer), so neither the card
    // art nor the card's rounded clip can hide it: a 2 px focus stroke with a 2 px contrasting inner stroke.
    '&[data-fui-focus-visible]': { boxShadow: FOCUS_RING },
    ':focus-visible': { boxShadow: FOCUS_RING },
    '@media (forced-colors: active)': {
      '&[data-fui-focus-visible]': { outline: '3px solid Highlight', outlineOffset: '-3px', boxShadow: 'none' },
      ':focus-visible': { outline: '3px solid Highlight', outlineOffset: '-3px', boxShadow: 'none' },
    },
  },
  // The whole card is lifted a little while its button has keyboard focus, so the ring reads at a glance.
  cardFocus: {
    ':has(> button[data-fui-focus-visible])': { boxShadow: tokens.shadow16 },
    ':has(> button:focus-visible)': { boxShadow: tokens.shadow16 },
  },
  hitBlocked: { cursor: 'default' },
  equipped: { boxShadow: `inset 0 0 0 2px ${tokens.colorBrandStroke1}, ${tokens.shadow4}` },
  blocked: { cursor: 'default' },
  dim: { filter: 'grayscale(1) brightness(0.55)' },
  flash: { outline: `2px solid ${tokens.colorStatusWarningBorder1}` },
  art: { position: 'absolute', inset: 0 },
  // Text card
  text: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 8px 8px',
    boxSizing: 'border-box',
    borderTop: '4px solid transparent',
  },
  textTop: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', minHeight: '18px', fontVariantNumeric: 'tabular-nums' },
  textName: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '18px' },
  textEffect: { color: tokens.colorNeutralForeground2, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  textFoot: { marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
  compat: { color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.04em' },
  // Arcane card
  arcaneArt: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: tokens.colorNeutralBackground3 },
  arcanePlate: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px', boxSizing: 'border-box' },
  arcaneName: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '18px' },
  arcaneLine: { color: tokens.colorNeutralForeground2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '16px', fontSize: '12px' },
  // Overlays
  topLeft: { position: 'absolute', top: '4px', left: '4px', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start', pointerEvents: 'none' },
  topRight: { position: 'absolute', top: '4px', right: '4px', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' },
  // The card's label, readable: the name and the max-rank effect as real text over the lower half of the art, where
  // the art prints them too small to read at gallery size. The picture and the frame's top stay visible above.
  label: {
    position: 'absolute', left: 0, right: 0, top: '41%', bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: '2px', padding: '12px 6px 6px', boxSizing: 'border-box', pointerEvents: 'none', textAlign: 'center', overflow: 'hidden',
    backgroundImage: 'linear-gradient(to bottom, rgba(14,16,20,0) 0px, rgba(14,16,20,0.95) 10px, rgba(14,16,20,0.97) 100%)',
    color: OVERLAY.neutral,
  },
  labelName: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '13px', lineHeight: '16px', fontWeight: tokens.fontWeightSemibold, color: 'inherit' },
  effectText: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '12px', lineHeight: '16px', color: 'rgba(255,255,255,0.86)' },
  info: {
    position: 'absolute', top: '4px', right: '4px', width: '24px', height: '24px', minWidth: '24px', padding: 0, margin: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: tokens.borderRadiusMedium,
    backgroundColor: OVERLAY.scrim, color: OVERLAY.neutral, cursor: 'pointer', fontSize: '16px',
    ':hover': { backgroundColor: 'rgba(0,0,0,0.9)' },
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'ButtonFace', color: 'ButtonText', border: '1px solid ButtonText' },
  },
  // With the ⓘ shown, the fit hint moves down beside it.
  topRightShifted: { top: '32px' },
  pill: {
    display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', borderRadius: tokens.borderRadiusMedium,
    backgroundColor: OVERLAY.scrim, color: OVERLAY.neutral, fontVariantNumeric: 'tabular-nums', border: '1px solid transparent',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', borderColor: 'CanvasText' },
  },
  gainUp: { color: OVERLAY.match },
  gainDown: { color: OVERLAY.mismatch },
  // A matching polarity is the normal case: neutral, the arrow says it. Only a mismatch is coloured.
  match: { color: OVERLAY.neutral },
  mismatch: { color: OVERLAY.mismatch, borderColor: OVERLAY.mismatch, borderStyle: 'dashed' },
  // Honesty on a card: a neutral glyph on the scrim (docs/declutter-spec.md 3); the card's name says what it means.
  icon: {
    width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: tokens.borderRadiusMedium,
    backgroundColor: OVERLAY.scrim, color: OVERLAY.neutral,
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'Canvas', color: 'CanvasText', border: '1px solid CanvasText' },
  },
  reason: {
    position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px',
    backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    '@media (forced-colors: active)': { backgroundColor: 'Canvas', color: 'CanvasText', borderTop: '1px solid CanvasText' },
  },
  reasonText: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  place: { fontWeight: tokens.fontWeightBold },
});

const rarityWord = r => r.charAt(0).toUpperCase() + r.slice(1);

/** Spoken name of a card (5.3): "Serration, rare, Madurai, drain 4 to 14, +165% damage at max rank, equipped in slot 1". */
export function cardLabel(item, { partial = [], engineOnly = false } = {}) {
  if (item.kind === 'arcane') {
    const a = item.arcane;
    return [
      a.name, 'arcane', `rank 0 to ${a.maxRank}`, a.summary,
      item.state === 'equipped' ? 'equipped' : null,
      item.reason ? `unavailable: ${item.reason.charAt(0).toLowerCase()}${item.reason.slice(1)}` : null,
      a.support === 'partial' ? 'partially simulated' : a.support === 'none' ? 'not simulated' : null,
    ].filter(Boolean).join(', ');
  }
  const mod = item.mod;
  const max = maxRank(mod);
  const base = Number(mod['Base Drain']) || 0;
  const pol = polarityName(mod.Polarity);
  return [
    item.name,
    item.entry.rarity,
    pol,
    `drain ${base} to ${base + max}`,
    `${modEffectSummary(mod, max)} at max rank`,
    item.slot != null ? `equipped in ${item.slot === EXILUS_SLOT ? 'the Exilus slot' : slotLabel(item.slot).toLowerCase()}` : null,
    item.reason ? `unavailable: ${item.reason.charAt(0).toLowerCase()}${item.reason.slice(1)}` : null,
    partial.length ? 'partially simulated' : null,
    engineOnly ? 'engine-only' : null,
    Number.isFinite(item.gain) ? `${fmtSignedPct(item.gain)} DPS` : null,
  ].filter(Boolean).join(', ');
}

/**
 * A card. `fit` is the projected drain in the target slot ({ drain, effect }) when that slot has a polarity.
 * Handlers come from the grid (activation, keys, drag, hover for the flyout).
 */
export const GalleryCard = memo(function GalleryCard({
  item, width, height, textCards, imageUrl, fit, partial, engineOnly, tabIndex, flash, handlers, index, onDetails = null,
}) {
  const styles = useStyles();
  const [hover, setHover] = useState(false);
  const blocked = item.state === 'blocked';
  const label = cardLabel(item, { partial, engineOnly });
  const isMod = item.kind === 'mod';
  const rarity = isMod ? item.entry.rarity : 'legendary';
  const showImage = imageUrl && !textCards;
  const artHeight = Math.round(width * (175 / 240));
  // An arcane without art (no image for Pax / Residual arcanes, or card images not installed) gets the text card
  // layout mods use, not an empty picture box.
  const [failedUrl, setFailedUrl] = useState(null);
  const arcaneArt = !isMod && showImage && failedUrl !== imageUrl && !imageFailed(imageUrl);
  return (
    <div
      className={mergeClasses(styles.card, styles.cardFocus, item.state === 'equipped' && styles.equipped, flash && styles.flash)}
      style={{ width, height }}
      onMouseEnter={onDetails ? () => setHover(true) : undefined}
      onMouseLeave={onDetails ? () => setHover(false) : undefined}
    >
      {isMod ? (
        <>
          <span className={mergeClasses(styles.text, blocked && styles.dim)} style={{ borderTopColor: RARITY_TOKEN[rarity] }} aria-hidden="true">
            <span className={styles.textTop}>
              <Caption1Strong>{item.entry.maxDrain ?? item.mod['Base Drain']}</Caption1Strong>
              <PolarityGlyph code={item.mod.Polarity} size={14} />
            </span>
            <Body1Strong className={styles.textName}>{item.name}</Body1Strong>
            <Caption1 className={styles.textEffect}>{modEffectSummary(item.mod, maxRank(item.mod)) || String(item.mod.Description ?? '')}</Caption1>
            <span className={styles.textFoot}>
              <Caption1 className={styles.compat}>{COMPAT_LABELS[item.mod['Compat Name']] ?? item.mod['Compat Name']}</Caption1>
              <RankPips rank={maxRank(item.mod)} max={maxRank(item.mod)} color={tokens.colorBrandForeground1} />
            </span>
          </span>
          {showImage ? <span className={mergeClasses(styles.art, blocked && styles.dim)}><ArtImage src={imageUrl} lazy fit="cover" backdrop={tokens.colorNeutralBackground2} /></span> : null}
          {showImage && !blocked ? (
            <span className={styles.label} aria-hidden="true" data-testid="card-effect">
              <span className={styles.labelName}>{item.name}</span>
              {/* A name that wraps leaves room for two lines of effect, else three (the label never overflows). */}
              <span className={styles.effectText} style={item.name.length * 7.2 > width - 12 ? { WebkitLineClamp: 2 } : undefined}>{modEffectSummary(item.mod, maxRank(item.mod)) || String(item.mod.Description ?? '').replace(/\r?\n/g, ' ')}</span>
            </span>
          ) : null}
        </>
      ) : arcaneArt ? (
        <>
          <span className={mergeClasses(styles.arcaneArt, blocked && styles.dim)} style={{ height: artHeight }} aria-hidden="true">
            <ArtImage src={imageUrl} lazy fit="contain" onFail={() => setFailedUrl(imageUrl)} />
          </span>
          <span className={mergeClasses(styles.arcanePlate, blocked && styles.dim)} style={{ top: artHeight }} aria-hidden="true">
            <Body1Strong className={styles.arcaneName}>{item.name}</Body1Strong>
            <Caption1 className={styles.arcaneLine}>{[item.arcane.controls?.trigger, item.arcane.summary].filter(Boolean).join(' · ')}</Caption1>
          </span>
        </>
      ) : (
        <span className={mergeClasses(styles.text, blocked && styles.dim)} style={{ borderTopColor: RARITY_TOKEN.legendary }} aria-hidden="true" data-testid="arcane-text-card">
          <span className={styles.textTop}><Caption1 className={styles.compat}>Arcane</Caption1></span>
          <Body1Strong className={styles.textName}>{item.name}</Body1Strong>
          {item.arcane.controls?.trigger ? <Caption1Strong>{item.arcane.controls.trigger}</Caption1Strong> : null}
          <Caption1 className={styles.textEffect}>{item.arcane.summary || item.arcane.description}</Caption1>
          <span className={styles.textFoot}>
            <RankPips rank={item.arcane.maxRank} max={item.arcane.maxRank} color={tokens.colorBrandForeground1} />
          </span>
        </span>
      )}
      <span className={styles.topLeft} aria-hidden="true">
        {item.place && item.place <= 3 ? <span className={mergeClasses(styles.pill, styles.place)}>#{item.place}</span> : null}
        {item.state === 'equipped' ? <span className={styles.pill}><CheckmarkCircleFilled /></span> : null}
        {item.kind === 'mod' && !blocked && (partial?.length || engineOnly) ? (
          <span style={{ display: 'flex', gap: 2 }}>
            {partial?.length ? <span className={styles.icon}><CircleHalfFillRegular /></span> : null}
            {engineOnly ? <span className={styles.icon}><InfoRegular /></span> : null}
          </span>
        ) : null}
        {item.kind === 'arcane' && item.arcane.support !== 'full' && !blocked ? (
          <span className={styles.icon}>
            {item.arcane.support === 'none' ? <InfoRegular /> : <CircleHalfFillRegular />}
          </span>
        ) : null}
        {Number.isFinite(item.gain) && Math.abs(item.gain) >= 0.0005 ? (
          <span className={mergeClasses(styles.pill, item.gain > 0 ? styles.gainUp : styles.gainDown)}>
            {item.gain > 0 ? <ArrowUpRegular /> : <ArrowDownRegular />}{fmtSignedPct(item.gain)}
          </span>
        ) : null}
      </span>
      {/* The drain hint gives way to a DPS gain (Best for slot N): two pills would collide on a narrow card. */}
      {fit && !blocked && fit.effect !== 'neutral' && !Number.isFinite(item.gain) ? (
        <span className={mergeClasses(styles.topRight, hover && onDetails && styles.topRightShifted)} aria-hidden="true">
          <span className={mergeClasses(styles.pill, fit.effect === 'match' ? styles.match : styles.mismatch)}>
            {fit.effect === 'match' ? <ArrowDownRegular /> : <ArrowUpRegular />}{fit.drain}
          </span>
        </span>
      ) : null}


      {blocked ? (
        <span className={styles.reason} aria-hidden="true">
          <ProhibitedRegular />
          <Caption1 className={styles.reasonText}>{item.reason}</Caption1>
        </span>
      ) : null}
      <button
        type="button"
        className={mergeClasses(styles.hit, blocked && styles.hitBlocked)}
        tabIndex={tabIndex}
        aria-label={label}
        aria-disabled={blocked || undefined}
        data-testid={isMod ? 'gallery-card' : 'arcane-card'}
        data-mod-name={item.name}
        data-state={item.state}
        data-index={index}
        data-focus-id={`gallery-card-${item.name}`}
        draggable={!blocked}
        {...handlers}
      />
      {hover && onDetails ? (
        <button
          type="button"
          className={styles.info}
          tabIndex={-1}
          aria-label={`${item.name} details (Alt+Enter)`}
          title="Details (Alt+Enter)"
          data-testid="card-details"
          onClick={e => { e.stopPropagation(); onDetails(e.currentTarget.parentElement); }}
        >
          <MoreHorizontalRegular aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});


/** Projected drain of a mod at max rank in a slot with this polarity (the top-right fit hint). */
export function fitFor(mod, slotPolarity) {
  if (!slotPolarity) return null;
  const { drain, effect } = slotDrain(mod, maxRank(mod), slotPolarity);
  return { drain, effect };
}
