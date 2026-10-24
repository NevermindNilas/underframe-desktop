// Gallery smart search (docs/arsenal-spec.md 5.2). Pure: a query parser, a mod/arcane matcher with fuzzy words,
// synonyms and operators, "Did you mean" suggestions and the sort orders. The gallery passes in what the
// matcher cannot know (equipped, blocked, partially simulated, sweep gains) as plain maps and sets.

import { DAMAGE_TYPE_BY_DT, PHYSICAL } from './damage.js';
import { baneFamilyOfStat } from './factions.js';
import { maxRank, modEffectCategories } from './mods.js';
import { modRarityFrame } from './card-assets.js';
import { normalizePolarity, slotDrain } from './capacity.js';
import { SYNONYM_PHRASES, SYNONYM_WORDS, synonymFor } from './search-synonyms.js';

// ---------- small helpers ----------

/** Optimal-string-alignment edit distance (a transposition counts as one edit). */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

const fold = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const wordsOf = s => fold(s).split(/[^a-z0-9/%]+/).filter(Boolean);
const allowedEdits = len => (len >= 8 ? 2 : len >= 4 ? 1 : 0);
/** A lookup in one of our vocabulary tables that ignores inherited keys ("constructor", "__proto__"). */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/**
 * How well a typed word matches a word of the text: 1 for equal or a prefix, 0.5 for a near miss
 * (edit distance 1 for words of 4+ letters, 2 for 8+, never more than `maxEdits`; also a near-miss prefix), else 0.
 */
export function wordQuality(term, word, maxEdits = 2, { nearPrefix = true } = {}) {
  if (!term || !word) return 0;
  if (word === term || word.startsWith(term)) return 1;
  const k = Math.min(maxEdits, allowedEdits(term.length));
  if (!k) return 0;
  if (Math.abs(word.length - term.length) <= k && editDistance(term, word) <= k) return 0.5;
  if (!nearPrefix) return 0;
  // A near-miss prefix ("serat" for "serration"): one edit against a prefix of about the same length.
  for (let len = term.length - 1; len <= term.length + 1; len++) {
    if (len >= 3 && len < word.length && editDistance(term, word.slice(0, len)) <= 1) return 0.5;
  }
  return 0;
}

// ---------- query parsing ----------

const OPERATOR_KEYS = ['drain', 'rank', 'gain', 'pol', 'polarity', 'rarity', 'r', 'is', 'has'];
const NUMERIC_KEYS = new Set(['drain', 'rank', 'gain']);

/** Polarity spellings for pol: (Madurai v, Vazarin d, Naramon - / dash, ...). 'none' is AP_UNIVERSAL. */
export const POLARITY_WORDS = Object.freeze({
  v: 'AP_ATTACK', madurai: 'AP_ATTACK', attack: 'AP_ATTACK',
  d: 'AP_DEFENSE', vazarin: 'AP_DEFENSE', defense: 'AP_DEFENSE',
  '-': 'AP_TACTIC', dash: 'AP_TACTIC', naramon: 'AP_TACTIC', tactic: 'AP_TACTIC',
  '=': 'AP_POWER', zenurik: 'AP_POWER', power: 'AP_POWER',
  r: 'AP_WARD', unairu: 'AP_WARD', ward: 'AP_WARD',
  y: 'AP_PRECEPT', penjaga: 'AP_PRECEPT', precept: 'AP_PRECEPT',
  umbra: 'AP_UMBRA', omni: 'AP_ANY', any: 'AP_ANY',
  none: 'AP_UNIVERSAL', universal: 'AP_UNIVERSAL',
});

export const POLARITY_LABELS = Object.freeze({
  AP_ATTACK: 'Madurai', AP_DEFENSE: 'Vazarin', AP_TACTIC: 'Naramon', AP_POWER: 'Zenurik', AP_WARD: 'Unairu',
  AP_PRECEPT: 'Penjaga', AP_UMBRA: 'Umbra', AP_ANY: 'Omni', AP_UNIVERSAL: 'None',
});

export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'legendary']);
const RARITY_WORDS = { common: 'common', uncommon: 'uncommon', rare: 'rare', legendary: 'legendary', primed: 'legendary', bronze: 'common', silver: 'uncommon', gold: 'rare' };

