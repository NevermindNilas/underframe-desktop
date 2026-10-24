// Conditional mods (Galvanized mods, "when aiming" mods, weapon augments that stack on hit or kill): what their
// conditional part adds at the stacks a build assumes, ported from underframe.site's conditionals panel.
//
// The data lists them in data.conditionals.galvanized_mods and misc_mods. A mod's base stats (Galvanized Chamber's
// +80% Multishot) are ordinary mod stats; this module adds only the conditional part (+30% Multishot per stack, up to
// 5). As on the site:
// - a freshly equipped conditional mod is on at max stacks; a slot stores `stacks` only when it is below max;
// - a stack is worth bonus_per_rank * (rank + 1) (or `value`), times the stacks; a one-stack buff is on or off;
// - the result is reduced into the same totals as external buffs (external-buffs.js), so it reaches weaponStats and
//   the engine's conditionalStats the same way. Condition Overload goes into weaponStats.conditionOverload, the
//   field the engine reads per status type on the target.
import { emptyExternalTotals } from './external-buffs.js';

const indexCache = new WeakMap();

/** Conditional entries by mod name (one mod can have several, e.g. Sentient Surge's crit and status). */
export function indexConditionalMods(data) {
  if (data && indexCache.has(data)) return indexCache.get(data);
  const byName = new Map();
  for (const c of [...(data?.conditionals?.galvanized_mods ?? []), ...(data?.conditionals?.misc_mods ?? [])]) {
    if (!c || typeof c.name !== 'string') continue;
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  if (data) indexCache.set(data, byName);
  return byName;
}

/** The stacking buffs of one entry, each with its own max stacks. */
function conditionalBuffs(entry) {
  const d = entry?.details;
  if (d?.bonuses) return d.bonuses.map(b => ({ ...b, bonus_type: b.type, max_stacks: d.max_stacks || 1 }));
  if (d) return [d];
  return Array.isArray(entry?.buffs) ? entry.buffs : [];
}

const maxStacksOf = buff => Math.max(1, Number(buff?.max_stacks) || 1);

// Bonus types with no effect on a gun's DPS in this app's simulation (melee, throws, travel time).
const NO_DPS_EFFECT = new Set(['Projectile Speed', 'WEAPON_PROJECTILE_SPEED', 'Initial Combo', 'Power Throw Stat', 'Recoil', 'WEAPON_RECOIL']);
// Additive totals by bonus type.
const SUM = Object.freeze({
  Multishot: 'multishot',
  'Aiming Critical Damage': 'critDamage',
  'Critical Damage': 'critDamage',
  'Status Chance': 'statusChance',
  'Status Damage': 'statusDamage',
  'Flat Status Chance': 'flatStatusChance',
  'Reload Speed': 'reload',
  'Punch Through': 'punchThrough',
  WEAPON_PUNCTURE_DEPTH: 'punchThrough',
  'Condition Overload Stat': 'conditionOverload',
  WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE: 'conditionOverload',
  'Weak Point Damage': 'weakPointDamage',
  'Weak Point Critical Chance': 'weakPointCritChance',
  'Magazine Size': 'magazine',
  'Flat Critical Damage': 'flatCritDamage',
  'Flat Critical Chance': 'flatCritChance',
  'Headshot Critical Chance': 'headshotCritChance',
  'Headshot Instant Reload Chance': 'headshotInstantReloadChance',
  'External Headshot Multiplier': 'externalHeadshotMultiplierBonus',
  'Follow Through': 'followThrough',
  WEAPON_EXPLOSION_RADIUS: 'blastRadius',
  'Blast Radius': 'blastRadius',
  'Viral Damage': 'viralDamage',
  'Magnetic Damage': 'magneticDamage',
  'Gas Damage': 'gasDamage',
  'Toxin Damage': 'toxinDamage',
  'Heat Damage': 'heatDamage',
});
const GRAKATAS = new Set(['Grakata', 'Prisma Grakata']);

/**
 * What a mod's conditional part offers in the UI, or null for a mod without one (or one whose conditional part does
 * nothing for guns' DPS here, such as Galvanized Acceleration).
 * @returns {{ max: number, trigger: string|null, condition: string|null, effect: string } | null}
 */
export function modConditionalControls(name, data) {
  const entries = indexConditionalMods(data).get(name);
  if (!entries) return null;
  const buffs = entries.flatMap(conditionalBuffs).filter(b => !NO_DPS_EFFECT.has(b.bonus_type ?? b.type));
  if (!buffs.length) return null;
  const first = entries.find(e => e.details) ?? entries[0];
  return {
    max: Math.max(...buffs.map(maxStacksOf)),
    trigger: first?.details?.trigger ?? null,
    condition: first?.details?.condition ?? null,
    effect: entries.map(e => e.effect).filter(Boolean).join(' '),
  };
}

/** Stacks a slot assumes: its own `stacks`, else max (as the site does on equip). Null for a mod without a conditional. */
export function modStacksOf(slot, data) {
  const c = slot ? modConditionalControls(slot.name, data) : null;
  if (!c) return null;
  const s = Number(slot.stacks);
  return Number.isFinite(s) ? Math.min(c.max, Math.max(0, Math.round(s))) : c.max;
}

/** A slot with its stacks set: `stacks` is kept only below max (max is the default), and only on conditional mods. */
export function withModStacks(slot, stacks, data) {
  if (!slot) return slot;
  const { stacks: _old, ...rest } = slot;
  const c = modConditionalControls(slot.name, data);
  const s = Number(stacks);
  if (!c || !Number.isFinite(s)) return rest;
  const n = Math.min(c.max, Math.max(0, Math.round(s)));
  return n >= c.max ? rest : { ...rest, stacks: n };
}

/** "5 stacks" / "1 stack", or "On" / "Off" for a one-stack conditional. */
export function modStacksText(slot, data) {
  const c = slot ? modConditionalControls(slot.name, data) : null;
  if (!c) return null;
  const n = modStacksOf(slot, data);
  if (c.max === 1) return n ? 'On' : 'Off';
  return `${n} ${n === 1 ? 'stack' : 'stacks'}`;
}

const LABELS = Object.freeze({
  'Aiming Critical Chance': 'Critical Chance',
  'Aiming Critical Damage': 'Critical Damage',
  'Condition Overload Stat': 'damage per status type on the target',
  WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE: 'damage per status type on the target',
  'Viral Damage': 'Viral',
  'Magnetic Damage': 'Magnetic',
  'Gas Damage': 'Gas',
  'Toxin Damage': 'Toxin',
  'Heat Damage': 'Heat',
  'Unique Enemy Vulnerability Multiplier': 'damage',
});
const pct = v => `${Math.round(v * 1000) / 10}%`.replace('.0%', '%');

/**
 * What a slot's conditional part adds at its rank: per stack and at the stacks it assumes, e.g.
 * { perStack: '+30% Multishot', total: '+150% Multishot' }. Null for a mod without one.
 */
export function modConditionalSummary(slot, data) {
  const c = slot ? modConditionalControls(slot.name, data) : null;
  if (!c) return null;
  const rank = Math.max(0, Number(slot.rank) || 0);
  const stacks = modStacksOf(slot, data);
  const text = (b, n) => {
    const type = b.bonus_type ?? b.type;
    const v = b.bonus_per_rank ? b.bonus_per_rank * (rank + 1) * n : Number(b.value ?? 0) * n;
    if (type === 'Infinite Ammo') return 'infinite ammo';
    if (type === 'Multiplicative Critical Chance') return `×${Math.round((1 + v) * 100) / 100} Critical Chance`;
    if (type === 'Unique Enemy Vulnerability Multiplier' || (type === 'Damage' && slot.name === 'Double Tap')) return `×${Math.round((1 + v) * 100) / 100} damage`;
    if (type === 'Fire Rate' && slot.name === 'Wild Frenzy') return 'fire rate fixed at 80';
    return `+${pct(v)} ${LABELS[type] ?? type}`;
  };
  const buffs = indexConditionalMods(data).get(slot.name).flatMap(conditionalBuffs).filter(b => !NO_DPS_EFFECT.has(b.bonus_type ?? b.type));
  return {
    perStack: buffs.map(b => text(b, 1)).join(', '),
    total: stacks ? buffs.map(b => text(b, maxStacksOf(b) > 1 ? Math.min(maxStacksOf(b), stacks) : 1)).join(', ') : 'nothing',
  };
}

/**
 * The conditional parts of a build's mods, reduced into external-buffs.js totals for one weapon.
 * Pass the result to computeWeaponStats({ conditionals }) and buildEngineInput({ conditionals }).
 * @returns {{ totals: object|null, active: Array<{ slot, name, stacks, max }> }} `totals` is null when nothing adds.
 */
export function resolveModConditionals(modSlots, weapon, data) {
  const totals = emptyExternalTotals();
  const active = [];
  let any = false;
  (Array.isArray(modSlots) ? modSlots : []).forEach((slot, i) => {
    const entries = slot ? indexConditionalMods(data).get(slot.name) : null;
    if (!entries) return;
    const rank = Math.max(0, Number(slot.rank) || 0);
    const controls = modConditionalControls(slot.name, data);
    const stacks = controls ? modStacksOf(slot, data) : 0;
    if (controls) active.push({ slot: i, name: slot.name, stacks, max: controls.max });
    for (const entry of entries) {
      // Always-on parts (Lasting Purity) count whatever the stacks.
      for (const b of entry.non_conditional_buffs ?? []) any = applyConditionalBuff(totals, entry.name, b, 1, rank, weapon) || any;
      if (!stacks) continue;
      for (const b of conditionalBuffs(entry)) {
        const max = maxStacksOf(b);
        any = applyConditionalBuff(totals, entry.name, b, max > 1 ? Math.min(max, stacks) : 1, rank, weapon) || any;
      }
    }
  });
  return { totals: any ? totals : null, active };
}

/** Add one buff at `n` stacks into the totals; true when it changed something. */
export function applyConditionalBuff(t, name, buff, n, rank, weapon) {
  const value = buff.bonus_per_rank ? buff.bonus_per_rank * (rank + 1) * n : Number(buff.value ?? 0) * n;
  const type = buff.bonus_type ?? buff.type;
  if (!value || NO_DPS_EFFECT.has(type)) return false;
  // Sentient Barrage's crit applies to the Battacor's charged shot only (computeFireMode adds it there).
  if (name === 'Sentient Barrage' && weapon?.name === 'Battacor' && /^Critical (Chance|Damage)$/.test(type)) {
    t[type === 'Critical Chance' ? 'sentientBarrageCritChance' : 'sentientBarrageCritDamage'] += value;
    return true;
  }
  if (SUM[type]) { t[SUM[type]] += value; return true; }
  switch (type) {
    case 'Damage':
      // Double Tap multiplies the final damage; the rest add to the damage mods.
      if (name === 'Double Tap') t.finalMultipliers.push(1 + value);
      else t.damage += value;
      return true;
    case 'Aiming Critical Chance':
    case 'Critical Chance':
      if (buff.OperationType === 'ADD') t.flatCritChance += value;
      else t.critChance += value;
      return true;
    case 'Fire Rate':
      // Wild Frenzy sets the Grakata's fire rate to 80 (its own stat), whatever else adds.
      if (name === 'Wild Frenzy' && GRAKATAS.has(weapon?.name)) { t.fireRateOverride = Number(buff.fixed_fire_rate) || 80; t.fireRateOverrideLocked = true; return true; }
      t.fireRate += value;
      return true;
    case 'Multiplicative Critical Chance': t.multiplicativeCritChance *= 1 + value; return true;
    case 'Multiplicative Fire Rate': t.multiplicativeFireRate *= 1 + value; return true;
    case 'Unique Enemy Vulnerability Multiplier': t.finalMultipliers.push(1 + value); return true;
    case 'Infinite Ammo': t.infiniteAmmo = true; return true;
    case 'Ammo Efficiency':
      if (buff.stacking === 'multiplicative') t.ammoEfficiencyMultipliers.push(value);
      else t.ammoEfficiency += value;
      return true;
    default:
      return false;
  }
}
