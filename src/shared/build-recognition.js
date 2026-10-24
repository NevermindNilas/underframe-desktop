// Recognise a gun build from the OCR of a Warframe arsenal upgrade screen: the weapon, the 8 equipped mods with
// their ranks, the exilus mod and the arcane. Pure: it takes the OCR result (lines and word boxes, rank-pip
// measurements per card) and the game data, and returns names from the data's closed vocabulary.
//
// Layout of the upgrade screen (16:9 area, centred on ultrawide screens): the header names the weapon; the
// equipped mods are compact cards in a 2 x 4 grid; the exilus card sits one column to the right of the grid,
// between its rows; the arcane's name is above the exilus; the mod inventory fills the lower half under a search
// box; the stats panel is on the left. A crop of the screen (only the cards) is read too: its scale comes from the
// size of its text (screenGeometry), and nothing is assumed about where it sat on the screen.

import { isKitgun, isModCompatible, maxRank } from './mods.js';
import { normalizePolarity, slotDrain } from './capacity.js';

// ---------- text normalisation and fuzzy matching ----------

/**
 * Fold a name for comparison: lower case, accents dropped, '&' as 'and', apostrophes removed, and the
 * characters OCR confuses most folded together (0/o, 1/l/i/|/!, 5/s, rn/m, vv/w). Other punctuation becomes a
 * space. Both OCR text and vocabulary names go through this, so the folding never changes a correct match.
 */
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '')
    .replace(/0/g, 'o')
    .replace(/[1|!íìï]/g, 'l')
    .replace(/i/g, 'l')
    .replace(/5/g, 's')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Damerau-Levenshtein distance (optimal string alignment: adjacent transpositions count as one edit). */
export function damerauLevenshtein(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev2 = new Array(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

function trigrams(s) {
  const padded = `  ${s} `;
  const out = new Map();
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character trigrams (with padding, so short words still count). */
export function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  let total = 0;
  for (const [g, c] of ta) {
    total += c;
    if (tb.has(g)) shared += Math.min(c, tb.get(g));
  }
  for (const c of tb.values()) total += c;
  return total ? (2 * shared) / total : 0;
}

/**
 * Similarity of two normalised names in [0, 1]: mostly edit distance, plus trigram overlap. Spaces are ignored
 * by the edit distance (OCR often drops or adds them).
 */
export function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ca = a.replace(/ /g, '');
  const cb = b.replace(/ /g, '');
  if (ca === cb) return 0.99;
  const edit = 1 - damerauLevenshtein(ca, cb) / Math.max(ca.length, cb.length);
  return Math.max(0, 0.7 * edit + 0.3 * trigramSimilarity(a, b));
}

/**
 * Best entries of a vocabulary for one OCR text: [{ entry, score }] sorted best first.
 * `vocab` is [{ key (normalised name), ... }].
 */
export function rankMatches(text, vocab, { limit = 3 } = {}) {
  const key = typeof text === 'string' ? normalizeName(text) : '';
  if (key.replace(/ /g, '').length < 3) return [];
  const scored = [];
  for (const entry of vocab) {
    // Cheap length filter before the edit distance.
    const lenA = key.length;
    const lenB = entry.key.length;
    if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.6) continue;
    scored.push({ entry, score: nameSimilarity(key, entry.key) });
  }
  scored.sort((x, y) => y.score - x.score || y.entry.key.length - x.entry.key.length);
  return scored.slice(0, limit);
}

/** The score a match needs, by name length: short names need to be nearly exact. */
export function acceptScore(key) {
  const len = String(key ?? '').replace(/ /g, '').length;
  if (len <= 5) return 0.9;
  if (len <= 8) return 0.85;
  return 0.8;
}

// ---------- vocabulary ----------

const GUN_MOD_TYPES = new Set(['PRIMARY', 'SECONDARY']);
const vocabCache = new WeakMap();

/** Full screenshots show UI text about a hundredth of the 16:9 UI width tall (measured: 87-128 widths per height). */
const UI_WIDTHS_PER_TEXT_HEIGHT = 100;
/** Below this many UI widths per text height, the image is a crop: its text is larger than its size implies. */
const CROP_RATIO = 70;

/**
 * The scale the upgrade screen's layout fractions refer to: { ui, vh, left, cropped }, the 16:9 UI width, the screen
 * height, the UI area's left edge (null when unknown) and whether the image is a crop. A full screenshot gives them
 * from its size. A crop (a few cards cut out of the screen) does not: its scale comes from the median height of its
 * words, and its position on the screen is unknown. The same as src/main/ocr/preprocess.js screenGeometry (the main
 * process can't import this module); a test checks both agree.
 */
export function screenGeometry(width, height, lines = []) {
  const ui0 = Math.min(width, Math.round((height * 16) / 9));
  const heights = [];
  for (const l of lines) {
    if (!/\p{L}{3}/u.test(String(l.text ?? ''))) continue;
    for (const w of l.words ?? []) if (/\p{L}{2}/u.test(String(w.text ?? 'ab')) && w.h > 0) heights.push(w.h);
  }
  heights.sort((a, b) => a - b);
  const median = heights.length >= 4 ? heights[heights.length >> 1] : 0;
  if (median > 0 && ui0 / median < CROP_RATIO) {
    const ui = median * UI_WIDTHS_PER_TEXT_HEIGHT;
    return { ui, vh: (ui * 9) / 16, left: null, cropped: true };
  }
  return { ui: ui0, vh: height, left: (width - ui0) / 2, cropped: false };
}

