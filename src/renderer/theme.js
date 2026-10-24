// Fluent theme for the app: the default web themes (no custom brand ramp, see the UX spec 3.4), Segoe UI
// Variable type, and the layer colours for the Mica and solid backdrops. Every colour the shell paints
// outside Fluent's own tokens is defined here.
import { webDarkTheme, webLightTheme } from '@fluentui/react-components';

export const TEXT_FONT = '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
export const DISPLAY_FONT = '"Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", sans-serif';

/** WinUI solid base colours (the window behind everything when Mica is off). */
export const SHELL_BACKGROUND = { light: '#F3F3F3', dark: '#202020' };

/** Workspace layer and card surfaces per backdrop and theme (UX spec 3.1). */
const LAYERS = {
  mica: {
    light: { layer: 'rgba(255, 255, 255, 0.5)', card: 'rgba(255, 255, 255, 0.7)' },
    dark: { layer: 'rgba(58, 58, 58, 0.3)', card: 'rgba(255, 255, 255, 0.05)' },
  },
  solid: {
    light: { layer: '#F9F9F9', card: '#FFFFFF' },
    dark: { layer: '#272727', card: '#2B2B2B' },
  },
};

/** The Fluent theme object for a colour scheme and backdrop. */
export function makeTheme({ dark, backdrop }) {
  const base = dark ? webDarkTheme : webLightTheme;
  const layer = LAYERS[backdrop === 'mica' ? 'mica' : 'solid'][dark ? 'dark' : 'light'];
  return {
    ...base,
    fontFamilyBase: TEXT_FONT,
    fontFamilyNumeric: TEXT_FONT,
    colorNeutralCardBackground: layer.card,
  };
}

/** CSS variables set on the FluentProvider root, next to the Fluent tokens. */
export function layerVariables({ dark, backdrop }) {
  const layer = LAYERS[backdrop === 'mica' ? 'mica' : 'solid'][dark ? 'dark' : 'light'];
  return { '--uf-layer': layer.layer };
}

/** What sits behind the app: transparent over Mica, else the solid base colour. */
export function shellBackground({ dark, backdrop }) {
  return backdrop === 'mica' ? 'transparent' : dark ? SHELL_BACKGROUND.dark : SHELL_BACKGROUND.light;
}

/** Pool colours (UX spec 3.4): the same token for the target tiles, chart lines and legend. */
export const POOL_TOKENS = {
  hp: 'colorPaletteRedBorderActive',
  shields: 'colorPaletteBlueBorderActive',
  armor: 'colorPaletteMarigoldBorderActive',
  overguard: 'colorPaletteGrapeBorderActive',
};

export const POOL_LABELS = { hp: 'Health', shields: 'Shields', armor: 'Armor', overguard: 'Overguard' };

/** Chart dash pattern per pool, used in high contrast where colour is not available. */
export const POOL_DASH = { hp: undefined, shields: '6 4', overguard: '2 3' };
