// Auto Build settings, configs and the lists they hold (docs/port-auto-build.md 2): the defaults and clamps of
// underframe.site's settings, named configs (a locked Default plus the user's own), elemental target labels and the
// stat families the stat blacklist removes. Pure: no DOM, no storage; the controller persists the library.

import { DAMAGE_TYPE_BY_DT } from './damage.js';

// ---------- elements ----------

/** Elements a target may name. */
export const TARGET_ELEMENTS = Object.freeze(['Heat', 'Cold', 'Electricity', 'Toxin', 'Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral']);

/** The site's 15 presets for the specific elemental whitelist and the elemental blacklist, in its order. */
export const ELEMENT_PRESETS = Object.freeze([
  { name: 'Heat', target: ['Heat'] },
  { name: 'Cold', target: ['Cold'] },
  { name: 'Electricity', target: ['Electricity'] },
  { name: 'Toxin', target: ['Toxin'] },
  { name: 'Viral', target: ['Viral'] },
  { name: 'Corrosive', target: ['Corrosive'] },
  { name: 'Radiation', target: ['Radiation'] },
  { name: 'Blast', target: ['Blast'] },
  { name: 'Gas', target: ['Gas'] },
  { name: 'Magnetic', target: ['Magnetic'] },
  { name: 'Viral Heat', target: ['Heat', 'Viral'] },
  { name: 'Viral Electricity', target: ['Electricity', 'Viral'] },
  { name: 'Corrosive Heat', target: ['Corrosive', 'Heat'] },
  { name: 'Corrosive Cold', target: ['Cold', 'Corrosive'] },
  { name: 'Corrosive Blast', target: ['Blast', 'Corrosive'] },
]);

/** The quick buttons shown above both element lists. */
export const QUICK_ELEMENT_TARGETS = Object.freeze(['Heat', 'Viral', 'Viral Heat']);

const ELEMENT_ALIASES = { fire: 'Heat', freeze: 'Cold', poison: 'Toxin', electric: 'Electricity' };

/**
 * Parse an element target label: "No Element" / "None" is the empty target, a preset name its elements, anything else
 * split on commas, plus signs and spaces ("Viral + Heat", "corrosive,blast"). Returns { name, target } with the
 * elements sorted and de-duplicated, or null when a word is not an element.
 */
export function parseElementTarget(label) {
  const text = String(label ?? '').trim();
  if (!text) return null;
  if (/^(no element|none)$/i.test(text)) return { name: 'No Element', target: [] };
  const preset = ELEMENT_PRESETS.find(p => p.name.toLowerCase() === text.toLowerCase());
  if (preset) return { name: preset.name, target: [...preset.target] };
  const out = new Set();
  for (const raw of text.split(/[\s,+]+/).filter(Boolean)) {
    const w = raw.toLowerCase();
    const el = ELEMENT_ALIASES[w] ?? TARGET_ELEMENTS.find(e => e.toLowerCase() === w);
    if (!el) return null;
    out.add(el);
  }
  if (!out.size) return null;
  const target = [...out].sort();
  return { name: targetLabel(target), target };
}

/** The display name of an element set: a preset's name when one matches, else the elements joined ("Blast Toxin"). */
export function targetLabel(target) {
  const key = [...target].sort().join('|');
  if (!key) return 'No Element';
  return ELEMENT_PRESETS.find(p => [...p.target].sort().join('|') === key)?.name ?? [...target].sort().join(' ');
}

