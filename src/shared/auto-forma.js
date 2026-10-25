// Auto Forma: the slot polarities that fit a build's mods with the fewest Forma, and where each extra Forma frees
// the most capacity. Pure. underframe.site's Auto Polarize (calculatePolarityOptimizationPlan, script.js L12004) read
// as data: it re-polarises slots to their mods' polarities, avoids Umbra Forma unless nothing fits without, and counts
// a Progenitor weapon's capacity per Forma. This search is exact instead: each slot has a few useful polarities (as it
// is, the weapon's own, its mod's, none), and moving a mod to a slot that already matches costs no Forma, so mods may
// move between the general slots too. Mods whose slot matters (they add an element, whose order sets the combined
// elements) stay where they are. Slots are combined by dynamic programming over (mods placed, Forma spent, Forma on
// the weapon), keeping the lowest drain, then the fewest changes, for each.
import { capacityOf, normalizePolarity, slotDrain } from './capacity.js';
import { maxRank } from './mods.js';
import { rivenCapacityMod } from './rivens.js';
import { collectModifiers } from './stats.js';
import { isAugmentMod } from './auto-build.js';

/** The polarity Forma gives the slot of an Omni mod (a riven without a polarity): Madurai, as on the site. */
export const OMNI_FORMA_POLARITY = 'AP_ATTACK';
/** The general slots mods may move between (the Exilus slot, 8, takes only Exilus mods). */
const GENERAL = 8;

/**
 * Whether a mod must stay in its slot when others move: it adds an element (the slot order sets the combined
 * elements), or it is the weapon's own augment (some add an element only under their condition).
 * @param {Map<string, object>} byName the mod index
 */
export function pinnedSlot(byName, slot) {
  if (!slot) return false;
  if (collectModifiers([slot], byName, null).elements.length) return true;
  return !slot.isRiven && isAugmentMod(byName.get(slot.name));
}

/** The polarity a mod wants its slot to have, or null when no polarity lowers its drain (a mod without one). */
function wantedPolarity(mod, current) {
  const own = normalizePolarity(mod?.Polarity);
  if (own !== 'AP_ANY') return own;
  return current && current !== 'AP_UMBRA' ? current : OMNI_FORMA_POLARITY;
}

/**
 * @param {object} o
 * @param {Array<{name, rank, isRiven?}|null>} o.mods the build's 9 mod slots
 * @param {(string|null)[]} o.innate the weapon's own slot polarities (9)
 * @param {(string|null)[]} o.effective the slot polarities as they are now, after Forma (9)
 * @param {(name: string) => object} o.modByName
 * @param {boolean} [o.catalyst]
 * @param {boolean} [o.progenitor] Kuva, Tenet and Coda weapons: +2 capacity per Forma (up to 5), doubled by the Catalyst
 * @param {boolean} [o.fromScratch] count every Forma from the weapon's own polarities (else the ones already applied are spent)
 * @param {boolean} [o.maxRanks] plan for every mod at its max rank (rivens keep theirs)
 * @param {boolean} [o.moveMods] let mods move between the general slots
 * @param {(slot: object, i: number) => boolean} [o.pinned] mods that must stay in their slot (they add an element)
 * @returns {{
 *   mods: Array<object|null>, raised: number, umbra: boolean,
 *   current: { used: number, capacity: number, forma: number },
 *   options: Array<{ spent: number, forma: number, used: number, capacity: number, spare: number,
 *     mods: Array<object|null>, polarities: (string|null)[],
 *     changes: Array<{ slot: number, from: string|null, to: string|null }>,
 *     moves: Array<{ name: string, from: number, to: number }> }>,
 *   best: { used: number, capacity: number } | null,
 * }}
 *   `options` runs from the fewest Forma that fit up, one per Forma count that frees more capacity than the one
 *   before; `spent` is the Forma it takes (from scratch: in all), `forma` the Forma on the weapon after it, `mods` the
 *   slots after the moves. `umbra` is true when only Umbra Forma make it fit. When nothing fits, `options` is empty and
 *   `best` is the lowest drain any plan gives.
 */
export function planForma(o) {
  const plain = search(o, false);
  if (plain.options.length) return plain;
  const umbra = search(o, true);
  return umbra.options.length ? { ...umbra, umbra: true } : plain;
}

