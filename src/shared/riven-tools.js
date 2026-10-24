// Riven tools (docs/port-rivens.md 13): underframe.site's Slot My Riven, Auto Riven, Get Rolls Data and Left/Right
// compare, in our own code. Each places a riven (one of the user's, or a "theoretical" riven rolled at a chosen
// strength) into the build's slots, scores every placement with the engine and reports the best, never touching the
// build itself: the caller applies the result as one undo step.
//
// Pure: the engine is behind an injected `score(jobs)` (the Auto Build engine pool in the app, a fake in tests), and
// `env` is createAutoBuildEnv() output, so candidates go to the engine exactly as Auto Build's and the Readout's do.
import {
  AutoBuildCancelled, EXILUS_SLOT, arcaneEligible, conflictingModIn, elementSignature, fitsCapacity, hasDpsStat, isAugmentMod,
  modAllowed, fitsWeapon,
} from './auto-build.js';
import { maxRank } from './mods.js';
import { modStatFamilies } from './auto-build-settings.js';
import {
  SPLICED_STATS, isRiven, rivenFamily, rivenName, rivenStatCatalogue, rivenStatLabel, rivenStatUnit, validateRiven,
} from './rivens.js';

// ---------- the site's constants ----------

/** Runs per candidate (the setup's "Samples"): 50 by default, 1-200. */
export const ROLL_RUNS = Object.freeze({ default: 50, min: 1, max: 200 });
/** Simulated seconds per run: 5 by default, as Auto Build's own range. */
export const ROLL_SIM_TIME = Object.freeze({ default: 5, min: 1, max: 300 });
/**
 * How strong a theoretical riven rolls, in ten-thousandths of the stat's mid value: 11000 (the top of the range,
 * 110%) by default, 9000-11000.
 */
export const ROLL_STAT_VALUE = Object.freeze({ default: 11000, min: 9000, max: 11000, scale: 10000 });
/** At most this many positives can be forced into every roll. */
export const ROLL_FORCED_LIMIT = 2;
/** Theoretical rivens and placements go to the pool in batches of this many (for progress and Cancel). */
export const ROLL_BATCH = 250;
/** Baseline runs of each tool, as on the site. */
export const BASELINE_RUNS = Object.freeze({ slot: 50, auto: 20, rolls: 24, compare: 50 });
/** Minor build tweaks (the site's ROLL_MINOR_TWEAK_*). */
export const TWEAK = Object.freeze({
  maxSwaps: 3,
  shortlistSize: 8,
  autoGlobal: 8,
  autoPerSlot: 2,
  autoFinalists: 5,
  rollsGlobal: 40,
  rollsPerSlot: 8,
  shortlistRuns: 5,
  removalRuns: 6,
  improvement: 0.0025,
});

/** The tools: what the setup shows, its title and Start button, as on the site. */
export const RIVEN_TOOL_MODES = Object.freeze({
  rolls: {
    id: 'rolls', title: 'Rolls scan setup', start: 'Start', requiresNegative: true,
    sections: ['protected', 'positive', 'forced', 'negative', 'optimization', 'preserveElemental', 'samples', 'simulationTime', 'statValue', 'minorTweaks'],
  },
  auto: {
    id: 'auto', title: 'Auto riven setup', start: 'Start Auto riven', requiresNegative: false,
    sections: ['protected', 'positive', 'forced', 'negative', 'optimization', 'preserveElemental', 'samples', 'simulationTime', 'statValue', 'minorTweaks'],
  },
  slot: {
    id: 'slot', title: 'Slot my riven', start: 'Start slotting', requiresNegative: false,
    sections: ['excludeSlots', 'positive', 'samples', 'simulationTime'],
  },
  compare: { id: 'compare', title: 'Compare two rivens', start: 'Compare', requiresNegative: false, sections: [] },
});

/** The site's messages, word for word where it has one. */
export const RIVEN_TOOL_MESSAGES = Object.freeze({
  equipped: tool => `${tool} cannot run while a Riven mod is currently equipped.`,
  noLibrary: 'You have no rivens for this weapon in your library.',
  allExcluded: 'No rivens remain after excluding the selected stats.',
  noPlacements: 'No eligible slot/riven combinations are available to evaluate.',
  notOptimal: 'Your riven is not optimal to slot in this build.',
  tooManyForced: `You can only force up to ${ROLL_FORCED_LIMIT} positive stats.`,
  splicedForced: 'Only one spliced positive trait can be forced.',
  forcedMissing: 'One or more forced positive stats are not available for this build.',
  fewPositives: 'Not enough positive stats are available to generate rolls.',
  fewAfterExclusions: 'Not enough positive stats remain after exclusions to satisfy the forced selections.',
  forcedUnsatisfiable: 'Not enough positive stats remain to satisfy the forced selections.',
  noNegatives: 'No negative stats are available to generate rolls.',
  negativeMissing: 'The selected negative stat is not available for this weapon.',
  needNegative: 'Select a negative stat to continue.',
  noSwappable: 'No eligible mods remain to replace after applying current restrictions.',
  noSlots: 'No eligible mod slots remain after applying protected mods.',
  noneKeepElements: 'No Riven candidates preserve the current elemental combo under the selected restrictions.',
  none: 'No Riven candidates are available under the selected restrictions.',
  noShortlist: 'Minor tweak shortlist could not be generated.',
  noImprovement: 'No optimal Riven found that improves DPS over the current build.',
  changedElements: 'The final candidate changed the elemental combo and was rejected.',
  noRolls: 'No rolls could be evaluated with the current criteria.',
  noRivenType: weapon => `${weapon} takes no riven.`,
});

