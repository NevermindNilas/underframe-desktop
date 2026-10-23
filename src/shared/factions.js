// Enemy factions as the engine names them, plus the scaling family and Bane-mod family of each.

export const FACTIONS = [
  { name: 'Grineer', scaling: 'grineer', bane: 'Grineer' },
  { name: 'Kuva Grineer', scaling: 'grineer', bane: 'Grineer' },
  { name: 'Scaldra', scaling: 'grineer', bane: null },
  { name: 'Corpus', scaling: 'corpus', bane: 'Corpus' },
  { name: 'Corpus Amalgam', scaling: 'corpus', bane: 'Corpus' },
  { name: 'Infested', scaling: 'infested', bane: 'Infested' },
  { name: 'Infested Deimos', scaling: 'infested', bane: 'Infested' },
  { name: 'Techrot', scaling: 'techrot', bane: null },
  { name: 'Orokin', scaling: 'corrupted', bane: 'Corrupted' },
  { name: 'Narmer', scaling: 'corrupted', bane: null },
  { name: 'The Murmur', scaling: 'sentient', bane: 'Murmurs' },
  { name: 'Sentient', scaling: 'sentient', bane: 'Sentients' },
  { name: 'Zariman', scaling: 'sentient', bane: null },
  { name: 'Spectral Thrax', scaling: 'sentient', bane: null },
  { name: 'Anarch', scaling: 'sentient', bane: null },
];

const ALIASES = { orokin: 'Orokin', corrupted: 'Orokin', murmur: 'The Murmur', 'the murmur': 'The Murmur' };

/** Resolve a faction label from game data (any case, aliases like "zariman") to an engine faction entry. */
export function resolveFaction(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  const name = ALIASES[key] ?? FACTIONS.find(f => f.name.toLowerCase() === key)?.name ?? 'Grineer';
  return FACTIONS.find(f => f.name === name);
}

/** Bane family named by a GAMEPLAY_FACTION_DAMAGE stat, e.g. ".../WeaponFactionDamageGrineerDesc" -> "Grineer". */
export function baneFamilyOfStat(stat) {
  const m = String(stat?.LocTag ?? '').match(/WeaponFactionDamage(\w+?)Desc$/);
  if (!m) return null;
  return m[1] === 'Orokin' ? 'Corrupted' : m[1];
}