function search({
  mods, innate, effective, modByName, catalyst = true, progenitor = false, fromScratch = false, maxRanks = false, moveMods = true,
  pinned = () => false,
}, allowUmbra) {
  let raised = 0;
  const slots = (mods ?? []).map(s => {
    if (!s || s.isRiven || !maxRanks) return s ?? null;
    const top = maxRank(modByName(s.name));
    if (!(top > (Number(s.rank) || 0))) return s;
    raised++;
    return { ...s, rank: top };
  });
  const modOf = s => (s ? (s.isRiven ? rivenCapacityMod(s) : modByName(s.name)) : null);
  const drainOf = (s, p) => {
    const mod = modOf(s);
    return mod ? slotDrain(mod, s.rank, p).drain : 0;
  };
  const capOf = forma => capacityOf({ catalyst, progenitor, forma });
  const n = innate.length;
  const formaNow = effective.reduce((k, p, i) => k + (p !== innate[i] ? 1 : 0), 0);
  const current = {
    used: slots.reduce((k, s, i) => k + drainOf(s, effective[i]), 0),
    capacity: capOf(formaNow),
    forma: formaNow,
  };

  // The movable mods and the general slots they may take (their own, the empty ones, the other movable mods').
  const free = [];
  const movable = [];
  for (let i = 0; i < Math.min(GENERAL, n); i++) {
    if (!moveMods || (slots[i] && pinned(slots[i], i))) continue;
    free.push(i);
    if (slots[i]) movable.push(i);
  }
  const isFree = new Set(free);
  const full = (1 << movable.length) - 1;

  // The polarities worth trying in slot i for what sits in it. An Umbra polarity is new only when allowed.
  const polaritiesFor = (i, s) => {
    const out = new Set([effective[i], innate[i]]);
    const mod = modOf(s);
    if (mod) {
      const want = wantedPolarity(mod, effective[i]);
      if (want !== 'AP_UMBRA' || allowUmbra) out.add(want);
      out.add(null);
    } else if (progenitor) {
      // A Progenitor weapon's capacity grows with each Forma, wherever it goes.
      out.add(innate[i] === 'AP_ATTACK' ? 'AP_TACTIC' : 'AP_ATTACK');
    }
    return out;
  };

  // State: mods placed (a mask over `movable`), Forma spent, Forma on the weapon -> lowest drain, then fewest changes.
  let states = new Map([[0, { mask: 0, spent: 0, forma: 0, drain: 0, changed: 0, pol: [], at: [] }]]);
  for (let i = 0; i < n; i++) {
    const next = new Map();
    const put = st => {
      const key = (st.mask * 16 + st.spent) * 16 + st.forma;
      const old = next.get(key);
      if (!old || st.drain < old.drain || (st.drain === old.drain && st.changed < old.changed)) next.set(key, st);
    };
    for (const st of states.values()) {
      // What may sit in slot i: its own mod when it can't move, else any movable mod not yet placed, or nothing.
      const contents = [];
      if (!isFree.has(i)) contents.push({ from: i, bit: 0 });
      else {
        contents.push({ from: null, bit: 0 });
        movable.forEach((from, b) => { if (!(st.mask & (1 << b))) contents.push({ from, bit: 1 << b }); });
      }
      for (const c of contents) {
        const s = c.from == null ? null : slots[c.from];
        for (const p of polaritiesFor(i, s)) {
          put({
            mask: st.mask | c.bit,
            spent: st.spent + (p !== (fromScratch ? innate[i] : effective[i]) ? 1 : 0),
            forma: st.forma + (p !== innate[i] ? 1 : 0),
            drain: st.drain + drainOf(s, p),
            changed: st.changed + (p !== effective[i] ? 1 : 0) + (c.from != null && c.from !== i ? 1 : 0),
            pol: [...st.pol, p],
            at: [...st.at, c.from],
          });
        }
      }
    }
    states = next;
  }

  // The best plan for each Forma count: most spare capacity, then the fewest changes.
  const bySpent = new Map();
  let best = null;
  for (const st of states.values()) {
    if (st.mask !== full) continue;
    const capacity = capOf(st.forma);
    const plan = { ...st, capacity, spare: capacity - st.drain };
    const old = bySpent.get(st.spent);
    if (!old || plan.spare > old.spare || (plan.spare === old.spare && plan.changed < old.changed)) bySpent.set(st.spent, plan);
    if (!best || plan.spare > best.spare) best = plan;
  }
  const options = [];
  for (const spent of [...bySpent.keys()].sort((a, b) => a - b)) {
    const p = bySpent.get(spent);
    if (p.spare < 0 || (options.length && p.spare <= options.at(-1).spare)) continue;
    options.push({
      spent,
      forma: p.forma,
      used: p.drain,
      capacity: p.capacity,
      spare: p.spare,
      mods: p.at.map(from => (from == null ? null : slots[from])),
      polarities: p.pol,
      changes: p.pol.map((to, slot) => ({ slot, from: effective[slot] ?? null, to: to ?? null })).filter(c => c.from !== c.to),
      moves: p.at.map((from, to) => ({ from, to })).filter(m => m.from != null && m.from !== m.to)
        .map(m => ({ name: slots[m.from].isRiven ? `${slots[m.from].family} Riven` : slots[m.from].name, from: m.from, to: m.to })),
    });
  }
  return {
    mods: slots,
    raised,
    umbra: false,
    current,
    options,
    best: options.length ? null : best && { used: best.drain, capacity: best.capacity },
  };
}
