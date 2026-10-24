// Mod capacity: slot-adjusted drain, the weapon's capacity, innate slot polarities and the Forma count.
// Pure. The rules follow the Warframe Wiki "Mod Capacity" page (see docs/arsenal-spec.md 4.2):
// - a mod drains its base drain plus its rank;
// - a matching slot polarity halves it, rounded up (Serration at rank 10: 14 -> 7);
// - a mismatched one adds a quarter, rounded (14 -> 18);
// - an Omni slot (or an Omni mod) matches everything except Umbra;
// - an unpolarised slot, or a mod without polarity, changes nothing.

/** Polarity codes a slot can be given with Forma, in menu order. AP_UNIVERSAL is "no polarity". */
export const SLOT_POLARITIES = Object.freeze(['AP_UNIVERSAL', 'AP_ATTACK', 'AP_DEFENSE', 'AP_TACTIC', 'AP_POWER', 'AP_WARD', 'AP_PRECEPT', 'AP_UMBRA', 'AP_ANY']);

/** Weapon slot order of data.polarities: general slot i (0-7) reads index ORDER[i]; the Exilus slot index 8. */
const GENERAL_SLOT_INDEX = [7, 6, 5, 4, 3, 2, 1, 0];
const EXILUS_INDEX = 8;

export const BASE_CAPACITY = 30;
export const PROGENITOR_BONUS_PER_FORMA = 2;
export const PROGENITOR_MAX_FORMA = 5;

/** One spelling per polarity: null for none; AP_WAVE -> AP_WARD, AP_OMNI -> AP_ANY, AP_UMBRAL -> AP_UMBRA. */
export function normalizePolarity(code) {
  if (code == null || code === '') return null;
  const k = String(code).toUpperCase();
  if (k === 'AP_UNIVERSAL' || k === 'NONE') return null;
  if (k === 'AP_WAVE') return 'AP_WARD';
  if (k === 'AP_OMNI') return 'AP_ANY';
  if (k === 'AP_UMBRAL') return 'AP_UMBRA';
  return k;
}

/**
 * Drain of a mod at a rank in a slot.
 * @returns {{ drain: number, base: number, effect: 'match'|'mismatch'|'neutral' }}
 */
export function slotDrain(mod, rank, slotPolarity) {
  const baseDrain = Number(mod?.['Base Drain']) || 0;
  const r = Math.max(0, Math.round(Number(rank) || 0));
  const base = baseDrain + (baseDrain < 0 ? -r : r);
  const slot = normalizePolarity(slotPolarity);
  const own = normalizePolarity(mod?.Polarity);
  let effect = 'neutral';
  if (slot && own) {
    if (slot === 'AP_ANY' || own === 'AP_ANY') effect = slot === 'AP_UMBRA' || own === 'AP_UMBRA' ? 'neutral' : 'match';
    else effect = slot === own ? 'match' : 'mismatch';
  }
  let drain = base;
  if (effect === 'match') drain = base < 0 ? base * 2 : Math.ceil(base / 2);
  else if (effect === 'mismatch') drain = base < 0 ? base + Math.round(-base / 4) : base + Math.round(base / 4);
  return { drain, base, effect };
}

/** Capacity of a rank 30 weapon: 60 with an Orokin Catalyst, else 30; Kuva, Tenet and Coda weapons gain 2 per Forma (up to 5), doubled by the Catalyst. */
export function capacityOf({ catalyst = true, progenitor = false, forma = 0 } = {}) {
  const factor = catalyst ? 2 : 1;
  const bonus = progenitor ? Math.min(Math.max(0, forma), PROGENITOR_MAX_FORMA) * PROGENITOR_BONUS_PER_FORMA * factor : 0;
  return BASE_CAPACITY * factor + bonus;
}

const lookupKey = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const polarityIndexCache = new WeakMap();

function weaponPolarityIndex(data) {
  if (data && polarityIndexCache.has(data)) return polarityIndexCache.get(data);
  const exact = new Map();
  const loose = new Map();
  for (const entry of data?.polarities ?? []) {
    if (entry?.type !== 'Weapon' || typeof entry.name !== 'string' || !Array.isArray(entry.polarities)) continue;
    exact.set(entry.name, entry.polarities);
    if (!loose.has(lookupKey(entry.name))) loose.set(lookupKey(entry.name), entry.polarities);
  }
  const index = { exact, loose };
  if (data) polarityIndexCache.set(data, index);
  return index;
}

/**
 * Innate polarities of a gun's 9 slots (0-7 general, 8 Exilus), as normalised codes or null.
 * Unknown weapons have none.
 */
export function innateSlotPolarities(data, weapon) {
  const { exact, loose } = weaponPolarityIndex(data);
  const list = exact.get(weapon?.name) ?? loose.get(lookupKey(weapon?.name)) ?? [];
  const at = i => normalizePolarity(list[i]);
  return [...GENERAL_SLOT_INDEX.map(at), at(EXILUS_INDEX)];
}

/**
 * Each slot's polarity after Forma: `overrides[i]` (a code; 'AP_UNIVERSAL' clears the slot) or the innate one when null.
 */
export function effectiveSlotPolarities(innate, overrides) {
  return innate.map((p, i) => {
    const o = overrides?.[i];
    return o == null ? p : normalizePolarity(o);
  });
}

/** Slots whose polarity differs from the innate one: the Forma a build needs. */
export function formaCount(innate, overrides) {
  const now = effectiveSlotPolarities(innate, overrides);
  return now.reduce((n, p, i) => n + (p !== innate[i] ? 1 : 0), 0);
}

/**
 * Capacity use of a build's mod slots.
 * @param {Array<{name, rank}|null>} slots 9 mod slots
 * @param {(string|null)[]} polarities effective slot polarities (9)
 * @param {(name: string) => object} modByName
 * @returns {{ used: number, perSlot: Array<{drain, base, effect}|null> }}
 */
export function capacityUse(slots, polarities, modByName) {
  const perSlot = (slots ?? []).map((s, i) => {
    if (!s) return null;
    const mod = modByName(s.name);
    return mod ? slotDrain(mod, s.rank, polarities?.[i]) : null;
  });
  return { used: perSlot.reduce((n, d) => n + (d?.drain ?? 0), 0), perSlot };
}
