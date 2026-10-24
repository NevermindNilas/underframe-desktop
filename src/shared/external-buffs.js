// External buffs, external statuses and buff presets: effects from outside the weapon (Warframe abilities,
// Helminth, passives, arcanes, archon shards, mods, or a typed-in value) and status effects already on the target.
// Pure: no DOM, no engine. docs/port-external-buffs.md is the contract this follows.
//
// How a buff list reaches the Underframe engine (probed against core/engine, see the doc's section 9):
// - The engine never sees the list. reduceExternalBuffs() turns it into one totals object, the way
//   underframe.site does.
// - Most stat buffs do nothing as conditionalStats fields: they are folded into weaponStats per fire mode
//   (stats.js computeFireMode with `ext`), and External Armor Strip lowers the enemy's armor.
// - A set of fields is applied only by the engine (procs, final multipliers, vulnerabilities, Sonar, ...).
// - Both go to the engine anyway, as the site sends them: externalConditionalStats() is the conditionalStats part.
// - External statuses go in the CACHED app state (`appState.externalStatuses`); a top-level copy is ignored.

/** The status types the site offers, in its order (element selects and the external statuses list). */
export const STATUS_TYPES = Object.freeze([
  'Impact', 'Puncture', 'Slash', 'Heat', 'Cold', 'Electricity', 'Toxin', 'Blast', 'Corrosive', 'Gas', 'Magnetic', 'Radiation', 'Viral', 'Void', 'Tau',
]);
const PHYSICAL_TYPES = ['Impact', 'Puncture', 'Slash'];
const ELEMENTAL_TYPES = STATUS_TYPES.filter(t => !PHYSICAL_TYPES.includes(t) && t !== 'Void' && t !== 'Tau');

/** Element names some data and older builds use, mapped to the engine's. */
const ELEMENT_ALIASES = Object.freeze({
  fire: 'Heat', freeze: 'Cold', poison: 'Toxin', electric: 'Electricity', explosion: 'Blast',
});

export const MAX_STATUS_STACKS = 10;
/** The highest stack count stored (the engine caps each status at its own maximum anyway). */
const STORED_STACKS_CAP = 99;
export const PRESET_NAME_MAX = 80;
export const PRESETS_VERSION = 1;

/** Ids whose rows are keyed by element too: two elements are two rows. */
const MULTI_ELEMENT_IDS = new Set([
  'ext_elemental', 'ext_combining_element', 'external_elemental_vulnerability', 'ext_proc_elementalist', 'ext_proc_status_duration', 'resupply',
]);
/** Ids where every add is a new row; the rows multiply. */
const APPEND_IDS = new Set(['unique_vulnerability', 'sonar', 'external_elemental_vulnerability']);

/**
 * Buff ids this gun-only app does not simulate: melee, exalted, AoE-only, Hall of Mirrors (rewrites fire modes),
 * cast speed and the Balefire Charger's shields. They are kept on a build that carries them, but not offered.
 */
const NOT_FOR_GUNS = Object.freeze({
  gladiator_set: 'a melee set bonus',
  nira_set: 'a melee slam bonus',
  ext_melee_damage: 'melee only',
  ext_follow_through: 'melee only',
  stealth_bonus: 'melee and companion only',
  ext_heavy_attack_efficiency: 'melee only',
  ext_heavy_attack_windup_speed: 'melee only',
  archon_vitality: 'exalted weapons only',
  archon_continuity: 'exalted weapons only',
  tornadoes: 'needs an area-of-effect simulation, which this app does not run',
  collective_curse: 'needs an area-of-effect simulation, which this app does not run',
  breach_surge: 'needs an area-of-effect simulation, which this app does not run',
  hall_of_mirrors: 'duplicates every fire mode; not simulated here',
  ext_cast_speed: 'for weapons that use cast speed; none of the guns here do',
  balefire_shields: 'Balefire Charger only; not simulated here',
});

/**
 * Names for catalogue entries whose site name reads like an internal field ("Arcsphere Elec%", "Cyte Passive"). Rows
 * keep the site's name (presets and share links stay compatible); only the text shown changes.
 */
const DISPLAY_NAMES = Object.freeze({
  arcsphere_elec: 'Arcsphere Electricity',
  ext_serration: 'External Weapon Damage',
  ext_melee_damage: 'External Melee Damage',
  ext_proc_elementalist: 'Elementalist for one element',
  ext_proc_status_duration: 'Status Duration for one element',
  cyte_passive: 'Cyte-09 Passive (weak point crit chance)',
  unique_vulnerability: 'Enemy Vulnerability',
  balefire_shields: 'Balefire Charger Shields',
  ext_add_crit_chance: 'External Crit Chance',
  ext_add_crit_damage: 'External Crit Damage',
  ext_mult_crit_damage: 'External Crit Damage Multiplier',
  corrosive_max_stack: 'Corrosive Max Stacks',
});

/**
 * How a percentage value works. 'multiplier': the value is the multiplier itself (Sonar: 500% is ×5, so 10% is ×0.1).
 * 'bonusMultiplier': it multiplies by 1 + value (50% is ×1.5): multiplicative crit damage, enemy vulnerability,
 * Overdrive, Pageflight. Everything else adds to its stat (docs/port-external-buffs.md 2.2).
 */
const VALUE_KINDS = Object.freeze({
  sonar: 'multiplier',
  ext_mult_crit_damage: 'bonusMultiplier',
  unique_vulnerability: 'bonusMultiplier',
  overdrive: 'bonusMultiplier',
  pageflight: 'bonusMultiplier',
});
/** The value the add form starts with, where one is typical (Sonar at 100% strength: ×5). */
const DEFAULT_VALUES = Object.freeze({ sonar: '500' });

export const buffValueKind = id => VALUE_KINDS[id] ?? 'additive';

/** The name a buff type is shown with. */
export function buffTypeName(entry) {
  return DISPLAY_NAMES[entry?.id] ?? entry?.name ?? '';
}

