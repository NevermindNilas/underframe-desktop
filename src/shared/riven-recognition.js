// Read rivens from the OCR of a screenshot (docs/port-rivens.md 13.4): the stat lines a riven card shows in game
// ("+152.3% Critical Chance", "-41.6% Zoom", "x1.15 Damage to Grineer", "+1.8 Punch Through"), as the riven's stats
// for the build's weapon. One card, or two side by side (a reroll's old and new roll) for the compare. Pure: it takes
// the OCR result (lines with word boxes, in image pixels) and the game data.
//
// What the game shows is the effective value (disposition and rank included). The card shows neither number, so the
// riven is read at disposition 1.2 and rank 8, the site's defaults, and the user corrects them in the riven dialog,
// which keeps the in-game values when they change.
import { normalizeName, nameSimilarity, rivenWeaponFamily } from './build-recognition.js';
import {
  MAX_NEGATIVE, MAX_POSITIVE, RIVEN_DEFAULT_DISPOSITION, RIVEN_MAX_RANK, fromDisplayNumber, rivenFamily, rivenName, rivenStatCatalogue, rivenTypeOf,
  statRange, toStored,
} from './rivens.js';

/** How the game words each riven stat, beyond the stat's own label (rivenStatLabel). */
const IN_GAME = {
  BaseDamage: ['damage', 'base damage'],
  'Fire Rate/Attack Speed': ['fire rate', 'fire rate x2 for bows', 'fire rate x 2 for bows', 'attack speed'],
  'Projectile Speed': ['projectile flight speed', 'projectile speed', 'flight speed'],
  'Magazine Capacity': ['magazine capacity', 'magazine'],
  'Ammo Maximum': ['ammo maximum', 'max ammo'],
  Recoil: ['weapon recoil', 'recoil'],
  ImpactDamage: ['impact'], PunctureDamage: ['puncture'], SlashDamage: ['slash'],
  HeatDamage: ['heat'], ColdDamage: ['cold'], ElectricityDamage: ['electricity', 'electric'], ToxinDamage: ['toxin'],
  ViralDamage: ['viral'], CorrosiveDamage: ['corrosive'], MagneticDamage: ['magnetic'], RadiationDamage: ['radiation'], GasDamage: ['gas'], BlastDamage: ['blast'],
  'Damage vs.Grineer': ['damage to grineer'], 'Damage vs.Corpus': ['damage to corpus'], 'Damage vs.Infested': ['damage to infested'],
  'Damage vs.Orokin': ['damage to corrupted', 'damage to orokin'], 'Damage vs.Techrot': ['damage to techrot'], 'Damage vs.Scaldra': ['damage to scaldra'],
};

/** A number as a card shows one: a sign or "x", digits with "." or ",", then "%", "m" or "s". OCR's look-alikes folded. */
const VALUE_RE = /(^|[^\w.])([+\-−–—]|[x×X](?=\s*\d))?\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*(%|m\b|s\b)?/g;

const vocabCache = new WeakMap();

/** The weapon's riven stats as names to match: [{ key, entry, names: [normalised] }]. */
function statVocabulary(data, weapon) {
  let byWeapon = vocabCache.get(data);
  if (!byWeapon) {
    byWeapon = new Map();
    vocabCache.set(data, byWeapon);
  }
  const type = rivenTypeOf(weapon);
  if (!byWeapon.has(type)) {
    byWeapon.set(type, rivenStatCatalogue(data, weapon).map(entry => ({
      key: entry.key, entry, names: [...new Set([normalizeName(entry.label), ...(IN_GAME[entry.key] ?? []).map(normalizeName)])],
    })));
  }
  return byWeapon.get(type);
}

