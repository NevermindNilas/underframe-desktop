// Gallery smart search (src/shared/mod-search.js): parsing, synonyms, operators, fuzzy words, did-you-mean, sorts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  arcaneEntry, buildModIndex, didYouMean, editDistance, parseQuery, removeToken, replaceWord, searchEntries, sortResults, wordQuality,
} from '../src/shared/mod-search.js';

const stat = (UpgradeType, Value, extra = {}) => ({ UpgradeType, Value: String(Value), DisplayAsPercent: '1', ...extra });
const mod = (name, { drain = 4, pol = 'AP_ATTACK', rarity = 'COMMON', rank = 5, stats = [], desc = '', compat = 'Rifle' } = {}) => ({
  'Local Name': name, 'Base Drain': drain, Polarity: pol, Rarity: rarity, 'Fusion Limit': rank, Stats: stats, Description: desc, 'Compat Name': compat, Type: 'PRIMARY',
});

const MODS = [
  mod('Serration', { drain: 4, rarity: 'UNCOMMON', rank: 10, stats: [stat('WEAPON_DAMAGE_AMOUNT', 0.15)], desc: '+165% Damage' }),
  mod('Split Chamber', { drain: 9, rarity: 'RARE', stats: [stat('WEAPON_FIRE_ITERATIONS', 0.15)], desc: '+90% Multishot' }),
  mod('Point Strike', { drain: 4, stats: [stat('WEAPON_CRIT_CHANCE', 0.25)], desc: '+150% Critical Chance' }),
  mod('Vital Sense', { drain: 4, pol: 'AP_TACTIC', rarity: 'RARE', stats: [stat('WEAPON_CRIT_DAMAGE', 0.2)], desc: '+120% Critical Damage' }),
  mod('Cryo Rounds', { drain: 6, stats: [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.15, { DamageType: 'DT_FREEZE' })], desc: '+90% Cold' }),
  mod('Primed Cryo Rounds', { drain: 6, rarity: 'LEGENDARY', rank: 10, stats: [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.15, { DamageType: 'DT_FREEZE' })], desc: '+165% Cold' }),
  mod('Infected Clip', { drain: 6, stats: [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.15, { DamageType: 'DT_POISON' })], desc: '+90% Toxin' }),
  mod('Malignant Force', { drain: 9, pol: 'AP_DEFENSE', rarity: 'RARE', rank: 3, stats: [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.15, { DamageType: 'DT_POISON' }), stat('WEAPON_PROC_CHANCE', 0.15)], desc: '+60% Toxin +60% Status Chance' }),
  mod('Hammer Shot', { drain: 9, rarity: 'UNCOMMON', rank: 3, stats: [stat('WEAPON_CRIT_DAMAGE', 0.15), stat('WEAPON_PROC_CHANCE', 0.1)], desc: '+60% Critical Damage +40% Status Chance' }),
  mod('Vile Precision', { drain: 4, pol: 'AP_TACTIC', rarity: 'RARE', stats: [stat('WEAPON_RECOIL', -0.15)], desc: '-90% Weapon Recoil' }),
  mod('Bane of Grineer', { drain: 4, rarity: 'UNCOMMON', stats: [stat('GAMEPLAY_FACTION_DAMAGE', 0.05, { LocTag: '/Lotus/Language/Mods/WeaponFactionDamageGrineerDesc' })], desc: '+30% Damage to Grineer' }),
  mod('Galvanized Chamber', { drain: 10, pol: 'AP_TACTIC', rarity: 'RARE', rank: 10, stats: [stat('WEAPON_FIRE_ITERATIONS', 0.07)], desc: '+80% Multishot' }),
  mod('Heavy Caliber', { drain: 6, rarity: 'RARE', rank: 10, stats: [stat('WEAPON_DAMAGE_AMOUNT', 0.15), stat('WEAPON_ACCURACY', -0.05)], desc: '+165% Damage, -55% Accuracy' }),
];
const index = buildModIndex(MODS, { exilus: new Set(['Vile Precision']), popular: new Set(['Serration']) });
const names = (q, st) => searchEntries(index, parseQuery(q), st).results.map(r => r.name).sort();

