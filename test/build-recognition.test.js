import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptScore, buildVocabulary, rankFromProfile, damerauLevenshtein, drainAt, inferRank, looksLikeRiven, matchWeaponInText, nameSimilarity,
  normalizeName, rankMatches, ranksForDrain, recognizeBuild, rivenWeaponFamily, textBlocks, trigramSimilarity,
} from '../src/shared/build-recognition.js';
import {
  MAX_IMAGE_BYTES, brightTextFilter, findCardAnchors, mapBox, measurePips, planDetailPasses, planFullPass, sniffImageType, toBuffer,
} from '../src/main/ocr/preprocess.js';
import { slotDrain } from '../src/shared/capacity.js';
import { isGameWindowTitle, pickGameSource } from '../src/main/ocr/game-window.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'test', 'fixtures', 'ocr');
const dataPath = path.join(root, 'core', 'data', 'data.json');
const haveCore = existsSync(dataPath);

// A small hand-written vocabulary in the data.json shapes (names only matter; the numbers are made up).
const mod = (name, type, compat, drain, max, extra = {}) => ({ 'Local Name': name, Type: type, 'Compat Name': compat, 'Base Drain': drain, 'Fusion Limit': max, Polarity: 'AP_ATTACK', ...extra });
const tiny = {
  mods: [
    mod('Serration', 'PRIMARY', 'Rifle', 4, 10),
    mod('Split Chamber', 'PRIMARY', 'Rifle', 5, 5),
    mod('Primed Cryo Rounds', 'PRIMARY', 'Rifle', 6, 10),
    mod('Point Blank', 'PRIMARY', 'Shotgun', 4, 5),
    mod('Hornet Strike', 'SECONDARY', 'Pistol', 4, 10),
    mod('Primed Heated Charge', 'SECONDARY', 'Pistol', 6, 10),
    mod('Lethal Torrent', 'SECONDARY', 'Pistol', 6, 5),
    mod('Pistol Ammo Mutation', 'SECONDARY', 'Pistol', 2, 5),
    mod('Stabilizer', 'PRIMARY', 'Rifle', 6, 3),
    mod('Steel Charge', 'WARFRAME', 'AURA', -2, 5),
  ],
  exilusMods: ['Pistol Ammo Mutation', 'Stabilizer'],
  weapons: [
    { name: 'Braton', type: 'Primary', subtype: 'Rifle', fire_modes: [{}] },
    { name: 'Braton Prime', type: 'Primary', subtype: 'Rifle', fire_modes: [{}] },
    { name: 'Laetum', type: 'Secondary', subtype: 'Pistol', fire_modes: [{}] },
    { name: 'Sobek', type: 'Primary', subtype: 'Shotgun', fire_modes: [{}] },
    { name: 'Kuva Sobek', type: 'Primary', subtype: 'Shotgun', fire_modes: [{}] },
    { name: 'Catchmoon (Primary)', type: 'Primary', subtype: 'Shotgun', fire_modes: [{}] },
    { name: 'Catchmoon (Secondary)', type: 'Secondary', subtype: 'Pistol', fire_modes: [{}] },
  ],
  arcanes: [{ arcane_name: 'Primary Deadhead' }, { arcane_name: 'Secondary Deadhead' }],
  conditionals: { arcanes: [{ name: 'Primary Deadhead', type: 'Primary' }, { name: 'Secondary Deadhead', type: 'Secondary' }] },
};

// ---------- fuzzy matching ----------

test('normalizeName folds case, accents and the usual OCR confusions on both sides', () => {
  assert.equal(normalizeName('Primed Cryo Rounds'), 'prlmed cryo rounds');
  assert.equal(normalizeName('PR1MED CRY0 R0UNDS'), normalizeName('Primed Cryo Rounds'));
  assert.equal(normalizeName('Pr|med Cryo Rounds'), normalizeName('Primed Cryo Rounds'));
  assert.equal(normalizeName('Hornet Stnke'), 'homet stnke'); // rn and m read alike
  assert.equal(normalizeName('Arnalgam'), normalizeName('Amalgam'));
  assert.equal(normalizeName('Semi-Pistol  Cannonade'), 'seml plstol cannonade');
  assert.equal(normalizeName('Kavat\'s Grace'), 'kavats grace');
  assert.equal(normalizeName('Améliorations'), 'amellloratlons'.replace('lll', 'll'));
});

