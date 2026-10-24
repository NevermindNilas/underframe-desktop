// Card artwork pieces shared by the slots, the gallery and the screenshot review: images that fade in after they
// load (text cards underneath until then, and for good when an image is missing), polarity glyphs and rank pips.
// The images are Digital Extremes' artwork from the private core/images; this file only places them.
import { useState } from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useApp, useMediaQuery } from '../hooks.js';
import { polarityInfo } from '../model.js';
import { polarityDisplayName } from '../../shared/card-assets.js';

/** Rarity frame colours (the slot frame and the text card band). */
export const RARITY_TOKEN = {
  common: tokens.colorPaletteBeigeBorderActive,
  uncommon: tokens.colorNeutralForeground3,
  rare: tokens.colorPaletteMarigoldBorderActive,
  legendary: tokens.colorPaletteLavenderBorderActive,
};

/** Fixed overlay colours on the dark scrims (the art is dark in both themes): all >= 4.5:1 on the scrim. */
export const OVERLAY = {
  scrim: 'rgba(0, 0, 0, 0.72)',
  strip: 'rgba(0, 0, 0, 0.6)',
  match: '#7FE07A',
  mismatch: '#FF8F86',
  neutral: '#FFFFFF',
  pip: '#6FC3FF',
};

const useStyles = makeStyles({
  img: {
    display: 'block',
    width: '100%',
    height: '100%',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms' },
  },
  shown: { opacity: 1 },
  instant: { transitionDuration: '0ms' },
  glyph: {
    display: 'inline-block',
    flexShrink: 0,
    backgroundColor: 'currentColor',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none', backgroundColor: 'CanvasText' },
  },
  glyphText: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: tokens.fontWeightSemibold, lineHeight: 1 },
  pips: { display: 'inline-flex', alignItems: 'center', gap: '3px' },
  pip: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    boxSizing: 'border-box',
    '@media (forced-colors: active)': { forcedColorAdjust: 'none' },
  },
});

/** The resolver for core/images, or null. */
export const useCards = () => useApp(s => s.cards);

/** Text cards everywhere: the user's choice, forced colours (image text can't follow system colours), or no images. */
export function useTextCards() {
  const pref = useApp(s => s.ui.textCards);
  const forced = useMediaQuery('(forced-colors: active)');
  const cards = useCards();
  return pref || forced || !cards?.available;
}

const loaded = new Set();
const failed = new Set();

/** Whether an image URL is known to be missing (it failed once): callers keep the text card. */
export const imageFailed = url => failed.has(url);

/**
 * A decorative card image (alt=""): invisible until it has loaded, then it fades in over whatever is under it
 * (the text card), so there is no flicker and no broken-image icon. A failed URL is remembered.
 */
export function ArtImage({ src, className, fit = 'cover', lazy = false, onFail, backdrop = null }) {
  const styles = useStyles();
  const [state, setState] = useState(() => (loaded.has(src) ? 'loaded' : failed.has(src) ? 'failed' : 'loading'));
  if (!src || state === 'failed') return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      loading={lazy ? 'lazy' : 'eager'}
      className={mergeClasses(styles.img, state === 'loaded' && styles.shown, loaded.has(src) && styles.instant, className)}
      // The card art is partly translucent: once it has loaded, an opaque backdrop hides the text card under it.
      style={{ objectFit: fit, backgroundColor: backdrop ?? undefined }}

      onLoad={() => { loaded.add(src); setState('loaded'); }}
      onError={() => { failed.add(src); setState('failed'); onFail?.(); }}
    />
  );
}

/**
 * A polarity glyph in the current text colour (the SVG is used as a mask), or the text symbol when there is no
 * image. Decorative: the polarity is part of the control's accessible name.
 */
export function PolarityGlyph({ code, size = 16, className, style }) {
  const styles = useStyles();
  const cards = useCards();
  const textCards = useTextCards();
  if (!code || code === 'AP_UNIVERSAL') return null;
  const url = !textCards ? cards?.polarityUrl(code) : null;
  if (url) {
    return (
      <span
        aria-hidden="true"
        className={mergeClasses(styles.glyph, className)}
        style={{ width: size, height: size, maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")`, ...style }}
      />
    );
  }
  const p = polarityInfo(code === 'AP_ANY' || code === 'AP_OMNI' ? 'AP_ANY' : code);
  return (
    <span aria-hidden="true" className={mergeClasses(styles.glyphText, className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.85), ...style }}>
      {p.symbol || '•'}
    </span>
  );
}

/** "Madurai", "Omni"; null for none. */
export const polarityName = code => (code === 'AP_ANY' ? 'Omni' : polarityDisplayName(code));

/** Rank pips: `max` dots, the first `rank` filled. Decorative (the rank is spoken as text). */
export function RankPips({ rank, max, color = OVERLAY.pip, className }) {
  const styles = useStyles();
  if (!max) return null;
  const n = Math.min(max, 10);
  const filled = Math.round((rank / max) * n);
  return (
    <span className={mergeClasses(styles.pips, className)} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={mergeClasses(styles.pip, 'uf-pip', i < filled && 'uf-pip-on')}
          style={i < filled ? { backgroundColor: color } : { border: `1px solid ${color}`, opacity: 0.6 }}
        />
      ))}
    </span>
  );
}