/** Normalised vocabularies for weapons, gun mods and arcanes, cached per data object. */
export function buildVocabulary(data) {
  if (data && vocabCache.has(data)) return vocabCache.get(data);
  const modRows = data?.mods instanceof Map ? [...data.mods.values()] : (data?.mods ?? []);
  const exilus = new Set(data?.exilusMods ?? []);
  const mods = modRows
    .filter(m => GUN_MOD_TYPES.has(m?.Type) && m['Local Name'])
    .map(m => ({ kind: 'mod', name: m['Local Name'], key: normalizeName(m['Local Name']), mod: m, exilus: exilus.has(m['Local Name']) }));
  const weapons = (data?.weapons ?? [])
    .filter(w => w?.name)
    .map(w => {
      // "Catchmoon (Secondary)" is shown as "Catchmoon"; match the bare name too.
      const shown = w.name.replace(/\s*\([^)]*\)\s*$/, '');
      return { kind: 'weapon', name: w.name, key: normalizeName(shown), weapon: w };
    });
  const conditional = new Map((data?.conditionals?.arcanes ?? []).map(a => [a.name, a.type]));
  const arcanes = (data?.arcanes ?? [])
    .filter(a => a?.arcane_name)
    .map(a => ({ kind: 'arcane', name: a.arcane_name, key: normalizeName(a.arcane_name), slotType: conditional.get(a.arcane_name) ?? null }));
  const vocab = { mods, weapons, arcanes };
  if (data) vocabCache.set(data, vocab);
  return vocab;
}

// ---------- rank ----------

/**
 * The drain a mod shows at a rank, for each polarity case, with the same rules as the capacity meter and the slot
 * drain plates (capacity.js slotDrain): Base Drain + rank; a matching slot polarity halves it (rounded up); a
 * mismatching one adds a quarter (rounded). A mod without polarity shows the same number in every slot.
 */
export function drainAt(mod, rank) {
  const own = normalizePolarity(mod?.Polarity);
  const neutral = slotDrain(mod, rank, null).drain;
  if (!own) return { neutral, match: neutral, mismatch: neutral };
  // Any polarity other than the mod's own (and not Omni) mismatches it.
  const other = own === 'AP_ATTACK' ? 'AP_DEFENSE' : 'AP_ATTACK';
  return {
    neutral,
    match: slotDrain(mod, rank, own === 'AP_ANY' ? 'AP_ATTACK' : own).drain,
    mismatch: own === 'AP_ANY' ? neutral : slotDrain(mod, rank, other).drain,
  };
}

/**
 * Ranks consistent with a drain number shown on a card: [{ rank, polarity }] over every rank and polarity case.
 */
export function ranksForDrain(mod, drain) {
  const out = [];
  const max = maxRank(mod);
  for (let rank = 0; rank <= max; rank++) {
    const d = drainAt(mod, rank);
    for (const polarity of ['neutral', 'match', 'mismatch']) if (d[polarity] === drain) out.push({ rank, polarity });
  }
  return out;
}

/**
 * The rank of an equipped mod from what the screenshot shows:
 * 1. the rank pips under the card (one per rank, lit up to the current rank), when the lit count fits the mod;
 * 2. else the drain number, when every reading consistent with it gives one rank (or includes max rank);
 * 3. else max rank (builds are shared at max rank far more often than not), flagged as assumed.
 * Returns { rank, source: 'pips' | 'drain' | 'assumed', confidence, note? }.
 */
export function inferRank(mod, { pips = null, drain = null } = {}) {
  const max = maxRank(mod);
  // The game draws a lit bar through the pips of a mod at max rank.
  if (pips?.bar) return { rank: max, source: 'pips', confidence: 0.9 };
  const fromProfile = rankFromProfile(pips?.profile, max);
  if (fromProfile) return { ...fromProfile, source: 'pips' };
  if (pips && Number.isFinite(pips.lit)) {
    // The pip row is centred on the card, so its implied length should be the mod's max rank.
    const totalFits = pips.total == null || Math.abs(pips.total - max) <= 1;
    if (pips.lit === 0) {
      if (totalFits) return { rank: 0, source: 'pips', confidence: 0.85 };
    } else {
      if (totalFits && pips.lit <= max) return { rank: pips.lit, source: 'pips', confidence: pips.detected >= pips.lit * 0.6 ? 0.95 : 0.8 };
      if (totalFits && pips.lit === max + 1) return { rank: max, source: 'pips', confidence: 0.7 };
      // Some cards space their pips wider (canticles): as many lit pips as ranks means max rank.
      if (pips.detected === max) return { rank: max, source: 'pips', confidence: 0.7 };
      // The first lit pip was missed or misplaced: count from the last lit pip and the row's centre instead.
      if (Number.isFinite(pips.center) && Number.isFinite(pips.last) && pips.spacing > 0) {
        const fromLast = Math.round((pips.last - pips.center) / pips.spacing + (max - 1) / 2) + 1;
        if (fromLast >= 1 && fromLast <= max) return { rank: fromLast, source: 'pips', confidence: 0.65 };
        if (fromLast === max + 1) return { rank: max, source: 'pips', confidence: 0.6 };
      }
    }
  }
  if (Number.isFinite(drain)) {
    const readings = ranksForDrain(mod, drain);
    const ranks = [...new Set(readings.map(r => r.rank))];
    if (ranks.length === 1) return { rank: ranks[0], source: 'drain', confidence: 0.85 };
    if (ranks.includes(max)) return { rank: max, source: 'drain', confidence: 0.7, note: `drain ${drain} also fits ranks ${ranks.filter(r => r !== max).join(', ')}` };
    if (ranks.length) return { rank: Math.max(...ranks), source: 'drain', confidence: 0.5, note: `drain ${drain} fits ranks ${ranks.join(', ')}` };
  }
  return { rank: max, source: 'assumed', confidence: 0.4 };
}

