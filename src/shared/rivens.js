// Riven mods (docs/port-rivens.md): the player's own rivens, in underframe.site's shape. A riven is not a row of
// data.mods: it is a build slot object { isRiven, id, name, family, disposition, rank, stats: [{ name, value, unit }] }
// whose stat values are the rolls before disposition and rank. Pure: no DOM, no store.
//
// A riven acts twice, as on the site: its stats join the modifier buckets (addRivenModifiers, from collectModifiers),
// and its scaled copy goes to the engine in build.mods (rivenForEngine), which reads Damage, Status Damage and the
// weapon's own elements from it for damage over time.
import { weaponFamily } from './mods.js';
import { resolveFaction } from './factions.js';

export const RIVEN_MAX_RANK = 8;
export const RIVEN_DEFAULT_DISPOSITION = 1.2;
export const RIVEN_BASE_DRAIN = 10;
/** What capacity.js needs of a riven: drain 10 + rank, Omni polarity (halved in any polarised slot but Umbra). */
export const RIVEN_CAPACITY_MOD = Object.freeze({ 'Base Drain': RIVEN_BASE_DRAIN, Polarity: 'AP_ANY' });
export const MIN_POSITIVE = 2;
export const MAX_POSITIVE = 3;
export const MAX_NEGATIVE = 1;
/** A roll lands between 90% and 110% of its stat's mid value. */
export const ROLL_LOW = 0.9;
export const ROLL_HIGH = 1.1;
const UNITS = ['%', 'm', 's', ''];
const MAX_TEXT = 200;

/** Mid-roll multiplier of a stat by the riven's positive and negative stat counts: [positive, negative]. */
const STAT_COUNT_MULTIPLIERS = {
  '2_0': [0.99, null],
  '2_1': [1.2375, -0.495],
  '3_0': [0.75, null],
  '3_1': [0.9375, -0.75],
};

/** Traits a riven can only have one of, and only as a positive stat. */
export const SPLICED_STATS = new Set([
  'ViralDamage', 'CorrosiveDamage', 'MagneticDamage', 'RadiationDamage', 'GasDamage', 'BlastDamage',
  'Damage vs.Orokin', 'Damage vs.Techrot', 'Damage vs.Scaldra', 'Status Damage',
  'Weak Point Damage', 'Weak Point Critical Chance', 'Ammo Efficiency',
  'Magazine Reload While Holstered', 'Heavy Attack Damage', 'Heavy Attack Windup Speed',
  'Parry Angle', 'Slam Damage',
]);

const ELEMENT_STATS = {
  HeatDamage: 'Heat', ColdDamage: 'Cold', ElectricityDamage: 'Electricity', ToxinDamage: 'Toxin',
  ViralDamage: 'Viral', CorrosiveDamage: 'Corrosive', MagneticDamage: 'Magnetic', RadiationDamage: 'Radiation', GasDamage: 'Gas', BlastDamage: 'Blast',
};
const PHYSICAL_STATS = { ImpactDamage: 'Impact', PunctureDamage: 'Puncture', SlashDamage: 'Slash' };
/** Stats a negative row may not take: Punch Through and every element (spliced stats are positive-only too). */
const NO_NEGATIVE = new Set(['Punch Through', ...Object.keys(ELEMENT_STATS)]);
/** Spliced stats that fill a bucket of their own. Status Damage is left to the engine (it reads it from build.mods). */
const SPLICED_BUCKETS = { 'Weak Point Damage': 'weakPointDamage', 'Weak Point Critical Chance': 'weakPointCritChance', 'Ammo Efficiency': 'ammoEfficiency' };
/** Guns that take no riven although nothing in their data says so. */
const NO_RIVEN_WEAPONS = new Set(['Garuda Talons', 'Garuda Prime Talons', 'Sirocco', 'Arquebex']);
/** The faction a "Damage vs." stat names, by the engine faction of the target (Narmer, Sentients, ... take none). */
const RIVEN_FACTION = {
  Grineer: 'Grineer', 'Kuva Grineer': 'Grineer', Corpus: 'Corpus', 'Corpus Amalgam': 'Corpus', Infested: 'Infested',
  'Infested Deimos': 'Infested', Orokin: 'Orokin', Techrot: 'Techrot', Scaldra: 'Scaldra',
};

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFactionStat = key => String(key).startsWith('Damage vs.');
const isRecoil = key => String(key).toLowerCase().includes('recoil');

