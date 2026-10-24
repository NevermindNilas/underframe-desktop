# Porting underframe.site's Riven mods

Status: research spec for a builder (2026-10-25). It describes **behaviour and data contracts** read from underframe.site's front end (`script.js`, studied as data, never run). It quotes no site code. Field names, stat keys and messages are given because saved builds, `core/data/data.json` and the engine use them. Line numbers (`L123`) point into the site's `script.js` as downloaded for this research. Engine claims marked **(probed)** were checked by running `core/engine` in node; section 10 has the numbers.

Scope: what a riven is on the site, how its stats scale and reach the simulation, how it is stored, edited and validated, and a port plan for this app (Primary and Secondary guns only). Melee-only stats are listed for completeness but are not part of the port. Out of scope for the first port: OCR import of riven screenshots, the left/right riven comparison, "Slot My Riven" and "Auto Riven" (section 9).

## 0. Key facts

| Topic | Fact |
| --- | --- |
| What a riven is | A build slot object `{ isRiven: true, id, name, family, disposition?, rank?, stats: [{ name, value, unit }] }`. It is not a row of `data.mods`: `data.mods` has **no** riven entry, and `"Riven Mod"` exists only as a name in `data.blacklist` (and the site's Auto Build blacklists). |
| Stored value | `stats[].value` is the roll **before** disposition and rank: base x stat-count multiplier x roll (0.9-1.1). Negative stats are stored negative. |
| Effective value | `value x disposition x (rank + 1) / 9` (L463-477). Disposition defaults to **1.2** for every weapon (L444, L452-454); rank defaults to **8** (L443, L456-461). |
| Stat catalogue | `data.riven_stats[type]`, `type` in `Rifle`, `Shotgun`, `Pistol`, `Archgun`, `Melee`; each maps a stat key to a base string (`"149.99%"`, `"2.7m"`, `"24.5"`). |
| Riven type | Primary shotgun: `Shotgun`. Other primaries: `Rifle`. Every secondary, and modular (kitgun) primaries: `Pistol`. Exalted and pseudo-exalted weapons, and a short name list, take none (L368-382). |
| Family | `getRivenFamilyName(weapon.name)` (L1919-1930): this app's `weaponFamily()` plus two exceptions (Dex Furis is `Afuris`; Pangolin and Pangolin Prime are `Pangolin Sword`). |
| Limits | 2-3 positive stats, 0-1 negative stat, so 2-4 stats in all; each stat name once; at most one "spliced" stat and it must be positive; one riven per build; never in the Exilus slot. |
| Capacity | Drain `10 + rank` (L7633), polarity Omni: halved (rounded up) in any polarised slot except Umbra, full in an unpolarised or Umbra slot (L7660-7720). |
| Where it acts | Folded into the modifier buckets in JS (L28914-29006), **and** sent to the engine inside `build.mods` with its stats pre-scaled (L33519-33546). The engine reads riven `BaseDamage`, `Status Damage` and element stats from `build.mods` for DoT and status maths **(probed)**. Both paths are needed for parity. |
| Library | `localStorage.userRivens` (an array of rivens, L12786-12788, L12934-12939), global, filtered by family when offered. |

## 1. Shape of a riven

### 1.1 In a build

A riven sits in `build.mods[i]` like any mod slot, but as a full object:

```
{
  isRiven: true,
  id: "riven_1761979064385",          // "riven_<ms>" from the editor, "riven_<ms>_<random>" from OCR, "optimal_riven_<ms>" from Auto Riven
  name: "Braton Riven Mod",            // always "<family> Riven Mod"
  family: "Braton",                    // getRivenFamilyName(weapon.name) at save time
  disposition: 1.2,                    // optional; number > 0
  rank: 8,                             // optional; integer 0-8
  stats: [
    { name: "Critical Chance", value: 1.856, unit: "%" },
    { name: "Multishot",       value: 1.114, unit: "%" },
    { name: "Zoom",            value: -0.297, unit: "%" }
  ]
}
```

- `stats[].name` is a key of `data.riven_stats[type]` (`"BaseDamage"`, `"ToxinDamage"`, `"Damage vs.Grineer"`, `"Fire Rate/Attack Speed"`, ...), never a display label.
- `stats[].unit` is the unit of the base string: `"%"` for percentages (value is a fraction: 1.856 is 185.6%), `"m"` for Punch Through and Range (value in metres), `""` for Initial Combo, `"s"` for Combo Duration (L499-505, L17648-17649).
- The stat order is the editor's row order: positives first as created, a negative where it was added. OCR stores the bottom stat last and makes it the negative when there are 4 stats (L50109-50168).
- Missing or invalid `disposition` means 1.2; missing or invalid `rank` means 8. Rivens from the OCR import (L49942-49948), Auto Riven (L41999-42005) and every trusted build carry neither.
- The site edits the riven object in place: equipping a library riven puts the library object itself in the slot (L31551-31552, L17200-17202); after a save and reload they are separate copies that share an `id`.
- Rank keys never touch a riven: the rank +/- action returns early for `isRiven` (L31597). Its rank is edited only in the riven editor.

### 1.2 In the library (`userRivens`)

- An array of riven objects in exactly the build shape, in `localStorage['userRivens']`. On first load it is seeded from `data.rivens` (empty in this data, L12786-12788).
- Rivens are not added to the library on save. The mod picker's "Add to Library" / "Remove from Library" button (shown while a riven is in the active slot) does that, with an alert either way (L17059-17081). Saving an edited riven whose `id` is in the library replaces the library copy too (L32033-32038).
- Settings › data management lists "Riven Library" ("Any Rivens you have added or imported.", L11129-11133) for clearing; export/import includes `rivens` as an id (L11306, L11742), and an import asks "(A) Override your current library. (B) Merge with your current library." (L11646-11659). A non-array import alerts "Invalid format: Rivens must be an array.".

### 1.3 In share links

The v3 share format keeps a riven as an object (L1214-1234, L1267-1283): `{ rv: 1, n: name, f: family, id?, d?: disposition, r?: rank, s?: [{ n, v, u }] }`. The long-key map has `isRiven: 'rv'`, `family: 'f'`, `stats: 's'`, `value: 'v'`, `unit: 'u'` (L921-926). This app has no share links; the key names matter only if links are ever imported.

## 2. Stats and value scaling

### 2.1 The catalogue (`data.riven_stats`)

Gun types (values are the base strings as stored in the data; `%` values are divided by 100):

| Stat key | Rifle | Shotgun | Pistol | Display label |
| --- | --- | --- | --- | --- |
| BaseDamage | 165% | 164.7% | 219.6% | Damage |
| Critical Chance | 149.99% | 90% | 149.99% | Critical Chance |
| Critical Damage | 120% | 90% | 90% | Critical Damage |
| Multishot | 90% | 119.7% | 119.7% | Multishot |
| Fire Rate/Attack Speed | 60.03% | 90% | 74.7% | Fire Rate/Attack Speed |
| Status Chance | 90% | 90% | 90% | Status Chance |
| Status Duration | 99.99% | 99.99% | 99.99% | Status Duration |
| Status Damage (spliced) | 90% | 90% | 90% | Status Damage |
| HeatDamage, ColdDamage, ElectricityDamage, ToxinDamage | 90% | 90% | 90% | Heat Damage, ... |
| Viral/Corrosive/Magnetic/Radiation/Gas/BlastDamage (spliced) | 90% | 90% | 90% | Viral Damage, ... |
| ImpactDamage, PunctureDamage, SlashDamage | 119.97% | 119.97% | 119.97% | Impact Damage, ... |
| Damage vs.Grineer / Corpus / Infested | 45% | 45% | 45% | Damage vs. Grineer, ... |
| Damage vs.Orokin / Techrot / Scaldra (spliced) | 45% | 45% | 45% | Damage vs. Orokin, ... |
| Weak Point Damage (spliced) | 225% | 225% | 225% | Weak Point Damage |
| Weak Point Critical Chance (spliced) | 247.5% | 247.5% | 247.5% | Weak Point Critical Chance |
| Ammo Efficiency (spliced) | 45% | 45% | 45% | Ammo Efficiency |
| Magazine Reload While Holstered (spliced) | 90% | 90% | 90% | Magazine Reload While Holstered |
| Magazine Capacity | 50% | 50% | 50% | Magazine Capacity |
| Reload Speed | 50% | 50% | 50% | Reload Speed |
| Ammo Maximum | 49.95% | 90% | 90% | Ammo Maximum |
| Punch Through | 2.7m | 2.7m | 2.7m | Punch Through |
| Projectile Speed | 90% | 90% | 90% | Projectile Speed |
| Recoil | 90% | 90% | 90% | Recoil |
| Zoom | 59.99% | 41.99% | 80.1% | Zoom |

Display labels come from one rule (L599-608): `BaseDamage` reads "Damage"; otherwise "vs." gains a space, a lower-to-upper case change gains a space (`ToxinDamage` -> "Toxin Damage") and the melee key "Critical ChanceonSlide Attack" reads "Critical Chance on Slide Attack".

"Spliced" stats (L408-414) are the 18 keys Viral/Corrosive/Magnetic/Radiation/Gas/BlastDamage, Damage vs.Orokin/Techrot/Scaldra, Status Damage, Weak Point Damage, Weak Point Critical Chance, Ammo Efficiency, Magazine Reload While Holstered, Heavy Attack Damage, Heavy Attack Windup Speed, Parry Angle and Slam Damage. The editor marks them "(spliced)" in the stat list.

### 2.2 Disposition and rank

- `RIVEN_MAX_RANK = 8`, `RIVEN_DEFAULT_DISPOSITION = 1.2` (L443-444).
- The site has **no per-weapon disposition**: the weapon lookup always returns 1.2 (L452-454), and neither the weapon data nor `riven_stats` carries one. The user types the disposition (the in-game "dots" value, e.g. 0.5-1.55) into the editor.
- Disposition is read leniently (a number or numeric string, finite, >= 0; L446-450). The editor rejects 0 and below on save (L31949-31953).
- Rank multiplier: `(rank + 1) / 9` (L463-465): 1 at rank 8, 1/9 at rank 0. Ranks outside 0-8 or non-integers fall back to 8 (L456-461).
- **Effective value** = `stored x disposition x (rank + 1) / 9` (L473-477). The slot card, the editor and every modifier path use it.

### 2.3 Stat-count multipliers and the roll range

The roll multiplier depends on how many positive and negative stats the riven has (L50037-50042):

| Positives_negatives | Positive x | Negative x |
| --- | --- | --- |
| 2_0 | 0.99 | (none) |
| 2_1 | 1.2375 | -0.495 |
| 3_0 | 0.75 | (none) |
| 3_1 | 0.9375 | -0.75 |

Any other count (1 positive, 4 positives, 2 negatives) has no range (the value field hides).

Range guide for one row (L17637-17667): `mid = base x disposition x (rank + 1) / 9 x multiplier`; `min = mid x 0.9`, `max = mid x 1.1` for a positive row; for a negative row (mid < 0) min is `mid x 1.1` and max `mid x 0.9`.

Worked numbers (Rifle, disposition 1.2, rank 8):

| Riven | Stat | Range shown |
| --- | --- | --- |
| 2 positives + 1 negative | Critical Chance | +200.46% to +245.01% (mid 222.74%) |
| 2 + 1 | Multishot | +120.29% to +147.02% |
| 2 + 1 | Zoom (negative) | -32.07% to -39.20% |
| 3 + 1 | Critical Chance | +151.86% to +185.61% |
| 3 + 0 | Damage | +133.65% to +163.35% |
| 3 + 1 | Damage vs. Grineer | x1.51 (0.50625) |
| 2 + 1 | Punch Through | 4.01 m |

The range is a guide, not a limit. Typing a value outside it widens the slider (L17583-17593); only the sign is enforced (a positive row refuses a negative value and vice versa, L17587). On save nothing re-checks the range.

When the stat count changes, rows keep their current value (only a row whose stat was just changed is reset to the mid of its new range, L17615-17635). When disposition or rank changes, every row's value is rescaled by `new factor / old factor`, so the stored roll stays the same (L17441-17449). The editor stores `slider value / (disposition x (rank + 1) / 9)` (L31987), so the stored value is disposition- and rank-free.

The trusted builds' rivens confirm the convention: Magistar's stored Melee Damage 2.2418 is 164.7% x 1.2375 x 1.1 (a near-max 2+1 roll) and is shown at x1.2.

### 2.4 Display

- Percent stats show `value x 100` with a sign and one decimal: "+222.7%" (L527-533). The editor field shows two decimals (four, trailing zeros trimmed, when editing an existing riven, L17507-17508).
- "Damage vs." stats show as a multiplier `x(1 + value)` with at least two decimals: "x1.51" (L507-508). Typing in that field means typing the multiplier (L522-525).
- Recoil is shown negated: a positive (good) recoil roll reads "-35.6%" Recoil (L488-495).
- Metres show "m", seconds "s", Initial Combo has no unit; Parry Angle hides its unit (L507-515). The input's accessible description is "Damage multiplier", "Percent", "Meters", "Seconds" or "In-game value" (L539).
- Slot card: the name line, then one line per stat, "+222.7% Critical Chance" (L15288-15294), with the font shrinking for long text (L15298-15310). The mod list's library entry reads "<weapon> Riven" over a short summary of the first three letters of each label with its sign, "Cri+, Mul+, Zoo-" (L17194-17198).

## 3. How riven stats become weapon modifiers

`calculateWeaponStats` handles a riven slot in place of the mod-table lookup (L28914-29006), at the riven's slot position. For each stat, in **reverse** stat order (L28918), with the effective value `v` (2.2):

1. **Elements** (L28923-28947): a stat whose key contains Cold, Electricity, Heat, Toxin, Viral, Corrosive, Magnetic, Radiation, Gas or Blast adds `[element, v]` to the elemental list, at the slot's place in slot order (the same list the normal mods' elements go to). Because of the reversal, a riven's later stat combines before its earlier one.
2. **Physical** (L28949-28961): ImpactDamage, PunctureDamage, SlashDamage add `v` to that physical bucket (x6 under the Coda Motovore passive, a melee case).
3. **Spliced utility** (L425-441, L28966): Weak Point Damage -> `weakPointDamage`; Weak Point Critical Chance -> `weakPointCritChance`; Ammo Efficiency -> `rivenAmmoEfficiency`, added to the additive ammo efficiency before the 75% cap (L29293); Magazine Reload While Holstered -> `holsteredReload`; Status Damage -> `rivenStatusDamage`; the melee ones to their own keys. `holsteredReload` and `rivenStatusDamage` have **no reader** in the JS: they change nothing there. Status Damage still counts, through the engine (3.1).
4. Then the first name match wins (L28968-29003): "Critical Chance on Slide Attack" -> slide crit (melee); contains "critical chance" -> `critChance`; "critical damage" -> `critDamage`; "damage vs" -> faction (below); any other "damage" (`BaseDamage`, and melee "FinisherDamage", "Melee Damage") -> `damage`; "multishot" -> `multishot` (on the Arbucep, its final-multishot bonus instead); "fire rate" or "attack speed" -> `fireRate`; "status chance" -> `statusChance`; "status duration" -> `statusDuration`; "punch through" -> `punchThrough` (metres); "magazine" -> `magazine`; "reload" -> `reload`; "zoom" -> `zoom`; "recoil" -> `recoil -= v`; projectile speed -> `projectileSpeed`; "blast radius" -> `blastRadius`; "range" -> `range`. Anything else (Ammo Maximum, Combo Duration, Initial Combo, ...) is ignored here.
5. **Faction** (L28979-28984, L2324-2340): the value goes to `factionDamageByFaction[f]` for every enemy faction `f` whose bane key the stat key contains (lower case, spaces removed). Keys: Grineer and Kuva Grineer -> `grineer`; Corpus and Corpus Amalgam -> `corpus`; Infested and Infested Deimos -> `infested`; Orokin and Corrupted -> `orokin`; Techrot -> `techrot`; Scaldra -> `scaldra`; The Murmur -> `murmur` (no riven stat). It reaches `weaponStats.factionDamageByFaction` (L30529). For the simulated target this is the same as adding to `factionDamage` **(probed)**. Unlike Bane mods, Techrot and Scaldra rivens do count.

