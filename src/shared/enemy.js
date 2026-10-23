// Warframe enemy level scaling (post-Update 36 curves) applied to a preset's base stats.
import { resolveFaction } from './factions.js';

export const STEEL_PATH_MULTIPLIER = 2.5;
const SQRT5 = Math.sqrt(5);

const smoothstep = t => {
  const c = Math.min(1, Math.max(0, t));
  return 3 * c * c - 2 * c * c * c;
};

// Blend from the low-level curve to the high-level curve over [from, from + 10] levels above base.
const blend = (d, from, f1, f2) => (d < from ? f1 : d > from + 10 ? f2 : f1 * (1 - smoothstep((d - from) / 10)) + f2 * smoothstep((d - from) / 10));

const HEALTH = {
  corrupted: [0.015, 2.10, 24, 0.685],
  grineer: [0.015, 2.12, 24, 0.72],
  corpus: [0.015, 2.12, 30, 0.55],
  infested: [0.0225, 2.12, 36, 0.72],
  techrot: [0.015, 2.10, 30.5, 0.72],
  sentient: [0.015, 2, 24, 0.5],
};

const SHIELDS = {
  corpus: [1.76, 2, 0.76],
  corrupted: [1.75, 2, 0.75],
  grineer: [1.75, 1.6, 0.75],
  techrot: [1.76, 3.4106, 0.76],
  infested: [1.76, 2, 0.76],
  sentient: [1.76, 2, 0.76],
};

export function healthMultiplier(scaling, d) {
  const [a, p1, b, p2] = HEALTH[scaling] ?? HEALTH.sentient;
  return blend(d, 70, 1 + a * d ** p1, 1 + (b * SQRT5 / 5) * d ** p2);
}

export function armorMultiplier(d) {
  return blend(d, 70, 1 + 0.005 * d ** 1.75, 1 + 0.4 * d ** 0.75);
}

export function shieldMultiplier(scaling, d) {
  const [p1, b, p2] = SHIELDS[scaling] ?? SHIELDS.sentient;
  return blend(d, 70, 1 + 0.02 * d ** p1, 1 + b * d ** p2);
}

export function overguardAmount(level, baseOverguard) {
  const L = Math.max(0, level);
  const low = 1 + 0.0015 * L ** 4;
  const high = 1 + 260 * L ** 0.9;
  if (L < 45) return baseOverguard * low;
  if (L > 50) return baseOverguard * high;
  const s = smoothstep((L - 45) / 5);
  return baseOverguard * (low * (1 - s) + high * s);
}

/**
 * Scale an enemy preset ({base_hp, base_armor, base_shields, base_overguard, base_level, faction})
 * to a level. Armor is clamped to the game's 200..2700 window when the enemy has armor at all.
 */
export function scaleEnemy(preset, { level, steelPath = false } = {}) {
  const faction = resolveFaction(preset.faction);
  const lvl = Math.max(1, Math.round(level ?? preset.default_level ?? 1));
  const d = Math.max(0, lvl - Math.max(0, Math.floor(preset.base_level ?? 0)));
  const sp = steelPath ? STEEL_PATH_MULTIPLIER : 1;
  const baseArmor = Number(preset.base_armor) || 0;
  const baseOverguard = Number(preset.base_overguard) || 0;
  return {
    faction: faction.name,
    level: lvl,
    hp: Math.round((Number(preset.base_hp) || 0) * sp * healthMultiplier(faction.scaling, d)),
    armor: baseArmor > 0 ? Math.round(Math.min(2700, Math.max(200, baseArmor * armorMultiplier(d)))) : 0,
    shields: Math.round((Number(preset.base_shields) || 0) * sp * shieldMultiplier(faction.scaling, d)),
    overguard: baseOverguard > 0 ? Math.round(overguardAmount(lvl, baseOverguard)) : 0,
  };
}
