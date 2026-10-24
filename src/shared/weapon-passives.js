// A weapon's own passives and options, as underframe.site applies them: the passives in data.conditionals.passives
// (stat bonuses, scope tiers, a few that the engine models by name), the exalted weapons' ability strength, and the
// effects some passives add to the fight (Dual Coda Torxica's Cold and vulnerability, Reconifex's resupply).
//
// A build stores `passives`: { [name]: n }, n being the stacks, the scope tier or the chosen option (0 is off). A
// passive the build does not mention takes the site's default: off, except Cantare's and Enkaus's.
import { emptyExternalTotals } from './external-buffs.js';
import { applyConditionalBuff } from './conditional-mods.js';

/** Exalted weapons whose strength scales an extra status proc (Regulators: +150% at 100% strength). */
const EXALTED_PROC = Object.freeze({
  Regulators: { coefficient: 1.5, type: 'add' },
  Neutralizer: { coefficient: 1.25, type: 'add' },
  Lizzie: { coefficient: 1.25, type: 'add' },
  Glory: { coefficient: 1, type: 'multiply' },
  'Artemis Bow': { coefficient: 1, type: 'multiply' },
  Noctua: { coefficient: 1, type: 'multiply' },
  'Balefire Charger': { coefficient: 1, type: 'multiply' },
  'Dex Pixia': { coefficient: 1, type: 'multiply' },
});
export const DEFAULT_EXALTED_STRENGTH = 100;

/** Passives the engine models by name, with the conditionalStats flag each sets. */
const ENGINE_FLAGS = Object.freeze({
  Cedo: 'cedoPassive',
  'Cedo Prime': 'cedoPassive',
  'Cernos Prime': 'cernosPrimeHeadshot',
  'Enkaus Passive': 'enkausPassive',
  'Gotva Passive': 'gotvaPassive',
  'Sagek Prime Passive': 'sagekPrimePassive',
  'Cantare Passive': 'cantarePassive',
});
/** On by default (the site's choice for these two; every other passive starts off). */
const DEFAULT_ON = new Set(['Cantare Passive', 'Enkaus Passive']);

/** The weapon's passives, in data order. */
export function weaponPassives(data, weapon) {
  return (data?.conditionals?.passives ?? []).filter(p => p && (p.type === weapon?.name || p.name === weapon?.name));
}

/**
 * How a passive is set: a toggle, stacks, a scope tier (slider) or a choice (select).
 * @returns {{ kind: 'toggle'|'stacks'|'tier'|'select', max: number, options?: Array<{ value, label }>, label: string, text: string }}
 */
export function passiveControl(entry) {
  const input = (entry.inputs ?? [])[0];
  const label = entry.display_name ? `${entry.display_name}` : entry.name;
  const text = entry.effect ?? entry.description ?? '';
  if (input?.type === 'select') return { kind: 'select', max: Math.max(...input.options.map(o => Number(o.value))), options: input.options.map(o => ({ value: Number(o.value), label: o.label })), label, text };
  if (input?.type === 'slider') return { kind: 'tier', max: Number(input.max) || 1, label, text };
  const stacks = Number(entry.details?.max_stacks) || 1;
  return stacks > 1 ? { kind: 'stacks', max: stacks, label, text } : { kind: 'toggle', max: 1, label, text };
}

/** A passive's value on a build: its own, else the default (off, or on at 1 for Cantare's and Enkaus's). */
export function passiveValue(build, entry) {
  const own = Number(build?.passives?.[entry.name]);
  if (Number.isFinite(own)) return Math.min(passiveControl(entry).max, Math.max(0, Math.round(own)));
  const signature = String(entry.kind ?? '').toLowerCase() === 'signature';
  return !signature && (entry.default_active === true || DEFAULT_ON.has(entry.name)) ? 1 : 0;
}

/** The exalted weapons' strength-scaled proc, or null for other weapons. */
export const exaltedConfig = weapon => (weapon?.is_exalted || weapon?.is_pseudo_exalted ? EXALTED_PROC[weapon.name] ?? null : null);

/**
 * Everything the weapon's passives and options add, for one build.
 * - `totals`: external-buffs.js totals (stat bonuses, the engine's flags, the exalted proc), to merge like conditional
 *   mods;
 * - `statuses`: statuses the passives put on the target (Dual Coda Torxica: Cold x10);
 * - `buffs`: external buff rows they add (Dual Coda Torxica's vulnerability, Reconifex's resupply);
 * - `enemyHpScale`: Enkaus's passive fights the target at 65% health.
 * `accurateAmmo`: Cantare's passive needs magazines simulated.
 */
export function resolveWeaponPassives(data, weapon, build, { accurateAmmo = true } = {}) {
  const totals = emptyExternalTotals();
  const statuses = [];
  const buffs = [];
  let enemyHpScale = 1;
  let any = false;
  for (const entry of weaponPassives(data, weapon)) {
    const n = passiveValue(build, entry);
    if (!n) continue;
    const flag = ENGINE_FLAGS[entry.name];
    if (flag && !(flag === 'cantarePassive' && !accurateAmmo)) { totals[flag] = true; any = true; }
    if (entry.name === 'Enkaus Passive') enemyHpScale = 0.65;
    if (entry.name === 'Komorex Scope' && n >= 2) { totals.komorexZoomBonus = true; any = true; }
    if (entry.name === 'Dual Coda Torxica Passive') {
      statuses.push({ type: 'Cold', stacks: 10 });
      buffs.push({ id: 'unique_vulnerability', name: 'Unique Enemy Vulnerability Multiplier', value: 0.5 });
    }
    if (entry.name === 'Reconifex') buffs.push({ id: 'resupply', name: 'Resupply', value: 0.25, element: 'Heat' });
    // Tiered passives (scopes, AX-52's firing mode) give the tier's bonuses; the rest their bonuses at n stacks.
    const tiered = entry.tier_buffs ? entry.tier_buffs[String(n)] ?? [] : null;
    const list = tiered ?? (entry.details?.bonuses
      ? entry.details.bonuses.map(b => ({ ...b, bonus_type: b.type, max_stacks: entry.details.max_stacks || 1 }))
      : entry.details ? [entry.details] : entry.buffs ?? []);
    for (const b of list) {
      const max = Number(b.max_stacks) || 1;
      any = applyConditionalBuff(totals, entry.name, b, tiered ? 1 : max > 1 ? Math.min(max, n) : 1, 0, weapon) || any;
    }
  }
  const exalted = exaltedConfig(weapon);
  if (exalted) {
    const strength = Number(build?.exaltedStrength);
    const s = (Number.isFinite(strength) && strength > 0 ? strength : DEFAULT_EXALTED_STRENGTH) / 100;
    totals.exaltedProc = { value: s * exalted.coefficient, type: exalted.type };
    any = true;
  }
  return { totals: any ? totals : null, statuses, buffs, enemyHpScale };
}
