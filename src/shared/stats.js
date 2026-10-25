// Modded weapon stats per fire mode, in the shape the Underframe engine consumes as `weaponStats`.
import { DAMAGE_TYPE_BY_DT, PHYSICAL, combineElements } from './damage.js';
import { resolveFaction, baneFamilyOfStat } from './factions.js';
import { statValue } from './mods.js';
import { arcaneModifiersFor } from './arcanes.js';
import { emptyExternalTotals, externalModifiers, mergeExternalTotals } from './external-buffs.js';
import { addRivenModifiers } from './rivens.js';
import { applyIncarnonToModes, incarnonActive, incarnonEffects, incarnonElements, incarnonFor, incarnonStates } from './incarnon.js';

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
/** Elements conditional mods add (Biotic Rounds' Viral and Magnetic, Leaded Gas), after the mods' own elements. */
const CONDITIONAL_ELEMENTS = [['Gas', 'gasDamage'], ['Viral', 'viralDamage'], ['Magnetic', 'magneticDamage'], ['Toxin', 'toxinDamage'], ['Heat', 'heatDamage']];
const SENTIENT_BARRAGE_MODE = 'Secondary Fire';
const WILD_FRENZY_MODE = 'Normal Attack';

// Per-mode locks, as the game (and underframe.site) applies them:
// - multishot stays the mode's own: hitscan area modes (the AoE that follows an Incarnon or charged hit, except
//   Acid Shells, listed below), and the modes named here;
// - Glory's alternate fire keeps its own damage and fire rate;
// - a bow's uncharged or quick shot has no wait between shots;
// - Phage and Phantasma beams scale only the beams past the first with multishot.
const MULTISHOT_LOCKED_MODES = Object.freeze({
  Lizzie: ['Viral Wave', 'Magnetic Wave', 'Cold Wave', 'Corrosive Wave'],
  Glory: ['Alternate Fire'],
  Sobek: ['Acid Shells'],
  'Kuva Sobek': ['Acid Shells'],
  Catabolyst: ['Partial Reload Explosion', 'Reload From Empty Explosion'],
  'Coda Catabolyst': ['Partial Reload Explosion', 'Reload From Empty Explosion'],
});
const DAMAGE_LOCKED_MODES = Object.freeze({ Glory: ['Alternate Fire'] });
const FIRE_RATE_LOCKED_MODES = Object.freeze({ Glory: ['Alternate Fire'] });
const INSTANT_BOW_MODES = new Set(['Uncharged Shot', 'Quick Shot']);
const INSTANT_FIRE_RATE = 1000;
const EXTRA_BEAMS_MULTISHOT = new Set(['Phage', 'Phantasma', 'Phantasma Prime']);