// ---------- weapons ----------

/** The riven stat list a gun uses: 'Shotgun' (primary shotguns), 'Rifle' (other primaries), 'Pistol' (secondaries and kitgun primaries), or null. */
export function rivenTypeOf(weapon) {
  if (!weapon || weapon.is_exalted || weapon.is_pseudo_exalted || weapon.hasRiven === false || weapon.supports_rivens === false) return null;
  if (NO_RIVEN_WEAPONS.has(weapon.name)) return null;
  if (weapon.type === 'Secondary' || (weapon.type === 'Primary' && weapon.is_modular)) return 'Pistol';
  if (weapon.type === 'Primary') return weapon.subtype === 'Shotgun' ? 'Shotgun' : 'Rifle';
  return null;
}

export const canTakeRiven = weapon => rivenTypeOf(weapon) != null;

/** The family a riven names: weaponFamily() plus the site's exceptions ("Dex Furis" -> "Afuris"). */
export function rivenFamily(weaponName) {
  const name = String(weaponName ?? '').trim();
  if (name === 'Dex Furis') return 'Afuris';
  if (name === 'Pangolin' || name === 'Pangolin Prime') return 'Pangolin Sword';
  return weaponFamily(name);
}

export const rivenName = family => `${family} Riven Mod`;
/** "Braton Riven": the short name the slot card and the Picker show. */
export const rivenShortName = riven => `${riven?.family || 'Unknown'} Riven`;
export const isRiven = slot => Boolean(slot && slot.isRiven === true);

/** Whether a riven may sit on a weapon: the weapon takes rivens and the riven is of its family. */
export function rivenFitsWeapon(riven, weapon) {
  return canTakeRiven(weapon) && isRiven(riven) && riven.family === rivenFamily(weapon.name);
}

// ---------- stats ----------