/** The stat a label names, or null: { key, entry, score }. Short labels must be (nearly) exact. */
export function matchRivenStat(label, vocab) {
  const key = normalizeName(label).replace(/\b(x ?2 for bows|for bows)\b/g, '').trim();
  if (key.replace(/ /g, '').length < 3) return null;
  let best = null;
  for (const v of vocab) {
    for (const n of v.names) {
      // A longer label that starts with the name ("critical chance for heavy attacks") still names it.
      const s = key === n ? 1 : key.startsWith(`${n} `) && n.length >= 5 ? 0.95 : nameSimilarity(key, n);
      if (!best || s > best.score || (s === best.score && n.length > best.len)) best = { key: v.key, entry: v.entry, score: s, len: n.length };
    }
  }
  const need = best && best.len <= 5 ? 0.9 : 0.8;
  return best && best.score >= need ? { key: best.key, entry: best.entry, score: best.score } : null;
}

const boxOf = words => {
  const x = Math.min(...words.map(w => w.x));
  const y = Math.min(...words.map(w => w.y));
  const x1 = Math.max(...words.map(w => w.x + w.w));
  const y1 = Math.max(...words.map(w => w.y + w.h));
  return { x, y, x1, y1, cx: (x + x1) / 2, cy: (y + y1) / 2, w: x1 - x, h: y1 - y };
};

/**
 * Text lines of one pass, each a { text, box, h } with its words' median height. Lines OCR split on one row are kept
 * apart when far apart (two cards side by side), joined when close.
 */
function rows(lines) {
  const out = [];
  for (const l of lines) {
    const ws = (l.words ?? []).filter(w => w && w.w > 0 && w.h > 0).sort((a, b) => a.x - b.x);
    if (!ws.length) continue;
    const hs = ws.map(w => w.h).sort((a, b) => a - b);
    const h = hs[hs.length >> 1];
    let cur = [ws[0]];
    for (const w of ws.slice(1)) {
      const prev = cur[cur.length - 1];
      if (w.x - (prev.x + prev.w) > h * 2.5) { out.push(cur); cur = [w]; } else cur.push(w);
    }
    out.push(cur);
  }
  return out.map(ws => {
    const hs = ws.map(w => w.h).sort((a, b) => a - b);
    return { text: ws.map(w => w.text).join(' '), box: boxOf(ws), h: hs[hs.length >> 1] };
  });
}

/**
 * The stat lines of one card's rows (top to bottom): each { sign, number, unit, label, row } where a label that wraps
 * onto the next row (under it, without a number of its own) is joined.
 */
function statLines(cardRows) {
  const sorted = cardRows.slice().sort((a, b) => a.box.cy - b.box.cy || a.box.x - b.box.x);
  const found = [];
  sorted.forEach((r, i) => {
    // OCR's look-alikes: "xO.88" for x0.88, and the bow note after Fire Rate ("(x2 for Bows)") is not a value.
    const text = r.text.replace(/[|]/g, ' ').replace(/\(?\s*[x×]\s*2\s*for\s*bows\s*\)?/gi, ' ').replace(/(^|[^a-z])([x×X]?\s*)[Oo]([.,]\d)/g, '$1$20$3');
    const hits = [...text.matchAll(VALUE_RE)];
    hits.forEach((m, k) => {
      const start = m.index + m[1].length;
      const end = k + 1 < hits.length ? hits[k + 1].index : text.length;
      let label = text.slice(m.index + m[0].length, end).trim();
      const sign = m[2] ?? '';
      if (!/[a-z]{2}/i.test(label) && !sign && !m[4]) return;
      // A label that wraps: the next row, close under this one, with letters and no number.
      const next = sorted[i + 1];
      if (k === hits.length - 1 && next && next.box.y - r.box.y1 < r.h * 0.9 && !/\d/.test(next.text) && /[a-z]{3}/i.test(next.text)
        && Math.abs(next.box.cx - r.box.cx) < Math.max(r.box.w, next.box.w)) {
        if (!label || !matchStatQuick(label)) label = `${label} ${next.text}`.trim();
      }
      found.push({ sign, number: Number(m[3].replace(',', '.')), unit: m[4] ?? '', label, row: r, at: start });
    });
  });
  return found;
}