const lockedFor = (table, weapon, mode) => Boolean(table[weapon?.name]?.includes(mode.mode_name));
const isHitscanArea = mode => String(mode.projectile_type ?? '').toLowerCase().replace(/[\s-]+/g, '') === 'hitscanaoe' && mode.mode_name !== 'Acid Shells';

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
    weakPointDamage: 0, weakPointCritChance: 0, ammoEfficiency: 0, conditionOverload: 0, physical: { Impact: 0, Puncture: 0, Slash: 0 },
    // Stats that change timing, reach and special hits rather than damage per shot.
    chargeRate: 0, range: 0, beamLength: 0, projectileSpeed: 0, blastRadius: 0, flatBlastRadius: 0, bodyshot: 0,
    flatStatusChance: 0, flatMagazine: 0, followThrough: 0, projectileExplosionChance: 0, nonCritDamage: 0,
    elements: [], unhandled: [],
    // Set by a mod that locks the stat (Semi-Cannonade: fire rate; Acuity: multishot). The lock holds against every
    // source, external buffs and arcanes included, as on underframe.site.
    fireRateLocked: false, multishotLocked: false,
  };
  const bane = resolveFaction(targetFaction)?.bane;

  for (const slot of modSlots) {
    // A riven is not in data.mods: its stats go to the buckets here, in slot order (docs/port-rivens.md 3).
    if (slot?.isRiven) { addRivenModifiers(m, slot, targetFaction); continue; }
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
        // A flat (ADD) status chance or magazine adds to the result rather than scaling the base (Napalm Grenades,
        // Stinging Truth).
        case 'WEAPON_PROC_CHANCE': if (stat.OperationType === 'ADD') m.flatStatusChance += v; else m.statusChance += v; break;
        case 'WEAPON_PROC_TIME': case 'WEAPON_PROC_DURATION': m.statusDuration += v; break;
        case 'WEAPON_PROC_DAMAGE': m.statusDamage += v; break;
        case 'WEAPON_FIRE_RATE': m.fireRate += v; break;
        case 'WEAPON_CHARGE_RATE': m.chargeRate += v; break;
        case 'WEAPON_CLIP_MAX': if (stat.OperationType === 'ADD') m.flatMagazine += v; else m.magazine += v; break;
        // Sinister Reach lengthens beams; other range stats reach further.
        case 'WEAPON_RANGE': if (slot.name === 'Sinister Reach') m.beamLength += v; else m.range += v; break;
        case 'WEAPON_PROJECTILE_SPEED': m.projectileSpeed += v; break;
        // A blast radius stat shown without a percent is metres (flat).
        case 'WEAPON_EXPLOSION_RADIUS': case 'WEAPON_BLAST_RADIUS':
          if (Object.prototype.hasOwnProperty.call(stat, 'DisplayAsPercent') && !['1', 1, true].includes(stat.DisplayAsPercent)) m.flatBlastRadius += v;
          else m.blastRadius += v;
          break;
        case 'WEAPON_BODYSHOT_MULTIPLIER': m.bodyshot += v; break;
        case 'WEAPON_FOLLOW_THROUGH': m.followThrough += v; break;
        case 'WEAPON_PROJECTILE_EXPLOSION_CHANCE': m.projectileExplosionChance += v; break;
        case 'WEAPON_NOCRIT_DAMAGE': m.nonCritDamage += v; break;
        case 'WEAPON_RELOAD_SPEED': m.reload += v; break;
        case 'WEAPON_PUNCTURE_DEPTH': m.punchThrough += v; break;
        case 'WEAPON_DAMAGE_WEAKPOINT': m.weakPointDamage += v; break;
        case 'WEAPON_CRIT_CHANCE_WEAKPOINT': m.weakPointCritChance += v; break;
        case 'WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE': m.conditionOverload += v; break;
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
 * flat status, Pageflight, Eclipse, multiplicative ammo efficiency and Infinite Ammo; and from conditional mods, their
 * extra elements, Sentient Barrage's charged-shot crit and Wild Frenzy's fire rate.
 * `more.perks` is incarnon.js incarnonEffects(): the Incarnon perks' parts that are not plain buckets (base magazine,
 * base crit multiplier, elements, crit from status and status from crit, accuracy, the engine's per-mode fields).
 */
export function computeFireMode(mode, m, reload, weapon = null, ext = null, more = {}) {
  const { normal = null, progenitor = null, incarnon = null, perks = null, coFactor = 100, disableAmmo = false } = more;
  const own = mode.innate_elements ?? {};
  const ownTotal = Object.values(own).reduce((a, b) => a + b, 0) || Number(mode.base_damage) || 0;
  // A Progenitor bonus (Kuva, Tenet, Coda weapons) adds its element to the base, so every mod scales it.
  const progenitorBonus = progenitorFor(weapon, progenitor) ? ownTotal * Number(progenitor.value) / 100 : 0;
  const innate = progenitorBonus > 0 ? { ...own, [progenitor.element]: (own[progenitor.element] ?? 0) + progenitorBonus } : own;
  const innateTotal = ownTotal + progenitorBonus;
  const damageLocked = lockedFor(DAMAGE_LOCKED_MODES, weapon, mode);
  const damageMultiplier = damageLocked ? 1 : 1 + m.damage;
  // Sentient Barrage adds crit to the Battacor's charged shot only.
  const barrage = weapon?.name === 'Battacor' && mode.mode_name === SENTIENT_BARRAGE_MODE;
  const critChanceMod = m.critChance + (barrage ? ext?.sentientBarrageCritChance ?? 0 : 0);
  const critDamageMod = m.critDamage + (barrage ? ext?.sentientBarrageCritDamage ?? 0 : 0);
  const isAoE = /aoe$/i.test(String(mode.projectile_type ?? '').trim());

  // Damage per type before the damage multiplier: physical, the elements combined, then the external elements.
  const raw = {};
  for (const type of PHYSICAL) {
    // Komorex's full zoom doubles the physical bonuses (as +100% each) and the combined elements, below.
    const v = (innate[type] ?? 0) * (1 + m.physical[type] + (ext?.komorexZoomBonus ? 1 : 0));
    if (v > 0) raw[type] = v;
  }
  const ordered = [
    ...m.elements.map(([type, pct]) => [type, innateTotal * pct]),
    // Incarnon perks' elements (Dual Toxocyst's Toxin) join after the mods'.
    ...incarnonElements(perks).map(([type, pct]) => [type, innateTotal * pct]),
    ...CONDITIONAL_ELEMENTS.filter(([, k]) => ext?.[k] > 0).map(([type, k]) => [type, innateTotal * ext[k]]),
    ...lateElements(innate, innateTotal, ext?.externalCombiningElements),
  ];
  Object.assign(raw, combineElements(ordered));
  // External (non-combining) elements join after combination.
  for (const { element, value } of [...(ext?.externalElements ?? []), ...(ext?.nourishElements ?? []), ...(ext?.plunderElements ?? [])]) {
    const add = innateTotal * Number(value);
    if (element && Number.isFinite(add) && add !== 0) raw[element] = (raw[element] ?? 0) + add;
  }
  // Quantized to the game's steps of base / 32, then scaled by the damage multiplier (underframe.site's order).
  if (ext?.komorexZoomBonus) for (const t of Object.keys(raw)) if (COMBINED_ELEMENTS.has(t)) raw[t] *= 2;
  const quantized = quantizeDamageTypes(raw, innateTotal);
  const finalDamageTypes = {};
  // Plinx's alternate fire spends the whole magazine in one shot, with the damage of all of it. Incarnon perks may add
  // rounds to the base magazine before mods scale it.
  const baseMagazine = Math.max(1, Math.round(((reload?.magazine_size ?? 1) + (perks?.baseMagazine ?? 0)) * (1 + m.magazine) + m.flatMagazine) || 1);
  const plinxAltFire = ['Tenet Plinx', 'Plinx'].includes(weapon?.name) && ['Alt-Fire', 'Alt-Fire AoE'].includes(mode.mode_name);
  const shotScale = plinxAltFire ? Math.max(1, baseMagazine) : 1;
  for (const [type, v] of Object.entries(Object.keys(quantized).length ? quantized : raw)) {
    const d = v * damageMultiplier * shotScale;
    if (d > 0) finalDamageTypes[type] = d;
  }
  const totalFinalDamage = Object.values(finalDamageTypes).reduce((a, b) => a + b, 0);

  // A mode without crit or status of its own (an explosion, a beacon) uses the weapon's normal attack's.
  const inherits = normal && mode.inherits_weapon_crit !== false;
  const ownCrit = typeof mode.crit_chance === 'number' ? mode.crit_chance : 0;
  const ownCritMultiplier = typeof mode.crit_multiplier === 'number' ? mode.crit_multiplier : 1;
  let baseCritChance = inherits && ownCrit === 0 ? normal.crit_chance || 0 : ownCrit;
  // An Incarnon perk's crit multiplier bonus adds to the base before it is rounded to the game's steps.
  const baseCritMultiplier = quantizeCritMultiplier((inherits && ownCritMultiplier === 1 ? normal.crit_multiplier || 1 : ownCritMultiplier) + (perks?.baseCritDamage ?? 0));
  let baseStatus = (typeof mode.status_chance === 'number' ? mode.status_chance : normal?.status_chance ?? 0) / 100;
  const flatCrit = (ext?.flatCritChance ?? 0) + (isAoE ? 0 : ext?.nonRadialFlatCritChance ?? 0);
  const critChanceOf = b => (b * (1 + critChanceMod) + flatCrit * 100) * (ext?.multiplicativeCritChance ?? 1);
  const finalCritMultiplier = (baseCritMultiplier * (1 + critDamageMod) + (ext?.flatCritDamage ?? 0)) * (ext?.multiplicativeCritDamage ?? 1);
  // A multishot lock (Acuity, or a mode that cannot take multishot) keeps the mode's own, whatever mods, buffs and
  // arcanes add.
  const baseMultishot = Number(mode.multishot) || 1;
  const multishotLocked = m.multishotLocked || isHitscanArea(mode) || lockedFor(MULTISHOT_LOCKED_MODES, weapon, mode);
  let finalMultishot = multishotLocked ? baseMultishot
    : EXTRA_BEAMS_MULTISHOT.has(weapon?.name) && mode.is_beam && baseMultishot > 1 ? (baseMultishot - 1) * (1 + m.multishot) + 1
      : baseMultishot * (1 + m.multishot);
  // An Incarnon perk that feeds multishot from the ammo pool (Torid) makes a beam's extra beams count more.
  const nativeExpectedFireIterations = finalMultishot;
  const ammoPoolBeam = Boolean(mode.is_beam && perks?.ammoPoolPercent > 0);
  if (ammoPoolBeam) finalMultishot += Math.max(0, finalMultishot - baseMultishot) * perks.ammoPoolPercent;
  // Incarnon perks that turn crit into status (and status into crit), up to their caps, in percent points.
  let statusFromCrit = 0;
  for (const c of perks?.statusChanceFromCrit ?? []) statusFromCrit += Math.min(critChanceOf(baseCritChance) * c.ratio, c.cap ?? Infinity) / 100;
  if (statusFromCrit !== 0) baseStatus = Math.max(baseStatus + statusFromCrit, 0);
  const perProjectileStatus = Math.max(0, baseStatus * (1 + m.statusChance) * (ext?.pageflightMultiplier ?? 1) + m.flatStatusChance + (ext?.flatStatusChance ?? 0));
  let critFromStatus = 0;
  for (const c of perks?.critChanceFromStatus ?? []) critFromStatus += Math.min(perProjectileStatus * 100 * c.ratio, c.cap ?? Infinity);
  baseCritChance += critFromStatus;
  const finalCritChance = critChanceOf(baseCritChance);
  // Each pellet rolls for status; a beam's status chance is per tick and is not combined over its beams.
  const aggregatedStatus = mode.is_beam ? perProjectileStatus
    : perProjectileStatus < 1 && finalMultishot > 0 ? 1 - (1 - perProjectileStatus) ** Math.max(1, finalMultishot)
      : perProjectileStatus;

  // Fire rate. A stat lock (Semi-Cannonade) keeps the weapon's own rate against mods, buffs and arcanes; a mode lock
  // (Glory's alternate fire) too; Wild Frenzy fixes the Grakata's normal fire at 80; a bow's uncharged shot is instant.
  // The mode's own rate; a mode without one (a DoT tick) has none, except the normal attack, which takes the weapon's.
  const base = typeof mode.fire_rate === 'number' && !Number.isNaN(mode.fire_rate) ? mode.fire_rate
    : mode.mode_name === 'Normal Attack' ? (typeof normal?.fire_rate === 'number' ? normal.fire_rate : 0) : 0;
  const frenzy = Number(ext?.fireRateOverride) > 0 && mode.mode_name === WILD_FRENZY_MODE ? Number(ext.fireRateOverride) : null;
  const instant = weapon?.subtype === 'Bow' && INSTANT_BOW_MODES.has(mode.mode_name) ? INSTANT_FIRE_RATE : null;
  const modeLocksFireRate = lockedFor(FIRE_RATE_LOCKED_MODES, weapon, mode) || Boolean(instant) || Boolean(frenzy);
  const statLocked = Boolean(m.fireRateLocked);
  // Fire rate mods add; a multiplicative bonus (Dual Toxocyst's passive) multiplies the total; bows double the bonus.
  const fireRateTotal = (1 + m.fireRate) * (ext?.multiplicativeFireRate ?? 1);
  const moddedFireRate = statLocked ? base : base * (1 + (fireRateTotal - 1) * fireRateModScale(mode, weapon));
  // The charge speeds up with the modded rate, even where the shot itself is fixed (a bow's quick shot).
  const chargeModifier = mode.charge_speed_stat === 'charge_rate' ? 1 + m.chargeRate : base > 0 ? moddedFireRate / base : 1 + m.fireRate;
  const finalFireRate = instant ?? frenzy ?? (modeLocksFireRate ? base : moddedFireRate);
  // A charged shot fires once per charge plus its release: the charge speeds up with fire rate (or charge rate).
  let effectiveFireRate = null;
  let rangedPhaseTiming = null;
  if (mode.chargeFallback) {
    if (statLocked) effectiveFireRate = finalFireRate / (1 + Number(mode.charge_time) * base);
    else {
      const chargeSeconds = Number(mode.charge_time) / Math.max(0.25, chargeModifier);
      const releaseSeconds = 1 / Math.max(MIN_FIRE_RATE, finalFireRate);
      effectiveFireRate = 1 / (chargeSeconds + releaseSeconds);
      rangedPhaseTiming = { chargeSeconds, releaseSeconds, cycleDuration: chargeSeconds + releaseSeconds };
    }
  }
  // Bursts: the delay between a burst's shots shrinks with fire rate where the game says so.
  const burstCount = Number.isFinite(Number(mode.burst_count)) ? Math.max(1, Number(mode.burst_count)) : null;
  const burstDelay = Number.isFinite(Number(mode.burst_delay))
    ? Math.max(0, Number(mode.burst_delay)) / (mode.burst_delay_scales_with_fire_rate === true && !statLocked && !modeLocksFireRate ? Math.max(1, fireRateTotal) : 1)
    : null;

  // Magazine and ammo, in shots: a mode that costs less than one round per shot holds more shots; one that empties the
  // clip fires once per magazine; one that costs nothing never reloads. Incarnon forms draw on their own charge pool.
  const ammoCost = typeof mode.ammo_cost === 'number' ? mode.ammo_cost : 1;
  const consumption = ammoConsumptionOf(1, m.ammoEfficiency ?? 0, ext?.ammoEfficiencyMultipliers, Boolean(ext?.infiniteAmmo));
  const fullClip = mode.consume_entire_clip === true || plinxAltFire;
  const incarnonPool = Boolean(incarnon) && /incarnon/i.test(mode.mode_name);
  let magazineSize = baseMagazine;
  let ammoConsumption = consumption;
  if (fullClip) { magazineSize = 1; ammoConsumption = 1; }
  else if (ammoCost > 0) magazineSize = baseMagazine / ammoCost;
  else { magazineSize = 1; ammoConsumption = 0; }
  if (incarnonPool) { magazineSize = incarnon.incarnon_max_ammo; ammoConsumption = 1; }
  // Incarnon perks that add multishot to a magazine's last shots or last burst (Torid, Burston): the normal form only.
  const lastShots = !incarnonPool && ammoCost > 0 ? perks?.lastMagazineShots ?? [] : [];
  const burstLocked = isHitscanArea(mode) || lockedFor(MULTISHOT_LOCKED_MODES, weapon, mode);
  const lastBurst = !incarnonPool && ammoCost > 0 && burstCount > 1 ? (perks?.lastMagazineBurst ?? 0) * Math.max(0, burstLocked ? 1 : 1 + m.multishot) : 0;
  const ammoPool = innateTotal > 0 && (perks?.ammoPoolPercent > 0 || perks?.ammoPoolFlat > 0);

  const punchLocked = isAoE || Number(mode.punch_through) === -1;
  // A mode whose projectiles stack into one (Stug's blobs) grows its radius toward its max as multishot fills the stack.
  const stackCap = Math.max(0, Number(mode.multishot_stack_cap) || 0);
  const stackMaxRange = Math.max(0, Number(mode.multishot_stack_max_range) || 0);
  const stackProgress = stackCap > 1 ? (Math.min(stackCap, Math.max(1, finalMultishot)) - 1) / (stackCap - 1) : 0;
  const ownRange = Number(mode.range) || 0;
  const reachRange = stackMaxRange > ownRange ? ownRange + (stackMaxRange - ownRange) * stackProgress : ownRange;
  const baseFinalRange = reachRange + m.range + (isSinisterReachBeam(weapon, mode) ? m.beamLength : 0);
  const blastRadiusMultiplier = Math.max(0, 1 + m.blastRadius);
  const finalBlastRadius = Math.max(0, baseFinalRange * blastRadiusMultiplier + m.flatBlastRadius);
  const procExtra = Number(mode.proc_extra_time) || 0;
  const explosion = mode.native_contact_explosion;

  return {
    mode_name: mode.mode_name,
    isCustomBaseOverride: false,
    projectile_type: typeof mode.projectile_type === 'string' ? mode.projectile_type : '',
    base_damage: mode.base_damage,
    finalCritChance,
    finalCritMultiplier,
    finalStatusChance: aggregatedStatus * 100,
    simulationPerProjectileStatusChance: perProjectileStatus * 100,
    // The engine takes a rate of zero or less as "never fires on its own".
    finalFireRate: (effectiveFireRate ?? finalFireRate) > 0 ? effectiveFireRate ?? finalFireRate : MIN_FIRE_RATE,
    ...(rangedPhaseTiming ? { rangedPhaseTiming } : {}),
    burstCount,
    burstDelay,
    displayFireRate: instant ? 1 : finalFireRate,
    effectiveFireRate,
    baseFireRate: base,
    finalMultishot,
    finalPunchThrough: punchLocked ? 0 : Math.max(0, (Number(mode.punch_through) || 0) + m.punchThrough),
    finalRange: isAoE ? finalBlastRadius : baseFinalRange,
    finalStatusDuration: Math.max(0, STATUS_DURATION_BASE_SECONDS + procExtra) * (1 + m.statusDuration),
    ...(mode.proc_extra_time !== undefined ? { procExtraTime: procExtra, statusDurationMultiplier: 1 + m.statusDuration } : {}),
    multishotDamageMultiplier: 1,
    punchThroughLocked: punchLocked,
    finalWidth: Number(mode.width) > 0 ? Number(mode.width) : 0.1,
    finalAccuracy: (mode.accuracy || 100) * (1 + (perks?.accuracy ?? 0)),
    finalDamageTypes,
    totalFinalDamage,
    // Bonus damage per status type on the target (Galvanized Aptitude, Savvy and Shot at their stacks).
    conditionOverload: m.conditionOverload ?? 0,
    baseCritChance,
    baseCritMultiplier,
    ...(ammoPool ? {
      ammoPoolMultishotInnateProjectiles: Math.max(1, baseMultishot),
      ammoPoolMultishotDamageMultiplier: (1 + perks.ammoPoolPercent) * (innateTotal + perks.ammoPoolFlat) / innateTotal,
    } : {}),
    ...(ammoPoolBeam ? { nativeExpectedFireIterations } : {}),
    ...multishotOverride(mode, { critChanceMod, critDamageMod, ext, m, perProjectileStatus, innateTotal, critFromStatus, critChanceOf }),
    multishotStackCap: Math.max(0, Number(mode.multishot_stack_cap) || 0),
    multishotStackMaxBaseDamage: Math.max(0, Number(mode.multishot_stack_max_base_damage) || 0),
    multishotStackMinProjectiles: Math.max(0, Number(mode.multishot_stack_min_projectiles) || 0),
    baseStatusChance: baseStatus * 100,
    weakPointDamage: m.weakPointDamage,
    weakPointCritChance: m.weakPointCritChance,
    ...(ext?.headshotCritChance ? { headshotCritChance: ext.headshotCritChance } : {}),
    co_factor: coFactor,
    ...(typeof mode['1x_headshot_multiplier'] === 'boolean' ? { '1x_headshot_multiplier': mode['1x_headshot_multiplier'] } : {}),
    forced_procs: (mode.forced_procs ?? []).filter(p => typeof p === 'string' && p.length > 0),
    magazineSize,
    ...(incarnonPool || /incarnon/i.test(mode.mode_name) ? { usesIncarnonChargePool: true, lastMagazineMultishotBonuses: [] }
      : lastShots.length ? { lastMagazineMultishotBonuses: lastShots.map(b => ({ ...b })) } : {}),
    ...(lastBurst > 0 ? { lastMagazineBurstMultishotBonus: lastBurst } : {}),
    realMagazineSize: magazineSize,
    // Ammo efficiency (arcanes, Energized Munitions) lowers what each shot uses, up to 75%; Infinite Ammo makes it free.
    ammoConsumption,
    ...(ammoCost > 0 && !incarnonPool && !fullClip ? { minimumAmmo: mode.consume_partial_ammo === true ? 0 : ammoConsumption } : {}),
    ...(explosion?.notify_combo === true ? { nativeComboEnabled: true } : {}),
    displayStatusChance: perProjectileStatus * 100,
    perProjectileStatusChance: perProjectileStatus * 100,
    // Some Incarnon perks speed up the normal form's reload only.
    reloadTime: reloadTimeOf(reload, baseMagazine, 1 + m.reload + (incarnonPool ? 0 : perks?.normalReload ?? 0)),
    doughtyCritBonus: 0,
    factionDamage: m.factionDamage,
    eclipseMultiplier: 1 + (ext?.eclipseMultiplier ?? 0),
    customHeadshotAccuracy: 0,
    customHeadshotMultiplier: -1,
    bleedOnImpactChance: perks?.bleedOnImpactChance ?? 0,
    forceProcCount: perks?.forceProcCount ?? null,
    // 0 means "no override", as underframe.site sends it (1 made non-crit hits about 1-2% stronger).
    nonCritDamageMultiplier: perks?.nonCritDamageMultiplier ?? 0,
    // `m` holds the mods' status damage plus the conditional and external part; the site also reports the mods' alone.
    statusDamageBonus: m.statusDamage + (perks?.statusDamage ?? 0),
    statusDamageWeaponModBonus: m.statusDamage - (ext?.statusDamage ?? 0),
    bodyshotDamageMultiplier: Math.max(0, 1 + m.bodyshot),
    // Thunderbolt: projectiles may explode on contact.
    ...(m.projectileExplosionChance > 0 && explosion ? {
      contactExplosionChance: Math.max(0, Math.min(1, m.projectileExplosionChance)),
      contactExplosionDamage: Math.max(0, Number(explosion.raw_damage) || 0) * Math.max(0, Number(explosion.damage_scale) || 0),
      contactExplosionRadius: Math.max(0, (Number(explosion.radius) || 0) * (1 + m.blastRadius) + m.flatBlastRadius),
      contactExplosionDamageMultPerHit: Number(explosion.damage_mult_per_hit ?? 1),
      contactExplosionFalloffExponent: Math.max(0, Number(explosion.falloff_exponent) || 0),
      contactExplosionDirectHitType: explosion.direct_hit_type === 1 ? 1 : 0,
      contactExplosionComboEnabled: explosion.notify_combo === true,
      contactExplosionConditionalBase: Math.max(0, Number(explosion.conditional_base_damage) || 0),
    } : {}),
    meleeDamageModMultiplier: Math.max(0, damageMultiplier),
    guaranteedNonCritDamageMultiplier: Math.max(1, 1 + m.nonCritDamage + (perks?.guaranteedNonCritDamage ?? 0)),
    // Flat base damage from Incarnon perks (always-on, plus this mode's conditional part) and their conditional
    // damage bonus, which the engine reads apart from the damage types.
    incarnonBaseDamageBonus: (perks?.baseDamageBonus ?? 0) + (perks ? mode.incarnonConditionalBase ?? 0 : 0),
    sentientIncisionPercent: 0,
    simulationAdditiveDamageBonus: perks?.simulationAdditiveDamage ?? 0,
    genericWeaponDamageBonus: 0,
    stanceDamageMultiplier: 0,
    primaryCompressionMultiplicativeDamageMultiplier: 1,
    followThrough: (mode.follow_through || 0) + m.followThrough,
    collectiveCursePercent: Math.min(1, Math.max(0, ext?.collectiveCursePercent || 0)),
    breachSurgePercent: Math.max(0, ext?.breachSurgePercent || 0),
    finalBlastRadius,
    flatBlastRadiusBonus: m.flatBlastRadius,
    blastRadiusMultiplier,
    sweepRadius: Number.isFinite(Number(mode.sweep_radius)) ? Math.max(0, Number(mode.sweep_radius)) : 0.25,
    is_beam: Boolean(mode.is_beam),
    linger: mode.linger === true,
    chainNumber: Number.isFinite(Number(mode.Chain_Number)) ? Number(mode.Chain_Number) : 0,
    ...(Number.isFinite(mode.chain_range) ? { chainRange: Math.max(0, mode.chain_range) } : {}),
    ...(typeof mode.chain_sequential === 'boolean' ? { chainSequential: mode.chain_sequential } : {}),
    ...(Number.isFinite(mode.ricochet_range) ? { ricochetRange: Math.max(0, mode.ricochet_range) } : {}),
    ...(Number.isFinite(mode.ricochet_chance) ? { ricochetChance: Math.max(0, Math.min(1, mode.ricochet_chance)) } : {}),
    Chain_Falloff: mode.Chain_Falloff || 0,
    falloff: scaledFalloff(mode, m, progenitorFor(weapon, progenitor) ? Number(progenitor.value) / 100 : 0),
    is_ricochet: Boolean(mode.is_ricochet),
    ricochetCount: Number.isFinite(Number(mode.ricochet_count)) && mode.ricochet_count != null ? Number(mode.ricochet_count) : null,
    punctureArmorStrip: perks?.punctureArmorStrip ?? 0,
    percentHpDamageFraction: 0,
    percentHpReferenceEhp: 0,
    percentHpPreviewBaseDamage: 0,
    percentHpModScaling: 1,
    usesPercentHpDamage: false,
    percentHpBypassesArmor: false,
    percentHpCountsShields: false,
    percentExtraHitElementalDip: false,
    percentExtraHitBypassesArmor: false,
    percentHpElementalBreakdown: {},
    is_pseudo_heavy_attack: false,
    multishotLocked: Boolean(multishotLocked),
    damageLocked,
    fireRateLocked: modeLocksFireRate,
    // The app's own flag (the readout): a stat lock (Semi-Cannonade) also holds the fire rate.
    fireRateHeld: statLocked || modeLocksFireRate,
    forceAccurateAmmo: modeLocksFireRate || fullClip,
    // Whether this mode turns accurate ammo off for the whole weapon (it costs nothing, or the data says so).
    disablesAccurateAmmo: disableAmmo || ammoCost === 0 || (ammoCost <= 0 && mode.disable_accurate_ammo === true),
  };
}

const MIN_FIRE_RATE = 1e-9;
const COMBINED_ELEMENTS = new Set(['Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral']);

/** The bonus underframe.site gives a Kuva, Tenet or Coda weapon whose build sets none. */
export const DEFAULT_PROGENITOR = Object.freeze({ element: 'Magnetic', value: 25 });
/** Progenitor elements the game rolls (60% at most). */
export const PROGENITOR_ELEMENTS = ['Impact', 'Heat', 'Cold', 'Electricity', 'Toxin', 'Magnetic', 'Radiation'];
export const PROGENITOR_MAX = 60;

/** A build's Progenitor bonus on a weapon: its own when set, else the default; null for other weapons. */
export function effectiveProgenitor(weapon, progenitor) {
  if (!weapon?.is_progenitor) return null;
  if (progenitor && PROGENITOR_ELEMENTS.includes(progenitor.element) && Number.isFinite(Number(progenitor.value))) {
    return { element: progenitor.element, value: Math.min(PROGENITOR_MAX, Math.max(0, Number(progenitor.value))) };
  }
  return { ...DEFAULT_PROGENITOR };
}

/** Whether a Progenitor bonus applies: Kuva, Tenet and Coda weapons, with an element and a positive value. */
function progenitorFor(weapon, progenitor) {
  return Boolean(weapon?.is_progenitor && progenitor && typeof progenitor.element === 'string' && progenitor.element && Number(progenitor.value) > 0);
}

/** Beams that Sinister Reach lengthens (the data lists a few as plain hit-scan). */
function isSinisterReachBeam(weapon, mode) {
  if (/aoe$/i.test(String(mode?.projectile_type ?? '').trim())) return false;
  if (mode?.is_beam) return true;
  return ['Flux Rifle', 'Synapse', 'Coda Synapse', 'Lizzie'].includes(weapon?.name) && mode?.mode_name === 'Normal Attack' && mode?.projectile_type === 'Hit-Scan';
}

/**
 * Damage falloff over distance, its ranges stretched by projectile speed (direct hits) or blast radius (areas), as the
 * game does. Null for a mode without falloff.
 */
function scaledFalloff(mode, m, progenitorFraction = 0) {
  const f = mode.falloff;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const start = Number(f.start_range);
  const end = Number(f.end_range);
  const final = Number(f.final_multiplier);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(final) || end < start) return null;
  const type = String(mode.projectile_type ?? '');
  const range = Number(mode.range);
  const k = type === 'Hit-Scan' || type === 'Projectile' ? Math.max(0, 1 + m.projectileSpeed)
    : type.endsWith('AoE') ? Math.max(0, 1 + m.blastRadius + (Number.isFinite(range) && range > 0 ? m.flatBlastRadius / range : 0))
      : 1;
  // A Progenitor bonus raises the base, so a direct-hit taper's floor is relative to the larger base.
  const floor = f.curve === 'direct_zero_taper' && progenitorFraction > 0 ? final / (1 + progenitorFraction) : final;
  return { ...f, start_range: start * k, end_range: end * k, final_multiplier: floor };
}

