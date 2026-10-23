// Damage types as the engine names them, and Warframe's elemental combination rules.

export const DAMAGE_TYPE_BY_DT = {
  DT_IMPACT: 'Impact',
  DT_PUNCTURE: 'Puncture',
  DT_SLASH: 'Slash',
  DT_FIRE: 'Heat',
  DT_FREEZE: 'Cold',
  DT_ELECTRICITY: 'Electricity',
  DT_POISON: 'Toxin',
  DT_EXPLOSION: 'Blast',
  DT_CORROSIVE: 'Corrosive',
  DT_GAS: 'Gas',
  DT_MAGNETIC: 'Magnetic',
  DT_RADIATION: 'Radiation',
  DT_VIRAL: 'Viral',
};

export const PHYSICAL = ['Impact', 'Puncture', 'Slash'];
export const PRIMARY_ELEMENTS = ['Heat', 'Cold', 'Electricity', 'Toxin'];

const COMBINATIONS = {
  'Cold+Heat': 'Blast',
  'Electricity+Toxin': 'Corrosive',
  'Heat+Toxin': 'Gas',
  'Cold+Electricity': 'Magnetic',
  'Electricity+Heat': 'Radiation',
  'Cold+Toxin': 'Viral',
};

export function combinationOf(a, b) {
  return COMBINATIONS[[a, b].sort().join('+')] ?? null;
}

/**
 * Combine elements the way the game does: walk the sources in order (mod slots first, then the
 * weapon's innate elements); each primary element joins an existing entry that already contains it,
 * otherwise pairs with the oldest unpaired primary element, otherwise waits as a standalone entry.
 * Pre-combined elements (e.g. a Radiation mod) never pair.
 *
 * @param {Array<[string, number]>} ordered  [damageType, value] in combination order
 * @returns {Record<string, number>} final elemental damage by type
 */
export function combineElements(ordered) {
  const entries = []; // { type, parts: string[], value }
  for (const [type, value] of ordered) {
    if (!value) continue;
    const holder = entries.find(e => e.parts.includes(type) || e.type === type);
    if (holder) {
      holder.value += value;
      continue;
    }
    if (PRIMARY_ELEMENTS.includes(type)) {
      const partner = entries.find(e => e.parts.length === 1 && PRIMARY_ELEMENTS.includes(e.type));
      if (partner) {
        partner.parts.push(type);
        partner.type = combinationOf(partner.parts[0], type);
        partner.value += value;
        continue;
      }
    }
    entries.push({ type, parts: PRIMARY_ELEMENTS.includes(type) ? [type] : [], value });
  }
  const out = {};
  for (const e of entries) out[e.type] = (out[e.type] ?? 0) + e.value;
  return out;
}
