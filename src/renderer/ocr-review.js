// Screenshot import review (docs/arsenal-spec.md 7.4): turn recognizeBuild() output into reviewable items with
// confidence bands, find conflicts inside the import, and work out what applying keeps. Pure: no DOM.
import { conflictingMod, isModCompatible, maxRank } from '../shared/mods.js';
import { arcaneMaxRank, isArcaneCompatible } from '../shared/arcanes.js';
import { capacityOf, capacityUse, innateSlotPolarities, normalizePolarity, slotDrain } from '../shared/capacity.js';
import { EXILUS_SLOT, GENERAL_SLOTS, SLOT_COUNT, slotLabel } from './model.js';

export const BAND_HIGH = 0.85;
export const BAND_CHECK = 0.6;

/** 'high' (>= 0.85), 'check' (0.60-0.85) or 'low'. */
export function bandOf(confidence) {
  const c = Number(confidence) || 0;
  return c >= BAND_HIGH ? 'high' : c >= BAND_CHECK ? 'check' : 'low';
}

export const BAND_LABEL = { high: 'High', check: 'Check', low: 'Low' };

/** What the review says for a slot nothing was taken from, by recognizeBuild()'s slot state. */
export const STATE_NOTE = {
  riven: 'Riven: not supported',
  unknown: 'Not recognised',
  hidden: 'Not recognised: covered in the screenshot',
  unread: 'Not read from the screenshot',
  empty: 'Empty',
};

/**
 * Review state from a recognition. Items, in list order: arcane, Exilus, slots 1-8.
 * Each: { key, kind: 'mod'|'arcane', slot, name, raw, confidence, band, rank, rankSource, box, keep, suggestion,
 *   state, kindNote, attention }.
 * Low-confidence items start unkept, with their reading offered as the suggestion. `state` is 'found', 'empty'
 * (nothing there), or why nothing was taken: 'unknown' (text that matched nothing), 'hidden' (covered by a
 * tooltip), 'unread' (not found at all), 'riven'. `attention` marks the ones the player should fill in by hand.
 */
export function reviewFromRecognition(ctx, rec) {
  const weapon = rec?.weapon ?? null;
  const weaponName = weapon?.name ?? null;
  const items = [];
  const mk = (key, kind, slot, r, fallbackState = 'empty') => {
    const name = r?.name ?? null;
    const band = name ? bandOf(r.confidence) : 'low';
    const keep = Boolean(name) && band !== 'low';
    const state = name ? 'found' : r?.kind ?? fallbackState;
    return {
      key, kind, slot, name: keep ? name : null, suggestion: name, raw: r?.raw ?? null, confidence: Number(r?.confidence) || 0, band,
      rank: Number.isFinite(r?.rank) ? r.rank : null, rankSource: r?.rankSource ?? (kind === 'arcane' ? 'assumed' : null),
      box: r?.box ?? null, keep, state, kindNote: name ? null : STATE_NOTE[state] ?? null,
      attention: !name && ['unknown', 'hidden', 'unread'].includes(state),
    };
  };
  // An arcane socket with unreadable text (or on a translated client) is 'unknown'; nothing found at all is 'unread'.
  const arcane = rec?.arcanes?.[0] ?? (rec?.arcaneState === 'unknown' ? { kind: 'unknown', raw: rec.arcaneRaw ?? null } : null);
  items.push(mk('arcane', 'arcane', 'arcane', arcane, rec?.arcaneState === 'unread' ? 'unread' : 'empty'));
  if (items[0].state === 'unknown' && !items[0].suggestion) items[0].kindNote = 'Name not readable';
  items.push(mk('exilus', 'mod', EXILUS_SLOT, rec?.exilus ?? null, ['hidden', 'unread'].includes(rec?.exilusState) ? rec.exilusState : 'empty'));
  for (const i of GENERAL_SLOTS) items.push(mk(`slot-${i}`, 'mod', i, rec?.slots?.[i] ?? null));
  return {
    weaponName,
    recognisedWeapon: weaponName,
    weaponConfidence: Number(weapon?.confidence) || 0,
    weaponRaw: weapon?.raw ?? null,
    weaponBox: weapon?.box ?? null,
    items,
    unmatched: rec?.unmatchedRegions ?? (rec?.unmatched ?? []).map(raw => ({ raw, box: null })),
    warnings: rec?.warnings ?? [],
  };
}

export const isSupportedWeaponName = (ctx, name) => Boolean(name && ctx.weaponByName.has(name));

/**
 * The weapon to assume when the screenshot's weapon wasn't recognised: the open build's weapon, when every kept mod
 * and the arcane fit it. Returns a review patch ({ weaponName, weaponFromCurrent: true }) or {}.
 */