/** A profile sample at or above this share of lit pixels is a lit pip. */
const LIT_SAMPLE = 0.2;

/**
 * Rank from the pip-row profile (lit-pixel share sampled every half spacing from the card centre), now that the
 * pip count (the mod's max rank) is known: pip k of n sits k - (n - 1) / 2 spacings from the centre. The rank is
 * the position of the last lit pip. Null when the profile does not fit n pips (a lit sample just outside the
 * row, more than one gap among the lit pips, or no lit pip at all).
 */
export function rankFromProfile(profile, max) {
  const s = profile?.samples;
  if (!Array.isArray(s) || !s.length || !(max >= 1)) return null;
  const mid = (s.length - 1) / 2;
  if (max + 1 > mid) return null;
  const at = k => s[mid + 2 * k - (max - 1)] ?? 0;
  const lit = Array.from({ length: max }, (_, k) => at(k) >= LIT_SAMPLE);
  const last = lit.lastIndexOf(true);
  if (last < 0) return null;
  if (at(-1) >= LIT_SAMPLE) return null;
  if (last === max - 1 && at(max) >= LIT_SAMPLE) return null;
  const holes = lit.slice(0, last + 1).filter(on => !on).length;
  if (holes > 1) return null;
  return { rank: last + 1, confidence: holes ? 0.75 : 0.92 };
}

// ---------- layout ----------

const SEARCH_RE = /^[^\p{L}]*\p{L}?(search|buscar|procurar|chercher|suche|cerca|szukaj|поиск|пошук|搜索|搜尋|検索|검색)/iu;
const EMPTY_ARCANE_RE = /empty\s*arcane|arcane\s*slot/i;
/** Words of the English upgrade screen's own UI: when none is read, the client is in another language. */
const ENGLISH_UI_RE = /\b(capacity|upgrades|mods|search)\b/i;

const lineBox = line => {
  const ws = line.words ?? [];
  const x = Math.min(...ws.map(w => w.x));
  const y = Math.min(...ws.map(w => w.y));
  const x1 = Math.max(...ws.map(w => w.x + w.w));
  const y1 = Math.max(...ws.map(w => w.y + w.h));
  return { x, y, x1, y1, cx: (x + x1) / 2, cy: (y + y1) / 2, w: x1 - x, h: y1 - y };
};

/**
 * Text blocks per OCR pass: words on one line that sit close together, then names that wrap onto a second line
 * (directly under, centred the same) joined. Each block keeps its box and its text variants (first line alone
 * and joined), because OCR sometimes splits one name and sometimes runs two cards' names together.
 */
export function textBlocks(lines, { width, height, ui: givenUi = null, vh = null }) {
  const ui = givenUi ?? Math.min(width, Math.round((height * 16) / 9));
  // Tolerances follow the screen's scale (a crop's virtual height), positions stay in image pixels.
  height = vh ?? height;
  const byPass = new Map();
  for (const line of lines) {
    if (!line.words?.length || !String(line.text ?? '').trim()) continue;
    const pass = line.pass ?? 'full';
    if (!byPass.has(pass)) byPass.set(pass, []);
    byPass.get(pass).push({ text: String(line.text).trim(), box: lineBox(line), pass });
  }
  const blocks = [];
  for (const [pass, items] of byPass) {
    // Same-row neighbours: OCR may split "Hornet Strike" into "Horne" and "Strike".
    items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const rows = [];
    for (const it of items) {
      const near = rows.find(r => Math.abs(r.box.cy - it.box.cy) < height * 0.008 && it.box.x - r.box.x1 < ui * 0.012 && it.box.x >= r.box.x);
      if (near) {
        near.text = `${near.text} ${it.text}`;
        near.box = lineBox({ words: [{ x: near.box.x, y: near.box.y, w: near.box.w, h: near.box.h }, { x: it.box.x, y: it.box.y, w: it.box.w, h: it.box.h }] });
      } else rows.push({ ...it });
    }
    rows.sort((a, b) => a.box.y - b.box.y);
    const used = new Set();
    for (const [i, top] of rows.entries()) {
      if (used.has(i)) continue;
      const block = { pass, box: top.box, lines: [top.text] };
      const nextIndex = rows.findIndex((r, j) => j > i && !used.has(j)
        && r.box.y > top.box.y && r.box.y - top.box.y1 < height * 0.012 && r.box.y - top.box.y < height * 0.035
        && Math.abs(r.box.cx - top.box.cx) < ui * 0.025 && r.box.w < ui * 0.14 && top.box.w < ui * 0.14);
      if (nextIndex >= 0) {
        used.add(nextIndex);
        const next = rows[nextIndex];
        block.lines.push(next.text);
        block.box = lineBox({ words: [{ x: top.box.x, y: top.box.y, w: top.box.w, h: top.box.h }, { x: next.box.x, y: next.box.y, w: next.box.w, h: next.box.h }] });
      }
      blocks.push(block);
    }
  }
  return blocks;
}

/** Text variants of a block worth matching: each line, and the lines joined (a hyphen at a wrap joins without space). */
function variantsOf(block) {
  const out = new Set(block.lines);
  if (block.lines.length > 1) {
    const [a, b] = block.lines;
    out.add(/-$/.test(a) ? `${a.slice(0, -1)}${b}` : `${a} ${b}`);
  }
  return [...out];
}

// ---------- weapon ----------

/**
 * The weapon named in the header ("UPGRADES/PHENMOR [30]", "UPGRADES: TORID RANK 30", a custom name followed by
 * the weapon name...). Every run of header words is compared with every weapon name of the same word count;
 * longer names win ties ("Kuva Sobek" over "Sobek"). Returns { entry, score, raw } or null.
 */
