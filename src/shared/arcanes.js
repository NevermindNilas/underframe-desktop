// Weapon arcanes: which fit a gun, what they do at a rank, and how their effects reach the Underframe engine.
//
// The engine's contract (checked against core/engine with node probes):
// - build.arcanes is an array of arcane NAMES (strings); objects are a JSON type error.
// - Stat buffs are not applied by the engine from the name. The caller folds them into weaponStats
//   (direct hits) and also sends them as conditionalStats, whose `damage` drives DoT ticks.
// - A few effects live in conditionalStats fields: sharpshotBonus, randomStatusChance, debilitateProcChance,
//   enervateCritChanceBonus, shiverCOBonus, overguardDamageMultiplier, externalHeadshotMultiplierBonus.
// - The engine reads a few names itself: Primary/Secondary Deadhead (+30% headshot multiplier),
//   Cascadia Empowered (+750 per status), Secondary Cryogenic, Secondary Irradiate.
// - With appStateRef, a top-level `conditionalStats` replaces the cached app state's one.

export const ARCANE_MAX_RANK = 5;

/** Status element an arcane's stacks come from; without it the stacks never build. */
export const ARCANE_ELEMENT_REQUIREMENTS = Object.freeze({
  'Primary Frostbite': 'Cold',
  'Primary Blight': 'Toxin',
  'Cascadia Flare': 'Heat',
  'Conjunction Voltage': 'Electricity',
});

// Additive stat buckets of stats.js collectModifiers(), by conditional buff type.
const STAT_BUCKETS = Object.freeze({
  Damage: 'damage',
  Multishot: 'multishot',
  'Critical Chance': 'critChance',
  'Critical Damage': 'critDamage',
  'Status Chance': 'statusChance',
  'Fire Rate': 'fireRate',
  'Reload Speed': 'reload',
  'Ammo Efficiency': 'ammoEfficiency',
});

// The same buckets under the engine's conditionalStats names.
const CONDITIONAL_STAT_NAMES = Object.freeze({
  damage: 'damage', multishot: 'multishot', critChance: 'critChance', critDamage: 'critDamage',
  statusChance: 'statusChance', fireRate: 'fireRate', reload: 'reload', ammoEfficiency: 'ammoEfficiency',
});

// Effects the engine models itself, given a value in conditionalStats.
const ENGINE_FIELDS = Object.freeze({
  'Sharpshot Bonus': { field: 'sharpshotBonus' },
  'Random Status Chance': { field: 'randomStatusChance' },
  'Debilitate Proc Chance': { field: 'debilitateProcChance' },
  'Enervate Crit Chance Bonus': { field: 'enervateCritChanceBonus' },
  'Shiver CO Bonus': { field: 'shiverCOBonus' },
  // A multiplier (x8 at max rank): the rank scales the part above x1.
  'Overguard Damage Multiplier': { field: 'overguardDamageMultiplier', multiplier: true },
});

/** Arcanes the engine recognises by name. `scalesWithRank: false`: the engine always uses the max-rank value. */
const ENGINE_NAMED = Object.freeze({
  'Primary Deadhead': { headshotBonus: 0.3 },
  'Secondary Deadhead': { headshotBonus: 0.3 },
  'Cascadia Empowered': { scalesWithRank: false },
  'Secondary Cryogenic': { scalesWithRank: false },
  'Secondary Irradiate': { scalesWithRank: false, singleTarget: false },
});

// Effects underframe.site keeps always on (no toggle in its conditionals panel).
const ALWAYS_ON = new Set(['Secondary Fortifier', 'Secondary Shiver', 'Secondary Encumber', 'Primary Debilitate', 'Cascadia Empowered']);

const KITGUN_ARCANE = /^(Pax|Residual) /;

const isKitgun = weapon => Boolean(weapon?.is_modular) && ['Primary', 'Secondary'].includes(weapon?.type) && weapon?.subtype !== 'Zaw';