test('edit distance and word quality', () => {
  assert.equal(editDistance('seration', 'serration'), 1);
  assert.equal(editDistance('ab', 'ba'), 1, 'a transposition is one edit');
  assert.equal(wordQuality('serr', 'serration'), 1, 'prefix');
  assert.equal(wordQuality('serat', 'serration'), 0.5, 'near-miss prefix');
  assert.equal(wordQuality('seration', 'serration'), 0.5, 'near miss');
  assert.equal(wordQuality('xyz', 'serration'), 0);
});

test('free text: prefix and fuzzy name matching, every word must match', () => {
  assert.deepEqual(names('serat'), ['Serration']);
  assert.deepEqual(names('cryo'), ['Cryo Rounds', 'Primed Cryo Rounds']);
  assert.deepEqual(names('cryo primed'), ['Primed Cryo Rounds']);
  assert.deepEqual(names('serration chamber'), []);
});

test('synonyms: cc, ms, cd, bane and the element pairs with a hint', () => {
  assert.deepEqual(names('cc'), ['Point Strike']);
  assert.deepEqual(names('ms'), ['Galvanized Chamber', 'Split Chamber']);
  assert.deepEqual(names('cd'), ['Hammer Shot', 'Vital Sense']);
  assert.deepEqual(names('crit chance'), ['Point Strike'], 'multi-word synonym');
  assert.deepEqual(names('bane'), ['Bane of Grineer']);
  assert.deepEqual(names('grineer'), ['Bane of Grineer']);
  const viral = searchEntries(index, parseQuery('viral'));
  assert.deepEqual(viral.results.map(r => r.name).sort(), ['Cryo Rounds', 'Infected Clip', 'Malignant Force', 'Primed Cryo Rounds']);
  assert.match(viral.hints[0], /Viral comes from Cold \+ Toxin/);
  assert.deepEqual(names('dual'), ['Malignant Force']);
});

test('operators filter and become tags: drain, pol, rarity, is, has, negation, phrase', () => {
  // drain compares the max-rank drain printed on the card (base + max rank): Serration 4 + 10 = 14.
  assert.deepEqual(names('drain<=9'), ['Bane of Grineer', 'Point Strike', 'Vile Precision', 'Vital Sense']);
  assert.deepEqual(names('drain:12'), ['Hammer Shot', 'Malignant Force']);
  assert.deepEqual(names('drain:14'), ['Serration', 'Split Chamber']);
  assert.deepEqual(names('drain<=6'), [], 'no mod here is that cheap at max rank');
  assert.deepEqual(names('pol:-'), ['Galvanized Chamber', 'Vile Precision', 'Vital Sense']);
  assert.deepEqual(names('pol:v drain>11'), ['Hammer Shot', 'Heavy Caliber', 'Primed Cryo Rounds', 'Serration', 'Split Chamber']);
  // The gallery passes the slot-adjusted drain (a Madurai slot halves Serration's 14 to 7).
  assert.deepEqual(names('drain<=7', { drainOf: e => (e.name === 'Serration' ? 7 : 14) }), ['Serration']);
  assert.deepEqual(names('r:legendary'), ['Galvanized Chamber', 'Primed Cryo Rounds'], 'Primed and Galvanized count as legendary');
  assert.deepEqual(names('is:exilus'), ['Vile Precision']);
  assert.deepEqual(names('cryo -primed'), ['Cryo Rounds']);
  assert.deepEqual(names('"status chance"'), ['Hammer Shot', 'Malignant Force']);
  assert.deepEqual(names('has:cd'), ['Hammer Shot', 'Vital Sense']);
  assert.deepEqual(names('rank:10'), ['Galvanized Chamber', 'Heavy Caliber', 'Primed Cryo Rounds', 'Serration']);

  const p = parseQuery('cc drain<=10 pol:v r:rare is:exilus -primed ');
  const tags = p.tokens.filter(t => t.kind !== 'term').map(t => t.label);
  assert.deepEqual(tags, ['Drain at max rank ≤ 10', 'Polarity: Madurai', 'Rarity: Rare', 'Exilus mods', 'Not: primed']);
  assert.ok(p.tokens.every(t => t.trailing), 'every token is followed by a space');
  const drain = p.tokens.find(t => t.kind === 'filter');
  assert.equal(removeToken('cc drain<=10 pol:v', drain), 'cc pol:v');
});

