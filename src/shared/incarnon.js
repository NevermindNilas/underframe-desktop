// Incarnon evolutions on guns, ported from underframe.site: the perks a build picks, what they add to the weapon's
// stats, their conditional parts (with the site's on/off defaults) and the fields the engine reads
// (docs/port-incarnon.md).
//
// data.incarnons lists per weapon `evolutions`: evolution_N (N = 2..5) with perk_M_description, perk_M_stats (always
// on) and perk_M_conditional_stats (on a trigger: a kill, a headshot, a reload from empty, ...). Evolution I is the
// Incarnon Genesis itself: it turns the perks on; the Incarnon Form fire modes run either way, as on the site.
//
// A build stores `incarnon` in the site's shape, { evolution_1_active: true, evolution_2_perk .. evolution_5_perk }
// (a perk number or null), plus `conditionals`: { [id]: stacks } for the conditional perk stats the user set (0 is
// off). The others take the site's default, decided from the perk's text and the build's stats: a perk that triggers
// "On Kill" is on at max stacks, one that needs "Critical Chance below 40%" is on only while the stats allow it.
export const INCARNON_EVOLUTIONS = Object.freeze([2, 3, 4, 5]);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const evolutionLabel = n => `Evolution ${ROMAN[n] ?? n}`;
const STATUS_TYPES = ['Impact', 'Puncture', 'Slash', 'Heat', 'Cold', 'Electricity', 'Toxin', 'Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral', 'Void', 'Tau'];
const LATRONS = new Set(['Latron', 'Latron Prime', 'Latron Wraith']);
/** The Strun family's perks list one value per variant: "+20% (Strun) / +12% (Wraith)". */
const STATUS_VARIANT = Object.freeze({ Strun: 'Strun', 'Strun Wraith': 'Wraith', 'Strun Prime': 'Prime' });
/** Evolution II perk 2 of these adds its speed to the fire rate bonus (like a mod) instead of scaling the base rate. */
const ADDITIVE_SPEED = Object.freeze({ Onos: 'WEAPON_FIRE_RATE', Laetum: 'WEAPON_FIRE_RATE', Phenmor: 'WEAPON_FIRE_RATE' });
/** Always-on perk stats that change each fire mode's own base values. */
const MODE_EDITS = new Set(['WEAPON_BASE_DAMAGE', 'WEAPON_CRITICAL_CHANCE', 'WEAPON_CRITICAL_MULTIPLIER', 'WEAPON_STATUS_CHANCE',
  'WEAPON_FIRE_RATE', 'WEAPON_ATTACK_SPEED', 'WEAPON_MULTISHOT', 'WEAPON_PUNCTURE_DEPTH', 'WEAPON_RANGE']);

const num = v => parseFloat(v);
const isAoe = mode => /aoe$/i.test(String(mode?.projectile_type ?? '').trim());
const isIncarnonName = name => /incarnon/i.test(String(name ?? ''));

/** The weapon's entry in data.incarnons, or null. */
export function incarnonFor(data, weapon) {
  return (data?.incarnons ?? []).find(i => i?.name === weapon?.name) ?? null;
}

/** Whether a build's Incarnon Genesis is installed (its perks count). */
export const incarnonActive = incarnon => incarnon?.evolution_1_active === true;

/**
 * A perk's short name and the rest of its text, from its description ("Perk 1: Hunter's Mantra: Increase Damage ...").
 * Some descriptions have no colon after the name ("Perk 1: Daring Reverie Increase Damage ..."); the name then ends
 * before the first word that starts the effect.
 */
export function perkLabel(description, number) {
  const body = String(description ?? '').replace(/^\s*Perk\s*\d+\s*:\s*/i, '').trim();
  const colon = body.match(/^([^:]{1,40}?)\s*:\s+(.*)$/s);
  if (colon && colon[1].split(/\s+/).length <= 5) return { name: colon[1].trim(), text: colon[2].trim() };
  const words = body.split(/\s+/);
  const stop = /^(Increase|Increases|Reduce|Remove|On|With|While|When|After|Gain|Gains|Deal|Deals|Affects|Converts|Fires?|-?\+?\d.*|[+-].*)$/;
  let n = 0;
  while (n < words.length && n < 4 && !stop.test(words[n])) n++;
  if (n === 0 || n === words.length) return { name: `Perk ${number}`, text: body };
  return { name: words.slice(0, n).join(' '), text: words.slice(n).join(' ') };
}

/**
 * The weapon's evolutions II-V with their perks, in order.
 * @returns {Array<{ number, label, perks: Array<{ number, name, text, description }>, priority: number|null, headshotPriority: number|null }>}
 */