Projectile speed and blast radius from a riven also feed the site's projectile-speed helper (L7894-7909, and the worker copy at L34397-34408).

### 3.1 The engine reads rivens too

Before every engine call the site copies the build's mods and replaces each riven's stat values with the effective ones (L33519-33546), so the engine gets `{ isRiven: true, name, family, stats: [{ name, value: effective, unit }], ... }` inside `build.mods`, in slot order with empty slots removed. The engine recognises `isRiven` and these stat keys (it also reads normal mods from `build.mods`; dropping Serration from `build.mods` alone lowers Braton Prime DPS by 18% **(probed)**). With `weaponStats` unchanged, a riven in `build.mods` changed DPS, never the first hit, for **(probed)**:

- `BaseDamage` (DoT and status damage scale with it): +22.1% at 2.0, -5.5% at -0.5;
- `Status Damage`: +29.3% at 1.0, the same as `weaponStats.statusDamageBonus = 1`;
- an element the weapon already deals (`ToxinDamage` with Infected Clip): +12.2% at 1.0.

Critical Chance, Multishot, Status Chance, Fire Rate, Damage vs., Weak Point Damage, Ammo Efficiency, Magazine and Recoil changed nothing from `build.mods`: they act only through `weaponStats`. So a port must do both: fold the riven into the buckets **and** send the scaled riven in `build.mods`. A whole riven on Braton Prime (section 10) gives 10,207 DPS from the buckets alone and 11,508 with the riven also in `build.mods`.

