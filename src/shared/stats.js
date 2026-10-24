// Modded weapon stats per fire mode, in the shape the Underframe engine consumes as `weaponStats`.
import { DAMAGE_TYPE_BY_DT, PHYSICAL, combineElements } from './damage.js';
import { resolveFaction, baneFamilyOfStat } from './factions.js';
import { statValue } from './mods.js';
import { arcaneModifiersFor } from './arcanes.js';
import { externalModifiers } from './external-buffs.js';

const STATUS_DURATION_BASE_SECONDS = 6;
/** underframe.site caps combined ammo efficiency at 75%; only Infinite Ammo makes shots free. */
export const AMMO_EFFICIENCY_CAP = 0.75;
/** Late elements (innate and External Combining Element) combine in this order, after the mods' elements. */
const LATE_ELEMENT_ORDER = ['Heat', 'Cold', 'Electricity', 'Toxin'];
/**
 * The game stores damage per type in steps of 1/32 of the mode's base damage, and the base crit multiplier in steps of
 * 32/4095; underframe.site quantizes both the same way, before the damage multiplier applies.
 */
export const DAMAGE_QUANTIZATION_DIVISOR = 32;
const CRIT_MULTIPLIER_STEPS = 4095 / 32;
/** Mod descriptions that lock a stat at the weapon's base value (Semi-Cannonade mods; Primary and Pistol Acuity). */
const FIRE_RATE_LOCK = 'Fire Rate cannot be modified';
const MULTISHOT_LOCK = 'Multishot cannot be modified';

const snap = v => {
  const r = Math.round(v * 1e8) / 1e8;
  return Math.abs(r) < 1e-10 ? 0 : r;
};

/**
 * Damage per type rounded to steps of base / 32 (a type that rounds to nothing is dropped), as the game and
 * underframe.site do. `base` is the mode's total base damage; without one, the types' own total sets the step.
 */
export function quantizeDamageTypes(types, base = null) {
  const entries = Object.entries(types ?? {}).filter(([, v]) => typeof v === 'number' && v > 0);
  if (!entries.length) return {};
  const total = Number.isFinite(base) && base > 0 ? base : entries.reduce((a, [, v]) => a + v, 0);
  const step = total / DAMAGE_QUANTIZATION_DIVISOR;
  if (!(step > 0)) return Object.fromEntries(entries);
  const out = {};
  for (const [type, v] of entries) {
    const q = snap(Math.round(v / step) * step);
    if (q > 0) out[type] = q;
  }
  return out;
}

/** The base crit multiplier rounded to the game's steps of 32/4095 (2 -> 2.0004884). */
export function quantizeCritMultiplier(value) {
  if (!Number.isFinite(value)) return value;
  return snap(Math.round(value * CRIT_MULTIPLIER_STEPS) / CRIT_MULTIPLIER_STEPS);
}