export const IS_VALUES = Object.freeze(['equipped', 'fits', 'exilus', 'blocked', 'partial', 'engine-only', 'primed', 'galvanized', 'amalgam', 'augment']);
const IS_ALIASES = { engineonly: 'engine-only', engine: 'engine-only', galv: 'galvanized', aug: 'augment', blocked: 'blocked', conflict: 'blocked' };
const IS_LABELS = {
  equipped: 'Equipped', fits: 'Fits the weapon', exilus: 'Exilus mods', blocked: 'Unavailable', partial: 'Partially simulated',
  'engine-only': 'Engine-only', primed: 'Primed', galvanized: 'Galvanized', amalgam: 'Amalgam', augment: 'Augments',
};

const OP_TEXT = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', ':': '=', '=': '=' };
const OP_RE = /^([a-z][a-z-]*)(<=|>=|<|>|:|=)(.*)$/i;

/** Raw tokens with their offsets; a quoted phrase is one token (an unclosed quote runs to the end). */
function tokenize(text) {
  const out = [];
  const re = /"([^"]*)("|$)|\S+/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out.push({ raw: m[0], start: m.index, end: m.index + m[0].length, quoted: m[1] !== undefined });
  }
  return out;
}

/** Merge runs of plain words that spell a multi-word synonym ("crit chance", "punch through"). */
function mergePhrases(tokens, text) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    let merged = null;
    for (let n = 3; n >= 2 && !merged; n--) {
      const run = tokens.slice(i, i + n);
      if (run.length < n || run.some(t => t.quoted || /[<>:=]/.test(t.raw) || t.raw.startsWith('-'))) continue;
      const phrase = fold(run.map(t => t.raw).join(' '));
      if (SYNONYM_PHRASES.includes(phrase)) merged = { raw: text.slice(run[0].start, run[n - 1].end), start: run[0].start, end: run[n - 1].end, phrase, count: n };
    }
    if (merged) {
      out.push({ raw: merged.raw, start: merged.start, end: merged.end, quoted: false, synonymPhrase: merged.phrase });
      i += merged.count - 1;
    } else out.push(tokens[i]);
  }
  return out;
}

function closest(word, vocab, maxEdits = 2) {
  let best = null;
  for (const v of vocab) {
    if (v === word) continue;
    const d = editDistance(word, v);
    if (d <= maxEdits && (!best || d < best.d || (d === best.d && v.length < best.v.length))) best = { v, d };
  }
  return best?.v ?? null;
}

/**
 * Parse a gallery query.
 * @returns {{
 *   terms: string[], phrases: string[], negations: string[],
 *   filters: { drain: {op,value}[], rank: {op,value}[], gain: {op,value}[], pol: string[], rarity: string[], is: string[], has: object[] },
 *   unknown: { raw, key, value, suggestion, message }[],
 *   tokens: { kind, raw, start, end, label?, trailing: boolean }[],
 *   synonyms: object[],   // synonyms used by terms (for hints)
 * }}
 */
export function parseQuery(text) {
  const src = String(text ?? '');
  const out = {
    terms: [], phrases: [], negations: [],
    filters: { drain: [], rank: [], gain: [], pol: [], rarity: [], is: [], has: [] },
    unknown: [], tokens: [], synonyms: [],
  };
  for (const t of mergePhrases(tokenize(src), src)) {
    const trailing = t.end < src.length;
    const tok = { raw: t.raw, start: t.start, end: t.end, trailing };
    if (t.quoted) {
      const phrase = fold(t.raw.replace(/^"|"$/g, '')).trim();
      if (phrase) {
        out.phrases.push(phrase);
        out.tokens.push({ ...tok, kind: 'phrase', label: `"${phrase}"` });
      }
      continue;
    }
    if (t.synonymPhrase) {
      out.terms.push(t.synonymPhrase);
      out.tokens.push({ ...tok, kind: 'term' });
      continue;
    }
    const raw = t.raw;
    const op = raw.match(OP_RE);
    if (op && !/^\d/.test(raw)) {
      const key = op[1].toLowerCase();
      const sign = op[2];
      const value = op[3].trim();
      const filter = parseFilter(key, sign, value);
      if (filter.ok) {
        filter.apply(out.filters);
        out.tokens.push({ ...tok, kind: 'filter', label: filter.label, key: filter.key });
      } else {
        const suggestion = OPERATOR_KEYS.includes(key) ? null : closest(key, OPERATOR_KEYS.filter(k => k.length > 1), 2);
        out.unknown.push({ raw, key, value, suggestion, message: filter.message ?? null });
        out.tokens.push({ ...tok, kind: 'unknown' });
      }
      continue;
    }
    if (raw.length > 1 && raw.startsWith('-') && !/^-\d/.test(raw)) {
      const word = fold(raw.slice(1));
      if (word) {
        out.negations.push(word);
        out.tokens.push({ ...tok, kind: 'neg', label: `Not: ${word}` });
      }
      continue;
    }
    for (const w of wordsOf(raw)) out.terms.push(w);
    out.tokens.push({ ...tok, kind: 'term' });
  }
  for (const term of out.terms) {
    const s = synonymFor(term);
    if (s && !out.synonyms.includes(s)) out.synonyms.push(s);
  }
  return out;
}

