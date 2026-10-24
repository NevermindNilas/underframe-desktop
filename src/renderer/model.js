// Build, target and result model for the renderer. Pure: no DOM, no window.uf, testable in node.
import { FACTIONS, resolveFaction } from '../shared/factions.js';
import { scaleEnemy } from '../shared/enemy.js';
import { indexMods, isSupportedWeapon, isModCompatible, maxRank, conflictingMod } from '../shared/mods.js';
import { selectableModes } from '../shared/stats.js';
import {
  arcaneSlotCount, arcanesFor, arcaneMaxRank, defaultArcaneOptions, isArcaneCompatible, normalizeArcaneEntry, arcaneSupport,
} from '../shared/arcanes.js';
import { SLOT_POLARITIES, capacityOf, capacityUse, effectiveSlotPolarities, formaCount, innateSlotPolarities } from '../shared/capacity.js';
import { fmtCompact } from './format.js';

export const SLOT_COUNT = 9;
export const EXILUS_SLOT = 8;
/** The arcane slot as a selection target (mod slots are 0-8). */
export const ARCANE_SLOT = 'arcane';
/** A kitgun's second arcane slot (Pax / Residual arcanes), as a selection target. */
export const KITGUN_ARCANE_SLOT = 'arcane-1';
/** The `arcanes[]` index of an arcane slot target ('arcane' 0, 'arcane-1' 1), else -1 (a mod slot or null). */
export const arcaneIndexOf = slot => (slot === ARCANE_SLOT ? 0 : slot === KITGUN_ARCANE_SLOT ? 1 : -1);
/** The selection target of arcane slot `i`. */
export const arcaneSlotId = i => (i === 1 ? KITGUN_ARCANE_SLOT : ARCANE_SLOT);
export const isArcaneSlot = slot => arcaneIndexOf(slot) >= 0;
/** The focus id of arcane slot `i`'s button. */
export const arcaneFocusId = i => (i === 1 ? 'slot-arcane-1-select' : 'slot-arcane-select');
/** General slots in fill order. */
export const GENERAL_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
export const DURATIONS = [10, 30, 60];
export const DEFAULT_DURATION = 30;
export const SIM_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const SWEEP_SEEDS = [1, 2, 3];
export const CUSTOM_PRESET = 'Custom';
export const DEFAULT_WEAPON = 'Braton Prime';
export const DEFAULT_PRESET = 'Elite Crewman';
export const WEAPON_GROUPS = ['Primary', 'Secondary'];

/** Lookup tables built once from data.json. */
export function createContext(data, manifest = null) {
  const weapons = data.weapons.filter(isSupportedWeapon).sort((a, b) => a.name.localeCompare(b.name));
  const ctx = {
    data,
    manifest,
    index: indexMods(data),
    weapons,
    weaponByName: new Map(weapons.map(w => [w.name, w])),
    reloadByName: new Map((data.reload_data ?? []).map(r => [r.name, r])),
    exilus: new Set(data.exilusMods ?? []),
    popular: new Set(data.whitelist ?? []),
    presets: data.dummy_presets ?? {},
    presetNames: Object.keys(data.dummy_presets ?? {}).sort((a, b) => a.localeCompare(b)),
    factionNames: FACTIONS.map(f => f.name),
  };
  ctx.featured = featuredBuilds(ctx);
  return ctx;
}

export const emptySlots = () => Array(SLOT_COUNT).fill(null);
/** Per-slot Forma: null keeps the innate polarity; a code (AP_UNIVERSAL clears it) replaces it. */
export const emptyPolarities = () => Array(SLOT_COUNT).fill(null);

export function defaultWeaponName(ctx) {
  return ctx.weaponByName.has(DEFAULT_WEAPON) ? DEFAULT_WEAPON : ctx.weapons[0]?.name ?? '';
}

export function defaultModeName(weapon) {
  return weapon ? selectableModes(weapon)[0]?.mode_name ?? '' : '';
}

/** Find a preset by name, forgiving case and a plural "-men" for "-man". */
export function resolvePresetName(ctx, name) {
  if (!name) return null;
  if (name === CUSTOM_PRESET) return CUSTOM_PRESET;
  if (ctx.presets[name]) return name;
  const lower = String(name).toLowerCase();
  const tries = [lower, lower.replace(/men$/, 'man'), lower.replace(/s$/, '')];
  for (const t of tries) {
    const hit = ctx.presetNames.find(n => n.toLowerCase() === t);
    if (hit) return hit;
  }
  return null;
}

/** Enemy stats (hp, armor, ...) for an enemy config. Presets are scaled; Custom uses the raw numbers. */
export function resolveEnemy(ctx, enemy) {
  const preset = enemy.preset !== CUSTOM_PRESET ? ctx.presets[enemy.preset] : null;
  const faction = resolveFaction(enemy.faction ?? preset?.faction).name;
  if (!preset) {
    const num = v => Math.max(0, Number(v) || 0);
    return {
      faction, level: null, hp: Math.max(1, num(enemy.hp)), armor: num(enemy.armor), shields: num(enemy.shields),
      overguard: num(enemy.overguard), headshot: Boolean(enemy.headshot),
    };
  }
  const scaled = scaleEnemy({ ...preset, faction }, { level: enemy.level, steelPath: enemy.steelPath });
  return { ...scaled, headshot: Boolean(enemy.headshot) };
}

/**
 * Enemy config with its derived stats stored alongside, as saved builds keep them.
 * Keys always come out in one order, so snapshots of equal targets compare equal.
 */
