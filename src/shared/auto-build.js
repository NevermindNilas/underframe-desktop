// Auto Build (docs/port-auto-build.md 3-4): underframe.site's build optimizer, in our own code. A staged heuristic:
// an arcane pre-pass, the elemental compositions that reach each target element mix, a greedy fill of the remaining
// slots from each composition, the top 3 re-scored with their arcane re-optimised, a local "final refinement" on the
// winner, a final arcane check and two swaps made without simulating. With the Incarnon Genesis installed and an
// evolution without a perk, the perks are chosen too (steps 2.7 and 4.3, docs/port-incarnon.md).
//
// Pure: the engine is behind an injected `score(jobs)` (a pool of engine workers in the app, the engine itself or a
// fake in tests). `createAutoBuildEnv()` holds what every candidate shares (weapon, target, buffs, pools), and
// `candidateInput()` turns a candidate into the engine's input the same way the live readout does.

import { DAMAGE_TYPE_BY_DT, PHYSICAL, combineElements } from './damage.js';
import { conflictingMod, indexMods, isModCompatible, maxRank, statValue } from './mods.js';
import { collectModifiers, computeWeaponStats, effectiveProgenitor } from './stats.js';
import { buildEngineInput } from './engine-input.js';
import {
  arcaneRequirementMet, arcaneMaxRank, arcaneSlotCount, arcanesFor, defaultArcaneOptions, normalizeArcaneEntry, resolveArcanes,
} from './arcanes.js';
import { mergeExternalTotals, reduceExternalBuffs } from './external-buffs.js';
import { indexConditionalMods, modConditionalControls, modStacksText, resolveModConditionals } from './conditional-mods.js';
import { baseModeName, combinedModes, modesFired, resolveModeId } from './fire-modes.js';
import { resolveWeaponPassives } from './weapon-passives.js';
import { capacityOf, effectiveSlotPolarities, innateSlotPolarities, normalizePolarity, slotDrain } from './capacity.js';
import { rivenCapacityMod, rivenPolarity } from './rivens.js';
import { incarnonActive, incarnonEvolutions, incarnonFor, withPerk } from './incarnon.js';
import {
  ELEMENT_PRESETS, blockedByElementalBlacklist, metricOf, modStatFamilies, parseTargetList, runsFor, targetLabel,
} from './auto-build-settings.js';

export const SLOT_COUNT = 9;
export const EXILUS_SLOT = 8;
const GENERAL_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

/** underframe.site's forced fire rate for "Build for Single Shot/Hit": one shot in the whole simulation. */
export const SINGLE_SHOT_FIRE_RATE = 0.01;
/** Runs per job: a long evaluation is split into jobs of this many runs, spread over the pool. */
export const RUNS_PER_CHUNK = 10;
/** Final refinement: at most this many iterations, one slot each. */
export const REFINEMENT_ITERATIONS = 10;

/** Always added to the run's blacklist; rivens are never candidates. */
export const RIVEN_NAME = 'Riven Mod';
/** Added when the target's headshot flag is off: they only work on headshots. */
export const HEADSHOT_ONLY = Object.freeze(['Galvanized Scope', 'Galvanized Crosshairs', 'Primary Deadhead', 'Secondary Deadhead']);
/** Mods that add Radiation or Magnetic outright: not elemental-composition candidates, but greedy candidates. */
export const DIRECT_COMBINED_MODS = Object.freeze([
  'Accelerated Isotope', 'Atomic Fallout', 'Containment Breach', 'Critical Meltdown', 'Focus Radon', 'Magnetic Capacity', 'Magnetic Claws',
  'Magnetic Might', 'Magnetic Rush', 'Magnetic Strafe', 'Magnetized Core', 'Magnetized Cycle', 'Radiated Reload', 'Radon Claws',
]);
/** Admitted to the greedy pool even without a DPS stat (if they fit the weapon). */
const ALWAYS_GREEDY = { Primary: ['Internal Bleeding'], Secondary: ['Hemorrhage'] };
/** Never swapped by the final quality-of-life step. */
const QOL_KEEP = new Set(['Blood Rush', 'Weeping Wounds', 'Galvanized Reflex', 'Internal Bleeding', 'Hemorrhage']);
const GENERIC_COMPAT = new Set(['PRIMARY', 'SECONDARY', 'Rifle', 'Rifle (No Aoe)', 'Sniper', 'Bow', 'Shotgun', 'Pistol', 'Pistol (No Aoe)', 'Thrown', 'Tome', '']);
const ELEMENT_ADDED = 'WEAPON_PERCENT_BASE_DAMAGE_ADDED';
const COMPONENTS = { Viral: ['Cold', 'Toxin'], Corrosive: ['Electricity', 'Toxin'], Gas: ['Heat', 'Toxin'], Radiation: ['Electricity', 'Heat'], Blast: ['Cold', 'Heat'], Magnetic: ['Cold', 'Electricity'] };

/** Thrown by runAutoBuild() when the signal aborts. */
export class AutoBuildCancelled extends Error {
  constructor() {
    super('Operation cancelled by user.');
    this.name = 'AbortError';
  }
}

const presetTarget = name => [...ELEMENT_PRESETS.find(p => p.name === name).target];

/** A DPS stat (docs/port-auto-build.md 3.4): what makes a mod a greedy or refinement candidate. */
export function hasDpsStat(mod) {
  return (mod?.Stats ?? []).some(s => {
    const t = String(s?.UpgradeType ?? '');
    return /DAMAGE|CRIT|FIRE_RATE|FIRE_ITERATIONS|PROC_CHANCE|RELOAD_SPEED|STATUS_CHANCE/.test(t) || t === 'WEAPON_ATTACK_RANGE' || /_RANGE$/.test(t);
  });
}

/** A mod that adds an element (not Impact, Puncture or Slash). */
export function addsElement(mod) {
  return (mod?.Stats ?? []).some(s => s?.UpgradeType === ELEMENT_ADDED && DAMAGE_TYPE_BY_DT[s.DamageType] && !PHYSICAL.includes(DAMAGE_TYPE_BY_DT[s.DamageType]));
}

const isAugment = mod => !GENERIC_COMPAT.has(mod?.['Compat Name'] ?? '');
/** A weapon's own augment (its compatibility names the weapon or its family, not a weapon class). */
export const isAugmentMod = isAugment;

/** Conditional bonus types that add an element: the site forces augments with one of these into every run. */
const ELEMENT_BONUS = /^(Heat|Cold|Electricity|Gas|Toxin|Viral|Magnetic|Radiation|Corrosive|Blast) Damage$/;

/**
 * The weapon's own augments whose conditional part adds an element (Biotic Rounds: Viral and Magnetic), which the site
 * places in every run (docs/port-auto-build.md 4.0.3).
 */
export function elementalAugments(env) {
  const entries = indexConditionalMods(env.data);
  return env.data.mods.filter(m => {
    if (!isAugment(m) || !fitsWeapon(m, env.weapon)) return false;
    return (entries.get(m['Local Name']) ?? []).some(e => [e.details, ...(e.details?.bonuses ?? []), ...(e.buffs ?? [])]
      .some(b => ELEMENT_BONUS.test(String(b?.bonus_type ?? b?.type ?? '').trim())));
  });
}

