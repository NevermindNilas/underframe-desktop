// The weapon stats sheet in the Readout (docs/declutter-spec.md 4): every modded stat next to its base (the weapon
// with no mods and no arcanes) and the change, and the "If equipped" preview of a card the Picker is pointing at.
// Pure: no DOM, no React.
import { buildStats } from './sim.js';
import { emptySlots, newArcane, setArcane, isArcaneSlot, arcaneIndexOf } from './model.js';
import { maxRank } from '../shared/mods.js';
import { byDamageTypeOrder } from './palette.js';
import { fmtNum, fmtPct, fmtSeconds, fmtSignedPct } from './format.js';

/**
 * Sheet rows, in order. `token` is the Picker search word a row opens (its data-testid is stat-filter-<token>);
 * `better` says which way is good ('up', 'down', or null when neither is).
 */
export const SHEET_ROWS = [
  { key: 'damage', label: 'Damage', hint: 'per projectile', token: 'dmg', words: 'damage', better: 'up', get: m => m.totalFinalDamage, fmt: v => fmtNum(v, 1) },
  { key: 'critChance', label: 'Crit chance', token: 'cc', words: 'crit chance', better: 'up', get: m => m.finalCritChance, fmt: v => fmtPct(v) },
  { key: 'critMultiplier', label: 'Crit multiplier', token: 'cd', words: 'crit damage', better: 'up', get: m => m.finalCritMultiplier, fmt: v => `${fmtNum(v, 2)}×` },
  { key: 'statusChance', label: 'Status chance', hint: 'per projectile', token: 'sc', words: 'status chance', better: 'up', get: m => m.perProjectileStatusChance, fmt: v => fmtPct(v) },
  { key: 'statusDuration', label: 'Status duration', token: 'sd', words: 'status duration', better: 'up', get: m => m.finalStatusDuration, fmt: v => fmtSeconds(v, 1) },
  { key: 'multishot', label: 'Multishot', token: 'ms', words: 'multishot', better: 'up', get: m => m.finalMultishot, fmt: v => fmtNum(v, 2) },
  { key: 'fireRate', label: 'Fire rate', token: 'fr', words: 'fire rate', better: 'up', get: m => m.finalFireRate, fmt: v => `${fmtNum(v, 2)}/s` },
  { key: 'magazine', label: 'Magazine', token: 'mag', words: 'magazine', better: 'up', reload: true, get: m => m.magazineSize, fmt: v => fmtNum(v, 0) },
  { key: 'reload', label: 'Reload', token: 'reload', words: 'reload speed', better: 'down', reload: true, get: m => m.reloadTime, fmt: v => fmtSeconds(v, 2) },
  { key: 'punchThrough', label: 'Punch through', token: 'pt', words: 'punch through', better: 'up', get: m => m.finalPunchThrough, fmt: v => `${fmtNum(v, 1)} m` },
  { key: 'faction', label: 'Faction', token: 'bane', words: 'faction damage', better: 'up', get: m => m.factionDamage ?? 0, fmt: v => (v ? fmtSignedPct(v, 0) : 'none') },
];

/** Gallery search word per damage type (the legend items in the Readout). */
export const ELEMENT_TOKEN = {
  Impact: 'impact', Puncture: 'puncture', Slash: 'slash', Heat: 'heat', Cold: 'cold', Electricity: 'electricity', Toxin: 'toxin',
  Blast: 'blast', Corrosive: 'corrosive', Gas: 'gas', Magnetic: 'magnetic', Radiation: 'radiation', Viral: 'viral',
};

/** The weapon's own fire mode stats: no mods, no arcanes, same mode and target faction. */
export function baseModeOf(ctx, build) {
  try {
    // The weapon's own stats: no mods, no arcanes, no external buffs.
    return buildStats(ctx, { ...build, arcanes: [], externalBuffs: [] }, emptySlots())?.mode ?? null;
  } catch {
    return null;
  }
}

/**
 * Relative change from base to value: a fraction, or null when there is no base to compare with or nothing changed.
 * A base of 0 (faction damage, punch through) has no relative change; the row shows the value instead.
 */
export function changeOf(base, value) {
  if (!Number.isFinite(base) || !Number.isFinite(value) || Math.abs(value - base) < 1e-9 || base === 0) return null;
  return (value - base) / Math.abs(base);
}

/** "+75%", "−23%", or "×28.8" from 3x up (a big multiplier reads better than "+2,775%"). */
export function fmtChange(change) {
  if (change == null || !Number.isFinite(change)) return '—';
  if (change >= 2) return `×${fmtNum(1 + change, 1)}`;
  return fmtSignedPct(change, 0);
}

/** Whether a change is good, bad or neither, for the row's direction. */
export function verdict(change, better) {
  if (change == null || !better) return 'same';
  return (change > 0) === (better === 'up') ? 'good' : 'bad';
}

/**
 * Sheet rows for a mode against its base mode. `hasReload` false shows "n/a" for magazine and reload.
 * `preview` is the mode with a candidate card equipped (or null).
 * Returns [{ key, label, hint, token, words, base, value, baseText, valueText, change, changeText, verdict, preview, previewText, previewVerdict }].
 */