/**
 * Projectiles added by multishot that differ from the first (Tenet Detron: its extra pellets have their own damage,
 * crit and status); the site's fields with their defaults when the mode has none.
 */
function multishotOverride(mode, { critChanceMod, critDamageMod, ext, m, perProjectileStatus, innateTotal, critFromStatus = 0, critChanceOf = null }) {
  const o = mode.modded_multishot_projectile_override;
  const n = k => Number(o?.[k]);
  const valid = o && n('innate_projectiles') >= 1 && n('base_damage') > 0 && n('crit_chance') >= 0 && n('crit_multiplier') >= 1 && Number(mode.base_damage) > 0;
  if (!valid) {
    return {
      moddedMultishotOverrideInnateProjectiles: 0,
      moddedMultishotOverrideBaseCritChance: 0,
      moddedMultishotOverrideFinalCritChance: 0,
      moddedMultishotOverrideFinalCritMultiplier: 1,
      moddedMultishotOverrideDamageMultiplier: 1,
      moddedMultishotOverrideFinalStatusChance: perProjectileStatus * 100,
      moddedMultishotOverrideConditionOverloadFactor: 1,
    };
  }
  const flatCrit = (ext?.flatCritChance ?? 0) + (/aoe$/i.test(String(mode.projectile_type ?? '').trim()) ? 0 : ext?.nonRadialFlatCritChance ?? 0);
  const status = n('status_chance') >= 0
    ? Math.max(0, n('status_chance') / 100 * (1 + m.statusChance) * (ext?.pageflightMultiplier ?? 1) + m.flatStatusChance + (ext?.flatStatusChance ?? 0)) * 100
    : perProjectileStatus * 100;
  const coReference = n('condition_overload_reference_damage');
  return {
    moddedMultishotOverrideInnateProjectiles: n('innate_projectiles'),
    moddedMultishotOverrideBaseCritChance: n('crit_chance'),
    // An Incarnon perk's crit from status adds to the extra projectiles' base crit too.
    moddedMultishotOverrideFinalCritChance: critFromStatus && critChanceOf ? critChanceOf(n('crit_chance') + critFromStatus)
      : (n('crit_chance') * (1 + critChanceMod) + flatCrit * 100) * (ext?.multiplicativeCritChance ?? 1),
    moddedMultishotOverrideFinalCritMultiplier: (quantizeCritMultiplier(n('crit_multiplier')) * (1 + critDamageMod) + (ext?.flatCritDamage ?? 0)) * (ext?.multiplicativeCritDamage ?? 1),
    moddedMultishotOverrideDamageMultiplier: n('base_damage') / Number(mode.base_damage),
    moddedMultishotOverrideFinalStatusChance: status,
    moddedMultishotOverrideConditionOverloadFactor: coReference > 0 ? innateTotal / coReference : 1,
  };
}