export function matchWeaponInText(text, weapons) {
  const words = normalizeName(text).split(' ').filter(Boolean);
  if (!words.length) return null;
  let best = null;
  const byCount = new Map();
  for (const w of weapons) {
    const n = w.key.split(' ').length;
    if (!byCount.has(n)) byCount.set(n, []);
    byCount.get(n).push(w);
  }
  for (const [n, list] of byCount) {
    for (let i = 0; i + n <= words.length; i++) {
      const window = words.slice(i, i + n).join(' ');
      if (window.replace(/ /g, '').length < 3) continue;
      for (const w of list) {
        if (Math.abs(window.length - w.key.length) > Math.max(window.length, w.key.length) * 0.5) continue;
        const score = nameSimilarity(window, w.key);
        if (score < acceptScore(w.key)) continue;
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && w.key.length > best.entry.key.length)) {
          best = { entry: w, score, raw: window };
        }
      }
    }
  }
  return best;
}

// ---------- main ----------

/**
 * Recognise a build.
 * @param {object} ocr   { width, height, lines: [{ text, pass, words: [{ text, x, y, w, h }] }], cards?: [{ x, y, pips }] }
 * @param {object} data  { weapons, mods (array or Map by name), arcanes, exilusMods?, conditionals? } (data.json shape)
 * @returns {{
 *   weapon: { name, confidence, raw } | null,
 *   slots: { index, name, rank, confidence, raw, rankSource?, kind? }[],   // always 8, index 0-7, row by row
 *   exilus: { name, rank, confidence, raw, rankSource? } | null,
 *   arcanes: { name, rank, confidence, raw }[],
 *   unmatched: string[],
 *   warnings: string[],
 * }}
 */
