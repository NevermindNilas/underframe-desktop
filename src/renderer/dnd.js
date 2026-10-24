// Drag and drop between the gallery and the slots (docs/arsenal-spec.md 6): what a slot would do with the dragged
// mod or arcane, with the projected drain for the green/red polarity feedback. Pure: no DOM.
import { maxRank } from '../shared/mods.js';
import { slotDrain } from '../shared/capacity.js';
import { isArcaneCompatible } from '../shared/arcanes.js';
import { RIVEN_CAPACITY_MOD } from '../shared/rivens.js';
import { arcaneIndexOf, fitsSlot, isArcaneSlot, slotBlockReason, slotLabel } from './model.js';

export const MOD_MIME = 'application/x-uf-mod';
export const ARCANE_MIME = 'application/x-uf-arcane';

/**
 * What dropping `drag` ({ kind, name, from }) on `slot` would do.
 * @returns {{ accept: boolean, reason: string|null, drain: number|null, effect: 'match'|'mismatch'|'neutral'|null, label: string }}
 */
export function dropInfo(ctx, build, drag, slot, polarities) {
  if (!drag) return { accept: false, reason: null, drain: null, effect: null, label: '' };
  if (drag.kind === 'arcane') {
    if (!isArcaneSlot(slot)) return { accept: false, reason: 'Arcanes go in the arcane slot', drain: null, effect: null, label: '' };
    const i = arcaneIndexOf(slot);
    const weapon = ctx.weaponByName.get(build.weaponName);
    const ok = isArcaneCompatible(drag.name, weapon, ctx.data, i);
    const current = build.arcanes?.[i]?.name;
    const reason = ok ? null : i === 1 ? 'Only Pax and Residual arcanes go here' : `Doesn't fit ${build.weaponName}`;
    return {
      accept: ok, reason, drain: null, effect: null,
      label: ok ? (current && current !== drag.name ? `Drop to replace ${current}` : 'Drop to equip') : '',
    };
  }
  if (isArcaneSlot(slot)) return { accept: false, reason: "Mods don't go in the arcane slot", drain: null, effect: null, label: '' };
  // A riven moved between slots drains as its pseudo-mod (it is not in data.mods).
  const mod = ctx.index.byName.get(drag.name) ?? (Number.isInteger(drag.from) && build.mods[drag.from]?.isRiven ? RIVEN_CAPACITY_MOD : null);
  if (!mod) return { accept: false, reason: 'Unknown mod', drain: null, effect: null, label: '' };
  const from = Number.isInteger(drag.from) ? drag.from : null;
  if (from === slot) return { accept: false, reason: null, drain: null, effect: null, label: '' };
  const target = build.mods[slot];
  let reason = null;
  if (from != null) {
    if (!fitsSlot(ctx, drag.name, slot)) reason = build.mods[from]?.isRiven ? "Rivens can't go in the Exilus slot" : 'Not an Exilus mod';
    else if (target && !fitsSlot(ctx, target.name, from)) reason = `${target.name} can't move to ${slotLabel(from).toLowerCase()}`;
  } else {
    reason = slotBlockReason(ctx, build, slot, drag.name);
  }
  const rank = from != null ? build.mods[from]?.rank ?? maxRank(mod) : maxRank(mod);
  const { drain, effect } = slotDrain(mod, rank, polarities?.[slot]);
  if (reason) return { accept: false, reason, drain: null, effect: null, label: '' };
  const label = target && from != null ? `Drop to swap with ${target.name}` : target ? `Drop to replace ${target.name} (drain ${drain})` : `Drop to equip (drain ${drain})`;
  return { accept: true, reason: null, drain, effect, label };
}

/** The mods after the drop, for the capacity preview (null when the drop would be refused). */
export function previewSlots(ctx, build, drag, slot) {
  if (!drag || drag.kind !== 'mod' || !Number.isInteger(slot)) return null;
  const mods = build.mods.slice();
  const from = Number.isInteger(drag.from) ? drag.from : null;
  if (from != null) {
    const moving = mods[from];
    mods[from] = mods[slot];
    mods[slot] = moving;
  } else {
    const mod = ctx.index.byName.get(drag.name);
    mods[slot] = { name: drag.name, rank: maxRank(mod) };
  }
  return mods;
}