export function withEnemyStats(ctx, enemy) {
  const r = resolveEnemy(ctx, enemy);
  return {
    preset: enemy.preset, level: enemy.level, steelPath: Boolean(enemy.steelPath), faction: r.faction,
    hp: r.hp, armor: r.armor, shields: r.shields, overguard: r.overguard, headshot: Boolean(enemy.headshot),
  };
}

/** Enemy config for a preset at its default level, keeping the toggles of the previous target. */
export function enemyForPreset(ctx, presetName, prev = {}) {
  if (presetName === CUSTOM_PRESET) {
    const base = prev.preset && prev.preset !== CUSTOM_PRESET ? resolveEnemy(ctx, prev) : prev;
    return withEnemyStats(ctx, {
      preset: CUSTOM_PRESET, level: prev.level ?? 1, steelPath: false, faction: prev.faction ?? 'Grineer',
      hp: base.hp ?? 10000, armor: base.armor ?? 0, shields: base.shields ?? 0, overguard: base.overguard ?? 0,
      headshot: Boolean(prev.headshot),
    });
  }
  const preset = ctx.presets[presetName];
  return withEnemyStats(ctx, {
    preset: presetName,
    level: Math.max(1, Math.round(preset?.default_level ?? preset?.base_level ?? 1)),
    steelPath: Boolean(prev.steelPath),
    faction: resolveFaction(preset?.faction).name,
    headshot: Boolean(prev.headshot),
  });
}

export function defaultEnemy(ctx) {
  const name = resolvePresetName(ctx, DEFAULT_PRESET) ?? ctx.presetNames[0] ?? CUSTOM_PRESET;
  return enemyForPreset(ctx, name);
}

/** Apply a target-panel change. `patch` may hold preset, level, steelPath, faction, headshot, hp, armor, shields, overguard. */
export function updateEnemy(ctx, enemy, patch) {
  if (patch.preset != null && patch.preset !== enemy.preset) return enemyForPreset(ctx, patch.preset, enemy);
  const next = { ...enemy, ...patch };
  if ('level' in patch) next.level = Math.min(9999, Math.max(1, Math.round(Number(patch.level) || 1)));
  for (const k of ['hp', 'armor', 'shields', 'overguard']) {
    if (k in patch) next[k] = Math.max(0, Number(patch[k]) || 0);
  }
  return withEnemyStats(ctx, next);
}

/**
 * One-line target description for the result card and compare pins: everything the result depends on
 * ("Elite Crewman · L145 · Steel Path · Corpus · Headshots", or the pools of a custom target).
 */
export function targetLabel(enemy) {
  if (!enemy) return '';
  const pools = enemy.preset === CUSTOM_PRESET
    ? [`${fmtCompact(enemy.hp)} health`, `${fmtCompact(enemy.shields)} shields`, `${fmtCompact(enemy.armor)} armor`,
      enemy.overguard ? `${fmtCompact(enemy.overguard)} overguard` : null]
    : null;
  const head = pools ? ['Custom target', ...pools] : [enemy.preset, `L${enemy.level}`, enemy.steelPath ? 'Steel Path' : null];
  return [...head, enemy.faction, enemy.headshot ? 'Headshots' : null].filter(Boolean).join(' · ');
}

export function createBuild(ctx, overrides = {}) {
  const weapon = ctx.weaponByName.get(overrides.weaponName) ?? ctx.weaponByName.get(defaultWeaponName(ctx));
  return {
    name: 'New build',
    weaponName: weapon?.name ?? '',
    modeName: defaultModeName(weapon),
    mods: emptySlots(),
    arcanes: emptyArcanes(weapon),
    slotPolarities: emptyPolarities(),
    catalyst: true,
    enemy: defaultEnemy(ctx),
    simTime: DEFAULT_DURATION,
    notes: '',
    ...overrides,
  };
}

/** Validate stored slot polarities: 9 entries, each null or a known code. */
export function normalizePolarities(raw) {
  return emptyPolarities().map((_, i) => {
    const v = Array.isArray(raw) ? raw[i] : null;
    return typeof v === 'string' && SLOT_POLARITIES.includes(v) ? v : null;
  });
}

function normalizeSlot(ctx, weapon, slot) {
  if (!slot || typeof slot.name !== 'string') return { slot: null };
  const mod = ctx.index.byName.get(slot.name);
  if (!mod) return { slot: null, dropped: `${slot.name} (unknown mod)` };
  if (weapon && !isModCompatible(mod, weapon)) return { slot: null, dropped: `${slot.name} (does not fit ${weapon.name})` };
  const max = maxRank(mod);
  const rank = Number.isFinite(Number(slot.rank)) ? Math.min(max, Math.max(0, Math.round(Number(slot.rank)))) : max;
  return { slot: { name: slot.name, rank } };
}

/**
 * Bring a saved or imported build to the current shape: 9 slots, known weapon, valid mode and ranks.
 * @returns {{ build: object, warnings: string[] }}
 */
