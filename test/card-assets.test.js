// Card artwork lookup over core/images/index.json: URLs, aliases, missing images, frames and polarity names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IMAGE_BASE, POLARITY_NAMES, RARITY_FRAMES, createCardAssets, loadCardAssets, modRarityFrame, polarityDisplayName,
} from '../src/shared/card-assets.js';

// A small index in the shape core/scripts/images.mjs writes (names only, no images).
const INDEX = {
  schema: 1,
  aliases: { 'Sonic Siphon': 'Sonic Fracture' },
  mods: {
    Serration: { full: 'mods/full/serration.webp', compact: 'mods/compact/serration.webp' },
    'Primed Bane of The Murmur': { full: null, compact: 'mods/compact/primed-bane-of-the-murmur.webp' },
    'Sonic Fracture': { full: 'mods/full/sonic-fracture.webp', compact: 'mods/compact/sonic-fracture.webp' },
    "Hunter's Bonesaw": { full: "mods/full/hunter's bonesaw.webp", compact: null },
    Broken: { full: '../../package.json', compact: '' },
  },
  arcanes: { 'Primary Merciless': 'arcanes/primary-merciless.webp', 'Arcane Avenger': 'arcanes/arcane-avenger.webp' },
  arcaneGroups: { weapon: ['Primary Merciless', 'Secondary Shiver'], warframe: ['Arcane Avenger'] },
  polarities: { Madurai: 'polarities/Madurai.svg', Any: 'polarities/Any.svg', Unairu: 'polarities/Unairu.svg' },
  polarityCodes: { AP_ATTACK: 'Madurai', AP_WARD: 'Unairu', AP_WAVE: 'Unairu', AP_OMNI: 'Any', AP_ANY: 'Any', AP_DEFENSE: 'Vazarin' },
  missing: { modFull: ['Primed Bane of The Murmur'], modCompact: [], arcanes: [], polarities: [] },
};

test('mod cards resolve to served URLs, case-insensitively and through aliases', () => {
  const cards = createCardAssets(INDEX);
  assert.ok(cards.available);
  assert.deepEqual(cards.modCard('Serration'), {
    full: '/core/images/mods/full/serration.webp',
    compact: '/core/images/mods/compact/serration.webp',
  });
  assert.equal(cards.modFullUrl('serration'), '/core/images/mods/full/serration.webp');
  assert.equal(cards.modFullUrl('  SERRATION '), '/core/images/mods/full/serration.webp');
  assert.equal(cards.modCompactUrl('Sonic Siphon'), '/core/images/mods/compact/sonic-fracture.webp');
  // Path segments are URL-encoded.
  assert.equal(cards.modFullUrl("Hunter's Bonesaw"), "/core/images/mods/full/hunter's%20bonesaw.webp");
});

test('missing images are null so the UI can fall back to a text card', () => {
  const cards = createCardAssets(INDEX);
  assert.deepEqual(cards.modCard('Primed Bane of The Murmur'), {
    full: null,
    compact: '/core/images/mods/compact/primed-bane-of-the-murmur.webp',
  });
  assert.deepEqual(cards.modCard('Not A Mod'), { full: null, compact: null });
  assert.equal(cards.modCompactUrl("Hunter's Bonesaw"), null);
  for (const v of [null, undefined, '', 42]) {
    assert.deepEqual(cards.modCard(v), { full: null, compact: null });
    assert.equal(cards.arcaneUrl(v), null);
    assert.equal(cards.polarityUrl(v), null);
  }
  // Paths that would escape the image folder are never turned into URLs.
  assert.deepEqual(cards.modCard('Broken'), { full: null, compact: null });
});

