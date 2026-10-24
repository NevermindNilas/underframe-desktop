// Mod lookup, rank scaling and weapon compatibility over the game-format mod table.
import { DAMAGE_TYPE_BY_DT, PHYSICAL } from './damage.js';
import { baneFamilyOfStat } from './factions.js';

const COMPAT_TAGS = {
  'Primary/Rifle': ['PRIMARY', 'Rifle', 'Rifle (No Aoe)'],
  'Primary/Sniper': ['PRIMARY', 'Rifle', 'Rifle (No Aoe)', 'Sniper'],
  'Primary/Bow': ['PRIMARY', 'Rifle', 'Rifle (No Aoe)', 'Bow'],
  'Primary/Speargun': ['PRIMARY', 'Rifle', 'Rifle (No Aoe)'],
  'Primary/Shotgun': ['PRIMARY', 'Shotgun'],
  'Secondary/Pistol': ['Pistol', 'Pistol (No Aoe)'],
  'Secondary/Dual Pistols': ['Pistol', 'Pistol (No Aoe)'],
  'Secondary/Thrown': ['Pistol', 'Pistol (No Aoe)', 'Thrown'],
  'Secondary/Tome': ['Pistol', 'Tome'],
};

export const SUPPORTED_WEAPON_TYPES = ['Primary', 'Secondary'];

export function isSupportedWeapon(weapon) {
  return Boolean(COMPAT_TAGS[`${weapon?.type}/${weapon?.subtype}`]) && Array.isArray(weapon.fire_modes) && weapon.fire_modes.length > 0;
}

export function maxRank(mod) {
  return Math.max(0, Number(mod?.['Fusion Limit']) || 0);
}

/** Value of one mod stat at a rank: explicit RankValues when present, else Value * (rank + 1). */
export function statValue(stat, rank) {
  const r = Math.max(0, Math.round(Number(rank) || 0));
  if (Array.isArray(stat?.RankValues) && stat.RankValues.length) {
    return Number(stat.RankValues[Math.min(r, stat.RankValues.length - 1)]) || 0;
  }
  return (Number(stat?.Value) || 0) * (r + 1);
}