/** Whether a label already reads as a whole stat on its own (used to decide whether a wrapped row belongs to it). */
const matchStatQuick = label => /\b(chance|damage|rate|speed|duration|multishot|capacity|maximum|recoil|zoom|through|efficiency|holstered)\b/i.test(label);

/**
 * Signs as the game lays a riven out: positives first, the negative last. With 4 stats the last is the negative; with
 * 3 and no sign read, all three stay positive only when each value fits a 3-positive roll (the site's rule).
 */
function fixSigns(stats, ctx) {
  if (stats.length >= 4) return stats.map((s, i) => ({ ...s, negative: i === stats.length - 1 }));
  if (stats.length === 3 && !stats.some(s => s.negative)) {
    const fits = stats.every(s => {
      const range = statRange(s.entry, { positive: true, positives: 3, negatives: 0, disposition: ctx.disposition, rank: ctx.rank });
      const v = Math.abs(s.effective);
      return range && v >= Math.abs(range.mid) * 0.6 && v <= Math.abs(range.mid) * 1.4;
    });
    if (!fits) return stats.map((s, i) => ({ ...s, negative: i === 2 }));
  }
  if (stats.length === 3 && stats.some(s => s.negative) && !stats[2].negative) return stats.map((s, i) => ({ ...s, negative: i === 2 }));
  return stats;
}

/** The effective value a shown number stands for, by the stat's display (recoil negated, "Damage vs." as ×). */
function effectiveOf(entry, hit, negative) {
  if (String(entry.key).startsWith('Damage vs.')) {
    // "x1.15" is +15%, "x0.85" is -15%; without the x, a percent ("+15%") is read as it is.
    if (/[x×X]/.test(hit.sign) || (!hit.unit && hit.number > 0 && hit.number < 3)) return fromDisplayNumber(entry.key, entry.unit, hit.number);
    return (negative ? -1 : 1) * Math.abs(hit.number) / 100;
  }
  // Recoil shows the other way round: "-35% Weapon Recoil" is the good roll (fromDisplayNumber turns it back).
  const recoil = String(entry.key).toLowerCase().includes('recoil');
  return fromDisplayNumber(entry.key, entry.unit, (negative !== recoil ? -1 : 1) * Math.abs(hit.number));
}

/** A sign as read: '-' (and its look-alikes) negative, '+' positive, none unknown (null). */
const signOf = s => (/[\-−–—]/.test(s) ? true : s === '+' ? false : null);

/**
 * Split rows into cards: two when the stat rows fall into a left and a right group with a clear gap (wider than two
 * text heights), else one; with `two`, an image without a clear gap is split down the middle.
 */
function cards(allRows, width, { two = false } = {}) {
  const statRows = allRows.filter(r => /\d/.test(r.text) && /[a-z]{3}/i.test(r.text));
  if (statRows.length < 2) return [allRows];
  const spans = statRows.map(r => [r.box.x, r.box.x1]).sort((a, b) => a[0] - b[0]);
  let reach = spans[0][1];
  let gap = null;
  for (const [x0, x1] of spans.slice(1)) {
    if (x0 > reach && (!gap || x0 - reach > gap.size)) gap = { at: (reach + x0) / 2, size: x0 - reach };
    reach = Math.max(reach, x1);
  }
  const hs = statRows.map(r => r.h).sort((a, b) => a - b);
  const clear = gap && gap.size > hs[hs.length >> 1] * 2;
  if (!clear && !two) return [allRows];
  const split = clear ? gap.at : width / 2;
  return [allRows.filter(r => r.box.cx < split), allRows.filter(r => r.box.cx >= split)];
}

