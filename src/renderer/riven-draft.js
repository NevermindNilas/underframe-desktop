// The riven dialog's working copy (docs/port-rivens.md 11.5). Pure: no DOM, testable in node.
//
// A draft holds what the player types: the disposition as text, the rank, and stat rows of a sign (positive or
// negative), a stat key and the value as the riven shows it in game ("222.7" for +222.7% Critical Chance, "1.51" for
// ×1.51 Damage vs. Grineer, "-35.6" for a positive Recoil roll). Changing the disposition or rank keeps the typed
// values and recomputes the stored rolls: the typed values are what the game shows.
import {
  MAX_NEGATIVE, MAX_POSITIVE, RIVEN_DEFAULT_DISPOSITION, RIVEN_MAX_RANK, displayNumber, displayUnit, effectiveValue, formatEffective,
  fromDisplayNumber, rivenStatCatalogue, rivenStatLabel, rivenStatUnit, statRange, toStored, validateRiven,
} from '../shared/rivens.js';

let rowSeq = 0;
const rowKey = () => `row-${++rowSeq}`;

/** "222.72", "1.5", "-35.6": a shown number with up to 4 decimals, trailing zeros trimmed. */
const numberText = n => String(Math.round(n * 1e4) / 1e4);

/** A typed number: "1,5", "−35.6", "+120%", "×1.51" all read; anything else is NaN. */
export function parseTyped(text) {
  const t = String(text ?? '').trim().replace(/,/g, '.').replace(/[−–]/g, '-').replace(/^[×x]\s*/i, '').replace(/\s*(%|m|s|×|x)$/i, '').replace(/^\+/, '');
  return t === '' || !/^-?\d*\.?\d+$/.test(t) ? NaN : Number(t);
}

export const emptyRow = (positive = true) => ({ key: rowKey(), positive, stat: '', text: '' });

/** A draft for a riven being edited, or a new one (two empty positive rows, disposition 1.2, rank 8). */
export function draftFrom(riven) {
  if (!riven) {
    return { id: '', disposition: String(RIVEN_DEFAULT_DISPOSITION), rank: RIVEN_MAX_RANK, rows: [emptyRow(), emptyRow()], orig: null };
  }
  const rows = (riven.stats ?? []).map(s => {
    const text = numberText(displayNumber(s.name, s.unit, effectiveValue(s, riven)));
    return { key: rowKey(), positive: Number(s.value) >= 0, stat: s.name, text, orig: { stat: s.name, text, value: Number(s.value) } };
  });
  return { id: riven.id ?? '', disposition: String(riven.disposition), rank: riven.rank, rows, orig: { disposition: String(riven.disposition), rank: riven.rank } };
}

export const countRows = draft => ({
  positives: draft.rows.filter(r => r.positive).length,
  negatives: draft.rows.filter(r => !r.positive).length,
});

/** Whether another positive (at most 3) or negative (at most 1) row may be added. */
export const canAddRow = (draft, positive) => {
  const { positives, negatives } = countRows(draft);
  return positive ? positives < MAX_POSITIVE : negatives < MAX_NEGATIVE;
};

/** The riven a draft describes (rows without a stat are left out); values are stored rolls, NaN when not typed. */
export function rivenFromDraft(draft, family) {
  const disposition = parseTyped(draft.disposition);
  const scale = { disposition, rank: draft.rank };
  const unchanged = draft.orig && draft.orig.disposition === draft.disposition && draft.orig.rank === draft.rank;
  const stats = draft.rows.filter(r => r.stat).map(r => {
    const unit = rivenStatUnit(r.stat);
    if (unchanged && r.orig && r.orig.stat === r.stat && r.orig.text === r.text) return { name: r.stat, value: r.orig.value, unit };
    return { name: r.stat, value: toStored(fromDisplayNumber(r.stat, unit, parseTyped(r.text)), scale), unit };
  });
  return { isRiven: true, id: draft.id, name: `${family} Riven Mod`, family, disposition: Number.isFinite(disposition) ? disposition : draft.disposition, rank: draft.rank, stats };
}

function signMessage(stat, positive) {
  if (String(stat).startsWith('Damage vs.')) return positive ? 'A positive Damage vs. stat is above ×1.' : 'A negative Damage vs. stat is below ×1.';
  if (/recoil/i.test(stat)) return positive ? 'A positive Recoil stat shows as a minus value (less recoil).' : 'A negative Recoil stat shows as a plus value (more recoil).';
  return positive ? 'A positive stat needs a value above 0.' : 'A negative stat needs a value below 0.';
}

/**
 * Everything wrong with a draft, by place: `rows` (row key -> message), `disposition`, `rank`, `messages` (riven-wide,
 * worded as on underframe.site) and `ok`; `riven` is the riven the draft describes (to save when ok). The sign rule
 * (a positive row's value must make the stat positive) comes first: validateRiven() counts stats by sign.
 */
export function draftIssues(draft, { data, weapon, family }) {
  const rows = new Map();
  const set = (key, message) => { if (!rows.has(key)) rows.set(key, message); };
  for (const r of draft.rows) {
    const n = parseTyped(r.text);
    if (!r.stat) { if (String(r.text).trim()) set(r.key, 'Pick a stat.'); continue; }
    if (!Number.isFinite(n)) { set(r.key, `Enter the value the riven shows for ${rivenStatLabel(r.stat)}.`); continue; }
    const effective = fromDisplayNumber(r.stat, rivenStatUnit(r.stat), n);
    if (r.positive ? !(effective > 0) : !(effective < 0)) set(r.key, signMessage(r.stat, r.positive));
  }
  const riven = rivenFromDraft(draft, family);
  const picked = draft.rows.filter(r => r.stat);
  let disposition = null;
  let rank = null;
  const messages = [];
  for (const e of validateRiven(riven, { data, weapon }).errors) {
    if (e.field === 'disposition') disposition = e.message;
    else if (e.field === 'rank') rank = e.message;
    else if (e.field.startsWith('stat-')) {
      const row = picked[Number(e.field.slice(5))];
      if (row) set(row.key, e.message);
    } else if (!messages.includes(e.message)) messages.push(e.message);
  }
  return { rows, disposition, rank, messages, ok: !rows.size && !disposition && !rank && !messages.length, riven };
}

/**
 * The usual in-game range of a row for the draft's stat counts, disposition and rank, as text ("+200.5% to +245.0%"),
 * with whether the typed value lies outside it. Null when there is no range (no stat, or 1 or 4 positive rows).
 */
export function rowRange(draft, row, { data, weapon }) {
  if (!row.stat) return null;
  const entry = rivenStatCatalogue(data, weapon).find(e => e.key === row.stat);
  const disposition = parseTyped(draft.disposition);
  const { positives, negatives } = countRows(draft);
  const range = entry && Number.isFinite(disposition) && disposition > 0
    ? statRange(entry, { positive: row.positive, positives, negatives, disposition, rank: draft.rank })
    : null;
  if (!range) return null;
  const unit = rivenStatUnit(row.stat);
  const ends = [range.min, range.max].sort((a, b) => displayNumber(row.stat, unit, a) - displayNumber(row.stat, unit, b));
  const text = `${formatEffective(row.stat, unit, ends[0])} to ${formatEffective(row.stat, unit, ends[1])}`;
  const n = parseTyped(row.text);
  const v = Number.isFinite(n) ? fromDisplayNumber(row.stat, unit, n) : NaN;
  return { text, outside: Number.isFinite(v) && (v < range.min - 1e-9 || v > range.max + 1e-9), unit: displayUnit(row.stat, unit) };
}