/** Arcane slots a gun has: one, plus a Kitgun slot (Pax / Residual arcanes) on kitguns, as in the arsenal. */
export function arcaneSlotCount(weapon) {
  if (!weapon || !['Primary', 'Secondary'].includes(weapon.type)) return 0;
  return isKitgun(weapon) ? 2 : 1;
}

/** 'Primary', 'Secondary' or, for a kitgun's second slot, 'Kitgun'. */
export function arcaneSlotCategory(weapon, slot = 0) {
  return slot === 1 && isKitgun(weapon) ? 'Kitgun' : weapon?.type ?? null;
}

const indexCache = new WeakMap();

/** Arcane lookup built once per data.json object. */
export function indexArcanes(data) {
  if (data && indexCache.has(data)) return indexCache.get(data);
  const effects = new Map((data?.conditionals?.arcanes ?? []).map(c => [c.name, c]));
  const byName = new Map();
  for (const a of data?.arcanes ?? []) {
    const name = a.arcane_name;
    if (typeof name !== 'string' || !name) continue;
    byName.set(name, {
      name,
      description: cleanDescription(a.max_rank_description),
      imageUrl: a.image_url ?? null,
      nativeCompat: Array.isArray(a.native_item_compatibility) ? a.native_item_compatibility : null,
      effect: effects.get(name) ?? null,
    });
  }
  const index = { byName };
  if (data) indexCache.set(data, index);
  return index;
}

/** "On \nCold Status Effect:\n+3%..." -> "On Cold Status Effect: +3%..." */
function cleanDescription(text) {
  return String(text ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([:.,])/g, '$1').trim();
}

/** Highest rank of an arcane. Pax (kitgun) arcanes stop at 3; the rest at 5. */
export function arcaneMaxRank(name, data = null) {
  const declared = Number(data ? indexArcanes(data).byName.get(name)?.effect?.rank : NaN);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return /^Pax /.test(String(name)) ? 3 : ARCANE_MAX_RANK;
}

/** Whether an arcane may sit in a gun's arcane slot. */
export function isArcaneCompatible(name, weapon, data, slot = 0) {
  const info = indexArcanes(data).byName.get(name);
  if (!info || !weapon || slot < 0 || slot >= arcaneSlotCount(weapon)) return false;
  const category = arcaneSlotCategory(weapon, slot);
  if (category === 'Kitgun') return KITGUN_ARCANE.test(name);
  // Arcanes tied to a weapon class (Akimbo Slip Shot, Longbow Sharpshot, Shotgun Vendetta, Primary Plated Round)
  // list the classes they fit, in the same paths as the weapon's mod compatibility. A class arcane also fits
  // its subtype (any Bow takes Longbow Sharpshot), as on underframe.site.
  if (info.nativeCompat) {
    const types = new Set(weapon.mod_compatibility_types ?? []);
    const other = category === 'Primary' ? 'Secondary' : 'Primary';
    const fits = info.nativeCompat.some(t => types.has(t)) || (Boolean(info.effect?.type) && info.effect.type === weapon.subtype);
    return fits && !name.startsWith(`${other} `) && info.effect?.type !== other;
  }
  if (name.startsWith(`${category} `)) return true;
  const type = info.effect?.type;
  return Boolean(type) && (type === category || type === weapon.subtype);
}

/** Every buff an arcane carries, its stacking and whether it is passive. */
function buffsOf(effect) {
  if (!effect) return [];
  const out = [];
  if (effect.details) {
    const d = effect.details;
    const list = d.bonuses ? d.bonuses.map(b => ({ ...b, type: b.type, max_stacks: d.max_stacks })) : [{ ...d, type: d.bonus_type ?? d.type }];
    // A per-point bonus with a cap ("+1% Multishot per point, up to +350%": Primary Overcharge) is a percentage
    // cap, not a stack count: `cap` marks it so the UI speaks in percent.
    for (const b of list) {
      const maxStacks = Number(b.max_stacks) || 1;
      out.push({ type: b.type, value: b.bonus_per_rank ?? b.value ?? 0, maxStacks, passive: false, cap: b.bonus_per_rank != null && maxStacks > 1 });
    }
  } else {
    for (const b of effect.buffs ?? []) out.push({ type: b.type, value: Number(b.value) || 0, maxStacks: Number(b.max_stacks) || 1, element: b.element, passive: false });
  }
  for (const b of effect.non_conditional_buffs ?? []) out.push({ type: b.type, value: Number(b.value) || 0, maxStacks: 1, passive: true });
  return out;
}

