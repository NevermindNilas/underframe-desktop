// Riven screenshot reading (docs/port-rivens.md 13.4): Windows OCR output of riven cards drawn for the test
// (test/fixtures/riven-ocr/synthetic-*.json), and hand-made OCR for the cases a drawing doesn't cover (lost signs, a
// riven of another weapon, the text OCR mangles). Skips without the private core data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as M from '../src/renderer/model.js';
import { recognizeRivens, matchRivenStat } from '../src/shared/riven-recognition.js';
import { effectiveValue, rivenLines, validateRiven } from '../src/shared/rivens.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const skip = existsSync(coreDir + 'data/data.json') ? false : 'core submodule not checked out';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/riven-ocr/synthetic-${name}.json`, import.meta.url), 'utf8'));

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    const ctx = M.createContext(data);
    cached = { data, ctx, braton: ctx.weaponByName.get('Braton Prime') };
  }
  return cached;
}

/** OCR lines from texts, one per row, 40 px apart, centred at x. */
const ocrOf = (texts, x = 200) => ({
  width: 800,
  height: 600,
  lines: texts.map((t, i) => {
    let at = x - t.length * 4;
    return { text: t, pass: 'full', words: t.split(' ').map(w => { const word = { text: w, x: at, y: 100 + i * 40, w: w.length * 8, h: 14 }; at += w.length * 8 + 6; return word; }) };
  }),
});

test('one card: four stats at their in-game values, read at disposition 1.2 and rank 8', { skip }, () => {
  const { data, braton } = real();
  const [r] = recognizeRivens(fixture('one'), data, braton);
  assert.deepEqual(rivenLines(r.riven), ['+152.3% Critical Chance', '+98.7% Multishot', '+75.4% Toxin Damage', '−41.6% Zoom']);
  assert.equal(r.riven.disposition, 1.2);
  assert.equal(r.riven.rank, 8);
  assert.ok(Math.abs(effectiveValue(r.riven.stats[0], r.riven) - 1.523) < 1e-9);
  assert.ok(validateRiven(r.riven, { data, weapon: braton }).ok);
  assert.equal(r.otherFamily, null);
});

test('two cards side by side read as two rivens, "xO.88" as ×0.88 Damage to Corpus', { skip }, () => {
  const { data, braton } = real();
  const rs = recognizeRivens(fixture('two'), data, braton, { two: true });
  assert.equal(rs.length, 2);
  assert.deepEqual(rivenLines(rs[0].riven), ['+152.3% Critical Chance', '+98.7% Multishot', '−41.6% Zoom']);
  assert.deepEqual(rivenLines(rs[1].riven), ['+180.1% Damage', '+1.8 m Punch Through', '×0.88 Damage vs. Corpus']);
  assert.ok(rs[1].riven.stats[2].value < 0, 'a multiplier under 1 is the negative');
  // Without `two`, the clear gap still splits them: the left card comes first.
  const one = recognizeRivens(fixture('two'), data, braton);
  assert.equal(one.length, 2);
  assert.deepEqual(rivenLines(one[0].riven), rivenLines(rs[0].riven));
});

test('Fire Rate (x2 for Bows) is one stat, and "-35% Weapon Recoil" is the good recoil roll', { skip }, () => {
  const { data, braton } = real();
  const [r] = recognizeRivens(fixture('wrap'), data, braton);
  assert.deepEqual(r.riven.stats.map(s => s.name), ['Fire Rate/Attack Speed', 'Status Duration', 'Recoil']);
  assert.ok(r.riven.stats[2].value > 0);
  assert.deepEqual(r.unread, []);
});

test('lost signs follow the layout: with four stats the last is the negative', { skip }, () => {
  const { data, braton } = real();
  const [r] = recognizeRivens(ocrOf(['Braton Critatox', '152.3% Critical Chance', '98.7% Multishot', '75.4% Toxin', '41.6% Zoom']), data, braton);
  assert.deepEqual(r.riven.stats.map(s => Math.sign(s.value)), [1, 1, 1, -1]);
});

test('a riven named for another weapon says so, and unknown text is listed', { skip }, () => {
  const { data, braton } = real();
  const [r] = recognizeRivens(ocrOf(['Lanka Critatox', '+120% Critical Chance', '+90% Multishot', '+40% Wobble Factor']), data, braton);
  assert.equal(r.otherFamily, 'Lanka');
  assert.equal(r.riven.family, 'Braton');
  assert.deepEqual(r.unread, ['+40% Wobble Factor']);
  assert.deepEqual(recognizeRivens(ocrOf(['Nothing here']), data, braton), []);
});

test('stat names match the game\'s wording and OCR slips, short ones only when exact', { skip }, () => {
  const { data, braton } = real();
  const recog = t => recognizeRivens(ocrOf(['+100% Critical Chance', `+50% ${t}`]), data, braton)[0]?.riven?.stats?.[1]?.name ?? null;
  assert.equal(recog('Projectile Flight Speed'), 'Projectile Speed');
  assert.equal(recog('Magazine Capacity'), 'Magazine Capacity');
  assert.equal(recog('Critlcal Damage'), 'Critical Damage');
  assert.equal(recog('Electricity'), 'ElectricityDamage');
  assert.equal(recog('Gass'), null);
  assert.equal(matchRivenStat('', []), null);
});