/** The gun stats a roll scan tries as positives, in the site's group order (ROLL_GROUPS, gun). */
export const ROLL_POSITIVE_STATS = Object.freeze([
  'BaseDamage', 'Critical Chance', 'Critical Damage', 'Status Chance', 'Multishot', 'Punch Through', 'Fire Rate/Attack Speed',
  'ColdDamage', 'HeatDamage', 'ElectricityDamage', 'ToxinDamage', 'ViralDamage', 'CorrosiveDamage', 'MagneticDamage',
  'RadiationDamage', 'GasDamage', 'BlastDamage',
  'Damage vs.Corpus', 'Damage vs.Grineer', 'Damage vs.Infested', 'Damage vs.Orokin', 'Damage vs.Techrot', 'Damage vs.Scaldra',
  'Status Damage', 'Weak Point Damage', 'Weak Point Critical Chance', 'Ammo Efficiency', 'Magazine Reload While Holstered',
]);

/** The negative a scan tries first: Zoom, which changes nothing a simulation sees. */
export const DEFAULT_NEGATIVE = 'Zoom';

/** Mid-roll multipliers of a theoretical riven (always one negative): 2 or 3 positives. */
const THEORETICAL_MULTIPLIERS = { 2: { pos: 1.2375, neg: -0.495 }, 3: { pos: 0.9375, neg: -0.75 } };

/** The stat families a positive stat counts for (the site's ROLL_STAT_FAMILY_MAP): what a minor tweak may give up. */
const ROLL_STAT_FAMILY = {
  BaseDamage: 'damage', 'Critical Chance': 'critChance', 'Critical Damage': 'critDamage', 'Status Chance': 'statusChance',
  Multishot: 'multishot', 'Punch Through': 'punchThrough', 'Fire Rate/Attack Speed': 'speed', ColdDamage: 'cold', HeatDamage: 'heat',
  ElectricityDamage: 'electricity', ToxinDamage: 'toxin', ViralDamage: 'viral', CorrosiveDamage: 'corrosive', MagneticDamage: 'magnetic',
  RadiationDamage: 'radiation', GasDamage: 'gas', BlastDamage: 'blast',
  'Damage vs.Corpus': 'faction', 'Damage vs.Grineer': 'faction', 'Damage vs.Infested': 'faction', 'Damage vs.Orokin': 'faction',
  'Damage vs.Techrot': 'faction', 'Damage vs.Scaldra': 'faction',
};

const GENERAL_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const intIn = (v, r) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Math.round(Number(v)), r.min, r.max) : r.default);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const pct = (v, base) => (base > 0 && Number.isFinite(v) ? Math.round(((v - base) / base) * 10000) / 100 : null);

// ---------- options ----------

/**
 * The setup's choices, cleaned: slots as indexes 0-7, stats as riven stat keys, counts clamped to their ranges, the
 * optimisation flags with raw and status damage exclusive (raw wins, as the site's toggles keep one at a time).
 */
export function normalizeRivenToolOptions(raw = {}) {
  const slots = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(i => GENERAL_SLOTS.includes(i)))];
  const stats = list => [...new Set((Array.isArray(list) ? list : []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))];
  const o = raw.optimization ?? {};
  const rawDamage = o.buildForRawDamage === true;
  return {
    protectedSlots: slots(raw.protectedSlots),
    excludedSlots: slots(raw.excludedSlots),
    excludedStats: stats(raw.excludedStats),
    forcedPositiveStats: stats(raw.forcedPositiveStats),
    negativeStat: typeof raw.negativeStat === 'string' && raw.negativeStat.trim() ? raw.negativeStat.trim() : null,
    sampleCount: intIn(raw.sampleCount, ROLL_RUNS),
    simulationTimeSeconds: intIn(raw.simulationTimeSeconds, ROLL_SIM_TIME),
    statValue: intIn(raw.statValue, ROLL_STAT_VALUE),
    optimization: {
      buildForRawDamage: rawDamage,
      buildForStatusDamage: !rawDamage && o.buildForStatusDamage === true,
      buildForFloor: o.buildForFloor === true,
      buildForSingleHit: o.buildForSingleHit === true,
    },
    allowMinorBuildTweaks: raw.allowMinorBuildTweaks === true,
    preserveElementalCombo: raw.preserveElementalCombo !== false,
  };
}

/** The Auto Build settings a tool scores with: the user's, at the tool's sim time and optimisation, runs seeded 1..n. */
export function rivenToolSettings(settings, options, { plain = false } = {}) {
  const o = plain ? {} : options.optimization;
  return {
    ...settings,
    simulationTimeSeconds: options.simulationTimeSeconds,
    buildForRawDamage: o.buildForRawDamage === true,
    buildForStatusDamage: o.buildForStatusDamage === true,
    buildForFloor: o.buildForFloor === true,
    buildForSingleHit: o.buildForSingleHit === true,
    luckAveragedEnabled: true,
  };
}

// ---------- stats and theoretical rivens ----------

/** The positives a scan may roll for a weapon: the site's list, kept to the stats the weapon's rivens have. */
export function rollPositiveStats(data, weapon) {
  const have = new Set(rivenStatCatalogue(data, weapon).map(e => e.key));
  return ROLL_POSITIVE_STATS.filter(s => have.has(s));
}