## 4. Polarity, drain and capacity

- Drain is `10 + rank` (L7633): 18 at rank 8, 10 at rank 0.
- The site gives every riven polarity `AP_OMNI` (L7660-7661). In a polarised slot other than Umbra it matches: `ceil(drain / 2)` (9 at rank 8). In an Umbra slot it is neutral (18). In an unpolarised slot it is neutral (18). It never mismatches. (In the game a riven has one fixed polarity; the site does not model it.)
- This app's `slotDrain()` already gives exactly these numbers for a mod with `Base Drain` 10 and `Polarity` `AP_ANY` (`normalizePolarity('AP_OMNI')` is `AP_ANY`).

## 5. Weapon compatibility

- **Riven type** (L368-382): none for an exalted or pseudo-exalted weapon, a weapon with `hasRiven === false` or `supports_rivens === false`, and Garuda Talons, Garuda Prime Talons, Sirocco and Arquebex. Otherwise Primary/Secondary become Rifle, Shotgun (primary `subtype === 'Shotgun'`) or Pistol (every secondary, including shotgun secondaries, and modular primaries); other types keep their type (`Melee`, `Archgun`). In this data no weapon has `hasRiven` or `supports_rivens`; the gun exclusions that matter are Artemis Bow, Balefire Charger, Dex Pixia, Glory, Regulators, Neutralizer, Lizzie and Noctua (exalted or pseudo-exalted), and Sirocco.
- **Family** (L31919-31930): `MK1-` and the variant prefixes (Kuva, Tenet, Coda, Dex, Prisma, Carmine, Mara, Ceti, Synoid, Secura, Rakta, Sancti, Telos, Vaykor) and suffixes (Prime, Vandal, Wraith, Dex, Umbra, Prisma, Carmine) are stripped: Kuva Sobek and Sobek share "Sobek". Exceptions: Dex Furis -> "Afuris"; Pangolin, Pangolin Prime -> "Pangolin Sword". This app's `weaponFamily()` (src/shared/mods.js) is the same rule without the two exceptions.
- **Offering** (L17182-17217): the mod list shows the riven entries (library rivens whose family matches, then a "Riven Mod" item that opens the editor) only when the weapon has a riven type, the build is not an operator/companion/Warframe build, no riven is equipped in **another** slot, and the slot is not Aura, Stance or **Exilus**. One riven per build follows from this.
- Equipping a riven on an operator weapon alerts "Rivens are not supported for Operator Weapons." (L31546-31549).
- A saved riven is not re-checked against the weapon: its `family` is fixed at save; switching weapons is a build-level concern (the site keeps the slot).

## 6. Limits and validation

Editor rules (L17692-17705) and save checks (L31932-32012), in order:

| Rule | Where | Message (alert on the site) |
| --- | --- | --- |
| Disposition is a number > 0 | save | "Weapon disposition must be a number greater than 0." (focus moves to it) |
| Rank is a whole number 0-8 | save | "Riven rank must be a whole number from 0 to 8." (focus moves to it) |
| At most 3 positive rows | Add positive disabled at 3 | |
| At most 1 negative row | Add negative disabled at 1 | |
| Negative rows cannot take Punch Through, any element (base or combined) or a spliced stat | negative stat list (L17534-17537, L479-486) | |
| At most one spliced stat, positive | other spliced options disabled while one is chosen; checked on save | "A Riven can have only one spliced trait, and it must be positive." |
| At least 2 positive stats | save | "A Riven mod must have at least 2 positive stats." |
| Each stat once | save | "Each Riven stat must be unique." |
| Rows with no stat chosen | save | silently dropped |
| Value sign matches the row | value input | reverts to the slider value |