/** "BaseDamage" -> "Damage", "ToxinDamage" -> "Toxin Damage", "Damage vs.Grineer" -> "Damage vs. Grineer". */
export function rivenStatLabel(key) {
  if (key === 'BaseDamage') return 'Damage';
  return String(key ?? '')
    .replace(/vs\./gi, 'vs. ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bChanceon(?=\s*Slide\b)/g, 'Chance on')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unit a stat's value is kept in: '%' (a fraction), 'm' (metres), 's' (seconds) or '' (a count). */
export function rivenStatUnit(key, fallback = '%') {
  if (key === 'Initial Combo') return '';
  if (key === 'Combo Duration') return 's';
  if (['Range', 'Melee Range', 'Punch Through'].includes(key)) return 'm';
  if (key === 'Parry Angle' || isFactionStat(key)) return '%';
  return UNITS.includes(fallback) ? fallback : '%';
}

/** "149.99%" -> { base: 1.4999, unit: '%' }; "2.7m" -> { base: 2.7, unit: 'm' }; "24.5" -> { base: 24.5, unit: '' }. */
function parseBase(text) {
  const m = String(text ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*(%|m|s)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === '%' ? { base: n / 100, unit: '%' } : { base: n, unit: m[2] ?? '' };
}

const catalogueCache = new WeakMap();

/**
 * The stats a weapon's rivens can roll, by label: [{ key, label, unit, base, spliced, negativeAllowed }].
 * Empty for a weapon that takes no riven.
 */
export function rivenStatCatalogue(data, weapon) {
  const type = rivenTypeOf(weapon);
  const table = type ? data?.riven_stats?.[type] : null;
  if (!isObj(table)) return [];
  let byType = data && catalogueCache.get(data);
  if (!byType) {
    byType = new Map();
    if (data) catalogueCache.set(data, byType);
  }
  if (!byType.has(type)) {
    const list = [];
    for (const [key, raw] of Object.entries(table)) {
      const parsed = parseBase(raw);
      if (!key || !parsed) continue;
      const spliced = SPLICED_STATS.has(key);
      list.push({ key, label: rivenStatLabel(key), unit: rivenStatUnit(key, parsed.unit), base: parsed.base, spliced, negativeAllowed: !spliced && !NO_NEGATIVE.has(key) });
    }
    byType.set(type, list.sort((a, b) => a.label.localeCompare(b.label)));
  }
  return byType.get(type);
}

/** A riven's rank: a whole number 0-8, else 8 (as the site reads it). */
export function rivenRank(riven) {
  const r = Number(riven?.rank);
  return Number.isInteger(r) && r >= 0 && r <= RIVEN_MAX_RANK ? r : RIVEN_MAX_RANK;
}

/** A riven's disposition: a finite number above 0, else 1.2 (the site has no per-weapon disposition). */
export function rivenDisposition(riven) {
  const raw = riven?.disposition;
  const d = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
  return Number.isFinite(d) && d > 0 ? d : RIVEN_DEFAULT_DISPOSITION;
}

/** 1 at rank 8, 1/9 at rank 0. */
export const rankMultiplier = rank => (rank + 1) / (RIVEN_MAX_RANK + 1);

/** What a riven's stored values are multiplied by: disposition x (rank + 1) / 9. */
export const rivenScale = riven => rivenDisposition(riven) * rankMultiplier(rivenRank(riven));

/** The value a stat has in game (and in every modifier path): stored x disposition x (rank + 1) / 9. */
export function effectiveValue(stat, riven) {
  const v = Number(stat?.value);
  return Number.isFinite(v) ? v * rivenScale(riven) : 0;
}

/** The stored roll for a value as the game shows it (the inverse of effectiveValue). */
export function toStored(effective, riven) {
  const scale = rivenScale(riven);
  return scale > 0 ? effective / scale : 0;
}

/**
 * The usual range of one stat in effective units: { min, mid, max } (min <= max), or null when the stat counts have no
 * multiplier (1 positive, 4 positives, 2 negatives). `positives` and `negatives` count the riven's stats.
 */
export function statRange(entry, { positive = true, positives, negatives, disposition = RIVEN_DEFAULT_DISPOSITION, rank = RIVEN_MAX_RANK }) {
  const mult = STAT_COUNT_MULTIPLIERS[`${positives}_${negatives}`]?.[positive ? 0 : 1];
  if (mult == null || !Number.isFinite(entry?.base)) return null;
  const mid = entry.base * rivenScale({ disposition, rank }) * mult;
  const a = mid * ROLL_LOW;
  const b = mid * ROLL_HIGH;
  return { min: Math.min(a, b), mid, max: Math.max(a, b) };
}

// ---------- display ----------

/** How a stat is shown: "Damage vs." as a multiplier (x1.51), percent stats x100, recoil negated. */
function displaySpec(key, unit) {
  if (isFactionStat(key)) return { scale: 1, offset: 1, unit: '×' };
  const stored = rivenStatUnit(key, unit);
  return { scale: stored === '%' ? 100 : 1, offset: 0, unit: key === 'Parry Angle' ? '' : stored === 's' ? ' s' : stored === 'm' ? ' m' : stored };
}

/** An effective value as the number the game shows (222.7 for 2.227 Critical Chance, 1.51 for Damage vs. 0.51). */
export function displayNumber(key, unit, effective) {
  const spec = displaySpec(key, unit);
  return (isRecoil(key) ? -effective : effective) * spec.scale + spec.offset;
}

/** The effective value for a number as the game shows it (the inverse of displayNumber). */
export function fromDisplayNumber(key, unit, shown) {
  const spec = displaySpec(key, unit);
  const v = (shown - spec.offset) / spec.scale;
  return isRecoil(key) ? -v : v;
}

/** The unit after a typed value: "%", "m", "s", "×" (Damage vs.) or "". */
export const displayUnit = (key, unit) => displaySpec(key, unit).unit.trim();

/** "+222.7%", "×1.51", "−35.6%" (a positive recoil roll), "+4.0 m". */
export function formatEffective(key, unit, effective, digits = 1) {
  const spec = displaySpec(key, unit);
  const shown = displayNumber(key, unit, effective);
  if (spec.unit === '×') return `×${shown.toFixed(Math.max(2, digits))}`;
  const sign = shown > 0 ? '+' : shown < 0 ? '−' : '';
  return `${sign}${Math.abs(shown).toFixed(digits)}${spec.unit}`;
}

/** One stat line as the slot card shows it: "+222.7% Critical Chance", "×1.51 Damage vs. Grineer". */
export function rivenStatText(stat, riven) {
  return `${formatEffective(stat.name, stat.unit, effectiveValue(stat, riven))} ${rivenStatLabel(stat.name)}`;
}

/** Every stat line of a riven, in its stat order. */
export const rivenLines = riven => (riven?.stats ?? []).map(s => rivenStatText(s, riven));

/** "Cri+, Mul+, Zoo−": a short summary (the first three letters of each label and its sign), as on the site. */
export function rivenSummary(riven) {
  return (riven?.stats ?? []).map(s => `${rivenStatLabel(s.name).slice(0, 3)}${Number(s.value) >= 0 ? '+' : '−'}`).join(', ');
}

// ---------- shape and validation ----------

/**
 * A clean riven, or null when there is nothing usable: strings trimmed and capped, disposition and rank always
 * written (1.2 and 8 when missing or invalid), up to 4 stats with a name and a finite value, units fixed by the stat.
 * Unknown keys are dropped.
 */
export function normalizeRiven(raw) {
  if (!isObj(raw) || raw.isRiven !== true) return null;
  const text = v => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
  const stats = (Array.isArray(raw.stats) ? raw.stats : [])
    .filter(s => isObj(s) && typeof s.name === 'string' && s.name && Number.isFinite(Number(s.value)))
    .slice(0, MAX_POSITIVE + MAX_NEGATIVE)
    .map(s => ({ name: s.name.slice(0, MAX_TEXT), value: Number(s.value), unit: rivenStatUnit(s.name, s.unit) }));
  const family = text(raw.family) || text(raw.name).replace(/ Riven Mod$/, '');
  if (!family) return null;
  return {
    isRiven: true,
    id: text(raw.id),
    name: rivenName(family),
    family,
    disposition: rivenDisposition(raw),
    rank: rivenRank(raw),
    stats,
  };
}

/** Error messages, worded as on underframe.site where it has one. */
export const RIVEN_MESSAGES = Object.freeze({
  disposition: 'Weapon disposition must be a number greater than 0.',
  rank: 'Riven rank must be a whole number from 0 to 8.',
  spliced: 'A Riven can have only one spliced trait, and it must be positive.',
  fewPositive: 'A Riven mod must have at least 2 positive stats.',
  unique: 'Each Riven stat must be unique.',
  manyPositive: 'A riven has at most 3 positive stats.',
  manyNegative: 'A riven has at most 1 negative stat.',
});

/**
 * Check a riven for a weapon with the site's rules: disposition > 0, rank 0-8, 2-3 positive stats and at most one
 * negative, each stat once, at most one spliced stat and only positive, no negative Punch Through or element, and
 * every stat on the weapon's riven list. A stat is positive when its stored value is 0 or more.
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }> }} field: 'disposition', 'rank',
 *   'stats' (the riven as a whole) or 'stat-<i>' (one row)
 */
export function validateRiven(riven, { data = null, weapon = null } = {}) {
  const errors = [];
  const d = riven?.disposition;
  const dn = typeof d === 'number' || (typeof d === 'string' && d.trim()) ? Number(d) : NaN;
  if (!Number.isFinite(dn) || dn <= 0) errors.push({ field: 'disposition', message: RIVEN_MESSAGES.disposition });
  const r = Number(riven?.rank);
  if (!Number.isInteger(r) || r < 0 || r > RIVEN_MAX_RANK) errors.push({ field: 'rank', message: RIVEN_MESSAGES.rank });
  const stats = Array.isArray(riven?.stats) ? riven.stats : [];
  const catalogue = data && weapon ? new Map(rivenStatCatalogue(data, weapon).map(e => [e.key, e])) : null;
  const seen = new Set();
  let unique = true;
  stats.forEach((s, i) => {
    if (seen.has(s?.name)) unique = false;
    seen.add(s?.name);
    const label = rivenStatLabel(s?.name);
    if (catalogue && !catalogue.has(s?.name)) errors.push({ field: `stat-${i}`, message: `${label} is not a riven stat for ${weapon.name}.` });
    else if (!Number.isFinite(Number(s?.value)) || Number(s.value) === 0) errors.push({ field: `stat-${i}`, message: `Enter a value for ${label}.` });
    else if (Number(s.value) < 0 && NO_NEGATIVE.has(s.name)) errors.push({ field: `stat-${i}`, message: `${label} can't be a negative stat.` });
  });
  const positives = stats.filter(s => Number(s?.value) >= 0).length;
  const negatives = stats.length - positives;
  const spliced = stats.filter(s => SPLICED_STATS.has(s?.name));
  if (spliced.length > 1 || spliced.some(s => Number(s.value) < 0)) errors.push({ field: 'stats', message: RIVEN_MESSAGES.spliced });
  if (positives < MIN_POSITIVE) errors.push({ field: 'stats', message: RIVEN_MESSAGES.fewPositive });
  if (positives > MAX_POSITIVE) errors.push({ field: 'stats', message: RIVEN_MESSAGES.manyPositive });
  if (negatives > MAX_NEGATIVE) errors.push({ field: 'stats', message: RIVEN_MESSAGES.manyNegative });
  if (!unique) errors.push({ field: 'stats', message: RIVEN_MESSAGES.unique });
  return { ok: errors.length === 0, errors };
}

/**
 * A riven as a build slot for a weapon: { slot } when it is clean, fits and validates, else { slot: null, dropped }
 * with the reason in the words of the "Removed: ..." warning.
 */
export function rivenSlotFor(raw, weapon, data) {
  const riven = normalizeRiven(raw);
  const label = riven?.name ?? (typeof raw?.name === 'string' && raw.name ? raw.name : 'Riven Mod');
  if (!riven) return { slot: null, dropped: `${label} (unreadable riven)` };
  if (weapon && !rivenFitsWeapon(riven, weapon)) return { slot: null, dropped: `${label} (does not fit ${weapon.name})` };
  if (weapon && !validateRiven(riven, { data, weapon }).ok) return { slot: null, dropped: `${label} (invalid riven)` };
  return { slot: riven };
}

/** The Exilus slot of a build's 9 mod slots (0-7 general). */
const EXILUS = 8;

/**
 * Why a riven can't go in `slot` of a build on `weapon`, or null: the weapon takes no riven, the Exilus slot, or
 * another slot already holds one ("Only one riven per build (slot 3)"). The riven in `slot` itself may be replaced.
 */
export function rivenSlotBlockReason(build, weapon, slot) {
  if (!canTakeRiven(weapon)) return `${weapon?.name ?? 'This weapon'} takes no riven`;
  if (slot === EXILUS) return "Rivens can't go in the Exilus slot";
  const other = (build?.mods ?? []).findIndex((m, i) => i !== slot && isRiven(m));
  return other >= 0 ? `Only one riven per build (slot ${other + 1})` : null;
}

/** A new riven id, "riven_<ms>" as the site makes them (with a suffix so two in one millisecond differ). */
export const newRivenId = (now = Date.now(), random = Math.random) => `riven_${now}_${Math.floor(random() * 1e6).toString(36)}`;

/** Same riven content (stats, disposition and, unless `rank` is false, rank), ignoring the id. */
export function sameRivenContent(a, b, { rank = true } = {}) {
  const key = r => JSON.stringify([r?.family, rivenDisposition(r), rank ? rivenRank(r) : 0, (r?.stats ?? []).map(s => [s.name, Number(s.value)])]);
  return key(a) === key(b);
}

// ---------- the simulation ----------

/**
 * Fold a riven slot into collectModifiers()' buckets, as the site does: stats in reverse order at their effective
 * value; elements join the elemental list at the riven's slot position; "Damage vs." counts only against its own
 * target faction. Status Damage is left out (the engine applies it from build.mods: counting it here too would double
 * it). Zoom, Recoil, Ammo Maximum and Magazine Reload While Holstered change nothing here and are reported in
 * `m.unhandled` ("Braton Riven Mod: Zoom").
 */
export function addRivenModifiers(m, riven, targetFaction) {
  const target = RIVEN_FACTION[resolveFaction(targetFaction)?.name] ?? null;
  const name = riven?.name || 'Riven Mod';
  const stats = Array.isArray(riven?.stats) ? riven.stats : [];
  for (let i = stats.length - 1; i >= 0; i--) {
    const key = String(stats[i]?.name ?? '');
    const v = effectiveValue(stats[i], riven);
    const lower = key.toLowerCase();
    if (ELEMENT_STATS[key]) { m.elements.push([ELEMENT_STATS[key], v]); continue; }
    if (PHYSICAL_STATS[key]) { m.physical[PHYSICAL_STATS[key]] += v; continue; }
    if (SPLICED_BUCKETS[key]) { m[SPLICED_BUCKETS[key]] += v; continue; }
    if (key === 'Status Damage') continue;
    if (isFactionStat(key)) { if (target && key === `Damage vs.${target}`) m.factionDamage += v; continue; }
    if (key === 'Magazine Reload While Holstered' || lower.includes('zoom') || lower.includes('recoil') || lower.includes('ammo maximum')) {
      m.unhandled.push(`${name}: ${rivenStatLabel(key)}`);
      continue;
    }
    if (lower.includes('critical chance')) m.critChance += v;
    else if (lower.includes('critical damage')) m.critDamage += v;
    else if (lower.includes('damage')) m.damage += v;
    else if (lower.includes('multishot')) m.multishot += v;
    else if (lower.includes('fire rate') || lower.includes('attack speed')) m.fireRate += v;
    else if (lower.includes('status chance')) m.statusChance += v;
    else if (lower.includes('status duration')) m.statusDuration += v;
    else if (lower.includes('punch through')) m.punchThrough += v;
    else if (lower.includes('magazine')) m.magazine += v;
    else if (lower.includes('reload')) m.reload += v;
    else if (lower.includes('projectile speed')) m.projectileSpeed += v;
    else m.unhandled.push(`${name}: ${rivenStatLabel(key)}`);
  }
  return m;
}

/** The riven as the engine reads it in build.mods: the same object with every stat at its effective value. */
export function rivenForEngine(riven) {
  return {
    isRiven: true,
    id: riven.id ?? '',
    name: riven.name,
    family: riven.family,
    disposition: rivenDisposition(riven),
    rank: rivenRank(riven),
    stats: (riven.stats ?? []).map(s => ({ name: s.name, value: effectiveValue(s, riven), unit: rivenStatUnit(s.name, s.unit) })),
  };
}

// ---------- the library (rivens.json in userData) ----------

const LIBRARY_VERSION = 1;
const MAX_LIBRARY = 500;

/** A clean library { version: 1, rivens }: valid rivens with unique ids (a riven without one is dropped). */
export function normalizeRivenLibrary(raw) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.rivens) ? raw.rivens : [];
  const ids = new Set();
  const rivens = [];
  for (const r of list.slice(0, MAX_LIBRARY)) {
    const riven = normalizeRiven(r);
    if (!riven || !riven.id || ids.has(riven.id)) continue;
    ids.add(riven.id);
    rivens.push(riven);
  }
  return { version: LIBRARY_VERSION, rivens };
}

/** Add a riven to the library, or replace the one with its id. */
export function upsertLibraryRiven(library, riven) {
  const clean = normalizeRiven(riven);
  const list = normalizeRivenLibrary(library).rivens;
  if (!clean?.id) return { version: LIBRARY_VERSION, rivens: list };
  const i = list.findIndex(r => r.id === clean.id);
  return { version: LIBRARY_VERSION, rivens: i >= 0 ? list.map((r, j) => (j === i ? clean : r)) : [...list, clean] };
}

export function removeLibraryRiven(library, id) {
  return { version: LIBRARY_VERSION, rivens: normalizeRivenLibrary(library).rivens.filter(r => r.id !== id) };
}

/** The library rivens a weapon can take (its family), in library order. */
export function libraryRivensFor(library, weapon) {
  if (!canTakeRiven(weapon)) return [];
  const family = rivenFamily(weapon.name);
  return (library?.rivens ?? []).filter(r => r.family === family);
}