export function normalizeBuild(ctx, raw) {
  const warnings = [];
  let weapon = ctx.weaponByName.get(raw?.weaponName);
  if (!weapon) {
    if (raw?.weaponName) warnings.push(`${raw.weaponName} is not available; switched to ${defaultWeaponName(ctx)}.`);
    weapon = ctx.weaponByName.get(defaultWeaponName(ctx));
  }
  const modes = selectableModes(weapon).map(m => m.mode_name);
  const mods = emptySlots();
  const dropped = [];
  (Array.isArray(raw?.mods) ? raw.mods : []).slice(0, SLOT_COUNT).forEach((s, i) => {
    const r = normalizeSlot(ctx, weapon, s);
    if (r.dropped) dropped.push(r.dropped);
    else if (r.slot && conflictingMod(r.slot.name, mods.map(m => m?.name ?? null), ctx.index)) dropped.push(`${r.slot.name} (conflicts with another mod)`);
    else mods[i] = r.slot;
  });
  const arcanes = emptyArcanes(weapon);
  // Older saved builds have no arcanes; imports may list bare names.
  (Array.isArray(raw?.arcanes) ? raw.arcanes : []).forEach((a, i) => {
    if (!a) return;
    const entry = normalizeArcaneEntry(a, ctx.data);
    const label = typeof a === 'string' ? a : String(a?.name ?? 'arcane');
    if (!entry) dropped.push(`${label} (unknown arcane)`);
    else if (i >= arcanes.length || !isArcaneCompatible(entry.name, weapon, ctx.data, i)) dropped.push(`${entry.name} (does not fit ${weapon.name})`);
    else arcanes[i] = entry;
  });
  if (dropped.length) warnings.push(`Removed: ${dropped.join(', ')}.`);
  let enemy = raw?.enemy && typeof raw.enemy === 'object' ? raw.enemy : null;
  if (!enemy || (enemy.preset !== CUSTOM_PRESET && !ctx.presets[enemy.preset])) {
    if (enemy?.preset) warnings.push(`Target ${enemy.preset} is not available; using the default target.`);
    enemy = defaultEnemy(ctx);
  } else {
    enemy = withEnemyStats(ctx, enemy);
  }
  const build = {
    ...(raw?.id ? { id: raw.id } : {}),
    name: String(raw?.name ?? '').trim() || 'Untitled build',
    weaponName: weapon.name,
    modeName: modes.includes(raw?.modeName) ? raw.modeName : modes[0] ?? '',
    mods,
    arcanes,
    slotPolarities: normalizePolarities(raw?.slotPolarities),
    catalyst: raw?.catalyst !== false,
    enemy,
    simTime: DURATIONS.includes(Number(raw?.simTime)) ? Number(raw.simTime) : DEFAULT_DURATION,
    notes: String(raw?.notes ?? ''),
    ...(raw?.updatedAt ? { updatedAt: raw.updatedAt } : {}),
    ...(raw?.lastResult ? { lastResult: raw.lastResult } : {}),
  };
  return { build, warnings };
}

/**
 * The build as it goes to storage: name trimmed, and `lastResult` only when it belongs to these mods and target.
 * `lastResult` is the current result, or undefined when the sim is pending, running, failed or out of date.
 */
export function buildToSave(build, lastResult) {
  const { lastResult: _stale, ...rest } = build;
  return { ...rest, name: saveName(build.name), ...(lastResult ? { lastResult } : {}) };
}

const saveName = name => String(name ?? '').trim() || 'Untitled build';

/**
 * The working build after a save: the stored id, time and normalised name, and the stored result
 * only if nothing changed while saving.
 */
export function buildAfterSave(current, sent, saved) {
  const { lastResult: _stale, ...rest } = current;
  const next = {
    ...rest,
    name: saveName(current.name) === sent.name ? sent.name : current.name,
    id: saved.id,
    updatedAt: saved.updatedAt,
  };
  if (saved.lastResult && snapshotOf(next) === snapshotOf(sent)) next.lastResult = saved.lastResult;
  return next;
}

/**
 * The part of a build that counts as "content": unsaved-changes detection and undo steps.
 * Arcanes are left out while every arcane slot is empty, so a build saved before arcanes existed
 * (or stored without them) matches the same build with empty slots.
 */
export function contentOf(build) {
  const { name, weaponName, modeName, mods, enemy, simTime, notes } = build;
  const arcanes = hasArcanes(build) ? build.arcanes : undefined;
  // Slot polarities and the Catalyst are left out at their defaults, for the same reason as arcanes.
  const slotPolarities = build.slotPolarities?.some(p => p != null) ? build.slotPolarities : undefined;
  return {
    name, weaponName, modeName, mods, ...(arcanes ? { arcanes } : {}),
    ...(slotPolarities ? { slotPolarities } : {}), ...(build.catalyst === false ? { catalyst: false } : {}),
    enemy, simTime, notes,
  };
}

/** Restore content (an undo step) into the working build, keeping its identity (id, save time). */
export function withContent(build, content) {
  const { lastResult: _stale, ...identity } = build;
  // Content without arcanes means "no arcanes", not "keep the current ones" (the same for polarities).
  return { ...identity, arcanes: (build.arcanes ?? []).map(() => null), slotPolarities: emptyPolarities(), catalyst: true, ...content };
}

/** Whether any arcane slot of a build is filled. */
export const hasArcanes = build => Array.isArray(build?.arcanes) && build.arcanes.some(Boolean);

export function snapshotOf(build) {
  if (!build) return '';
  return JSON.stringify(contentOf(build));
}

/** Everything the simulation result depends on. */
export function simKeyOf(ctx, build) {
  if (!build) return '';
  return JSON.stringify([build.weaponName, build.modeName, build.mods, resolveEnemy(ctx, build.enemy), build.simTime, hasArcanes(build) ? build.arcanes : []]);
}

/** Switch weapon, dropping mods and arcanes that no longer fit. */
export function changeWeapon(ctx, build, weaponName) {
  const weapon = ctx.weaponByName.get(weaponName);
  if (!weapon || weapon.name === build.weaponName) return { build, removed: [] };
  const removed = [];
  const mods = build.mods.map(slot => {
    if (!slot) return null;
    const mod = ctx.index.byName.get(slot.name);
    if (mod && isModCompatible(mod, weapon)) return slot;
    removed.push(slot.name);
    return null;
  });
  const arcanes = emptyArcanes(weapon);
  (build.arcanes ?? []).forEach((a, i) => {
    if (!a) return;
    if (i < arcanes.length && isArcaneCompatible(a.name, weapon, ctx.data, i)) arcanes[i] = a;
    else removed.push(a.name);
  });
  // Forma belongs to the weapon it was applied to: the new weapon starts from its own innate polarities.
  return { build: { ...build, weaponName: weapon.name, modeName: defaultModeName(weapon), mods, arcanes, slotPolarities: emptyPolarities() }, removed };
}