/** A mod a run may put on the weapon: the app's compatibility (mods.js), the picker's own. */
export const fitsWeapon = isModCompatible;

/**
 * Everything a run shares. `build` is the working build (weapon, mode, target, buffs, statuses, polarities,
 * Catalyst); `enemy` its resolved target ({ faction, hp, armor, shields, overguard, headshot, armorStripImmune }).
 */
export function createAutoBuildEnv({ data, weapon, reload = null, build, enemy, settings, index = null }) {
  const idx = index ?? indexMods(data);
  // The pick (a combined "custom:" mode runs its parts); its first part stands for it, its parts make the signature.
  const modeName = resolveModeId(data, weapon, build.mods, build.modeName) || weapon.fire_modes[0]?.mode_name;
  const baseName = baseModeName(data, weapon, modeName);
  const mode = weapon.fire_modes.find(m => m.mode_name === baseName) ?? weapon.fire_modes[0];
  const children = modesFired(data, weapon, modeName).filter(n => n !== mode.mode_name)
    .map(n => weapon.fire_modes.find(m => m.mode_name === n)).filter(Boolean);
  // The weapon's passives and options count in every candidate, as in the Readout (sim.js buildStats).
  const passives = resolveWeaponPassives(data, weapon, build, { accurateAmmo: Boolean(reload) });
  const buffs = [...(build.externalBuffs ?? []), ...passives.buffs];
  const external = buffs.length ? reduceExternalBuffs(buffs, data, weapon).totals : null;
  const innate = innateSlotPolarities(data, weapon);
  const env = {
    data,
    index: idx,
    weapon,
    reload,
    enemy: { ...enemy, hp: enemy.hp * passives.enemyHpScale },
    passiveTotals: passives.totals,
    modeName,
    baseModeName: mode.mode_name,
    mode,
    customFireModes: combinedModes(data, weapon),
    signatureModes: [mode, ...children],
    external,
    externalBuffs: buffs,
    // Statuses already on the target: a Cold status lets Primary Frostbite build stacks (as on the site).
    externalStatuses: mergeStatuses(build.externalStatuses ?? [], passives.statuses),
    progenitor: effectiveProgenitor(weapon, build.progenitor),
    // The build's Incarnon perks; their conditional defaults read the pick and the buffs, as in the Readout.
    incarnon: build.incarnon ?? null,
    incarnonContext: { modeId: modeName, customFireModes: combinedModes(data, weapon), buffs: build.externalBuffs ?? [] },
    evolution: autoEvolution(data, weapon, build.incarnon),
    settings,
    metric: metricOf(settings),
    exilus: new Set(data.exilusMods ?? []),
    polarity: {
      innate,
      effective: effectiveSlotPolarities(innate, build.slotPolarities),
      catalyst: build.catalyst !== false,
      progenitor: Boolean(weapon.is_progenitor),
      maxForma: settings.maxForma,
    },
    caches: { signature: new Map(), types: new Map() },
  };
  env.blacklist = runBlacklist(settings, { headshot: Boolean(enemy?.headshot) });
  env.pools = candidatePools(env);
  return env;
}

/**
 * Whether the run picks Incarnon perks (the Genesis is installed and an evolution has none), the weapon's evolutions,
 * and the perks the build already has (kept).
 */
export function autoEvolution(data, weapon, incarnon) {
  const evolutions = incarnonActive(incarnon) ? incarnonEvolutions(incarnonFor(data, weapon)) : [];
  const locked = new Map(evolutions.filter(e => incarnon[`evolution_${e.number}_perk`]).map(e => [e.number, incarnon[`evolution_${e.number}_perk`]]));
  return { shouldRun: evolutions.length > locked.size, evolutions, locked };
}

/** The run's blacklist: the user's (when on) plus Riven Mod, and the headshot-only items when headshots are off. */
export function runBlacklist(settings, { headshot = false } = {}) {
  const out = new Set(settings.modBlacklistEnabled ? settings.modBlacklist : []);
  out.add(RIVEN_NAME);
  if (!headshot) for (const n of HEADSHOT_ONLY) out.add(n);
  return out;
}

/** Whether a mod may be a candidate: not blacklisted, whitelisted (when on), no blacklisted stat family. */
export function modAllowed(env, mod) {
  const name = mod?.['Local Name'];
  const s = env.settings;
  if (!name || env.blacklist.has(name) || String(mod.Rarity ?? '').toUpperCase() === 'RIVEN') return false;
  if (s.modWhitelistEnabled && !s.modWhitelist.includes(name)) return false;
  if (s.statBlacklistEnabled && s.statBlacklist.length) {
    const fam = modStatFamilies(mod);
    if (s.statBlacklist.some(k => fam.has(k))) return false;
  }
  return true;
}

/**
 * The candidate pools (docs/port-auto-build.md 3.4-3.5), in data order: elemental (compositions), greedy (filling),
 * refinement (swaps) and the arcanes for slot 0.
 */
export function candidatePools(env) {
  const { data, weapon } = env;
  const direct = new Set(DIRECT_COMBINED_MODS);
  const allowed = data.mods.filter(m => fitsWeapon(m, weapon) && modAllowed(env, m));
  const elemental = allowed.filter(m => addsElement(m) && !direct.has(m['Local Name']));
  const elementalNames = new Set(elemental.map(m => m['Local Name']));
  const always = new Set(ALWAYS_GREEDY[weapon.type] ?? []);
  const greedy = allowed.filter(m => !elementalNames.has(m['Local Name']) && (hasDpsStat(m) || always.has(m['Local Name'])));
  const refinement = allowed.filter(m => m.Type === String(weapon.type).toUpperCase() && !env.exilus.has(m['Local Name']) && (hasDpsStat(m) || isAugment(m)));
  const arcanes = arcaneSlotCount(weapon) ? arcanesFor(weapon, data, 0).map(a => a.name).filter(n => !env.blacklist.has(n)) : [];
  return { allowed, elemental, greedy, refinement, arcanes };
}

// ---------- elements ----------

/**
 * The element signature of mods on the selected mode (and its child modes): the final elements from the mods and the
 * innate elements, combined the way the simulation combines them. External buffs are left out, as on the site.
 */
export function elementSignature(env, mods) {
  const key = modsKey(mods);
  const hit = env.caches.signature.get(key);
  if (hit) return hit;
  const m = collectModifiers(mods, env.index.byName, null);
  const out = new Set();
  for (const mode of env.signatureModes) {
    const innate = Object.entries(mode.innate_elements ?? {}).filter(([t, v]) => !PHYSICAL.includes(t) && v > 0);
    const combined = combineElements([...m.elements.map(([t]) => [t, 1]), ...innate.map(([t]) => [t, 1])]);
    for (const t of Object.keys(combined)) out.add(t);
  }
  const sig = [...out].sort();
  env.caches.signature.set(key, sig);
  return sig;
}

