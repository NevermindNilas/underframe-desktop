// Modded weapon stats per fire mode, in the shape the Underframe engine consumes as `weaponStats`.
import { DAMAGE_TYPE_BY_DT, PHYSICAL, combineElements } from './damage.js';
import { resolveFaction, baneFamilyOfStat } from './factions.js';
import { statValue } from './mods.js';
import { arcaneModifiersFor } from './arcanes.js';

const STATUS_DURATION_BASE_SECONDS = 6;

/** Sum every equipped mod's stats into additive buckets. Elemental sources keep their slot order. */
export function collectModifiers(modSlots, modsByName, targetFaction) {
  const m = {
    damage: 0, multishot: 0, critChance: 0, critDamage: 0, statusChance: 0, statusDuration: 0,
    fireRate: 0, magazine: 0, reload: 0, factionDamage: 0, statusDamage: 0, punchThrough: 0,
    weakPointDamage: 0, weakPointCritChance: 0, ammoEfficiency: 0, physical: { Impact: 0, Puncture: 0, Slash: 0 },
    elements: [], unhandled: [],
  };
  const bane = resolveFaction(targetFaction)?.bane;

  for (const slot of modSlots) {
    const mod = slot && modsByName.get(slot.name);
    if (!mod) continue;
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

/** Final stats for one fire mode. Percent fields stay in percent, like the weapon data. */
export function computeFireMode(mode, m, reload, weapon = null) {
  const innate = mode.innate_elements ?? {};
  const innateTotal = Object.values(innate).reduce((a, b) => a + b, 0) || Number(mode.base_damage) || 0;
  const damageMultiplier = 1 + m.damage;

  const finalDamageTypes = {};
  for (const type of PHYSICAL) {
    const v = (innate[type] ?? 0) * (1 + m.physical[type]) * damageMultiplier;
    if (v > 0) finalDamageTypes[type] = v;
  }
  const ordered = [
    ...m.elements.map(([type, pct]) => [type, innateTotal * pct * damageMultiplier]),
    ...Object.entries(innate).filter(([t]) => !PHYSICAL.includes(t)).map(([t, v]) => [t, v * damageMultiplier]),
  ];
  Object.assign(finalDamageTypes, combineElements(ordered));
  const totalFinalDamage = Object.values(finalDamageTypes).reduce((a, b) => a + b, 0);

  const finalMultishot = (Number(mode.multishot) || 1) * (1 + m.multishot);
  const perProjectileStatus = Math.max(0, (mode.status_chance ?? 0) / 100 * (1 + m.statusChance));
  const aggregatedStatus = perProjectileStatus < 1
    ? 1 - (1 - perProjectileStatus) ** Math.max(1, finalMultishot)
    : perProjectileStatus;
  const finalFireRate = baseFireRate(mode) * (1 + m.fireRate * fireRateModScale(mode, weapon));
  const magazineSize = Math.max(1, Math.round((reload?.magazine_size ?? 1) * (1 + m.magazine)));
  const reloadTime = (reload?.reload_time ?? 1) / Math.max(0.05, 1 + m.reload);
  const isAoE = /aoe$/i.test(String(mode.projectile_type ?? '').trim());

  return {
    ...mode,
    finalDamageTypes,
    totalFinalDamage,
    baseCritChance: mode.crit_chance ?? 0,
    baseCritMultiplier: mode.crit_multiplier ?? 1,
    finalCritChance: (mode.crit_chance ?? 0) * (1 + m.critChance),
    finalCritMultiplier: (mode.crit_multiplier ?? 1) * (1 + m.critDamage),
    baseStatusChance: mode.status_chance ?? 0,
    perProjectileStatusChance: Math.min(999, perProjectileStatus * 100),
    displayStatusChance: Math.min(999, perProjectileStatus * 100),
    finalStatusChance: Math.min(999, aggregatedStatus * 100),
    finalStatusDuration: STATUS_DURATION_BASE_SECONDS * (1 + m.statusDuration),
    statusDamageBonus: m.statusDamage,
    finalMultishot,
    multishotDamageMultiplier: 1,
    fire_rate: baseFireRate(mode),
    baseFireRate: baseFireRate(mode),
    finalFireRate,
    effectiveFireRate: finalFireRate,
    displayFireRate: finalFireRate,
    magazineSize,
    realMagazineSize: magazineSize,
    // Ammo efficiency (arcanes) lowers what each shot uses; 100% or more makes it free.
    ammoConsumption: (mode.ammo_cost ?? 1) * Math.max(0, 1 - (m.ammoEfficiency ?? 0)),
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
    eclipseMultiplier: 1,
    nonCritDamageMultiplier: 1,
    guaranteedNonCritDamageMultiplier: 1,
  };
}

/** Modifiers plus additive bonuses ({ damage: 3.6, reload: 0.3, ... }). */
export function addModifiers(m, extra) {
  const out = { ...m };
  for (const [k, v] of Object.entries(extra ?? {})) if (typeof out[k] === 'number') out[k] += v;
  return out;
}

/**
 * Engine-ready stats for every fire mode of a weapon.
 * `arcanes` is resolveArcanes() output; its stat bonuses add to the mod buckets, per fire mode, because
 * element arcanes (Primary Frostbite: Cold) only count on a mode that deals their element.
 * @returns {{ modes: object[], modifiers: object }} `modifiers` are the mods' alone.
 */
export function computeWeaponStats(weapon, modSlots, { modsByName, reload, targetFaction, arcanes = null }) {
  const modifiers = collectModifiers(modSlots, modsByName, targetFaction);
  const modes = weapon.fire_modes.map(mode => {
    const plain = computeFireMode(mode, modifiers, reload, weapon);
    if (!arcanes?.entries?.length) return plain;
    // Arcanes never change which elements a mode deals, so the plain mode's damage types decide.
    const extra = arcaneModifiersFor(arcanes, plain.finalDamageTypes);
    return Object.keys(extra).length ? computeFireMode(mode, addModifiers(modifiers, extra), reload, weapon) : plain;
  });
  return { modes, modifiers };
}

/** Fire modes a player picks directly; child modes (e.g. an AoE that follows a hit) run with their parent. */
export function selectableModes(weapon) {
  const children = new Set(weapon.fire_modes.flatMap(m => m.child_mode ?? []));
  return weapon.fire_modes.filter(m => !children.has(m.mode_name));
}
