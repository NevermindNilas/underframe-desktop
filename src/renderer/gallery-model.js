// What the gallery shows (docs/arsenal-spec.md 5): the cards for the Mods, Arcanes and Best mod tabs with their
// state (ok / equipped / blocked and why), gains after a sweep, the search tags, hints and "Did you mean".
// Pure: the React gallery memoises it and renders the result.
import { isModCompatible } from '../shared/mods.js';
import { arcanesFor, arcaneSlotCount, indexArcanes, isArcaneCompatible, arcaneSummary, arcaneSupport, arcaneControls, arcaneMaxRank } from '../shared/arcanes.js';
import { slotDrain } from '../shared/capacity.js';
import { arcaneEntry, buildModIndex, didYouMean, parseQuery, searchEntries, sortResults } from '../shared/mod-search.js';
import { EXILUS_SLOT, arcaneIndexOf, arcaneSlotId, slotBlockReason, slotLabel, sweepKeyOf, sweepView, targetSlotFor } from './model.js';

const indexCache = new WeakMap();

/** Search entries for every mod of a weapon type (PRIMARY / SECONDARY), built once per data load. */
export function modIndexFor(ctx, type) {
  let byType = indexCache.get(ctx);
  if (!byType) indexCache.set(ctx, (byType = new Map()));
  const key = String(type).toUpperCase();
  if (!byType.has(key)) {
    const mods = ctx.data.mods.filter(m => m.Type === key && m['Local Name']);
    byType.set(key, buildModIndex(mods, { exilus: ctx.exilus, popular: ctx.popular }));
  }
  return byType.get(key);
}

/**
 * Arcanes for the gallery: those that fit the weapon's arcane slot `slot` (0, or a kitgun's 1 for Pax / Residual),
 * plus (Fits off) every gun arcane in the data.
 */
export function arcaneListFor(ctx, weapon, { onlyFits = true, slot = 0 } = {}) {
  const fitting = weapon ? arcanesFor(weapon, ctx.data, slot) : [];
  if (onlyFits) return { list: fitting, fits: new Set(fitting.map(a => a.name)) };
  const fits = new Set(fitting.map(a => a.name));
  const gunTypes = new Set(['Primary', 'Secondary', 'Shotgun', 'Bow', 'Pistol', 'Rifle', 'Sniper']);
  const extra = [];
  for (const c of ctx.data.conditionals?.arcanes ?? []) {
    if (!gunTypes.has(c.type) || fits.has(c.name) || !indexArcanes(ctx.data).byName.has(c.name)) continue;
    const support = arcaneSupport(c.name, ctx.data);
    extra.push({
      name: c.name, maxRank: arcaneMaxRank(c.name, ctx.data), summary: arcaneSummary(c.name, ctx.data),
      description: indexArcanes(ctx.data).byName.get(c.name)?.description ?? '', requires: null,
      support: support.level, supportNote: support.note, controls: arcaneControls(c.name, ctx.data),
    });
  }
  return { list: [...fitting, ...extra].sort((a, b) => a.name.localeCompare(b.name)), fits };
}

/**
 * Sweep gains (fractions) for the slot the gallery targets, while the rest of the build is what the search ran
 * against; else null.
 */
export function sweepGains(ctx, build, sweep, slot) {
  if (!sweep || slot == null || sweep.slot !== slot || sweep.status === 'error') return null;
  if (sweep.key !== sweepKeyOf(ctx, build, slot)) return null;
  const { rows } = sweepView(sweep, build.mods[slot]?.name ?? null, Infinity);
  return new Map(rows.filter(r => Number.isFinite(r.gain)).map(r => [r.name, r.gain]));
}

/**
 * The gallery view.
 * @param {object} p { ctx, build, gallery, selectedSlot, sweep, polarities, partial: (name) => string[], engineOnly: (name) => boolean }
 * @returns {{ tab, parsed, items, total, hints, suggestions, unknown, targetSlot, contextText, exilusScoped, gains, sortGainEnabled, emptyText }}
 */