/** A candidate's conditional mods at their stacks, with the weapon's passives. */
function conditionalsFor(env, mods) {
  const c = resolveModConditionals(mods, env.weapon, env.data);
  return { ...c, totals: mergeExternalTotals(c.totals, env.passiveTotals ?? null) };
}

/** Statuses on the target: `a`, plus `b` (a higher stack count wins). */
function mergeStatuses(a, b) {
  const out = a.map(s => ({ ...s }));
  for (const s of b ?? []) {
    const at = out.findIndex(o => o.type === s.type);
    if (at < 0) out.push({ ...s });
    else out[at] = { ...out[at], stacks: Math.max(out[at].stacks, s.stacks) };
  }
  return out;
}

/** The selected mode's final damage types with the build's buffs and perks (what element-gated arcanes need). */
function finalTypes(env, mods, incarnon = env.incarnon) {
  const key = `${modsKey(mods)}${incarnonKey(incarnon)}`;
  const hit = env.caches.types.get(key);
  if (hit) return hit;
  const { modes } = computeWeaponStats(env.weapon, mods, {
    modsByName: env.index.byName, reload: env.reload, targetFaction: env.enemy.faction, arcanes: null, external: env.external,
    externalStatuses: env.externalStatuses, conditionals: conditionalsFor(env, mods), progenitor: env.progenitor, data: env.data,
    incarnon, incarnonContext: env.incarnonContext,
  });
  const types = (modes.find(x => x.mode_name === env.baseModeName) ?? modes[0])?.finalDamageTypes ?? {};
  if (env.caches.types.size > 20000) env.caches.types.clear();
  env.caches.types.set(key, types);
  return types;
}

/**
 * Whether an arcane does something on these mods: element-gated arcanes need their element in the final damage types,
 * or (Primary Frostbite) a Cold status already on the target, the live readout's rule.
 */
export function arcaneEligible(env, name, mods, incarnon = env.incarnon) {
  if (arcaneRequirementMet(name, null, null) || arcaneRequirementMet(name, null, env.externalStatuses)) return true;
  return arcaneRequirementMet(name, finalTypes(env, mods, incarnon), env.externalStatuses);
}

/**
 * The element targets ("possibilities", docs/port-auto-build.md 3.3), completed with the innate elements they don't
 * consume and without the ones the elemental blacklist blocks. Each is { name, target, numSlots? }.
 */
export function elementalTargets(env) {
  const s = env.settings;
  const blacklist = s.elementalBlacklistEnabled ? parseTargetList(s.elementalBlacklist, { dropEmpty: true }) : [];
  const { weapon, mode } = env;
  const shotgun = weapon.subtype === 'Shotgun';
  const specific = s.elementalCandidatesEnabled && s.specificElementalCandidatesEnabled ? parseTargetList(s.specificElementalTargets) : [];
  let list;
  if (!s.elementalCandidatesEnabled) list = [{ name: 'No Element', target: [] }];
  else if (specific.length) list = specific.map(t => ({ ...t }));
  else {
    const names = shotgun
      ? ['Heat', 'Viral', 'Viral Electricity', 'Corrosive', 'Corrosive Cold']
      : ['Heat', 'Viral', 'Viral Heat', 'Corrosive', 'Corrosive Heat'];
    list = [{ name: 'No Element', target: [] }, ...names.map(n => ({ name: n, target: presetTarget(n) }))];
    const keyOf = p => `${p.numSlots ?? 0}::${[...p.target].sort().join('|')}`;
    const keys = new Set(list.map(keyOf));
    const add = p => {
      const t = { ...p, target: [...new Set(p.target)].sort() };
      if (!keys.has(keyOf(t))) { keys.add(keyOf(t)); list.push(t); }
    };
    const innate = new Set(Object.keys(mode.innate_elements ?? {}).map(k => k.toLowerCase()));
    if (shotgun && innate.has('heat')) {
      add({ name: 'Viral Heat', target: ['Viral', 'Heat'] });
      add({ name: 'Corrosive Heat', target: ['Corrosive', 'Heat'] });
    }
    if (weapon.type === 'Primary' && !shotgun && innate.has('toxin')) add({ name: 'Toxin', target: ['Toxin'] });
    if (env.externalBuffs.some(b => b?.id === 'xatas')) {
      add({ name: 'Blast', target: ['Blast'] });
      add({ name: 'Blast Toxin', target: ['Blast', 'Toxin'] });
      add({ name: 'Corrosive Blast', target: ['Blast', 'Corrosive'], numSlots: 4 });
    }
  }
  const pure = elementSignature(env, Array(SLOT_COUNT).fill(null));
  for (const p of list) {
    if (p.name === 'No Element') { p.target = [...pure]; continue; }
    const required = new Set(pure);
    for (const el of p.target) for (const c of COMPONENTS[el] ?? []) required.delete(c);
    p.target = [...new Set([...p.target, ...required])].sort();
  }
  return list.filter(p => !blockedByElementalBlacklist(p.target, blacklist));
}

// ---------- capacity (Cost Control) ----------

/**
 * The slot polarities that let mods fit the capacity with at most `maxForma` Forma in total, or null when none is found.
 * As on underframe.site, the Forma already on the build count toward the total, so a build that has 5 with a maximum
 * of 5 may only use its polarities as they are. Each slot the plan re-polarises costs one Forma (a slot that already
 * had one needs another). Slots are re-polarised greedily, largest drain saving first, to each mod's own polarity, so
 * the plan changes as few slots as it can.
 * @returns {{ polarities: (string|null)[], used: number, capacity: number, forma: number, added: number } | null}
 */
export function capacityPlan(env, mods) {
  const { innate, effective, catalyst, progenitor, maxForma } = env.polarity;
  const pol = effective.slice();
  const formaOf = p => p.reduce((n, x, i) => n + (x !== innate[i] ? 1 : 0), 0);
  const addedOf = p => p.reduce((n, x, i) => n + (x !== effective[i] ? 1 : 0), 0);
  const budget = Math.max(0, maxForma - formaOf(effective));
  const drainAt = (i, p) => {
    const s = mods[i];
    const mod = s && (s.isRiven ? rivenCapacityMod(s) : env.index.byName.get(s.name));
    return mod ? slotDrain(mod, s.rank, p).drain : 0;
  };
  for (let guard = 0; guard <= SLOT_COUNT; guard++) {
    const forma = formaOf(pol);
    const used = mods.reduce((n, _s, i) => n + drainAt(i, pol[i]), 0);
    const capacity = capacityOf({ catalyst, progenitor, forma });
    if (used <= capacity) return { polarities: pol, used, capacity, forma, added: addedOf(pol) };
    let best = null;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = mods[i];
      const mod = s && env.index.byName.get(s.name);
      // A riven wants its own polarity; one without (Omni) matches any but Umbra: an unpolarised (or Umbra) slot gets Madurai.
      const omni = pol[i] && pol[i] !== 'AP_UMBRA' ? pol[i] : RIVEN_FORMA_POLARITY;
      const want = s?.isRiven ? rivenPolarity(s) ?? omni : normalizePolarity(mod?.Polarity);
      if (!want || want === pol[i]) continue;
      const next = pol.slice();
      next[i] = want;
      if (addedOf(next) > budget) continue;
      const f = formaOf(next);
      const saving = drainAt(i, pol[i]) - drainAt(i, want) + capacityOf({ catalyst, progenitor, forma: f }) - capacityOf({ catalyst, progenitor, forma });
      if (saving > 0 && (!best || saving > best.saving)) best = { i, want, saving };
    }
    if (!best) return null;
    pol[best.i] = best.want;
  }
  return null;
}