/**
 * A warning for a value that lowers damage when the user may expect a gain: a multiplier under ×1 (Sonar below 100%)
 * or a negative multiplicative bonus. `percent` is what the user typed (60 for 60%). Null when there is nothing to say.
 */
export function buffValueWarning(id, percent) {
  const v = Number(percent);
  if (!Number.isFinite(v)) return null;
  const kind = buffValueKind(id);
  if (kind === 'multiplier' && v < 100) return `This lowers damage: ${num(v)}% is ×${num(v / 100)}. Sonar at 100% strength is 500% (×5).`;
  if (kind === 'bonusMultiplier' && v < 0) return `This lowers damage: ${num(v)}% is ×${num(1 + v / 100)}.`;
  return null;
}

/** Which elements an elemental buff type accepts (the site filters its element select the same way). */
export function elementsFor(id) {
  if (id === 'ext_elemental') return [...PHYSICAL_TYPES, ...ELEMENTAL_TYPES];
  if (id === 'external_elemental_vulnerability' || id === 'ext_proc_status_duration') return [...STATUS_TYPES];
  if (id === 'ext_proc_elementalist') return ['Slash', 'Heat', 'Electricity', 'Toxin', 'Gas', 'Blast'];
  return [...ELEMENTAL_TYPES];
}

/** "fire" -> "Heat", "electricity" -> "Electricity"; unknown names come back capitalised. */
export function normalizeElement(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = raw.trim();
  const alias = ELEMENT_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  const proper = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return STATUS_TYPES.includes(proper) ? proper : null;
}

// ---------- catalogue ----------

const catalogueCache = new WeakMap();

/** data.conditionals.external_buffs, indexed. */
export function buffCatalogue(data) {
  if (data && catalogueCache.has(data)) return catalogueCache.get(data);
  const list = (data?.conditionals?.external_buffs ?? []).filter(b => b && typeof b.id === 'string');
  const out = { list, byId: new Map(list.map(b => [b.id, b])) };
  if (data) catalogueCache.set(data, out);
  return out;
}

const isExalted = weapon => Boolean(weapon?.is_exalted || weapon?.exalted || weapon?.pseudo_exalted);

/** Whether a catalogue entry applies to this weapon (requires_* fields), as on the site. */
export function catalogueApplies(entry, weapon) {
  if (!entry) return false;
  if (entry.requires_exalted_weapon && !isExalted(weapon)) return false;
  if (Array.isArray(entry.requires_weapon_names) && entry.requires_weapon_names.length) {
    const name = String(weapon?.name ?? '').toLowerCase();
    return entry.requires_weapon_names.some(n => String(n).toLowerCase() === name);
  }
  if (Array.isArray(entry.requires_weapon_classes) && entry.requires_weapon_classes.length) {
    return entry.requires_weapon_classes.includes(weapon?.type);
  }
  return true;
}

/**
 * Whether the simulation models a buff id on this weapon: { level: 'full' | 'none', note }.
 * `none` buffs stay on the build but change nothing.
 */
export function buffSupport(id, weapon, data) {
  const entry = buffCatalogue(data).byId.get(id);
  if (!entry) return { level: 'none', note: 'unknown buff type; ignored.' };
  if (NOT_FOR_GUNS[id]) return { level: 'none', note: `${NOT_FOR_GUNS[id]}.` };
  if (!catalogueApplies(entry, weapon)) return { level: 'none', note: `does not apply to ${weapon?.name ?? 'this weapon'}.` };
  return { level: 'full', note: '' };
}

/** Buff types offered in the add list for a weapon: in data order, without hidden, inapplicable or unsimulated ones. */
export function offeredBuffTypes(data, weapon) {
  return buffCatalogue(data).list.filter(e => !e.hidden && buffSupport(e.id, weapon, data).level === 'full');
}

/**
 * What the add form asks for a buff type: { value: 'percent'|'number'|null, element, heatFaction, min?, max?, step,
 * label?, initial? }. `label` names the value field where the plain "Value" would mislead (multipliers).
 */
export function buffInputs(entry) {
  const t = entry?.input_type;
  const kind = buffValueKind(entry?.id);
  if (t === 'percentage' && kind === 'multiplier') return { value: 'percent', element: false, heatFaction: false, step: 0.1, label: 'Multiplier (500% = ×5)', initial: DEFAULT_VALUES[entry.id] ?? '' };
  if (t === 'percentage' && kind === 'bonusMultiplier') return { value: 'percent', element: false, heatFaction: false, step: 0.1, label: 'Bonus (50% = ×1.5)', initial: '' };
  if (t === 'percentage') return { value: 'percent', element: false, heatFaction: false, step: 0.1 };
  if (t === 'elemental') return { value: 'percent', element: true, heatFaction: false, step: 0.1 };
  if (t === 'elemental_fixed') return { value: null, element: true, heatFaction: false };
  if (t === 'toggle') return { value: null, element: false, heatFaction: false };
  if (t === 'heat_inherit') return { value: null, element: false, heatFaction: true };
  if (entry?.id === 'corrosive_max_stack') return { value: 'number', element: false, heatFaction: false, min: 1, max: 4, step: 1 };
  if (entry?.id === 'arcsphere') return { value: 'number', element: false, heatFaction: false, min: 0, max: 3, step: 1 };
  return { value: 'number', element: false, heatFaction: false, step: 0.01 };
}

// ---------- buff rows ----------

const finite = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/** Legacy ids from older builds and share links. */
function migrateId(raw) {
  const id = raw.id;
  if (id === 'ext_element') return { id: 'ext_combining_element' };
  const m = /^ext_elemental_(heat|cold|electric|toxin)$/.exec(id ?? '');
  if (m) return { id: 'ext_elemental', element: normalizeElement(m[1]) };
  if (id === 'unique_vulnerability' && /sonar/i.test(`${raw.name ?? ''} ${raw.stackKey ?? ''} ${raw.source ?? ''}`)) return { id: 'sonar' };
  return { id };
}