/** Sum every equipped mod's stats into additive buckets. Elemental sources keep their slot order. */
export function collectModifiers(modSlots, modsByName, targetFaction) {
  const m = {
    damage: 0, multishot: 0, critChance: 0, critDamage: 0, statusChance: 0, statusDuration: 0,
    fireRate: 0, magazine: 0, reload: 0, factionDamage: 0, statusDamage: 0, punchThrough: 0,
    weakPointDamage: 0, weakPointCritChance: 0, ammoEfficiency: 0, physical: { Impact: 0, Puncture: 0, Slash: 0 },
    elements: [], unhandled: [],
    // Set by a mod that locks the stat (Semi-Cannonade: fire rate; Acuity: multishot). The lock holds against every
    // source, external buffs and arcanes included, as on underframe.site.
    fireRateLocked: false, multishotLocked: false,
  };
  const bane = resolveFaction(targetFaction)?.bane;

  for (const slot of modSlots) {
    const mod = slot && modsByName.get(slot.name);
    if (!mod) continue;
    const description = String(mod.Description ?? '');
    if (description.includes(FIRE_RATE_LOCK)) m.fireRateLocked = true;
    if (description.includes(MULTISHOT_LOCK)) m.multishotLocked = true;
    for (const stat of mod.Stats ?? []) {
      const v = statValue(stat, slot.rank);
      switch (stat.UpgradeType) {
        case 'WEAPON_DAMAGE_AMOUNT': m.damage += v; break;
        case 'WEAPON_FIRE_ITERATIONS': m.multishot += v; break;
        case 'WEAPON_CRIT_CHANCE': m.critChance += v; break;
        case 'WEAPON_CRIT_DAMAGE': m.critDamage += v; break;
        case 'WEAPON_PROC_CHANCE': m.statusChance += v; break;
        case 'WEAPON_PROC_TIME': m.statusDuration += v; break;
        case 'WEAPON_PROC_DAMAGE': m.statusDamage += v; break;
        case 'WEAPON_FIRE_RATE': m.fireRate += v; break;
        case 'WEAPON_CLIP_MAX': m.magazine += v; break;
        case 'WEAPON_RELOAD_SPEED': m.reload += v; break;
        case 'WEAPON_PUNCTURE_DEPTH': m.punchThrough += v; break;
        case 'WEAPON_DAMAGE_WEAKPOINT': m.weakPointDamage += v; break;
        case 'WEAPON_CRIT_CHANCE_WEAKPOINT': m.weakPointCritChance += v; break;
        case 'GAMEPLAY_FACTION_DAMAGE':
          if (bane && baneFamilyOfStat(stat) === bane) m.factionDamage += v;
          break;
        case 'WEAPON_PERCENT_BASE_DAMAGE_ADDED': {
          const type = DAMAGE_TYPE_BY_DT[stat.DamageType];
          if (PHYSICAL.includes(type)) m.physical[type] += v;
          else if (type) m.elements.push([type, v]);
          break;
        }
        default:
          m.unhandled.push(`${slot.name}: ${stat.UpgradeType}`);
      }
    }
  }
  return m;
}

/** Shots per second before mods. Charge-only modes (fire_rate "Infinity", e.g. Lanka) fire once per charge. */
export function baseFireRate(mode) {
  const rate = Number(mode.fire_rate);
  if (Number.isFinite(rate) && rate > 0) return rate;
  const charge = Number(mode.charge_time);
  return Number.isFinite(charge) && charge > 0 ? 1 / charge : 1;
}

/** Bows get double benefit from fire rate mods on their shot modes. */
function fireRateModScale(mode, weapon) {
  return weapon?.subtype === 'Bow' && String(mode.mode_name).includes('Shot') ? 2 : 1;
}

/**
 * Ammo each shot uses, as underframe.site computes it: additive efficiency, then each multiplicative source
 * (Energized Munitions) cuts what remains; the total is capped at 75%, and Infinite Ammo makes shots free.
 */
export function ammoConsumptionOf(ammoCost, additive = 0, multipliers = [], infinite = false) {
  if (infinite) return 0;
  let combined = Number.isFinite(additive) ? additive : 0;
  let remaining = Math.max(0, 1 - Math.min(Math.max(combined, 0), 1));
  for (const raw of multipliers ?? []) {
    const v = Math.min(Math.max(Number(raw) || 0, 0), 1);
    if (remaining <= 0 || v <= 0) continue;
    combined += remaining * v;
    remaining = Math.max(0, remaining - remaining * v);
  }
  return (ammoCost ?? 1) * Math.max(0, 1 - Math.min(AMMO_EFFICIENCY_CAP, combined));
}

/** Innate elements plus External Combining Elements, in the order they combine (Heat, Cold, Electricity, Toxin, rest). */
function lateElements(innate, innateTotal, combining) {
  const own = Object.entries(innate).filter(([t]) => !PHYSICAL.includes(t));
  if (!combining?.length) return own;
  const sum = new Map(own);
  for (const { element, value } of combining) {
    const add = innateTotal * Number(value);
    if (element && Number.isFinite(add) && add !== 0) sum.set(element, (sum.get(element) ?? 0) + add);
  }
  const keys = [...sum.keys()];
  return [...LATE_ELEMENT_ORDER.filter(t => sum.has(t)), ...keys.filter(t => !LATE_ELEMENT_ORDER.includes(t))].map(t => [t, sum.get(t)]);
}