/** Labels to targets, de-duplicated by element set; unparseable and (optionally) empty ones dropped. */
export function parseTargetList(labels, { dropEmpty = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const l of Array.isArray(labels) ? labels : []) {
    const t = parseElementTarget(l);
    if (!t || (dropEmpty && !t.target.length)) continue;
    const k = t.target.join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Whether an element signature contains every element of a blacklisted target ("Heat" blocks anything with Heat). */
export function blockedByElementalBlacklist(signature, blacklistTargets) {
  const have = new Set(signature ?? []);
  return (blacklistTargets ?? []).some(t => t.target.length && t.target.every(e => have.has(e)));
}

// ---------- stat families ----------

/** The 16 stat families of the stat blacklist, in the site's order, with their labels. */
export const STAT_FAMILIES = Object.freeze([
  { key: 'damage', label: 'Damage' },
  { key: 'critChance', label: 'Critical Chance' },
  { key: 'critDamage', label: 'Critical Damage' },
  { key: 'statusChance', label: 'Status Chance' },
  { key: 'multishot', label: 'Multishot' },
  { key: 'speed', label: 'Fire Rate / Attack Speed' },
  { key: 'punchThrough', label: 'Punch Through' },
  { key: 'reloadSpeed', label: 'Reload Speed' },
  { key: 'magazine', label: 'Magazine' },
  { key: 'faction', label: 'Faction Damage' },
  { key: 'cold', label: 'Cold' },
  { key: 'heat', label: 'Heat' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'toxin', label: 'Toxin' },
  { key: 'initialCombo', label: 'Initial Combo' },
  { key: 'range', label: 'Range' },
]);

export const QUICK_STAT_FAMILIES = Object.freeze(['damage', 'speed', 'multishot']);

const STAT_ALIASES = {
  'critical chance': 'critChance', 'crit chance': 'critChance', cc: 'critChance',
  'critical damage': 'critDamage', 'crit damage': 'critDamage', 'crit multiplier': 'critDamage', cd: 'critDamage',
  'status chance': 'statusChance', status: 'statusChance', sc: 'statusChance',
  multishot: 'multishot', ms: 'multishot',
  'fire rate': 'speed', 'attack speed': 'speed', 'fire rate / attack speed': 'speed', 'fire rate/attack speed': 'speed', speed: 'speed',
  'punch through': 'punchThrough', punchthrough: 'punchThrough',
  'reload speed': 'reloadSpeed', reload: 'reloadSpeed',
  magazine: 'magazine', 'magazine size': 'magazine', 'magazine capacity': 'magazine', ammo: 'magazine',
  faction: 'faction', 'faction damage': 'faction', bane: 'faction',
  'initial combo': 'initialCombo', range: 'range', damage: 'damage',
};

/** A stat family key from a key, label or alias ("Fire Rate", "crit chance"), or null. */
export function normalizeStatKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const byKey = STAT_FAMILIES.find(f => f.key === s);
  if (byKey) return byKey.key;
  const lower = s.toLowerCase();
  const byLabel = STAT_FAMILIES.find(f => f.label.toLowerCase() === lower);
  return byLabel?.key ?? STAT_ALIASES[lower] ?? null;
}

const ELEMENT_ADDED = new Set(['WEAPON_PERCENT_BASE_DAMAGE_ADDED', 'WEAPON_PERCENT_BASE_DAMAGE_ADDED_POST_COALESCE']);
const ELEMENT_FAMILY = { Cold: 'cold', Heat: 'heat', Electricity: 'electricity', Toxin: 'toxin' };

/** Stat families a mod changes (docs/port-auto-build.md 2.5), from each stat's UpgradeType, plus the site's name rules. */
export function modStatFamilies(mod) {
  const out = new Set();
  for (const s of mod?.Stats ?? []) {
    const t = String(s?.UpgradeType ?? '');
    if (/CRITICAL_CHANCE|CRIT_CHANCE/.test(t) && !/SLIDE/.test(t)) out.add('critChance');
    if (/CRITICAL_DAMAGE|CRIT_DAMAGE/.test(t)) out.add('critDamage');
    if (/PROC_CHANCE|STATUS_CHANCE/.test(t)) out.add('statusChance');
    if (/MULTISHOT|FIRE_ITERATIONS/.test(t)) out.add('multishot');
    if (/PUNCTURE_DEPTH/.test(t)) out.add('punchThrough');
    if (/FIRE_RATE|ATTACK_SPEED/.test(t)) out.add('speed');
    if (t === 'WEAPON_DAMAGE_AMOUNT' || /MELEE_DAMAGE|DAMAGE_AMOUNT/.test(t)) out.add('damage');
    if (/RELOAD_SPEED/.test(t)) out.add('reloadSpeed');
    if (/CLIP_MAX|MAGAZINE|AMMO_MAX/.test(t)) out.add('magazine');
    if (/FACTION_DAMAGE|DAMAGE_TO_FACTION/.test(t)) out.add('faction');
    if (/INITIAL_COMBO/.test(t)) out.add('initialCombo');
    if (t === 'WEAPON_ATTACK_RANGE' || /_RANGE$/.test(t)) out.add('range');
    if (ELEMENT_ADDED.has(t)) {
      const fam = ELEMENT_FAMILY[DAMAGE_TYPE_BY_DT[s.DamageType]];
      if (fam) out.add(fam);
    }
  }
  const name = String(mod?.['Local Name'] ?? '');
  if (name === 'Hunter Synergy') out.add('critChance');
  if (name === 'Mecha Overdrive') out.add('statusChance');
  if (/Cannonade/.test(name) || /fire rate cannot be modified/i.test(String(mod?.Description ?? ''))) out.add('speed');
  return out;
}

// ---------- settings ----------

/** Our own addition: a wall-clock limit for one run (the site has none). */
export const TIME_LIMIT_RANGE = Object.freeze({ min: 10, max: 3600, default: 300 });

const SIM_TIME = { min: 1, max: 300 };
const MULTIPLIER = { min: 0.2, max: 1000 };
const MAX_FORMA = { min: 0, max: 10 };
const MAX_LIST = 2000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const names = list => {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const n = String(raw ?? '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_LIST) break;
  }
  return out;
};

/**
 * The site's defaults (docs/port-auto-build.md 2.1). The blacklist and whitelist come from data.json; names on both
 * are left out of the default whitelist (the blacklist wins anyway, so listing them there only contradicts it).
 */
export function defaultAutoBuildSettings(data) {
  const blacklist = names(data?.blacklist);
  const black = new Set(blacklist);
  return {
    simulationTimeSeconds: 5,
    sampleSizeMultiplier: 3,
    finalRefinementEnabled: true,
    finalRefinementSampleSize: 200,
    luckAveragedEnabled: true,
    buildForSingleHit: false,
    buildForFloor: false,
    elementalCandidatesEnabled: true,
    specificElementalCandidatesEnabled: false,
    specificElementalTargets: [],
    elementalBlacklistEnabled: false,
    elementalBlacklist: [],
    costControlEnabled: false,
    maxForma: 5,
    buildForRawDamage: false,
    buildForStatusDamage: false,
    modWhitelistEnabled: false,
    modWhitelist: names(data?.whitelist).filter(n => !black.has(n)),
    statBlacklistEnabled: false,
    statBlacklist: [],
    modBlacklistEnabled: true,
    modBlacklist: blacklist,
    timeLimitSeconds: TIME_LIMIT_RANGE.default,
  };
}

/** Normalise settings: defaults for missing fields, the site's clamps, legacy keys, raw/status exclusive. */
export function normalizeAutoBuildSettings(raw, data) {
  const d = defaultAutoBuildSettings(data);
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = { ...d };
  s.simulationTimeSeconds = clamp(Math.round(num(r.simulationTimeSeconds, d.simulationTimeSeconds)), SIM_TIME.min, SIM_TIME.max);
  s.sampleSizeMultiplier = clamp(num(r.sampleSizeMultiplier, d.sampleSizeMultiplier), MULTIPLIER.min, MULTIPLIER.max);
  s.finalRefinementEnabled = r.finalRefinementEnabled !== false;
  s.finalRefinementSampleSize = Math.max(1, Math.round(num(r.finalRefinementSampleSize, d.finalRefinementSampleSize)));
  s.luckAveragedEnabled = 'luckAveragedEnabled' in r ? r.luckAveragedEnabled === true : d.luckAveragedEnabled;
  s.buildForSingleHit = r.buildForSingleHit === true;
  s.buildForFloor = r.buildForFloor === true;
  s.elementalCandidatesEnabled = r.elementalCandidatesEnabled !== false;
  const specificOn = r.specificElementalCandidatesEnabled ?? r.limitedElementalCandidatesEnabled;
  s.specificElementalCandidatesEnabled = specificOn === true && s.elementalCandidatesEnabled;
  s.specificElementalTargets = names(r.specificElementalTargets ?? r.limitedElementalTargets);
  s.elementalBlacklistEnabled = r.elementalBlacklistEnabled === true;
  s.elementalBlacklist = parseTargetList(names(r.elementalBlacklist), { dropEmpty: true }).map(t => t.name);
  s.costControlEnabled = r.costControlEnabled === true;
  s.maxForma = clamp(Math.round(num(r.maxForma, d.maxForma)), MAX_FORMA.min, MAX_FORMA.max);
  s.buildForStatusDamage = r.buildForStatusDamage === true;
  s.buildForRawDamage = r.buildForRawDamage === true && !s.buildForStatusDamage;
  s.modWhitelistEnabled = r.modWhitelistEnabled === true;
  s.modWhitelist = Array.isArray(r.modWhitelist) ? names(r.modWhitelist) : d.modWhitelist;
  if (s.modWhitelistEnabled && !s.modWhitelist.length) s.modWhitelist = d.modWhitelist;
  s.statBlacklistEnabled = r.statBlacklistEnabled === true;
  s.statBlacklist = [...new Set((Array.isArray(r.statBlacklist) ? r.statBlacklist : []).map(normalizeStatKey).filter(Boolean))];
  s.modBlacklistEnabled = r.modBlacklistEnabled !== false;
  s.modBlacklist = Array.isArray(r.modBlacklist) ? names(r.modBlacklist) : d.modBlacklist;
  s.timeLimitSeconds = clamp(Math.round(num(r.timeLimitSeconds, d.timeLimitSeconds)), TIME_LIMIT_RANGE.min, TIME_LIMIT_RANGE.max);
  return s;
}

/** Engine runs per evaluation: max(1, round(base / 5 * multiplier)) (runs(10) = 6 at the default multiplier 3). */
export function runsFor(base, multiplier) {
  return Math.max(1, Math.round((base / 5) * multiplier));
}

/** The metric a run scores: 'avgDps', or per shot 'avgRawPerShot' (raw) / 'avgDotPerShot' (status). */
export function metricOf(settings) {
  if (settings.buildForStatusDamage) return 'avgDotPerShot';
  if (settings.buildForRawDamage) return 'avgRawPerShot';
  return 'avgDps';
}

/** Whitelisted names that the (enabled) blacklist removes again: the site's silent overlap, which we say out loud. */
export function whitelistOverlap(settings) {
  if (!settings.modWhitelistEnabled || !settings.modBlacklistEnabled) return [];
  const bl = new Set(settings.modBlacklist);
  return settings.modWhitelist.filter(n => bl.has(n));
}

// ---------- configs ----------

export const DEFAULT_CONFIG_ID = 'default';
export const DEFAULT_CONFIG_NAME = 'Default';
export const YOUR_CONFIG_ID = 'your_config';
export const YOUR_CONFIG_NAME = 'Your Config';
export const LIBRARY_VERSION = 1;
const MAX_CONFIGS = 50;
const MAX_NAME = 60;

export const CONFIG_MESSAGES = Object.freeze({
  defaultLocked: 'The Default auto build config cannot be changed. Duplicate it (or create a new config) to make edits.',
  deleteActive: 'You cannot delete the currently selected auto build config. Select a different config first.',
  reserved: 'The name "Default" is reserved.',
  emptyName: 'Enter a name.',
  tooMany: `You can keep up to ${MAX_CONFIGS} configs.`,
  unknown: 'That config no longer exists.',
});

const slug = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'config';

function uniqueName(name, configs, exceptId = null) {
  const taken = new Set(configs.filter(c => c.id !== exceptId).map(c => c.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const n = `${name} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

function uniqueId(name, configs) {
  const base = slug(name);
  const taken = new Set(configs.map(c => c.id));
  if (!taken.has(base) && base !== DEFAULT_CONFIG_ID) return base;
  for (let i = 2; ; i++) {
    const id = `${base}_${i}`;
    if (!taken.has(id)) return id;
  }
}

const cleanName = raw => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const isReserved = name => name.toLowerCase() === DEFAULT_CONFIG_NAME.toLowerCase();

/**
 * "Your Config" as first created: the site's defaults with Cost Control on (an app decision, docs/port-auto-build.md
 * 12.2), so a first run proposes a build that can be equipped, with the Forma it needs.
 */
export function yourConfigSettings(data) {
  return { ...defaultAutoBuildSettings(data), costControlEnabled: true };
}

/** The locked Default config: always the current defaults (never stored values, so new data defaults flow in). */
export const defaultConfig = data => ({ id: DEFAULT_CONFIG_ID, name: DEFAULT_CONFIG_NAME, locked: true, settings: defaultAutoBuildSettings(data) });

/**
 * A valid library: Default first (locked), then the user's configs (normalised, unique names and ids), at least one
 * editable config ("Your Config" is created when none), an active id that exists, and the device's worker count
 * (`cores`: null for automatic).
 */
export function normalizeAutoBuildLibrary(raw, data) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const configs = [defaultConfig(data)];
  for (const c of (Array.isArray(r.configs) ? r.configs : []).slice(0, MAX_CONFIGS + 1)) {
    if (!c || typeof c !== 'object' || c.id === DEFAULT_CONFIG_ID || c.locked) continue;
    let name = cleanName(c.name);
    if (!name || isReserved(name)) continue;
    name = uniqueName(name, configs);
    const id = typeof c.id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(c.id) && !configs.some(x => x.id === c.id) ? c.id : uniqueId(name, configs);
    configs.push({ id, name, locked: false, settings: normalizeAutoBuildSettings(c.settings, data) });
  }
  if (configs.length === 1) configs.push({ id: YOUR_CONFIG_ID, name: YOUR_CONFIG_NAME, locked: false, settings: yourConfigSettings(data) });
  const firstEditable = configs.find(c => !c.locked).id;
  const activeConfigId = configs.some(c => c.id === r.activeConfigId) ? r.activeConfigId : firstEditable;
  const cores = Number.isInteger(r.cores) && r.cores >= 1 && r.cores <= 64 ? r.cores : null;
  return { version: LIBRARY_VERSION, activeConfigId, configs, cores };
}

/** What is stored: Default is recomputed on load, so it is left out. */
export function serializeAutoBuildLibrary(library) {
  return {
    version: LIBRARY_VERSION,
    activeConfigId: library.activeConfigId,
    configs: library.configs.filter(c => !c.locked).map(c => ({ id: c.id, name: c.name, settings: c.settings })),
    cores: library.cores ?? null,
  };
}

export const activeConfig = library => library.configs.find(c => c.id === library.activeConfigId) ?? library.configs[0];

/** The settings a run uses: the active config's. */
export const effectiveSettings = library => activeConfig(library).settings;

export function setActiveConfig(library, id) {
  if (!library.configs.some(c => c.id === id)) return { error: CONFIG_MESSAGES.unknown };
  return { library: { ...library, activeConfigId: id } };
}

/** Change settings of an editable config (the patch is merged, then normalised). */
export function updateConfigSettings(library, id, patch, data) {
  const c = library.configs.find(x => x.id === id);
  if (!c) return { error: CONFIG_MESSAGES.unknown };
  if (c.locked) return { error: CONFIG_MESSAGES.defaultLocked };
  const settings = normalizeAutoBuildSettings({ ...c.settings, ...patch }, data);
  return { library: { ...library, configs: library.configs.map(x => (x.id === id ? { ...x, settings } : x)) } };
}

/** A new config with `settings` (the current effective settings by default); it does not become active. */
export function addConfig(library, rawName, settings, data) {
  const name = cleanName(rawName);
  if (!name) return { error: CONFIG_MESSAGES.emptyName };
  if (isReserved(name)) return { error: CONFIG_MESSAGES.reserved };
  if (library.configs.length > MAX_CONFIGS) return { error: CONFIG_MESSAGES.tooMany };
  const unique = uniqueName(name, library.configs);
  const id = uniqueId(unique, library.configs);
  const config = { id, name: unique, locked: false, settings: normalizeAutoBuildSettings(settings ?? effectiveSettings(library), data) };
  return { library: { ...library, configs: [...library.configs, config] }, id };
}

/** "Copy of X", right after X (Default's copy goes to the end). */
export function duplicateConfig(library, id, data) {
  const c = library.configs.find(x => x.id === id);
  if (!c) return { error: CONFIG_MESSAGES.unknown };
  const r = addConfig(library, `Copy of ${c.name}`.slice(0, MAX_NAME), c.settings, data);
  if (r.error) return r;
  const configs = r.library.configs.slice();
  const copy = configs.pop();
  const at = c.locked ? configs.length : configs.indexOf(configs.find(x => x.id === id)) + 1;
  configs.splice(at, 0, copy);
  return { library: { ...r.library, configs }, id: r.id };
}

export function renameConfig(library, id, rawName) {
  const c = library.configs.find(x => x.id === id);
  if (!c) return { error: CONFIG_MESSAGES.unknown };
  if (c.locked) return { error: CONFIG_MESSAGES.defaultLocked };
  const name = cleanName(rawName);
  if (!name) return { error: CONFIG_MESSAGES.emptyName };
  if (isReserved(name)) return { error: CONFIG_MESSAGES.reserved };
  const unique = uniqueName(name, library.configs, id);
  return { library: { ...library, configs: library.configs.map(x => (x.id === id ? { ...x, name: unique } : x)) } };
}

export function deleteConfig(library, id) {
  const c = library.configs.find(x => x.id === id);
  if (!c) return { error: CONFIG_MESSAGES.unknown };
  if (c.locked) return { error: CONFIG_MESSAGES.defaultLocked };
  if (library.activeConfigId === id) return { error: CONFIG_MESSAGES.deleteActive };
  const configs = library.configs.filter(x => x.id !== id);
  // There is always one editable config.
  if (!configs.some(x => !x.locked)) return { error: CONFIG_MESSAGES.deleteActive };
  return { library: { ...library, configs } };
}

/** Move a config up (-1) or down (+1); Default stays first. */
export function moveConfig(library, id, dir) {
  const i = library.configs.findIndex(x => x.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i <= 0 || j <= 0 || j >= library.configs.length) return { library };
  const configs = library.configs.slice();
  [configs[i], configs[j]] = [configs[j], configs[i]];
  return { library: { ...library, configs } };
}