export function setSlot(build, slot, value) {
  const mods = build.mods.slice();
  mods[slot] = value;
  return { ...build, mods };
}

// ---- Slots, polarities and capacity -------------------------------------------------------------

/** Innate and effective (after Forma) polarities of a build's 9 slots. */
export function slotPolaritiesOf(ctx, build) {
  const weapon = ctx.weaponByName.get(build?.weaponName);
  const innate = innateSlotPolarities(ctx.data, weapon);
  return { innate, effective: effectiveSlotPolarities(innate, build?.slotPolarities) };
}

/** Set one slot's Forma polarity (null, or the innate polarity itself, resets it). */
export function setSlotPolarity(ctx, build, slot, code) {
  const { innate } = slotPolaritiesOf(ctx, build);
  const next = normalizePolarities(build.slotPolarities);
  const want = code == null ? null : String(code);
  const same = want == null || (want === 'AP_UNIVERSAL' ? innate[slot] == null : want === innate[slot]);
  next[slot] = same ? null : want;
  return next[slot] === (build.slotPolarities?.[slot] ?? null) ? build : { ...build, slotPolarities: next };
}

/**
 * Capacity of a build: { used, capacity, over, forma, perSlot, polarities, innate, catalyst }.
 * `slots` overrides the mods (a drag preview).
 */
export function buildCapacity(ctx, build, slots = build.mods) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  const { innate, effective } = slotPolaritiesOf(ctx, build);
  const forma = formaCount(innate, build.slotPolarities);
  const catalyst = build.catalyst !== false;
  const capacity = capacityOf({ catalyst, progenitor: Boolean(weapon?.is_progenitor), forma });
  const { used, perSlot } = capacityUse(slots, effective, n => ctx.index.byName.get(n));
  return { used, capacity, over: Math.max(0, used - capacity), forma, perSlot, polarities: effective, innate, catalyst };
}

/** Why a mod cannot go in a slot ("Not an Exilus mod", "Conflicts with Serration", "Already in slot 2"), or null. */
export function slotBlockReason(ctx, build, slot, modName, { ignoreSlot = null } = {}) {
  if (!fitsSlot(ctx, modName, slot)) return 'Not an Exilus mod';
  const others = build.mods.map((s, i) => (i === slot || i === ignoreSlot ? null : s?.name ?? null));
  const c = conflictingMod(modName, others, ctx.index);
  if (!c) return null;
  return c === modName ? `Already in ${slotLabel(others.indexOf(modName)).replace(/^Slot/, 'slot')}` : `Conflicts with ${c}`;
}

/**
 * The slot a gallery click equips into: the selected mod slot, else (for an Exilus mod) the empty Exilus slot,
 * else the first empty general slot. Null when no slot is free.
 */
export function targetSlotFor(ctx, build, selected, modName) {
  if (Number.isInteger(selected) && selected >= 0 && selected < SLOT_COUNT) return selected;
  if (modName && ctx.exilus.has(modName) && !build.mods[EXILUS_SLOT]) return EXILUS_SLOT;
  return GENERAL_SLOTS.find(i => !build.mods[i]) ?? null;
}

/** After filling an empty slot: the next empty general slot after it (wrapping), else null. */
export function nextEmptySlot(build, after) {
  if (after === EXILUS_SLOT) return GENERAL_SLOTS.find(i => !build.mods[i]) ?? null;
  const order = [...GENERAL_SLOTS.slice(after + 1), ...GENERAL_SLOTS.slice(0, after + 1)];
  return order.find(i => !build.mods[i]) ?? null;
}

/**
 * What the Picker does after a card was equipped into `target` (docs/declutter-spec.md 1.1): filling an empty slot
 * moves on to the next empty one and keeps picking (a selected slot moves with it); filling the last empty slot, or
 * swapping a filled one, ends picking. Returns { close, selectedSlot }.
 */
export function pickerAfterEquip(build, target, { wasEmpty, selected = null }) {
  if (!wasEmpty) return { close: true, selectedSlot: null };
  const next = nextEmptySlot(build, target);
  if (next == null) return { close: true, selectedSlot: null };
  return { close: false, selectedSlot: selected === target ? next : selected };
}

/** Swap two slots' mods (ranks kept). Returns the build unchanged when the swap is not allowed. */
export function swapSlots(ctx, build, a, b) {
  if (a === b) return build;
  const ma = build.mods[a];
  const mb = build.mods[b];
  if (ma && !fitsSlot(ctx, ma.name, b)) return build;
  if (mb && !fitsSlot(ctx, mb.name, a)) return build;
  const mods = build.mods.slice();
  mods[a] = mb;
  mods[b] = ma;
  return { ...build, mods };
}

/** Visual order of the slot area: 1-4, Arcane (a kitgun's second arcane), 5-8, Exilus (the special slots on the right). */
export const SLOT_ORDER = [0, 1, 2, 3, ARCANE_SLOT, KITGUN_ARCANE_SLOT, 4, 5, 6, 7, EXILUS_SLOT];


// ---- Arcanes -------------------------------------------------------------------------------------
// A build's `arcanes` is slot-indexed like `mods`: arcanes[i] is arcane slot i, `{ name, rank, options? }` or null.
// Guns have one slot (kitguns two: the second takes Pax / Residual arcanes); see arcaneSlotCount().