test('state filters: equipped, blocked, fits, hide equipped, menus, gain', () => {
  const st = {
    equipped: new Map([['Serration', 0]]),
    blocked: new Map([['Serration', 'Already in slot 1']]),
    fits: new Set(MODS.map(m => m['Local Name']).filter(n => n !== 'Heavy Caliber')),
    gains: new Map([['Split Chamber', 0.4], ['Point Strike', 0.05]]),
  };
  assert.deepEqual(names('is:equipped', st), ['Serration']);
  assert.deepEqual(names('is:blocked', st), ['Serration']);
  assert.equal(names('', { ...st, hideEquipped: true }).includes('Serration'), false);
  assert.equal(names('', { ...st, onlyFits: true }).includes('Heavy Caliber'), false);
  assert.deepEqual(names('', { effects: ['Critical'] }), ['Hammer Shot', 'Point Strike', 'Vital Sense']);
  assert.deepEqual(names('', { pols: ['AP_DEFENSE'] }), ['Malignant Force']);
  assert.deepEqual(names('', { rarities: ['legendary'] }), ['Galvanized Chamber', 'Primed Cryo Rounds']);
  assert.deepEqual(names('gain>10', st), ['Split Chamber']);
});

test('did you mean: a misspelt name, and an unknown operator', () => {
  const p = parseQuery('seration');
  const { results } = searchEntries(index, p);
  assert.deepEqual(results.map(r => r.name), ['Serration'], 'the fuzzy match still shows');
  assert.equal(results[0].fuzzy, true);
  assert.deepEqual(didYouMean(index, p, results), [{ word: 'seration', suggestion: 'Serration' }]);
  assert.equal(replaceWord('cc seration', 'seration', 'Serration'), 'cc Serration');
  assert.deepEqual(didYouMean(index, parseQuery('serration'), searchEntries(index, parseQuery('serration')).results), []);
  const bad = parseQuery('drian<5');
  assert.equal(bad.unknown[0].key, 'drian');
  assert.equal(bad.unknown[0].suggestion, 'drain');
  assert.equal(bad.unknown[0].message, null, 'an unknown filter gets "Unknown filter", not "Use drian:value"');
  assert.equal(parseQuery('pol:q').unknown[0].message, 'Unknown polarity "q"');
  assert.equal(parseQuery('pol<3').unknown[0].message, 'Use pol:value');
});

test('did you mean: three edits for long words, and no description near misses', () => {
  const extra = buildModIndex([
    ...MODS,
    mod('Continuous Misery', { rank: 3, stats: [stat('WEAPON_PROC_TIME', 0.33)], desc: '+100% Status Duration' }),
    mod('Hunter Track', { stats: [stat('WEAPON_PROC_TIME', 0.05)], desc: '+30% Status Duration' }),
  ]);
  const find = q => searchEntries(extra, parseQuery(q)).results.map(r => r.name);
  // "seration" is two edits from "duration": that must not find the status duration mods.
  assert.deepEqual(find('seration'), ['Serration']);
  const p = parseQuery('serating');
  const { results } = searchEntries(extra, p);
  assert.deepEqual(results, []);
  assert.deepEqual(didYouMean(extra, p, results), [{ word: 'serating', suggestion: 'Serration' }]);
});

test('synonyms also find mods whose effect text names the stat (Argon Scope, Bladed Rounds)', () => {
  const extra = buildModIndex([
    ...MODS,
    mod('Argon Scope', { drain: 2, rarity: 'RARE', desc: 'On Headshot:\n+135% Critical Chance when Aiming for 9s' }),
    mod('Bladed Rounds', { drain: 4, pol: 'AP_TACTIC', rarity: 'RARE', desc: 'On Kill:\n+120% Critical Damage when Aiming for 9s' }),
    mod('Primary Acuity', { drain: 6, rarity: 'RARE', rank: 10, stats: [stat('WEAPON_DAMAGE_WEAKPOINT', 0.35), stat('WEAPON_CRIT_CHANCE_WEAKPOINT', 0.35)], desc: '+350% Weak Point Damage' }),
  ]);
  const find = q => searchEntries(extra, parseQuery(q)).results.map(r => r.name).sort();
  assert.deepEqual(find('cc'), ['Argon Scope', 'Point Strike', 'Primary Acuity']);
  assert.deepEqual(find('cd'), ['Bladed Rounds', 'Hammer Shot', 'Vital Sense']);
  assert.deepEqual(find('crit dmg'), ['Bladed Rounds', 'Hammer Shot', 'Vital Sense']);
  assert.deepEqual(find('crit'), ['Argon Scope', 'Bladed Rounds', 'Hammer Shot', 'Point Strike', 'Primary Acuity', 'Vital Sense']);
  assert.deepEqual(find('headshot'), ['Argon Scope', 'Primary Acuity']);
  assert.deepEqual(find('hs'), ['Argon Scope', 'Primary Acuity']);
  assert.deepEqual(find('has:cc'), ['Argon Scope', 'Point Strike', 'Primary Acuity']);
  // A stat hit ranks above an effect-text hit.
  const ranked = sortResults(searchEntries(extra, parseQuery('cc')).results, 'match').map(r => r.name);
  assert.ok(ranked.indexOf('Point Strike') < ranked.indexOf('Argon Scope'));
  assert.deepEqual(find('cc drain<=10'), ['Argon Scope', 'Point Strike']);
});

