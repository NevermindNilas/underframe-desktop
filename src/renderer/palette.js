// Data colours that Fluent has no token for: one hue per damage type, tuned per theme to reach at least 3:1
// against the card surfaces they sit on (WCAG 1.4.11). Pure, so the contrast is checked in node tests.
// Colours here are decorative companions to text labels; meaning is never carried by colour alone.

export const DAMAGE_TYPE_ORDER = [
  'Impact', 'Puncture', 'Slash', 'Heat', 'Cold', 'Electricity', 'Toxin', 'Blast', 'Corrosive', 'Gas', 'Magnetic',
  'Radiation', 'Viral', 'Void', 'True',
];

export const DAMAGE_TYPE_COLORS = {
  light: {
    Impact: '#5f7286', Puncture: '#8a7340', Slash: '#c03c3c', Heat: '#c45a10', Cold: '#1b7fb0', Electricity: '#7a4fe0',
    Toxin: '#3f8a1c', Blast: '#a86e0a', Corrosive: '#6e8410', Gas: '#13876a', Magnetic: '#2f5fe0', Radiation: '#8f7c00',
    Viral: '#c0307f', Void: '#6f62c8', True: '#555555',
  },
  dark: {
    Impact: '#8fa3b8', Puncture: '#c9b37e', Slash: '#d86b6b', Heat: '#f08a3c', Cold: '#6cc5f0', Electricity: '#b18cff',
    Toxin: '#7bd44a', Blast: '#e8b04a', Corrosive: '#b9d23a', Gas: '#4ed1a5', Magnetic: '#5b8cff', Radiation: '#f3df4a',
    Viral: '#e05aa9', Void: '#d9d2ff', True: '#f2f2f2',
  },
};

/**
 * The lightest (dark theme) or darkest-contrast (light theme) surfaces a damage-type colour can sit on:
 * solid cards, cards on Mica over a bright or dark wallpaper, and the workspace layer.
 */
export const WORST_CASE_SURFACES = {
  light: ['#FFFFFF', '#F9F9F9', '#F3F3F3'],
  dark: ['#2B2B2B', '#272727', '#3A3A3A'],
};

const DAMAGE_PREFIX = new RegExp(`^(${DAMAGE_TYPE_ORDER.join('|')})\\b`);

/** Colour for a damage type or a hit type that starts with one ("Toxin Tick"); null when there is none. */
export function damageTypeColor(type, dark) {
  const m = DAMAGE_PREFIX.exec(String(type ?? ''));
  return m ? DAMAGE_TYPE_COLORS[dark ? 'dark' : 'light'][m[1]] : null;
}

/** Sort damage types into the game's fixed order (unknown types last). */
export function byDamageTypeOrder(a, b) {
  const ia = DAMAGE_TYPE_ORDER.indexOf(a);
  const ib = DAMAGE_TYPE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
}

function luminance(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const channel = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