/** Empty arcane slots for a weapon. */
export const emptyArcanes = weapon => Array(arcaneSlotCount(weapon)).fill(null);

/** A freshly equipped arcane: max rank and underframe.site's defaults (max stacks). */
export function newArcane(ctx, name, rank = null) {
  return normalizeArcaneEntry({ name, rank: rank ?? arcaneMaxRank(name, ctx.data), options: defaultArcaneOptions(name, ctx.data) }, ctx.data);
}

/** Put an arcane entry (or null) in an arcane slot; `value` is clamped to the arcane's ranks and options. */
export function setArcane(ctx, build, slot, value) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  const arcanes = emptyArcanes(weapon).map((_, i) => build.arcanes?.[i] ?? null);
  if (slot < 0 || slot >= arcanes.length) return build;
  arcanes[slot] = value ? normalizeArcaneEntry(value, ctx.data) : null;
  return { ...build, arcanes };
}

/**
 * Arcanes offered for an arcane slot, best matches first. The search matches every word of the query
 * against the name, effect and description ("crit cold" finds Primary Frostbite).
 * @returns {Array<{ name, maxRank, summary, description, imageUrl, requires, support, supportNote, controls, equipped }>}
 */
export function arcaneCandidates(ctx, build, slot = 0, query = '') {
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) return [];
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const equipped = build.arcanes?.[slot]?.name ?? null;
  const out = [];
  for (const a of arcanesFor(weapon, ctx.data, slot)) {
    const name = a.name.toLowerCase();
    const text = `${name} ${a.summary} ${a.description} ${a.requires ?? ''}`.toLowerCase();
    if (!words.every(w => text.includes(w))) continue;
    const score = !words.length ? 0 : name.startsWith(words.join(' ')) ? 0 : words.every(w => name.includes(w)) ? 1 : 2;
    out.push({ ...a, equipped: a.name === equipped, score });
  }
  return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).map(({ score: _s, ...a }) => a);
}

/** Arcanes in a featured (trusted) build, with their stacks and rank from its conditionals. */
export function featuredArcanes(ctx, tb) {
  const states = tb?.activeConditionals ?? {};
  return (Array.isArray(tb?.arcanes) ? tb.arcanes : []).map(name => {
    if (typeof name !== 'string' || !name) return null;
    const state = states[name];
    const entry = newArcane(ctx, name, Number.isFinite(Number(state?.rank)) ? Number(state.rank) : null);
    if (!entry || !state) return entry;
    const options = { ...entry.options };
    if ('stacks' in options) options.stacks = state.isActive ? Number(state.stacks) || 0 : 0;
    if ('startingStacks' in options && Number.isFinite(Number(state.enervateStartingStacks))) options.startingStacks = Number(state.enervateStartingStacks);
    return normalizeArcaneEntry({ ...entry, options }, ctx.data);
  });
}

/** Equipped arcanes the simulation does not model at all, by name. */
export function unsimulatedArcaneNames(ctx, build) {
  return (build.arcanes ?? []).filter(a => a && arcaneSupport(a.name, ctx.data).level === 'none').map(a => a.name);
}

/** Whether a mod may sit in a slot: the Exilus slot only takes Exilus mods. */
export function fitsSlot(ctx, modName, slot) {
  return slot !== EXILUS_SLOT || ctx.exilus.has(modName);
}

/**
 * Mods offered for a slot, with the reason each blocked one cannot be equipped.
 * @returns {Array<{ name, mod, conflict: string|null, popular: boolean }>}
 */
export function modCandidates(ctx, build, slot, query = '') {
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) return [];
  const others = build.mods.map((s, i) => (i === slot ? null : s?.name ?? null));
  const q = query.trim().toLowerCase();
  const out = [];
  for (const mod of ctx.data.mods) {
    const name = mod['Local Name'];
    if (!isModCompatible(mod, weapon) || !fitsSlot(ctx, name, slot)) continue;
    if (q && !name.toLowerCase().includes(q) && !String(mod.Description ?? '').toLowerCase().includes(q)) continue;
    const c = conflictingMod(name, others, ctx.index);
    const where = c === name ? others.indexOf(name) : -1;
    out.push({
      name, mod, popular: ctx.popular.has(name),
      conflict: c ? (c === name ? `Already in ${slotLabel(where).replace(/^Slot/, 'slot')}` : `Conflicts with ${c}`) : null,
      equipped: build.mods[slot]?.name === name,
    });
  }
  const relevance = c => (!q ? 0 : c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : 2);
  return out.sort((a, b) => relevance(a) - relevance(b) || a.name.localeCompare(b.name));
}

/** Featured (trusted) builds for supported guns. */
export function featuredBuilds(ctx) {
  return (ctx.data.trusted_builds ?? [])
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => ctx.weaponByName.has(b.itemName))
    .map(({ b, i }) => ({
      key: `${i}:${b.slug ?? b.name}`,
      name: String(b.name ?? b.itemName),
      weaponName: b.itemName,
      weaponType: ctx.weaponByName.get(b.itemName).type,
      tags: Object.entries(b.tags ?? {}).filter(([, v]) => v).map(([k]) => k),
      description: String(b.description ?? ''),
      source: b,
    }));
}

/** Parts of a featured build this app does not apply, for an honest note. */
export function unappliedFeatures(tb) {
  const out = [];
  // Arcanes are applied, with their stacks from activeConditionals; other conditionals are not.
  const arcaneNames = new Set((tb.arcanes ?? []).filter(Boolean));
  if (tb.activeConditionals && Object.entries(tb.activeConditionals).some(([k, v]) => v && !arcaneNames.has(k))) out.push('conditionals');
  if (tb.mods?.some(m => m && /riven/i.test(m.name))) out.push('rivens');
  if (tb.incarnon && Object.values(tb.incarnon).some(Boolean)) out.push('incarnon settings');
  for (const k of ['externalBuffs', 'externalWeaponBuffs', 'externalStatuses', 'externalAbilities', 'archon_shards']) {
    if (tb[k]?.length) { out.push('external buffs'); break; }
  }
  if (tb.customFireModes?.length) out.push('custom fire modes');
  return out;
}

