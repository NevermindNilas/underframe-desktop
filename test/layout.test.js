// Arsenal layout maths (src/renderer/layout.js): breakpoints, 2:1 slot sizes that leave gallery rows, grid window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_RATIO, CHROME_HEIGHT, NOTICE_HEIGHT, galleryHeaderHeight, gridWindow, layoutFor, slotSizeFor, stageSizeFor } from '../src/renderer/layout.js';

test('breakpoints: library inline from 1680, stats folded under 1280, stacked under 1100', () => {
  assert.equal(layoutFor(1920, 1080).library, 'inline');
  assert.equal(layoutFor(1920, 1080).statsWidth, 300);
  assert.equal(layoutFor(1920, 1080).resultsWidth, 440);
  assert.equal(layoutFor(1440, 900).library, 'overlay');
  assert.equal(layoutFor(1440, 900).statsWidth, 264);
  assert.equal(layoutFor(1100, 700).statsFolded, true);
  assert.equal(layoutFor(1100, 700).compactHeight, true);
  assert.equal(layoutFor(960, 540).stacked, true);
});

test('slot cards are 2:1 and leave room for the gallery rows the layout promises', () => {
  for (const [w, h, stage] of [[1920, 1080, 880], [1440, 900, 796], [1100, 700, 760]]) {
    const layout = layoutFor(w, h);
    const s = slotSizeFor(layout, stage);
    assert.equal(s.height, Math.round(s.width / 2), `${w}x${h} keeps 2:1`);
    assert.ok(s.width >= 120 && s.width <= 240);
    const stageHeight = s.fixed + 3 * s.height;
    const gallery = h - CHROME_HEIGHT - stageHeight;
    const card = Math.round(layout.cardWidth * CARD_RATIO);
    const needed = galleryHeaderHeight(layout) + layout.galleryRows * card + (layout.galleryRows - 1) * 8;
    assert.ok(gallery >= needed, `${w}x${h}: gallery ${gallery} px holds ${layout.galleryRows} row(s) (${needed} px)`);
  }
  const stacked = slotSizeFor(layoutFor(960, 540), 500);
  assert.equal(stacked.columns, 2);
});

test('grid window renders only visible rows plus overscan', () => {
  const w = gridWindow({ count: 400, columns: 7, rowHeight: 201, scrollTop: 0, viewport: 300 });
  assert.equal(w.rows, 58);
  assert.equal(w.first, 0);
  assert.ok((w.last - w.first + 1) * 7 < 60, 'fewer than 60 cards in the DOM');
  const mid = gridWindow({ count: 400, columns: 7, rowHeight: 200, scrollTop: 2000, viewport: 400 });
  assert.equal(mid.first, 8);
  assert.equal(mid.last, 13);
  const offset = gridWindow({ count: 400, columns: 7, rowHeight: 200, scrollTop: 2000, viewport: 400, offset: 1000 });
  assert.equal(offset.first, 3, 'the stacked layout scrolls past the content above the grid first');
  assert.deepEqual(gridWindow({ count: 0, columns: 7, rowHeight: 200, scrollTop: 0, viewport: 400 }), { rows: 0, first: 0, last: -1 });
});

test('a notice never pushes the gallery card row out of view: it collapses to one line and the slots make room', () => {
  for (const [w, h, stage] of [[1920, 1080, 880], [1440, 900, 796], [1100, 700, 760], [1280, 720, 760], [1366, 768, 760]]) {
    const layout = layoutFor(w, h);
    const card = Math.round(layout.cardWidth * CARD_RATIO);
    const needed = galleryHeaderHeight(layout) + layout.galleryRows * card + (layout.galleryRows - 1) * 8;
    for (const notices of [1, 2]) {
      const { size, collapse } = stageSizeFor(layout, stage, notices);
      const bar = collapse ? NOTICE_HEIGHT.collapsed : notices * NOTICE_HEIGHT.expanded;
      const gallery = h - CHROME_HEIGHT - (size.fixed + 3 * size.height + bar);
      // The slots stop shrinking at 120 px; above that floor the card row always fits.
      if (size.width > 120) assert.ok(gallery >= needed, `${w}x${h} ${notices} notice(s): gallery ${gallery} px, needs ${needed}`);
      if (notices > 1) assert.equal(collapse, true);
    }
  }
  assert.equal(stageSizeFor(layoutFor(1440, 900), 796, 0).collapse, false);
});