/** The polarity the Forma plan gives the slot of a riven without a polarity (Omni: halved in any but Umbra). */
export const RIVEN_FORMA_POLARITY = 'AP_ATTACK';

/** Whether mods fit the capacity with at most `maxForma` Forma (capacityPlan() finds a plan). */
export const fitsCapacity = (env, mods) => capacityPlan(env, mods) !== null;

/**
 * The Forma a plan needs on top of the build as it is: [{ slot, from, to }] for each slot whose polarity changes
 * (codes, null for none), in slot order.
 */
export function formaChanges(env, plan) {
  if (!plan) return [];
  return plan.polarities
    .map((to, slot) => ({ slot, from: env.polarity.effective[slot] ?? null, to: to ?? null }))
    .filter(c => c.from !== c.to);
}

// ---------- engine input ----------

/** A freshly chosen arcane: max rank and the default (max) stacks, as the site equips it. */
export function arcaneEntryFor(data, name) {
  return normalizeArcaneEntry({ name, rank: arcaneMaxRank(name, data), options: defaultArcaneOptions(name, data) }, data);
}

/** "Build for Floor": crit and status floored to their guaranteed 100% tier, multishot to an integer. */
export function floorMode(m) {
  const tier = v => Math.floor((Number(v) || 0) / 100) * 100;
  return {
    ...m,
    finalCritChance: tier(m.finalCritChance),
    finalStatusChance: tier(m.finalStatusChance),
    perProjectileStatusChance: tier(m.perProjectileStatusChance),
    displayStatusChance: tier(m.displayStatusChance),
    finalMultishot: Math.max(1, Math.floor(Number(m.finalMultishot) || 1)),
  };
}

/** "Build for Single Shot/Hit": the forced fire rate (the engine is also told to fire once). */
export function singleShotMode(m) {
  const r = SINGLE_SHOT_FIRE_RATE;
  return { ...m, finalFireRate: r, effectiveFireRate: r, displayFireRate: r, baseFireRate: r, fire_rate: r };
}

/**
 * The engine input for a candidate ({ mods, arcanes }), as a JSON string: the live readout's input with the search's
 * sim time and modifiers. `appStateRef` names the app state each pool worker cached. `plain` skips the search
 * modifiers (the before/after comparison at the build's own settings).
 */
export function candidateInput(env, cand, { maxTime, appStateRef = 1, plain = false } = {}) {
  const arcanes = resolveArcanes(cand.arcanes ?? [], env.weapon, env.data);
  // Conditional mods count at the stacks their slot assumes: max for a candidate, as underframe.site scores them.
  const conditionals = conditionalsFor(env, cand.mods);
  // A candidate's own perks (Auto build trying them), else the build's.
  const { modes, incarnon } = computeWeaponStats(env.weapon, cand.mods, {
    modsByName: env.index.byName, reload: env.reload, targetFaction: env.enemy.faction, arcanes, external: env.external,
    externalStatuses: env.externalStatuses, conditionals, progenitor: env.progenitor, data: env.data,
    incarnon: cand.incarnon !== undefined ? cand.incarnon : env.incarnon, incarnonContext: env.incarnonContext,
  });
  let weaponStats = modes;
  const s = env.settings;
  if (!plain && s.buildForFloor) weaponStats = weaponStats.map(floorMode);
  if (!plain && s.buildForSingleHit) weaponStats = weaponStats.map(singleShotMode);
  const input = buildEngineInput({
    weapon: env.weapon, modSlots: cand.mods, weaponStats, enemy: env.enemy, modeName: env.modeName, customFireModes: env.customFireModes,
    maxTime: maxTime ?? s.simulationTimeSeconds, appStateRef, reload: env.reload, debugLog: false, arcanes, external: env.external,
    externalStatuses: env.externalStatuses, conditionals, incarnon,
  });
  if (!plain && s.buildForSingleHit) input.simulationParams.forceSingleShot = true;
  return JSON.stringify(input);
}

// ---------- the pipeline ----------

// A riven is its rolls (every riven of a family has the same name).
const slotKey = s => (s.isRiven ? `riven:${s.disposition}:${s.rank}:${(s.stats ?? []).map(x => `${x.name}=${x.value}`).join('|')}` : `${s.name}:${s.rank}${s.stacks != null ? `x${s.stacks}` : ''}`);
const modsKey = mods => mods.map(s => (s ? slotKey(s) : '')).join(',');
const incarnonKey = incarnon => (incarnonActive(incarnon) ? `|${JSON.stringify(incarnon)}` : '');
const namesIn = mods => mods.filter(Boolean).map(s => s.name);
const fmt = n => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const permutations = list => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p])));
function* combinations(list, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i <= list.length - (k - acc.length); i++) yield* combinations(list, k, i + 1, [...acc, list[i]]);
}

/**
 * Run Auto Build.
 * @param {object} env createAutoBuildEnv() output
 * @param {object} o
 * @param {{ mods: Array, arcanes: Array }} o.start the starting build: filled slots and a filled arcane slot are kept
 * @param {(jobs: Array<{ mods, arcanes, seeds: number[] }>) => Promise<number[]>} o.score mean metric per job (NaN: failed)
 * @param {{ aborted: boolean }} [o.signal] cancels the run (AutoBuildCancelled)
 * @param {number} [o.deadline] a time (o.now() units) after which the run stops searching and returns its best so far
 * @param {(p: { percent, step, detail, runs }) => void} [o.onProgress]
 * @param {() => number} [o.now] clock (Date.now)
 * @param {() => number} [o.random] seed source when Luck Averaged is off (Math.random)
 * @returns {Promise<{ mods, arcanes, score, metric, runs, stoppedEarly, log: string[], changed: boolean }>}
 */
