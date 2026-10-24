// Mod effects in words and picker effect categories (src/shared/mods.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_CATEGORIES, modEffectCategories, modEffectSummary, modEffects } from '../src/shared/mods.js';

const stat = (UpgradeType, Value, extra = {}) => ({ UpgradeType, Value: String(Value), DamageType: 'DT_ANY', DisplayAsPercent: '1', ...extra });
const mod = (name, stats, extra = {}) => ({ 'Local Name': name, 'Fusion Limit': 5, Stats: stats, Description: `${name} description`, ...extra });

const serration = mod('Serration', [stat('WEAPON_DAMAGE_AMOUNT', 0.15000001)], { 'Fusion Limit': 10 });
const infectedClip = mod('Infected Clip', [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.15000001, { DamageType: 'DT_POISON' })]);
const bane = mod('Bane of Grineer', [stat('GAMEPLAY_FACTION_DAMAGE', 0.050000001, { DisplayAsPercent: '0', LocTag: '/Lotus/Language/Upgrades/WeaponFactionDamageGrineerDesc' })]);
const counterbalance = mod('Counterbalance', [stat('WEAPON_RECOIL', -0.15000001)]);
const metalAuger = mod('Metal Auger', [stat('WEAPON_PUNCTURE_DEPTH', 0.5, { DisplayAsPercent: '0' })]);
const hammerShot = mod('Hammer Shot', [stat('WEAPON_CRIT_DAMAGE', 0.15), stat('WEAPON_PROC_CHANCE', 0.1)], { 'Fusion Limit': 3 });
const crushingRuin = mod('Sawtooth Clip', [stat('WEAPON_PERCENT_BASE_DAMAGE_ADDED', 0.05, { DamageType: 'DT_SLASH' })]);

test('effects read like the game at the given rank', () => {
  assert.equal(modEffectSummary(serration, 10), '+165% damage');
  assert.equal(modEffectSummary(serration, 0), '+15% damage');
  assert.equal(modEffectSummary(infectedClip, 5), '+90% Toxin damage');
  assert.equal(modEffectSummary(bane, 5), '+30% damage to Grineer');
  assert.equal(modEffectSummary(metalAuger, 5), '+3 punch through');
  assert.deepEqual(modEffects(hammerShot, 3), ['+60% critical damage', '+40% status chance']);
  assert.equal(modEffectSummary(hammerShot, 3), '+60% critical damage, +40% status chance');
});

test('negative effects use a minus sign', () => {
  assert.equal(modEffectSummary(counterbalance, 5), '−90% recoil');
});

test('known percentage stats read as percentages even when the data flag says otherwise', () => {
  const vilePrecision = mod('Vile Precision', [
    stat('WEAPON_RECOIL', -0.15000001),
    stat('WEAPON_FIRE_RATE', -0.059999999, { DisplayAsPercent: '0' }),
  ]);
  assert.equal(modEffectSummary(vilePrecision, 5), '−90% recoil, −36% fire rate');
});

test('mods without numeric stats fall back to their description', () => {
  assert.equal(modEffectSummary(mod('Thunderbolt', [], { Description: 'Arrows explode\r\non impact.' }), 3), 'Arrows explode on impact.');
  assert.equal(modEffectSummary(mod('Nothing', undefined, { Description: undefined }), 0), '');
});

test('effect categories follow the stats, in filter order', () => {
  assert.deepEqual(modEffectCategories(serration), ['Damage']);
  assert.deepEqual(modEffectCategories(infectedClip), ['Elemental']);
  assert.deepEqual(modEffectCategories(crushingRuin), ['Damage']);
  assert.deepEqual(modEffectCategories(bane), ['Faction']);
  assert.deepEqual(modEffectCategories(hammerShot), ['Critical', 'Status']);
  assert.deepEqual(modEffectCategories(counterbalance), ['Utility']);
  assert.deepEqual(modEffectCategories(mod('Empty', [])), ['Utility']);
  assert.deepEqual(modEffectCategories(mod('Split Chamber', [stat('WEAPON_FIRE_ITERATIONS', 0.15)])), ['Multishot']);
  assert.deepEqual(modEffectCategories(mod('Speed Trigger', [stat('WEAPON_FIRE_RATE', 0.1)])), ['Fire rate']);
  for (const m of [serration, infectedClip, bane, hammerShot, counterbalance]) {
    for (const c of modEffectCategories(m)) assert.ok(EFFECT_CATEGORIES.includes(c), c);
  }
});
