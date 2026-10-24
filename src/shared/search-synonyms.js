// The gallery search vocabulary: short words players type ("cc", "ms", "viral", "bane") and what they find.
// Our own table (docs/arsenal-spec.md 5.2); no game data. Each entry matches mods by stat type (UpgradeType),
// damage element, bane family or a flag computed by mod-search.js, and arcanes by words in their effect text.

const CRIT_CHANCE = ['WEAPON_CRIT_CHANCE', 'WEAPON_CRIT_CHANCE_WEAKPOINT'];
const HEADSHOT = ['WEAPON_HEADSHOT_MULTIPLIER', 'WEAPON_DAMAGE_WEAKPOINT', 'WEAPON_CRIT_CHANCE_WEAKPOINT'];

/**
 * key: the canonical name (shown in hints and "has:" tags); words: every spelling that means it (multi-word
 * spellings are matched before single words); stats / elements / factions / flags: what a mod needs (any one);
 * desc: phrases in a mod's effect text that also count (for effects without a stat of their own, like Argon
 * Scope's "On Headshot: +135% Critical Chance"); names: mods that count by name (their effect text lost the
 * word to an inline icon); text: phrases that find arcanes; hint: shown under the result count when the word is used.
 */
export const SYNONYMS = Object.freeze([
  { key: 'crit', words: ['crit', 'crits', 'critical'], stats: [...CRIT_CHANCE, 'WEAPON_CRIT_DAMAGE'], desc: ['critical chance', 'critical damage'], text: ['critical'] },
  { key: 'crit chance', words: ['cc', 'crit chance', 'critical chance'], stats: CRIT_CHANCE, desc: ['critical chance'], text: ['critical chance'] },
  { key: 'crit damage', words: ['cd', 'cm', 'crit dmg', 'crit damage', 'critical damage', 'crit multiplier'], stats: ['WEAPON_CRIT_DAMAGE'], desc: ['critical damage'], text: ['critical damage'] },
  { key: 'multishot', words: ['ms', 'multi', 'multishot'], stats: ['WEAPON_FIRE_ITERATIONS'], desc: ['multishot'], text: ['multishot'] },
  { key: 'fire rate', words: ['fr', 'firerate', 'fire rate', 'aps'], stats: ['WEAPON_FIRE_RATE'], desc: ['fire rate'], text: ['fire rate'] },
  { key: 'status chance', words: ['sc', 'status chance'], stats: ['WEAPON_PROC_CHANCE'], desc: ['status chance'], text: ['status chance'] },
  { key: 'status', words: ['status'], stats: ['WEAPON_PROC_CHANCE', 'WEAPON_PROC_TIME', 'WEAPON_PROC_DAMAGE'], desc: ['status chance', 'status duration', 'status damage'], text: ['status'] },
  { key: 'status duration', words: ['sd', 'status duration'], stats: ['WEAPON_PROC_TIME'], desc: ['status duration'], text: ['status duration'] },
  { key: 'damage', words: ['dmg', 'base', 'damage', 'base damage'], stats: ['WEAPON_DAMAGE_AMOUNT'], text: ['damage'] },
  { key: 'ips', words: ['ips', 'physical'], elements: ['Impact', 'Puncture', 'Slash'], text: ['impact', 'puncture', 'slash'] },
  // Hunter Munitions' effect text names Slash with an inline icon only ("+30% chance to apply  on Critical").
  { key: 'slash', words: ['slash'], elements: ['Slash'], desc: ['slash'], names: ['Hunter Munitions'], text: ['slash'] },
  { key: 'puncture', words: ['puncture', 'punc'], elements: ['Puncture'], text: ['puncture'] },
  { key: 'impact', words: ['impact'], elements: ['Impact'], text: ['impact'] },
  { key: 'heat', words: ['heat', 'fire'], elements: ['Heat'], text: ['heat'] },
  { key: 'cold', words: ['cold', 'ice', 'cryo', 'frost'], elements: ['Cold'], text: ['cold'] },
  { key: 'electricity', words: ['elec', 'electric', 'electricity', 'shock', 'lightning'], elements: ['Electricity'], text: ['electricity'] },
  { key: 'toxin', words: ['toxin', 'tox', 'poison'], elements: ['Toxin'], text: ['toxin'] },
  { key: 'viral', words: ['viral'], elements: ['Cold', 'Toxin', 'Viral'], text: ['viral', 'cold', 'toxin'], hint: 'Viral comes from Cold + Toxin: showing both.' },
  { key: 'corrosive', words: ['corrosive', 'corro'], elements: ['Electricity', 'Toxin', 'Corrosive'], text: ['corrosive'], hint: 'Corrosive comes from Electricity + Toxin: showing both.' },
  { key: 'radiation', words: ['radiation', 'rad'], elements: ['Heat', 'Electricity', 'Radiation'], text: ['radiation'], hint: 'Radiation comes from Heat + Electricity: showing both.' },
  { key: 'blast', words: ['blast'], elements: ['Heat', 'Cold', 'Blast'], text: ['blast'], hint: 'Blast comes from Heat + Cold: showing both.' },
  { key: 'magnetic', words: ['magnetic', 'mag el'], elements: ['Cold', 'Electricity', 'Magnetic'], text: ['magnetic'], hint: 'Magnetic comes from Cold + Electricity: showing both.' },
  { key: 'gas', words: ['gas'], elements: ['Heat', 'Toxin', 'Gas'], text: ['gas'], hint: 'Gas comes from Heat + Toxin: showing both.' },
  { key: 'bane', words: ['bane', 'faction', 'banes'], factions: ['*'], text: ['damage to'] },
  { key: 'grineer', words: ['grineer'], factions: ['Grineer'], text: ['grineer'] },
  { key: 'corpus', words: ['corpus'], factions: ['Corpus'], text: ['corpus'] },
  { key: 'infested', words: ['infested'], factions: ['Infested'], text: ['infested'] },
  { key: 'corrupted', words: ['corrupted', 'orokin'], factions: ['Corrupted'], text: ['corrupted', 'orokin'] },
  { key: 'murmur', words: ['murmur', 'murmurs', 'the murmur'], factions: ['Murmurs'], text: ['murmur'] },
  { key: 'sentient', words: ['sentient', 'sentients'], factions: ['Sentients'], text: ['sentient'] },
  { key: 'scaldra', words: ['scaldra'], factions: ['Scaldra'], text: ['scaldra'] },
  { key: 'techrot', words: ['techrot'], factions: ['Techrot'], text: ['techrot'] },
  { key: 'primed', words: ['primed'], flags: ['primed'] },
  { key: 'galvanized', words: ['galvanized', 'galv'], flags: ['galvanized'] },
  { key: 'amalgam', words: ['amalgam'], flags: ['amalgam'] },
  { key: 'magazine', words: ['mag', 'magazine', 'clip'], stats: ['WEAPON_CLIP_MAX'], desc: ['magazine capacity'], text: ['magazine'] },
  { key: 'reload', words: ['reload', 'rs', 'reload speed'], stats: ['WEAPON_RELOAD_SPEED'], desc: ['reload speed'], text: ['reload'] },
  { key: 'ammo', words: ['ammo'], flags: ['ammo'], text: ['ammo'] },
  { key: 'punch through', words: ['pt', 'punch', 'punch through', 'punchthrough'], stats: ['WEAPON_PUNCTURE_DEPTH'], desc: ['punch through'], text: ['punch through'] },
  { key: 'zoom', words: ['zoom'], flags: ['zoom'], text: ['zoom'] },
  { key: 'recoil', words: ['recoil'], stats: ['WEAPON_RECOIL'], desc: ['recoil'], text: ['recoil'] },
  { key: 'accuracy', words: ['accuracy'], flags: ['accuracy'], text: ['accuracy'] },
  { key: 'headshot', words: ['hs', 'headshot', 'headshots', 'weak point', 'weakpoint'], stats: HEADSHOT, desc: ['headshot', 'weak point'], text: ['headshot'] },
  { key: 'exilus', words: ['exilus', 'utility'], flags: ['exilus'] },
  { key: 'augment', words: ['aug', 'augment'], flags: ['augment'] },
  { key: 'dual', words: ['dual', '60/60', 'dual stat'], flags: ['dual'] },
]);

const BY_WORD = new Map();
for (const s of SYNONYMS) for (const w of s.words) if (!BY_WORD.has(w)) BY_WORD.set(w, s);

/** The synonym a word or phrase stands for (lower-case), or null. */
export const synonymFor = word => BY_WORD.get(String(word ?? '').toLowerCase()) ?? null;

/** Every synonym spelling, longest first (multi-word spellings are matched first). */
export const SYNONYM_PHRASES = Object.freeze([...BY_WORD.keys()].filter(w => w.includes(' ')).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length));

/** Single-word spellings, for "Did you mean". */
export const SYNONYM_WORDS = Object.freeze([...BY_WORD.keys()].filter(w => !w.includes(' ') && w.length >= 3));