export function recognizeBuild(ocr, data) {
  const width = Number(ocr?.width) || 1920;
  const imageHeight = Number(ocr?.height) || 1080;
  const vocab = buildVocabulary(data);
  const warnings = [];
  const lines = (ocr?.lines ?? []).filter(l => l?.words?.length);
  // The layout's scale: `height` is the screen height the layout fractions refer to (a crop's comes from its text),
  // `imageHeight` the image's own; `left` is null when the crop's place on the screen is unknown.
  const geo = ocr?.geometry ?? screenGeometry(width, imageHeight, lines.filter(l => (l.pass ?? 'full') === 'full'));
  const { ui, left, cropped } = geo;
  const height = geo.vh;

  // Where the inventory starts: the search box (any pass), else nothing is excluded.
  const searchTops = lines.filter(l => SEARCH_RE.test(String(l.text ?? ''))).map(l => lineBox(l).y).filter(y => y > imageHeight * 0.3);
  const inventoryTop = searchTops.length ? Math.min(...searchTops) : imageHeight;

  // ---- weapon from the header
  const header = lines.filter(l => (l.pass === 'title' || l.pass === 'full') && lineBox(l).y < height * 0.13);
  let weaponHit = null;
  for (const l of header) {
    const hit = matchWeaponInText(l.text, vocab.weapons);
    if (hit && (!weaponHit || hit.score > weaponHit.score || (hit.score === weaponHit.score && hit.entry.key.length > weaponHit.entry.key.length))) weaponHit = { ...hit, raw: String(l.text).trim(), box: plainBox(lineBox(l)) };
  }

  // ---- candidate cards: text blocks in the upgrade area (right of the stats panel, above the inventory)
  const blocks = textBlocks(lines, { width, height: imageHeight, ui, vh: height }).filter(b => {
    if (b.pass === 'title') return false;
    // The header band and the stats panel exist only on a full screenshot; a crop holds just the cards.
    if (!cropped && b.box.y < height * 0.12) return false;
    if (b.box.y > inventoryTop - height * 0.005) return false;
    if (left != null && b.box.cx < left + ui * 0.27) return false;
    return b.box.w < ui * 0.16;
  });

  // Group blocks from different passes that sit on the same card.
  const groups = [];
  for (const b of blocks) {
    const g = groups.find(gr => Math.abs(gr.cx - b.box.cx) < ui * 0.035 && Math.abs(gr.cy - b.box.cy) < height * 0.022);
    if (g) {
      g.blocks.push(b);
    } else groups.push({ cx: b.box.cx, cy: b.box.cy, top: b.box.y, blocks: [b] });
  }

  const emptyArcane = blocks.some(b => EMPTY_ARCANE_RE.test(b.lines.join(' '))) || lines.some(l => EMPTY_ARCANE_RE.test(l.text));

  // Score each group against mods and arcanes; keep the best reading.
  const scoreGroup = (g, modPool) => {
    let best = null;
    const raws = new Set();
    for (const b of g.blocks) {
      for (const v of variantsOf(b)) {
        raws.add(v);
        for (const [pool, kind] of [[modPool, 'mod'], [vocab.arcanes, 'arcane']]) {
          const [top] = rankMatches(v, pool, { limit: 1 });
          if (!top || top.score < acceptScore(top.entry.key)) continue;
          const better = !best || top.score > best.score + 1e-9
            || (Math.abs(top.score - best.score) < 1e-9 && top.entry.key.length > best.entry.key.length);
          if (better) best = { entry: top.entry, score: top.score, raw: v, kind };
        }
      }
    }
    // The raw text to report: the slots pass reading, else the longest.
    const slotsBlock = g.blocks.find(b => b.pass === 'slots') ?? g.blocks[0];
    const raw = variantsOf(slotsBlock).sort((a, b) => b.length - a.length)[0];
    return { best, raw, raws: [...raws] };
  };

  for (const g of groups) Object.assign(g, scoreGroup(g, vocab.mods));

  // ---- weapon fallbacks: a riven named after its weapon, or the weapon-specific mods
  // Kitguns are left out: their stats come from grip and loader parts the app can't compose yet.
  const supportedWeapon = w => w && (w.type === 'Primary' || w.type === 'Secondary') && !isKitgun(w);
  if (!weaponHit) {
    // A riven names its weapon's family ("Laetum Vexipha"); the family alone cannot tell "Sobek" from "Kuva
    // Sobek", so the plainest weapon of that family is taken.
    const guns = vocab.weapons.filter(w => supportedWeapon(w.weapon));
    for (const g of groups) {
      if (g.best) continue;
      for (const raw of g.raws) {
        const family = rivenWeaponFamily(raw, guns);
        if (family && (!weaponHit || weaponHit.score < 0.7)) {
          weaponHit = { entry: family.weapon, score: 0.7, raw, via: 'riven' };
          warnings.push(`Weapon taken from the riven "${raw}"; it may be another ${family.family} variant.`);
        }
      }
    }
  }

  // Names shared by variants ("Vinquibus (Primary)" and "(Melee)"): prefer the one the recognised mods fit.
  if (weaponHit) {
    const variants = vocab.weapons.filter(w => w.key === weaponHit.entry.key);
    if (variants.length > 1) {
      const modTypes = groups.filter(g => g.best?.kind === 'mod').map(g => g.best.entry.mod.Type);
      const fits = variants.filter(v => modTypes.length && modTypes.filter(t => t === String(v.weapon.type).toUpperCase()).length * 2 >= modTypes.length);
      weaponHit = { ...weaponHit, entry: fits[0] ?? variants[0], score: weaponHit.score * (fits.length === 1 ? 1 : 0.8) };
      if (fits.length !== 1) warnings.push(`"${weaponHit.raw}" may be any of ${variants.map(v => v.name).join(', ')}.`);
    }
  }
  let weapon = weaponHit?.entry.weapon ?? null;
  if (weapon && isKitgun(weapon)) {
    warnings.push(`${weapon.name.replace(/\s*\([^)]*\)\s*$/, '')} is a kitgun; kitguns (built from grip and loader parts) aren't supported yet.`);
  } else if (weapon && !supportedWeapon(weapon)) {
    warnings.push(`${weapon.name} is a ${String(weapon.type).toLowerCase()} weapon; only primary and secondary guns are supported.`);
  }

  // Mod pool: compatible with the weapon when known, else the gun type most of the matched mods belong to.
  const matchedMods = groups.filter(g => g.best?.kind === 'mod').map(g => g.best.entry.mod);
  let modPool = vocab.mods;
  if (weapon && supportedWeapon(weapon)) {
    modPool = vocab.mods.filter(m => isModCompatible(m.mod, weapon));
  } else if (matchedMods.length) {
    const primary = matchedMods.filter(m => m.Type === 'PRIMARY').length;
    const type = primary * 2 >= matchedMods.length ? 'PRIMARY' : 'SECONDARY';
    modPool = vocab.mods.filter(m => m.mod.Type === type);
    if (!weapon) {
      const guess = guessWeaponFromMods(matchedMods, vocab.weapons);
      if (guess) warnings.push(`Weapon not recognised from the header; the mods fit ${guess}.`);
      else warnings.push('Weapon not recognised.');
    }
  } else if (!weapon) {
    warnings.push('Weapon not recognised.');
  }
  if (modPool !== vocab.mods) {
    for (const g of groups) {
      if (g.best?.kind !== 'mod') continue;
      const rescored = scoreGroup(g, modPool);
      if (rescored.best && (rescored.best.kind === 'mod' || !g.best)) {
        if (rescored.best.entry.name !== g.best.entry.name && rescored.best.score < g.best.score - 0.12) {
          warnings.push(`"${g.raw}" reads as ${g.best.entry.name}, which does not fit ${weapon?.name ?? 'this weapon'}.`);
          continue;
        }
        Object.assign(g, rescored);
      } else if (weapon) {
        warnings.push(`"${g.raw}" reads as ${g.best.entry.name}, which does not fit ${weapon.name}.`);
      }
    }
  }

  // ---- arcane: the best arcane-name group
  const arcaneGroups = groups.filter(g => g.best?.kind === 'arcane').sort((a, b) => b.best.score - a.best.score);
  const arcanes = [];
  if (arcaneGroups.length) {
    const g = arcaneGroups[0];
    arcanes.push({ name: g.best.entry.name, rank: 5, confidence: round2(g.best.score * 0.9), raw: g.raw, box: groupBox(g) });
    warnings.push(`Arcane rank is not read from the screenshot; ${g.best.entry.name} assumed at rank 5.`);
    const want = weapon?.type;
    if (want && g.best.entry.slotType && !new RegExp(`^${want}$`, 'i').test(g.best.entry.slotType) && !['Bow', 'Shotgun'].includes(g.best.entry.slotType)) {
      warnings.push(`${g.best.entry.name} is a ${g.best.entry.slotType.toLowerCase()} arcane but the weapon is ${want.toLowerCase()}.`);
    }
  }

  // ---- grid: rows of mod cards, columns, the exilus to the right
  const cards = groups.filter(g => g.best?.kind === 'mod' || (!g.best && looksLikeCardName(g.raw)));
  const modCards = cards.filter(g => g.best?.kind === 'mod');
  const rowTol = height * 0.03;
  const rowsY = [];
  for (const g of [...modCards].sort((a, b) => a.cy - b.cy)) {
    const row = rowsY.find(r => Math.abs(r.y - g.cy) < rowTol);
    if (row) {
      row.members.push(g);
      row.y = row.members.reduce((s, m) => s + m.cy, 0) / row.members.length;
    } else rowsY.push({ y: g.cy, members: [g] });
  }
  // Grid rows hold at least two cards; take the top two such rows.
  const gridRows = rowsY.filter(r => r.members.length >= 2).sort((a, b) => a.y - b.y).slice(0, 2);
  const gridCards = gridRows.flatMap(r => r.members);
  const xs = [...new Set(gridCards.map(g => g.cx))].sort((a, b) => a - b);
  const colCenters = [];
  for (const x of xs) {
    const c = colCenters.find(cc => Math.abs(cc.x - x) < ui * 0.04);
    if (c) {
      c.n++;
      c.x += (x - c.x) / c.n;
    } else colCenters.push({ x, n: 1 });
  }
  colCenters.sort((a, b) => a.x - b.x);
  const gaps = colCenters.slice(1).map((c, i) => c.x - colCenters[i].x);
  const singleGaps = gaps.map(g => g / Math.max(1, Math.round(g / (ui * 0.128))));
  const spacing = singleGaps.length ? singleGaps.sort((a, b) => a - b)[Math.floor(singleGaps.length / 2)] : ui * 0.128;
  let col0 = colCenters.length ? colCenters[0].x : null;
  // A hovered card's tooltip can hide a whole column. The exilus card and the arcane name sit one column right
  // of the grid, and a riven tooltip is centred on its own slot: use them to find a hidden first column.
  if (col0 != null && gridRows.length) {
    const lastCol = colCenters[colCenters.length - 1].x;
    const hints = [];
    for (const g of groups) {
      if (gridCards.includes(g)) continue;
      const between = g.cy > gridRows[0].y - height * 0.06 && g.cy < gridRows[gridRows.length - 1].y + height * 0.08;
      if (g.best?.kind === 'arcane') hints.push(g.cx - 4 * spacing);
      else if (g.best?.kind === 'mod' && between && g.cx > lastCol + spacing * 0.5) hints.push(g.cx - 4 * spacing);
      else if (!g.best && between && looksLikeRiven(g.raw, vocab.weapons, weapon)) hints.push(g.cx);
    }
    for (const x of hints.sort((a, b) => a - b)) {
      const steps = (col0 - x) / spacing;
      if (steps > 0.75 && Math.abs(steps - Math.round(steps)) < 0.25 && lastCol - x < spacing * 3.25) {
        col0 = col0 - Math.round(steps) * spacing;
        break;
      }
    }
  }

  const slots = Array.from({ length: 8 }, (_, index) => ({ index, name: null, rank: null, confidence: 0, raw: null }));
  let exilus = null;
  const unmatched = [];
  const pipFor = g => {
    const card = (ocr?.cards ?? []).find(c => Math.abs(c.x - g.cx) < ui * 0.03 && Math.abs(c.y - g.top) < height * 0.03);
    return card?.pips ?? null;
  };
  const drainFor = g => {
    // A drain number OCR happened to read at the card's top right.
    const near = lines.find(l => {
      if (!/^\s*\d{1,2}\b/.test(l.text)) return false;
      const b = lineBox(l);
      return b.cx > g.cx + ui * 0.02 && b.cx < g.cx + ui * 0.065 && b.cy < g.top && b.cy > g.top - height * 0.05;
    });
    return near ? Number(near.text.match(/\d{1,2}/)[0]) : null;
  };
  const placed = new Set();
  const lowestRowY = gridRows.length ? gridRows[gridRows.length - 1].y : null;
  const highestRowY = gridRows.length ? gridRows[0].y : null;

  for (const g of cards) {
    if (col0 == null) break;
    const col = Math.round((g.cx - col0) / spacing);
    const rowIndex = gridRows.findIndex(r => Math.abs(r.y - g.cy) < rowTol);
    const isMod = g.best?.kind === 'mod';
    if (col >= 4 && col <= 5 && g.cy > highestRowY - height * 0.06 && g.cy < lowestRowY + height * 0.03) {
      if (!isMod) {
        unmatched.push(g.raw);
        continue;
      }
      if (exilus && exilus.confidence >= g.best.score) continue;
      const rank = inferRank(g.best.entry.mod, { pips: pipFor(g), drain: drainFor(g) });
      exilus = { name: g.best.entry.name, rank: rank.rank, confidence: round2(g.best.score), raw: g.raw, rankSource: rank.source, box: groupBox(g) };
      if (!g.best.entry.exilus) warnings.push(`${g.best.entry.name} is in the exilus slot but is not an exilus mod.`);
      placed.add(g);
      continue;
    }
    if (rowIndex < 0 || col < 0 || col > 3) {
      if (!isMod) continue;
      // A mod outside the grid (inventory without a search box, a tooltip): not part of the build.
      continue;
    }
    // With only one grid row found, it is the top row unless it sits clearly below the arcane/exilus area.
    const row = gridRows.length === 2 ? rowIndex : 0;
    const index = row * 4 + col;
    const slot = slots[index];
    if (!isMod) {
      if (!slot.name) {
        Object.assign(slot, { raw: g.raw, kind: looksLikeRiven(g.raw, vocab.weapons, weapon) ? 'riven' : 'unknown', box: groupBox(g) });
        unmatched.push(g.raw);
      }
      continue;
    }
    if (slot.name && slot.confidence >= g.best.score) continue;
    const rank = inferRank(g.best.entry.mod, { pips: pipFor(g), drain: drainFor(g) });
    Object.assign(slot, { name: g.best.entry.name, rank: rank.rank, confidence: round2(g.best.score), raw: g.raw, rankSource: rank.source, box: groupBox(g) });
    delete slot.kind;
    if (rank.note) warnings.push(`${g.best.entry.name}: ${rank.note}.`);
    placed.add(g);
  }
  if (gridRows.length < 2 && modCards.length) warnings.push('Only one row of equipped mods was found; slot positions may be off.');

  // Slots where nothing was read are told apart (an empty slot shows no text at all):
  // - 'hidden': other text (a hovered card's tooltip, a riven's stats) lies over the card, so a mod may be under it;
  // - 'unread': the slot's row or the grid was not found, so nothing can be said;
  // - 'empty': the card area is free of text.
  //   A tooltip is drawn over its card and the one above or below it, with its text often outside both card
  //   areas, so text anywhere in a column's span marks the column's empty slots as hidden.
  const rowGap = gridRows.length === 2 ? gridRows[1].y - gridRows[0].y : height * 0.2;
  const rowYs = gridRows.length === 2 ? [gridRows[0].y, gridRows[1].y] : gridRows.length === 1 ? [gridRows[0].y, null] : [null, null];
  const placedBoxes = [...placed].map(groupBox);
  const inPlaced = b => placedBoxes.some(p => b.cx > p.x - 8 && b.cx < p.x + p.w + 8 && b.cy > p.y - 8 && b.cy < p.y + p.h + 8);
  // Text that is not a recognised card name or a drain number.
  const foreign = lines.map(l => ({ l, b: lineBox(l) })).filter(({ l, b }) => l.pass !== 'title' && b.y < inventoryTop && !inPlaced(b) && !/^\s*[\d\s.,-]{1,3}\s*$/.test(String(l.text ?? '')));
  const textIn = (cx, y0, y1) => foreign.some(({ b }) => b.cx > cx - spacing * 0.48 && b.cx < cx + spacing * 0.48 && b.cy > y0 && b.cy < y1);
  const firstY = rowYs[0];
  const lastY = rowYs[1] ?? rowYs[0];
  for (const s of slots) {
    if (s.name || s.kind) continue;
    const y = rowYs[Math.floor(s.index / 4)];
    if (col0 == null || y == null) { s.kind = 'unread'; continue; }
    const cx = col0 + (s.index % 4) * spacing;
    const covered = textIn(cx, y - rowGap * 0.55, y + rowGap * 0.2) || textIn(cx, firstY - rowGap * 0.55, lastY + rowGap * 0.9);
    s.kind = covered ? 'hidden' : 'empty';
  }
  let exilusState = exilus ? 'found' : 'unread';
  if (!exilus && col0 != null && firstY != null) {
    const y = firstY + rowGap / 2;
    exilusState = textIn(col0 + 4.5 * spacing, y - rowGap * 0.55, y + rowGap * 0.2) ? 'hidden' : 'empty';
  }
  // The arcane socket sits above the exilus card, its name over the first grid row (located like the exilus).
  // - text there that matched no arcane, or a card outline without rank pips: an arcane whose name wasn't read;
  // - nothing there on an English client (its UI words read): an empty socket, which shows only an icon;
  // - nothing there on a translated client: unknown too, since English OCR reads no text from a Japanese name.
  let arcaneState = arcanes.length ? 'found' : emptyArcane ? 'empty' : 'unread';
  let arcaneRaw = null;
  if (arcaneState === 'unread' && col0 != null && firstY != null) {
    const cx = col0 + 4.5 * spacing;
    const inBox = (x, y) => Math.abs(x - cx) < spacing * 0.75 && y > firstY - rowGap * 0.75 && y < firstY - rowGap * 0.12;
    const inSocket = foreign.filter(({ b }) => inBox(b.cx, b.cy));
    const outline = (ocr?.cards ?? []).some(c => !c.pips && inBox(c.x, c.y));
    const englishUi = lines.some(l => ENGLISH_UI_RE.test(String(l.text ?? '')));
    arcaneState = inSocket.length || outline || !englishUi ? 'unknown' : 'empty';
    if (inSocket.length) arcaneRaw = inSocket.map(({ l }) => String(l.text).trim()).join(' ');
  }
  if (arcaneState === 'unknown') warnings.push("An arcane's name wasn't readable; pick the arcane you see, if any.");
  else if (arcaneState === 'unread') warnings.push('No arcane recognised.');
  for (const s of slots) if (s.kind === 'hidden') warnings.push(`Slot ${s.index + 1} is covered by other text in the screenshot; pick the mod you see there.`);

  const assumed = [...slots.filter(s => s.name && s.rankSource === 'assumed'), ...(exilus?.rankSource === 'assumed' ? [exilus] : [])];
  if (assumed.length) warnings.push(`Rank not visible for ${assumed.map(s => s.name).join(', ')}; assumed max rank.`);
  for (const s of slots) {
    if (s.kind === 'riven') warnings.push(`Slot ${s.index + 1} holds a riven ("${s.raw}"); rivens are not supported and the slot is left empty.`);
    else if (s.kind === 'unknown') warnings.push(`Slot ${s.index + 1} ("${s.raw}") did not match any mod.`);
  }
  const names = slots.map(s => s.name).filter(Boolean);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) warnings.push(`${[...new Set(dupes)].join(', ')} recognised more than once.`);
  if (!names.length && !exilus) warnings.push('No equipped mods were recognised. Use an English game screenshot of the weapon\'s upgrade screen.');

  // Every text region the build was not read from, for the review screen's "Show unrecognised text".
  const usedGroups = new Set([...placed, ...arcaneGroups.slice(0, 1)]);
  const unmatchedRegions = groups.filter(g => !usedGroups.has(g) && g.raw).map(g => ({ raw: g.raw, box: groupBox(g) }));

  return {
    weapon: weapon ? { name: weapon.name, confidence: round2(weaponHit.score), raw: weaponHit.raw, box: weaponHit.box ?? null } : null,
    slots,
    exilus,
    exilusState,
    arcanes,
    arcaneState,
    arcaneRaw,
    unmatched: [...new Set(unmatched)],
    unmatchedRegions,
    warnings,
  };
}