test('Damerau-Levenshtein counts a transposition as one edit', () => {
  assert.equal(damerauLevenshtein('serration', 'serration'), 0);
  assert.equal(damerauLevenshtein('serration', 'sreration'), 1);
  assert.equal(damerauLevenshtein('serration', 'seration'), 1);
  assert.equal(damerauLevenshtein('', 'abc'), 3);
  assert.equal(damerauLevenshtein('kitten', 'sitting'), 3);
});

test('similarity ignores spaces, rewards near misses and rejects different names', () => {
  assert.equal(nameSimilarity('hornet strike', 'hornet strike'), 1);
  assert.ok(nameSimilarity('hornetstrike', 'hornet strike') > 0.95);
  assert.ok(nameSimilarity(normalizeName('Galvanized Clymber'), normalizeName('Galvanized Chamber')) > 0.8);
  assert.ok(nameSimilarity(normalizeName('Point Blank'), normalizeName('Primed Point Blank')) < 0.8);
  assert.ok(trigramSimilarity('serration', 'serration') === 1);
  assert.ok(trigramSimilarity('serration', 'split chamber') < 0.2);
});

test('rankMatches finds the closest vocabulary entry and acceptScore guards short names', () => {
  const vocab = buildVocabulary(tiny);
  const [best] = rankMatches('Prlmed Heatd Charge', vocab.mods);
  assert.equal(best.entry.name, 'Primed Heated Charge');
  assert.ok(best.score >= acceptScore(best.entry.key));
  assert.deepEqual(rankMatches('ab', vocab.mods), []);
  assert.ok(acceptScore('shred') > acceptScore('primed cryo rounds'));
  // Only gun mods are in the vocabulary.
  assert.ok(!vocab.mods.some(m => m.name === 'Steel Charge'));
});

test('the weapon is found inside a header line; longer names win and variants share a key', () => {
  const vocab = buildVocabulary(tiny);
  assert.equal(matchWeaponInText('EIJPGRADES/BRATON PRIME [30]', vocab.weapons).entry.name, 'Braton Prime');
  assert.equal(matchWeaponInText('UPGRADES: BRATON RANK 30', vocab.weapons).entry.name, 'Braton');
  assert.equal(matchWeaponInText('F:COPP DODO KUVA SOBEK -3>538', vocab.weapons).entry.name, 'Kuva Sobek');
  assert.equal(matchWeaponInText('_ UPGRADES/LAETUM [30]', vocab.weapons).entry.name, 'Laetum');
  assert.equal(matchWeaponInText('CAPACITY 3/60', vocab.weapons), null);
  const catchmoon = vocab.weapons.filter(w => w.key === normalizeName('Catchmoon'));
  assert.equal(catchmoon.length, 2);
});

test('the weapon-from-riven fallback needs a riven-shaped name, not any text starting with a family', () => {
  const vocab = buildVocabulary(tiny);
  assert.equal(rivenWeaponFamily('Laetum Vexipha', vocab.weapons)?.family, 'laetum');
  assert.equal(rivenWeaponFamily('I-Laetum Critacan', vocab.weapons)?.family, 'laetum');
  assert.equal(rivenWeaponFamily('Sob ek Acrido', vocab.weapons)?.family, 'sobek');
  assert.equal(rivenWeaponFamily('Sobek Acrido', vocab.weapons)?.weapon.name, 'Sobek', 'the plainest weapon of the family');
  // HUD weapon labels, component names, single words and player names are not rivens.
  for (const text of ['SOBEK PRIME [30]', 'Laetum Prime Receiver', 'Laetum', 'Sobekacrido', 'XSobekacrido O', 'Laetum Vexipha 2']) {
    assert.equal(rivenWeaponFamily(text, vocab.weapons), null, text);
  }
});

test('rivens are told apart from unreadable cards by their weapon-family prefix', () => {
  const vocab = buildVocabulary(tiny);
  assert.ok(looksLikeRiven('Laetum Vexipha', vocab.weapons));
  assert.ok(looksLikeRiven('I-Laetum Critacan', vocab.weapons));
  assert.ok(looksLikeRiven('Sob ek Acrido', vocab.weapons));
  assert.ok(!looksLikeRiven('Hornet Stnke', vocab.weapons));
  assert.ok(!looksLikeRiven('Laetum', vocab.weapons));
});

// ---------- rank ----------

