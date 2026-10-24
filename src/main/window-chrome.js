// Window chrome decisions (Mica, title bar overlay colours, initial size). Pure, so they run in plain node.

export const TITLE_BAR_HEIGHT = 48;
export const MIN_SIZE = { width: 1100, height: 700 };
export const DEFAULT_SIZE = { width: 1440, height: 900 };
/** Windows 11 22H2: the first build where backgroundMaterial 'mica' is supported. */
export const MICA_MIN_BUILD = 22621;

/** WinUI solid base colours, used when Mica is unavailable. */
export const SOLID_BACKGROUND = { light: '#F3F3F3', dark: '#202020' };
/** Caption button glyphs: Fluent colorNeutralForeground1 per theme. */
export const SYMBOL_COLOR = { light: '#242424', dark: '#FFFFFF' };
export const TRANSPARENT = '#00000000';

/** Windows build number from os.release() ("10.0.22631" -> 22631), or 0. */
export function windowsBuild(release) {
  const n = Number(String(release ?? '').split('.')[2]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whether to ask for a Mica backdrop: Windows 11 22H2 or later, high contrast off,
 * and not disabled with UF_NO_MICA=1 (testing).
 */
export function wantsMica({ platform, release, env = {}, highContrast = false }) {
  if (platform !== 'win32' || env.UF_NO_MICA === '1' || highContrast) return false;
  return windowsBuild(release) >= MICA_MIN_BUILD;
}

/** UF_THEME=light|dark forces nativeTheme.themeSource (testing); anything else follows the system. */
export function themeSourceFrom(env = {}) {
  const v = String(env.UF_THEME ?? '').toLowerCase();
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** UF_WINDOW_SIZE=WxH overrides the initial size; never below the minimum. */
export function initialSize(env = {}) {
  const m = /^(\d{3,5})x(\d{3,5})$/i.exec(String(env.UF_WINDOW_SIZE ?? '').trim());
  if (!m) return { ...DEFAULT_SIZE };
  return { width: Math.max(MIN_SIZE.width, Number(m[1])), height: Math.max(MIN_SIZE.height, Number(m[2])) };
}

/**
 * Title bar overlay options. The overlay itself is transparent so the backdrop shows through; the glyph
 * colour follows the theme, or the high-contrast window text colour.
 */
export function titleBarOverlay({ dark, highContrast = false, highContrastText = null }) {
  const symbolColor = highContrast && highContrastText ? normalizeHex(highContrastText) : dark ? SYMBOL_COLOR.dark : SYMBOL_COLOR.light;
  return { color: TRANSPARENT, symbolColor, height: TITLE_BAR_HEIGHT };
}

/** Zoom steps (Chromium zoom levels; 1 level = 20%): 200% is about +3.8, so allow -3..+4. */
export const ZOOM_LIMITS = { min: -3, max: 4, step: 0.5 };

/**
 * The zoom keys, also in the packaged app (which has no menu): Ctrl+Plus / Ctrl+= / Ctrl+NumpadAdd zoom in,
 * Ctrl+Minus / Ctrl+NumpadSubtract zoom out, Ctrl+0 / Ctrl+Numpad0 resets. `input` is Electron's
 * before-input-event input. Returns the new zoom level, or null when the key isn't a zoom key.
 */
export function zoomFor(input, level = 0) {
  if (!input || input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  const { min, max, step } = ZOOM_LIMITS;
  const code = String(input.code ?? '');
  const key = String(input.key ?? '');
  let next = null;
  if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') next = level + step;
  else if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') next = level - step;
  else if (key === '0' || code === 'Digit0' || code === 'Numpad0') next = 0;
  if (next == null) return null;
  return Math.min(max, Math.max(min, next));
}

/** Window background: transparent under Mica, else the solid base colour. */
export function windowBackground({ backdrop, dark }) {
  return backdrop === 'mica' ? TRANSPARENT : dark ? SOLID_BACKGROUND.dark : SOLID_BACKGROUND.light;
}

/** systemPreferences.getColor returns '#RRGGBBAA'; the overlay wants '#RRGGBB'. */
function normalizeHex(c) {
  const s = String(c);
  return /^#[0-9a-f]{8}$/i.test(s) ? s.slice(0, 7) : s;
}