export async function runAutoBuild(env, { start, score, signal = null, deadline = Infinity, onProgress = () => {}, now = Date.now, random = Math.random }) {
  const s = env.settings;
  const runs = b => runsFor(b, s.sampleSizeMultiplier);
  const log = [];
  let totalRuns = 0;
  let stoppedEarly = false;
  let percent = 0;
  let step = 'Initializing';
  const progress = (p, st, detail = '') => {
    if (p != null) percent = p;
    if (st) step = st;
    if (detail) log.push(detail);
    onProgress({ percent, step, detail, runs: totalRuns });
  };
  const checkCancel = () => { if (signal?.aborted) throw new AutoBuildCancelled(); };
  const timeUp = () => {
    if (!stoppedEarly && now() > deadline) {
      stoppedEarly = true;
      progress(null, null, 'Reached the time limit: finishing with the best build found so far.');
    }
    return stoppedEarly;
  };
  const seedsFor = n => (s.luckAveragedEnabled
    ? Array.from({ length: n }, (_, i) => i + 1)
    : Array.from({ length: n }, () => 1 + Math.floor(random() * 0xfffffffe)));
  /** Score candidates ({ mods, arcanes }) with n runs each. */
  const evaluate = async (cands, n) => {
    checkCancel();
    if (!cands.length) return [];
    const seeds = seedsFor(n);
    totalRuns += cands.length * n;
    const out = await score(cands.map(c => ({ mods: c.mods, arcanes: c.arcanes, ...(c.incarnon !== undefined ? { incarnon: c.incarnon } : {}), seeds })));
    checkCancel();
    return out.map(v => (Number.isFinite(v) ? v : NaN));
  };
  const one = async (cand, n) => (await evaluate([cand], n))[0];
  const argmax = values => {
    let best = -1;
    values.forEach((v, i) => { if (Number.isFinite(v) && (best < 0 || v > values[best])) best = i; });
    return best;
  };

  const elementalBlacklist = s.elementalBlacklistEnabled ? parseTargetList(s.elementalBlacklist, { dropEmpty: true }) : [];
  const blocked = mods => elementalBlacklist.length > 0 && blockedByElementalBlacklist(elementSignature(env, mods), elementalBlacklist);
  const fits = mods => !s.costControlEnabled || fitsCapacity(env, mods);
  const conflicts = (name, mods) => Boolean(conflictingMod(name, namesIn(mods), env.index));
  const rankVariants = mod => {
    const max = maxRank(mod);
    const half = Math.floor(max / 2);
    return s.costControlEnabled && half !== max ? [max, half] : [max];
  };

  // 0. Preparation: filled slots (with their stacks) and a filled arcane slot are locks; the Exilus slot is never filled.
  const startMods = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const m = start.mods?.[i];
    // A kept riven stays whole: its stats are the slot (docs/port-rivens.md).
    if (m?.isRiven) return m;
    return m ? { name: m.name, rank: m.rank, ...(m.stacks != null ? { stacks: m.stacks } : {}) } : null;
  });
  // The weapon's elemental augments (Biotic Rounds) go in at max rank and are kept, as on the site (step 4.0.3).
  const forced = [];
  for (const mod of elementalAugments(env)) {
    const name = mod['Local Name'];
    const at = startMods.findIndex(m => m?.name === name);
    if (at >= 0) { startMods[at] = { ...startMods[at], rank: maxRank(mod) }; continue; }
    const free = GENERAL_SLOTS.find(i => !startMods[i]);
    if (free == null || conflicts(name, startMods)) { log.push(`No free slot for ${name}; it was not forced in.`); continue; }
    startMods[free] = { name, rank: maxRank(mod) };
    forced.push(`${name} (slot ${free + 1})`);
  }
  if (forced.length) log.push(`Placed the weapon's elemental augment${forced.length > 1 ? 's' : ''}: ${forced.join(', ')}.`);
  const arcaneSlots = arcaneSlotCount(env.weapon);
  const startArcanes = Array.from({ length: arcaneSlots }, (_, i) => start.arcanes?.[i] ?? null);
  const locked = new Set(GENERAL_SLOTS.filter(i => startMods[i]));
  const emptySlots = GENERAL_SLOTS.filter(i => !startMods[i]);
  const arcaneLocked = arcaneSlots === 0 || Boolean(startArcanes[0]);
  const arcaneNames = arcaneLocked ? [] : env.pools.arcanes;
  const withArcane = (cand, name) => ({ ...cand, arcanes: startArcanes.map((a, i) => (i === 0 ? (name ? arcaneEntryFor(env.data, name) : null) : a)) });
  const eligible = (name, cand) => arcaneEligible(env, name, cand.mods, cand.incarnon);
  const arcaneOf = cand => cand.arcanes?.[0]?.name ?? null;
  progress(0, 'Initializing', `${emptySlots.length} empty ${emptySlots.length === 1 ? 'slot' : 'slots'} to fill${arcaneLocked ? '' : ' and the arcane slot'}.`);

  // A candidate carries its Incarnon perks: the build's, and those the run picks for empty evolutions.
  let base = { mods: startMods, arcanes: startArcanes, incarnon: env.incarnon };
  if (!emptySlots.length && arcaneLocked && !env.evolution.shouldRun) {
    progress(100, 'Done', 'Nothing to fill: every mod slot is kept and the arcane slot is filled.');
    return { ...base, score: NaN, metric: env.metric, runs: 0, stoppedEarly: false, log, changed: false };
  }

  // 1.5 Arcane pre-pass: every eligible arcane on the starting build; the ranked list is the fallback order.
  let ranked = [];
  let chosenArcane = null;
  if (arcaneLocked) progress(5, 'Step 1.5: Arcane', arcaneSlots ? `Existing arcane (${arcaneOf(base)}) kept; skipping optimization.` : 'No arcane slot; skipping.');
  else if (arcaneNames.length) {
    progress(5, 'Step 1.5: Arcane (10 samples)', `Testing ${arcaneNames.length} arcanes...`);
    const usable = arcaneNames.filter(n => eligible(n, base));
    const scores = await evaluate([base, ...usable.map(n => withArcane(base, n))], 10);
    const baseline = scores[0];
    ranked = usable.map((n, i) => ({ name: n, score: scores[i + 1] })).filter(r => Number.isFinite(r.score)).sort((a, b) => b.score - a.score);
    if (ranked[0] && (!Number.isFinite(baseline) || ranked[0].score > baseline)) {
      chosenArcane = ranked[0].name;
      progress(null, null, `Selected ${chosenArcane} (${fmt(ranked[0].score)}).`);
    } else progress(null, null, 'No arcane beats an empty slot on the starting build.');
  }
  /** Keep the chosen arcane where it works; otherwise the best still-eligible one from the ranked list. */
  const fallback = cand => {
    if (arcaneLocked) return cand;
    const current = arcaneOf(cand);
    if (current && eligible(current, cand)) return cand;
    const next = ranked.find(r => eligible(r.name, cand))?.name ?? null;
    return next === current ? cand : withArcane(cand, next);
  };
  if (!arcaneLocked) base = withArcane(base, chosenArcane);

  const place = (cand, list) => {
    const mods = cand.mods.slice();
    const free = GENERAL_SLOTS.filter(i => !mods[i]);
    list.forEach((m, i) => { mods[free[i]] = m; });
    return { ...cand, mods };
  };

  /** Fill empty general slots one at a time with the best greedy candidate (runs(b) per try). */
  const greedyFill = async (cand, b, label) => {
    let cur = cand;
    let last = NaN;
    for (;;) {
      checkCancel();
      if (timeUp()) break;
      const slot = GENERAL_SLOTS.find(i => !cur.mods[i]);
      if (slot == null) break;
      const tries = [];
      for (const mod of env.pools.greedy) {
        const name = mod['Local Name'];
        if (conflicts(name, cur.mods)) continue;
        for (const rank of rankVariants(mod)) {
          const mods = cur.mods.slice();
          mods[slot] = { name, rank };
          if (!fits(mods) || blocked(mods)) continue;
          tries.push({ ...cur, mods, name });
        }
      }
      if (!tries.length) break;
      const scores = await evaluate(tries, runs(b));
      const i = argmax(scores);
      if (i < 0) break;
      cur = { ...cur, mods: tries[i].mods };
      last = scores[i];
      progress(null, null, `${label}: added ${tries[i].name} (${fmt(scores[i])}).`);
    }
    return { cand: cur, last };
  };

  // 1.55 Secondaries: try Secondary Enervate against the current arcane on a Heat start.
  if (!arcaneLocked && env.weapon.type === 'Secondary' && s.elementalCandidatesEnabled && arcaneNames.includes('Secondary Enervate') && emptySlots.length) {
    const heat = env.pools.elemental
      .filter(m => elementSignature(env, [{ name: m['Local Name'], rank: maxRank(m) }]).join() === 'Heat' && !conflicts(m['Local Name'], base.mods))
      .sort((a, b) => maxRank(b) - maxRank(a))[0];
    if (heat) {
      progress(8, 'Step 1.55: Secondary Enervate', `Comparing ${arcaneOf(base) ?? 'no arcane'} with Secondary Enervate on ${heat['Local Name']}...`);
      const seeded = place(base, [{ name: heat['Local Name'], rank: maxRank(heat) }]);
      const a = (await greedyFill(seeded, 5, 'Enervate check')).cand;
      const bCand = (await greedyFill(withArcane(seeded, 'Secondary Enervate'), 5, 'Enervate check')).cand;
      const [sa, sb] = await evaluate([a, bCand], runs(5));
      if (Number.isFinite(sb) && (!Number.isFinite(sa) || sb > sa)) {
        chosenArcane = 'Secondary Enervate';
        ranked = [{ name: chosenArcane, score: sb }, ...ranked.filter(r => r.name !== chosenArcane)];
        base = withArcane(base, chosenArcane);
        progress(null, null, `Selected Secondary Enervate (${fmt(sb)}, +${fmt(sb - sa)}).`);
      } else progress(null, null, `Kept ${arcaneOf(base) ?? 'no arcane'} (${fmt(sa)}).`);
    }
  }

  // 2.1 Base element probe (reported only, as on the site).
  const k = Math.min(3, emptySlots.length);
  if (s.elementalCandidatesEnabled && k > 0 && !timeUp()) {
    progress(11, `Step 2.1: Best base element (${runs(10)} samples)`, 'Testing Heat, Cold, Toxin, Electricity...');
    const probes = [];
    for (const el of ['Heat', 'Cold', 'Toxin', 'Electricity']) {
      const mod = env.pools.elemental
        .filter(m => elementSignature(env, [{ name: m['Local Name'], rank: maxRank(m) }])[0] === el && !conflicts(m['Local Name'], base.mods))
        .sort((a, b) => maxRank(b) - maxRank(a))[0];
      if (mod) probes.push({ el, cand: fallback(place(base, [{ name: mod['Local Name'], rank: maxRank(mod) }])) });
    }
    const scores = await evaluate(probes.map(p => p.cand), runs(10));
    const i = argmax(scores);
    if (i >= 0) progress(15, null, `Best base element is ${probes[i].el}.`);
  }

  // 2.2 Compositions: every ordering of 1-3 distinct elemental mods whose final elements equal a target exactly.
  const targets = elementalTargets(env);
  const bases = [];
  // The weapon's own elements (no mods at all), as the site compares zero-mod starting points.
  const pure = elementSignature(env, Array(SLOT_COUNT).fill(null));
  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const jobs = [];
  if (!timeUp()) {
    progress(20, `Step 2.2: Finding best compositions (${runs(10)} samples)`, `Testing ${targets.length} element targets...`);
    for (const p of targets) {
      if (p.name === 'No Element') {
        bases.push({ name: 'No Element', cand: base, target: p.target });
        continue;
      }
      if (pure.length && sameSet(p.target, pure) && !bases.some(b => b.name === p.name && b.zero)) bases.push({ name: p.name, cand: base, target: p.target, zero: true });
      const from = p.numSlots ?? 1;
      const to = p.numSlots ?? k;
      for (let n = from; n <= to; n++) {
        if (n > emptySlots.length) break;
        for (const combo of combinations(env.pools.elemental, n)) {
          for (const perm of permutations(combo)) {
            const equipped = namesIn(base.mods);
            let ok = true;
            const set = [...equipped];
            for (const mod of perm) {
              const name = mod['Local Name'];
              if (equipped.includes(name) || conflictingMod(name, set, env.index)) { ok = false; break; }
              set.push(name);
            }
            if (!ok) continue;
            const cand = place(base, perm.map(m => ({ name: m['Local Name'], rank: maxRank(m) })));
            if (!fits(cand.mods) || blocked(cand.mods)) continue;
            if (!sameSet(elementSignature(env, cand.mods), p.target)) continue;
            jobs.push({ p, n, cand: fallback(cand), combo: perm.map(m => m['Local Name']) });
          }
        }
      }
    }
    const scores = await evaluate(jobs.map(j => j.cand), runs(10));
    const best = new Map();
    jobs.forEach((j, i) => {
      const key = `${j.p.name}_${j.n}`;
      if (Number.isFinite(scores[i]) && (!best.has(key) || scores[i] > best.get(key).score)) best.set(key, { ...j, score: scores[i] });
    });
    for (const b of best.values()) bases.push({ name: `${b.p.name} (${b.n} ${b.n === 1 ? 'mod' : 'mods'})`, cand: b.cand, target: b.p.target });
    progress(35, null, `${bases.length} starting points: ${bases.map(b => b.name).join(', ')}.`);
  }
  if (!bases.length) bases.push({ name: 'No Element', cand: base, target: pure });

  /**
   * Incarnon perks (the site's evolution steps): each evolution without a kept perk takes its data priority (the
   * headshot one with headshots on), else the perk that scores best with the others as they are, evolution by
   * evolution. `final` re-scores the result (step 4.3). Runs are scaled twice, as on the site.
   */
  const pickPerks = async (cand, final = false) => {
    const n = runs(runs(20));
    let incarnon = cand.incarnon;
    let latest = null;
    for (const evo of env.evolution.evolutions) {
      checkCancel();
      const set = p => withPerk(env.data, env.weapon, incarnon, evo.number, p);
      if (env.evolution.locked.has(evo.number)) { incarnon = set(env.evolution.locked.get(evo.number)); continue; }
      if (!evo.perks.length) { incarnon = set(null); continue; }
      const numbers = evo.perks.map(p => p.number);
      const priority = [env.enemy.headshot ? evo.headshotPriority : null, evo.priority].find(p => p && numbers.includes(p));
      if (priority) { incarnon = set(priority); continue; }
      const tries = numbers.map(p => ({ ...cand, incarnon: set(p) }));
      const scores = await evaluate(tries, n);
      let best = -1;
      scores.forEach((v, i) => { if (Number.isFinite(v) && (best < 0 || v > scores[best])) best = i; });
      incarnon = tries[Math.max(0, best)].incarnon;
      if (best >= 0) latest = scores[best];
    }
    const next = { ...cand, incarnon };
    return { cand: next, score: latest == null || final ? await one(next, n) : latest };
  };
  const perkCount = cand => env.evolution.evolutions.filter(e => !env.evolution.locked.has(e.number) && cand.incarnon?.[`evolution_${e.number}_perk`]).length;

  // 2.7 Incarnon perks for every starting point.
  if (env.evolution.shouldRun && !timeUp()) {
    progress(33, `Step 2.7: Evolution optimization (${runs(runs(20))} samples)`, `Evaluating ${bases.length} candidates...`);
    for (const b of bases) {
      if (timeUp()) break;
      b.cand = (await pickPerks(b.cand)).cand;
      const k = perkCount(b.cand);
      progress(null, null, `${b.name}: ${k ? `picked ${k} ${k === 1 ? 'perk' : 'perks'}` : 'no changes needed'}.`);
    }
  }

  // 3. Greedy fill from every starting point.
  const filled = [];
  for (let i = 0; i < bases.length; i++) {
    if (timeUp()) break;
    const b = bases[i];
    progress(35 + Math.round((35 * i) / bases.length), `Step 3: Greedy fill (${runs(10)} samples)`, `Filling ${b.name}...`);
    const { cand, last } = await greedyFill(fallback(b.cand), 10, b.name);
    const done = fallback(cand);
    if (stoppedEarly) {
      // Cut off mid-fill: keep it with the score of its last step, so the time limit never loses the best so far.
      if (Number.isFinite(last)) filled.push({ name: b.name, cand: done, score: last });
      break;
    }
    filled.push({ name: b.name, cand: done, score: await one(done, runs(5)) });
  }
  if (!filled.length) filled.push({ name: 'Start', cand: fallback(base), score: stoppedEarly ? NaN : await one(fallback(base), runs(5)) });

  // 4-5. The top 3: re-fill (normally nothing is left), re-score, re-optimise the arcane.
  const byScore = (a, b) => (Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity);
  let top = filled.slice().sort(byScore).slice(0, 3);
  const optimizeArcane = async (cand, current, perArcane, finalRuns) => {
    if (arcaneLocked || !arcaneNames.length) return { cand, score: current };
    const usable = arcaneNames.filter(n => eligible(n, cand));
    const scores = await evaluate([cand, ...usable.map(n => withArcane(cand, n))], perArcane);
    const i = argmax(scores.slice(1));
    if (i < 0 || !(scores[i + 1] > scores[0])) {
      progress(null, null, 'No better arcane found.');
      return { cand, score: current };
    }
    const next = withArcane(cand, usable[i]);
    const s2 = await one(next, finalRuns);
    if (Number.isFinite(s2) && (!Number.isFinite(current) || s2 > current)) {
      progress(null, null, `Selected ${usable[i]} (${fmt(s2)}, +${fmt(s2 - current)}).`);
      return { cand: next, score: s2 };
    }
    progress(null, null, `${usable[i]} tested; keeping ${arcaneOf(cand) ?? 'no arcane'}.`);
    return { cand, score: current };
  };
  if (!stoppedEarly) {
    progress(70, `Step 4: Top ${top.length} (${runs(50)} samples)`, `Re-scoring ${top.map(t => t.name).join(', ')}...`);
    const refilled = [];
    for (const t of top) {
      const { cand } = await greedyFill(t.cand, 30, t.name);
      refilled.push({ ...t, cand: fallback(cand) });
    }
    if (!stoppedEarly) {
      const scores = await evaluate(refilled.map(t => t.cand), runs(50));
      top = refilled.map((t, i) => ({ ...t, score: Number.isFinite(scores[i]) ? scores[i] : t.score }));
      // 4.3 The perks again, on the filled builds, and their score.
      if (env.evolution.shouldRun) {
        progress(81, `Step 4.3: Evolution re-evaluation (${runs(runs(20))} samples)`, `Re-testing ${top.length} candidates...`);
        for (let i = 0; i < top.length; i++) {
          if (timeUp()) break;
          const r = await pickPerks(top[i].cand, true);
          top[i] = { ...top[i], cand: r.cand, score: Number.isFinite(r.score) ? r.score : top[i].score };
          progress(null, null, `${top[i].name}: evolution perks updated.`);
        }
        top.sort(byScore);
      }
      for (let i = 0; i < top.length; i++) {
        if (timeUp()) break;
        progress(87 + Math.round((8 * i) / top.length), `Step 5: Arcane for ${top[i].name} (${runs(30)} samples)`);
        const r = await optimizeArcane(top[i].cand, top[i].score, runs(30), runs(50));
        top[i] = { ...top[i], cand: r.cand, score: r.score };
      }
    } else top = refilled;
  }

  // 6. The winner.
  progress(95, 'Step 6: Selecting the best build');
  let best = top.slice().sort(byScore)[0];
  let bestScore = best.score;
  let cur = best.cand;
  progress(null, null, `Best: ${best.name} (${fmt(bestScore)}).`);

  // 7. Final refinement: replace the least useful auto-placed mod while it helps (one slot per iteration).
  if (s.finalRefinementEnabled && !timeUp()) {
    const n = s.finalRefinementSampleSize;
    progress(97, `Step 7: Final refinement (${n} samples)`);
    const restrict = s.elementalCandidatesEnabled && s.specificElementalCandidatesEnabled && parseTargetList(s.specificElementalTargets).length > 0;
    const sig = mods => elementSignature(env, mods).join('|');
    bestScore = await one(cur, n);
    for (let iter = 0; iter < REFINEMENT_ITERATIONS; iter++) {
      if (timeUp()) break;
      const swappable = GENERAL_SLOTS.filter(i => cur.mods[i] && !locked.has(i));
      if (!swappable.length) { progress(null, null, 'No auto-slotted mods to refine. Finalizing.'); break; }
      const without = swappable.map(i => ({ i, cand: { ...cur, mods: cur.mods.map((m, j) => (j === i ? null : m)) } }));
      const removal = await evaluate(without.map(w => w.cand), n);
      const w = argmax(removal);
      if (w < 0 || timeUp()) break;
      const slot = without[w].i;
      const removed = cur.mods[slot].name;
      const holed = without[w].cand.mods;
      const tries = [];
      for (const mod of env.pools.refinement) {
        const name = mod['Local Name'];
        if (conflicts(name, holed)) continue;
        for (const rank of rankVariants(mod)) {
          const mods = holed.slice();
          mods[slot] = { name, rank };
          if (!fits(mods) || blocked(mods)) continue;
          if (restrict && sig(mods) !== sig(cur.mods)) continue;
          const arcane = arcaneOf(cur);
          if (arcane && !arcaneEligible(env, arcane, mods, cur.incarnon)) continue;
          tries.push({ ...cur, mods, name, rank });
        }
      }
      const scores = await evaluate(tries, n);
      const i = argmax(scores);
      if (i < 0 || !(scores[i] > bestScore)) {
        progress(null, null, `No further improvements found for ${removed}. Finalizing build.`);
        break;
      }
      progress(null, null, `Swapped ${removed} for ${tries[i].name}. ${fmt(bestScore)} -> ${fmt(scores[i])}.`);
      cur = { ...cur, mods: tries[i].mods };
      bestScore = scores[i];
    }
    const after = fallback(cur);
    if (after !== cur) {
      cur = after;
      if (!timeUp()) bestScore = await one(cur, runs(30));
    }
  }

  // 8. Final arcane check.
  if (!stoppedEarly && !arcaneLocked) {
    progress(98, `Step 8: Final arcane check (${runs(30)} samples)`);
    const r = await optimizeArcane(cur, bestScore, runs(30), runs(50));
    cur = r.cand;
    bestScore = r.score;
  }

  // 9. Quality-of-life swaps, without simulating.
  progress(99, 'Step 9: Final quality-of-life swaps');
  cur = qualityOfLifeSwaps(env, cur, locked, { fits, blocked, onSwap: text => progress(null, null, text) });

  if (blocked(cur.mods)) throw new Error('The final build was rejected by the elemental blacklist.');
  const incarnon = cur.incarnon ?? null;
  const perksChanged = incarnonKey(incarnon) !== incarnonKey(env.incarnon);
  const changed = modsKey(cur.mods) !== modsKey(startMods) || arcaneOf(cur) !== (startArcanes[0]?.name ?? null) || perksChanged;
  progress(100, 'Done', `Finished. Best ${env.metric === 'avgDps' ? 'DPS' : 'score'}: ${fmt(bestScore)}.`);
  return { mods: cur.mods, arcanes: cur.arcanes, incarnon, score: bestScore, metric: env.metric, runs: totalRuns, stoppedEarly, log, changed };
}