A row's polarity (positive/negative) is the row it was added as; when an existing riven is opened, a stat with `value >= 0` becomes a positive row (L17481-17483).

## 7. Trusted (featured) builds

- 4 of the 252 trusted builds carry a riven, all **melee** (Ceramic Dagger "Praedos Killer", "Magistar (Riven)", "Nami Solo (Riven)", "Nami Solo (Volt + Riven)"). None is a gun, so no featured build in this app has a riven today.
- Their riven slots have exactly `{ family, id, isRiven, name, stats }`: no `disposition`, no `rank` (so x1.2, rank 8). `stats[].unit` is set.
- This app's `unappliedFeatures()` reports `'rivens'` for any mod whose name matches `/riven/i`. Once rivens are ported, a gun featured build's riven can be applied by `normalizeBuild()` and the flag dropped (keep it for a riven that fails validation).

## 8. What the site's UI offers

- **Mod list, riven-capable slot**: the library rivens of this family ("<weapon> Riven", "Cri+, Mul+, Zoo-"), then "Riven Mod" (accessible name "Create Riven Mod"), all keyboard-activatable (L17190-17217).
- **Riven editor** (`#riven-stat-modal`), "Create" title by default, "Edit Riven Mod" when editing (L17466-17471), "Review <label>" with a "Confirm" button and the screenshot preview after an OCR import (L48517-48576):
  - Disposition input (prefilled 1.2), Rank input (prefilled 8); changing either rescales the rows when both are valid (L46636-46648).
  - Starts with two empty positive rows (L17461-17462). Each row: "Positive:" / "Negative:" label, a stat select ("-- Select a Stat --", sorted keys with display labels, "(spliced)" marks), a slider plus a text input with its unit, and an "X" remove button ("Remove Positive Critical Chance"). Accessible names: "Positive Riven stat", "Positive Critical Chance value slider", "Positive Critical Chance value" (L17540, L17565-17571).
  - "Add positive stat", "Add negative stat", Save, Cancel. Escape cancels; Tab is trapped in the dialog; focus starts on the Disposition input and returns to the opener (L12548-12600).
- **Active riven slot**: in the mod picker, "Add to Library" / "Remove from Library" and "Edit Riven" buttons (L17059-17087).
- **Tools** (section 9): Import riven from image, paste-import, left/right import and compare, "Slot My Riven" and "Auto Riven".

## 9. Site features left for later

All four are ported now: see section 13.

- **OCR import** (L49270-49345, L49881-50560): reads a riven screenshot, matches labels to stat keys with an alias table (L49958-50035), stores `observed / disposition` (it assumes rank 8, L50277-50278), fixes signs by position and by a feasibility check (ratio 0.6-1.4 of the expected mid, or within max(0.05, 20%), L50170-50199), adds the riven to the library and slots it in the first empty slot. This app's screenshot import already recognises riven slots and leaves them empty with "Riven: not supported"; a later step could open the riven editor for such a slot.
- **Left/right compare** (L49655-49880): two rivens from one image, each reviewed, then every free slot is tried with each and the DPS compared.
- **Slot My Riven** (L40973-41253): tries each library riven of the family in each non-special slot; asks before changing the elemental combo.
- **Auto Riven** (L42008-42640): builds theoretical 2+1 / 3+1 rivens at a chosen roll (default 1.1 of mid, 0.9-1.1; L319-322, L41941-42006) for every stat combination and keeps the best. Auto Build itself always blacklists "Riven Mod" (L44245, L45467), as this app's does.

## 10. Probe results (Braton Prime vs Grineer level 1, 1e6 HP, 0 armor, 20 s, seed 11)

Mods: Serration 10, Split Chamber 5, Point Strike 5, Infected Clip 5 (5,252 DPS, first hit 179.7). Riven stats sent only in `build.mods` (`weaponStats` unchanged), value as the effective fraction:

| Riven stat in `build.mods` | DPS change | First hit |
| --- | --- | --- |
| BaseDamage 2.0 / 1.0 / -0.5 | +22.1% / +11.1% / -5.5% | unchanged |
| Status Damage 1.0 / 0.5 | +29.3% / +14.7% | unchanged |
| ToxinDamage 1.0 | +12.2% | unchanged |
| HeatDamage, ColdDamage, ElectricityDamage, Corrosive, Viral, Gas, Slash, Puncture, Impact 1.0 | 0 | unchanged |
| Critical Chance, Critical Damage, Multishot, Status Chance, Status Duration, Fire Rate, Damage vs.Grineer/Corpus, Ammo Efficiency, Weak Point Damage, Magazine, Recoil | 0 | unchanged |
| the same object without `isRiven` | 0 | unchanged |
| `weaponStats.statusDamageBonus = 1` (no riven) | +29.3% | unchanged |
| `weaponStats.factionDamage 0.45` vs `factionDamageByFaction { Grineer: 0.45 }` | +64.1% both | +45% both |