function parseFilter(key, sign, value) {
  const v = fold(value);
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(v.replace(/%$/, ''));
    if (!v || !Number.isFinite(n)) return { ok: false, message: `${key} needs a number, like ${key}<=6` };
    const opName = sign === '=' ? ':' : sign;
    const label = key === 'gain' ? `DPS gain ${OP_TEXT[opName]} ${n}%` : `${key === 'drain' ? 'Drain at max rank' : 'Max rank'} ${OP_TEXT[opName]} ${n}`;
    return { ok: true, key, label, apply: f => f[key].push({ op: opName, value: n }) };
  }
  if (!OPERATOR_KEYS.includes(key)) return { ok: false };
  if (sign !== ':' && sign !== '=') return { ok: false, message: `Use ${key}:value` };
  if (key === 'pol' || key === 'polarity') {
    const code = own(POLARITY_WORDS, v);
    if (!code) return { ok: false, message: `Unknown polarity "${value}"` };
    return { ok: true, key: 'pol', label: `Polarity: ${POLARITY_LABELS[code]}`, apply: f => { if (!f.pol.includes(code)) f.pol.push(code); } };
  }
  if (key === 'rarity' || key === 'r') {
    const r = own(RARITY_WORDS, v);
    if (!r) return { ok: false, message: `Unknown rarity "${value}"` };
    return { ok: true, key: 'rarity', label: `Rarity: ${r[0].toUpperCase()}${r.slice(1)}`, apply: f => { if (!f.rarity.includes(r)) f.rarity.push(r); } };
  }
  if (key === 'is') {
    const k = own(IS_ALIASES, v) ?? v;
    if (!IS_VALUES.includes(k)) return { ok: false, message: `Unknown is: value "${value}"` };
    return { ok: true, key: 'is', label: own(IS_LABELS, k), apply: f => { if (!f.is.includes(k)) f.is.push(k); } };
  }
  if (key === 'has') {
    const s = synonymFor(v);
    if (!s) return { ok: false, message: `Unknown stat "${value}"` };
    return { ok: true, key: 'has', label: `Has ${s.key}`, apply: f => { if (!f.has.includes(s)) f.has.push(s); } };
  }
  return { ok: false };
}

/** The query with one token removed (dismissing its tag), spaces tidied. */
export function removeToken(text, token) {
  const src = String(text ?? '');
  return `${src.slice(0, token.start)}${src.slice(token.end)}`.replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
}

/** Replace a word of the query (a "Did you mean" link). Matches whole words, case-insensitive. */
export function replaceWord(text, word, replacement) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text ?? '').replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu'), (m, pre) => `${pre}${replacement}`);
}

// ---------- the mod index ----------