/**
 * Final stats for one fire mode. Percent fields stay in percent, like the weapon data.
 * `ext` is external-buffs.js reduceExternalBuffs().totals (its additive buckets are already in `m`); it adds the
 * parts that are not plain buckets: combining and non-combining external elements, flat and multiplicative crit,
 * flat status, Pageflight, Eclipse, multiplicative ammo efficiency and Infinite Ammo.
 */
export function computeFireMode(mode, m, reload, weapon = null, ext = null) {
  const innate = mode.innate_elements ?? {};
  const innateTotal = Object.values(innate).reduce((a, b) => a + b, 0) || Number(mode.base_damage) || 0;
  const damageMultiplier = 1 + m.damage;
  const isAoE = /aoe$/i.test(String(mode.projectile_type ?? '').trim());

  // Damage per type before the damage multiplier: physical, the elements combined, then the external elements.
  const raw = {};
  for (const type of PHYSICAL) {
    const v = (innate[type] ?? 0) * (1 + m.physical[type]);
    if (v > 0) raw[type] = v;
  }
  const ordered = [
    ...m.elements.map(([type, pct]) => [type, innateTotal * pct]),
    ...lateElements(innate, innateTotal, ext?.externalCombiningElements),
  ];
  Object.assign(raw, combineElements(ordered));
  // External (non-combining) elements join after combination.
  for (const { element, value } of [...(ext?.externalElements ?? []), ...(ext?.nourishElements ?? []), ...(ext?.plunderElements ?? [])]) {
    const add = innateTotal * Number(value);
    if (element && Number.isFinite(add) && add !== 0) raw[element] = (raw[element] ?? 0) + add;
  }
  // Quantized to the game's steps of base / 32, then scaled by the damage multiplier (underframe.site's order).
  const quantized = quantizeDamageTypes(raw, innateTotal);
  const finalDamageTypes = {};
  for (const [type, v] of Object.entries(Object.keys(quantized).length ? quantized : raw)) {
    const d = v * damageMultiplier;
    if (d > 0) finalDamageTypes[type] = d;
  }
  const totalFinalDamage = Object.values(finalDamageTypes).reduce((a, b) => a + b, 0);

  const baseCritMultiplier = quantizeCritMultiplier(mode.crit_multiplier ?? 1);
  const flatCrit = (ext?.flatCritChance ?? 0) + (isAoE ? 0 : ext?.nonRadialFlatCritChance ?? 0);
  const finalCritChance = ((mode.crit_chance ?? 0) * (1 + m.critChance) + flatCrit * 100) * (ext?.multiplicativeCritChance ?? 1);
  const finalCritMultiplier = (baseCritMultiplier * (1 + m.critDamage) + (ext?.flatCritDamage ?? 0)) * (ext?.multiplicativeCritDamage ?? 1);
  // A multishot lock (Acuity) keeps the weapon's own multishot, whatever mods, buffs and arcanes add.
  const finalMultishot = (Number(mode.multishot) || 1) * (m.multishotLocked ? 1 : 1 + m.multishot);
  const perProjectileStatus = Math.max(0, (mode.status_chance ?? 0) / 100 * (1 + m.statusChance) * (ext?.pageflightMultiplier ?? 1) + (ext?.flatStatusChance ?? 0));
  const aggregatedStatus = perProjectileStatus < 1
    ? 1 - (1 - perProjectileStatus) ** Math.max(1, finalMultishot)
    : perProjectileStatus;
  // A fire rate lock (Semi-Cannonade) keeps the weapon's own fire rate: External Fire Rate and arcanes are cancelled too.
  const finalFireRate = m.fireRateLocked ? baseFireRate(mode) : baseFireRate(mode) * (1 + m.fireRate * fireRateModScale(mode, weapon));
  const magazineSize = Math.max(1, Math.round((reload?.magazine_size ?? 1) * (1 + m.magazine)));
  const reloadTime = (reload?.reload_time ?? 1) / Math.max(0.05, 1 + m.reload);

  return {
    ...mode,
    finalDamageTypes,
    totalFinalDamage,
    baseCritChance: mode.crit_chance ?? 0,
    baseCritMultiplier,
    finalCritChance,
    finalCritMultiplier,
    baseStatusChance: mode.status_chance ?? 0,
    perProjectileStatusChance: Math.min(999, perProjectileStatus * 100),
    displayStatusChance: Math.min(999, perProjectileStatus * 100),
    finalStatusChance: Math.min(999, aggregatedStatus * 100),
    finalStatusDuration: STATUS_DURATION_BASE_SECONDS * (1 + m.statusDuration),
    statusDamageBonus: m.statusDamage,
    finalMultishot,
    fireRateLocked: Boolean(m.fireRateLocked),
    multishotLocked: Boolean(m.multishotLocked),
    multishotDamageMultiplier: 1,
    fire_rate: baseFireRate(mode),
    baseFireRate: baseFireRate(mode),
    finalFireRate,
    effectiveFireRate: finalFireRate,
    displayFireRate: finalFireRate,
    magazineSize,
    realMagazineSize: magazineSize,
    // Ammo efficiency (arcanes, Energized Munitions) lowers what each shot uses, up to 75%; Infinite Ammo makes it free.
    ammoConsumption: ammoConsumptionOf(mode.ammo_cost ?? 1, m.ammoEfficiency ?? 0, ext?.ammoEfficiencyMultipliers, Boolean(ext?.infiniteAmmo)),
    reloadTime,
    factionDamage: m.factionDamage,
    weakPointDamage: m.weakPointDamage,
    weakPointCritChance: m.weakPointCritChance,
    finalPunchThrough: isAoE ? 0 : (mode.punch_through ?? 0) + m.punchThrough,
    punchThroughLocked: isAoE,
    finalRange: mode.range ?? 0,
    finalBlastRadius: isAoE ? (mode.range ?? 0) : 0,
    conditionOverload: 0,
    co_factor: 0,
    forced_procs: [],
    eclipseMultiplier: 1 + (ext?.eclipseMultiplier ?? 0),
    // 0 means "no override", as underframe.site sends it (1 made non-crit hits about 1-2% stronger).
    nonCritDamageMultiplier: 0,
    guaranteedNonCritDamageMultiplier: 1,
  };
}