/** The negatives a scan may roll: every stat of the weapon's rivens but Punch Through, elements and spliced stats. */
export function rollNegativeStats(data, weapon) {
  return rivenStatCatalogue(data, weapon).filter(e => e.negativeAllowed).map(e => e.key).sort((a, b) => a.localeCompare(b));
}

/** "BaseDamage" -> "Damage", "Damage vs.Grineer" -> "Damage vs. Grineer" (the site's roll labels). */
export const rollStatLabel = rivenStatLabel;

/** Forced positives, each once; more than two, or two spliced ones, throw the site's message. */
export function normalizeForcedPositives(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s || out.includes(s)) continue;
    if (out.length >= ROLL_FORCED_LIMIT) throw new Error(RIVEN_TOOL_MESSAGES.tooManyForced);
    out.push(s);
  }
  if (out.filter(s => SPLICED_STATS.has(s)).length > 1) throw new Error(RIVEN_TOOL_MESSAGES.splicedForced);
  return out;
}

function* choose(list, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i <= list.length - (k - acc.length); i++) yield* choose(list, k, i + 1, [...acc, list[i]]);
}

/**
 * Every set of 2 and 3 positives from `available`, each holding all the forced ones. Sets with two spliced stats are
 * kept here (a riven can't roll them: theoreticalRiven() returns null for them, as on the site).
 */
export function positiveCombos(available, forced = []) {
  const stats = [...new Set((available ?? []).filter(Boolean))];
  const must = normalizeForcedPositives(forced);
  if (stats.length < 2) return [];
  if (must.some(s => !stats.includes(s))) throw new Error(RIVEN_TOOL_MESSAGES.forcedMissing);
  const rest = stats.filter(s => !must.includes(s));
  const out = [];
  for (let size = Math.max(2, must.length); size <= 3; size++) {
    for (const extra of choose(rest, size - must.length)) out.push([...must, ...extra]);
  }
  if (!out.length) throw new Error(RIVEN_TOOL_MESSAGES.forcedUnsatisfiable);
  return out;
}

/** The families a set of positives counts for. */
export function positiveFamilies(stats) {
  return new Set((stats ?? []).map(s => ROLL_STAT_FAMILY[s]).filter(Boolean));
}

/**
 * A riven as the site imagines one: the positives and one negative at `statMultiplier` of their mid roll (0.9-1.1),
 * disposition 1.2 and rank 8 (the site's defaults). Null when the weapon takes no riven, a stat isn't on its list,
 * or the roll is impossible (two spliced positives, a spliced negative, other than 2-3 positives).
 */
export function theoreticalRiven(data, weapon, positives, negative, statMultiplier = ROLL_STAT_VALUE.default / ROLL_STAT_VALUE.scale, id = 'optimal_riven') {
  const catalogue = new Map(rivenStatCatalogue(data, weapon).map(e => [e.key, e]));
  const mult = THEORETICAL_MULTIPLIERS[positives?.length];
  if (!catalogue.size || !mult || !negative) return null;
  if (positives.filter(s => SPLICED_STATS.has(s)).length > 1 || SPLICED_STATS.has(negative)) return null;
  const m = clamp(Number.isFinite(statMultiplier) ? statMultiplier : 1.1, ROLL_STAT_VALUE.min / ROLL_STAT_VALUE.scale, ROLL_STAT_VALUE.max / ROLL_STAT_VALUE.scale);
  const stat = (key, k) => {
    const e = catalogue.get(key);
    return e ? { name: key, value: e.base * k * m, unit: rivenStatUnit(key, e.unit) } : null;
  };
  const stats = [...positives.map(s => stat(s, mult.pos)), stat(negative, mult.neg)];
  if (stats.some(s => !s)) return null;
  const family = rivenFamily(weapon.name);
  return { isRiven: true, id, name: rivenName(family), family, disposition: 1.2, rank: 8, stats };
}

// ---------- slots and checks ----------

/** General slots (0-7) a tool may put a riven into: filled ones only unless `empty`, never a riven's, never `skip`. */
export function rivenToolSlots(mods, { skip = [], empty = true } = {}) {
  const no = new Set(skip);
  return GENERAL_SLOTS.filter(i => !no.has(i) && !isRiven(mods[i]) && (empty || mods[i]));
}

const withSlot = (mods, i, slot) => mods.map((m, j) => (j === i ? slot : m));

/** Whether a candidate keeps its arcanes working (an element-gated arcane needs its element). */
function arcanesHold(env, mods, arcanes) {
  return (arcanes ?? []).filter(Boolean).every(a => arcaneEligible(env, a.name, mods));
}

/**
 * A run's shared state: the build, a progress reporter, cancel checks and the scorer. Every candidate in one call
 * shares seeds 1..n, so placements are compared on the same rolls of the dice.
 */