const ELEMENT_ADDED = new Set(['WEAPON_PERCENT_BASE_DAMAGE_ADDED', 'WEAPON_PERCENT_BASE_DAMAGE_ADDED_POST_COALESCE']);
const GENERIC_COMPAT = new Set(['PRIMARY', 'SECONDARY', 'Rifle', 'Rifle (No Aoe)', 'Sniper', 'Bow', 'Shotgun', 'Pistol', 'Pistol (No Aoe)', 'Thrown', 'Tome', 'Unique', '']);
const STAT_WORDS = {
  WEAPON_DAMAGE_AMOUNT: 'damage', WEAPON_FIRE_ITERATIONS: 'multishot', WEAPON_CRIT_CHANCE: 'critical chance', WEAPON_CRIT_DAMAGE: 'critical damage',
  WEAPON_PROC_CHANCE: 'status chance', WEAPON_PROC_TIME: 'status duration', WEAPON_PROC_DAMAGE: 'status damage', WEAPON_FIRE_RATE: 'fire rate',
  WEAPON_CLIP_MAX: 'magazine capacity', WEAPON_RELOAD_SPEED: 'reload speed', WEAPON_PUNCTURE_DEPTH: 'punch through',
  WEAPON_DAMAGE_WEAKPOINT: 'weak point damage', WEAPON_CRIT_CHANCE_WEAKPOINT: 'weak point critical chance', WEAPON_RECOIL: 'recoil',
  WEAPON_RANGE: 'range', WEAPON_EXPLOSION_RADIUS: 'blast radius', WEAPON_PROJECTILE_SPEED: 'projectile speed', WEAPON_HEADSHOT_MULTIPLIER: 'headshot damage',
  GAMEPLAY_FACTION_DAMAGE: 'faction damage',
};
const RARITY_OF_FRAME = { Bronze: 'common', Silver: 'uncommon', Gold: 'rare', Legendary: 'legendary', Riven: 'legendary' };
export const RARITY_ORDER = { legendary: 0, rare: 1, uncommon: 2, common: 3 };

/** A searchable entry per mod (build once per data load). */
export function modEntry(mod, { exilus = new Set(), popular = new Set() } = {}) {
  const name = mod['Local Name'];
  const stats = new Set();
  const elements = new Set();
  const factions = new Set();
  const keywords = new Set();
  let elementStats = 0;
  for (const s of mod.Stats ?? []) {
    stats.add(s.UpgradeType);
    for (const w of wordsOf(own(STAT_WORDS, s.UpgradeType) ?? '')) keywords.add(w);
    if (ELEMENT_ADDED.has(s.UpgradeType)) {
      const el = DAMAGE_TYPE_BY_DT[s.DamageType];
      if (el) {
        elements.add(el);
        keywords.add(fold(el));
        if (!PHYSICAL.includes(el)) elementStats++;
      }
    }
    if (s.UpgradeType === 'GAMEPLAY_FACTION_DAMAGE') {
      const fam = baneFamilyOfStat(s);
      if (fam) factions.add(fam);
      keywords.add('bane');
    }
  }
  const categories = modEffectCategories(mod);
  for (const c of categories) for (const w of wordsOf(c)) keywords.add(w);
  const lower = fold(name);
  const desc = fold(String(mod.Description ?? '').replace(/\s*\r?\n\s*/g, ' '));
  const flags = new Set();
  if (/^primed /.test(lower)) flags.add('primed');
  if (/^galvanized /.test(lower)) flags.add('galvanized');
  if (/^amalgam /.test(lower)) flags.add('amalgam');
  if (exilus.has(name)) flags.add('exilus');
  if (!GENERIC_COMPAT.has(mod['Compat Name'] ?? '')) flags.add('augment');
  if (elementStats >= 2 || (elementStats >= 1 && stats.has('WEAPON_PROC_CHANCE'))) flags.add('dual');
  if (/ammo/.test(lower) || /ammo/.test(desc)) flags.add('ammo');
  if (/zoom/.test(desc)) flags.add('zoom');
  if (/accuracy/.test(desc)) flags.add('accuracy');
  const frame = modRarityFrame(mod);
  return {
    kind: 'mod',
    name,
    lower,
    nameWords: wordsOf(name),
    mod,
    stats,
    elements,
    factions,
    keywords: [...keywords],
    categories,
    desc,
    pol: normalizePolarity(mod.Polarity),
    rarity: RARITY_OF_FRAME[frame] ?? 'common',
    baseDrain: Number(mod['Base Drain']) || 0,
    // The drain printed on the full card image (max rank, no slot polarity); drain<=N compares this by default.
    maxDrain: slotDrain(mod, maxRank(mod), null).drain,
    maxRank: maxRank(mod),
    flags,
    popular: popular.has(name),
  };
}

/** Index for a list of game-format mods. */
export function buildModIndex(mods, opts) {
  return mods.map(m => modEntry(m, opts));
}