/**
 * Reload time at a reload speed multiplier: a battery recharges per round after a delay, a shell-by-shell reload
 * takes its start, end and a loop per round, and a fixed part (reload_delay) is not sped up by mods.
 */
export function reloadTimeOf(reload, magazine, speed) {
  const s = Math.max(0.05, speed);
  if (reload?.reload_model === 'battery' && reload.recharge_rate > 0) {
    const emptyDelay = Math.max(0, Number(reload.reload_delay_empty ?? reload.reload_delay) || 0);
    return emptyDelay / s + magazine / reload.recharge_rate;
  }
  if (reload?.shell_reload) {
    const shell = reload.shell_reload;
    return (shell.start + shell.end + magazine * shell.loop) / s;
  }
  const fixed = Math.max(0, Number(reload?.reload_time) || 0);
  const delay = Number(reload?.reload_delay);
  return Number.isFinite(delay) ? fixed + Math.max(0, delay) / s : (fixed || 1) / s;
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
 * `conditionals` is conditional-mods.js resolveModConditionals() output for the same mods: their conditional parts
 * (Galvanized stacks, ...) join the external totals.
 * `incarnon` is the build's Incarnon (incarnon.js): with the Genesis installed, its perks count, their conditional
 * parts at the build's settings or the site's defaults. Those defaults read the stats (crit below a threshold, a status
 * source) and the pick (`incarnonContext`: { modeId, customFireModes, buffs }), so the stats are worked out as the site
 * settles them: once with only the build's own settings, then again with the defaults that gives, when any is on.
 * @returns {{ modes: object[], modifiers: object, incarnon: object|null }} `modifiers` are the mods' alone; `incarnon`
 *   is incarnonEffects() as applied (with every conditional's `states`), null without perks.
 */
export function computeWeaponStats(weapon, modSlots, options) {
  const { incarnon = null, data = null, externalStatuses = null, incarnonContext = {} } = options;
  if (!data || !incarnonActive(incarnon) || !incarnonFor(data, weapon)) return { ...statsWithPerks(weapon, modSlots, options, null), incarnon: null };
  const context = { ...incarnonContext, statuses: externalStatuses ?? [] };
  const own = incarnonStates(data, weapon, incarnon, { ...context, weaponStats: null });
  const first = incarnonEffects(data, weapon, incarnon, own);
  const once = statsWithPerks(weapon, modSlots, options, first);
  const states = incarnonStates(data, weapon, incarnon, { ...context, weaponStats: once.modes });
  if (Object.entries(states).every(([id, s]) => s.isActive === own[id].isActive && (!s.isActive || s.stacks === own[id].stacks))) {
    return { ...once, incarnon: { ...first, states } };
  }
  const fx = incarnonEffects(data, weapon, incarnon, states);
  return { ...statsWithPerks(weapon, modSlots, options, fx), incarnon: fx };
}

/** computeWeaponStats() at given Incarnon effects (null: none). */
function statsWithPerks(weapon, modSlots, { modsByName, reload, targetFaction, arcanes = null, external: ownExternal = null, externalStatuses = null, conditionals = null, progenitor = null, data = null }, perks) {
  const external = mergeExternalTotals(ownExternal, conditionals?.totals ?? null);
  const modifiers = collectModifiers(modSlots, modsByName, targetFaction);
  const withBuffs = external ? addModifiers(modifiers, externalModifiers(external)) : modifiers;
  // Incarnon perks add to the same buckets; their flat crit, crit multiplier, ammo and Infinite Ammo parts reach the
  // stats like a buff's, but not the engine's conditionalStats (the site keeps them apart).
  const withExternal = perks ? addModifiers(withBuffs, perks.modifiers) : withBuffs;
  const ext = perks ? mergeExternalTotals(external ?? emptyExternalTotals(), perks.ext) : external;
  const prepared = applyIncarnonToModes(preparedModes(weapon, modSlots), perks, weapon);
  const normal = weapon.fire_modes.find(m => m.mode_name === 'Normal Attack') ?? weapon.fire_modes[0] ?? null;
  const incarnon = data ? (data.incarnons ?? []).find(i => i.name === weapon.name) ?? null : null;
  // Any mode that costs no ammo (Penta's fire patch) turns accurate ammo off for the weapon, as on the site.
  const disableAmmo = prepared.some(m => m.ammo_cost === 0 || (typeof m.ammo_cost === 'number' && m.ammo_cost <= 0 && m.disable_accurate_ammo));
  const more = mode => ({ normal, progenitor, incarnon, perks, coFactor: coFactorOf(data, weapon, mode), disableAmmo });
  const modes = prepared.map(mode => {
    const plain = computeFireMode(mode, withExternal, reload, weapon, ext, more(mode));
    if (!arcanes?.entries?.length) return plain;
    // Arcanes never change which elements a mode deals, so the plain mode's damage types decide.
    const extra = arcaneModifiersFor(arcanes, plain.finalDamageTypes, externalStatuses);
    return Object.keys(extra).length ? computeFireMode(mode, addModifiers(withExternal, extra), reload, weapon, ext, more(mode)) : plain;
  });
  applyScriptedHeatFields(weapon, modSlots, modes, progenitor);
  // The Shedu's pulse when its magazine empties, with the weapon's mods, on every mode.
  const pulse = weapon.name === 'Shedu' ? weapon.native_empty_magazine_pulse : null;
  if (pulse) {
    const w = withExternal;
    const emptyMagazinePulse = {
      damage: Math.max(0, pulse.base_damage * (1 + w.damage)),
      critChance: Math.max(0, (pulse.crit_chance * (1 + w.critChance) + (external?.flatCritChance ?? 0) * 100) * (external?.multiplicativeCritChance ?? 1) + (external?.covenantActive ? 50 : 0)),
      critMultiplier: Math.max(0, (pulse.crit_multiplier * (1 + w.critDamage) + (external?.flatCritDamage ?? 0)) * (external?.multiplicativeCritDamage ?? 1)),
      statusChance: Math.max(0, pulse.status_chance * (1 + w.statusChance) * (external?.pageflightMultiplier ?? 1) + ((external?.flatStatusChance ?? 0) + w.flatStatusChance) * 100),
      radius: Math.max(0, pulse.radius * (1 + w.blastRadius) + w.flatBlastRadius),
    };
    for (const mode of modes) mode.emptyMagazinePulse = { ...emptyMagazinePulse };
  }
  return { modes, modifiers };
}

/** Firing fields a mode takes from the mode whose trigger it shares (an explosion fires with its projectile). */
const FIRING_FIELDS = ['ammo_cost', 'consume_partial_ammo', 'consume_entire_clip', 'fire_rate', 'charge_time', 'effective_fire_rate', 'charge_speed_stat',
  'burst_count', 'burst_delay', 'burst_delay_scales_with_fire_rate', 'force_accurate_ammo', 'disable_accurate_ammo'];

/**
 * The weapon's modes as the simulation sees them: firing fields shared with their firing mode, a charge cycle for
 * charged shots (`chargeFallback`), Lanka's fire rate set by its charge, and the modes that need a mod (Zarr's
 * embedded explosion: Adhesive Blast) or that a mod replaces (Sentient Barrage on the Battacor) left out.
 */
export function preparedModes(weapon, modSlots = []) {
  const equipped = new Set((modSlots ?? []).filter(Boolean).map(s => s.name));
  const modes = weapon.fire_modes.map(m => ({ ...m }));
  const byName = new Map(modes.map(m => [m.mode_name, m]));
  const resolving = new Set();
  const share = mode => {
    if (!mode.firing_action_mode || resolving.has(mode)) return;
    const parent = byName.get(mode.firing_action_mode);
    if (!parent || parent === mode) return;
    resolving.add(mode);
    share(parent);
    for (const f of FIRING_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(parent, f)) mode[f] = parent[f];
      else delete mode[f];
    }
    resolving.delete(mode);
  };
  modes.forEach(share);
  for (const mode of modes) {
    const fr = Number(mode.fire_rate);
    const charge = Number(mode.charge_time);
    if (weapon.name === 'Lanka' && charge > 0) { mode.fire_rate = 1 / charge; continue; }
    const explicit = mode.effective_fire_rate;
    const hasExplicit = explicit !== null && explicit !== undefined && explicit !== '' && Number.isFinite(Number(explicit)) && Number(explicit) >= 0;
    if (Number.isFinite(fr) && fr > 0 && !hasExplicit && Number.isFinite(charge) && charge >= 0 && mode.charge_time != null) mode.chargeFallback = true;
  }
  return modes.filter(m => m.mode_name !== 'Heavy Attack' && m.mode_name !== 'Slide Attack'
    && (!m.required_mod || equipped.has(m.required_mod))
    && !(weapon.name === 'Battacor' && equipped.has('Sentient Barrage') && m.mode_name === 'Secondary Fire AoE'));
}

/**
 * Condition Overload's factor for a mode, in percent (data.co_data; 100 when not listed). Where the data gives a
 * reference base damage, the factor is that reference over the mode's base damage.
 */
function coFactorOf(data, weapon, mode) {
  const entry = (data?.co_data ?? []).find(d => d.weapon_name === weapon.name && d.fire_mode_name === mode.mode_name);
  if (!entry) return 100;
  if (Number.isFinite(entry.reference_base_damage)) {
    const damage = Number(mode.base_damage);
    return damage > 0 ? 100 * entry.reference_base_damage / damage : 0;
  }
  const v = parseFloat(entry.co_factor);
  return Number.isFinite(v) ? v : 100;
}

/**
 * Heat patches the game scripts rather than shoots: Penta's Napalm Grenades fire patch (100 Heat, always a Heat
 * status) and Ogris's Nightwatch Napalm linger (5% of the rocket's explosion per augment rank).
 */
function applyScriptedHeatFields(weapon, modSlots, modes, progenitor) {
  const nightwatchWeapon = ['Ogris', 'Kuva Ogris'].includes(weapon?.name);
  const pentaWeapon = ['Penta', 'Secura Penta', 'Carmine Penta'].includes(weapon?.name);
  if (!nightwatchWeapon && !pentaWeapon) return;
  const radial = modes.find(m => m.mode_name === 'Rocket Explosion');
  const nightwatch = (modSlots ?? []).find(s => s?.name === 'Nightwatch Napalm');
  // Ranks of the augment; without it the site assumes all 6.
  const ranks = nightwatch ? Math.min(6, Math.max(1, Math.floor(Number(nightwatch.rank) || 0) + 1)) : 6;
  for (const mode of modes) {
    const isLinger = nightwatchWeapon && mode.mode_name === 'Nightwatch Napalm Linger';
    const isPatch = pentaWeapon && mode.mode_name === 'Napalm Grenades Fire Patch Entry';
    if (!isLinger && !isPatch) continue;
    // The rocket's 500 embed damage, scaled like the explosion's base (Progenitor) and by its damage mods.
    const rocket = weapon.fire_modes.find(m => m.mode_name === 'Rocket Explosion');
    const ownBase = Object.values(rocket?.innate_elements ?? {}).reduce((a, b) => a + b, 0) || Number(rocket?.base_damage) || 0;
    const baseScale = rocket && Number(rocket.base_damage) > 0
      ? ownBase * (1 + (progenitorFor(weapon, progenitor) ? Number(progenitor.value) / 100 : 0)) / Number(rocket.base_damage) : 1;
    const embed = radial ? 500 * baseScale * radial.meleeDamageModMultiplier : 0;
    const amount = isLinger ? Math.max(0, Math.trunc(embed * 0.05 * ranks)) : 100;
    const chance = isLinger ? 70 : 100;
    Object.assign(mode, {
      scriptedHeatField: true,
      ...(isPatch ? { scriptedHeatFieldWeaponSource: false, statusDamageWeaponModBonus: 0, statusDamageBonus: 0 } : {}),
      finalDamageTypes: { Heat: amount }, totalFinalDamage: amount,
      finalCritChance: 0, baseCritChance: 0, finalCritMultiplier: 1, baseCritMultiplier: 1,
      finalStatusChance: chance, baseStatusChance: chance, simulationPerProjectileStatusChance: chance,
      displayStatusChance: chance, perProjectileStatusChance: chance,
      finalStatusDuration: isLinger ? Math.max(0, mode.finalStatusDuration * 0.5) : 6,
      finalRange: isLinger ? Math.max(0, (radial?.finalRange || 0) * 0.15 * ranks) : 3,
      finalBlastRadius: isLinger ? Math.max(0, (radial?.finalRange || 0) * 0.15 * ranks) : 3,
      forced_procs: isLinger ? [] : ['Heat'],
      conditionOverload: 0, co_factor: 0, incarnonBaseDamageBonus: 0, primaryCompressionMultiplicativeDamageMultiplier: 1,
      simulationAdditiveDamageBonus: 0, nonCritDamageMultiplier: 0, weakPointDamage: 0, falloff: null,
    });
    if (isLinger && radial) mode.finalMultishot = radial.finalMultishot;
  }
}

/** Fire modes a player picks directly; child modes (e.g. an AoE that follows a hit) run with their parent. */
export function selectableModes(weapon) {
  const children = new Set(weapon.fire_modes.flatMap(m => m.child_mode ?? []));
  return weapon.fire_modes.filter(m => !children.has(m.mode_name));
}