test('drain follows the capacity rules: matching polarity halves (up), mismatching adds a quarter (rounded)', () => {
  const galv = mod('Galvanized Chamber', 'PRIMARY', 'Rifle', 6, 10);
  assert.deepEqual(drainAt(galv, 10), { neutral: 16, match: 8, mismatch: 20 });
  assert.deepEqual(drainAt(galv, 9), { neutral: 15, match: 8, mismatch: 19 });
  // The same numbers as the slot drain plates and the capacity meter (capacity.js slotDrain).
  const serration = mod('Serration', 'PRIMARY', 'Rifle', 4, 10);
  assert.deepEqual(drainAt(serration, 10), { neutral: 14, match: 7, mismatch: 18 });
  assert.equal(drainAt(serration, 10).mismatch, slotDrain(serration, 10, 'AP_TACTIC').drain);
  assert.ok(ranksForDrain(serration, 18).some(r => r.rank === 10 && r.polarity === 'mismatch'));
  assert.deepEqual(drainAt(mod('Plain', 'PRIMARY', 'Rifle', 4, 5, { Polarity: null }), 5), { neutral: 9, match: 9, mismatch: 9 });
  // Rank 9 and 10 both show 8 on a matching slot: the drain alone cannot tell them apart.
  assert.deepEqual(ranksForDrain(galv, 8).map(r => r.rank).sort((a, b) => a - b), [0, 2, 9, 10]);
  const pam = tiny.mods.find(m => m['Local Name'] === 'Pistol Ammo Mutation');
  assert.deepEqual(ranksForDrain(pam, 3), [{ rank: 0, polarity: 'mismatch' }, { rank: 1, polarity: 'neutral' }, { rank: 3, polarity: 'match' }, { rank: 4, polarity: 'match' }]);
});

test('rank comes from the pips, then the drain, then max rank', () => {
  const serration = tiny.mods[0];
  const stabilizer = tiny.mods.find(m => m['Local Name'] === 'Stabilizer');
  // The max-rank bar wins, even when its glow hid the pips.
  assert.deepEqual(inferRank(serration, { pips: { bar: true, lit: null } }), { rank: 10, source: 'pips', confidence: 0.9 });
  assert.equal(inferRank(serration, { pips: { lit: 9, detected: 9, total: 10, bar: false } }).rank, 9);
  // Grey pips only: rank 0.
  assert.equal(inferRank(stabilizer, { pips: { lit: 0, grey: 3, total: 3 } }).rank, 0);
  // The first lit pip was missed: count back from the last one and the card centre.
  assert.equal(inferRank(serration, { pips: { lit: 7, detected: 7, total: 6, first: 130, last: 205, center: 160, spacing: 10 } }).rank, 10);
  // Wider pip spacing (canticles): as many lit pips as ranks.
  assert.equal(inferRank(stabilizer, { pips: { lit: 5, detected: 3, total: 6, first: 0, last: 40, center: 20, spacing: 10 } }).rank, 3);
  // No pips: an unambiguous drain decides; otherwise max rank, flagged as assumed.
  assert.deepEqual(inferRank(serration, { drain: 12 }), { rank: 8, source: 'drain', confidence: 0.85 });
  // 13 is rank 9 unpolarised or rank 6 on a mismatching slot (10 + a quarter, rounded): flagged, not trusted.
  const ambiguous = inferRank(serration, { drain: 13 });
  assert.equal(ambiguous.confidence < 0.85, true);
  assert.match(ambiguous.note, /6, 9/);
  assert.equal(inferRank(stabilizer, { drain: 9 }).rank, 3); // also fits rank 1 on a mismatching slot
  assert.equal(inferRank(serration, {}).source, 'assumed');
  assert.equal(inferRank(serration, {}).rank, 10);
});

test('rank from the pip-row profile: pip k of n sits k - (n - 1) / 2 spacings from the centre', () => {
  // 25 samples every half spacing; 10 pips sit on odd offsets -9..9, 5 pips on even offsets -4..4.
  const profile = litPips => {
    const samples = Array(25).fill(0);
    for (const offset of litPips) samples[12 + offset] = 0.6;
    return { center: 0, samples };
  };
  assert.deepEqual(rankFromProfile(profile([-9, -7, -5, -3, -1, 1, 3]), 10), { rank: 7, confidence: 0.92 });
  // One pip missed by the sampler still counts.
  assert.deepEqual(rankFromProfile(profile([-9, -7, -3, -1, 1, 3]), 10), { rank: 7, confidence: 0.75 });
  assert.equal(rankFromProfile(profile([-4, -2, 0, 2, 4]), 5).rank, 5);
  // Lit just outside the row: wrong pip count or centre, so no answer.
  assert.equal(rankFromProfile(profile([-6, -4, -2, 0]), 5), null);
  assert.equal(rankFromProfile(profile([]), 5), null);
  assert.equal(rankFromProfile(null, 5), null);
});