/** A searchable entry per arcane (from arcanes.js arcanesFor()). */
export function arcaneEntry(a) {
  const trigger = fold(a.controls?.trigger ?? '');
  return {
    kind: 'arcane',
    name: a.name,
    lower: fold(a.name),
    nameWords: wordsOf(a.name),
    trigger,
    keywords: wordsOf(`${a.controls?.trigger ?? ''} ${a.summary ?? ''}`),
    desc: fold(`${a.summary ?? ''} ${a.description ?? ''} ${a.requires ?? ''}`),
    support: a.support,
    arcane: a,
    flags: new Set(),
    rarity: 'legendary',
    baseDrain: 0,
    maxDrain: 0,
    maxRank: a.maxRank,
    pol: null,
    popular: false,
  };
}

// ---------- matching ----------

/** Does a mod entry carry what a synonym stands for (by its stats, elements, bane family or flags)? */
function synonymHit(entry, s) {
  if (entry.kind === 'arcane') return (s.text ?? []).some(t => entry.desc.includes(t) || entry.lower.includes(t) || entry.trigger.includes(t));
  if (s.stats?.some(t => entry.stats.has(t))) return true;
  if (s.elements?.some(e => entry.elements.has(e))) return true;
  if (s.factions?.some(f => (f === '*' ? entry.factions.size > 0 : entry.factions.has(f)))) return true;
  if (s.flags?.some(f => entry.flags.has(f))) return true;
  return false;
}

// Stats where less is the point: "-60% Weapon Recoil" is what a recoil mod is for.
const LOWER_IS_BETTER = new Set(['recoil', 'zoom']);

/**
 * Does the (folded) effect text name `phrase` as something the mod gives? Mentions the mod takes away don't count:
 * "Multishot cannot be modified." (Primary Acuity) or "-20% Fire Rate" (unless less is better, as for recoil).
 */
export function positiveMention(desc, phrase, { minusOk = false } = {}) {
  if (!phrase) return false;
  for (let i = desc.indexOf(phrase); i >= 0; i = desc.indexOf(phrase, i + 1)) {
    const before = desc.slice(Math.max(0, i - 12), i);
    const after = desc.slice(i + phrase.length, i + phrase.length + 16);
    const negated = /^\s+(cannot|can't|can not|is not|isn't)\b/.test(after) || (!minusOk && /[-−]\d[\d.]*%\s*$/.test(before));
    if (!negated) return true;
  }
  return false;
}

/**
 * Does a mod's effect text name what a synonym stands for? Catches mods whose effect has no stat of its own
 * (Argon Scope: "On Headshot: +135% Critical Chance when Aiming"), so "cc" and "headshot" find them too.
 * `names` lists mods whose effect text lost the word (an inline icon: Hunter Munitions' Slash).
 */
function synonymDescHit(entry, s) {
  if (entry.kind !== 'mod') return false;
  if (s.names?.includes(entry.name)) return true;
  const minusOk = LOWER_IS_BETTER.has(s.key);
  return (s.desc ?? []).some(t => positiveMention(entry.desc, t, { minusOk }));
}

/** Score one term against an entry: { score, quality } or null when it matches nothing. */
function matchTerm(entry, term) {
  let best = null;
  const take = (score, quality) => { if (!best || score > best.score) best = { score, quality }; };
  const syn = synonymFor(term);
  for (const w of entry.nameWords) {
    const q = wordQuality(term, w);
    // A search word ("viral") only matches names exactly or as a prefix, never as a near miss ("Vital").
    if (q && (!syn || q === 1)) take(3 * q, q);
  }
  if (term.includes(' ') && entry.lower.includes(term)) take(3, 1);
  if (syn) {
    if (synonymHit(entry, syn)) take(2, 1);
    else if (synonymDescHit(entry, syn)) take(1.5, 1);
    return best;
  }
  // Effect words only match exactly, as a prefix or one edit away: two edits find unrelated words
  // ("seration" would find "duration"), and a near-miss prefix does too ("fast" for "faction").
  for (const w of entry.keywords) {
    const q = wordQuality(term, w, 1, { nearPrefix: false });
    if (q) take(2 * q, q);
  }
  if (term.length >= 3 && positiveMention(entry.desc, term)) take(1, 1);
  return best;
}

const compare = (a, op, b) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b);