export function galleryView({ ctx, build, gallery, selectedSlot, sweep, polarities, partial, engineOnly }) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  const parsed = parseQuery(gallery.query);
  const equipped = new Map(build.mods.map((m, i) => [m?.name, i]).filter(([n]) => n));
  const tab = gallery.tab === 'best' && !sweep ? 'mods' : gallery.tab;

  if (tab === 'arcanes') {
    // A kitgun's second arcane slot takes Pax / Residual arcanes: the tab lists what the selected arcane slot takes.
    const slotIndex = arcaneIndexOf(selectedSlot) === 1 && weapon && arcaneSlotCount(weapon) > 1 ? 1 : 0;
    const slotId = arcaneSlotId(slotIndex);
    const { list, fits } = arcaneListFor(ctx, weapon, { onlyFits: gallery.fits, slot: slotIndex });
    const current = build.arcanes?.[slotIndex]?.name ?? null;
    const index = list.map(arcaneEntry);
    const st = {
      equipped: new Map(current ? [[current, slotId]] : []),
      fits,
      blocked: new Map(list.filter(a => !fits.has(a.name)).map(a => [a.name, `Doesn't fit ${build.weaponName}`])),
      hideEquipped: gallery.hideEquipped,
    };
    const { results, hints } = searchEntries(index, parsed, st);
    const sorted = sortResults(results, gallery.sort === 'gain' ? 'match' : gallery.sort, { blocked: st.blocked });
    const items = sorted.map(r => {
      const blocked = st.blocked.get(r.name) ?? null;
      return {
        kind: 'arcane', name: r.name, entry: r.entry, arcane: r.entry.arcane,
        state: blocked ? 'blocked' : r.name === current ? 'equipped' : 'ok', reason: blocked, slot: r.name === current ? slotId : null,
        gain: null, place: null,
      };
    });
    return {
      tab, parsed, items, total: list.filter(a => fits.has(a.name)).length, hints,
      suggestions: items.length ? [] : didYouMean(index, parsed, results, st), unknown: parsed.unknown,
      targetSlot: slotId,
      contextText: slotIndex === 1 ? 'Kitgun arcanes (Pax, Residual) go in the second arcane slot. Click a card to equip it.'
        : weapon && arcaneSlotCount(weapon) > 1 ? 'Arcanes go in the first arcane slot; select the second one for Pax and Residual arcanes.'
          : 'Arcanes go in the arcane slot. Click a card to equip it.',
      exilusScoped: false, gains: null, sortGainEnabled: false,
      emptyText: list.length ? null : `No ${slotIndex === 1 ? 'kitgun ' : ''}arcanes fit the ${build.weaponName} in this data version.`,
    };
  }

  const bestTab = tab === 'best';
  const target = bestTab ? sweep.slot : Number.isInteger(selectedSlot) ? selectedSlot : null;
  const fallbackTarget = target ?? targetSlotFor(ctx, build, null, null);
  const exilusScoped = !bestTab && target === EXILUS_SLOT;
  const gains = sweepGains(ctx, build, sweep, bestTab ? sweep.slot : target);
  const index = modIndexFor(ctx, weapon?.type ?? 'PRIMARY');
  const fits = new Set(index.filter(e => isModCompatible(e.mod, weapon)).map(e => e.name));
  const scoped = exilusScoped ? index.filter(e => ctx.exilus.has(e.name)) : index;
  const blocked = new Map();
  for (const e of scoped) {
    if (!fits.has(e.name)) { blocked.set(e.name, `Doesn't fit ${build.weaponName}`); continue; }
    if (equipped.has(e.name)) continue;
    const slot = target ?? fallbackTarget;
    if (slot == null) continue;
    const reason = slotBlockReason(ctx, build, slot, e.name);
    if (reason) blocked.set(e.name, reason);
  }
  const partialSet = new Set(scoped.filter(e => partial(e.name).length).map(e => e.name));
  const engineSet = new Set(scoped.filter(e => engineOnly(e.name)).map(e => e.name));
  // drain<=N and the Drain sort use the number the player sees: the max-rank drain, adjusted for the target
  // slot's polarity (the card's own number on an unpolarised slot, the fit hint's number on a polarised one).
  const drainSlot = target ?? fallbackTarget;
  const drainOfEntry = e => slotDrain(e.mod, e.maxRank, polarities?.[drainSlot]).drain;
  const st = {
    equipped, blocked, fits, partial: partialSet, engineOnly: engineSet, gains,
    effects: gallery.effects, pols: gallery.pols, rarities: gallery.rarities,
    hideEquipped: gallery.hideEquipped, onlyFits: gallery.fits || bestTab, drainOf: drainOfEntry,
  };
  let { results, hints } = searchEntries(scoped, parsed, st);
  if (parsed.filters.gain.length && !gains) hints = [...hints, 'DPS gain filters need a Find best mod run for this slot. Run Find best mod first.'];
  if (bestTab) {
    const tested = new Set((sweep.all ?? []).map(r => r.name));
    results = results.filter(r => tested.has(r.name) || equipped.get(r.name) === sweep.slot);
  }
  const byName = new Map(scoped.map(e => [e.name, e]));
  const drainOf = name => {
    const e = byName.get(name);
    return e ? drainOfEntry(e) : 0;
  };
  const sort = bestTab ? 'gain' : gallery.sort === 'gain' && !gains ? 'match' : gallery.sort;
  const sorted = sortResults(results, sort, { blocked, drainOf, gains });
  const places = bestTab ? new Map(sweepView(sweep, build.mods[sweep.slot]?.name ?? null, Infinity).rows.map(r => [r.name, r.place])) : null;
  const items = sorted.map(r => {
    const slot = equipped.get(r.name);
    const reason = blocked.get(r.name) ?? null;
    return {
      kind: 'mod', name: r.name, entry: r.entry, mod: r.entry.mod,
      state: reason ? 'blocked' : slot != null ? 'equipped' : 'ok', reason, slot: slot ?? null,
      gain: gains?.get(r.name) ?? null, place: places?.get(r.name) ?? null,
    };
  });
  const fitting = scoped.filter(e => fits.has(e.name)).length;
  let contextText;
  if (bestTab) contextText = `Best mod for ${slotLabel(sweep.slot).toLowerCase()}: clicking a card equips it there.`;
  else if (target != null) {
    contextText = target === EXILUS_SLOT ? 'Picking for the Exilus slot. Click a card to equip it.' : `Picking for ${slotLabel(target).toLowerCase()}. Click a card to equip it.`;
  } else contextText = 'No slot selected: cards go into the first empty slot.';
  return {
    tab, parsed, items, total: fitting, hints,
    suggestions: !items.length || items[0]?.entry && results.length && results.every(r => r.fuzzy) ? didYouMean(scoped, parsed, results, st) : [],
    unknown: parsed.unknown,
    targetSlot: target ?? fallbackTarget,
    contextText,
    exilusScoped,
    gains,
    sortGainEnabled: Boolean(gains),
    emptyText: fitting ? null : 'No compatible mods for this slot.',
  };
}