test('arcanes and their groups', () => {
  const cards = createCardAssets(INDEX);
  assert.equal(cards.arcaneUrl('Primary Merciless'), '/core/images/arcanes/primary-merciless.webp');
  assert.equal(cards.arcaneUrl('primary merciless'), '/core/images/arcanes/primary-merciless.webp');
  assert.equal(cards.arcaneUrl('Secondary Shiver'), null);
  // Groups list only arcanes that have an image.
  assert.deepEqual(cards.arcaneNames(), ['Primary Merciless']);
  assert.deepEqual(cards.arcaneNames('warframe'), ['Arcane Avenger']);
  assert.deepEqual(cards.arcaneNames('melee'), []);
});

test('polarity icons by code or icon name', () => {
  const cards = createCardAssets(INDEX);
  assert.equal(cards.polarityUrl('AP_ATTACK'), '/core/images/polarities/Madurai.svg');
  assert.equal(cards.polarityUrl('ap_attack'), '/core/images/polarities/Madurai.svg');
  assert.equal(cards.polarityUrl('AP_WAVE'), '/core/images/polarities/Unairu.svg');
  assert.equal(cards.polarityUrl('AP_OMNI'), '/core/images/polarities/Any.svg');
  assert.equal(cards.polarityUrl('Madurai'), '/core/images/polarities/Madurai.svg');
  assert.equal(cards.polarityUrl('AP_UNIVERSAL'), null);
  assert.equal(cards.polarityUrl('AP_DEFENSE'), null, 'Vazarin icon not in this index');
  assert.equal(cards.polarityUrl('AP_NOPE'), null);
  // Without polarityCodes the built-in code table is used.
  const bare = createCardAssets({ mods: {}, polarities: { Any: 'polarities/Any.svg', Madurai: 'polarities/Madurai.svg' } });
  assert.equal(bare.polarityUrl('AP_ANY'), '/core/images/polarities/Any.svg');
  assert.equal(bare.polarityUrl('AP_ATTACK'), '/core/images/polarities/Madurai.svg');
});

test('a custom base and a missing index', () => {
  const cards = createCardAssets(INDEX, { base: 'app://local/core/images' });
  assert.equal(cards.modFullUrl('Serration'), 'app://local/core/images/mods/full/serration.webp');
  for (const index of [null, undefined, 'nope', {}]) {
    const none = createCardAssets(index);
    assert.equal(none.available, false);
    assert.deepEqual(none.modCard('Serration'), { full: null, compact: null });
    assert.equal(none.arcaneUrl('Primary Merciless'), null);
    assert.deepEqual(none.arcaneNames(), []);
  }
  assert.equal(DEFAULT_IMAGE_BASE, '/core/images/');
});

