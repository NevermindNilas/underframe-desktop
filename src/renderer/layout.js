// Layout maths for the arsenal workspace (docs/arsenal-spec.md 2): the window's layout class, slot card sizes and
// the gallery's virtualised row window. Pure: no DOM, no React.

/** Full mod card images are 240 x 351: gallery cards keep that ratio so nothing is cropped. */
export const CARD_RATIO = 351 / 240;
/** Window chrome around the workspace body: title bar 48, build toolbar 56, status bar 28. */
export const CHROME_HEIGHT = 48 + 56 + 28;

/**
 * Window layout class (docs/arsenal-spec.md 2.1), by width and height in CSS px.
 * - library: 'inline' (>= 1680) or 'overlay'; statsWidth 0 when the stats fold into a results tab (< 1280).
 * - cardWidth: the default gallery card width; galleryRows: card rows the gallery keeps room for.
 * - compactHeight (< 800): the stage header holds the capacity meter and the special-row captions sit inside the slots.
 * - stacked (< 1100, only reachable by zooming in): one scroll area with a sticky DPS bar (2.5).
 */
export function layoutFor(width, height = 900) {
  const compactHeight = height < 800;
  const body = Math.max(0, height - CHROME_HEIGHT);
  const base = { compactHeight, body, stacked: false, statsFolded: false };
  if (width >= 1920) return { ...base, library: 'inline', libraryWidth: 300, statsWidth: 300, resultsWidth: 440, gutter: 24, cardWidth: 120, galleryRows: 2 };
  if (width >= 1680) return { ...base, library: 'inline', libraryWidth: 264, statsWidth: 264, resultsWidth: 380, gutter: 24, cardWidth: 132, galleryRows: 1 };
  if (width >= 1280) return { ...base, library: 'overlay', libraryWidth: 300, statsWidth: 264, resultsWidth: 380, gutter: 16, cardWidth: 132, galleryRows: 1 };
  if (width >= 1100) return { ...base, library: 'overlay', libraryWidth: 300, statsWidth: 0, statsFolded: true, resultsWidth: 340, gutter: 16, cardWidth: 112, galleryRows: 1 };
  return {
    ...base, library: 'overlay', libraryWidth: Math.min(300, Math.max(240, width - 48)), statsWidth: 0, statsFolded: true,
    resultsWidth: null, gutter: 12, stacked: true, cardWidth: 112, galleryRows: 1,
  };
}

/** Gallery header height: two rows (tabs + search, then filter chips), or one condensed row under 800 px. */
export const galleryHeaderHeight = layout => (layout.compactHeight ? 52 : 96);

/**
 * Slot card size for a stage width (docs/arsenal-spec.md 2.1): a quarter of the stage minus gutters, 2:1, as large
 * as fits while the gallery below keeps `galleryRows` full card rows. `reserve` is extra stage height (a notice
 * bar) to keep room for. Returns { width, height, fixed, columns, slack }, where `fixed` is the stage's height
 * besides the three slot rows and `slack` the height left over once the gallery has its card rows (Infinity in the
 * stacked layout, which scrolls).
 */
export function slotSizeFor(layout, stageWidth, cardWidth = layout.cardWidth, reserve = 0) {
  const g = layout.gutter;
  const columns = layout.stacked && stageWidth < 600 ? 2 : 4;
  const byWidth = Math.max(0, (stageWidth - 2 * g - (columns - 1) * 12) / columns);
  // Normal: header 48, capacity 28, captions above the special row 20, the selection caption 20, three 12 px gaps
  // between those blocks and two between slot rows. Compact: a 44 px header holding the capacity, one 8 px gap.
  const fixed = layout.compactHeight ? 44 + 8 + 24 + 2 * g : 48 + 28 + 20 + 20 + 36 + 24 + 2 * g;

  if (layout.stacked) {
    const w = Math.min(240, Math.max(140, Math.floor(byWidth)));
    return { width: w, height: Math.round(w / 2), fixed, columns, slack: Infinity };
  }
  const cardH = Math.round(cardWidth * CARD_RATIO);
  const gallery = galleryHeaderHeight(layout) + layout.galleryRows * cardH + (layout.galleryRows - 1) * 8 + 4;
  const byHeight = ((layout.body - gallery - fixed - reserve) / 3) * 2;
  const w = Math.max(120, Math.min(240, Math.floor(Math.min(byWidth, byHeight))));
  const height = Math.round(w / 2);
  return { width: w, height, fixed, columns, slack: layout.body - gallery - fixed - reserve - 3 * height };
}

/** Height a notice takes in the stage: an expanded multi-line MessageBar, or the one-line collapsed bar (plus the gap). */
export const NOTICE_HEIGHT = { expanded: 76, collapsed: 48 };

/**
 * Stage size with notices showing (spec 2.1): expanded when the gallery still keeps its card row, else collapsed
 * into one line, with the slots shrunk (to their 120 px floor) so the line doesn't cut into the card row.
 * Returns { size, collapse }.
 */
export function stageSizeFor(layout, stageWidth, notices = 0, cardWidth = layout.cardWidth) {
  const plain = slotSizeFor(layout, stageWidth, cardWidth);
  if (!notices || layout.stacked) return { size: plain, collapse: layout.compactHeight };
  if (!layout.compactHeight && notices === 1 && plain.slack >= NOTICE_HEIGHT.expanded) return { size: plain, collapse: false };
  if (plain.slack >= NOTICE_HEIGHT.collapsed) return { size: plain, collapse: true };
  return { size: slotSizeFor(layout, stageWidth, cardWidth, NOTICE_HEIGHT.collapsed), collapse: true };
}

/**
 * Virtualised grid rows (docs/arsenal-spec.md 5.3): which rows of a fixed-row-height grid are visible in a scroll
 * element, plus `overscan` rows above and below. `offset` is the grid's top within the scroll content (the stacked
 * layout scrolls the whole page, so the grid starts further down).
 */
export function gridWindow({ count, columns, rowHeight, scrollTop, viewport, offset = 0, overscan = 2 }) {
  const rows = Math.ceil(count / Math.max(1, columns));
  if (!rows || rowHeight <= 0) return { rows, first: 0, last: -1 };
  const top = Math.max(0, scrollTop - offset);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(rows - 1, Math.ceil((top + Math.max(viewport, rowHeight)) / rowHeight) + overscan - 1);
  return { rows, first, last };
}