/**
 * One stored buff row, in the site's shape: { id, name, value, element?, factionValue?, sourceBuild? }.
 * Unknown ids are kept (a newer data file may know them) unless `data` is given and lacks them.
 * Returns null for an unusable row.
 */
export function normalizeBuff(raw, data = null) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const migrated = migrateId(raw);
  const entry = data ? buffCatalogue(data).byId.get(migrated.id) : null;
  if (data && !entry) return null;
  const type = entry?.input_type;
  let value = finite(raw.value) ? Number(raw.value) : null;
  if (type === 'toggle' || type === 'elemental_fixed') value = 1;
  if (value == null && type !== 'heat_inherit') return null;
  if (migrated.id === 'corrosive_max_stack') value = Math.min(4, Math.max(1, Math.round(value)));
  if (migrated.id === 'arcsphere') value = Math.min(3, Math.max(0, Math.round(value)));
  const element = normalizeElement(migrated.element ?? raw.element);
  const staleName = !raw.name || raw.name === raw.id || raw.name === 'External Serration';
  const out = { id: migrated.id, name: String(entry && staleName ? entry.name : raw.name ?? migrated.id).slice(0, 120), value: value ?? 0 };
  if (element) out.element = element;
  if (type === 'heat_inherit') {
    out.value = finite(raw.value) ? Number(raw.value) : 2.25;
    out.factionValue = finite(raw.factionValue) ? Number(raw.factionValue) : 0.55;
  }
  if (typeof raw.sourceBuild === 'string' && raw.sourceBuild.trim()) out.sourceBuild = raw.sourceBuild.trim().slice(0, 120);
  return out;
}

export function normalizeBuffList(list, data = null) {
  return (Array.isArray(list) ? list : []).map(b => normalizeBuff(b, data)).filter(Boolean).slice(0, 200);
}

/** The row's identity for replace-on-add: id, plus element for multi-element ids, plus its source. */
export function buffKey(b) {
  const el = MULTI_ELEMENT_IDS.has(b.id) ? `::${b.element ?? ''}` : '';
  return `${b.id}${el}${b.sourceBuild ? `@@${b.sourceBuild}` : ''}`;
}

/**
 * Add a row as the site does: a row with the same key is replaced (not summed); vulnerability-type rows
 * (unique vulnerability, Sonar, elemental vulnerability) always append. Returns a new list.
 */
export function addBuff(list, row) {
  const cur = Array.isArray(list) ? list : [];
  if (!row) return cur;
  if (APPEND_IDS.has(row.id)) return [...cur, row];
  const key = buffKey(row);
  const i = cur.findIndex(b => buffKey(b) === key);
  if (i < 0) return [...cur, row];
  return cur.map((b, j) => (j === i ? row : b));
}

export const removeBuffAt = (list, index) => (Array.isArray(list) ? list.filter((_, i) => i !== index) : []);

/**
 * Merge `incoming` into `list` (a preset's "Add to current buffs"): rows with the same key sum their values,
 * toggles stay on, Overdrive takes the incoming row, and append-type rows are added as new rows.
 */
export function mergeBuffLists(list, incoming, data = null) {
  let out = [...(Array.isArray(list) ? list : [])];
  for (const row of Array.isArray(incoming) ? incoming : []) {
    if (!row) continue;
    if (APPEND_IDS.has(row.id)) { out.push({ ...row }); continue; }
    const key = buffKey(row);
    const i = out.findIndex(b => buffKey(b) === key);
    if (i < 0) { out.push({ ...row }); continue; }
    const type = data ? buffCatalogue(data).byId.get(row.id)?.input_type : null;
    const prev = out[i];
    let next;
    if (row.id === 'overdrive') next = { ...row };
    else if (type === 'toggle' || type === 'elemental_fixed') next = { ...prev, value: Math.max(prev.value, row.value) };
    else if (type === 'heat_inherit') next = { ...prev, value: prev.value + row.value, factionValue: (prev.factionValue ?? 0) + (row.factionValue ?? 0) };
    else next = { ...prev, value: prev.value + row.value };
    out = out.map((b, j) => (j === i ? next : b));
  }
  return out;
}

/**
 * A row from the add form. `input` is what the user typed: { value } in percent for percentage/elemental types
 * (60 means 60%), a raw number for value/numeric types; { element }; { heat, faction } in percent for Heat Inherit.
 * Returns { row } or { error } with the site's wording.
 */
export function buffFromInput(data, id, input = {}) {
  const entry = buffCatalogue(data).byId.get(id);
  if (!entry) return { error: 'Choose a buff type.' };
  const t = buffInputs(entry);
  const row = { id, name: entry.name, value: 1 };
  if (t.heatFaction) {
    if (!finite(input.heat) || !finite(input.faction)) return { error: 'Please enter valid numbers for Heat and Faction values.' };
    row.value = Number(input.heat) / 100;
    row.factionValue = Number(input.faction) / 100;
  } else if (t.value) {
    if (!finite(input.value)) return { error: 'Please enter a valid number for the buff value.' };
    const n = Number(input.value);
    row.value = t.value === 'percent' ? n / 100 : n;
    if (t.min != null || t.max != null) row.value = Math.min(t.max ?? Infinity, Math.max(t.min ?? -Infinity, Math.round(row.value)));
  }
  if (t.element) {
    const element = normalizeElement(input.element);
    if (!element || !elementsFor(id).includes(element)) return { error: 'Choose an element.' };
    row.element = element;
  }
  return { row };
}

// ---------- text ----------

const num = (n, digits = 2) => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r).replace(/^-/, '−');
};
const pct = v => `${num(v * 100)}%`;
const signedPct = v => `${v < 0 ? '' : '+'}${pct(v)}`;