function createRun(env, { build, score, signal, onProgress }) {
  const run = {
    env,
    mods: build.mods.slice(),
    arcanes: build.arcanes ?? [],
    runs: 0,
    percent: 0,
    step: '',
    progress(percent, step, detail = '') {
      if (percent != null) run.percent = Math.max(run.percent, Math.min(100, percent));
      if (step) run.step = step;
      onProgress({ percent: run.percent, step: run.step, detail, runs: run.runs });
    },
    check() { if (signal?.aborted) throw new AutoBuildCancelled(); },
    /** Mean metric per candidate mod list (NaN where every run failed), `n` runs each, in batches. */
    async score(modLists, n, { from = null, to = null, label = null } = {}) {
      const out = [];
      const seeds = Array.from({ length: n }, (_, i) => i + 1);
      for (let i = 0; i < modLists.length; i += ROLL_BATCH) {
        run.check();
        const batch = modLists.slice(i, i + ROLL_BATCH);
        run.runs += batch.length * n;
        const r = await score(batch.map(mods => ({ mods, arcanes: run.arcanes, seeds })));
        run.check();
        out.push(...r.map(v => (Number.isFinite(v) ? v : NaN)));
        if (from != null) run.progress(from + ((to - from) * out.length) / modLists.length, label, `Simulated ${out.length} of ${modLists.length}`);
      }
      return out;
    },
    signature: mods => elementSignature(env, mods),
  };
  return run;
}

// ---------- minor build tweaks ----------

const isConclave = mod => /\/pvp/i.test(String(mod?.['Path Name'] ?? '')) || /\/pvp\//i.test(String(mod?.Icon ?? ''));

/**
 * The mods a minor tweak may swap in (the site's replacement pool): allowed by the run's lists, of the weapon's own mod
 * type and compatible, not Exilus or Conclave, and a weapon augment or a mod with a DPS stat.
 */
export function tweakPool(env) {
  const type = String(env.weapon.type ?? '').toUpperCase();
  return env.data.mods.filter(m => m?.['Local Name'] && Array.isArray(m.Stats) && modAllowed(env, m) && !env.exilus.has(m['Local Name'])
    && !isConclave(m) && String(m.Type ?? '').toUpperCase() === type && fitsWeapon(m, env.weapon) && (isAugmentMod(m) || hasDpsStat(m)));
}

/** The ranks a swapped-in mod is tried at: max, and half with Cost Control (it may have to fit). */
const tweakRanks = (env, mod) => {
  const top = maxRank(mod);
  return env.settings.costControlEnabled ? [...new Set([top, Math.max(0, Math.floor(top / 2))])] : [top];
};

/** Whether mods may be scored as a tweak: capacity (with Cost Control), the arcanes' elements, the elements kept. */
function tweakFits(run, mods, signature) {
  const { env } = run;
  if (env.settings.costControlEnabled && !fitsCapacity(env, mods)) return false;
  if (!arcanesHold(env, mods, run.arcanes)) return false;
  return !signature || sameList(run.signature(mods), signature);
}

/** Each slot's mod open to a swap (filled, not a riven, not protected), with its families. */
function tweakSlots(run, mods, skip) {
  return rivenToolSlots(mods, { skip, empty: false }).map(index => ({
    index, name: mods[index].name, rank: mods[index].rank, families: modStatFamilies(run.env.index.byName.get(mods[index].name)),
  }));
}

/** Mods the pool may put in `slot` of `mods`: not already there, not on the build, not conflicting with what is. */
function swapCandidates(run, mods, slot, entries) {
  const open = withSlot(mods, slot, null);
  const names = open.filter(Boolean).map(m => m.name);
  const current = mods[slot]?.name;
  return entries.filter(e => e.name !== current && !names.includes(e.name) && !conflictingModIn(e.name, open, run.env.index));
}

/**
 * The tweak context (the site's buildMinorTweakContext): for each open slot the score without its mod (weak slots
 * first) and a shortlist of the best replacements, and which slots are worth upgrading: a slot whose mod shares a
 * family with the allowed positives (the riven may cover it) and whose best replacement gains at least 0.25%.
 */
export async function minorTweakContext(run, { protectedSlots, allowedPositives, baseline, signature }) {
  const slots = tweakSlots(run, run.mods, protectedSlots);
  const allowed = positiveFamilies(allowedPositives);
  if (!slots.length) return { slots: [], bySlot: new Map(), upgradeable: [] };
  const without = await run.score(slots.map(s => withSlot(run.mods, s.index, null)), TWEAK.removalRuns);
  const pool = tweakPool(run.env).flatMap(m => tweakRanks(run.env, m).map(rank => ({ name: m['Local Name'], rank, mod: m })));
  const jobs = [];
  for (const s of slots) {
    for (const e of swapCandidates(run, run.mods, s.index, pool)) {
      const mods = withSlot(run.mods, s.index, { name: e.name, rank: e.rank });
      if (tweakFits(run, mods, signature)) jobs.push({ slot: s.index, entry: e, mods });
    }
  }
  const scores = await run.score(jobs.map(j => j.mods), TWEAK.shortlistRuns);
  const bySlot = new Map();
  slots.forEach((s, i) => {
    const shortlist = jobs.map((j, k) => ({ j, v: scores[k] })).filter(x => x.j.slot === s.index && Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v).slice(0, TWEAK.shortlistSize)
      .map(x => ({ name: x.j.entry.name, rank: x.j.entry.rank, score: x.v, families: modStatFamilies(x.j.entry.mod) }));
    const overlaps = [...s.families].some(f => allowed.has(f));
    const gain = shortlist[0] && baseline > 0 ? (shortlist[0].score - baseline) / baseline : 0;
    bySlot.set(s.index, { ...s, without: Number.isFinite(without[i]) ? without[i] : baseline, shortlist, overlaps, upgradeable: overlaps && gain >= TWEAK.improvement });
  });
  const weak = [...bySlot.values()].sort((a, b) => b.without - a.without || a.index - b.index);
  return { slots: weak, bySlot, upgradeable: weak.filter(s => s.upgradeable) };
}