/** Open a featured build as a new, unsaved build, optionally keeping the current target. */
export function buildFromFeatured(ctx, featured, enemy = null) {
  const tb = featured.source;
  const { build, warnings } = normalizeBuild(ctx, {
    name: featured.name, weaponName: tb.itemName, mods: tb.mods, arcanes: featuredArcanes(ctx, tb), notes: featured.description, enemy,
  });
  const skipped = unappliedFeatures(tb);
  const unsimulated = unsimulatedArcaneNames(ctx, build);
  const notes = [
    `Conditionals, rivens and incarnon settings from featured builds are not applied${skipped.length ? ` (this one uses ${skipped.join(', ')})` : ''}.` +
      (unsimulated.length ? ` ${unsimulated.join(', ')} ${unsimulated.length > 1 ? 'are' : 'is'} equipped but not simulated.` : ''),
    ...warnings,
  ];
  return { build, notes };
}

/** Mods equipped in a build, by name, for messages ("Hornet Strike, Lethal Torrent"). */
export function equippedNames(build) {
  return build.mods.filter(Boolean).map(s => s.name);
}

/** Incarnon fire modes run, but their evolution bonuses aren't simulated (UX spec 5.7: say so). */
export const isIncarnonMode = modeName => /incarnon/i.test(String(modeName ?? ''));
export const INCARNON_NOTE = "Incarnon evolutions aren't simulated.";

/** "Slot 5" / "Exilus". */
export const slotLabel = slot => (slot === EXILUS_SLOT ? 'Exilus' : `Slot ${slot + 1}`);

/** "7.83s" -> 7.83, "> 20s" -> not killed. */
export function parseTtk(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.startsWith('>')) return { seconds: null, killed: false, text };
  const n = parseFloat(text);
  return Number.isFinite(n) ? { seconds: n, killed: true, text } : { seconds: null, killed: false, text };
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Combine per-seed engine results into what the UI shows. */
/**
 * The result card's copy for a failed simulation: known engine and worker failures in plain words, anything
 * else as the engine reported it.
 */
export function simErrorText(message) {
  const m = String(message ?? '');
  if (/appStateRef not cached|cache_app_state/i.test(m)) return "The damage engine lost this weapon's data. Try again.";
  if (/worker crashed|unreadable message|Engine stopped/i.test(m)) return 'The damage engine stopped unexpectedly. Try again to restart it.';
  if (/Could not load the damage engine/i.test(m)) return m;
  if (/^Unknown weapon/i.test(m)) return `${m}.`;
  return m ? `The engine reported: ${m}` : 'The engine gave no reason.';
}

export function summarizeRuns(results, maxTime) {
  const errors = results.filter(r => !r || r.error).map(r => String(r?.error ?? 'No result'));
  const ok = results.filter(r => r && !r.error && Number.isFinite(r.avgDps));
  if (!ok.length) return { ok: false, error: errors[0] ?? 'The engine returned no results.', runs: 0 };
  const dps = ok.map(r => r.avgDps);
  const ttks = ok.map(r => parseTtk(r.ttk));
  const killed = ttks.filter(t => t.killed);
  return {
    ok: true,
    runs: ok.length,
    failedRuns: errors.length,
    avgDps: mean(dps),
    minDps: Math.min(...dps),
    maxDps: Math.max(...dps),
    ttk: killed.length ? mean(killed.map(t => t.seconds)) : null,
    killedRuns: killed.length,
    maxTime,
    avgHit: mean(ok.map(r => Number(r.avgHit) || 0)),
    firstHitDamage: mean(ok.map(r => Number(r.firstHitDamage) || 0)),
  };
}

/** Text for a summary's time to kill. */
export function ttkText(summary) {
  if (!summary?.ok) return '—';
  if (summary.ttk == null) return `> ${summary.maxTime} s`;
  const s = `${summary.ttk.toFixed(2)} s`;
  return summary.killedRuns < summary.runs ? `${s} (${summary.killedRuns}/${summary.runs} kills)` : s;
}

/** The compact result a saved build keeps. */
export function lastResultOf(summary) {
  if (!summary?.ok) return undefined;
  return {
    avgDps: summary.avgDps, ttk: summary.ttk, avgHit: summary.avgHit,
    firstHitDamage: summary.firstHitDamage, runs: summary.runs,
  };
}

/** Enemy health pools over time as step points, starting from the full pools at t = 0. */
export function healthSeries(debugLog, start) {
  const points = [{ t: 0, hp: start.hp, shields: start.shields, overguard: start.overguard }];
  for (const e of debugLog ?? []) {
    if (!e?.enemy || !Number.isFinite(e.time)) continue;
    points.push({ t: e.time, hp: Math.max(0, e.enemy.hp ?? 0), shields: Math.max(0, e.enemy.shields ?? 0), overguard: Math.max(0, e.enemy.overguard ?? 0) });
  }
  const maxValue = Math.max(1, ...points.map(p => Math.max(p.hp, p.shields, p.overguard)));
  return { points, maxTime: Math.max(...points.map(p => p.t), 0), maxValue };
}