/** The arcane's stack count control: the first conditional buff's max stacks, as underframe.site shows it. */
function maxStacksOf(effect) {
  const first = effect?.details ?? effect?.buffs?.[0];
  return Number(first?.max_stacks) || 1;
}

/**
 * How well the engine models an arcane.
 * - 'full': every effect is simulated.
 * - 'partial': some of it is (the note says what is not).
 * - 'none': nothing is simulated.
 */
export function arcaneSupport(name, data) {
  const info = indexArcanes(data).byName.get(name);
  if (!info) return { level: 'none', note: 'Unknown arcane.' };
  const named = ENGINE_NAMED[name];
  if (named?.singleTarget === false) return { level: 'partial', note: 'Its splash hits other enemies, so a single-target simulation shows no gain.' };
  const buffs = buffsOf(info.effect);
  const unknown = buffs.filter(b => !STAT_BUCKETS[b.type] && !ENGINE_FIELDS[b.type] && !(b.type === 'Deadhead' && named) && !(named && b.type === 'Cascadia Empowered Proc'));
  if (!buffs.length && !named) return { level: 'none', note: 'Its effect is not simulated.' };
  const partial = [];
  if (unknown.length) partial.push(`${unknown.map(b => b.type).join(', ')} is not simulated`);
  if (named?.scalesWithRank === false) partial.push('the engine always uses its max-rank value');
  if (unknown.length && unknown.length === buffs.length && !named) return { level: 'none', note: 'Its effect is not simulated.' };
  return partial.length ? { level: 'partial', note: `${capitalise(partial.join('; '))}.` } : { level: 'full', note: '' };
}

const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Controls an arcane offers in the UI.
 * - stacks: { max, default } for stacking or toggled conditions (max 1 = an on/off toggle), or null when always on.
 * - startingStacks: Secondary Enervate's starting stacks (0-20), or null.
 * - trigger: the condition text ("On Kill").
 */
export function arcaneControls(name, data) {
  const effect = indexArcanes(data).byName.get(name)?.effect ?? null;
  const conditional = buffsOf(effect).some(b => !b.passive && (STAT_BUCKETS[b.type] || ENGINE_FIELDS[b.type]));
  const max = maxStacksOf(effect);
  const capped = buffsOf(effect).find(b => b.cap && !b.passive);
  return {
    stacks: effect && conditional && !ALWAYS_ON.has(name) ? { max, default: max } : null,
    startingStacks: name === 'Secondary Enervate' ? { min: 0, max: 20, default: 0 } : null,
    trigger: effect?.trigger ?? null,
    // The stack control of a percentage cap counts points of `type` bonus (each worth `perStack`), not stacks.
    ...(capped ? { cap: { type: capped.type, label: BUFF_LABELS[capped.type] ?? capped.type, perStack: capped.value } } : {}),
  };
}

/**
 * What the arcane slot's badge says about the assumed uptime: "12 stacks", "Active" / "Inactive" for a toggle,
 * or for a percentage cap the bonus itself at this rank ("+350% Multishot"), never "350 stacks".
 */
export function arcaneStacksText(name, data, stacks, rank = null) {
  const c = arcaneControls(name, data);
  if (!c.stacks) return null;
  const n = Number.isFinite(Number(stacks)) ? Number(stacks) : c.stacks.default;
  if (c.cap) return `+${pct(n * c.cap.perStack * rankFactor(name, data, rank))} ${c.cap.label}`;
  if (c.stacks.max === 1) return n ? 'Active' : 'Inactive';
  return `${n} ${n === 1 ? 'stack' : 'stacks'}`;
}