/**
 * The candidates worth tweaking (the site's promoteCandidatesForMinorTweaks): the best `globalLimit`, then for each
 * upgradeable slot up to `perSlot` more whose positives share a family with that slot's mod.
 */
export function promoteForTweaks(candidates, context, { globalLimit, perSlot, differentSlot = false }) {
  const sorted = candidates.filter(c => Number.isFinite(c.score)).sort((a, b) => b.score - a.score);
  const picked = [];
  const seen = new Set();
  const take = c => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    picked.push(c);
    return true;
  };
  sorted.slice(0, Math.max(0, globalLimit)).forEach(take);
  for (const slot of context?.upgradeable ?? []) {
    let added = 0;
    for (const c of sorted) {
      if (added >= perSlot) break;
      if (differentSlot && c.slot === slot.index) continue;
      const fams = positiveFamilies(c.positives);
      if ([...slot.families].some(f => fams.has(f)) && take(c)) added++;
    }
  }
  return picked;
}

/**
 * Up to three swaps around a placed riven (the site's refineBuildAroundRivenMinorTweaks): take out the weakest other
 * mod (the one whose removal costs least), try its shortlist, keep the best when it gains more than 0.25%, repeat.
 * The elements never change.
 */
export async function refineAroundRiven(run, { mods: start, context, rivenSlot, score, runs }) {
  let mods = start.slice();
  let best = score;
  const elements = run.signature(mods);
  const tweaks = [];
  for (let i = 0; i < TWEAK.maxSwaps; i++) {
    const open = context.slots.filter(s => s.index !== rivenSlot && mods[s.index] && !isRiven(mods[s.index]));
    if (!open.length) break;
    const without = await run.score(open.map(s => withSlot(mods, s.index, null)), TWEAK.removalRuns);
    const order = open.map((s, k) => ({ s, v: without[k] })).filter(x => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
    const weakest = order[0] && context.bySlot.get(order[0].s.index);
    if (!weakest?.shortlist.length) break;
    const from = mods[weakest.index];
    const tries = swapCandidates(run, mods, weakest.index, weakest.shortlist)
      .map(e => ({ e, mods: withSlot(mods, weakest.index, { name: e.name, rank: e.rank }) }))
      .filter(t => tweakFits(run, t.mods, elements));
    if (!tries.length) break;
    const scores = await run.score(tries.map(t => t.mods), runs);
    let top = -1;
    scores.forEach((v, k) => { if (Number.isFinite(v) && (top < 0 || v > scores[top])) top = k; });
    if (top < 0 || !(scores[top] > (best > 0 ? best * (1 + TWEAK.improvement) : best))) break;
    mods = tries[top].mods;
    best = scores[top];
    tweaks.push({ slot: weakest.index, from: from?.name ?? `Slot ${weakest.index + 1}`, to: tries[top].e.name });
  }
  return { mods, score: best, tweaks };
}

/** "Serration -> Heavy Caliber | Split Chamber -> Vigilante Armaments", as the CSV writes swaps. */
export const tweakListText = tweaks => (tweaks ?? []).map(t => `${t.from} -> ${t.to}`).join(' | ');

// ---------- the tools ----------

function requireRivenType(env) {
  if (!rivenStatCatalogue(env.data, env.weapon).length) throw new Error(RIVEN_TOOL_MESSAGES.noRivenType(env.weapon.name));
}

/** The positive and negative lists a theoretical tool rolls from, after exclusions and forced picks (site checks). */
function rollLists(env, options) {
  const forced = normalizeForcedPositives(options.forcedPositiveStats);
  const excluded = new Set(options.excludedStats.filter(s => !forced.includes(s)));
  const positives = rollPositiveStats(env.data, env.weapon);
  if (positives.length < 2) throw new Error(RIVEN_TOOL_MESSAGES.fewPositives);
  const allowed = positives.filter(s => !excluded.has(s));
  if (allowed.length < Math.max(2, forced.length)) throw new Error(RIVEN_TOOL_MESSAGES.fewAfterExclusions);
  const negatives = rollNegativeStats(env.data, env.weapon);
  if (!negatives.length) throw new Error(RIVEN_TOOL_MESSAGES.noNegatives);
  if (options.negativeStat && !negatives.includes(options.negativeStat)) throw new Error(RIVEN_TOOL_MESSAGES.negativeMissing);
  return { forced, allowed, negatives };
}

/**
 * Slot My Riven: the user's rivens of this weapon's family (minus those with an excluded positive) in every general
 * slot that holds no riven and isn't excluded, filled or empty. Returns the best placement overall and the best that
 * keeps the build's elements, each only when it beats the build.
 * @returns {{ baseline, best, bestSameElements, originalElements, placements, runs }} best: { riven, slot, mods, score,
 *   elements, changesElements } or null
 */
export async function slotMyRiven(env, { build, rivens, options: raw, score, signal = null, onProgress = () => {} }) {
  const options = normalizeRivenToolOptions(raw);
  requireRivenType(env);
  if (build.mods.some(isRiven)) throw new Error(RIVEN_TOOL_MESSAGES.equipped('Slot My Riven'));
  const family = rivenFamily(env.weapon.name);
  const mine = (rivens ?? []).filter(r => isRiven(r) && r.family === family && validateRiven(r, { data: env.data, weapon: env.weapon }).ok);
  if (!mine.length) throw new Error(RIVEN_TOOL_MESSAGES.noLibrary);
  const excluded = new Set(options.excludedStats);
  const usable = mine.filter(r => !r.stats.some(s => Number(s.value) > 0 && excluded.has(s.name)));
  if (!usable.length) throw new Error(RIVEN_TOOL_MESSAGES.allExcluded);
  const run = createRun(env, { build, score, signal, onProgress });
  run.progress(5, 'Calculating baseline DPS');
  const [baseline] = await run.score([run.mods], BASELINE_RUNS.slot);
  const slots = rivenToolSlots(run.mods, { skip: options.excludedSlots });
  const placements = slots.flatMap(slot => usable.map(riven => ({ riven, slot, mods: withSlot(run.mods, slot, riven) })));
  if (!placements.length) throw new Error(RIVEN_TOOL_MESSAGES.noPlacements);
  const label = `Simulating ${placements.length} ${placements.length === 1 ? 'placement' : 'placements'}`;
  run.progress(10, label);
  const scores = await run.score(placements.map(p => p.mods), options.sampleCount, { from: 10, to: 95, label });
  const originalElements = run.signature(run.mods);
  let best = null;
  let same = null;
  placements.forEach((p, i) => {
    const v = scores[i];
    if (!Number.isFinite(v)) return;
    const elements = run.signature(p.mods);
    const entry = { riven: p.riven, slot: p.slot, mods: p.mods, score: v, elements, changesElements: !sameList(elements, originalElements) };
    if (!entry.changesElements && v > (same?.score ?? baseline)) same = entry;
    if (v > (best?.score ?? baseline)) best = entry;
  });
  run.progress(100, best ? 'Finished' : RIVEN_TOOL_MESSAGES.notOptimal);
  return { baseline, best, bestSameElements: same, originalElements, placements: placements.length, runs: run.runs };
}

/**
 * Auto Riven: the best theoretical riven and slot for the build (the site's slotOptimalRiven, phases 1-4). Phase 1 rolls
 * every positive set with the default negative into every filled, unprotected general slot; phase 2 tries every
 * negative (or the chosen one) on the best; with minor build tweaks, the shortlisted sets get phase 2 each and the top
 * five up to three swaps around the riven; phase 4 confirms the winner at the longer run count.
 * @returns {{ baseline, improved, score, mods, riven, slot, tweaks, originalElements, runs }}
 */
export async function autoRiven(env, { build, options: raw, score, signal = null, onProgress = () => {} }) {
  const options = normalizeRivenToolOptions(raw);
  requireRivenType(env);
  if (build.mods.some(isRiven)) throw new Error(RIVEN_TOOL_MESSAGES.equipped('Auto Riven'));
  const { forced, allowed, negatives } = rollLists(env, options);
  const tryNegatives = options.negativeStat ? [options.negativeStat] : negatives;
  const firstNegative = options.negativeStat ?? (tryNegatives.includes(DEFAULT_NEGATIVE) ? DEFAULT_NEGATIVE : tryNegatives[0]);
  const runs = options.sampleCount;
  const extended = clamp(Math.max(runs, Math.round(runs * 3)), ROLL_RUNS.min, ROLL_RUNS.max);
  const mult = options.statValue / ROLL_STAT_VALUE.scale;
  const run = createRun(env, { build, score, signal, onProgress });
  const originalElements = run.signature(run.mods);
  const keeps = mods => !options.preserveElementalCombo || sameList(run.signature(mods), originalElements);
  const none = (baseline, message = RIVEN_TOOL_MESSAGES.noImprovement) => ({ baseline, improved: false, message, originalElements, runs: run.runs });

  run.progress(5, 'Calculating baseline DPS');
  const [baseline] = await run.score([run.mods], BASELINE_RUNS.auto);
  const slots = rivenToolSlots(run.mods, { skip: options.protectedSlots, empty: false });
  if (!slots.length) throw new Error(RIVEN_TOOL_MESSAGES.noSwappable);
  const phase1 = [];
  for (const combo of positiveCombos(allowed, forced)) {
    const riven = theoreticalRiven(env.data, env.weapon, combo, firstNegative, mult);
    if (!riven) continue;
    for (const slot of slots) {
      const mods = withSlot(run.mods, slot, riven);
      if (keeps(mods)) phase1.push({ key: `${slot}::${combo.join('|')}`, positives: combo, slot, mods });
    }
  }
  if (!phase1.length) throw new Error(options.preserveElementalCombo ? RIVEN_TOOL_MESSAGES.noneKeepElements : RIVEN_TOOL_MESSAGES.none);
  const p1Label = `Phase 1: best positive stats (${runs} ${runs === 1 ? 'run' : 'runs'})`;
  run.progress(10, p1Label);
  const p1 = await run.score(phase1.map(c => c.mods), runs, { from: 15, to: 50, label: p1Label });
  phase1.forEach((c, i) => { c.score = p1[i]; });
  const best1 = phase1.reduce((b, c) => (Number.isFinite(c.score) && c.score > (b?.score ?? -Infinity) ? c : b), null);
  if (!best1 || !(best1.score > baseline)) return none(baseline, 'No optimal Riven found that improves DPS.');

  /** Phase 2 for one positive set in one slot: every negative to try, at the longer run count; the best or null. */
  const phase2 = async c => {
    const cands = tryNegatives.map(neg => ({ neg, riven: theoreticalRiven(env.data, env.weapon, c.positives, neg, mult) }))
      .filter(x => x.riven).map(x => ({ ...x, mods: withSlot(run.mods, c.slot, x.riven) })).filter(x => keeps(x.mods));
    const v = await run.score(cands.map(x => x.mods), extended);
    let top = null;
    cands.forEach((x, i) => { if (Number.isFinite(v[i]) && v[i] > (top?.score ?? -Infinity)) top = { ...c, riven: x.riven, negative: x.neg, mods: x.mods, score: v[i] }; });
    return top;
  };

  let win = null;
  let tweaks = [];
  if (!options.allowMinorBuildTweaks) {
    run.progress(55, `Phase 2: the negative stat (${extended} runs)`, `Best positives: ${best1.positives.map(rollStatLabel).join(', ')} in slot ${best1.slot + 1}`);
    win = await phase2(best1);
    if (!win) return none(baseline);
  } else {
    run.progress(52, 'Phase 1.5: shortlisting minor tweaks', 'Ranking weak mod slots');
    const context = await minorTweakContext(run, { protectedSlots: options.protectedSlots, allowedPositives: allowed, baseline, signature: options.preserveElementalCombo ? originalElements : null });
    const promoted = promoteForTweaks(phase1.filter(c => c.score > baseline), context, { globalLimit: TWEAK.autoGlobal, perSlot: TWEAK.autoPerSlot });
    if (!promoted.length) throw new Error(RIVEN_TOOL_MESSAGES.noShortlist);
    const refined = [];
    for (const [i, c] of promoted.entries()) {
      run.progress(55 + (20 * i) / promoted.length, `Phase 2: ${promoted.length} shortlisted rolls (${extended} runs)`, `Negative stat ${i + 1} of ${promoted.length}`);
      const top = await phase2(c);
      if (top) refined.push(top);
    }
    refined.sort((a, b) => b.score - a.score);
    if (!refined[0] || !(refined[0].score > baseline)) return none(baseline, 'No optimal Riven found that improves DPS.');
    win = refined[0];
    const finalists = refined.slice(0, TWEAK.autoFinalists);
    for (const [i, f] of finalists.entries()) {
      run.progress(78 + (10 * i) / finalists.length, 'Phase 3: minor build tweaks', `Refining ${i + 1} of ${finalists.length}`);
      const t = await refineAroundRiven(run, { mods: f.mods, context, rivenSlot: f.slot, score: f.score, runs });
      if (t.score > win.score) { win = { ...f, mods: t.mods, score: t.score }; tweaks = t.tweaks; }
    }
  }
  const confirmRuns = Math.max(extended, runs);
  run.progress(90, `Phase 4: confirming the build (${confirmRuns} runs)`);
  const [final] = await run.score([win.mods], confirmRuns);
  if (options.preserveElementalCombo && !sameList(run.signature(win.mods), originalElements)) throw new Error(RIVEN_TOOL_MESSAGES.changedElements);
  run.progress(100, 'Finished');
  if (!(final > baseline)) return none(baseline);
  return {
    baseline, improved: true, score: final, mods: win.mods, riven: win.riven, slot: win.slot, positives: win.positives,
    negative: win.negative, tweaks, originalElements, elements: run.signature(win.mods), runs: run.runs,
  };
}

const signed = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '');