/** Damage per hit type in the debug log, largest first, with its share of the total. */
export function damageShare(debugLog) {
  const sums = new Map();
  for (const e of debugLog ?? []) {
    const d = Number(e?.damage) || 0;
    if (d <= 0) continue;
    const type = String(e.type || 'Other');
    sums.set(type, (sums.get(type) ?? 0) + d);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([type, damage]) => ({ type, damage, share: total ? damage / total : 0 }))
    .sort((a, b) => b.damage - a.damage);
}

/** "WEAPON_RECOIL" -> "Recoil". */
export function friendlyStat(upgradeType) {
  const s = String(upgradeType).replace(/^(WEAPON|GAMEPLAY|AVATAR)_/, '').toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Group computeWeaponStats().modifiers.unhandled ("Mod: STAT") by mod name. */
export function unhandledByMod(unhandled) {
  const out = new Map();
  for (const entry of unhandled ?? []) {
    const i = entry.lastIndexOf(': ');
    const name = i > 0 ? entry.slice(0, i) : entry;
    const stat = friendlyStat(i > 0 ? entry.slice(i + 2) : 'unknown');
    if (!out.has(name)) out.set(name, []);
    if (!out.get(name).includes(stat)) out.get(name).push(stat);
  }
  return out;
}

const POLARITIES = {
  AP_ATTACK: ['Madurai', 'V'],
  AP_DEFENSE: ['Vazarin', 'D'],
  AP_TACTIC: ['Naramon', '–'],
  AP_POWER: ['Zenurik', '='],
  AP_WARD: ['Unairu', 'U'],
  AP_PRECEPT: ['Penjaga', 'Y'],
  AP_UMBRA: ['Umbra', 'Ω'],
  AP_UNIVERSAL: ['Any', '*'],
  AP_ANY: ['Any', '*'],
};

export function polarityInfo(p) {
  const [label, symbol] = POLARITIES[p] ?? ['None', ''];
  return { label, symbol };
}

export function rarityKey(r) {
  const k = String(r ?? '').toLowerCase();
  return ['common', 'uncommon', 'rare', 'legendary'].includes(k) ? k : 'common';
}

/** Supported weapons matching a query, grouped by type. */
export function weaponMatches(ctx, query = '') {
  const q = query.trim().toLowerCase();
  const groups = Object.fromEntries(WEAPON_GROUPS.map(g => [g, []]));
  for (const w of ctx.weapons) {
    if (q && !w.name.toLowerCase().includes(q) && !String(w.subtype).toLowerCase().includes(q)) continue;
    groups[w.type]?.push(w);
  }
  return groups;
}

/** A compare-tray entry for the current result. `config` keeps what it was made from, to explain differences. */
export function makePin(build, summary, id, mode = null) {
  const { preset, level, steelPath, faction, headshot, hp, armor, shields, overguard } = build.enemy;
  return {
    id,
    buildName: build.name,
    weaponName: build.weaponName,
    modeName: build.modeName,
    target: targetLabel(build.enemy),
    avgDps: summary.avgDps,
    ttk: summary.ttk,
    ttkText: ttkText(summary),
    // The sheet values the Compare dialog lists next to DPS and TTK (docs/declutter-spec.md 4).
    stats: mode ? {
      damage: mode.totalFinalDamage, critChance: mode.finalCritChance, critMultiplier: mode.finalCritMultiplier,
      statusChance: mode.perProjectileStatusChance, fireRate: mode.finalFireRate, multishot: mode.finalMultishot,
    } : null,
    config: {
      weaponName: build.weaponName,
      modeName: build.modeName,
      mods: build.mods.map(m => (m ? { name: m.name, rank: m.rank } : null)),
      arcanes: (build.arcanes ?? []).map(a => (a ? { name: a.name, rank: a.rank, ...(a.options ? { options: { ...a.options } } : {}) } : null)),
      enemy: { preset, level, steelPath: Boolean(steelPath), faction, headshot: Boolean(headshot), hp, armor, shields, overguard },
      simTime: build.simTime,
    },
  };
}

/**
 * What differs between a pin and the baseline pin, in words ("Serration R10→R0", "+Hellfire R5",
 * "Steel Path on"). Empty when nothing differs; null when either pin predates `config`.
 */
export function pinChanges(pin, baseline) {
  const a = baseline?.config;
  const b = pin?.config;
  if (!a || !b) return null;
  const out = [];
  if (a.weaponName !== b.weaponName) out.push(b.weaponName);
  if (a.modeName !== b.modeName) out.push(b.modeName);
  const ranks = list => new Map(list.filter(Boolean).map(m => [m.name, m.rank]));
  const before = ranks(a.mods ?? []);
  const after = ranks(b.mods ?? []);
  for (const [name, rank] of after) {
    if (!before.has(name)) out.push(`+${name} R${rank}`);
    else if (before.get(name) !== rank) out.push(`${name} R${before.get(name)}→R${rank}`);
  }
  for (const [name] of before) if (!after.has(name)) out.push(`−${name}`);
  const arcanesOf = list => new Map((list ?? []).filter(Boolean).map(x => [x.name, x]));
  const arcBefore = arcanesOf(a.arcanes);
  const arcAfter = arcanesOf(b.arcanes);
  for (const [name, x] of arcAfter) {
    const y = arcBefore.get(name);
    if (!y) out.push(`+${name} R${x.rank}`);
    else {
      if (y.rank !== x.rank) out.push(`${name} R${y.rank}→R${x.rank}`);
      if ((y.options?.stacks ?? null) !== (x.options?.stacks ?? null)) out.push(`${name} ${y.options?.stacks ?? 0}→${x.options?.stacks ?? 0} stacks`);
    }
  }
  for (const [name] of arcBefore) if (!arcAfter.has(name)) out.push(`−${name}`);
  const ea = a.enemy ?? {};
  const eb = b.enemy ?? {};
  if (ea.preset !== eb.preset) out.push(eb.preset === CUSTOM_PRESET ? 'Custom target' : eb.preset);
  else if (eb.preset === CUSTOM_PRESET) {
    for (const [k, label] of [['hp', 'health'], ['shields', 'shields'], ['armor', 'armor'], ['overguard', 'overguard']]) {
      if (ea[k] !== eb[k]) out.push(`${fmtCompact(eb[k])} ${label}`);
    }
  }
  if (eb.preset !== CUSTOM_PRESET && ea.level !== eb.level) out.push(`Level ${ea.level}→${eb.level}`);
  if (Boolean(ea.steelPath) !== Boolean(eb.steelPath)) out.push(`Steel Path ${eb.steelPath ? 'on' : 'off'}`);
  if (ea.faction !== eb.faction) out.push(eb.faction);
  if (Boolean(ea.headshot) !== Boolean(eb.headshot)) out.push(`Headshots ${eb.headshot ? 'on' : 'off'}`);
  if (a.simTime !== b.simTime) out.push(`${b.simTime} s`);
  return out;
}

/** Undo of "Clear all": the cleared pins come back first, pins added since stay after them (newest kept). */
export function mergePins(cleared, current, max = MAX_PINS) {
  const ids = new Set(cleared.map(p => p.id));
  return [...cleared, ...current.filter(p => !ids.has(p.id))].slice(-max);
}

/** Compare rows with the DPS change relative to the baseline pin (the first pin unless another is chosen). */
export function compareRows(pins, baselineId = null) {
  const baseline = pins.find(p => p.id === baselineId) ?? pins[0];
  const base = baseline?.avgDps;
  return pins.map(p => {
    const changes = p === baseline ? [] : pinChanges(p, baseline);
    return {
      ...p,
      baseline: p === baseline,
      delta: p === baseline || !base ? null : (p.avgDps - base) / base,
      changes,
      changesText: p === baseline ? '—' : changes == null ? '—' : changes.length ? changes.join(', ') : 'Same setup',
    };
  });
}

export const MAX_PINS = 20;

/** Whether two pins hold the same result: the same setup (weapon, mode, mods, arcanes, target, time) and DPS. */
export function samePin(a, b) {
  if (!a?.config || !b?.config) return false;
  return a.avgDps === b.avgDps && JSON.stringify(a.config) === JSON.stringify(b.config);
}

/** Add a pin, dropping the oldest beyond MAX_PINS. Returns { pins, dropped } (dropped: pins removed). */
export function addPin(pins, pin, max = MAX_PINS) {
  const all = [...pins, pin];
  const dropped = all.length > max ? all.slice(0, all.length - max) : [];
  return { pins: all.slice(-max), dropped };
}

/** The signed change from a previous result, or null when there is none or it is under 0.05%. */
export function resultDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const delta = (current - previous) / previous;
  return Math.abs(delta) < 0.0005 ? null : delta;
}