export function sheetRows(mode, base, { hasReload = true, preview = null } = {}) {
  if (!mode) return [];
  return SHEET_ROWS.map(r => {
    const na = r.reload && !hasReload;
    const value = na ? NaN : r.get(mode);
    const b = base && !na ? r.get(base) : NaN;
    const change = changeOf(b, value);
    const shown = Number.isFinite(b) && Math.abs(value - b) < 1e-9 ? null : change;
    const pv = preview && !na ? r.get(preview) : NaN;
    const previewChanged = Number.isFinite(pv) && Number.isFinite(value) && Math.abs(pv - value) > 1e-9;
    // From a base of 0 (no faction bonus, no punch through) the change is the added amount, not a percentage.
    const fromZero = b === 0 && Number.isFinite(value) && Math.abs(value) > 1e-9;
    return {
      key: r.key, label: r.label, hint: r.hint ?? null, token: r.token, words: r.words,
      base: b, value,
      baseText: na ? 'n/a' : !Number.isFinite(b) ? '—' : r.key === 'faction' ? '—' : r.fmt(b),
      valueText: na ? 'n/a' : r.fmt(value),
      change: shown,
      changeText: fromZero ? `${value > 0 ? '+' : '−'}${r.fmt(Math.abs(value)).replace(/^[+−]/, '')}` : fmtChange(shown),
      verdict: fromZero ? verdict(value, r.better) : verdict(shown, r.better),
      preview: previewChanged ? pv : null,
      previewText: previewChanged ? r.fmt(pv) : null,
      previewVerdict: previewChanged ? verdict(changeOf(value, pv) ?? (pv > value ? 1 : -1), r.better) : 'same',
    };
  });
}

/** Damage per projectile by type, base and modded, in the palette's order. */
export function damageTypeRows(mode, base) {
  if (!mode) return [];
  const types = new Set([...Object.keys(mode.finalDamageTypes ?? {}), ...Object.keys(base?.finalDamageTypes ?? {})]);
  return [...types]
    .map(type => ({ type, token: ELEMENT_TOKEN[type] ?? type.toLowerCase(), base: base?.finalDamageTypes?.[type] ?? 0, value: mode.finalDamageTypes?.[type] ?? 0 }))
    .filter(t => t.value > 0 || t.base > 0)
    .sort((a, b) => byDamageTypeOrder(a.type, b.type));
}

/**
 * The fire mode with a candidate card equipped: `{ kind: 'mod', name, slot }` (at max rank, replacing the slot's
 * mod) or `{ kind: 'arcane', name, slot: arcane slot id }`. Null when it can't be computed.
 */
export function previewMode(ctx, build, preview) {
  if (!ctx || !build || !preview?.name) return null;
  try {
    if (preview.kind === 'arcane') {
      const i = Math.max(0, isArcaneSlot(preview.slot) ? arcaneIndexOf(preview.slot) : 0);
      const next = setArcane(ctx, build, i, newArcane(ctx, preview.name));
      return buildStats(ctx, next)?.mode ?? null;
    }
    if (!Number.isInteger(preview.slot)) return null;
    const mod = ctx.index.byName.get(preview.name);
    if (!mod) return null;
    const slots = build.mods.slice();
    slots[preview.slot] = { name: preview.name, rank: maxRank(mod) };
    return buildStats(ctx, build, slots)?.mode ?? null;
  } catch {
    return null;
  }
}

/** Spoken summary of a preview: the rows that change, biggest first ("crit chance 21% to 39%, fire rate …"). */
export function previewSummary(rows, limit = 3) {
  const changed = rows.filter(r => r.previewText != null);
  if (!changed.length) return 'If equipped: no stat changes on the sheet';
  const size = r => Math.abs(changeOf(r.value, r.preview) ?? 1);
  return `If equipped: ${changed.sort((a, b) => size(b) - size(a)).slice(0, limit).map(r => `${r.label.toLowerCase()} ${r.valueText} to ${r.previewText}`).join(', ')}`;
}

/**
 * "On paper" damage per second of a fire mode: damage per projectile × multishot × fire rate × the average crit
 * factor × the faction bonus. No armor, status or reload: a quick yardstick for comparing mods, not the simulation.
 */
export function paperDps(mode) {
  if (!mode) return NaN;
  const cc = Math.max(0, mode.finalCritChance ?? 0);
  const cm = Math.max(1, mode.finalCritMultiplier ?? 1);
  return (mode.totalFinalDamage ?? 0) * (mode.finalMultishot ?? 1) * (mode.finalFireRate ?? 1) * (1 + cc * (cm - 1)) * (1 + (mode.factionDamage ?? 0));
}

/**
 * The filled general slot (0-7) whose mod adds the least paper DPS: the build without it keeps the most. The Picker
 * targets it when it opens on a full build with no slot chosen (docs/declutter-spec.md 1.1). Null when no general
 * slot holds a mod.
 */
export function weakestSlot(ctx, build) {
  let best = null;
  for (let i = 0; i < 8; i++) {
    if (!build?.mods?.[i]) continue;
    const slots = build.mods.slice();
    slots[i] = null;
    let v;
    try {
      v = paperDps(buildStats(ctx, build, slots)?.mode);
    } catch {
      v = NaN;
    }
    if (Number.isFinite(v) && (!best || v > best.v + 1e-9)) best = { slot: i, v };
  }
  return best?.slot ?? null;
}