/** The value part of a row's line: "+60%", "60% Electricity", "1.2", "On", "225% Heat / 55% Faction". */
export function buffValueText(row, data) {
  const entry = buffCatalogue(data).byId.get(row.id);
  const t = entry?.input_type ?? 'percentage';
  if (t === 'toggle') return 'On';
  if (t === 'elemental_fixed') return row.element ?? 'No element';
  if (t === 'heat_inherit') return `${pct(row.value)} Heat / ${pct(row.factionValue ?? 0)} Faction`;
  if (t === 'elemental') return `${pct(row.value)} ${row.element ?? ''}`.trim();
  if (t === 'percentage') {
    const kind = buffValueKind(row.id);
    if (kind === 'multiplier') return `×${num(row.value)}`;
    if (kind === 'bonusMultiplier') return `×${num(1 + row.value)}`;
    return signedPct(row.value);
  }
  if (row.id === 'arcsphere') return `${num(row.value, 0)} ${row.value === 1 ? 'proc' : 'procs'}`;
  if (row.id === 'corrosive_max_stack') return `+${num(row.value, 0)} stacks`;
  return num(row.value);
}

/** The name a row is shown with: the catalogue's clearer name while the row carries the catalogue's own name. */
export function buffRowName(row, data) {
  const entry = buffCatalogue(data).byId.get(row.id);
  if (entry && (!row.name || row.name === entry.name)) return buffTypeName(entry);
  return row.name || entry?.name || row.id;
}

/** "External Fire Rate · +60%", "Resupply · 60% Electricity", "Sonar · ×5", "Roar · +50% · from Roar (Helminth)". */
export function buffLine(row, data) {
  const parts = [buffRowName(row, data), buffValueText(row, data)];
  if (row.sourceBuild && row.sourceBuild !== row.name) parts.push(`from ${row.sourceBuild}`);
  return parts.join(' · ');
}

/** "Viral ×10". */
export const statusLine = s => `${s.type} ×${s.stacks}`;

// ---------- external statuses ----------

/** Stored statuses: known types, whole stacks of at least 1, one row per type (a later row replaces). */
export function normalizeStatuses(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const type = normalizeElement(s?.type) ?? (STATUS_TYPES.includes(s?.type) ? s.type : null);
    const stacks = Math.round(Number(s?.stacks));
    if (!type || !Number.isFinite(stacks) || stacks < 1) continue;
    const row = { type, stacks: Math.min(STORED_STACKS_CAP, stacks) };
    const i = out.findIndex(r => r.type === type);
    if (i >= 0) out[i] = row;
    else out.push(row);
  }
  return out;
}

/** Add or replace a status row (one per type). Stacks below 1 or not a number are ignored, as on the site. */
export function addStatus(list, type, stacks) {
  const n = Math.round(Number(stacks));
  if (!STATUS_TYPES.includes(type) || !Number.isFinite(n) || n < 1) return Array.isArray(list) ? list : [];
  return normalizeStatuses([...(Array.isArray(list) ? list : []), { type, stacks: n }]);
}

/** The most stacks the add form offers for a status: 10, or more Corrosive with Corrosive Max Stack Increase. */
export function maxStacksFor(type, buffs) {
  if (type !== 'Corrosive') return MAX_STATUS_STACKS;
  const bonus = Math.max(0, ...(buffs ?? []).filter(b => b.id === 'corrosive_max_stack').map(b => Math.min(4, Math.max(1, Math.round(b.value)))));
  return MAX_STATUS_STACKS + bonus;
}

// ---------- reduction (buff list -> totals) ----------

/** The totals object with the site's defaults; only fields this app's guns use. */
function emptyTotals() {
  return {
    damage: 0, multishot: 0, critChance: 0, critDamage: 0, statusChance: 0, flatStatusChance: 0, flatCritChance: 0,
    nonRadialFlatCritChance: 0, flatCritDamage: 0, fireRate: 0, reload: 0, externalReloadReduction: 0,
    weakPointDamage: 0, weakPointCritChance: 0, factionDamage: 0, eclipseMultiplier: 0, powerThrow: 0,
    externalHeadshotMultiplierBonus: 0, ipsImpact: 0, ipsPuncture: 0, ipsSlash: 0, ammoEfficiency: 0,
    seekingTalonsChance: 0, externalArmorStrip: 0, externalElementalistPercent: 0, externalStatusDurationPercent: 0,
    ballisticBullseye: 0, ballisticBattery: 0, vigilanteSetCritTierChance: 0, externalWeaponDamage: 0,
    pageflightMultiplier: 1, multiplicativeCritChance: 1, multiplicativeCritDamage: 1, sonarMultiplier: 1, sonarActive: false,
    corrosiveMaxStacks: 10,
    procSpecificElementalistPercent: {}, procSpecificStatusDurationPercent: {},
    externalElements: [], nourishElements: [], plunderElements: [], externalCombiningElements: [], resupplyProc: [],
    externalElementalVulnerabilities: [], finalMultipliers: [], ammoEfficiencyMultipliers: [],
    lashProc: null, xatasProc: null, valenceFormationProc: null, arcsphereProc: null, overdriveDamage: null,
    heatInheritPercentOverride: null, heatInheritFactionOverride: null,
    infiniteAmmo: false, covenantActive: false, hydroidEnhancedCorrosive: false,
  };
}

const SUM_FIELDS = {
  weakPointDamage: 'weakPointDamage', externalHeadshotMultiplier: 'externalHeadshotMultiplierBonus', factionDamage: 'factionDamage',
  eclipseDamage: 'eclipseMultiplier', powerThrow: 'powerThrow', ipsImpact: 'ipsImpact', ipsPuncture: 'ipsPuncture', ipsSlash: 'ipsSlash',
  critChance: 'critChance', weakPointCritChance: 'weakPointCritChance', critDamage: 'critDamage', multishot: 'multishot',
  statusChance: 'statusChance', flatStatusChance: 'flatStatusChance', nonRadialFlatCritChance: 'nonRadialFlatCritChance',
  flatCritChance: 'flatCritChance', ballisticBullseye: 'ballisticBullseye', ballisticBattery: 'ballisticBattery',
  flatCritDamage: 'flatCritDamage', fireRate: 'fireRate', seekingTalonsChance: 'seekingTalonsChance',
  elementalist: 'externalElementalistPercent', externalStatusDuration: 'externalStatusDurationPercent',
  externalArmorStrip: 'externalArmorStrip',
};