export function fallbackWeapon(ctx, review, currentName) {
  const weapon = ctx.weaponByName.get(currentName);
  if (!weapon) return {};
  const kept = review.items.filter(i => i.keep && i.name);
  if (!kept.some(i => i.kind === 'mod')) return {};
  const fits = kept.every(i => {
    if (i.kind === 'arcane') return isArcaneCompatible(i.name, weapon, ctx.data, 0);
    const mod = ctx.index.byName.get(i.name);
    return Boolean(mod) && isModCompatible(mod, weapon);
  });
  return fits ? { weaponName: weapon.name, weaponFromCurrent: true } : {};
}

/**
 * Slot polarities for an imported build. Screenshots don't show which slots were given Forma, but the build fit its
 * capacity in the game. So: the weapon's innate polarities; then, while the mods are over capacity, the slot whose
 * mod saves the most drain from a matching polarity gets its mod's polarity (as a player's Forma would).
 * Returns { slotPolarities: (code|null)[9] (null = innate), assumed: slots given a polarity, over: capacity still over }.
 */
export function inferSlotPolarities(ctx, weaponName, mods, { catalyst = true } = {}) {
  const weapon = ctx.weaponByName.get(weaponName);
  const overrides = Array(SLOT_COUNT).fill(null);
  if (!weapon) return { slotPolarities: overrides, assumed: 0, over: 0 };
  const innate = innateSlotPolarities(ctx.data, weapon);
  const byName = n => ctx.index.byName.get(n);
  const effective = () => innate.map((p, i) => (overrides[i] == null ? p : normalizePolarity(overrides[i])));
  const overBy = () => {
    const forma = overrides.filter((o, i) => o != null && normalizePolarity(o) !== innate[i]).length;
    const capacity = capacityOf({ catalyst, progenitor: Boolean(weapon.is_progenitor), forma });
    return capacityUse(mods, effective(), byName).used - capacity;
  };
  let assumed = 0;
  while (overBy() > 0) {
    let best = null;
    mods.forEach((m, i) => {
      if (!m || overrides[i] != null) return;
      const mod = byName(m.name);
      const own = normalizePolarity(mod?.Polarity);
      if (!own) return;
      const saving = slotDrain(mod, m.rank, effective()[i]).drain - slotDrain(mod, m.rank, own).drain;
      if (saving > 0 && (!best || saving > best.saving)) best = { i, own, saving };
    });
    if (!best) break;
    overrides[best.i] = best.own;
    assumed++;
  }
  return { slotPolarities: overrides, assumed, over: Math.max(0, overBy()) };
}

/**
 * Why each kept item would not be applied: it doesn't fit the chosen weapon, isn't an Exilus mod, or conflicts
 * with an earlier kept item (the later one loses). Map<key, reason>.
 */
export function itemProblems(ctx, review) {
  const out = new Map();
  const weapon = ctx.weaponByName.get(review.weaponName);
  const taken = [];
  // Earlier means list order after the arcane: Exilus first, then slots 1-8 (the order the user reads them).
  for (const it of review.items) {
    if (!it.keep || !it.name) continue;
    if (it.kind === 'arcane') {
      if (weapon && !isArcaneCompatible(it.name, weapon, ctx.data, 0)) out.set(it.key, `Doesn't fit ${weapon.name}`);
      continue;
    }
    const mod = ctx.index.byName.get(it.name);
    if (!mod) { out.set(it.key, 'Unknown mod'); continue; }
    if (weapon && !isModCompatible(mod, weapon)) { out.set(it.key, `Doesn't fit ${weapon.name}`); continue; }
    if (it.slot === EXILUS_SLOT && !ctx.exilus.has(it.name)) { out.set(it.key, 'Not an Exilus mod'); continue; }
    const c = conflictingMod(it.name, taken.map(t => t.name), ctx.index);
    if (c) {
      const other = taken.find(t => t.name === c);
      out.set(it.key, `Conflicts with ${other ? slotLabel(other.slot).replace(/^Slot/, 'slot') : c}`);
      continue;
    }
    taken.push(it);
  }
  return out;
}

/**
 * Does "Apply to current build" leave the open build's own mod (or arcane) in this item's slot? Yes unless the import
 * puts a mod there, the screenshot shows the slot empty, or the user cleared it: a slot nothing reliable was read
 * from (covered, unread, unrecognised, a riven, a low-confidence or unapplicable reading) says nothing about it.
 */