/** Options for a freshly equipped arcane: max stacks, as underframe.site does when you equip one. */
export function defaultArcaneOptions(name, data) {
  const c = arcaneControls(name, data);
  return {
    ...(c.stacks ? { stacks: c.stacks.default } : {}),
    ...(c.startingStacks ? { startingStacks: c.startingStacks.default } : {}),
  };
}

/** Clamp an arcane entry's rank and options to what it supports. */
export function normalizeArcaneEntry(entry, data) {
  const name = typeof entry === 'string' ? entry : entry?.name;
  if (typeof name !== 'string' || !indexArcanes(data).byName.has(name)) return null;
  const max = arcaneMaxRank(name, data);
  const rawRank = typeof entry === 'object' ? Number(entry.rank) : NaN;
  const rank = Number.isFinite(rawRank) ? Math.min(max, Math.max(0, Math.round(rawRank))) : max;
  const c = arcaneControls(name, data);
  const given = typeof entry === 'object' && entry.options && typeof entry.options === 'object' ? entry.options : {};
  const options = {};
  if (c.stacks) {
    const s = Number(given.stacks);
    options.stacks = Number.isFinite(s) ? Math.min(c.stacks.max, Math.max(0, Math.round(s))) : c.stacks.default;
  }
  if (c.startingStacks) {
    const s = Number(given.startingStacks);
    options.startingStacks = Number.isFinite(s) ? Math.min(c.startingStacks.max, Math.max(c.startingStacks.min, Math.round(s))) : c.startingStacks.default;
  }
  return Object.keys(options).length ? { name, rank, options } : { name, rank };
}

const PERCENT_TYPES = new Set([...Object.keys(STAT_BUCKETS), 'Random Status Chance', 'Debilitate Proc Chance', 'Enervate Crit Chance Bonus', 'Shiver CO Bonus', 'Sharpshot Bonus']);
const BUFF_LABELS = {
  'Random Status Chance': 'chance of a second random status',
  'Debilitate Proc Chance': 'chance to apply a component status',
  'Enervate Crit Chance Bonus': 'Critical Chance per hit',
  'Shiver CO Bonus': 'damage per Cold status',
  'Sharpshot Bonus': 'damage on the next shot',
  'Overguard Damage Multiplier': 'damage to Overguard',
  Deadhead: 'Headshot Multiplier',
};
const pct = v => `${Math.round(v * 1000) / 10}%`.replace('.0%', '%');

/** A short line of what an arcane gives at a rank, e.g. "+360% Damage (12 stacks), +30% Reload Speed". */
export function arcaneSummary(name, data, rank = null) {
  const info = indexArcanes(data).byName.get(name);
  if (!info) return '';
  const buffs = buffsOf(info.effect);
  const known = b => STAT_BUCKETS[b.type] || ENGINE_FIELDS[b.type] || b.type === 'Deadhead' || b.type === 'Cascadia Empowered Proc';
  if (!buffs.length || !buffs.every(known)) return info.description;
  const f = rankFactor(name, data, rank);
  const parts = buffs.map(b => {
    const label = BUFF_LABELS[b.type] ?? b.type;
    if (b.type === 'Deadhead') return `+${pct((b.value - 1) * f)} ${label}`;
    if (b.type === 'Overguard Damage Multiplier') return `x${Math.round((1 + (b.value - 1) * f) * 100) / 100} ${label}`;
    if (b.type === 'Cascadia Empowered Proc') return `+${b.value} damage per status effect`;
    const total = b.value * b.maxStacks * f;
    const value = PERCENT_TYPES.has(b.type) ? `+${pct(total)}` : `+${Math.round(total * 100) / 100}`;
    return `${value} ${label}${b.cap ? ' (at most)' : b.maxStacks > 1 ? ` (${b.maxStacks} stacks)` : ''}${b.passive ? ' (passive)' : ''}`;
  });
  return parts.join(', ');
}