/**
 * Reduce a buff list into the site's totals, for one weapon. Buffs this app does not simulate are skipped and
 * listed in `notes` ({ name, text }); the rest follow the doc's section 2.
 * @returns {{ totals: object, notes: Array<{name, text}>, active: number }}
 */
export function reduceExternalBuffs(buffs, data, weapon) {
  const totals = emptyTotals();
  const notes = [];
  let active = 0;
  const cat = buffCatalogue(data);
  for (const raw of Array.isArray(buffs) ? buffs : []) {
    const b = normalizeBuff(raw, data);
    if (!b) {
      if (raw?.id) notes.push({ name: String(raw.name ?? raw.id), text: 'unknown buff type; ignored.' });
      continue;
    }
    const support = buffSupport(b.id, weapon, data);
    if (support.level === 'none') {
      notes.push({ name: b.name, text: `not simulated: ${support.note}` });
      continue;
    }
    const entry = cat.byId.get(b.id);
    let counted = false;
    for (const stat of entry.stats ?? []) {
      const value = b.value * (stat.multiplier || 1);
      const element = normalizeElement(b.element ?? stat.element);
      const fixed = stat.value || value;
      counted = true;
      if (SUM_FIELDS[stat.type]) { totals[SUM_FIELDS[stat.type]] += value; continue; }
      switch (stat.type) {
        case 'damage':
          if (b.id === 'ext_serration') totals.externalWeaponDamage += value;
          totals.damage += value;
          break;
        case 'overdriveDamage': totals.overdriveDamage = value; break;
        case 'sonarMultiplier':
          if (Number.isFinite(value) && value > 0) { totals.sonarActive = true; totals.sonarMultiplier *= value; }
          break;
        case 'covenantFlatCrit': totals.covenantActive = true; break;
        case 'reloadTimeReduction': totals.externalReloadReduction += value; totals.reload += value; break;
        case 'multiplicativeCritChance': totals.multiplicativeCritChance *= 1 + value; break;
        case 'multiplicativeCritDamage': totals.multiplicativeCritDamage *= 1 + value; break;
        case 'infiniteAmmo': if (value > 0) totals.infiniteAmmo = true; break;
        case 'ammoEfficiency':
          if (String(stat.stacking ?? '').toLowerCase() === 'multiplicative') totals.ammoEfficiencyMultipliers.push(value);
          else totals.ammoEfficiency += value;
          break;
        case 'lashProc': totals.lashProc = { value }; break;
        case 'xatasProc': totals.xatasProc = { value }; break;
        case 'externalElementalVulnerability':
          if (Number.isFinite(value) && element) totals.externalElementalVulnerabilities.push({ value, element });
          break;
        case 'resupplyProc': if (element) totals.resupplyProc.push({ value, element }); break;
        case 'finalMultiplier': totals.finalMultipliers.push(1 + value); break;
        case 'pageflight': totals.pageflightMultiplier += value; break;
        case 'procSpecificElementalist':
        case 'procSpecificStatusDuration': {
          if (!element) break;
          const key = stat.type === 'procSpecificElementalist' ? 'procSpecificElementalistPercent' : 'procSpecificStatusDurationPercent';
          const total = (totals[key][element] ?? 0) + value;
          if (total === 0) delete totals[key][element];
          else totals[key][element] = total;
          break;
        }
        case 'heatInherit':
          if (Number.isFinite(b.value)) totals.heatInheritPercentOverride = b.value;
          if (Number.isFinite(b.factionValue)) totals.heatInheritFactionOverride = b.factionValue;
          break;
        case 'corrosiveMaxStacks':
          totals.corrosiveMaxStacks = Math.max(totals.corrosiveMaxStacks, 10 + Math.min(4, Math.max(1, Math.round(value))));
          break;
        case 'valenceFormationProc':
          if (b.id === 'arcsphere') {
            const count = Math.min(3, Math.max(0, Math.round(value)));
            if (count > 0) totals.arcsphereProc = { element: 'Electricity', count };
          } else if (element) {
            totals.valenceFormationProc = { element };
          }
          break;
        case 'vigilanteSet':
          if (weapon?.type === 'Primary') totals.vigilanteSetCritTierChance = Math.min(0.3, Math.max(0, totals.vigilanteSetCritTierChance + value));
          break;
        case 'hydroidEnhancedCorrosive': totals.hydroidEnhancedCorrosive = true; break;
        case 'nourishElement': if (element) totals.nourishElements.push({ element, value: fixed }); break;
        case 'plunderElement': if (element) totals.plunderElements.push({ element, value: fixed }); break;
        case 'externalElement':
          if (!element) break;
          // A physical choice is a multiplier on the weapon's own physical damage, like a +X% Slash mod.
          if (PHYSICAL_TYPES.includes(element)) totals[`ips${element}`] += fixed;
          else totals.externalElements.push({ element, value: fixed });
          break;
        case 'externalElementNoDot':
          if (element) totals.externalElements.push({ element, value: fixed, appliesToDot: false });
          break;
        case 'externalCombiningElement':
          if (element) totals.externalCombiningElements.push({ element, value: fixed });
          break;
        default:
          counted = false;
      }
    }
    if (b.id === 'valence_formation' && !b.element) notes.push({ name: b.name, text: 'has no element chosen, so it adds nothing.' });
    if (counted) active++;
  }
  return { totals, notes, active };
}

/**
 * The conditionalStats part for the engine: every non-default total (the site sends the whole object; the engine
 * treats a missing field as its default). Overdrive becomes one more final multiplier. Null when nothing is set.
 */