// ---------- layout ----------

const word = (text, x, y, w = text.length * 10, h = 18) => ({ text, x, y, w, h });
const line = (text, x, y, pass = 'slots') => ({ text, pass, words: [word(text, x, y)] });

test('names that wrap onto a second line are joined, side-by-side words too', () => {
  const blocks = textBlocks([
    line('Primed Heated', 900, 300),
    line('Charge', 935, 322),
    line('Horne', 640, 450),
    line('Strike', 700, 450),
  ], { width: 1920, height: 1080 });
  const texts = blocks.map(b => b.lines.join(' / '));
  assert.ok(texts.includes('Primed Heated / Charge'));
  assert.ok(texts.includes('Horne Strike'));
});

/** A synthetic upgrade screen: header, 2 x 4 grid, exilus to the right, arcane above it, inventory below. */
function syntheticScreen() {
  const W = 1920, H = 1080;
  const col = i => 640 + i * 245;
  const rowY = [322, 457];
  const names = [['Serration', 'Split Chamber', 'Primed Cryo Rounds', 'Braton Kronicon'], ['Point Blank', 'Stabilizer', 'Serration', 'Split Chamber']];
  const lines = [line('_ UPGRADES/BRATON PRIME [30]', 120, 45, 'title'), line('CAPACITY', 107, 120, 'full'), line('Primary Deadhead', 1615, 272)];
  const cards = [];
  names.forEach((row, r) => row.forEach((n, c) => {
    const w = n.length * 10;
    lines.push({ text: n, pass: 'slots', words: [word(n, col(c) - w / 2, rowY[r])] });
    cards.push({ x: col(c), y: rowY[r], pips: { lit: 5, detected: 5, total: 5, bar: c === 0 } });
  }));
  lines.push({ text: 'Stabilizer', pass: 'slots', words: [word('Stabilizer', col(4) - 50, 389)] });
  cards.push({ x: col(4), y: 389, pips: { lit: 0, grey: 3, total: 3 } });
  lines.push(line('SEARCH...', 107, 640, 'full'));
  lines.push({ text: 'Hornet Strike', pass: 'full', words: [word('Hornet Strike', 700, 740)] });
  return { width: W, height: H, lines, cards };
}

test('recognizeBuild reads the grid row by row, the exilus, the arcane, and skips the inventory', () => {
  const r = recognizeBuild(syntheticScreen(), tiny);
  assert.equal(r.weapon.name, 'Braton Prime');
  assert.deepEqual(r.slots.map(s => s.name), ['Serration', 'Split Chamber', 'Primed Cryo Rounds', null, 'Point Blank', 'Stabilizer', 'Serration', 'Split Chamber']);
  assert.equal(r.slots[3].kind, 'riven');
  assert.equal(r.slots[0].rank, 10); // bar
  assert.equal(r.slots[1].rank, 5); // 5 lit pips
  // "Point Blank" is a shotgun mod: kept (it is what the card says) but flagged as not fitting the Braton Prime.
  assert.ok(r.warnings.some(w => /Point Blank.*does not fit Braton Prime/.test(w)));
  assert.deepEqual({ name: r.exilus.name, rank: r.exilus.rank }, { name: 'Stabilizer', rank: 0 });
  assert.equal(r.arcanes[0].name, 'Primary Deadhead');
  assert.ok(!r.slots.some(s => s.name === 'Hornet Strike'), 'inventory under the search box is ignored');
  assert.ok(r.warnings.some(w => /recognised more than once/.test(w)));
});

test('recognizeBuild on an empty or foreign screenshot returns nothing and says why', () => {
  const r = recognizeBuild({ width: 1920, height: 1080, lines: [line('Frame Rate 120fps', 0, 1070, 'full')] }, tiny);
  assert.equal(r.weapon, null);
  assert.ok(r.slots.every(s => s.name === null));
  assert.equal(r.exilus, null);
  assert.ok(r.warnings.some(w => /No equipped mods/.test(w)));
});

// ---------- preprocessing (pure parts of the main-process OCR) ----------

