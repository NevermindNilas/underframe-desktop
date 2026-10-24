// Layout maths for the Loadout | Readout workspace (docs/declutter-spec.md 1-2): the window's layout class, slot
// card sizes at rest and in the picking strip, the Picker's card size and the card grid's virtualised row window.
// Pure: no DOM, no React.

/** Full mod card images are 240 x 351: gallery cards keep that ratio so nothing is cropped. */
export const CARD_RATIO = 351 / 240;
/** The only chrome: the 48 px top bar (title bar and build toolbar in one). */
export const TOP_BAR_HEIGHT = 48;
/** Gap between slot cards and between card rows. */
export const SLOT_GAP = 12;
export const CARD_GAP = 8;
/**
 * Smallest and largest automatic Picker card widths. The card's effect is HTML text over the art's own (tiny) effect
 * text, so a smaller card still reads (docs/declutter-spec.md 1.1).
 */
export const CARD_MIN = 104;
export const CARD_MAX = 160;

/**
 * Window layout class (docs/declutter-spec.md 2), by width and height in CSS px.
 * - library: 'inline' (>= 1680, starts closed) or 'overlay'.
 * - readoutWidth: the Readout column; the Loadout takes the rest.
 * - compactHeight (< 800): 24 px stat rows and a 32 px DPS.
 * - tall (>= 880): 32 px stat rows with 16 px text, so the stats grow with the window instead of the chart.
 * - stacked (< 1100, only reachable by zooming in): one scroll area, Readout first (2.5).
 */
export function layoutFor(width, height = 900) {
  const compactHeight = height < 800;
  const tall = height >= 880;
  const body = Math.max(0, height - TOP_BAR_HEIGHT);
  if (width < 1100) {
    return {
      stacked: true, library: 'overlay', libraryWidth: Math.min(300, Math.max(240, width - 48)), readoutWidth: null,
      gutter: 12, compactHeight, tall, body,
    };
  }
  const library = width >= 1680 ? 'inline' : 'overlay';
  const libraryWidth = width >= 1920 ? 300 : width >= 1680 ? 264 : 300;
  const readoutWidth = width >= 1920 ? 600 : width >= 1400 ? 560 : width >= 1280 ? 500 : 460;
  const gutter = width >= 1400 && !compactHeight ? 24 : 16;
  return { stacked: false, library, libraryWidth, readoutWidth, gutter, compactHeight, tall, body };
}

/**
 * Slot card size (2:1) for a Loadout of `width` x `height` (spec 1.1).
 * Both states are a 5x2 block: slots 1-4 then Arcane, slots 5-8 then Exilus (the special slots on the right).
 * - rest: the block takes at most half the height, up to 280 px wide slots on large windows (the arsenal, not the
 *   chart, takes the extra room).
 * - picking: the block takes at most 30% of the height.
 * - stacked: 2 columns under 600 px (3 while picking).
 * Returns { width, height, columns }.
 */
export function slotSizeFor({ width, height, gutter, picking = false, stacked = false }) {
  const inner = Math.max(0, width - 2 * gutter);
  if (stacked) {
    const columns = inner < 600 ? (picking ? 3 : 2) : 5;
    const w = Math.min(240, Math.max(100, Math.floor((inner - (columns - 1) * SLOT_GAP) / columns)));
    return { width: w, height: Math.round(w / 2), columns };
  }
  if (picking) {
    const byWidth = (inner - 4 * SLOT_GAP) / 5;
    const byHeight = ((0.3 * height - SLOT_GAP) / 2) * 2;
    const w = Math.max(100, Math.min(200, Math.floor(Math.min(byWidth, byHeight))));
    return { width: w, height: Math.round(w / 2), columns: 5 };
  }
  const byWidth = (inner - 4 * SLOT_GAP) / 5;
  const byHeight = ((0.5 * height - SLOT_GAP) / 2) * 2;
  const w = Math.max(100, Math.min(280, Math.floor(Math.min(byWidth, byHeight))));
  return { width: w, height: Math.round(w / 2), columns: 5 };
}

/**
 * Picker card width for a grid area of `gridWidth` x `gridHeight` (spec 2.2): as large as fits three full rows
 * (else two, else one), between CARD_MIN and CARD_MAX. `pref` is a fixed size from the Filters popover.
 * Returns { width, height, columns, rows } (rows: full rows that fit).
 */
export function pickerCardSize(gridWidth, gridHeight, pref = null) {
  const size = w => {
    const height = Math.round(w * CARD_RATIO);
    const columns = Math.max(1, Math.floor((gridWidth + CARD_GAP) / (w + CARD_GAP)));
    const rows = Math.max(0, Math.floor((gridHeight + CARD_GAP) / (height + CARD_GAP)));
    return { width: w, height, columns, rows };
  };
  if (pref) return size(pref);
  // Fill the row: when one more column nearly fits, the cards give up a few pixels for it (never below the minimum).
  const fill = w => {
    const n = Math.round((gridWidth + CARD_GAP) / (w + CARD_GAP));
    const narrower = Math.floor((gridWidth - (n - 1) * CARD_GAP) / n);
    return n >= 1 && narrower < w && narrower >= CARD_MIN && narrower >= w - 8 ? narrower : w;
  };
  for (const rows of [3, 2]) {
    const w = Math.floor((gridHeight - (rows - 1) * CARD_GAP) / rows / CARD_RATIO);
    if (w >= CARD_MIN) return size(fill(Math.min(CARD_MAX, w)));
  }
  return size(CARD_MIN);
}

/**
 * Virtualised grid rows: which rows of a fixed-row-height grid are visible in a scroll element, plus `overscan`
 * rows above and below. `offset` is the grid's top within the scroll content (the stacked layout scrolls the whole
 * page, so the grid starts further down).
 */
export function gridWindow({ count, columns, rowHeight, scrollTop, viewport, offset = 0, overscan = 2 }) {
  const rows = Math.ceil(count / Math.max(1, columns));
  if (!rows || rowHeight <= 0) return { rows, first: 0, last: -1 };
  const top = Math.max(0, scrollTop - offset);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(rows - 1, Math.ceil((top + Math.max(viewport, rowHeight)) / rowHeight) + overscan - 1);
  return { rows, first, last };
}