/**
 * The rivens in an OCR result, for `weapon`: [{ riven, stats: [{ key, label, shown, effective, score }], family,
 * otherFamily, unread: [text] , box }]. `two` reads two cards side by side (the compare). Each riven is a clean slot
 * object at disposition 1.2 and rank 8 with at most 3 positives and 1 negative; a card with fewer than two stats read
 * gives no riven.
 * @param {object} ocr { width, height, lines: [{ text, pass, words: [{ text, x, y, w, h }] }] }
 */
export function recognizeRivens(ocr, data, weapon, { two = false } = {}) {
  const vocab = statVocabulary(data, weapon);
  const family = rivenFamily(weapon?.name);
  const lines = (ocr?.lines ?? []).filter(l => (l.pass ?? 'full') === 'full' && l.words?.length);
  const allRows = rows(lines);
  const disposition = RIVEN_DEFAULT_DISPOSITION;
  const rank = RIVEN_MAX_RANK;
  const weapons = (data?.weapons ?? []).map(w => ({ ...w, key: normalizeName(w.name) }));
  const out = [];
  for (const card of cards(allRows, Number(ocr?.width) || 1920, { two })) {
    const unread = [];
    const stats = [];
    for (const hit of statLines(card)) {
      const m = matchRivenStat(hit.label, vocab);
      if (!m) { if (/[a-z]{3}/i.test(hit.label)) unread.push(`${hit.sign}${hit.number}${hit.unit} ${hit.label}`.trim()); continue; }
      if (stats.some(s => s.key === m.key)) continue;
      // `negative` is the riven's negative (bad) stat: a minus, except on recoil, where a plus is the bad roll.
      const read = signOf(hit.sign);
      const recoil = String(m.key).toLowerCase().includes('recoil');
      const negative = read != null ? read !== recoil : String(m.key).startsWith('Damage vs.') && /[x×X]/.test(hit.sign) ? hit.number < 1 : false;
      stats.push({ key: m.key, entry: m.entry, label: m.entry.label, hit, negative, known: read != null, score: m.score, effective: effectiveOf(m.entry, hit, negative) });
    }
    // Signs OCR read are kept; the layout rule only fills in when one was lost.
    const first = stats.slice(0, MAX_POSITIVE + MAX_NEGATIVE);
    const signed = (first.every(s => s.known) ? first : fixSigns(first, { disposition, rank }))
      .map(s => ({ ...s, effective: effectiveOf(s.entry, s.hit, s.negative) }));
    // A riven never has two negatives: only the last stays one.
    const lastNeg = signed.map(s => s.negative).lastIndexOf(true);
    const final = signed.map((s, i) => (s.negative && i !== lastNeg ? { ...s, negative: false, effective: effectiveOf(s.entry, s.hit, false) } : s));
    const positives = final.filter(s => !s.negative).slice(0, MAX_POSITIVE);
    const negatives = final.filter(s => s.negative).slice(0, MAX_NEGATIVE);
    const kept = [...positives, ...negatives];
    // The card's name ("Braton Critatox") tells which weapon it is for, when OCR read it.
    const named = card.map(r => rivenWeaponFamily(r.text, weapons)).find(Boolean) ?? null;
    const namedFamily = named ? rivenFamily(named.weapon.name) : null;
    if (kept.length < 2) {
      if (kept.length || unread.length) out.push({ riven: null, stats: kept, unread, family, otherFamily: null, box: card.length ? boxOf(card.map(r => ({ x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h }))) : null });
      continue;
    }
    const riven = {
      isRiven: true, id: '', name: rivenName(family), family, disposition, rank,
      stats: kept.map(s => ({ name: s.key, value: toStored(s.effective, { disposition, rank }), unit: s.entry.unit })),
    };
    out.push({
      riven,
      stats: kept.map(s => ({ key: s.key, label: s.label, shown: `${s.hit.sign}${s.hit.number}${s.hit.unit}`, effective: s.effective, score: s.score })),
      unread,
      family,
      otherFamily: namedFamily && namedFamily !== family ? namedFamily : null,
      box: boxOf(card.map(r => ({ x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h }))),
    });
  }
  return out;
}