test('ranking: name hits beat effect hits, exact prefix and common picks add, blocked sorts last', () => {
  const { results } = searchEntries(index, parseQuery('damage'));
  const sorted = sortResults(results, 'match');
  assert.equal(sorted[0].name, 'Serration', 'common pick plus synonym hit');
  const blocked = new Map([['Serration', 'Already in slot 1']]);
  assert.equal(sortResults(results, 'match', { blocked }).at(-1).name, 'Serration');
  const all = searchEntries(index, parseQuery('')).results;
  assert.equal(sortResults(all, 'name')[0].name, 'Bane of Grineer');
  assert.equal(sortResults(all, 'rarity')[0].entry.rarity, 'legendary');
  assert.equal(sortResults(all, 'drain')[0].entry.maxDrain, 9);
  const byDrain = sortResults(all, 'drain', { drainOf: n => (n === 'Split Chamber' ? 1 : 20) });
  assert.equal(byDrain[0].name, 'Split Chamber', 'slot-adjusted drain decides');
  const gains = new Map([['Point Strike', 0.3], ['Split Chamber', 0.4]]);
  assert.deepEqual(sortResults(all, 'gain', { gains }).slice(0, 2).map(r => r.name), ['Split Chamber', 'Point Strike']);
});

test('arcanes search by name, trigger and effect words', () => {
  const arcanes = [
    { name: 'Primary Merciless', summary: '+360% Damage (12 stacks), +30% Reload Speed', description: 'On Kill: +30% Damage', controls: { trigger: 'On Kill' }, support: 'full', maxRank: 5 },
    { name: 'Primary Deadhead', summary: '+30% Headshot Multiplier', description: 'On Headshot Kill', controls: { trigger: 'On Headshot Kill' }, support: 'full', maxRank: 5 },
    { name: 'Primary Frostbite', summary: '+300% Critical Chance', description: 'On Cold Status', controls: { trigger: 'On Cold Status Effect' }, support: 'full', maxRank: 5 },
  ].map(arcaneEntry);
  const find = q => searchEntries(arcanes, parseQuery(q)).results.map(r => r.name).sort();
  assert.deepEqual(find('merc'), ['Primary Merciless']);
  assert.deepEqual(find('kill'), ['Primary Deadhead', 'Primary Merciless']);
  assert.deepEqual(find('headshot'), ['Primary Deadhead']);
  assert.deepEqual(find('cc'), ['Primary Frostbite']);
  assert.deepEqual(find('reload'), ['Primary Merciless']);
});

test('operator values that are Object.prototype keys are unknown values, not crashes', () => {
  for (const q of ['r:constructor', 'rarity:__proto__', 'pol:constructor', 'polarity:toString', 'is:__proto__', 'is:constructor', 'has:constructor']) {
    const p = parseQuery(q);
    assert.equal(p.tokens[0].kind, 'unknown', q);
    assert.equal(p.filters.pol.length + p.filters.rarity.length + p.filters.is.length + p.filters.has.length, 0, q);
    assert.ok(p.unknown[0].message, q);
    assert.equal(searchEntries(index, p).results.length, MODS.length, `${q} filters nothing`);
  }
});