export function externalConditionalStats(totals) {
  if (!totals) return null;
  const base = emptyTotals();
  const cs = {};
  for (const [k, v] of Object.entries(totals)) {
    if (k === 'overdriveDamage' || k === 'externalWeaponDamage') continue;
    const d = base[k];
    if (Array.isArray(v)) { if (v.length) cs[k] = v.map(x => (typeof x === 'object' ? { ...x } : x)); }
    else if (v && typeof v === 'object') { if (Object.keys(v).length) cs[k] = { ...v }; }
    else if (v !== d && v != null) cs[k] = v;
  }
  if (Number.isFinite(totals.overdriveDamage)) cs.finalMultipliers = [...(cs.finalMultipliers ?? []), 1 + totals.overdriveDamage];
  if (cs.finalMultipliers) cs.finalMultipliers = cs.finalMultipliers.filter(Number.isFinite);
  return Object.keys(cs).length ? cs : null;
}

/** The totals' additive stat buckets, in stats.js collectModifiers() names, to add to the mods' own. */
export function externalModifiers(totals) {
  if (!totals) return {};
  const out = {};
  const put = (k, v) => { if (v) out[k] = v; };
  put('damage', totals.damage);
  put('multishot', totals.multishot);
  put('critChance', totals.critChance);
  put('critDamage', totals.critDamage);
  put('statusChance', totals.statusChance);
  put('fireRate', totals.fireRate);
  put('reload', totals.reload);
  put('factionDamage', totals.factionDamage);
  put('weakPointDamage', totals.weakPointDamage);
  put('weakPointCritChance', totals.weakPointCritChance);
  put('ammoEfficiency', totals.ammoEfficiency);
  if (totals.ipsImpact || totals.ipsPuncture || totals.ipsSlash) {
    out.physical = { Impact: totals.ipsImpact, Puncture: totals.ipsPuncture, Slash: totals.ipsSlash };
  }
  return out;
}

/**
 * Merge two conditionalStats objects (arcanes' and external buffs'): numbers add, arrays concatenate,
 * per-element maps add per key; overguardDamageMultiplier keeps the larger; flags and objects from `b` win.
 */
export function mergeConditionalStats(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (cur == null) out[k] = v;
    else if (Array.isArray(cur) && Array.isArray(v)) out[k] = [...cur, ...v];
    else if (k === 'overguardDamageMultiplier') out[k] = Math.max(cur, v);
    else if (typeof cur === 'number' && typeof v === 'number') {
      out[k] = /^(multiplicative|sonarMultiplier$|pageflightMultiplier$)/.test(k) ? cur * v : cur + v;
    } else if (cur && typeof cur === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
      const m = { ...cur };
      for (const [kk, vv] of Object.entries(v)) m[kk] = typeof m[kk] === 'number' && typeof vv === 'number' ? m[kk] + vv : vv;
      out[k] = m;
    } else out[k] = v;
  }
  return out;
}

/** Armor after External Armor Strip (none on targets immune to armor reduction). */
export function strippedArmor(armor, totals, immune = false) {
  const strip = Math.min(1, Math.max(0, totals?.externalArmorStrip ?? 0));
  return immune || !strip ? armor : armor * (1 - strip);
}

/** Honesty notes for a build's buffs on a weapon (unsimulated rows; Resupply on an Incarnon form). */
export function externalBuffNotes(buffs, data, weapon, modeName = '') {
  const { notes } = reduceExternalBuffs(buffs, data, weapon);
  if (/incarnon/i.test(String(modeName)) && (buffs ?? []).some(b => b?.id === 'resupply')) {
    notes.push({ name: 'Resupply', text: 'has no effect on Incarnon forms.' });
  }
  return notes;
}

// ---------- sources (abilities, Helminth, passives, arcanes, shards, mods) ----------

/** The weapon's native families (LotusRifle, LotusPistol, ...), as the site derives them. */
export function nativeFamilies(weapon, data) {
  const override = data?.external_weapon_buffs?.native_weapon_family_overrides?.[weapon?.name];
  if (Array.isArray(override) && override.length) return override.map(String);
  if (weapon?.type === 'Secondary') return ['LotusPistol'];
  if (weapon?.type === 'Melee') return ['LotusMeleeWeapon'];
  if (weapon?.type === 'Primary') {
    const sub = weapon.subtype;
    if (sub === 'Shotgun') return ['LotusLongGun', 'LotusShotgun'];
    if (['Rifle', 'Bow', 'Sniper', 'Speargun'].includes(sub)) return ['LotusLongGun', 'LotusRifle'];
    return ['LotusLongGun'];
  }
  return [];
}

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

/** Whether a source record reaches this weapon (class, subtype, native family, weapon class, name prefix). */
export function sourceApplies(entry, weapon, data) {
  if (entry.native_weapon_types != null) {
    const fams = new Set(nativeFamilies(weapon, data).map(f => f.toLowerCase()));
    if (!asList(entry.native_weapon_types).some(t => fams.has(t.toLowerCase()))) return false;
  }
  if (entry.weapon_class != null && !asList(entry.weapon_class).includes(String(weapon?.passive_weapon_class ?? 'Other'))) return false;
  if (entry.weapon_name_prefix != null) {
    const name = String(weapon?.name ?? '');
    const hit = asList(entry.weapon_name_prefix).some(p => name.startsWith(p));
    if ((entry.weapon_name_prefix_type ?? 'include') === 'exclude' ? hit : !hit) return false;
  }
  if (entry.class != null) {
    const hit = asList(entry.class).includes(weapon?.type);
    if ((entry.class_type ?? 'include') === 'exclude' ? hit : !hit) return false;
  }
  if (entry.subtype != null) {
    const hit = asList(entry.subtype).includes(weapon?.subtype);
    if ((entry.subtype_type ?? 'include') === 'exclude' ? hit : !hit) return false;
  }
  return true;
}