/** Validate pins read back from localStorage. */
export function sanitizePins(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(p => p && typeof p.id === 'string' && Number.isFinite(p.avgDps)).slice(0, 20);
}

/** What a best-mod search depends on: the build with the searched slot emptied. */
export function sweepKeyOf(ctx, build, slot) {
  return simKeyOf(ctx, setSlot(build, slot, null));
}

/**
 * What the Best mod tab shows for a search, given the mod now in the searched slot (`slotNow`, or null).
 * Every candidate was measured at max rank with the same 3 seeds, so they compare directly:
 * - with a tested mod in the slot, gains are against that mod's own measurement (`base.kind === 'mod'`);
 * - otherwise against the slot left empty (`base.kind === 'empty'`).
 * Rows: the top `limit`, plus the mod in the slot (with its place) when it ranks lower.
 */
export function sweepView(sweep, slotNow, limit = 10) {
  const all = sweep?.all ?? [];
  const current = slotNow ? all.find(r => r.name === slotNow) : null;
  const base = current && Number.isFinite(current.dps)
    ? { kind: 'mod', name: current.name, dps: current.dps, rank: current.rank }
    : { kind: 'empty', name: null, dps: sweep?.baseDps ?? null };
  const gainOf = dps => (base.dps > 0 && Number.isFinite(dps) ? (dps - base.dps) / base.dps : null);
  const ranked = all.map((r, i) => ({ ...r, place: i + 1, gain: gainOf(r.dps), equipped: r.name === slotNow }));
  const rows = ranked.slice(0, limit);
  const mine = ranked.find(r => r.equipped);
  if (mine && mine.place > limit) rows.push(mine);
  return { base, rows };
}

/** Rank sweep results by DPS gain over the baseline. */
export function rankSweep(results, baseDps, limit = 10) {
  return results
    .filter(r => Number.isFinite(r.dps))
    .map(r => ({ ...r, gain: baseDps > 0 ? (r.dps - baseDps) / baseDps : 0 }))
    .sort((a, b) => b.dps - a.dps)
    .slice(0, limit);
}

export const LIBRARY_SORTS = { recent: 'Recent', name: 'Name', dps: 'Average DPS' };

/** Saved builds in library order: most recent first, by name, or by saved Average DPS (builds without one last). */
export function sortBuilds(list, sort = 'recent') {
  const out = [...list];
  if (sort === 'name') return out.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  if (sort === 'dps') {
    const dps = b => (Number.isFinite(b.lastResult?.avgDps) ? b.lastResult.avgDps : -Infinity);
    return out.sort((a, b) => dps(b) - dps(a) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  }
  return out.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

/** Library search: name, weapon and tags, case-insensitive. */
export function matchesBuildQuery(item, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.weaponName, ...(item.tags ?? [])].some(v => String(v ?? '').toLowerCase().includes(q));
}