test('did you mean: display words follow hyphens and apostrophes, and the suggestion finds something', () => {
  const extra = buildModIndex([
    ...MODS,
    mod('Double-Barrel Drift', { compat: 'Shotgun' }),
    mod("Hell's Chamber", { compat: 'Shotgun' }),
    mod('Semi-Pistol Cannonade', { compat: 'Pistol' }),
    mod('Barrel Diffusion', { compat: 'Pistol' }),
  ]);
  const dym = (q, st = {}) => {
    const p = parseQuery(q);
    return didYouMean(extra, p, searchEntries(extra, p, st).results, st);
  };
  assert.deepEqual(dym('barell'), [{ word: 'barell', suggestion: 'Barrel' }]);
  assert.deepEqual(dym('hell chambr'), [{ word: 'chambr', suggestion: 'Chamber' }]);
  assert.deepEqual(dym('drfit'), [{ word: 'drfit', suggestion: 'Drift' }]);
  // With Fits on, mods that don't fit the weapon neither suggest nor count.
  const fits = new Set(MODS.map(m => m['Local Name']));
  assert.deepEqual(dym('barell', { fits, onlyFits: true }), []);
  assert.deepEqual(dym('cannonad', { fits, onlyFits: true }), []);
});

test('effect text: a stat the mod takes away is not a match; Slash procs count as slash', () => {
  const extra = buildModIndex([
    ...MODS,
    mod('Primary Acuity', { stats: [stat('WEAPON_DAMAGE_WEAKPOINT', 0.35)], desc: '+350% Weak Point Damage\n+350% Weak Point Critical Chance.\nMultishot cannot be modified.' }),
    mod('Creeping Bullseye', { stats: [stat('WEAPON_CRIT_CHANCE', 0.33)], desc: '+200% Critical Chance -20% Fire Rate' }),
    mod('Internal Bleeding', { desc: 'Impact Status Effects have 35% chance to apply a  Slash Status Effect' }),
    mod('Hunter Munitions', { desc: '+30% chance to apply  on Critical' }),
    mod('Fanged Fusillade', { stats: [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.2, { DamageType: 'DT_SLASH' })], desc: '+120% Slash' }),
    mod('Fast Hands', { stats: [stat('WEAPON_RELOAD_SPEED', 0.05)], desc: '+30% Reload Speed' }),
    mod('Counterbalance', { desc: '-60% Weapon Recoil' }),
  ]);
  const find = q => searchEntries(extra, parseQuery(q)).results.map(r => r.name).sort();
  assert.deepEqual(find('multishot'), ['Galvanized Chamber', 'Split Chamber']);
  assert.deepEqual(find('"fire rate"'), ['Creeping Bullseye'], 'a quoted phrase still finds the text');
  assert.deepEqual(find('slash'), ['Fanged Fusillade', 'Hunter Munitions', 'Internal Bleeding']);
  assert.deepEqual(find('fast'), ['Fast Hands'], '"fast" is not a near-miss prefix of "faction"');
  assert.ok(find('recoil').includes('Counterbalance'), 'less recoil is what a recoil mod gives');
});

const coreData = new URL('../core/data/data.json', import.meta.url);
test('did you mean against the real mod list on Braton Prime', { skip: existsSync(coreData) ? false : 'core/ is not checked out' }, async () => {
  const { isModCompatible } = await import('../src/shared/mods.js');
  const data = JSON.parse(readFileSync(coreData, 'utf8'));
  const weapon = data.weapons.find(w => w.name === 'Braton Prime');
  const real = buildModIndex(data.mods.filter(m => m.Type === 'PRIMARY' && m['Local Name']));
  const st = { fits: new Set(real.filter(e => isModCompatible(e.mod, weapon)).map(e => e.name)), onlyFits: true };
  const dym = q => {
    const p = parseQuery(q);
    return didYouMean(real, p, searchEntries(real, p, st).results, st).map(d => `${d.word}->${d.suggestion}`);
  };
  assert.deepEqual(dym('serating'), ['serating->Serration']);
  assert.deepEqual(dym('pointstrike'), ['pointstrike->Point Strike']);
  assert.deepEqual(dym('infected clp'), ['clp->Clip']);
  assert.deepEqual(dym('barel'), [], 'no shotgun-only "Double-Barrel Drift" word, and never "Drift"');
  const find = q => searchEntries(real, parseQuery(q), st).results.map(r => r.name);
  assert.equal(find('multishot').includes('Primary Acuity'), false);
  assert.ok(!find('fast').some(n => n.startsWith('Bane')));
  assert.ok(['Internal Bleeding', 'Hunter Munitions'].every(n => find('slash').includes(n)));
});