Whole riven, stored `[Critical Chance 1.0, BaseDamage 1.0, Damage vs.Grineer 0.3, Zoom -0.4]` at x1.2 (Point Strike removed): no riven 4,959; buckets only 10,207 (first hit 355.07); buckets **and** `build.mods` (the site's way) 11,508; `build.mods` only 5,650. The probe scripts are in the scratchpad (`rivens/probe*.mjs`); they are not part of the repo.

## 11. Port plan for this app

### 11.1 Data shape (this app)

A riven slot in `build.mods[i]` keeps the site's shape, so featured builds and any future site import need no translation:

```
{ isRiven: true, id, name: "<family> Riven Mod", family, disposition: 1.2, rank: 8,
  stats: [{ name: "<riven_stats key>", value: <stored fraction or metres>, unit: "%" | "m" | "" }] }
```

The app always writes `disposition` and `rank` (defaults 1.2 and 8) so a saved riven never depends on a default. The riven library is `{ version: 1, rivens: Riven[] }` in `rivens.json` in userData (one library per user, like `buff-presets.json`).

### 11.2 New files

- **`src/shared/rivens.js`** (pure, all riven logic):
  - constants: `RIVEN_MAX_RANK = 8`, `RIVEN_DEFAULT_DISPOSITION = 1.2`, `RIVEN_BASE_DRAIN = 10`, the spliced set, the negative exclusions, the stat-count multipliers, the roll band 0.9-1.1;
  - `rivenTypeOf(weapon)` -> `'Rifle' | 'Shotgun' | 'Pistol' | null` (5);
  - `rivenFamily(weaponName)`: `weaponFamily()` plus the two exceptions;
  - `canTakeRiven(weapon)`;
  - `rivenStatCatalogue(data, weapon)` -> `[{ key, label, unit, base, spliced, negativeAllowed }]` parsed from `riven_stats` (`"149.99%"` -> base 1.4999, unit `%`; `"2.7m"` -> 2.7, `m`);
  - `rankMultiplier(rank)`, `effectiveValue(stat, riven)`;
  - `statRange(entry, { positive, positives, negatives, disposition, rank })` -> `{ min, mid, max }` in effective units, or null for an unsupported count;
  - `toStored(effective, riven)` / display helpers `rivenStatText(stat, riven)` ("+222.7% Critical Chance", "×1.51 Damage vs. Grineer", "−35.6% Recoil"), `rivenStatLabel(key)`, and the input conversion for "Damage vs." multipliers and Recoil;
  - `validateRiven(riven, data, weapon)` -> `{ ok, errors: [{ field, message }] }` with the site's rules and messages (6), plus "Pick a stat" for an empty row the user has touched;
  - `normalizeRiven(raw)` (clean, clamp rank, default disposition, drop unknown keys) used by the model and the store;
  - `addRivenModifiers(m, riven, targetFaction)`: section 3 into this app's buckets (below);
  - `rivenForEngine(riven)`: the scaled copy of 3.1 (`{ isRiven: true, id, name, family, disposition, rank, stats: [{ name, value: effective, unit }] }`);
  - `RIVEN_CAPACITY_MOD = { 'Base Drain': 10, Polarity: 'AP_ANY' }` for capacity.
- **`src/main/rivens-store.js`**: the library file, written atomically and validated on read like `buff-presets-store.js`; IPC `rivens:list` / `rivens:save` in `preload.cjs` and `main.js`.
- **`src/renderer/ui/RivenDialog.jsx`**: the editor (11.5).
- **`test/rivens.test.js`** (11.6).

### 11.3 Bucket mapping in this app (`addRivenModifiers`)

Walk the stats in reverse order with the effective value `v`:

| Riven stat | This app's bucket in `collectModifiers()` |
| --- | --- |
| Heat/Cold/Electricity/ToxinDamage, Viral/Corrosive/Magnetic/Radiation/Gas/BlastDamage | `m.elements.push([element, v])` at the riven's slot position |
| Impact/Puncture/SlashDamage | `m.physical[type] += v` |
| BaseDamage | `m.damage` |
| Critical Chance / Critical Damage | `m.critChance` / `m.critDamage` |
| Multishot | `m.multishot` |
| Fire Rate/Attack Speed | `m.fireRate` (the bow doubling in `computeFireMode` applies, as for mods) |
| Status Chance / Status Duration | `m.statusChance` / `m.statusDuration` |
| Damage vs.X | `m.factionDamage` when X is the target's riven faction: Grineer, Kuva Grineer -> Grineer; Corpus, Corpus Amalgam -> Corpus; Infested, Infested Deimos -> Infested; Orokin -> Orokin; Techrot -> Techrot; Scaldra -> Scaldra (not `resolveFaction().bane`, which is null for Techrot and Scaldra) |
| Weak Point Damage / Weak Point Critical Chance | `m.weakPointDamage` / `m.weakPointCritChance` |
| Ammo Efficiency | `m.ammoEfficiency` (the 75% cap in `ammoConsumptionOf` applies) |
| Magazine Capacity / Reload Speed / Punch Through | `m.magazine` / `m.reload` / `m.punchThrough` (metres) |
| Status Damage | **not** `m.statusDamage`: the engine applies it from `build.mods` (3.1); adding it here too would count it twice |
| Zoom, Recoil, Projectile Speed, Ammo Maximum, Magazine Reload While Holstered | no bucket; reported as not simulated (11.5) |

Fire rate and multishot locks (Semi-Cannonade, Acuity) hold against the riven too, as they hold against every source in `computeFireMode`.

### 11.4 Hooks into existing files

Each is one small `Edit`, not a rewrite. `stats.js` and `engine-input.js` are being rewritten by the lead; coordinate before touching them.

1. `src/shared/stats.js` `collectModifiers()`: at the top of the slot loop, `if (slot?.isRiven) { addRivenModifiers(m, slot, targetFaction); continue; }` plus the import. It must sit inside the loop so the riven's elements keep their slot position. Auto Build, the best-mod sweep and the Readout all go through here.
2. `src/shared/engine-input.js` `buildEngineInput()`: `build.mods` maps a riven slot to `rivenForEngine(slot)` instead of `{ name, rank }`.
3. `src/shared/capacity.js` `capacityUse()`: `const mod = s.isRiven ? RIVEN_CAPACITY_MOD : modByName(s.name)` (rank is the riven's rank). The Forma planner and the slot drain plates then work unchanged.
4. `src/main/builds-store.js` `cleanMod()`: a riven slot goes through a riven cleaner (the same rules as `normalizeRiven`, kept local because the main process does not import renderer code; the shared module is pure and may be imported there too): `id`, `name`, `family` strings, `disposition` finite > 0 else 1.2, `rank` integer 0-8 else 8, up to 4 stats with string `name`, finite `value`, `unit` in `%`, `m`, `s`, `''`.
5. `src/renderer/model.js`:
   - `normalizeSlot()`: a riven slot is kept when the weapon can take rivens, its family matches `rivenFamily(weapon.name)` and it validates; otherwise "Removed: Braton Riven Mod (does not fit Lex Prime)". `normalizeBuild()` keeps the first riven and drops a second ("(only one riven per build)") and drops a riven in the Exilus slot.
   - `changeWeapon()`: drops a riven whose family differs, listed in `removed`.
   - `fitsSlot()` / `swapSlots()` / `slotBlockReason()`: a riven never goes to the Exilus slot ("Rivens cannot go in the Exilus slot").
   - `conflictingMod()` callers pass names; a riven's name is unique per family, so two rivens already conflict as "Already in slot N"; keep that.
   - `unappliedFeatures()`: drop `'rivens'` for rivens that normalise; `buildFromFeatured()`'s note stops saying rivens are not applied.
   - `pinChanges()`: compare rivens by `id` and content; a changed riven reads "Braton Riven Mod edited", a new one "+Braton Riven Mod".
   - `modCandidates()` is unchanged (rivens are not in `data.mods`); the Picker adds the riven entries itself.
6. `src/shared/auto-build.js`: nothing to change for a kept riven slot (it is a slot like any other and goes through hooks 1-3); rivens stay excluded as candidates (`RIVEN_NAME`). A riven slot the user unticks in Keep is replaced like any mod.
7. `src/renderer/ui/links.js` `WHATS_SIMULATED` and `Dialogs.jsx`: drop "rivens" from the "Not yet" list.

### 11.5 UI (docs/declutter-spec.md, docs/arsenal-spec.md)

No control is added at rest (the Loadout stays under the cap of 40).

- **Entry point: the Picker.** While picking a general slot (not Exilus) on a weapon that can take rivens, and no riven is equipped in another slot, the card grid starts with a **Riven** card (Riven frame from `card-assets.js`, "Create a riven…"), followed by the library rivens of this family (name, stat lines). The search matches "riven" and the stat labels. Activating the Riven card opens the Riven dialog for that slot; activating a library riven equips a copy. With a riven elsewhere, the Riven card is shown disabled with "Only one riven per build (slot 3)", like the other blocked cards. The details flyout (Alt+Enter) on a library riven offers Edit… and Remove from library….
- **Riven slot card** (`SlotCard.jsx`): the family name and up to four stat lines ("+222.7% Critical Chance", the negative in the neutral negative style, never red-only), the rank as "R8" next to the drain plate (drain 18 / 9 as computed), the Riven frame. Accessible name: "Slot 3: Braton Riven, rank 8 of 8, drain 9, matches polarity: +222.7% Critical Chance, +133.7% Multishot, −35.6% Zoom". Enter opens the dialog; + / − / Home / End change the riven's rank (0-8) as for mods; the slot menu gains **Edit riven…** and **Save to library** / **Remove from library**; Change mod and Remove stay. Stats this app does not simulate get the existing partial-simulation glyph, with "Zoom is not simulated".
- **Riven dialog** (a Fluent `Dialog`, about 640 px, content scrolls inside and is the only scroller; title "New riven · Braton" or "Edit riven · Braton"; the ⓘ explains disposition and that values are what the riven shows in game):
  - **Disposition**: a `SpinButton`, step 0.05, min 0.05, default 1.2 (or the riven's), hint "The weapon's riven disposition (1.2 if unsure)". **Rank**: a `Dropdown` 0-8, default 8.
  - **Positive stats** (2 rows to start) and **Negative stat** (none to start): each row a `Combobox` of the stat catalogue (labels, "spliced" as a secondary line, negatives filtered; options that break the one-spliced rule disabled with the reason), a number `Input` with the unit as `contentAfter` ("%", "m", "×" for Damage vs.) and the range hint under it ("In game: 200.5 – 245.0%" for the current count, disposition and rank), and a Remove button (24 px or more, accessible name "Remove positive Critical Chance"). "Add positive stat" (disabled at 3 with "A riven has at most 3 positive stats") and "Add negative stat" (disabled at 1). A value outside the range is accepted with a neutral note "Outside the usual roll range"; a wrong sign is an inline error.
  - Changing disposition or rank keeps the typed values as typed (they are what the game shows) and recomputes the stored roll; this differs from the site, which keeps the stored roll and moves the shown value. Say so in the ⓘ. (Alternative: follow the site exactly; pick one and test it.)
  - Live preview: the slot card face, and the footer's DPS line "Average DPS 8,995 → 14,210 ▲ 58%" as in the External buffs dialog.
  - Validation is inline (Fluent `Field` validation and one `MessageBar` for riven-wide rules), with the site's wording (6). Save stays enabled; pressing it with errors moves focus to the first one.
  - Footer: **Save** (equips into the slot; one undo step; re-simulates), a **Also save to library** checkbox (on by default for a new riven), Cancel. Focus starts on Disposition for a new riven and on the first stat for an edit; Escape cancels; focus returns to the slot.
- **Library**: no separate screen in the first port. The Picker lists the family's rivens; the flyout and the slot menu add, update (by `id`) and remove them, removal with an Undo toast.

### 11.6 Tests (`test/rivens.test.js`, plus additions)

- `rivenTypeOf`: Braton Prime -> Rifle, Kuva Sobek -> Shotgun, Lex Prime -> Pistol, a shotgun secondary -> Pistol, Catchmoon (Primary) -> Pistol, Artemis Bow / Balefire Charger / Sirocco -> null.
- `rivenFamily`: Kuva Sobek -> Sobek, MK1-Braton -> Braton, Dex Furis -> Afuris, Braton Prime -> Braton.
- Scaling: rank multiplier 1 at 8 and 1/9 at 0; effective = stored x 1.2 by default; a riven without `disposition`/`rank` scales x1.2.
- `statRange`: the worked numbers in 2.3 (Rifle 2+1 Critical Chance 200.46-245.01%, Zoom -32.07 to -39.20%, 3+1 Damage vs. Grineer mid 0.50625); null for 1 positive or 4 positives.
- Display: "+222.7% Critical Chance", "×1.51 Damage vs. Grineer", Recoil negated, "4.0 m Punch Through", BaseDamage reads "Damage".
- `validateRiven`: each message in 6, the negative exclusions, two spliced stats, a negative spliced stat, duplicate names, disposition 0, rank 9.
- `addRivenModifiers`: each bucket of 11.3; faction only for the target (Kuva Grineer target takes Damage vs.Grineer, Techrot takes Damage vs.Techrot, Narmer takes none); elements in reverse stat order and at the slot position (a riven Heat before a Toxin mod gives Gas in slot order); Status Damage, Zoom, Recoil leave every bucket unchanged.
- `rivenForEngine`: values scaled, `isRiven` kept, the input object untouched.
- Capacity: drain 9 in a Madurai slot at rank 8, 18 unpolarised, 18 Umbra, 5 in a polarised slot at rank 0.
- `builds-store`: a riven slot round-trips; junk fields are dropped; out-of-range rank becomes 8.
- `model`: `normalizeBuild` keeps a matching riven, drops a wrong-family one with a warning, drops a second riven and an Exilus riven; `changeWeapon` drops it across families and keeps it across variants (Braton -> Braton Prime); `swapSlots` refuses the Exilus slot; `pinChanges` reports an edit.
- Engine (skipped without `core/`): the section 10 parity case (a riven raises DPS over the buckets alone when it is also in `build.mods`); a Status Damage riven equals `statusDamageBonus` at the same value and is not counted twice.
- `parity.test.js`: if the parity fixtures ever include a site build with a riven, compare its stats; until then the engine test above covers it.
- UI smoke (the lead runs it): open the Picker on slot 3, activate the Riven card, pick Critical Chance and Multishot, Save: the slot shows the riven, DPS rises, the capacity counts 9; Ctrl+Z removes it; the dialog has no target under 24x24 and one scroller.

## 12. Port (what was built, 2026-10-25)

### 12.1 Files

New:

- `src/shared/rivens.js`: all riven logic, pure. Weapon fit (`rivenTypeOf`, `rivenFamily`, `canTakeRiven`, `rivenFitsWeapon`), the stat catalogue from `data.riven_stats`, scaling (`rivenRank`, `rivenDisposition`, `effectiveValue`, `toStored`), `statRange`, display (`rivenStatLabel`, `formatEffective`, `rivenStatText`, `rivenSummary`, `displayNumber` / `fromDisplayNumber`), `normalizeRiven`, `validateRiven` (the site's rules and messages, `RIVEN_MESSAGES`), `rivenSlotFor` (a slot for a weapon, or the "Removed: ..." reason), `rivenSlotBlockReason` (Exilus, one riven per build), `addRivenModifiers` (11.3), `rivenForEngine` (3.1), `RIVEN_CAPACITY_MOD`, and the library helpers (`normalizeRivenLibrary`, `upsertLibraryRiven`, `removeLibraryRiven`, `libraryRivensFor`).
- `src/main/rivens-store.js`: `rivens.json` in userData (`{ version: 1, rivens }`, atomic write, cleaned on read) and `cleanRiven`, the main process's copy of `normalizeRiven` (the packaged app ships `src/main` only; a test checks both agree).
- `src/renderer/riven-draft.js`: the dialog's working copy, pure: typed in-game values to stored rolls, per-row and riven-wide issues, the range hint.
- `src/renderer/ui/RivenDialog.jsx`: the editor (Fluent `Dialog`).
- `src/renderer/ui/RivenPickerRow.jsx`: the Picker's riven row.
- `test/rivens.test.js`: 21 tests (11.6), the engine ones skip without `core/`.

One small edit each in: `src/shared/stats.js` (`collectModifiers()`: a riven slot goes to `addRivenModifiers` at its slot position), `src/shared/engine-input.js` (`build.mods` maps a riven to `rivenForEngine`), `src/shared/capacity.js` (`capacityUse` drains a riven as `RIVEN_CAPACITY_MOD`), `src/shared/auto-build.js` (`capacityPlan` drains a kept riven the same way), `src/main/builds-store.js` (`cleanMod` keeps a riven via `cleanRiven`), `src/renderer/dnd.js` (a riven dragged between slots), `src/renderer/ui/Readout.jsx` (a riven is not "engine-only"), `src/renderer/ui/Picker.jsx` (mounts the riven row), `src/renderer/ui/App.jsx` (mounts the dialog). IPC `uf:rivens:get` / `uf:rivens:set` in `main.js`, `preload.cjs` and the dev fallback in `platform.js`. `links.js` and `Dialogs.jsx` no longer list rivens as not simulated.

In `src/renderer/model.js`: `normalizeSlot` (riven branch), `normalizeBuild` (one riven, never Exilus), `changeWeapon` (kept across variants of the family), `unappliedFeatures` and the featured note (rivens are applied), `makePin` (the riven's rolls kept in the pin) and `pinChanges` ("Braton Riven Mod edited"). In `src/renderer/controller.js`: the `rivenDialog` and `rivenLibrary` state, the library load at boot (not in smoke or scene runs), `setRank` (0-8 for a riven), and the actions `openRivenDialog`, `closeRivenDialog`, `saveRiven`, `equipLibraryRiven`, `saveRivenToLibrary`, `removeLibraryRiven`. `src/renderer/ui/SlotCard.jsx`: a riven slot is a text card ("Braton Riven" and as many stat lines as fit, Riven frame, Omni drain plate, R0-8 with − / + and the keys), and the slot menu gains Edit riven…, Save to / Remove from your rivens, and New riven… on other general slots.

### 12.2 Decisions

- **Shape**: the site's slot object, unchanged; the app always writes `disposition` and `rank`. Featured and imported rivens without them read as 1.2 and 8.
- **Both paths**, as on the site and checked by the engine tests: buckets via `collectModifiers()` and the scaled copy in `build.mods`. Status Damage is left to the engine (counting it in `m.statusDamage` too would double it: a test compares it with `statusDamageBonus`).
- **Buckets** follow 11.3, plus Projectile Speed to `m.projectileSpeed` (the site applies it; this app has the bucket). Zoom, Recoil, Ammo Maximum and Magazine Reload While Holstered go to `m.unhandled` ("Braton Riven Mod: Zoom"), so the slot's honesty glyph and the Readout's line say they are not simulated.
- **Damage vs.** counts only against the target's own riven faction (Kuva Grineer takes Grineer; Techrot and Scaldra count, unlike Bane mods; Narmer and Sentients take none). As with mods, a null target resolves to Grineer.
- **Typed values are the in-game values**: changing disposition or rank in the dialog keeps what was typed and recomputes the stored roll (the alternative in 11.5; tested). Editing without changes gives back the exact stored rolls (no drift from rounding).
- **Validation**: the site's rules and messages; a wrong sign or text without a stat shows at once, the rest after Save, which moves focus to the first problem. A value outside the usual range is a neutral note (the range is a guide, as on the site).
- **Entry points**, all keyboard reachable: the Picker's riven row ("New riven…" / "Edit riven…" and the family's library rivens, shown while picking for a general slot of a riven-capable gun; hidden by a search that is not about rivens) and the slot menu (Shift+F10). Enter on a riven slot opens the Picker as for any slot, not the dialog. No card art: a plain row of buttons instead of the planned Riven card in the virtualised grid, so the grid code is untouched.
- **Library**: no screen of its own. "Also save to your rivens" (on for a new riven) in the dialog, Save to / Remove from (with Undo) in the slot menu, × on each library riven in the Picker row. Saving an edited riven that is in the library updates the library copy (as on the site).
- **Footer preview**: paper DPS (no armor, status or reloads) now and with the riven, not the simulated Average DPS, which runs on Save. Saving is one undo step.
- **Auto build**: unchanged candidates (rivens stay blacklisted as `Riven Mod`); a kept riven slot is a slot like any other and counts in its scores and capacity. The run's starting slots and Apply keep the riven object whole (a `{ name, rank }` copy would leave a riven with no stats; tested).
- **Library rivens** are checked like a loaded riven (`rivenSlotFor`: family and the site's rules) before they are equipped.

### 12.3 Gaps

- Closed by section 13: the riven tools, rivens from a screenshot, the left/right compare and the library's files. The Forma planner now polarises a riven's slot (Madurai: an Omni riven halves in any polarity but Umbra), a dragged riven shows its Omni glyph on the projected drain plate, and the Auto build result names a riven "Braton Riven" without " R8".
- No per-weapon disposition (the site has none either): the player types it.
- The featured builds in the data have no gun riven, so the featured path is covered by a synthetic build in the tests only.

## 13. Riven tools (2026-10-25)

underframe.site's riven tools, ported from its behaviour (script.js read as data, none of it copied): Slot My Riven (L40973), Auto Riven (`slotOptimalRiven`, L42008), Get Rolls Data (`exportRollsData`, L43183), the rolls scan setup (L43004-43180), the minor build tweaks (L41487-41940), the left/right compare (L49393-49880) and the library's import and export (L11640-11745).

### 13.1 Files

- `src/shared/riven-tools.js` (pure):
  - the site's constants: runs 50 (1-200), 5 s, roll strength 11000 (9000-11000), 2 forced positives, batches of 250, and the tweak limits;
  - the gun's positive list (`ROLL_POSITIVE_STATS`, in the site's group order, kept to the stats the weapon's rivens have);
  - the negatives (`rollNegativeStats`: every riven stat but Punch Through, the elements and the spliced stats, sorted);
  - `positiveCombos` and `theoreticalRiven` (2+1 and 3+1 multipliers 1.2375/-0.495 and 0.9375/-0.75, times the strength; disposition 1.2, rank 8);
  - the tweak helpers (`tweakPool`, `minorTweakContext`, `promoteForTweaks`, `refineAroundRiven`);
  - the four searches: `slotMyRiven`, `autoRiven`, `rollsData` (with the site's CSV columns and quoting) and `compareRivens`. Each takes an Auto Build env and an injected `score(jobs)`.
- `src/renderer/riven-tool-job.js`: one run over the engine pool (`poolScorer`, now shared with Auto Build's job), then each proposal's Average DPS at the build's own settings (the Readout's 8 seeded runs).
- The Auto Build worker and client take `job: 'riven'` with `tool`, `options` and `rivens`. Runs use the user's Auto Build engine count.
- `src/renderer/riven-tools-flow.js`: the dialog's state (`store.rivenTool`), Start, Cancel, Apply (one undo step, with Undo in the toast), Save CSV, rivens from a screenshot, the compare's rivens, and the library's import and export.
- `src/renderer/ui/RivenToolsDialog.jsx`: the "Riven" menu on the Loadout's capacity line (for guns that take rivens) and the dialog (setup, progress, result).
- `src/shared/riven-recognition.js`: rivens from a screenshot's OCR (13.4).
- `src/main/files.js`: `uf.files.saveText` and `openText` through the system dialogs. Automated runs save to a temp folder and never open a file.
- `src/shared/rivens.js`: `rivenLibraryFileText`, `parseRivenLibraryFile` and `importRivensInto`.
- Tests:
  - `test/riven-tools.test.js`: a fake scorer with a known best answer, and a real-engine run of each tool;
  - `test/riven-recognition.test.js`: Windows OCR of riven cards drawn for the test (in `test/fixtures/riven-ocr/`), and hand-made OCR;
  - library files in `test/rivens.test.js`.
- Smoke (`checkRivenTools`):
  - the menu, opened by real clicks;
  - Auto riven applied, then undone;
  - Rolls data saved;
  - with `UF_SMOKE_RIVEN_IMAGE`: two rivens read and compared, and one read into the riven dialog;
  - library import and export.

### 13.2 As on the site

- **Slot My Riven** tries the library's rivens of the family in every general slot that holds no riven and isn't excluded, filled or empty.
  - Rivens with an excluded positive are left out. The baseline is 50 runs.
  - The result gives the best placement, and the best one that keeps the build's elements.
  - When the best placement changes the elements, the result offers both ("Apply best" and "Apply, keep elements") instead of the site's confirm().
  - When nothing beats the build: "Your riven is not optimal to slot in this build."
- **Auto Riven** runs in four phases:
  - Phase 1 rolls every 2- and 3-positive set into every filled, unprotected general slot, with the default negative (Zoom, else the chosen one). Forced positives are in every set; excluded ones never are.
  - Phase 2 tries every negative (or the chosen one) on the best roll, at 3x the runs.
  - With minor tweaks:
    - phase 1.5 ranks the weak slots and shortlists 8 replacements per slot;
    - the promoted sets (the 8 best, plus 2 per upgradeable slot) each get phase 2;
    - the top 5 get up to 3 swaps around the riven, and each swap must gain 0.25%.
  - Phase 4 confirms the winner at 3x the runs and applies it only when it beats the baseline (20 runs).
  - Keeping the elements (on by default) drops every candidate that changes them.
- **Rolls data** needs a negative stat.
  - It scores every set with that negative in every unprotected general slot, filled or empty, at the chosen runs. The baseline is 24 runs.
  - With tweaks, the 40 best rows, plus 8 per upgradeable slot, get the swaps.
  - The CSV is sorted best first and named `<build>-rolls-data.csv`. Its columns are the site's:
    - always: `positives`, `replaced_mod`, `dps_delta_percent`;
    - with tweaks: `negative_stat`, `riven_replaced_mod`, `one_slot_dps_delta_percent`, `final_dps_delta_percent`, `tweak_count`, `extra_swaps`, `tweak_refined`.
- **Scoring options**: raw damage per shot or status damage per shot (one of the two), build for floor, and single shot. Their defaults come from the active Auto Build config, as on the site.
  - Tweaks use that config's lists, its headshot-only rule and Cost Control (capacity is checked, and half rank is tried too).
  - The arcanes' element needs are kept.
- **Library files**: Export writes `{ version: 1, rivens }`, which the site's import reads.
  - Import reads our file, the site's export (its `rivens` array) or a bare array.
  - It then asks Merge (the default, the site's "B") or Replace (its "A").

### 13.3 Deliberate differences

- Every candidate in a step shares seeds 1..n (common random numbers), so placements are compared on the same rolls; the site rolls fresh each run.
- A theoretical riven only rolls stats its weapon's rivens have. The site would leave a missing stat out and keep the 2+1/3+1 multiplier.
- On Apply, a theoretical riven's id is replaced by a new `riven_` id.
- All three tools need a build without a riven. Slot My Riven and Auto Riven refuse on the site too; Rolls data would otherwise score builds with two rivens.
- With a riven equipped, the compare tries each riven in that riven's slot only (a reroll's old and new roll); without one, in every general slot. The site skips the riven's slot, so it ends up comparing second rivens.
- Results show the Readout's Average DPS (the build's own sim time, 8 runs) before and after. The search's own numbers stay internal.
- Slot My Riven and the compare score average DPS only, with no scoring options, as on the site. The compare uses 5 s runs.

### 13.4 Rivens from a screenshot

The site reads riven cards with a browser OCR model; this app uses the same Windows OCR as the build import.

- `recognizeRivens` takes the full-image lines and splits two cards that sit side by side at the clear gap between their stat lines.
- It reads each stat line against the weapon's riven stats, in the game's own words (`IN_GAME`), with the build recognition's fuzzy matching. It reads lines such as:
  - "+152.3% Critical Chance" and "-41.6% Zoom";
  - "x0.88 Damage to Corpus" and "+1.8 Punch Through";
  - "-35.2% Weapon Recoil" and "+64.2% Fire Rate (x2 for Bows)".
- OCR's "O" for 0, and the bow note after Fire Rate, are handled.
- Shown values are effective values. They are stored at disposition 1.2 and rank 8, because the card shows neither.
- Signs that were read are kept. A lost sign follows the layout, as on the site: the 4th stat is the negative, or the 3rd when the values don't fit three positives.
- When the card's name names another weapon ("Lanka Critatox"), the review says so.

What the menu offers:

- **Read a riven** (from a file or the clipboard) opens the riven dialog on the result as a new riven, for review.
  - Its title is "Riven from screenshot", with a note on what to check and on anything not read.
  - It goes into the build's riven slot, else the selected slot, else the first empty one.
  - With every slot full, Save keeps it in the user's rivens.
- **Compare two rivens** reads two cards side by side and opens the compare.
  - Each card can be edited first (the riven dialog's "Use in compare").
  - After scoring, Equip left or Equip right applies one, as one undo step.
  - "Allow element changes" shows when a placement changes the elements.
- The arsenal import still can't read a riven's stats, because the upgrade screen shows only its name. Its review now says how to add them after applying.

### 13.5 Not done

- No riven art: rivens stay text cards.
- Reading one riven from a screenshot of two cards takes the left one, and says so.
- No real riven screenshots were available. The OCR tests use cards drawn for the test and read by Windows OCR, plus hand-made OCR for lost signs and misreads.