const SOURCE_GROUPS = Object.freeze({
  ability: 'Warframe abilities', helminth: 'Helminth abilities', passive: 'Warframe passives',
  arcane: 'Warframe arcanes', shard: 'Archon shards', mod: 'Mods and sets',
});
export const SOURCE_GROUP_ORDER = Object.freeze(['ability', 'helminth', 'passive', 'arcane', 'shard', 'mod']);
export const sourceGroupLabel = kind => SOURCE_GROUPS[kind] ?? kind;

/** Coaction Drift at max rank: auras and their kin are 15% stronger, squared as on the site. */
const COACTION_FACTOR = (1 + 0.025 * 6) ** 2;

const sourceCache = new WeakMap();

/** Every source in data.external_weapon_buffs: { key, kind, name, label, entries }. */
export function allSources(data) {
  if (data && sourceCache.has(data)) return sourceCache.get(data);
  const e = data?.external_weapon_buffs ?? {};
  const out = [];
  for (const [name, entries] of Object.entries(e.warframe_abilities ?? {})) out.push({ key: `ability:${name}`, kind: 'ability', name, label: name, entries });
  for (const [name, entries] of Object.entries(e.helminth_abilities ?? {})) out.push({ key: `helminth:${name}`, kind: 'helminth', name, label: `${name} (Helminth)`, entries });
  const passives = new Map();
  for (const p of e.passives ?? []) {
    const name = `${p.warframe} ${p.source_label ?? 'Passive'}`;
    if (!passives.has(name)) passives.set(name, []);
    passives.get(name).push(p);
  }
  for (const [name, entries] of passives) out.push({ key: `passive:${name}`, kind: 'passive', name, label: name, entries });
  for (const a of e.arcanes ?? []) out.push({ key: `arcane:${a.name}`, kind: 'arcane', name: a.name, label: a.name, entries: [a] });
  (e.archon_shards ?? []).forEach((s, i) => {
    // "Violet shard: Gain +30% Primary Electricity Damage" (the effect's first sentence).
    const effect = String(s.effect_matches?.[0] ?? s.buff_id).split(/\.\s/)[0].replace(/\.$/, '');
    const label = `${String(s.type ?? '').replace(/^./, c => c.toUpperCase())} shard: ${effect}`;
    out.push({ key: `shard:${i}`, kind: 'shard', name: label, label, entries: [s] });
  });
  for (const m of e.mods ?? []) out.push({ key: `mod:${m.name}`, kind: 'mod', name: m.name, label: m.name, entries: [m] });
  if (data) sourceCache.set(data, out);
  return out;
}

/**
 * The inputs a source asks for: { strength, duration, shields, gut, augments: string[], augmentRank,
 * tauforged, shardCount, shardTypes, modRank, coaction, setPieces }. Absent keys are not asked.
 */
export function sourceInputs(source) {
  const out = { augments: [] };
  for (const en of source.entries) {
    if (en.scaling_type === 'strength') out.strength = true;
    if (en.scaling_type === 'duration') out.duration = true;
    if (en.scaling_type === 'shields') out.shields = true;
    if (en.scaling_type === 'grendel_gut_enemies') out.gut = true;
    if (en.requires_augment && !out.augments.includes(en.requires_augment)) out.augments.push(en.requires_augment);
    if (Array.isArray(en.scaling_rank_values)) out.augmentRank = Math.max(out.augmentRank ?? 0, en.scaling_rank_values.length - 1);
    if (source.kind === 'shard') {
      out.tauforged = true;
      out.shardCount = true;
      if (Array.isArray(en.per_shard_bonus_types)) out.shardTypes = en.per_shard_bonus_types;
    }
    if (source.kind === 'mod') {
      if (Array.isArray(en.rank_values)) out.modRank = en.rank_values.length - 1;
      if (en.coaction_scaling) out.coaction = true;
      if (Array.isArray(en.mod_names) && en.mod_names.length > 1) out.setPieces = en.mod_names.length;
    }
  }
  return out;
}

/** Default answers for a source's inputs: 100% strength and duration, augments on, max ranks. */
export function defaultSourceOptions(source) {
  const i = sourceInputs(source);
  return {
    strength: 100, duration: 100, shields: 1000, gut: 5,
    augments: Object.fromEntries(i.augments.map(a => [a, true])),
    augmentRank: i.augmentRank ?? 0, tauforged: true, shardCount: 1, shardTypes: 5,
    modRank: i.modRank ?? 0, coaction: false, setPieces: i.setPieces ?? 1,
  };
}

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function sourceValue(source, en, opts, weapon) {
  if (source.kind === 'arcane') return Number(en.weapon_value_overrides?.[weapon?.name] ?? en.value) || 0;
  if (source.kind === 'mod') {
    const ranks = Array.isArray(en.rank_values) ? en.rank_values : null;
    let v = ranks ? Number(ranks[clampInt(opts.modRank, 0, ranks.length - 1, ranks.length - 1)]) : Number(en.value) || 0;
    if (en.coaction_scaling && opts.coaction) v *= COACTION_FACTOR;
    if (Array.isArray(en.mod_names) && en.mod_names.length > 1) v *= clampInt(opts.setPieces, 1, en.mod_names.length, 1);
    return v;
  }
  if (source.kind === 'shard') {
    const tau = opts.tauforged !== false;
    let v = Number(tau ? en.tau_value ?? en.base_value : en.base_value) || 0;
    if (Array.isArray(en.per_shard_bonus_types)) v += Number(tau ? en.per_shard_tau_bonus ?? en.per_shard_base_bonus : en.per_shard_base_bonus) * clampInt(opts.shardTypes, 0, 5, 5);
    return v * clampInt(opts.shardCount, 1, 5, 1);
  }
  let v = Number(en.base_value) || 0;
  if (en.scaling_type) {
    const ranks = Array.isArray(en.scaling_rank_values) ? en.scaling_rank_values : null;
    const mult = ranks ? Number(ranks[clampInt(opts.augmentRank, 0, ranks.length - 1, 0)]) : Number(en.scaling_multiplier) || 0;
    const scale = {
      strength: Number(opts.strength) / 100,
      duration: Number(opts.duration) / 100,
      shields: Number(opts.shields),
      grendel_gut_enemies: clampInt(opts.gut, 0, 5, 5),
    }[en.scaling_type];
    v += (Number.isFinite(scale) ? scale : 0) * mult;
  }
  if (Number.isFinite(Number(en.cap))) v = Math.min(Number(en.cap), v);
  return v;
}