/** Weapon-specific mods name the weapon family in Compat Name ("Sobek" fits "Kuva Sobek"). */
function namesWeapon(compat, weaponName) {
  return new RegExp(`(^|\\s)${compat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(weaponName);
}

export function isModCompatible(mod, weapon) {
  if (!mod || !weapon || mod.Type !== String(weapon.type).toUpperCase()) return false;
  const compat = mod['Compat Name'] ?? '';
  const tags = COMPAT_TAGS[`${weapon.type}/${weapon.subtype}`] ?? [];
  return tags.includes(compat) || namesWeapon(compat, weapon.name);
}

/** Index the data tables the editor needs. */
export function indexMods(data) {
  const byName = new Map(data.mods.map(m => [m['Local Name'], m]));
  const incompatible = new Map();
  for (const row of data.incompatible_mods ?? []) {
    for (const other of row['Incompatible Mods'] ?? []) {
      if (!incompatible.has(row['Local Name'])) incompatible.set(row['Local Name'], new Set());
      if (!incompatible.has(other)) incompatible.set(other, new Set());
      incompatible.get(row['Local Name']).add(other);
      incompatible.get(other).add(row['Local Name']);
    }
  }
  return { byName, incompatible };
}

/** Name of an equipped mod that blocks `candidate`, or null. Equipping the same mod twice is also blocked. */
export function conflictingMod(candidate, equippedNames, index) {
  const blocked = index.incompatible.get(candidate) ?? new Set();
  return equippedNames.find(n => n && (n === candidate || blocked.has(n))) ?? null;
}

// ---------- mod effects in words (slot cards, picker) ----------

/** Effect filters offered in the mod picker, in display order. */
export const EFFECT_CATEGORIES = ['Damage', 'Critical', 'Status', 'Multishot', 'Elemental', 'Fire rate', 'Faction', 'Utility'];

const STAT_LABELS = {
  WEAPON_DAMAGE_AMOUNT: 'damage',
  WEAPON_FIRE_ITERATIONS: 'multishot',
  WEAPON_CRIT_CHANCE: 'critical chance',
  WEAPON_CRIT_DAMAGE: 'critical damage',
  WEAPON_PROC_CHANCE: 'status chance',
  WEAPON_PROC_TIME: 'status duration',
  WEAPON_PROC_DAMAGE: 'status damage',
  WEAPON_FIRE_RATE: 'fire rate',
  WEAPON_CLIP_MAX: 'magazine capacity',
  WEAPON_RELOAD_SPEED: 'reload speed',
  WEAPON_PUNCTURE_DEPTH: 'punch through',
  WEAPON_DAMAGE_WEAKPOINT: 'weak point damage',
  WEAPON_CRIT_CHANCE_WEAKPOINT: 'weak point critical chance',
  WEAPON_RECOIL: 'recoil',
  WEAPON_RANGE: 'range',
  WEAPON_EXPLOSION_RADIUS: 'blast radius',
  WEAPON_PROJECTILE_SPEED: 'projectile speed',
  WEAPON_HEADSHOT_MULTIPLIER: 'headshot damage',
  WEAPON_AMMO_EFFICIENCY: 'ammo efficiency',
  WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE: 'damage per status type on the target',
  WEAPON_NOCRIT_DAMAGE: 'damage on non-critical hits',
};

/** Stats without a DisplayAsPercent flag that the game still shows as a percentage. */
const PERCENT_WITHOUT_FLAG = new Set([
  'WEAPON_PROC_DAMAGE', 'WEAPON_BODYSHOT_MULTIPLIER', 'WEAPON_CHARGE_RATE', 'WEAPON_PROJECTILE_EXPLOSION_CHANCE',
  'WEAPON_PROJECTILE_LINGERING_AOE_DAMAGE', 'GAMEPLAY_FACTION_DAMAGE',
]);

const ELEMENT_ADDED = new Set(['WEAPON_PERCENT_BASE_DAMAGE_ADDED', 'WEAPON_PERCENT_BASE_DAMAGE_ADDED_POST_COALESCE']);

function statLabel(stat) {
  const type = stat?.UpgradeType;
  if (ELEMENT_ADDED.has(type)) {
    const dt = DAMAGE_TYPE_BY_DT[stat.DamageType];
    return dt ? `${dt} damage` : 'damage';
  }
  if (type === 'GAMEPLAY_FACTION_DAMAGE') {
    const family = baneFamilyOfStat(stat);
    return family ? `damage to ${family}` : 'faction damage';
  }
  return STAT_LABELS[type] ?? String(type ?? 'effect').replace(/^(WEAPON|GAMEPLAY|AVATAR)_/, '').toLowerCase().replace(/_/g, ' ');
}

/** Stats that are flat amounts (metres, seconds, points), whatever their DisplayAsPercent flag says. */
const ABSOLUTE_STATS = new Set(['WEAPON_PUNCTURE_DEPTH', 'WEAPON_PROJECTILE_LINGERING_AOE_DURATION']);

/**
 * Whether a stat reads as a percentage. The data's DisplayAsPercent flag is not reliable on its own
 * (Vile Precision's fire rate penalty is flagged "0" but is a fraction), so known weapon stats are
 * percentages unless they are flat amounts.
 */
function isPercentStat(stat) {
  const type = stat?.UpgradeType;
  if (ABSOLUTE_STATS.has(type)) return false;
  if (stat?.DisplayAsPercent === '1' || stat?.DisplayAsPercent === 1) return true;
  return PERCENT_WITHOUT_FLAG.has(type) || type in STAT_LABELS || ELEMENT_ADDED.has(type);
}

/** "165", "13.3", "0.5": at most one decimal, no trailing zero. */
const trim1 = n => String(Math.round(n * 10) / 10);

/**
 * Each stat of a mod at a rank, in words: ["+165% damage"], ["+60% Toxin damage", "+60% status chance"].
 * Negative values use a minus sign (U+2212).
 */
export function modEffects(mod, rank) {
  const out = [];
  for (const stat of mod?.Stats ?? []) {
    const v = statValue(stat, rank);
    if (!v) continue;
    const magnitude = isPercentStat(stat) ? `${trim1(Math.abs(v) * 100)}%` : trim1(Math.abs(v));
    out.push(`${v > 0 ? '+' : '−'}${magnitude} ${statLabel(stat)}`);
  }
  return out;
}

/**
 * One line describing what a mod does at a rank, for slot cards and picker items.
 * Falls back to the data description (written for max rank) when the mod has no numeric stats.
 */
export function modEffectSummary(mod, rank) {
  const effects = modEffects(mod, rank);
  if (effects.length) return effects.join(', ');
  return String(mod?.Description ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

const CATEGORY_OF_TYPE = {
  WEAPON_DAMAGE_AMOUNT: 'Damage',
  WEAPON_DAMAGE_WEAKPOINT: 'Damage',
  WEAPON_HEADSHOT_MULTIPLIER: 'Damage',
  WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE: 'Damage',
  WEAPON_NOCRIT_DAMAGE: 'Damage',
  WEAPON_CRIT_CHANCE: 'Critical',
  WEAPON_CRIT_DAMAGE: 'Critical',
  WEAPON_CRIT_CHANCE_WEAKPOINT: 'Critical',
  WEAPON_PROC_CHANCE: 'Status',
  WEAPON_PROC_TIME: 'Status',
  WEAPON_PROC_DAMAGE: 'Status',
  WEAPON_FIRE_ITERATIONS: 'Multishot',
  WEAPON_FIRE_RATE: 'Fire rate',
  GAMEPLAY_FACTION_DAMAGE: 'Faction',
};

/**
 * Picker effect filters a mod belongs to (a subset of EFFECT_CATEGORIES, in that order).
 * Physical damage mods count as Damage, elemental ones as Elemental; anything else is Utility.
 */
export function modEffectCategories(mod) {
  const found = new Set();
  for (const stat of mod?.Stats ?? []) {
    const type = stat?.UpgradeType;
    if (ELEMENT_ADDED.has(type)) {
      found.add(PHYSICAL.includes(DAMAGE_TYPE_BY_DT[stat.DamageType]) ? 'Damage' : 'Elemental');
    } else {
      found.add(CATEGORY_OF_TYPE[type] ?? 'Utility');
    }
  }
  if (!found.size) found.add('Utility');
  return EFFECT_CATEGORIES.filter(c => found.has(c));
}