/** Modifiers plus additive bonuses ({ damage: 3.6, reload: 0.3, ... }). */
export function addModifiers(m, extra) {
  const out = { ...m };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof out[k] === 'number') out[k] += v;
    else if (k === 'physical' && v && out.physical) {
      // External physical multipliers (External Elemental on Slash, Phoenix Talons) add like a +X% Slash mod.
      out.physical = { ...out.physical };
      for (const [t, x] of Object.entries(v)) if (typeof out.physical[t] === 'number') out.physical[t] += x || 0;
    }
  }
  return out;
}

/**
 * Engine-ready stats for every fire mode of a weapon.
 * `arcanes` is resolveArcanes() output; its stat bonuses add to the mod buckets, per fire mode, because
 * element arcanes (Primary Frostbite: Cold) only count on a mode that deals their element.
 * `external` is external-buffs.js reduceExternalBuffs().totals: buffs from outside the weapon, on every mode.
 * `externalStatuses` ([{ type, stacks }] already on the target) can meet an element arcane's need (Cold: Frostbite).
 * @returns {{ modes: object[], modifiers: object }} `modifiers` are the mods' alone.
 */
export function computeWeaponStats(weapon, modSlots, { modsByName, reload, targetFaction, arcanes = null, external = null, externalStatuses = null }) {
  const modifiers = collectModifiers(modSlots, modsByName, targetFaction);
  const withExternal = external ? addModifiers(modifiers, externalModifiers(external)) : modifiers;
  const modes = weapon.fire_modes.map(mode => {
    const plain = computeFireMode(mode, withExternal, reload, weapon, external);
    if (!arcanes?.entries?.length) return plain;
    // Arcanes never change which elements a mode deals, so the plain mode's damage types decide.
    const extra = arcaneModifiersFor(arcanes, plain.finalDamageTypes, externalStatuses);
    return Object.keys(extra).length ? computeFireMode(mode, addModifiers(withExternal, extra), reload, weapon, external) : plain;
  });
  return { modes, modifiers };
}

/** Fire modes a player picks directly; child modes (e.g. an AoE that follows a hit) run with their parent. */
export function selectableModes(weapon) {
  const children = new Set(weapon.fire_modes.flatMap(m => m.child_mode ?? []));
  return weapon.fire_modes.filter(m => !children.has(m.mode_name));
}