test('loadCardAssets fetches index.json and degrades to nulls', async () => {
  const seen = [];
  const ok = await loadCardAssets({ fetch: async url => { seen.push(url); return new Response(JSON.stringify(INDEX)); } });
  assert.deepEqual(seen, ['/core/images/index.json']);
  assert.equal(ok.modFullUrl('Serration'), '/core/images/mods/full/serration.webp');
  const notFound = await loadCardAssets({ fetch: async () => new Response('no', { status: 404 }) });
  assert.equal(notFound.available, false);
  const offline = await loadCardAssets({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(offline.modFullUrl('Serration'), null);
  const garbage = await loadCardAssets({ fetch: async () => new Response('not json') });
  assert.equal(garbage.available, false);
});

test('rarity frames', () => {
  const m = (name, Rarity, Type = 'PRIMARY') => ({ 'Local Name': name, Rarity, Type });
  assert.equal(modRarityFrame(m('Split Chamber', 'UNCOMMON')), 'Silver');
  assert.equal(modRarityFrame(m('Serration', 'UNCOMMON')), 'Silver');
  assert.equal(modRarityFrame(m('Point Strike', 'COMMON')), 'Bronze');
  assert.equal(modRarityFrame(m('Vital Sense', 'RARE')), 'Gold');
  assert.equal(modRarityFrame(m('Cannonade', 'Rare', 'SECONDARY')), 'Gold');
  assert.equal(modRarityFrame(m('Primed Cryo Rounds', 'LEGENDARY')), 'Legendary');
  // Primed, Galvanized and Amalgam cards use the Legendary frame even when the data says RARE.
  assert.equal(modRarityFrame(m('Primed Chamber', 'RARE')), 'Legendary');
  assert.equal(modRarityFrame(m('Galvanized Chamber', 'RARE')), 'Legendary');
  assert.equal(modRarityFrame(m('Amalgam Serration', 'RARE')), 'Legendary');
  assert.equal(modRarityFrame(m('Rifle Riven Mod', 'RIVEN', 'RIVEN')), 'Riven');
  assert.equal(modRarityFrame({ name: 'Vexi-critacron', isRiven: true }), 'Riven');
  assert.equal(modRarityFrame({ name: 'Primed Fast Hands' }), 'Legendary');
  assert.equal(modRarityFrame(m('Desert Wind', '', 'STANCE')), 'Bronze');
  assert.equal(modRarityFrame(m('Odd', 'MYTHIC')), 'Bronze');
  assert.equal(modRarityFrame(null), 'Bronze');
  assert.deepEqual(RARITY_FRAMES, ['Bronze', 'Silver', 'Gold', 'Legendary', 'Riven']);
});

test('polarity display names', () => {
  assert.equal(polarityDisplayName('AP_ATTACK'), 'Madurai');
  assert.equal(polarityDisplayName('AP_DEFENSE'), 'Vazarin');
  assert.equal(polarityDisplayName('AP_TACTIC'), 'Naramon');
  assert.equal(polarityDisplayName('AP_POWER'), 'Zenurik');
  assert.equal(polarityDisplayName('AP_WARD'), 'Unairu');
  assert.equal(polarityDisplayName('AP_WAVE'), 'Unairu');
  assert.equal(polarityDisplayName('AP_PRECEPT'), 'Penjaga');
  assert.equal(polarityDisplayName('AP_UMBRA'), 'Umbra');
  assert.equal(polarityDisplayName('AP_OMNI'), 'Omni');
  assert.equal(polarityDisplayName('ap_attack'), 'Madurai');
  assert.equal(polarityDisplayName('AP_UNIVERSAL'), null);
  assert.equal(polarityDisplayName(''), null);
  assert.equal(polarityDisplayName(null), null);
  assert.equal(polarityDisplayName('AP_NEW_THING'), 'New Thing');
  assert.ok(Object.isFrozen(POLARITY_NAMES));
});

// When the private core is checked out, the shipped index must cover every mod the editor can equip.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'core', 'images', 'index.json');
const dataPath = path.join(root, 'core', 'data', 'data.json');
test('shipped index covers the supported weapons\' mods', { skip: !(existsSync(indexPath) && existsSync(dataPath)) && 'core images not present' }, async () => {
  const { isModCompatible, isSupportedWeapon } = await import('../src/shared/mods.js');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const cards = createCardAssets(index);
  const weapons = data.weapons.filter(isSupportedWeapon);
  const missing = new Set([...index.missing.modFull, ...index.missing.modCompact]);
  let checked = 0;
  for (const mod of data.mods) {
    if (mod.Type === 'RIVEN' || !weapons.some(w => isModCompatible(mod, w))) continue;
    const card = cards.modCard(mod['Local Name']);
    assert.ok(card.full || card.compact, mod['Local Name']);
    if (!missing.has(mod['Local Name'])) assert.ok(card.full && card.compact, mod['Local Name']);
    checked++;
  }
  assert.ok(checked > 300, `checked ${checked}`);
  for (const rel of [...Object.values(index.mods).flatMap(m => [m.full, m.compact]), ...Object.values(index.arcanes), ...Object.values(index.polarities)]) {
    if (rel) assert.ok(existsSync(path.join(root, 'core', 'images', ...rel.split('/'))), rel);
  }
  for (const name of ['Primary Merciless', 'Secondary Merciless', 'Primary Deadhead']) assert.ok(cards.arcaneUrl(name), name);
  assert.ok(cards.polarityUrl('AP_ATTACK'));
});