/** Rank scale: in-game arcane values grow linearly, rank r of R giving (r + 1) / (R + 1) of the max-rank value. */
export function rankFactor(name, data, rank = null) {
  const max = arcaneMaxRank(name, data);
  const r = rank == null || !Number.isFinite(Number(rank)) ? max : Math.min(max, Math.max(0, Number(rank)));
  return (r + 1) / (max + 1);
}

/**
 * Arcanes a gun's arcane slot accepts, sorted by name, with what the UI shows for each.
 * @returns {Array<{ name, maxRank, summary, description, imageUrl, requires: string|null,
 *   support: 'full'|'partial'|'none', supportNote: string, controls: object }>}
 */
export function arcanesFor(weapon, data, slot = 0) {
  const out = [];
  for (const info of indexArcanes(data).byName.values()) {
    if (!isArcaneCompatible(info.name, weapon, data, slot)) continue;
    const support = arcaneSupport(info.name, data);
    out.push({
      name: info.name,
      maxRank: arcaneMaxRank(info.name, data),
      summary: arcaneSummary(info.name, data),
      description: info.description,
      imageUrl: info.imageUrl,
      requires: ARCANE_ELEMENT_REQUIREMENTS[info.name] ?? null,
      support: support.level,
      supportNote: support.note,
      controls: arcaneControls(info.name, data),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a build's arcanes (`[{name, rank, options?}]`, nulls allowed) into their effects on a weapon.
 * Pass the result to computeWeaponStats({ arcanes }) and buildEngineInput({ arcanes }).
 * Arcanes that do not fit the weapon are ignored and reported in `notes`.
 * @returns {{ entries: object[], engineNames: string[], headshotBonus: number,
 *   startingStacks: number|null, notes: Array<{ name, level, text }> }}
 */
export function resolveArcanes(arcanes, weapon, data) {
  const entries = [];
  const engineNames = [];
  const notes = [];
  let headshotBonus = 0;
  let startingStacks = null;
  (Array.isArray(arcanes) ? arcanes : []).forEach((raw, slot) => {
    const a = normalizeArcaneEntry(raw, data);
    if (!a) {
      if (raw) notes.push({ name: String(raw?.name ?? raw), level: 'none', text: 'Unknown arcane; ignored.' });
      return;
    }
    if (!isArcaneCompatible(a.name, weapon, data, slot)) {
      notes.push({ name: a.name, level: 'none', text: `Does not fit ${weapon?.name ?? 'this weapon'}; ignored.` });
      return;
    }
    const info = indexArcanes(data).byName.get(a.name);
    const f = rankFactor(a.name, data, a.rank);
    const maxRank = arcaneMaxRank(a.name, data);
    const named = ENGINE_NAMED[a.name];
    const stacks = a.options?.stacks;
    const stats = {};
    const fields = {};
    for (const b of buffsOf(info.effect)) {
      // Stacks apply to conditional buffs; a one-stack buff is on unless its toggle is off.
      const n = b.passive || ALWAYS_ON.has(a.name) ? 1 : b.maxStacks > 1 ? Math.min(b.maxStacks, stacks ?? b.maxStacks) : (stacks ?? 1) > 0 ? 1 : 0;
      if (!n) continue;
      if (STAT_BUCKETS[b.type]) {
        const k = STAT_BUCKETS[b.type];
        stats[k] = (stats[k] ?? 0) + b.value * n * f;
      } else if (ENGINE_FIELDS[b.type]) {
        const { field, multiplier } = ENGINE_FIELDS[b.type];
        fields[field] = multiplier ? 1 + (b.value - 1) * f : (fields[field] ?? 0) + b.value * n * f;
      }
    }
    if (named?.headshotBonus) {
      // The engine adds Deadhead's max-rank +30% by name; below max rank send the scaled bonus instead.
      if (a.rank >= maxRank) engineNames.push(a.name);
      else headshotBonus += named.headshotBonus * f;
    } else {
      engineNames.push(a.name);
    }
    if (a.name === 'Secondary Enervate') startingStacks = a.options?.startingStacks ?? 0;
    const support = arcaneSupport(a.name, data);
    if (support.level !== 'full') notes.push({ name: a.name, level: support.level, text: support.note });
    entries.push({ ...a, slot, requires: ARCANE_ELEMENT_REQUIREMENTS[a.name] ?? null, stats, fields });
  });
  return { entries, engineNames, headshotBonus, startingStacks, notes };
}

/**
 * Arcanes whose element need a status already on the target meets as well (external statuses). underframe.site
 * counts a Cold status for Primary Frostbite only.
 */
const STATUS_MEETS_REQUIREMENT = Object.freeze({ 'Primary Frostbite': 'Cold' });

/**
 * Whether an element-gated arcane builds stacks: its element is among the fire mode's final damage types, or (Primary
 * Frostbite) the target starts with that status (`externalStatuses`: [{ type, stacks }]).
 */
export function arcaneRequirementMet(name, finalDamageTypes, externalStatuses = null) {
  const need = ARCANE_ELEMENT_REQUIREMENTS[name];
  if (!need) return true;
  if ((finalDamageTypes?.[need] ?? 0) > 0) return true;
  const status = STATUS_MEETS_REQUIREMENT[name];
  return Boolean(status && (externalStatuses ?? []).some(s => s?.type === status && Number(s.stacks) > 0));
}

const meetsRequirement = (entry, finalDamageTypes, externalStatuses) => !entry.requires || arcaneRequirementMet(entry.name, finalDamageTypes, externalStatuses);

/** Additive stat bonuses (stats.js modifier buckets) for a fire mode with these final damage types (and target statuses). */
export function arcaneModifiersFor(resolved, finalDamageTypes, externalStatuses = null) {
  const out = {};
  for (const e of resolved?.entries ?? []) {
    if (!meetsRequirement(e, finalDamageTypes, externalStatuses)) continue;
    for (const [k, v] of Object.entries(e.stats)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/**
 * The engine's conditionalStats for a fire mode, holding only non-default fields, or null when there are none.
 * Stat buckets go in too (as underframe.site sends them): `damage` scales DoT ticks.
 */
export function arcaneConditionalStats(resolved, finalDamageTypes, externalStatuses = null) {
  const cs = {};
  const stats = arcaneModifiersFor(resolved, finalDamageTypes, externalStatuses);
  for (const [k, v] of Object.entries(stats)) if (v) cs[CONDITIONAL_STAT_NAMES[k]] = v;
  for (const e of resolved?.entries ?? []) {
    if (!meetsRequirement(e, finalDamageTypes, externalStatuses)) continue;
    for (const [k, v] of Object.entries(e.fields)) cs[k] = k === 'overguardDamageMultiplier' ? Math.max(cs[k] ?? 1, v) : (cs[k] ?? 0) + v;
  }
  if (resolved?.headshotBonus) cs.externalHeadshotMultiplierBonus = resolved.headshotBonus;
  return Object.keys(cs).length ? cs : null;
}

/**
 * Honesty notes for the result card: arcanes not (fully) simulated, and element arcanes whose stacks
 * cannot build because the fire mode deals none of their element.
 * @returns {Array<{ name, level: 'none'|'partial'|'inactive', text }>}
 */
export function arcaneNotes(resolved, finalDamageTypes, externalStatuses = null) {
  const out = [...(resolved?.notes ?? [])];
  for (const e of resolved?.entries ?? []) {
    if (!meetsRequirement(e, finalDamageTypes, externalStatuses)) out.push({ name: e.name, level: 'inactive', text: `Needs ${e.requires} damage to build stacks; this fire mode has none, so it adds nothing.` });
  }
  return out;
}

/** Names of equipped arcanes the simulation does not model at all. */
export function unsimulatedArcanes(resolved) {
  return (resolved?.notes ?? []).filter(n => n.level === 'none').map(n => n.name);
}