const round2 = v => Math.round(v * 100) / 100;

/** { x, y, w, h } of a box (in the screenshot's pixels). */
const plainBox = b => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

/** The region a card's name was read from: the union of its text blocks. */
function groupBox(g) {
  const boxes = g.blocks.map(b => b.box);
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x1));
  const y1 = Math.max(...boxes.map(b => b.y1));
  return plainBox({ x, y, w: x1 - x, h: y1 - y });
}


/** Whether an unmatched text could be a card name at all (letters, not a number or a stat line). */
function looksLikeCardName(raw) {
  const s = String(raw ?? '');
  return /\p{L}{3}/u.test(s) && !/[%+]/.test(s) && s.length <= 40;
}

const WEAPON_QUALIFIERS = new Set(['kuva', 'tenet', 'prime', 'prlme', 'prisma', 'prlsma', 'vandal', 'wraith', 'mk', 'coda', 'dex', 'telos', 'synoid', 'vaykor', 'rakta', 'sancti', 'secura', 'mara', 'dual', 'twin', 'mutalist']);

/**
 * Whether a riven-style text starts with a weapon family word, allowing up to two stray leading characters.
 * Three-letter families ("Hek") must match exactly; the riven's own syllables must follow.
 */
function familyAt(letters, k, minScore) {
  if (k.length < 3 || letters.length < k.length + (k.length === 3 ? 5 : 3)) return false;
  for (let offset = 0; offset <= 2; offset++) {
    const head = letters.slice(offset, offset + k.length);
    if (k.length === 3 ? head === k : nameSimilarity(head, k) >= minScore) return true;
  }
  return false;
}

