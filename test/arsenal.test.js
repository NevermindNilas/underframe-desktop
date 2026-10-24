// Arsenal pieces over the real game data (core/): the gallery view, drag-and-drop targets, and the screenshot
// import review (recorded OCR text from test/fixtures/ocr, no images).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const haveCore = existsSync(coreDir + 'data/data.json');
const opts = { skip: haveCore ? false : 'core/ (Underframe data) is not checked out' };

let M;
let ctx;
let G;
let D;
let R;
let recognizeBuild;
const fixture = name => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/ocr/${name}.json`, import.meta.url)), 'utf8'));

async function setup() {
  if (ctx) return;
  M = await import('../src/renderer/model.js');
  G = await import('../src/renderer/gallery-model.js');
  D = await import('../src/renderer/dnd.js');
  R = await import('../src/renderer/ocr-review.js');
  ({ recognizeBuild } = await import('../src/shared/build-recognition.js'));
  ctx = M.createContext(JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8')));
}

const GALLERY = { tab: 'mods', query: '', effects: [], pols: [], rarities: [], fits: true, hideEquipped: false, sort: 'match' };

function view(build, gallery = {}, extra = {}) {
  return G.galleryView({
    ctx, build, gallery: { ...GALLERY, ...gallery }, selectedSlot: null, sweep: null,
    polarities: M.buildCapacity(ctx, build).polarities, partial: () => [], engineOnly: () => false, ...extra,
  });
}

test('gallery: compatible mods, equipped and blocked states, Exilus scope, Fits off', opts, async () => {
  await setup();
  let b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  b = M.setSlot(b, 0, { name: 'Serration', rank: 10 });
  const v = view(b, { query: 'serration' });
  const by = n => v.items.find(i => i.name === n);
  assert.equal(by('Serration').state, 'equipped');
  assert.equal(by('Serration').slot, 0);
  assert.equal(by('Amalgam Serration').state, 'blocked');
  assert.match(by('Amalgam Serration').reason, /Conflicts with Serration/);
  assert.equal(v.items.at(-1).state, 'blocked', 'blocked cards sort last');
  const exilus = view(b, {}, { selectedSlot: M.EXILUS_SLOT });
  assert.equal(exilus.exilusScoped, true);
  assert.ok(exilus.items.every(i => ctx.exilus.has(i.name)), 'only Exilus mods for the Exilus slot');
  const all = view(b, { fits: false, query: 'shotgun' });
  assert.ok(all.items.some(i => i.state === 'blocked' && /Doesn't fit Braton Prime/.test(i.reason)), 'Fits off shows shotgun mods, blocked');
  assert.equal(view(b, { hideEquipped: true, query: 'serration' }).items.some(i => i.name === 'Serration'), false);
});

test('gallery: arcanes tab lists the arcanes that fit the weapon', opts, async () => {
  await setup();
  const b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  const v = view(b, { tab: 'arcanes' });
  const names = v.items.map(i => i.name);
  assert.ok(names.includes('Primary Merciless'));
  assert.ok(!names.some(n => /^Secondary /.test(n)), 'no secondary arcanes on a rifle');
  const lex = view(M.createBuild(ctx, { weaponName: 'Lex Prime' }), { tab: 'arcanes' });
  assert.ok(lex.items.some(i => i.name === 'Secondary Merciless'));
});

test('drag and drop: projected drain by slot polarity, refusals and swaps', opts, async () => {
  await setup();
  let b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  b = M.setSlotPolarity(ctx, b, 0, 'AP_ATTACK');
  b = M.setSlotPolarity(ctx, b, 1, 'AP_TACTIC');
  b = M.setSlot(b, 2, { name: 'Split Chamber', rank: 5 });
  const pol = M.buildCapacity(ctx, b).polarities;
  const drag = { kind: 'mod', name: 'Serration', from: 'gallery' };
  assert.deepEqual([D.dropInfo(ctx, b, drag, 0, pol).drain, D.dropInfo(ctx, b, drag, 0, pol).effect], [7, 'match']);
  assert.deepEqual([D.dropInfo(ctx, b, drag, 1, pol).drain, D.dropInfo(ctx, b, drag, 1, pol).effect], [18, 'mismatch']);
  assert.equal(D.dropInfo(ctx, b, drag, 3, pol).drain, 14);
  assert.match(D.dropInfo(ctx, b, drag, 2, pol).label, /replace Split Chamber/);
  assert.equal(D.dropInfo(ctx, b, drag, M.EXILUS_SLOT, pol).reason, 'Not an Exilus mod');
  assert.equal(D.dropInfo(ctx, b, drag, M.ARCANE_SLOT, pol).accept, false);
  const move = { kind: 'mod', name: 'Split Chamber', from: 2 };
  assert.match(D.dropInfo(ctx, M.setSlot(b, 5, { name: 'Point Strike', rank: 5 }), move, 5, pol).label, /swap with Point Strike/);
  const preview = D.previewSlots(ctx, b, drag, 0);
  assert.equal(preview[0].name, 'Serration');
  assert.equal(M.buildCapacity(ctx, b, preview).used, M.buildCapacity(ctx, b).used + 7);
  const arcane = { kind: 'arcane', name: 'Primary Merciless', from: 'gallery' };
  assert.equal(D.dropInfo(ctx, b, arcane, M.ARCANE_SLOT, pol).accept, true);
  assert.equal(D.dropInfo(ctx, b, arcane, 0, pol).accept, false);
});

test('screenshot review: a recorded Braton Prime screenshot becomes a reviewable build', opts, async () => {
  await setup();
  const fx = fixture('braton-prime-1920x1080');
  const rec = recognizeBuild(fx.ocr, ctx.data);
  const review = R.reviewFromRecognition(ctx, rec);
  assert.equal(review.weaponName, 'Braton Prime');
  assert.equal(review.items.length, 10);
  assert.ok(review.items.filter(i => i.box).length >= 9, 'recognised items carry their region box');
  const parts = R.appliedParts(ctx, review);
  assert.deepEqual(parts.mods.slice(0, 8).map(m => m?.name ?? null), fx.expected.slots.map(s => s?.name ?? null));
  assert.equal(parts.mods[M.EXILUS_SLOT].name, 'Stabilizer');
  assert.equal(parts.arcane.name, fx.expected.arcane);
  assert.match(R.reviewSummary(review), /^Found Braton Prime and 9 mods/);
});

test('screenshot review: low confidence is not applied, later conflicts lose, unfit mods are flagged', opts, async () => {
  await setup();
  const fx = fixture('braton-prime-1920x1080');
  const review = R.reviewFromRecognition(ctx, recognizeBuild(fx.ocr, ctx.data));
  const items = review.items.map(i => ({ ...i }));
  const s1 = items.find(i => i.key === 'slot-1');
  Object.assign(s1, { name: null, keep: false, suggestion: 'High Voltage', band: 'low', confidence: 0.4 });
  const s3 = items.find(i => i.key === 'slot-3');
  Object.assign(s3, { name: 'Serration', keep: true });
  const s4 = items.find(i => i.key === 'slot-4');
  Object.assign(s4, { name: 'Amalgam Serration', keep: true });
  const problems = R.itemProblems(ctx, { ...review, items });
  assert.match(problems.get('slot-4') ?? '', /Conflicts with slot 4/);
  const parts = R.appliedParts(ctx, { ...review, items });
  assert.equal(parts.mods[1], null, 'a low-confidence slot stays empty');
  assert.equal(parts.mods[4], null, 'the later conflicting mod is not applied');
  const shotgun = R.itemProblems(ctx, { ...review, weaponName: 'Hek', items: review.items });
  assert.ok([...shotgun.values()].some(v => /Doesn't fit Hek/.test(v)));
  assert.equal(R.bandOf(0.9), 'high');
  assert.equal(R.bandOf(0.7), 'check');
  assert.equal(R.bandOf(0.5), 'low');
});

test('gallery: drain<=N compares the max-rank drain in the target slot, not the base drain', opts, async () => {
  await setup();
  let b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  const names = v => v.items.map(i => i.name);
  // Serration (base 4) costs 14 at max rank: an unpolarised slot keeps it out of drain<=6.
  assert.equal(names(view(b, { query: 'drain<=6' })).includes('Serration'), false);
  assert.equal(names(view(b, { query: 'drain<=14' })).includes('Serration'), true);
  // A Madurai slot halves it to 7, the fit hint's number.
  b = M.setSlotPolarity(ctx, b, 0, 'AP_ATTACK');
  const sel = view(b, { query: 'drain<=7' }, { selectedSlot: 0 });
  assert.equal(names(sel).includes('Serration'), true);
  // A gain filter without a sweep says how to get one.
  assert.ok(view(b, { query: 'gain>5' }).hints.some(h => /Find best mod/.test(h)));
});

test('kitguns are not offered: their stats need grip and loader parts (fire_modes hold placeholder 1-values)', opts, async () => {
  await setup();
  const kitguns = ctx.data.weapons.filter(w => w.is_modular && ['Primary', 'Secondary'].includes(w.type));
  assert.ok(kitguns.length >= 10);
  for (const w of kitguns) assert.equal(ctx.weaponByName.has(w.name), false, w.name);
  assert.equal(ctx.featured.some(f => /Catchmoon|Gaze|Tombfinger|Rattleguts|Sporelacer|Vermisplicer/.test(f.build?.weaponName ?? f.weaponName ?? '')), false);
  const { build, warnings } = M.normalizeBuild(ctx, { weaponName: 'Catchmoon (Secondary)', mods: [] });
  assert.notEqual(build.weaponName, 'Catchmoon (Secondary)');
  assert.match(warnings[0], /not available/);
});

// The kitgun arcane slot logic stays ready for when grip and loader parts are composed: tested on a context
// that offers Catchmoon.
test('kitguns: a second arcane slot for Pax and Residual arcanes, in the gallery and drag and drop', opts, async () => {
  await setup();
  const realCtx = ctx;
  const catchmoon = realCtx.data.weapons.find(w => w.name === 'Catchmoon (Primary)');
  ctx = { ...realCtx, weapons: [...realCtx.weapons, catchmoon], weaponByName: new Map([...realCtx.weaponByName, [catchmoon.name, catchmoon]]) };
  try {
  const b = M.createBuild(ctx, { weaponName: 'Catchmoon (Primary)' });
  assert.equal(b.arcanes.length, 2);
  const first = view(b, { tab: 'arcanes' }, { selectedSlot: M.ARCANE_SLOT });
  assert.equal(first.targetSlot, M.ARCANE_SLOT);
  assert.ok(!first.items.some(i => /^Pax /.test(i.name)), 'the first slot takes weapon arcanes');
  const second = view(b, { tab: 'arcanes' }, { selectedSlot: M.KITGUN_ARCANE_SLOT });
  assert.equal(second.targetSlot, M.KITGUN_ARCANE_SLOT);
  assert.ok(second.items.length > 0 && second.items.every(i => /^(Pax|Residual) /.test(i.name)));
  const pax = { kind: 'arcane', name: 'Pax Bolt', from: 'gallery' };
  assert.equal(D.dropInfo(ctx, b, pax, M.KITGUN_ARCANE_SLOT, null).accept, true);
  assert.equal(D.dropInfo(ctx, b, pax, M.ARCANE_SLOT, null).accept, false);
  const withPax = M.setArcane(ctx, b, 1, M.newArcane(ctx, 'Pax Bolt'));
  const shown = view(withPax, { tab: 'arcanes' }, { selectedSlot: M.KITGUN_ARCANE_SLOT });
  assert.equal(shown.items.find(i => i.name === 'Pax Bolt').state, 'equipped');
  assert.equal(M.arcaneIndexOf(M.KITGUN_ARCANE_SLOT), 1);
  assert.equal(M.arcaneIndexOf(3), -1);
  } finally {
    ctx = realCtx;
  }
});

test('screenshot review: covered, unread and empty slots are told apart', opts, async () => {
  await setup();
  const strun = R.reviewFromRecognition(ctx, recognizeBuild(fixture('strun-1920x1080').ocr, ctx.data));
  const state = k => strun.items.find(i => i.key === k);
  // Slots 1 and 5 are under a riven tooltip; 4 and 8 are really empty.
  for (const k of ['slot-0', 'slot-4']) {
    assert.equal(state(k).state, 'hidden', k);
    assert.equal(state(k).attention, true, k);
    assert.match(state(k).kindNote, /covered/);
  }
  for (const k of ['slot-3', 'slot-7']) {
    assert.equal(state(k).state, 'empty', k);
    assert.equal(state(k).attention, false, k);
  }
  // The Japanese Kuva Sobek shot: English OCR can't read the arcane's name, so it isn't called empty.
  const sobek = R.reviewFromRecognition(ctx, recognizeBuild(fixture('kuva-sobek-2560x1080').ocr, ctx.data));
  assert.equal(sobek.items.find(i => i.key === 'arcane').state, 'unknown');
  assert.equal(sobek.items.find(i => i.key === 'arcane').attention, true);
  assert.equal(sobek.items.find(i => i.key === 'slot-3').state, 'hidden');
});

test('screenshot review: the arcane socket is empty, unreadable or found, by its place above the exilus', opts, async () => {
  await setup();
  const arcaneState = name => recognizeBuild(fixture(name).ocr, ctx.data).arcaneState;
  // No arcane equipped (the socket shows only an icon): empty, not "not read".
  for (const name of ['strun-1920x1080', 'tiberon-prime-2560x1440', 'epitaph-1920x1080', 'grimoire-1920x1080']) assert.equal(arcaneState(name), 'empty', name);
  // Japanese clients: an arcane is there but its name isn't English.
  for (const name of ['kuva-sobek-2560x1080', 'magnus-prime-2560x1080', 'sporothrix-2560x1080', 'vasto-prime-2560x1080']) assert.equal(arcaneState(name), 'unknown', name);
  for (const name of ['braton-prime-1920x1080', 'torid-2560x1440', 'laetum-3840x2160']) assert.equal(arcaneState(name), 'found', name);
  const strun = R.reviewFromRecognition(ctx, recognizeBuild(fixture('strun-1920x1080').ocr, ctx.data));
  assert.equal(strun.items.find(i => i.key === 'arcane').attention, false, 'an empty socket asks for nothing');
});

test('screenshot review: Apply to current build keeps the build\'s own mods and arcane where nothing reliable was read', opts, async () => {
  await setup();
  // Tiberon Prime: the arcane socket is empty, every slot is read. The open build's arcane is cleared.
  const tib = R.reviewFromRecognition(ctx, recognizeBuild(fixture('tiberon-prime-2560x1440').ocr, ctx.data));
  let current = M.setArcane(ctx, M.createBuild(ctx, { weaponName: 'Tiberon Prime' }), 0, M.newArcane(ctx, 'Primary Merciless'));
  let parts = R.appliedParts(ctx, tib);
  let merged = R.mergeWithCurrent(ctx, tib, parts, current);
  assert.equal(merged.keptArcane, false);
  assert.equal(merged.arcane, null);

  // Kuva Sobek (Japanese): the arcane wasn't readable and slots 4 and 8 are covered: the open build keeps its own.
  const sobek = R.reviewFromRecognition(ctx, recognizeBuild(fixture('kuva-sobek-2560x1080').ocr, ctx.data));
  current = M.setArcane(ctx, M.createBuild(ctx, { weaponName: 'Kuva Sobek' }), 0, M.newArcane(ctx, 'Primary Merciless'));
  current = { ...current, mods: current.mods.map((m, i) => (i === 3 ? { name: 'Blaze', rank: 3 } : i === 7 ? { name: 'Primed Point Blank', rank: 10 } : m)) };
  parts = R.appliedParts(ctx, sobek);
  merged = R.mergeWithCurrent(ctx, sobek, parts, current);
  assert.equal(merged.keptArcane, true);
  assert.equal(merged.arcane.name, 'Primary Merciless');
  assert.deepEqual(merged.keptSlots, [3]);
  assert.equal(merged.mods[3].name, 'Blaze');
  assert.deepEqual(merged.dropped, ['Primed Point Blank'], 'a kept mod the import already has is dropped');
  assert.equal(merged.mods[7], null);
  assert.equal(R.slotListText([3, 8]), 'slot 4 and the Exilus slot');
  assert.equal(R.slotListText([0, 4, 5]), 'slots 1, 5 and 6');

  // A slot the user cleared, and an empty one, clear the open build's mod.
  const cleared = { ...sobek, items: sobek.items.map(i => (i.key === 'slot-3' ? { ...i, cleared: true } : i)) };
  assert.deepEqual(R.mergeWithCurrent(ctx, cleared, R.appliedParts(ctx, cleared), current).keptSlots, []);
  assert.equal(R.keepsCurrent({ state: 'empty' }), false);
  assert.equal(R.keepsCurrent({ state: 'hidden' }), true);
  assert.equal(R.keepsCurrent({ state: 'found', keep: true, name: 'Serration', key: 'slot-0' }), false);
  assert.equal(R.keepsCurrent({ state: 'found', keep: true, name: 'Serration', key: 'slot-0' }, new Map([['slot-0', 'Conflicts']])), true);
});

test('screenshot review: a Replace pick that clashes with another kept item says so', opts, async () => {
  await setup();
  const review = R.reviewFromRecognition(ctx, recognizeBuild(fixture('braton-prime-1920x1080').ocr, ctx.data));
  const slot2 = review.items.find(i => i.key === 'slot-1');
  const amalgam = review.items.find(i => i.name === 'Amalgam Serration');
  const where = amalgam.slot === M.EXILUS_SLOT ? 'the Exilus slot' : `slot ${amalgam.slot + 1}`;
  assert.deepEqual(R.pickConflict(ctx, review, slot2, 'Serration'), { key: amalgam.key, name: 'Amalgam Serration', reason: `Conflicts with Amalgam Serration (${where})` });
  assert.equal(R.pickConflict(ctx, review, slot2, 'Amalgam Serration').reason, `Already in ${where}`);
  assert.equal(R.pickConflict(ctx, review, slot2, 'Hammer Shot'), null);
});

test('screenshot review: an unrecognised weapon falls back to the open one only when everything fits it', opts, async () => {
  await setup();
  const review = R.reviewFromRecognition(ctx, recognizeBuild(fixture('braton-prime-1920x1080').ocr, ctx.data));
  const noWeapon = { ...review, weaponName: null, recognisedWeapon: null };
  assert.deepEqual(R.fallbackWeapon(ctx, noWeapon, 'Braton Prime'), { weaponName: 'Braton Prime', weaponFromCurrent: true });
  assert.deepEqual(R.fallbackWeapon(ctx, noWeapon, 'Lex Prime'), {}, 'rifle mods on a pistol: the player picks');
  assert.deepEqual(R.fallbackWeapon(ctx, noWeapon, 'No such gun'), {});
});

test('screenshot review: imported mods get polarities so a legal build fits its capacity', opts, async () => {
  await setup();
  const review = R.reviewFromRecognition(ctx, recognizeBuild(fixture('braton-prime-1920x1080').ocr, ctx.data));
  const parts = R.appliedParts(ctx, review);
  const plain = M.buildCapacity(ctx, { ...M.createBuild(ctx, { weaponName: 'Braton Prime' }), mods: parts.mods });
  assert.ok(plain.used > plain.capacity, `the screenshot's mods are over capacity unpolarised (${plain.used}/${plain.capacity})`);
  const p = R.inferSlotPolarities(ctx, 'Braton Prime', parts.mods);
  assert.ok(p.assumed > 0);
  assert.equal(p.over, 0);
  const b = { ...M.createBuild(ctx, { weaponName: 'Braton Prime' }), mods: parts.mods, slotPolarities: p.slotPolarities };
  const cap = M.buildCapacity(ctx, b);
  assert.ok(cap.used <= cap.capacity, `${cap.used}/${cap.capacity}`);
  assert.equal(cap.forma, p.assumed);
  // A build that already fits keeps the weapon's own polarities.
  const light = Array(M.SLOT_COUNT).fill(null);
  light[0] = { name: 'Serration', rank: 10 };
  assert.equal(R.inferSlotPolarities(ctx, 'Braton Prime', light).assumed, 0);
});

test('engine errors read as plain words on the result card', opts, async () => {
  await setup();
  assert.match(M.simErrorText('appStateRef not cached; call cache_app_state first.'), /lost this weapon's data/);
  assert.match(M.simErrorText('The engine worker crashed: x'), /stopped unexpectedly/);
  assert.match(M.simErrorText('bad input'), /^The engine reported: bad input/);
});

test('gallery: with Hide equipped on, a search that only matches equipped cards says where they are', opts, async () => {
  await setup();
  let b = M.createBuild(ctx, { weaponName: 'Braton Prime' });
  b = M.setSlot(b, 6, { name: 'Hellfire', rank: 5 });
  const v = view(b, { hideEquipped: true, query: 'hellfire' });
  assert.equal(v.items.length, 0);
  assert.deepEqual(v.hiddenEquipped, [{ name: 'Hellfire', slot: 6 }]);
  assert.deepEqual(view(b, { hideEquipped: false, query: 'hellfire' }).hiddenEquipped, [], 'nothing hidden with Hide equipped off');
  assert.deepEqual(view(b, { hideEquipped: true, query: 'serration' }).hiddenEquipped, [], 'nothing hidden while other cards show');
});