/**
 * Whether a run would have nothing to do: every general slot filled and kept (`keep`: a Set of slot indexes), the
 * arcane filled and kept (or no arcane slot at all), and no Incarnon evolution waiting for a perk (with `data`).
 */
export function nothingToFill(build, weapon, keep, keepArcane, data = null) {
  const mods = GENERAL_SLOTS.every(i => build.mods?.[i] && keep.has(i));
  const arcane = !arcaneSlotCount(weapon) || (Boolean(build.arcanes?.[0]) && keepArcane);
  return mods && arcane && !(data && autoEvolution(data, weapon, build.incarnon).shouldRun);
}

/**
 * The conditional mods (Galvanized and the like) among `mods` and the stacks they were scored at, each once, in slot
 * order: "Galvanized Chamber at 5 stacks (On Kill)", "Laser Sight on (On Headshot)".
 */
export function conditionalModStacks(data, mods) {
  const seen = new Set();
  const out = [];
  for (const m of mods ?? []) {
    const c = m && !seen.has(m.name) ? modConditionalControls(m.name, data) : null;
    if (!c) continue;
    seen.add(m.name);
    const text = modStacksText(m, data);
    out.push(`${m.name} ${c.max === 1 ? text.toLowerCase() : `at ${text}`}${c.trigger ? ` (${c.trigger})` : ''}`);
  }
  return out;
}