/**
 * The buff rows a source adds to this weapon with these options: one row per buff (summed when the source has
 * several entries for the same buff), `instances` rows for Sonar, nothing for buffs the app does not simulate.
 * Each row carries `sourceBuild` = the source's label, so re-adding a source replaces its rows.
 */
export function sourceRows(source, opts, weapon, data) {
  const cat = buffCatalogue(data);
  const rows = [];
  for (const en of source.entries) {
    if (en.requires_augment && !opts?.augments?.[en.requires_augment]) continue;
    if (!sourceApplies(en, weapon, data)) continue;
    const entry = cat.byId.get(en.buff_id);
    if (!entry || buffSupport(en.buff_id, weapon, data).level !== 'full') continue;
    let value = sourceValue(source, en, opts ?? {}, weapon);
    if (en.buff_id === 'corrosive_max_stack') value = Math.min(4, Math.max(1, Math.round(value)));
    if (en.buff_id === 'arcsphere') value = Math.min(3, Math.max(0, Math.round(value)));
    if (!Number.isFinite(value) || value === 0) continue;
    const row = { id: en.buff_id, name: entry.name, value };
    const element = normalizeElement(en.element);
    if (element) row.element = element;
    if (entry.input_type === 'toggle' || entry.input_type === 'elemental_fixed') row.value = 1;
    row.sourceBuild = source.label;
    const n = Math.max(1, clampInt(en.instances, 1, 10, 1));
    for (let i = 0; i < n; i++) {
      const same = !APPEND_IDS.has(row.id) && rows.find(r => buffKey(r) === buffKey(row));
      if (same) same.value += row.value;
      else rows.push({ ...row });
    }
  }
  return rows;
}

/** Sources that add at least one simulated row to this weapon (with augments on), grouped in the site's order. */
export function sourcesFor(data, weapon) {
  return allSources(data)
    .filter(s => sourceRows(s, defaultSourceOptions(s), weapon, data).length > 0)
    .sort((a, b) => SOURCE_GROUP_ORDER.indexOf(a.kind) - SOURCE_GROUP_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
}

/** Add a source's rows: rows from the same source (and buff) are replaced, others kept. */
export function addSourceRows(list, rows) {
  return (rows ?? []).reduce((acc, r) => addBuff(acc, r), Array.isArray(list) ? list : []);
}

// ---------- presets ----------

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A preset library in the site's shape { version: 1, presets: [{ id, name, buffs }] } (a plain array loads too):
 * unnamed and duplicate names (case-insensitive) dropped, names trimmed to 80 characters, missing or duplicate
 * ids replaced, each list normalised, sorted by name.
 */
export function normalizePresetLibrary(raw, { data = null, newId = () => globalThis.crypto.randomUUID() } = {}) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.presets) ? raw.presets : [];
  const names = new Set();
  const ids = new Set();
  const presets = [];
  for (const p of list) {
    if (!isObj(p)) continue;
    const name = String(p.name ?? '').trim().slice(0, PRESET_NAME_MAX);
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    let id = typeof p.id === 'string' && p.id && p.id !== '__custom__' && !ids.has(p.id) ? p.id.slice(0, 100) : newId();
    ids.add(id);
    presets.push({ id, name, buffs: normalizeBuffList(p.buffs, data) });
  }
  presets.sort((a, b) => a.name.localeCompare(b.name));
  return { version: PRESETS_VERSION, presets };
}

const canonical = list => JSON.stringify((list ?? []).map(b => {
  const { id, value, element, factionValue, sourceBuild } = b;
  return [id, Math.round(value * 1e9) / 1e9, element ?? null, factionValue ?? null, sourceBuild ?? null];
}));

/** The preset whose list equals this one, else null (the select then shows Custom, or None for an empty list). */
export function matchingPreset(library, buffs) {
  const key = canonical(buffs);
  return (library?.presets ?? []).find(p => canonical(p.buffs) === key) ?? null;
}

/** A preset's rows that suit this weapon (applying a preset drops the rest, as on the site). */
export function presetRowsFor(preset, data, weapon) {
  return (preset?.buffs ?? []).filter(b => buffSupport(b.id, weapon, data).level === 'full');
}

/**
 * Save the current list as a preset. Returns { library, preset } or { error } (the site's messages);
 * `replace: true` is needed to overwrite a preset of the same name (case-insensitive), which keeps its id.
 */
export function savePreset(library, name, buffs, { replace = false, newId = () => globalThis.crypto.randomUUID() } = {}) {
  const clean = String(name ?? '').trim().slice(0, PRESET_NAME_MAX);
  if (!buffs?.length) return { error: 'Add at least one buff before saving a preset.' };
  if (!clean) return { error: 'Enter a name for the buff preset.' };
  const presets = library?.presets ?? [];
  const existing = presets.find(p => p.name.toLowerCase() === clean.toLowerCase());
  if (existing && !replace) return { confirm: `Replace the existing buff preset "${existing.name}"?`, existing };
  const preset = { id: existing?.id ?? newId(), name: clean, buffs: buffs.map(b => ({ ...b })) };
  const next = [...presets.filter(p => p !== existing), preset].sort((a, b) => a.name.localeCompare(b.name));
  return { library: { version: PRESETS_VERSION, presets: next }, preset };
}

export function deletePreset(library, id) {
  return { version: PRESETS_VERSION, presets: (library?.presets ?? []).filter(p => p.id !== id) };
}