function isFlag(entry, flag, st) {
  switch (flag) {
    case 'equipped': return st.equipped?.has(entry.name) ?? false;
    case 'fits': return st.fits ? st.fits.has(entry.name) : true;
    case 'blocked': return st.blocked?.has(entry.name) ?? false;
    case 'partial': return entry.kind === 'arcane' ? entry.support === 'partial' : (st.partial?.has(entry.name) ?? false);
    case 'engine-only': return entry.kind === 'arcane' ? entry.support === 'none' : (st.engineOnly?.has(entry.name) ?? false);
    default: return entry.flags.has(flag);
  }
}

/**
 * Filter and score entries.
 * @param {object[]} index buildModIndex() / arcaneEntry() entries
 * @param {object} parsed parseQuery() output
 * @param {object} [st] { equipped: Map<name, slot>, blocked: Map<name, reason>, fits: Set<name>|null, partial: Set, engineOnly: Set,
 *   gains: Map<name, gain>|null, effects: string[], pols: string[], rarities: string[], hideEquipped: boolean, onlyFits: boolean,
 *   drainOf: (entry) => number }   drainOf: what drain<=N compares; by default the max-rank drain printed on the card
 * @returns {{ results: { name, entry, score, fuzzy: boolean, reasons: string[] }[], hints: string[] }}
 */
export function searchEntries(index, parsed, st = {}) {
  const results = [];
  const text = parsed.terms.join(' ');
  const drainOf = st.drainOf ?? (e => e.maxDrain ?? e.baseDrain);
  for (const entry of index) {
    if (st.onlyFits && st.fits && !st.fits.has(entry.name)) continue;
    if (st.hideEquipped && st.equipped?.has(entry.name)) continue;
    if (st.effects?.length && !(entry.categories ?? []).some(c => st.effects.includes(c))) continue;
    if (st.pols?.length && !st.pols.includes(entry.pol ?? 'AP_UNIVERSAL')) continue;
    if (st.rarities?.length && !st.rarities.includes(entry.rarity)) continue;
    const f = parsed.filters;
    if (f.drain.some(c => !compare(drainOf(entry), c.op, c.value))) continue;
    if (f.rank.some(c => !compare(entry.maxRank, c.op, c.value))) continue;
    if (f.gain.length) {
      const g = st.gains?.get(entry.name);
      if (!Number.isFinite(g) || f.gain.some(c => !compare(g * 100, c.op, c.value))) continue;
    }
    if (f.pol.length && !f.pol.includes(entry.pol ?? 'AP_UNIVERSAL')) continue;
    if (f.rarity.length && !f.rarity.includes(entry.rarity)) continue;
    if (f.is.some(flag => !isFlag(entry, flag, st))) continue;
    if (f.has.some(s => !synonymHit(entry, s) && !synonymDescHit(entry, s))) continue;
    if (parsed.phrases.some(p => !entry.lower.includes(p) && !entry.desc.includes(p))) continue;
    if (parsed.negations.some(n => {
      const m = matchTerm(entry, n);
      return m && m.quality === 1;
    })) continue;
    let score = 0;
    let fuzzy = false;
    const reasons = [];
    let ok = true;
    for (const term of parsed.terms) {
      const m = matchTerm(entry, term);
      if (!m) { ok = false; break; }
      score += m.score;
      if (m.quality < 1) fuzzy = true;
      reasons.push(term);
    }
    if (!ok) continue;
    if (text && entry.lower.startsWith(text)) score += 2;
    if (entry.popular) score += 1;
    results.push({ name: entry.name, entry, score, fuzzy, reasons });
  }
  const hints = parsed.synonyms.filter(s => s.hint).map(s => s.hint);
  return { results, hints };
}

/** A name's words as wordsOf() splits them, in their original case ("Double-Barrel Drift" -> Double, Barrel, Drift). */
function displayWords(name) {
  const folded = wordsOf(name);
  const cased = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9/%]+/).filter(Boolean);
  return folded.map((w, i) => (cased.length === folded.length && fold(cased[i]) === w ? cased[i] : w));
}

const sharedPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/**
 * "Did you mean": for each typed word that no searchable entry matches exactly, the closest name word, search
 * word or whole mod name (typed as one word, "pointstrike") that would find something. Words of 8+ letters may be
 * three edits away (when the first two letters agree), 6+ two, 4+ one, and 3-letter words one when the query has
 * other words ("infected clp"). Ties go to
 * the candidate sharing the typed word's first letters ("serating": Serration, not Spring), then to the one with
 * more results. Only entries `st` lets through count (with Fits on, mods that fit the weapon).
 * Returns [{ word, suggestion }] (suggestion as it should be typed).
 */
export function didYouMean(index, parsed, results, st = {}) {
  const out = [];
  const scope = st.onlyFits && st.fits ? index.filter(e => st.fits.has(e.name)) : index;
  const known = term => scope.some(e => {
    const m = matchTerm(e, term);
    return m && m.quality === 1;
  });
  const terms = parsed.terms;
  const unknown = terms.filter(term => !term.includes(' ') && !synonymFor(term) && term.length >= (terms.length > 1 ? 3 : 4) && !known(term));
  if (!unknown.length) return out;
  const vocab = new Map(); // name or search word -> how to type it
  const whole = new Map(); // a name's words run together -> the name
  for (const e of scope) {
    const display = displayWords(e.name);
    for (const [i, w] of e.nameWords.entries()) if (w.length >= 3 && !vocab.has(w)) vocab.set(w, display[i]);
    const joined = e.nameWords.join('');
    if (e.nameWords.length > 1 && joined.length >= 6 && !whole.has(joined)) whole.set(joined, e.name);
  }
  for (const w of SYNONYM_WORDS) if (!vocab.has(w)) vocab.set(w, w);
  const others = new Set(unknown);
  for (const term of unknown) {
    const maxEdits = term.length >= 8 ? 3 : term.length >= 6 ? 2 : 1;
    const cands = [];
    const consider = (key, display, limit) => {
      if (key === term || Math.abs(key.length - term.length) > limit) return;
      const d = editDistance(term, key);
      const prefix = sharedPrefix(term, key);
      // Three edits only for words that start the same ("serating", "serration").
      if (d <= limit && (d < 3 || prefix >= 2)) cands.push({ display, cost: d - 0.4 * Math.min(prefix, 3) });
    };
    for (const [w, display] of vocab) consider(w, display, maxEdits);
    for (const [joined, name] of whole) consider(joined, name, Math.min(maxEdits, 2));
    if (term.length >= 6 && whole.has(term)) cands.push({ display: whole.get(term), cost: -2 });
    cands.sort((a, b) => a.cost - b.cost || a.display.length - b.display.length);
    // The rest of the query without the other misspelt words, so each suggestion is judged on its own.
    const rest = terms.filter(t => t !== term && !others.has(t));
    let best = null;
    const seen = new Set();
    for (const c of cands) {
      if (seen.has(c.display) || seen.size >= 6) continue;
      seen.add(c.display);
      const tried = { ...parsed, terms: [...rest, ...wordsOf(c.display)], synonyms: [] };
      const count = searchEntries(index, tried, st).results.length;
      if (count && (!best || c.cost < best.cost || (c.cost === best.cost && count > best.count))) best = { ...c, count };
    }
    if (best) out.push({ word: term, suggestion: best.display });
  }
  return out;
}

/**
 * Sort search results. sort: 'match' | 'name' | 'drain' | 'rarity' | 'gain'. `drainOf(name)` gives the
 * slot-adjusted drain for the target slot; `gains` the sweep gains. Blocked results go last in every order.
 */
export function sortResults(results, sort = 'match', { blocked = null, drainOf = null, gains = null } = {}) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const keyed = {
    match: (a, b) => b.score - a.score || byName(a, b),
    name: byName,
    drain: (a, b) => (drainOf ? drainOf(a.name) - drainOf(b.name) : (a.entry.maxDrain ?? 0) - (b.entry.maxDrain ?? 0)) || byName(a, b),
    rarity: (a, b) => RARITY_ORDER[a.entry.rarity] - RARITY_ORDER[b.entry.rarity] || byName(a, b),
    gain: (a, b) => (gains?.get(b.name) ?? -Infinity) - (gains?.get(a.name) ?? -Infinity) || byName(a, b),
  }[sort] ?? ((a, b) => b.score - a.score || byName(a, b));
  const isBlocked = r => Boolean(blocked?.has(r.name));
  return [...results].sort((a, b) => Number(isBlocked(a)) - Number(isBlocked(b)) || keyed(a, b));
}