/** Same stats at max rank (type, element and value), for the conditional -> plain swap. */
const statsSignature = mod => (mod?.Stats ?? [])
  .map(st => `${st.UpgradeType}|${st.DamageType ?? ''}|${Math.round(statValue(st, maxRank(mod)) * 1e4)}`)
  .sort().join(';');

/**
 * Step 9 (docs/port-auto-build.md 4.7): Heavy Caliber -> Serration, and a conditional mod -> a plain mod with the same
 * stats at max rank. Only auto-placed slots; never weapon augments or the combo/bleed mods.
 */
export function qualityOfLifeSwaps(env, cand, locked, { fits = () => true, blocked = () => false, onSwap = () => {} } = {}) {
  const conditional = new Set([...(env.data.conditionals?.galvanized_mods ?? []), ...(env.data.conditionals?.misc_mods ?? [])].map(c => c.name));
  const allowed = new Map(env.pools.allowed.map(m => [m['Local Name'], m]));
  let mods = cand.mods.slice();
  const swaps = [];
  const trySwap = (slot, name) => {
    const next = mods.slice();
    next[slot] = { name, rank: maxRank(allowed.get(name)) };
    const others = next.map((m, i) => (i === slot ? null : m?.name ?? null));
    if (conflictingMod(name, others, env.index) || !fits(next) || blocked(next)) return false;
    swaps.push(`${mods[slot].name} -> ${name}`);
    mods = next;
    return true;
  };
  for (const slot of GENERAL_SLOTS) {
    const m = mods[slot];
    if (!m || locked.has(slot)) continue;
    if (m.name === 'Heavy Caliber' && allowed.has('Serration') && !mods.some(x => x?.name === 'Serration')) { trySwap(slot, 'Serration'); continue; }
    const mod = env.index.byName.get(m.name);
    if (!conditional.has(m.name) || QOL_KEEP.has(m.name) || isAugment(mod) || m.rank !== maxRank(mod)) continue;
    const sig = statsSignature(mod);
    const plain = env.pools.allowed.find(x => !conditional.has(x['Local Name']) && x['Local Name'] !== m.name && statsSignature(x) === sig && !mods.some(e => e?.name === x['Local Name']));
    if (plain) trySwap(slot, plain['Local Name']);
  }
  if (swaps.length) onSwap(`Swapped: ${swaps.join(', ')}.`);
  return { ...cand, mods };
}

/** The mod on `mods` (slot objects) that `name` conflicts with (itself, or an incompatible one), or null. */
export const conflictingModIn = (name, mods, index) => conflictingMod(name, mods.map(m => m?.name ?? null), index);

/** Split jobs into tasks of at most RUNS_PER_CHUNK runs: [{ job, seeds }]. */
export function chunkJobs(jobs, size = RUNS_PER_CHUNK) {
  const out = [];
  jobs.forEach((job, j) => {
    for (let i = 0; i < job.seeds.length; i += size) out.push({ job: j, seeds: job.seeds.slice(i, i + size) });
  });
  return out;
}

/** Combine task results ({ sum, count }) into a mean per job (NaN when no run of a job succeeded). */
export function meansOf(jobCount, tasks, results) {
  const sum = new Float64Array(jobCount);
  const count = new Float64Array(jobCount);
  tasks.forEach((t, i) => {
    const r = results[i];
    if (!r) return;
    sum[t.job] += r.sum;
    count[t.job] += r.count;
  });
  return Array.from(sum, (v, i) => (count[i] ? v / count[i] : NaN));
}

/** Name of the elements of a build's signature ("Viral Heat"), for messages. */
export const signatureName = (env, mods) => targetLabel(elementSignature(env, mods));
