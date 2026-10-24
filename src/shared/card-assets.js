// Card artwork lookup: resolves mod, arcane and polarity image URLs from core/images/index.json.
// Every lookup returns null when the image is not shipped, so the UI can draw a styled text card.
// The images themselves live in the private core (Digital Extremes' artwork); this file only maps names.

/** Where the app serves core/images (see src/main/protocol.js). */
export const DEFAULT_IMAGE_BASE = '/core/images/';

/** Polarity codes as the game data writes them -> the names players know. AP_UNIVERSAL means "no polarity". */
export const POLARITY_NAMES = Object.freeze({
  AP_ATTACK: 'Madurai',
  AP_DEFENSE: 'Vazarin',
  AP_TACTIC: 'Naramon',
  AP_POWER: 'Zenurik',
  AP_WARD: 'Unairu',
  AP_WAVE: 'Unairu',
  AP_PRECEPT: 'Penjaga',
  AP_UMBRA: 'Umbra',
  AP_OMNI: 'Omni',
  AP_ANY: 'Omni',
});

/** Polarity code -> icon file name on the asset host (the Omni icon is called "Any"). */
const POLARITY_ICON_FILES = Object.fromEntries(Object.entries(POLARITY_NAMES).map(([k, v]) => [k, v === 'Omni' ? 'Any' : v]));

/** Card frame colours, lowest to highest. */
export const RARITY_FRAMES = Object.freeze(['Bronze', 'Silver', 'Gold', 'Legendary', 'Riven']);

const FRAME_BY_RARITY = { COMMON: 'Bronze', UNCOMMON: 'Silver', RARE: 'Gold', LEGENDARY: 'Legendary', RIVEN: 'Riven' };

/** Name prefixes whose cards use the Legendary (platinum) frame whatever their data rarity says. */
const LEGENDARY_PREFIXES = ['Primed ', 'Galvanized ', 'Amalgam '];

/**
 * Frame key for a mod card: 'Bronze' | 'Silver' | 'Gold' | 'Legendary' | 'Riven'.
 * Accepts a game-format mod ({ 'Local Name', Rarity, Type }) or a build slot ({ name, isRiven }).
 */
export function modRarityFrame(mod) {
  if (!mod) return 'Bronze';
  const name = String(mod['Local Name'] ?? mod.name ?? '');
  if (LEGENDARY_PREFIXES.some(p => name.includes(p))) return 'Legendary';
  if (mod.isRiven || String(mod.Type).toUpperCase() === 'RIVEN' || String(mod.Rarity).toUpperCase() === 'RIVEN') return 'Riven';
  return FRAME_BY_RARITY[String(mod.Rarity || 'COMMON').toUpperCase()] ?? 'Bronze';
}

/** 'AP_ATTACK' -> 'Madurai'; null for no polarity (AP_UNIVERSAL, empty); unknown codes are title-cased. */
export function polarityDisplayName(code) {
  if (!code) return null;
  const key = String(code).toUpperCase();
  if (key === 'AP_UNIVERSAL') return null;
  if (POLARITY_NAMES[key]) return POLARITY_NAMES[key];
  const words = key.replace(/^AP_/, '').toLowerCase().split('_').filter(Boolean);
  return words.length ? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : null;
}

const fold = s => String(s ?? '').trim().toLowerCase();

/** Case-insensitive name -> value map, with alias names folded in. */
function lookup(table, aliases) {
  const map = new Map();
  for (const [name, value] of Object.entries(table ?? {})) map.set(fold(name), value);
  for (const [alias, target] of Object.entries(aliases ?? {})) {
    if (!map.has(fold(alias)) && map.has(fold(target))) map.set(fold(alias), map.get(fold(target)));
  }
  return name => map.get(fold(name)) ?? null;
}

function joinUrl(base, rel) {
  if (typeof rel !== 'string' || !rel || rel.split('/').some(s => !s || s === '.' || s === '..')) return null;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + rel.split('/').map(encodeURIComponent).join('/');
}

/**
 * Build the resolver from a parsed core/images/index.json (null or a malformed index gives a resolver
 * that answers null everywhere).
 *
 *   const cards = createCardAssets(index);
 *   cards.modCard('Serration')          // { full: '/core/images/mods/full/serration.webp', compact: '...' }
 *   cards.modFullUrl('Primed Bane of The Murmur')  // null: not on the asset host
 *   cards.arcaneUrl('Primary Merciless')
 *   cards.polarityUrl('AP_ATTACK')      // '/core/images/polarities/Madurai.svg'
 */
export function createCardAssets(index, { base = DEFAULT_IMAGE_BASE } = {}) {
  const ok = index && typeof index === 'object';
  const mod = lookup(ok ? index.mods : null, ok ? index.aliases : null);
  const arcane = lookup(ok ? index.arcanes : null, null);
  const polarityFile = lookup(ok ? index.polarities : null, null);
  const codes = { ...POLARITY_ICON_FILES, ...(ok ? index.polarityCodes : null) };
  const url = rel => joinUrl(base, rel);
  const groups = ok && index.arcaneGroups && typeof index.arcaneGroups === 'object' ? index.arcaneGroups : {};

  const api = {
    /** True when an index was loaded. */
    available: Boolean(ok && index.mods),
    modFullUrl: name => url(mod(name)?.full),
    modCompactUrl: name => url(mod(name)?.compact),
    /** Both card variants; either may be null. */
    modCard: name => ({ full: api.modFullUrl(name), compact: api.modCompactUrl(name) }),
    arcaneUrl: name => url(arcane(name)),
    /** Accepts a code (AP_ATTACK) or an icon name (Madurai); null for no polarity. */
    polarityUrl: code => {
      if (!code) return null;
      const key = String(code).toUpperCase();
      if (key === 'AP_UNIVERSAL') return null;
      const file = codes[key] ?? (key.startsWith('AP_') ? null : code);
      return file ? url(polarityFile(file)) : null;
    },
    /** Arcane names with an image in a group: 'weapon' (Primary/Secondary slot) or 'warframe' (buffs weapons). */
    arcaneNames: (group = 'weapon') => (Array.isArray(groups[group]) ? groups[group].filter(n => arcane(n)) : []),
  };
  return api;
}

/** Fetch index.json and build the resolver; a missing or broken index yields the all-null resolver. */
export async function loadCardAssets({ fetch: doFetch = globalThis.fetch, base = DEFAULT_IMAGE_BASE } = {}) {
  try {
    const res = await doFetch(joinUrl(base, 'index.json'));
    if (!res.ok) return createCardAssets(null, { base });
    return createCardAssets(await res.json(), { base });
  } catch {
    return createCardAssets(null, { base });
  }
}