/** The family word of a weapon name, as rivens use it ("Kuva Sobek" -> "sobek"). */
function weaponFamily(key) {
  return key.split(' ').find(part => !WEAPON_QUALIFIERS.has(part) && part.length >= 3) ?? '';
}

/**
 * Rivens are named "<weapon family> <syllables>", e.g. "Phenmor Lexicon". OCR may add a stray character in
 * front or split the family word ("Magn us Critatis"), so the start of the text is compared with spaces removed.
 */
export function looksLikeRiven(raw, weapons, weapon = null) {
  const letters = normalizeName(raw).replace(/ /g, '');
  if (letters.length < 6) return false;
  const families = weapon ? [weaponFamily(normalizeName(weapon.name))] : [...new Set(weapons.map(w => weaponFamily(w.key)))];
  return families.some(k => {
    return familyAt(letters, k, 0.75);
  });
}

// Words a riven name never has: a weapon variant, a part, a rank tag. Text with them is a weapon or item label
// ("KOMPRESSA PRIME [30]", "Burston Prime Receiver"), not a riven.
const NOT_RIVEN_WORD = /\b(prime|prlme|prisma|prlsma|vandal|wraith|receiver|barrel|stock|blueprint|rank|mk1|kuva|tenet|coda)\b/i;

/**
 * The weapon a riven's name points to, for the "weapon from the riven" fallback; stricter than looksLikeRiven().
 * A riven name is "<family> <syllables>" ("Laetum Vexipha", "Sobek Acrido"): the family must end on a word
 * boundary (OCR may split it, "Sob ek", or add one stray leading character, "I-Laetum") and be followed by one or
 * two letter-only syllable words. Digits, brackets and variant or part words rule the text out, so HUD weapon
 * labels, component names and player names ("AlexanderR... O") don't count. The family alone cannot tell
 * "Sobek" from "Kuva Sobek", so its plainest weapon is returned: { weapon, family } or null.
 */