export function incarnonEvolutions(entry) {
  if (!entry?.evolutions) return [];
  const priority = v => {
    const m = typeof v === 'string' ? v.match(/perk\s*(\d+)/i) : null;
    return m ? Number(m[1]) : null;
  };
  return Object.keys(entry.evolutions)
    .map(k => k.match(/^evolution_(\d+)$/)).filter(Boolean).map(m => Number(m[1])).filter(n => n >= 2).sort((a, b) => a - b)
    .map(number => {
      const evo = entry.evolutions[`evolution_${number}`] ?? {};
      const perks = Object.keys(evo).map(k => k.match(/^perk_(\d+)_description$/)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
        .map(p => ({ number: p, ...perkLabel(evo[`perk_${p}_description`], p), description: String(evo[`perk_${p}_description`] ?? '') }));
      return { number, label: evolutionLabel(number), perks, priority: priority(evo.priority), headshotPriority: priority(evo['headshot-priority']) };
    });
}

/** The id the site gives a conditional perk stat (its state lives under this key). */
export const conditionalId = (weaponName, evolution, perk, stat) => `${weaponName}_evo${evolution}_perk${perk}_${String(stat?.Stat ?? '').replace(/\s/g, '')}`;

/** Max stacks as the site's conditional list shows them: the stat's own, "stacks up to Nx" in the perk or the stat. */
function listedMaxStacks(description, stat) {
  const own = Number(stat?.MaxStacks);
  if (Number.isFinite(own) && own > 0) return Math.floor(own);
  const m = String(description ?? '').match(/stacks up to\s*(\d+)x/i)
    ?? String(stat?.OriginalValue ?? '').match(/stacks up to\s*(\d+)x/i) ?? String(stat?.OriginalValue ?? '').match(/stacks up to\s*(\d+)\s*times/i);
  return m && Number(m[1]) > 0 ? Number(m[1]) : 1;
}

/** Max stacks as the site's stat maths reads them (the stat's own, else "stacks up to Nx" in the perk only). */
function statMaxStacks(description, stat) {
  const own = Number(stat?.MaxStacks);
  if (Number.isFinite(own) && own > 0) return Math.floor(own);
  const m = String(description ?? '').match(/stacks up to (\d+)x/i);
  return m ? Number(m[1]) : 1;
}

/** The perk a build picked in an evolution, with its data, or null. */
function pickedPerk(entry, incarnon, evolution) {
  const p = Number(incarnon?.[`evolution_${evolution}_perk`]);
  const evo = entry?.evolutions?.[`evolution_${evolution}`];
  if (!p || !evo || evo[`perk_${p}_description`] == null) return null;
  return { perk: p, evo, description: String(evo[`perk_${p}_description`] ?? '') };
}

/**
 * The conditional perk stats of a build's picked perks (the site's conditional list), each with its id, label and
 * max stacks. Empty while the Genesis is not installed.
 * @returns {Array<{ id, evolution, perk, stat, maxStacks, description, label }>}
 */
export function incarnonConditionals(data, weapon, incarnon) {
  const entry = incarnonFor(data, weapon);
  if (!entry || !incarnonActive(incarnon)) return [];
  const out = [];
  for (const e of INCARNON_EVOLUTIONS) {
    const picked = pickedPerk(entry, incarnon, e);
    if (!picked) continue;
    for (const stat of picked.evo[`perk_${picked.perk}_conditional_stats`] ?? []) {
      if (!stat?.Stat) continue;
      out.push({
        id: conditionalId(weapon.name, e, picked.perk, stat), evolution: e, perk: picked.perk, stat,
        maxStacks: listedMaxStacks(picked.description, stat), description: picked.description, label: `${evolutionLabel(e)}: ${stat.Stat}`,
      });
    }
  }
  return out;
}

/**
 * Clean a stored or imported `incarnon` for a weapon: the Genesis on, each evolution's perk a number the weapon has
 * (or null), and the conditional settings of those perks clamped to their stacks. Null when it has no perk: the app
 * treats the Genesis as always installed (it adds nothing on its own), so null is "installed, no perks".
 */
export function normalizeIncarnon(data, weapon, raw) {
  const entry = incarnonFor(data, weapon);
  if (!entry || !raw || typeof raw !== 'object' || !incarnonActive(raw)) return null;
  const out = { evolution_1_active: true };
  for (const e of INCARNON_EVOLUTIONS) {
    const p = Number(raw[`evolution_${e}_perk`]);
    out[`evolution_${e}_perk`] = Number.isInteger(p) && p > 0 && entry.evolutions?.[`evolution_${e}`]?.[`perk_${p}_description`] != null ? p : null;
  }
  const defs = new Map(incarnonConditionals(data, weapon, out).map(d => [d.id, d]));
  // In data order, so the same settings always give the same object (snapshots and sim keys compare JSON).
  const given = raw.conditionals && typeof raw.conditionals === 'object' ? raw.conditionals : {};
  const conditionals = {};
  for (const [id, def] of defs) {
    const n = Object.hasOwn(given, id) && given[id] !== null ? Number(given[id]) : NaN;
    if (Number.isFinite(n)) conditionals[id] = Math.min(def.maxStacks, Math.max(0, Math.round(n)));
  }
  if (Object.keys(conditionals).length) out.conditionals = conditionals;
  return INCARNON_EVOLUTIONS.some(e => out[`evolution_${e}_perk`]) ? out : null;
}

/** The build's Incarnon with one evolution's perk set (null clears it); the perk's conditional settings are dropped. */
export function withPerk(data, weapon, incarnon, evolution, perk) {
  const next = { ...(incarnon ?? {}), evolution_1_active: true, [`evolution_${evolution}_perk`]: perk || null };
  return normalizeIncarnon(data, weapon, next);
}

/** The build's Incarnon with one conditional set to `stacks` (0 is off), or back to its default (null). */
export function withConditional(data, weapon, incarnon, id, stacks) {
  if (!incarnonActive(incarnon)) return incarnon ?? null;
  const conditionals = { ...(incarnon.conditionals ?? {}) };
  if (stacks == null) delete conditionals[id];
  else conditionals[id] = stacks;
  const { conditionals: _old, ...rest } = incarnon;
  return normalizeIncarnon(data, weapon, Object.keys(conditionals).length ? { ...rest, conditionals } : rest);
}

/**
 * The perks Auto build chose, as the site writes them: a perk it picked for an empty evolution has every conditional
 * stat on, at the stacks its text names ("Stacks up to 3x"; one otherwise); the kept perks keep their settings.
 */
export function incarnonAfterAutoBuild(data, weapon, start, chosen) {
  if (!incarnonActive(chosen)) return chosen ?? null;
  const conditionals = { ...(start?.conditionals ?? {}) };
  for (const def of incarnonConditionals(data, weapon, chosen)) {
    if (Number(start?.[`evolution_${def.evolution}_perk`]) === def.perk) continue;
    const m = def.description.match(/stacks up to (\d+)x/i);
    conditionals[def.id] = m && Number(m[1]) > 0 ? Number(m[1]) : 1;
  }
  const { conditionals: _old, ...rest } = chosen;
  return normalizeIncarnon(data, weapon, { ...rest, conditionals });
}

/** Featured (site) builds keep activeConditionals; a state the user set there (not the site's auto default) is kept. */
export function incarnonFromSite(data, weapon, siteIncarnon, activeConditionals = {}) {
  const base = normalizeIncarnon(data, weapon, siteIncarnon);
  if (!base) return null;
  const conditionals = {};
  for (const def of incarnonConditionals(data, weapon, base)) {
    const s = activeConditionals?.[def.id];
    if (!s || s.auto === true) continue;
    if (s.auto === undefined && !s.isActive && !(Number(s.stacks) > 0)) continue;
    conditionals[def.id] = s.isActive ? (def.maxStacks > 1 ? Number(s.stacks) || 0 : 1) : 0;
  }
  return normalizeIncarnon(data, weapon, Object.keys(conditionals).length ? { ...base, conditionals } : base);
}

// ---------- the site's defaults for conditional perks ----------

// Phrases that turn a conditional perk off by default (it rarely holds in a simulated fight), then on.
const OFF_PHRASES = [
  'on airborne melee kill', 'on bleed kill', 'on equip', 'on final magazine burst', 'on finisher', 'on full burst hit',
  'on last shot in magazine', 'on undamaged enemies', 'collecting ammo', 'for each enemy hit by slam radius', 'less than half health',
  'while aim gliding', 'while sliding', 'while aiming', 'with no primary equipped', 'with overshields',
];
const OFF_PATTERNS = [/fewer\s*than\s*\d+\s*status\s*effects/, /for\s*every\s*\d+\s*m\s*of\s*continuous\s*slide/];
const ON_PHRASES = [
  'on 2 headshot', 'on 50 energy spent', 'on ability cast', 'on consecutive weakpoint', 'on critical hit', 'on firing', 'on headshot',
  'on impact status', 'on primary kill', 'on punch through', 'on puncture status', 'on status effect', 'weakpoint hit', 'body shot',
  'with channeled ability active', 'with melee weapon equipped', 'with sprint speed 1.2 or higher',
];
const ON_PATTERNS = [
  /on\s*fire\b/, /on\s*hit\b/, /on\s*kill\b/, /on\s*(?:shield|overguard)(?:\s*\/\s*(?:shield|overguard))?\s*break/, /final\s*move\s*of\s*(?:a\s*)?combo/,
  /with\s*armor\s*(?:over|above)/, /while\s*armor\s*(?:is\s*)?(?:greater|above|over)/, /with\s*energy\s*max\s*(?:over|above)/,
];
/** A phrase as a pattern that allows any spacing between its words. */
const phrase = p => new RegExp(p.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
const OFF_RULES = [...OFF_PHRASES.map(p => (p === 'on equip' ? /on\s*equip\b/ : phrase(p))), ...OFF_PATTERNS];
const ON_RULES = [...ON_PHRASES.map(phrase), ...ON_PATTERNS];
/** Stat types the site always turns on. */
const ALWAYS_ON = new Set(['WEAPON_CRIT_CHANCE_FROM_STATUS_CHANCE', 'WEAPON_STATUS_CHANCE_FROM_CRIT_CHANCE', 'WEAPON_EXTERNAL_ELEMENTAL_DAMAGE']);

/** The leaf modes a pick runs: a combined "custom:<name>" mode's parts, or the mode itself. */
function leafModeNames(modeId, customFireModes, seen = new Set()) {
  if (typeof modeId !== 'string' || !modeId) return [];
  if (!modeId.startsWith('custom:')) return [modeId];
  const name = modeId.slice(7);
  if (seen.has(name)) return [];
  const recipe = (customFireModes ?? []).find(c => c?.name === name);
  return (recipe?.components ?? []).flatMap(c => leafModeNames(c?.mode_name, customFireModes, new Set(seen).add(name)));
}

const statusesIn = text => STATUS_TYPES.filter(t => new RegExp(`\\b${t.toLowerCase()}\\b`).test(text));

/**
 * A conditional perk stat's default, as the site decides it from the perk's text: on (at max stacks) or off.
 * `context`: the build's stats per mode (`weaponStats`), its fire mode pick (`modeId`), the weapon's combined modes,
 * the statuses on the target and the external buffs (their elements count as status sources).
 */
export function incarnonDefaultState(def, { weaponStats = [], modeId = null, customFireModes = [], statuses = [], buffs = [] } = {}) {
  const max = def.maxStacks > 0 ? def.maxStacks : 1;
  const state = on => ({ isActive: on, stacks: on ? max : 0, auto: true });
  if (ALWAYS_ON.has(def.stat?.UpgradeType)) return state(true);
  const text = String(def.description ?? '').toLowerCase();
  const stats = Array.isArray(weaponStats) ? weaponStats : [];
  const leaves = new Set(leafModeNames(modeId, customFireModes));
  const selected = stats.filter(m => leaves.has(m?.mode_name));
  const modeName = selected.length === 1 ? selected[0].mode_name.toLowerCase() : (modeId ? String(modeId).toLowerCase() : '');
  const mentioned = statusesIn(text);
  // Sources of a status: any damage type a mode deals, a status already on the target, a buff's element.
  const sources = new Set();
  for (const m of stats) for (const [t, v] of Object.entries(m?.finalDamageTypes ?? {})) if (typeof v === 'number' && v > 0) sources.add(t.toLowerCase());
  for (const s of statuses ?? []) if (s?.type && s.stacks > 0) sources.add(String(s.type).toLowerCase());
  for (const b of buffs ?? []) if (b?.element) sources.add(String(b.element).toLowerCase());
  const allSourced = () => mentioned.every(t => sources.has(t.toLowerCase()));
  // The modes a perk speaks of: both forms, the Incarnon Form, the normal form, else the picked mode.
  const relevant = () => {
    if (!stats.length) return [];
    if (text.includes('both modes')) return stats;
    const inc = stats.filter(m => isIncarnonName(m?.mode_name));
    const normal = stats.filter(m => !isIncarnonName(m?.mode_name));
    if (text.includes('incarnon form') && inc.length) return inc;
    if ((text.includes('base form') || text.includes('normal form') || text.includes('non-incarnon')) && normal.length) return normal;
    if (modeId && (selected.length || String(modeId).startsWith('custom:'))) return selected;
    return stats;
  };
  const highestCrit = modes => modes.reduce((a, m) => Math.max(a, typeof m?.finalCritChance === 'number' ? m.finalCritChance : 0), 0);

  if (text.includes('on hit that is neither critical nor applies a status') || text.includes('on non-critical hit')) {
    const modes = relevant();
    return state(modes.length > 0 && highestCrit(modes) < 100);
  }
  if ((text.includes('on hitting a target affected by') || text.includes('on targets affected by')) && mentioned.length) return state(allSourced());
  if (text.includes('on killing enemy with') && text.includes('status') && mentioned.length) return state(allSourced());
  if (text.includes('on reload from empty')) return state(modeName ? !modeName.includes('incarnon') : true);
  if (text.includes('on slide attack') || text.includes('on slide kill')) return state(modeName.includes('slide attack'));
  if (text.includes('hitting enemies in incarnon form')) return state(modeName.includes('incarnon'));
  if (text.includes('critical chance below') || text.includes('critical chance under')) {
    const m = text.match(/critical chance (?:below|under)\s*([0-9]+(?:\.[0-9]+)?)%/);
    const threshold = m ? Number(m[1]) : 0;
    const modes = relevant();
    return state(modes.length > 0 && highestCrit(modes) < threshold);
  }
  if (mentioned.length && (text.includes('status') || text.includes('proc'))) return state(allSourced());
  if (OFF_RULES.some(r => r.test(text))) return state(false);
  if (ON_RULES.some(r => r.test(text))) return state(true);
  return state(false);
}

/**
 * Every conditional perk stat's state: the user's setting where the build has one, else the default. Without stats
 * (`context.weaponStats` null: the first pass) a default is off, as on the site before its first calculation.
 * A user's setting also carries `fallback`, the default it overrides (what "Automatic" would pick), once there are stats.
 * @returns {Record<string, { isActive: boolean, stacks: number, auto: boolean, fallback?: object }>}
 */
export function incarnonStates(data, weapon, incarnon, context = {}) {
  const out = {};
  for (const def of incarnonConditionals(data, weapon, incarnon)) {
    const own = incarnon?.conditionals?.[def.id];
    if (Number.isFinite(own)) {
      out[def.id] = { isActive: own > 0, stacks: own, auto: false };
      if (context?.weaponStats) out[def.id].fallback = incarnonDefaultState(def, context);
    }
    else out[def.id] = context?.weaponStats ? incarnonDefaultState(def, context) : { isActive: false, stacks: 0, auto: true };
  }
  return out;
}

// ---------- what the perks do ----------

function emptyEffects() {
  return {
    states: {},
    // Always-on perk stats that change each mode's own values (base damage, crit, status, fire rate, ...).
    modeEdits: [],
    // Flat base damage from always-on perks (the engine's incarnonBaseDamageBonus) and from conditional ones per mode.
    baseDamageBonus: 0,
    conditionalBaseDamage: [],
    // Additive buckets, in stats.js collectModifiers() names.
    modifiers: {
      damage: 0, critChance: 0, critDamage: 0, fireRate: 0, multishot: 0, statusChance: 0, punchThrough: 0, reload: 0, magazine: 0,
      range: 0, blastRadius: 0, flatBlastRadius: 0, conditionOverload: 0, weakPointDamage: 0, ammoEfficiency: 0, followThrough: 0,
      statusDuration: 0, projectileSpeed: 0,
    },
    // Fields in external-buffs.js totals names, for the stats only (the engine's conditionalStats never get them).
    ext: { flatCritChance: 0, flatCritDamage: 0, multiplicativeCritDamage: 1, infiniteAmmo: false, ammoEfficiencyMultipliers: [] },
    baseMagazine: 0,
    baseCritDamage: 0,
    accuracy: 0,
    statusDamage: 0,
    simulationAdditiveDamage: 0,
    elements: {},
    critChanceFromStatus: [],
    statusChanceFromCrit: [],
    nonCritDamageMultiplier: 0,
    guaranteedNonCritDamage: 0,
    bleedOnImpactChance: 0,
    forceProcCount: null,
    // Reload speed that only the normal form gets (the Incarnon Form reloads at the mods' speed).
    normalReload: 0,
    ammoPoolPercent: 0,
    ammoPoolFlat: 0,
    lastMagazineShots: [],
    lastMagazineBurst: 0,
    punctureArmorStrip: 0,
    // What the engine gets besides weaponStats: conditionalStats fields and the target's headshot multiplier.
    engine: { armorStripPerHit: 0, headshotMultiplier: 0, externalHeadshotMultiplierBonus: 0, bodyshotCritChanceMultiplier: 1, projectileSpeed: 0 },
  };
}

/** A magazine stat adds rounds (ADD_BASE) or a percentage (STACKING_MULTIPLY); without a type, "%" in its text says which. */
function magazineOperation(stat) {
  const op = typeof stat?.OperationType === 'string' ? stat.OperationType.trim().toUpperCase() : '';
  if (op === 'ADD_BASE' || op === 'STACKING_MULTIPLY') return op;
  if (op) return null;
  return /%/.test(String(stat?.OriginalValue ?? '')) ? 'STACKING_MULTIPLY' : 'ADD_BASE';
}

/** Reload, status duration, fire rate (the additive kind) and projectile speed: the stats only some paths take. */
function utilityChannel(weaponName, evolution, perk, stat, conditional) {
  const channel = {
    WEAPON_RELOAD_SPEED: 'reload', WEAPON_PROC_DURATION: 'statusDuration', WEAPON_FIRE_RATE: 'fireRate', WEAPON_ATTACK_SPEED: 'fireRate',
    WEAPON_PROJECTILE_SPEED: 'projectileSpeed',
  }[stat?.UpgradeType];
  if (!channel || (conditional && (channel === 'reload' || channel === 'fireRate'))) return null;
  if (channel === 'fireRate' && !additiveSpeed(weaponName, evolution, perk, stat)) return null;
  const op = String(stat.OperationType ?? '').trim().toUpperCase();
  return op && op !== 'STACKING_MULTIPLY' ? null : channel;
}

function additiveSpeed(weaponName, evolution, perk, stat) {
  if (evolution !== 2 || Number(perk) !== 2) return false;
  const op = String(stat?.OperationType ?? '').trim().toUpperCase();
  return Boolean(ADDITIVE_SPEED[weaponName]) && ADDITIVE_SPEED[weaponName] === stat?.UpgradeType && (!op || op === 'STACKING_MULTIPLY');
}

function addUtility(fx, channel, value) {
  if (channel === 'reload') fx.normalReload += value;
  else if (channel === 'statusDuration') fx.modifiers.statusDuration += value;
  else if (channel === 'fireRate') fx.modifiers.fireRate += value;
  else if (channel === 'projectileSpeed') { fx.modifiers.projectileSpeed += value; fx.engine.projectileSpeed += value; }
}

/** An always-on perk stat. */
function addAlwaysOn(fx, weaponName, evolution, perk, stat, description) {
  const channel = utilityChannel(weaponName, evolution, perk, stat, false);
  const raw = Number(stat.Value);
  if (channel && Number.isFinite(raw)) addUtility(fx, channel, raw);
  if (stat.UpgradeType === 'WEAPON_HEADSHOT_MULTIPLIER' && Number.isFinite(raw)) fx.engine.headshotMultiplier += raw;
  const value = num(stat.Value);
  if (Number.isNaN(value) || additiveSpeed(weaponName, evolution, perk, stat)) return;
  switch (stat.UpgradeType) {
    case 'WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE': fx.modifiers.conditionOverload += value; return;
    case 'WEAPON_AMMO_POOL_MULTISHOT_DAMAGE':
      if (stat.OperationType === 'ADD_BASE') fx.ammoPoolFlat += value;
      else if (stat.OperationType === 'STACKING_MULTIPLY') fx.ammoPoolPercent += value;
      return;
    case 'WEAPON_MAGAZINE_CAPACITY': {
      const op = magazineOperation(stat);
      if (op === 'ADD_BASE') fx.baseMagazine += value;
      else if (op === 'STACKING_MULTIPLY') fx.modifiers.magazine += value;
      return;
    }
    case 'WEAPON_LAST_MAGAZINE_BURST_MULTISHOT': if (stat.OperationType === 'ADD_BASE' && value > 0) fx.lastMagazineBurst += value; return;
    case 'WEAPON_LAST_MAGAZINE_SHOTS_MULTISHOT': {
      const shots = Math.floor(Number(stat.LastShots));
      if (shots > 0 && value > 0) fx.lastMagazineShots.push({ shots, value });
      return;
    }
    case 'WEAPON_HEADSHOT_MULTIPLIER': return;
    case 'WEAPON_HEADSHOT_DAMAGE': fx.modifiers.weakPointDamage += value; return;
    case 'WEAPON_CRITICAL_CHANCE_FLAT': fx.ext.flatCritChance += value; return;
    case 'WEAPON_BASE_DAMAGE': fx.baseDamageBonus += value; break;
    default:
  }
  if (MODE_EDITS.has(stat.UpgradeType)) fx.modeEdits.push({ stat, value, description, doubles: /effect\s+doubles\s+in\s+incarnon\s+form/i.test(description) });
}

/** A conditional perk stat at its state's stacks (nothing while off). */
function addConditional(fx, weapon, evolution, perk, stat, description, state) {
  if (!state?.isActive) return;
  const channel = utilityChannel(weapon.name, evolution, perk, stat, true);
  const max = statMaxStacks(description, stat);
  const stacks = max > 1 ? Math.min(max, Math.max(0, Number(state.stacks) || 0)) : 1;
  if (channel && Number.isFinite(Number(stat.Value))) addUtility(fx, channel, Number(stat.Value) * stacks);
  const value = num(stat.Value) * stacks;
  if (Number.isNaN(value)) return;
  const m = fx.modifiers;
  switch (stat.UpgradeType) {
    case 'WEAPON_BASE_DAMAGE': {
      const text = typeof stat.OriginalValue === 'string' ? stat.OriginalValue : '';
      if (/%/.test(text)) { m.damage += value; fx.simulationAdditiveDamage += value; } else fx.conditionalBaseDamage.push({ value, perProjectile: /per\s*(pellet|projectile)/i.test(text) });
      break;
    }
    case 'WEAPON_DAMAGE_AMOUNT': if (stat.OperationType === 'STACKING_MULTIPLY') { m.damage += value; fx.simulationAdditiveDamage += value; } break;
    case 'ADDITIVE_WEAPON_DAMAGE': m.damage += value; fx.simulationAdditiveDamage += value; break;
    case 'WEAPON_MAGAZINE_CAPACITY': {
      const op = magazineOperation(stat);
      if (op === 'ADD_BASE') fx.baseMagazine += value;
      else if (op === 'STACKING_MULTIPLY') m.magazine += value;
      break;
    }
    case 'WEAPON_MULTISHOT': m.multishot += value; break;
    case 'WEAPON_CRITICAL_CHANCE': case 'ADDITIVE_WEAPON_CRITICAL_CHANCE': m.critChance += value; break;
    case 'ADDITIVE_WEAPON_CRITICAL_MULTIPLIER': m.critDamage += value; break;
    // A slide attack's crit multiplier is melee only.
    case 'WEAPON_CRITICAL_MULTIPLIER': if (!String(stat.Stat).includes('slide attack')) fx.baseCritDamage += value; break;
    case 'MULTIPLICATIVE_WEAPON_CRITICAL_MULTIPLIER': fx.ext.multiplicativeCritDamage *= 1 + value; break;
    case 'WEAPON_RANGE': m.range += value; break;
    case 'WEAPON_STATUS_CHANCE': m.statusChance += value; break;
    case 'WEAPON_FIRE_RATE': case 'WEAPON_ATTACK_SPEED': m.fireRate += value; break;
    case 'ADDITIVE_WEAPON_FIRE_RATE': {
      // A whole-number value is the perk's percentage read from its text.
      let v = value;
      if (Math.abs(v) > 5 || Math.abs(v) === 1) {
        const pct = String(stat.OriginalValue ?? '').match(/([+-]?[0-9]+(?:\.[0-9]+)?)%/);
        if (pct) v = (Number(pct[1]) / 100) * stacks;
      }
      m.fireRate += v;
      break;
    }
    case 'WEAPON_RELOAD_SPEED': m.reload += value; break;
    case 'WEAPON_PUNCTURE_DEPTH': m.punchThrough += value; break;
    case 'WEAPON_BLAST_RADIUS': case 'WEAPON_EXPLOSION_RADIUS':
      if (Object.prototype.hasOwnProperty.call(stat, 'DisplayAsPercent') && !['1', 1, true].includes(stat.DisplayAsPercent)) m.flatBlastRadius += value;
      else m.blastRadius += value;
      break;
    case 'WEAPON_ACCURACY': fx.accuracy += value; break;
    case 'WEAPON_INFINITE_AMMO': fx.ext.infiniteAmmo ||= value > 0; break;
    case 'WEAPON_AMMO_EFFICIENCY': m.ammoEfficiency += value; break;
    case 'WEAPON_DAMAGE_IF_VICTIM_PROC_ACTIVE': m.conditionOverload += value; break;
    case 'WEAPON_HEADSHOT_DAMAGE': m.weakPointDamage += value; break;
    case 'WEAPON_FORCE_PROC': fx.bleedOnImpactChance = value; break;
    case 'WEAPON_CRITICAL_CHANCE_FLAT': fx.ext.flatCritChance += value; break;
    case 'WEAPON_CRITICAL_MULTIPLIER_FLAT': fx.ext.flatCritDamage += value; break;
    case 'WEAPON_BODYSHOT_CRIT_CHANCE_MULTIPLIER': fx.engine.bodyshotCritChanceMultiplier = value; break;
    case 'WEAPON_NON_CRIT_DAMAGE_MULTIPLIER': fx.nonCritDamageMultiplier = value; break;
    case 'WEAPON_NOCRIT_DAMAGE': fx.guaranteedNonCritDamage += value; break;
    case 'WEAPON_FORCE_PROC_COUNT': if (String(stat.Stat).toLowerCase().includes('puncture')) fx.forceProcCount = { type: 'Puncture', count: value }; break;
    case 'WEAPON_ELEMENTAL_DAMAGE': {
      const t = String(stat.Stat).replace(' damage', '');
      const type = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
      fx.elements[type] = (fx.elements[type] ?? 0) + value;
      break;
    }
    case 'WEAPON_FOLLOW_THROUGH': m.followThrough += value; break;
    case 'WEAPON_STATUS_DAMAGE': fx.statusDamage += value; break;
    case 'ENEMY_ARMOR_REDUCTION': fx.engine.armorStripPerHit += value; break;
    case 'WEAPON_HEADSHOT_MULTIPLIER': fx.engine.headshotMultiplier += value; break;
    case 'WEAPON_CRIT_CHANCE_FROM_STATUS_CHANCE': case 'WEAPON_STATUS_CHANCE_FROM_CRIT_CHANCE': {
      const cap = String(stat.OriginalValue ?? '').match(/up to\s*([0-9]+(?:\.[0-9]+)?)%/i);
      (stat.UpgradeType === 'WEAPON_CRIT_CHANCE_FROM_STATUS_CHANCE' ? fx.critChanceFromStatus : fx.statusChanceFromCrit).push({ ratio: value, cap: cap ? Number(cap[1]) : null });
      break;
    }
    default:
  }
}

/**
 * What a build's perks do, at the given conditional states (incarnonStates()). Null while the Genesis is not installed
 * or the weapon has no evolutions.
 */
export function incarnonEffects(data, weapon, incarnon, states = {}) {
  const entry = incarnonFor(data, weapon);
  if (!entry || !incarnonActive(incarnon)) return null;
  const fx = emptyEffects();
  fx.states = states;
  for (const e of INCARNON_EVOLUTIONS) {
    const picked = pickedPerk(entry, incarnon, e);
    if (!picked) continue;
    for (const stat of picked.evo[`perk_${picked.perk}_stats`] ?? []) if (stat) addAlwaysOn(fx, weapon.name, e, picked.perk, stat, picked.description);
    for (const stat of picked.evo[`perk_${picked.perk}_conditional_stats`] ?? []) {
      if (stat?.Stat) addConditional(fx, weapon, e, picked.perk, stat, picked.description, states[conditionalId(weapon.name, e, picked.perk, stat)]);
    }
  }
  // The Latron family's Evolution IV: Flensing Spikes strips armor with each Puncture status; Deadhead also raises the
  // headshot multiplier the engine adds.
  if (LATRONS.has(weapon.name)) {
    if (incarnon.evolution_4_perk === 1) fx.punctureArmorStrip = 0.2;
    if (Number(incarnon.evolution_4_perk) === 2) fx.engine.externalHeadshotMultiplierBonus += 1;
  }
  return fx;
}

/** The status chance an always-on perk adds to a mode: per form, per pellet, or one variant's value (the Strun family). */
function statusBonus(edit, mode, weaponName, value) {
  const incarnonMode = isIncarnonName(mode.mode_name);
  const byForm = edit.stat.StatusChanceByForm?.[incarnonMode ? 'incarnon' : 'normal'];
  if (typeof byForm === 'number' && Number.isFinite(byForm)) return byForm;
  const text = [edit.stat.OriginalValue || '', edit.description].filter(Boolean).join(' ');
  let base = Number.isNaN(value) ? 0 : value;
  const pellet = /per\s*(?:pellet|projectile)/i.test(text) ? text.match(/\+([0-9]+(?:\.[0-9]+)?)%\s*per\s*(?:pellet|projectile)/i) : null;
  if (pellet) base = Number(pellet[1]) / 100;
  let incarnonBonus = null;
  const forForm = text.match(/\+([0-9]+(?:\.[0-9]+)?)%[^+]*for\s*Incarnon\s*Form/i);
  if (forForm) incarnonBonus = Number(forForm[1]) / 100;
  else {
    const section = text.match(/Increase Incarnon Form Status Chance by ([^.]*)/i)?.[1].match(/\+([0-9]+(?:\.[0-9]+)?)%/);
    if (section) incarnonBonus = Number(section[1]) / 100;
  }
  const variant = STATUS_VARIANT[weaponName];
  if (variant) {
    const re = new RegExp(`\\+([0-9]+(?:\\.[0-9]+)?)%\\s*\\(${variant}\\)`, 'i');
    const lower = text.toLowerCase();
    const at = lower.indexOf('increase incarnon form status chance');
    const split = at !== -1 ? at : lower.indexOf('for incarnon form');
    const before = split !== -1 ? text.slice(0, split) : text;
    const after = split !== -1 ? text.slice(split) : '';
    const b = before.match(re);
    if (b) base = Number(b[1]) / 100;
    const a = after ? after.match(re) : null;
    if (a) incarnonBonus = Number(a[1]) / 100;
  }
  return incarnonMode && incarnonBonus !== null ? incarnonBonus : base;
}

/**
 * The weapon's modes with the always-on perks applied to their own values (stats.js preparedModes() output, copied),
 * and each mode's flat conditional base damage folded into its damage (`incarnonConditionalBase`).
 */
export function applyIncarnonToModes(modes, fx, weapon) {
  if (!fx) return modes;
  return modes.map(src => {
    const mode = { ...src, ...(src.innate_elements ? { innate_elements: { ...src.innate_elements } } : {}) };
    const incarnonMode = isIncarnonName(mode.mode_name);
    for (const edit of fx.modeEdits) {
      const v = edit.doubles && incarnonMode ? edit.value * 2 : edit.value;
      switch (edit.stat.UpgradeType) {
        case 'WEAPON_BASE_DAMAGE':
          if (mode.base_damage !== undefined) {
            const old = mode.base_damage || 0;
            if (old > 0) {
              const k = (old + v) / old;
              mode.base_damage *= k;
              for (const t of Object.keys(mode.innate_elements ?? {})) mode.innate_elements[t] *= k;
            } else mode.base_damage += v;
          }
          break;
        case 'WEAPON_CRITICAL_CHANCE': if (mode.crit_chance !== undefined) mode.crit_chance += v * 100; break;
        case 'WEAPON_CRITICAL_MULTIPLIER': if (mode.crit_multiplier !== undefined) mode.crit_multiplier += v; break;
        case 'WEAPON_STATUS_CHANCE': if (mode.status_chance !== undefined) mode.status_chance += statusBonus(edit, mode, weapon?.name, v) * 100; break;
        case 'WEAPON_FIRE_RATE': if (mode.fire_rate !== undefined) mode.fire_rate *= 1 + v; break;
        case 'WEAPON_ATTACK_SPEED': if (typeof mode.fire_rate === 'number' && !Number.isNaN(mode.fire_rate)) mode.fire_rate *= 1 + v; break;
        case 'WEAPON_MULTISHOT': if (mode.multishot !== undefined) mode.multishot += v; break;
        case 'WEAPON_PUNCTURE_DEPTH': {
          if (isAoe(mode)) break;
          const raw = Number(mode.punch_through);
          if (Number.isFinite(raw) && raw === -1) break;
          mode.punch_through = (Number.isFinite(raw) ? raw : 0) + v;
          break;
        }
        case 'WEAPON_RANGE': if (mode.range !== undefined) mode.range += v; break;
        default:
      }
    }
    // Flat conditional base damage (per projectile where the perk says so) scales every damage type of the mode.
    const projectiles = Math.max(typeof mode.multishot === 'number' && !Number.isNaN(mode.multishot) ? mode.multishot : 1, 1);
    const bonus = fx.conditionalBaseDamage.reduce((a, b) => a + (Number.isFinite(b.value) ? b.value * (b.perProjectile ? projectiles : 1) : 0), 0);
    mode.incarnonConditionalBase = bonus;
    if (bonus !== 0) {
      const own = mode.innate_elements ?? {};
      const sum = Object.values(own).reduce((a, b) => a + (Number(b) || 0), 0);
      if (sum > 0) for (const t of Object.keys(own)) own[t] *= (sum + bonus) / sum;
      else mode.innate_elements = { ...own, Impact: (own.Impact ?? 0) + bonus };
    }
    return mode;
  });
}

/** The perks' elements ([type, fraction of the base]), in the order they join the mods' own. */
export const incarnonElements = fx => Object.entries(fx?.elements ?? {}).filter(([, v]) => Number.isFinite(v) && v !== 0);

/**
 * The perks' part of the engine's conditionalStats (non-default fields only), or null.
 */
export function incarnonConditionalStats(fx) {
  if (!fx) return null;
  const e = fx.engine;
  const cs = {};
  if (e.armorStripPerHit) cs.armorStripPerHit = e.armorStripPerHit;
  if (e.bodyshotCritChanceMultiplier !== 1) cs.bodyshotCritChanceMultiplier = e.bodyshotCritChanceMultiplier;
  if (e.projectileSpeed) cs.projectileSpeed = e.projectileSpeed;
  if (e.externalHeadshotMultiplierBonus) cs.externalHeadshotMultiplierBonus = e.externalHeadshotMultiplierBonus;
  return Object.keys(cs).length ? cs : null;
}

/** "Evolution II: Hunter's Mantra" lines for a build's picked perks (empty while not installed). */
export function incarnonSummary(data, weapon, incarnon) {
  if (!incarnonActive(incarnon)) return [];
  return incarnonEvolutions(incarnonFor(data, weapon)).map(evo => {
    const p = evo.perks.find(x => x.number === incarnon[`evolution_${evo.number}_perk`]);
    return p ? `${evo.label}: ${p.name}` : null;
  }).filter(Boolean);
}
