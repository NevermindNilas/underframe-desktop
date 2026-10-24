// Damage-type colours reach 3:1 on every surface they can sit on, in both themes (WCAG 1.4.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMAGE_TYPE_COLORS, DAMAGE_TYPE_ORDER, WORST_CASE_SURFACES, byDamageTypeOrder, contrastRatio, damageTypeColor } from '../src/renderer/palette.js';

test('contrast ratio matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.ok(Math.abs(contrastRatio('#767676', '#FFFFFF') - 4.54) < 0.01);
});

test('every damage type has a colour in both themes with at least 3:1 contrast', () => {
  for (const theme of ['light', 'dark']) {
    for (const type of DAMAGE_TYPE_ORDER) {
      const color = DAMAGE_TYPE_COLORS[theme][type];
      assert.match(color, /^#[0-9a-f]{6}$/i, `${theme} ${type}`);
      for (const surface of WORST_CASE_SURFACES[theme]) {
        const ratio = contrastRatio(color, surface);
        assert.ok(ratio >= 3, `${theme} ${type} ${color} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('hit types map to their damage type colour', () => {
  assert.equal(damageTypeColor('Toxin Tick', true), DAMAGE_TYPE_COLORS.dark.Toxin);
  assert.equal(damageTypeColor('Slash', false), DAMAGE_TYPE_COLORS.light.Slash);
  assert.equal(damageTypeColor('Direct hit', false), null);
  assert.deepEqual(['Toxin', 'Impact', 'Weird', 'Slash'].sort(byDamageTypeOrder), ['Impact', 'Slash', 'Toxin', 'Weird']);
});