test('image type is sniffed from magic bytes and inputs become Buffers', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'jpeg');
  assert.equal(sniffImageType(Buffer.from('GIF89a..')), null);
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null);
  assert.ok(Buffer.isBuffer(toBuffer(new Uint8Array([1, 2, 3]))));
  assert.ok(Buffer.isBuffer(toBuffer(new Uint8Array([1, 2, 3]).buffer)));
  assert.equal(toBuffer('not bytes'), null);
  assert.equal(MAX_IMAGE_BYTES, 25 * 1024 * 1024);
});

test('passes: small screenshots are upscaled; crops end at the search box; ultrawide is measured from its 16:9 area', () => {
  assert.equal(planFullPass(1280, 720).scale, 2);
  assert.equal(planFullPass(1920, 1080).scale, 1);
  const [slots, ...titles] = planDetailPasses(1920, 1080, [line('SEARCH...', 107, 640, 'full')]);
  assert.equal(slots.region.y + slots.region.height <= 640, true);
  assert.equal(titles.length, 3);
  const [wide] = planDetailPasses(2560, 1080, []);
  assert.equal(wide.region.x, 320 + Math.round(0.2 * 1920));
  assert.deepEqual(mapBox({ text: 'x', x: 100, y: 50, w: 20, h: 10 }, { region: { x: 400, y: 100 }, scale: 2 }), { text: 'x', x: 450, y: 125, w: 10, h: 5 });
});

test('bright-text filter keeps light text dark on white', () => {
  const px = (r, g, b) => [b, g, r, 255];
  const out = brightTextFilter(Buffer.from([...px(240, 240, 240), ...px(40, 40, 60), ...px(250, 220, 150)]));
  assert.equal(out[0], 0);
  assert.equal(out[4], 255);
  assert.equal(out[8], 0);
});

/** A 1920x1080 BGRA canvas with `lit` cyan pips and `grey` grey pips centred under (cx, top). */
function pipCanvas({ cx, top, lit, grey, bar = false }) {
  const W = 1920, H = 1080;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  const total = lit + grey;
  const spacing = 0.0061 * W;
  const y = top + Math.round(0.052 * H);
  const set = (x, yy, [r, g, b]) => {
    const i = (yy * W + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
  };
  if (bar) for (let x = cx - 120; x <= cx + 120; x++) set(x, y, [90, 170, 255]);
  for (let k = 0; k < total; k++) {
    const px = Math.round(cx + (k - (total - 1) / 2) * spacing);
    const color = k < lit ? [140, 220, 255] : [160, 155, 158];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) set(px + dx, y + dy, color);
  }
  return { buf, W, H };
}

test('rank pips: lit pips counted, grey-only rows read as rank 0, the bar flagged', () => {
  const anchor = { x: 960, y: 400 };
  const a = pipCanvas({ cx: 960, top: 400, lit: 7, grey: 3 });
  const pa = measurePips(a.buf, a.W, a.H, anchor);
  assert.equal(pa.lit, 7);
  assert.equal(pa.total, 10);
  assert.equal(pa.bar, false);
  const b = pipCanvas({ cx: 960, top: 400, lit: 0, grey: 3 });
  const pb = measurePips(b.buf, b.W, b.H, anchor);
  assert.equal(pb.lit, 0);
  assert.equal(pb.total, 3);
  const c = pipCanvas({ cx: 960, top: 400, lit: 5, grey: 0, bar: true });
  assert.equal(measurePips(c.buf, c.W, c.H, anchor).bar, true);
  const empty = pipCanvas({ cx: 960, top: 400, lit: 0, grey: 0 });
  assert.equal(measurePips(empty.buf, empty.W, empty.H, anchor), null);
});

test('card anchors: one per card, wrapped names counted once, wide lines skipped', () => {
  const anchors = findCardAnchors(1920, 1080, [
    line('Primed Heated', 900, 300),
    line('Charge', 935, 322),
    line('Serration', 640, 310),
    line('A very long line of stats text that is not a card name at all', 300, 500),
  ]);
  assert.equal(anchors.length, 2);
});

// ---------- recorded screenshots ----------

const fixtures = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter(f => f.endsWith('.json')).sort() : [];