/** Rows to CSV text: values with a comma, quote or line break are quoted, quotes doubled (the site's writer). */
export function rowsToCsv(rows) {
  return rows.map(row => row.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

/** "Braton Prime" -> "braton-prime": the CSV's file name stem. */
export const slugify = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';

/**
 * Get Rolls Data: every positive set with the chosen negative in every unprotected general slot, filled or empty, and
 * its gain over the build; with minor tweaks, the promoted rows get up to three swaps each. Sorted best first.
 * @returns {{ baseline, rows: Array<{ positives, negative, slot, replaced, score, gain, finalScore, finalGain, tweaks, refined }>, csv, fileName, runs }}
 */
export async function rollsData(env, { build, options: raw, score, signal = null, onProgress = () => {} }) {
  const options = normalizeRivenToolOptions(raw);
  requireRivenType(env);
  if (!options.negativeStat) throw new Error(RIVEN_TOOL_MESSAGES.needNegative);
  if (build.mods.some(isRiven)) throw new Error(RIVEN_TOOL_MESSAGES.equipped('Rolls data'));
  const { forced, allowed } = rollLists(env, options);
  const mult = options.statValue / ROLL_STAT_VALUE.scale;
  const run = createRun(env, { build, score, signal, onProgress });
  const originalElements = run.signature(run.mods);
  const keeps = mods => !options.preserveElementalCombo || sameList(run.signature(mods), originalElements);
  const slots = rivenToolSlots(run.mods, { skip: options.protectedSlots });
  if (!slots.length) throw new Error(RIVEN_TOOL_MESSAGES.noSlots);
  run.progress(10, 'Baseline DPS', 'Measuring the current build');
  const [baseline] = await run.score([run.mods], BASELINE_RUNS.rolls);
  const combos = positiveCombos(allowed, forced);
  let context = null;
  if (options.allowMinorBuildTweaks) {
    run.progress(18, 'Preparing the tweak shortlist', 'Ranking weak slots and replacements');
    context = await minorTweakContext(run, { protectedSlots: options.protectedSlots, allowedPositives: allowed, baseline, signature: options.preserveElementalCombo ? originalElements : null });
  }
  const cands = [];
  for (const combo of combos) {
    const riven = theoreticalRiven(env.data, env.weapon, combo, options.negativeStat, mult);
    if (!riven) continue;
    for (const slot of slots) {
      const mods = withSlot(run.mods, slot, riven);
      if (keeps(mods)) cands.push({ key: `${slot}::${combo.join('|')}::${options.negativeStat}`, positives: combo, negative: options.negativeStat, slot, replaced: run.mods[slot]?.name ?? null, riven, mods });
    }
  }
  const label = `Evaluating ${rollStatLabel(options.negativeStat)}`;
  const scores = await run.score(cands.map(c => c.mods), options.sampleCount, { from: 20, to: 90, label });
  const rows = [];
  cands.forEach((c, i) => {
    if (!Number.isFinite(scores[i])) return;
    rows.push({ ...c, score: scores[i], gain: pct(scores[i], baseline) });
  });
  if (!rows.length) throw new Error(RIVEN_TOOL_MESSAGES.noRolls);
  const refined = new Map();
  if (context) {
    const promoted = promoteForTweaks(rows, context, { globalLimit: TWEAK.rollsGlobal, perSlot: TWEAK.rollsPerSlot, differentSlot: true });
    for (const [i, r] of promoted.entries()) {
      run.progress(91 + (3 * i) / promoted.length, 'Minor build tweaks', `Refined ${i} of ${promoted.length} rolls`);
      const t = await refineAroundRiven(run, { mods: r.mods, context, rivenSlot: r.slot, score: r.score, runs: options.sampleCount });
      if (keeps(t.mods)) refined.set(r.key, t);
    }
  }
  const done = rows.map(r => {
    const t = refined.get(r.key) ?? null;
    const finalScore = t ? t.score : r.score;
    return { ...r, finalScore, finalGain: pct(finalScore, baseline), tweaks: t?.tweaks ?? [], refined: Boolean(t) };
  }).sort((a, b) => (b.finalScore || b.score) - (a.finalScore || a.score));
  run.progress(95, 'Compiling results');
  const tweaksOn = options.allowMinorBuildTweaks;
  const header = ['positives', 'replaced_mod', 'dps_delta_percent'];
  if (tweaksOn) header.push('negative_stat', 'riven_replaced_mod', 'one_slot_dps_delta_percent', 'final_dps_delta_percent', 'tweak_count', 'extra_swaps', 'tweak_refined');
  const csvRows = [header, ...done.map(r => {
    const replaced = r.replaced ?? `Slot ${r.slot + 1}`;
    const row = [r.positives.map(rollStatLabel).join(' + '), replaced, signed(tweaksOn ? r.finalGain : r.gain)];
    if (tweaksOn) row.push(rollStatLabel(r.negative), replaced, signed(r.gain), signed(r.finalGain), String(r.tweaks.length), tweakListText(r.tweaks), r.refined ? 'true' : 'false');
    return row;
  })];
  run.progress(100, 'Finished');
  return {
    baseline,
    rows: done.map(({ mods: _m, riven: _r, ...r }) => r),
    csv: rowsToCsv(csvRows),
    // An unnamed build ("New build") is named by its weapon.
    fileName: `${slugify(build.name && build.name !== 'New build' ? build.name : build.weaponName)}-rolls-data.csv`,
    tweaks: tweaksOn,
    runs: run.runs,
  };
}

/**
 * Left/Right compare: each riven in every general slot (the equipped riven's slot only, when the build has one: the
 * new roll replaces it), 50 runs each. Per riven: its best placement and its best that keeps the build's elements.
 * @returns {{ baseline, sides: Array<{ best, bestSameElements }>, originalElements, runs }}
 */
export async function compareRivens(env, { build, rivens, score, signal = null, onProgress = () => {} }) {
  requireRivenType(env);
  const run = createRun(env, { build, score, signal, onProgress });
  run.progress(5, 'Calculating baseline DPS');
  const [baseline] = await run.score([run.mods], BASELINE_RUNS.compare);
  const equipped = run.mods.findIndex(isRiven);
  const slots = equipped >= 0 ? [equipped] : rivenToolSlots(run.mods);
  const originalElements = run.signature(run.mods);
  const placements = rivens.flatMap((riven, side) => slots.map(slot => ({ side, riven, slot, mods: withSlot(run.mods, slot, riven) })));
  const label = `Comparing ${placements.length} ${placements.length === 1 ? 'placement' : 'placements'}`;
  const scores = await run.score(placements.map(p => p.mods), BASELINE_RUNS.compare, { from: 20, to: 95, label });
  const sides = rivens.map(() => ({ best: null, bestSameElements: null }));
  placements.forEach((p, i) => {
    const v = scores[i];
    if (!Number.isFinite(v)) return;
    const elements = run.signature(p.mods);
    const entry = { riven: p.riven, slot: p.slot, mods: p.mods, score: v, elements, changesElements: !sameList(elements, originalElements) };
    const s = sides[p.side];
    if (!s.best || v > s.best.score) s.best = entry;
    if (!entry.changesElements && (!s.bestSameElements || v > s.bestSameElements.score)) s.bestSameElements = entry;
  });
  run.progress(100, 'Finished');
  return { baseline, sides, originalElements, replacesEquipped: equipped >= 0, runs: run.runs };
}

/** "Viral, Heat" or "No combined elements": an element list as the site's messages write it. */
export const elementListText = elements => (elements?.length ? elements.join(', ') : 'No combined elements');

/** The Exilus slot is never a riven tool's (rivens can't go there). */
export const RIVEN_TOOL_EXILUS = EXILUS_SLOT;
