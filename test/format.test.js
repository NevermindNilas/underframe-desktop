// Number and time formatting (src/renderer/format.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAxis, fmtCompact, fmtInt, fmtRelative, fmtSignedPct } from '../src/renderer/format.js';

test('numbers', () => {
  assert.equal(fmtInt(5774.4), '5,774');
  assert.equal(fmtInt(NaN), '—');
  assert.equal(fmtCompact(25000), '25k');
  assert.equal(fmtCompact(5774), '5,774');
  assert.equal(fmtCompact(3_450_000), '3.45M');
  assert.equal(fmtSignedPct(0.042), '+4.2%');
  assert.equal(fmtSignedPct(-0.1), '−10%');
  assert.equal(fmtSignedPct(0), '0%');
});

test('relative times', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(fmtRelative('2026-10-24T11:59:30Z', now), 'just now');
  assert.equal(fmtRelative('2026-10-24T11:55:00Z', now), '5 min ago');
  assert.equal(fmtRelative('2026-10-24T10:00:00Z', now), '2 h ago');
  assert.equal(fmtRelative('2026-10-21T12:00:00Z', now), '3 d ago');
  assert.equal(fmtRelative('not a date', now), '');
  assert.match(fmtRelative('2026-01-01T00:00:00Z', now), /2026/);
});

test('axis ticks use one style for every value', () => {
  assert.deepEqual([0, 500, 5000, 6250, 12500, 25000, 1.5e6].map(fmtAxis), ['0', '500', '5k', '6.3k', '12.5k', '25k', '1.5M']);
  assert.equal(fmtAxis(2.5), '2.5');
  assert.equal(fmtAxis(NaN), '');
});