export function rivenWeaponFamily(raw, weapons) {
  const text = String(raw ?? '');
  if (/[\d[\]()|%+:.]/.test(text) || NOT_RIVEN_WORD.test(text)) return null;
  const words = normalizeName(text).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const families = new Map();
  for (const w of weapons) {
    const k = weaponFamily(w.key);
    if (k.length < 3) continue;
    const prev = families.get(k);
    if (!prev || w.key.length < prev.key.length) families.set(k, w);
  }
  let best = null;
  for (const start of words[0].length <= 2 ? [0, 1] : [0]) {
    for (const take of [1, 2]) {
      const head = words.slice(start, start + take).join('');
      const rest = words.slice(start + take);
      if (!head || rest.length < 1 || rest.length > 2 || !rest.every(r => /^[a-z]+$/.test(r)) || rest.join('').length < 4) continue;
      for (const [k, w] of families) {
        const ok = k.length === 3 ? head === k : Math.abs(head.length - k.length) <= 2 && nameSimilarity(head, k) >= 0.8;
        if (ok && (!best || k.length > best.family.length)) best = { weapon: w, family: k };
      }
    }
  }
  return best;
}

/** A weapon family the weapon-specific mods point to ("Critical Precision" -> Tiberon), as text, or null. */
function guessWeaponFromMods(mods, weapons) {
  const specific = mods.map(m => m['Compat Name']).filter(c => c && !['PRIMARY', 'Rifle', 'Rifle (No Aoe)', 'Sniper', 'Bow', 'Shotgun', 'Pistol', 'Pistol (No Aoe)', 'Thrown', 'Tome', 'Unique'].includes(c));
  if (specific.length) return specific[0];
  const compat = new Set(mods.map(m => m['Compat Name']));
  if (compat.has('Tome')) return 'a tome';
  if (compat.has('Shotgun')) return 'a shotgun';
  if (compat.has('Rifle') || compat.has('PRIMARY')) return 'a rifle';
  if (compat.has('Pistol')) return 'a pistol';
  return weapons.length ? null : null;
}
