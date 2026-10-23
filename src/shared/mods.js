// Mod lookup, rank scaling and weapon compatibility over the game-format mod table.

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