/** Per-fixture accuracy against the true build. Unknown (covered) slots are not scored; rivens count as "left empty". */
function score(result, expected) {
  const s = { weapon: null, mods: 0, modsTotal: 0, ranks: 0, ranksTotal: 0, exilus: null, arcane: null, falseMods: 0 };
  if (expected.weapon !== undefined) s.weapon = expected.weapon == null ? result.weapon == null : result.weapon?.name === expected.weapon;
  (expected.slots ?? Array(8).fill(null)).forEach((want, i) => {
    const got = result.slots[i];
    if (want === 'unknown') return;
    s.modsTotal++;
    if (want === 'riven' || want == null) {
      if (!got.name) s.mods++;
      else s.falseMods++;
      return;
    }
    if (got.name === want.name) {
      s.mods++;
      s.ranksTotal++;
      if (got.rank === want.rank) s.ranks++;
    } else if (got.name) s.falseMods++;
  });
  const ex = expected.exilus;
  s.exilus = ex == null ? result.exilus == null : result.exilus?.name === ex.name && result.exilus?.rank === ex.rank;
  s.arcane = expected.arcane == null ? result.arcanes.length === 0 : result.arcanes[0]?.name === expected.arcane;
  return s;
}

test('recorded screenshots: accuracy per fixture', { skip: haveCore ? false : 'core/ (Underframe data) is not checked out' }, t => {
  assert.ok(fixtures.length >= 5, 'at least five recorded screenshots');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const totals = { mods: 0, modsTotal: 0, ranks: 0, ranksTotal: 0, weapons: 0, weaponsTotal: 0 };
  const rows = [];
  for (const file of fixtures) {
    const fx = JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8'));
    const result = recognizeBuild(fx.ocr, data);
    if (fx.expectNothing) {
      // Translated names, melee or warframe screens must not turn into wrong gun mods.
      assert.ok(result.slots.every(s => s.name === null), `${file}: no mod recognised`);
      assert.equal(result.exilus, null, `${file}: no exilus`);
      rows.push(`${file}: nothing recognised (as intended)`);
      continue;
    }
    const s = score(result, fx.expected);
    totals.mods += s.mods;
    totals.modsTotal += s.modsTotal;
    totals.ranks += s.ranks;
    totals.ranksTotal += s.ranksTotal;
    totals.weaponsTotal++;
    if (s.weapon) totals.weapons++;
    rows.push(`${file}: weapon ${s.weapon ? 'ok' : 'WRONG'}, mods ${s.mods}/${s.modsTotal}, ranks ${s.ranks}/${s.ranksTotal}, exilus ${s.exilus ? 'ok' : 'WRONG'}, arcane ${s.arcane ? 'ok' : 'WRONG'}`);
    assert.equal(s.falseMods, 0, `${file}: a slot shows a mod that is not there`);
  }
  for (const r of rows) t.diagnostic(r);
  t.diagnostic(`total: weapons ${totals.weapons}/${totals.weaponsTotal}, mods ${totals.mods}/${totals.modsTotal}, ranks ${totals.ranks}/${totals.ranksTotal}`);
  assert.ok(totals.mods / totals.modsTotal >= 0.95, 'mod slots at least 95% right');
  assert.ok(totals.ranks / totals.ranksTotal >= 0.95, 'ranks at least 95% right');
  assert.ok(totals.weapons / totals.weaponsTotal >= 0.9, 'weapon at least 90% right');
});

test('recorded screenshots: the English ones each recognise the weapon and every visible mod', { skip: haveCore ? false : 'core/ (Underframe data) is not checked out' }, () => {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  for (const file of fixtures) {
    const fx = JSON.parse(readFileSync(path.join(fixtureDir, file), 'utf8'));
    if (fx.expectNothing) continue;
    const result = recognizeBuild(fx.ocr, data);
    const s = score(result, fx.expected);
    assert.ok(s.weapon, `${file}: weapon`);
    assert.equal(s.mods, s.modsTotal, `${file}: mods`);
  }
});

test('"Read from game window" only takes the game, never a window that merely mentions Warframe', () => {
  assert.ok(isGameWindowTitle('Warframe'));
  assert.ok(isGameWindowTitle(' WARFRAME '));
  for (const t of [
    'Arsenal | WARFRAME Wiki | Fandom - Google Chrome', 'r/Warframe - Reddit - Mozilla Firefox', 'Warframe screenshots - File Explorer',
    '#warframe-builds | Discord', 'Warframe Launcher', 'Underframe Desktop', '', null,
  ]) assert.equal(isGameWindowTitle(t), false, String(t));
  const sources = [{ name: 'r/Warframe - Reddit - Mozilla Firefox' }, { name: 'Warframe', id: 'window:2' }];
  assert.equal(pickGameSource(sources)?.id, 'window:2', 'the browser window listed first is skipped');
  assert.equal(pickGameSource([{ name: 'Warframe screenshots - File Explorer' }]), null);
});