export function keepsCurrent(item, problems = new Map()) {
  if (!item || item.cleared || item.state === 'empty') return false;
  return !(item.keep && item.name && !problems.has(item.key));
}

/**
 * "Apply to current build": the imported parts over the open build (`current`, after any weapon change). Slots
 * where keepsCurrent() keep the build's mod, unless it duplicates or conflicts with an imported one (then it's
 * dropped); likewise the arcane. Returns { mods: [9], arcane: {name, rank}|null, keptSlots, keptArcane, dropped }.
 */
export function mergeWithCurrent(ctx, review, parts, current) {
  const problems = parts.problems ?? itemProblems(ctx, review);
  const mods = parts.mods.slice();
  const taken = mods.filter(Boolean).map(m => m.name);
  const keptSlots = [];
  const dropped = [];
  for (const it of review.items) {
    if (it.kind !== 'mod' || mods[it.slot] || !keepsCurrent(it, problems)) continue;
    const own = current?.mods?.[it.slot];
    if (!own) continue;
    if (conflictingMod(own.name, taken, ctx.index)) { dropped.push(own.name); continue; }
    mods[it.slot] = own;
    taken.push(own.name);
    keptSlots.push(it.slot);
  }
  const arcaneItem = review.items.find(i => i.kind === 'arcane');
  const ownArcane = current?.arcanes?.[0] ?? null;
  const keptArcane = !parts.arcane && Boolean(ownArcane) && keepsCurrent(arcaneItem, problems);
  return { mods, arcane: keptArcane ? { name: ownArcane.name, rank: ownArcane.rank } : parts.arcane, keptSlots, keptArcane, dropped };
}

/** "the mod in slot 1 and the Exilus mod", for what applying keeps. */
export function slotListText(slots) {
  const words = slots.map(s => (s === EXILUS_SLOT ? 'Exilus' : String(s + 1)));
  const general = words.filter(w => w !== 'Exilus');
  const parts = [];
  if (general.length) parts.push(`${general.length === 1 ? 'slot' : 'slots'} ${listText(general)}`);
  if (words.includes('Exilus')) parts.push('the Exilus slot');
  return listText(parts);
}

const listText = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Why picking `name` for `item` in the review would clash with another kept item: { key, reason } ("Already in
 * slot 2", "Conflicts with Amalgam Serration (slot 4)"), or null.
 */
export function pickConflict(ctx, review, item, name) {
  if (item.kind !== 'mod') return null;
  const problems = itemProblems(ctx, review);
  for (const other of review.items) {
    if (other.key === item.key || other.kind !== 'mod' || !other.keep || !other.name || problems.has(other.key)) continue;
    const where = other.slot === EXILUS_SLOT ? 'the Exilus slot' : slotLabel(other.slot).replace(/^Slot/, 'slot');
    if (other.name === name) return { key: other.key, name: other.name, reason: `Already in ${where}` };
    if (conflictingMod(name, [other.name], ctx.index)) return { key: other.key, name: other.name, reason: `Conflicts with ${other.name} (${where})` };
  }
  return null;
}

/** What applying keeps: { weaponName, mods: [9], arcane: {name, rank}|null, count } (count = mods + arcane). */
export function appliedParts(ctx, review) {
  const problems = itemProblems(ctx, review);
  const mods = Array(SLOT_COUNT).fill(null);
  let arcane = null;
  for (const it of review.items) {
    if (!it.keep || !it.name || problems.has(it.key)) continue;
    if (it.kind === 'arcane') {
      const max = arcaneMaxRank(it.name, ctx.data);
      arcane = { name: it.name, rank: Math.min(max, Math.max(0, it.rank ?? max)) };
    } else {
      const max = maxRank(ctx.index.byName.get(it.name));
      mods[it.slot] = { name: it.name, rank: Math.min(max, Math.max(0, it.rank ?? max)) };
    }
  }
  return { weaponName: review.weaponName, mods, arcane, count: mods.filter(Boolean).length + (arcane ? 1 : 0), problems };
}

/** The final announcement: "Found Braton Prime and 9 mods, 2 need checking". */
export function reviewSummary(review) {
  const found = review.items.filter(i => i.suggestion);
  const mods = found.filter(i => i.kind === 'mod').length;
  const check = found.filter(i => i.band !== 'high').length + (review.weaponName && bandOf(review.weaponConfidence) !== 'high' ? 1 : 0);
  const weapon = review.weaponName ?? 'no weapon';
  return `Found ${weapon} and ${mods} ${mods === 1 ? 'mod' : 'mods'}${check ? `, ${check} ${check === 1 ? 'needs' : 'need'} checking` : ''}`;
}
