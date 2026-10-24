// Loadout | Readout layout maths (src/renderer/layout.js): breakpoints, slot sizes at rest and in the picking strip,
// Picker card sizes, grid window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_MIN, CARD_RATIO, TOP_BAR_HEIGHT, gridWindow, layoutFor, pickerCardSize, slotSizeFor } from '../src/renderer/layout.js';

test('breakpoints: one 48 px top bar, Readout width by window, library inline from 1680, stacked under 1100', () => {
  assert.equal(TOP_BAR_HEIGHT, 48);
  assert.equal(layoutFor(1920, 1080).library, 'inline');
  assert.equal(layoutFor(1920, 1080).readoutWidth, 600);
  assert.equal(layoutFor(1440, 900).library, 'overlay');
  assert.equal(layoutFor(1440, 900).readoutWidth, 560);
  assert.equal(layoutFor(1440, 900).body, 852);
  assert.equal(layoutFor(1100, 700).readoutWidth, 460);
  assert.equal(layoutFor(1100, 700).compactHeight, true);
  assert.equal(layoutFor(960, 540).stacked, true);
  assert.equal(layoutFor(960, 540).readoutWidth, null);
});

test('rest slots: 4 columns at 2:1, large at 1440 and never cramped at 1100', () => {
  const at = (w, h) => {
    const l = layoutFor(w, h);
    return slotSizeFor({ width: w - l.readoutWidth, height: l.body, gutter: l.gutter });
  };
  const big = at(1440, 900);
  assert.equal(big.columns, 4);
  assert.equal(big.height, Math.round(big.width / 2));
  assert.ok(big.width >= 190, `1440: ${big.width}`);
  const small = at(1100, 700);
  assert.ok(small.width >= 140 && small.width <= 150, `1100: ${small.width}`);
  // The slot block (special row + 2 rows) leaves at least half the Loadout for the lower area.
  for (const [w, h] of [[1100, 700], [1440, 900], [1920, 1080], [1280, 720]]) {
    const l = layoutFor(w, h);
    const s = slotSizeFor({ width: w - l.readoutWidth, height: l.body, gutter: l.gutter });
    assert.ok(3 * s.height + 24 <= l.body / 2 + 1, `${w}x${h}`);
  }
});

test('picking strip: 5 columns of 2:1 slots within 30% of the height', () => {
  for (const [w, h] of [[1100, 700], [1440, 900], [1920, 1080]]) {
    const l = layoutFor(w, h);
    const s = slotSizeFor({ width: w - l.readoutWidth, height: l.body, gutter: l.gutter, picking: true });
    assert.equal(s.columns, 5);
    assert.ok(s.width >= 100 && s.width <= 200);
    assert.ok(2 * s.height + 12 <= 0.3 * l.body + 1, `${w}x${h}: ${s.width}`);
    assert.ok(s.height >= 24, 'pointer targets stay above 24 px');
  }
  assert.equal(slotSizeFor({ width: 500, height: 600, gutter: 12, stacked: true }).columns, 2);
});

test('Picker cards: three full rows when they fit, else two, never under the minimum', () => {
  const big = pickerCardSize(832, 528);
  assert.equal(big.rows, 3);
  assert.ok(big.columns * big.rows >= 15, `1440 shows ${big.columns}x${big.rows}`);
  const small = pickerCardSize(608, 396);
  assert.equal(small.rows, 2);
  assert.ok(small.columns * small.rows >= 8, `1100 shows ${small.columns}x${small.rows}`);
  assert.equal(pickerCardSize(600, 100).width, CARD_MIN);
  const pref = pickerCardSize(800, 500, 168);
  assert.equal(pref.width, 168);
  assert.equal(pref.height, Math.round(168 * CARD_RATIO));
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

test('Picker cards fill the row: a nearly fitting extra column takes a few pixels from each card', () => {
  const s = pickerCardSize(822, 529);
  assert.equal(s.columns, 7);
  assert.equal(s.rows, 3);
  assert.ok(s.width >= CARD_MIN && 7 * s.width + 6 * 8 <= 822, `${s.width}`);
  const exact = pickerCardSize(1000, 529);
  assert.ok((exact.columns - 1) * 8 + exact.columns * exact.width <= 1000);
});
