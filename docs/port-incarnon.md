# Porting underframe.site's Incarnon evolutions

Status: built (2026-10-25). This spec describes **behaviour and data contracts** read from underframe.site's front end
(`script.js`, studied as data, never run or copied) and what this app does with them. Field names, ids and stat types
are given because saved builds, `core/data/data.json` and the engine use them. Line numbers (`L123`) point into the
site's `script.js` as downloaded for this work. Section 9 has the parity check against the live site.

Scope: Incarnon evolutions (perks) on primaries and secondaries: picking them, what they do to the stats and the engine
input, their conditional parts, saved builds, featured builds and Auto Build. Melee Incarnons are listed only where
the site's code mixes them in; the app has no melee.

Related: docs/port-weapon-stats.md (the stats pipeline), docs/port-auto-build.md (Auto Build), docs/port-rivens.md.

## 0. Key facts

| Topic | Fact |
| --- | --- |
| Data | `data.incarnons`: 97 weapons, 69 of them guns. Each has `charge_count`, `charge_type`, `incarnon_max_ammo` and `evolutions`. |
| Evolutions | `evolution_1` is the Incarnon Genesis (no perks; for guns its stats lists are empty). `evolution_2` .. `evolution_4` (65 guns) or `evolution_5` (Onos, Laetum, Phenmor, Felarx) each offer 2-3 perks. |
| A perk | `perk_M_description` (the text), `perk_M_stats` (always on), `perk_M_conditional_stats` (on a trigger). Stats are `{ Stat, UpgradeType, Value, OriginalValue, OperationType?, MaxStacks?, LastShots?, StatusChanceByForm? }`. |
| Build field | `build.incarnon = { evolution_1_active, evolution_2_perk .. evolution_5_perk }` (a perk number or null). On the site new builds start with the Genesis off (L13740-13741); in this app the Genesis is always installed, because every player of an Incarnon weapon has it (decision in section 8). |
| Genesis | Site: off, no perk counts; turning it off clears the four perks (L31863-31870). It adds no stats itself (empty for guns), so "always installed" changes nothing until a perk is picked. The Incarnon Form fire modes run either way (they are weapon modes, not perks). |
| Conditional parts | One state per conditional stat in the build's `activeConditionals`, keyed `<weapon>_evo<N>_perk<M>_<Stat without spaces>` (L31060-31120): `{ isActive, stacks, auto }`. |
| Defaults | A state the user has not set (`auto`) is decided from the perk's text, the stats and the fire mode (L31200-31342); section 5. |
| Where perks act | In the site's stat pipeline (`calculateWeaponStats`, L28496-28700, L28720-28880, L29280-30560) and in a few engine fields (section 6). The engine gets no perk list. |
| Auto Build | With the Genesis on (in this app: always) and an evolution empty, it picks perks (steps 2.7 and 4.3, L40029-40276, L44555-44715). |

## 1. Data contract

Per gun incarnon (`data.incarnons[i]`):

- `name`: the weapon's name (`data.weapons`), `incarnon_max_ammo`: the Incarnon Form's charge pool (already used by the
  app for the Incarnon Form's magazine), `charge_count` and `charge_type` (the engine reads `charge_count` from
  `appState.incarnonData`).
- `evolutions.evolution_N` (N >= 2): `perk_M_description`, `perk_M_stats`, `perk_M_conditional_stats`; four
  evolutions also carry `priority` and one `headshot-priority` ("perk 3"), read by Auto Build only.
- Upgrade types in gun perks, always-on: base damage, crit chance and multiplier (and a flat crit chance), status chance
  (also `ADD_BASE`), fire rate, multishot, punch through, range, magazine capacity, reload, projectile speed, Condition
  Overload, headshot damage, headshot multiplier, ammo pool multishot, last-magazine multishot (shots and bursts); and
  types the site ignores (accuracy, recoil, zoom, ammo maximum, holstered reload, movement, charge rate).
- Conditional: the same plus additive damage, crit and fire rate, multiplicative crit multiplier, non-crit damage,
  bodyshot crit, armor reduction, elemental damage, infinite ammo, ammo efficiency, crit from status and status from
  crit; and types the site ignores (ammo restore or replenish chances, instant reload chance, overshields, damage field
  duration, area of effect).

## 2. The build field and saved builds

- Site: `build.incarnon` as in section 0, and the conditional states in `build.activeConditionals` (with every other
  conditional). The v3 share link packs it as `ic` (L1357-1385). The trusted (featured) builds carry both.
- **This app**: `build.incarnon` in the site's shape, `null` when no perk is picked, plus `conditionals`: `{ [id]: stacks }`
  for the conditional parts the user set (0 is off). Automatic states are not stored; they are worked out again on
  every calculation, as the site re-derives its `auto` states.
- Cleaning (`src/shared/incarnon.js` `normalizeIncarnon()`): the weapon must have evolutions and at least one perk
  must be picked (else null); a perk number the weapon lacks becomes null; a setting for a perk not picked is dropped; stacks clamp to
  the stat's max. The main process (`src/main/builds-store.js` `cleanIncarnon()`, which ships without the data) keeps
  the shape and types only.
- The field is a weapon option (`weaponOptionsOf()`): unsaved-changes detection, undo steps, the simulation key and
  pins include it; a weapon change clears it (like the Progenitor bonus and passives).
- **Featured builds** now bring their perks (`incarnonFromSite()`): a conditional state they set themselves
  (`auto: false`, or no `auto` with a value, the site's own test, L31344-31380) becomes a setting; the rest are automatic.

## 3. The site's UI and ours

Site (L16968-17023, L17852-17876, L18431-18505): a row of evolution slots I-V beside the mods. "I" toggles the Genesis
(right-click too); II-V open a modal listing the perks' full descriptions; clicking the picked perk again clears it, and
right-click clears a slot. The conditionals sidebar lists "Evo N: <stat>" with a switch (one stack) or a stacks slider;
touching one sets `auto: false`.

This app: the weapon's **Options** popover (beside the fire mode) gains an "Incarnon evolutions" section for every
weapon with evolutions:

- one **dropdown per evolution** (Evolution II-V): "No perk" and each perk by name, with its text under the name in the
  list (three lines) and in full under the dropdown once picked. Names are read from the descriptions ("Perk 1:
  Hunter's Mantra: ..."; where the data has no colon after the name, the name ends before the first word of the
  effect: "Daring Reverie Increase Damage ...");
- one **dropdown per conditional part**: "Automatic (on)" / "Automatic (3 stacks)" / "Automatic (off)", showing what
  the site's default decides for this build right now, then Off and each stack count (or On). A short note explains
  Automatic.

Every change is one undoable edit. The Options button's accessible name adds "2 Incarnon perks" (or "0 Incarnon
perks"). There is no Genesis switch: it is always installed. The popover scrolls inside 70% of the window height, so it fits at 1100x700.

## 4. What perks do

All of this applies to the perks picked in evolutions 2-5 (the Genesis is always installed).

### 4.1 Always-on perk stats (L28511-28700)

Each stat, in order (its `Value` read as a number; a non-number is skipped):

1. **Additive speed perks** (Evolution II perk 2 of Onos, Laetum and Phenmor, a fire rate stat with no operation or
   `STACKING_MULTIPLY`) add to the fire rate bonus like a mod (L27801-27808) and skip the rest.
2. Bucket stats, then nothing else:
   - Condition Overload: adds to `conditionOverload`;
   - ammo pool multishot (Torid, Miter): `ADD_BASE` adds flat base damage, `STACKING_MULTIPLY` a percentage (4.4);
   - magazine capacity: rounds added to the base magazine before mods (`ADD_BASE`), or a percentage like a mod
     (`STACKING_MULTIPLY`); without an operation, a "%" in `OriginalValue` means a percentage (L27864-27872);
   - last-magazine burst (Burston, `ADD_BASE`) and last-magazine shots (Torid, `LastShots`) multishot (4.4);
   - headshot damage: adds to `weakPointDamage`; a flat crit chance: adds to the flat crit chance;
   - headshot multiplier: nothing here (section 6).
3. **Base damage** adds to `incarnonBaseDamageBonus` and also edits the modes (next item).
4. **Mode edits**, on every fire mode that has the field: base damage scales the mode's base and every innate type by
   `(base + value) / base`; crit chance adds `value x 100` points; crit multiplier adds `value`; fire rate (and attack
   speed) multiply the mode's rate by `1 + value`; multishot adds `value`; punch through adds `value` (not on area
   modes or a -1 mode); range adds `value`. A perk whose text says "effect doubles in Incarnon Form" doubles the value
   on Incarnon Form modes.
5. **Status chance** per mode (L28589-28669): the stat's `StatusChanceByForm` (`normal` / `incarnon`) when present;
   else `value`, or the "+X% per pellet/projectile" figure in the stat's or perk's text; an Incarnon Form mode takes the
   "+X% ... for Incarnon Form" or "Increase Incarnon Form Status Chance by +X%" figure when the text has one. The Strun
   family's texts list one figure per variant ("+20% (Strun) / +12% (Wraith)"): each variant reads its own, before and
   after the Incarnon Form part.

These edits happen on the modes after their firing fields are shared and before any mod; a mode without its own crit
still takes the **original** normal attack's crit (not the edited one), as on the site.

### 4.2 Conditional perk stats (L27874-28106)

A stat counts only while its state is on, at `stacks` (capped at its max; one stack when its max is 1). Its value is
`Value x stacks`, then by type:

| Type | Effect |
| --- | --- |
| base damage, with "%" in `OriginalValue` | damage bonus (also the engine's `simulationAdditiveDamageBonus`) |
| base damage, flat | each mode's damage scaled by `(sum + bonus) / sum` before Progenitor, the bonus times the mode's own multishot when the text says "per pellet/projectile"; also in `incarnonBaseDamageBonus` |
| `WEAPON_DAMAGE_AMOUNT` (`STACKING_MULTIPLY`), additive damage | damage bonus (and `simulationAdditiveDamageBonus`) |
| multishot, crit chance (and additive), additive crit multiplier, status chance, fire rate (and attack speed), reload, punch through, range, blast radius (flat or %), ammo efficiency, Condition Overload, headshot damage, follow through | the same buckets as mods |
| additive fire rate | fire rate; a whole-number value (> 5, or 1) is replaced by the percentage in its text |
| magazine capacity | as the always-on one |
| crit multiplier | added to each mode's base crit multiplier before it is rounded to the game's steps (not "slide attack" ones) |
| multiplicative crit multiplier | multiplies the final crit multiplier |
| flat crit chance and multiplier | as external flat crit |
| accuracy | `finalAccuracy x (1 + value)` |
| infinite ammo | free shots; accurate ammo turns off (the site disables its toggle) |
| elemental damage | a modded element (Dual Toxocyst's Toxin), after the mods' own, before conditional mods' |
| status damage | `statusDamageBonus` |
| non-crit damage multiplier, guaranteed non-crit damage, bleed on impact, Puncture proc count | the engine's per-mode fields |
| armor reduction, headshot multiplier, bodyshot crit multiplier | section 6 |
| crit from status, status from crit | 4.3 |
| projectile speed | the falloff ranges and the engine (4.5) |

### 4.3 Crit from status and status from crit

Status from crit (Sicarus, Cestra, Vectis): `min(final crit chance x ratio, cap)` points join the base status chance.
Crit from status (Dera): `min(final per-projectile status x ratio, cap)` points join the base crit chance (and the
extra projectiles' crit, for a weapon that has them). Caps are the "up to X%" in `OriginalValue`.

### 4.4 Ammo pool and last magazine

- Ammo pool multishot: a mode with base damage gets `ammoPoolMultishotInnateProjectiles` (its own multishot, at least
  1) and `ammoPoolMultishotDamageMultiplier` `(1 + percent) x (base + flat) / base`. A beam with a percentage counts its
  extra beams `1 + percent` times and sends `nativeExpectedFireIterations` (the multishot before that).
- Last magazine: normal-form modes that cost ammo get `lastMagazineMultishotBonuses` ([{ shots, value }]); burst modes
  get `lastMagazineBurstMultishotBonus` `= base x (1 + multishot bonus)` (x 1 on a multishot-locked mode). Incarnon Form
  modes never do.

### 4.5 Reload, status duration, fire rate and projectile speed (L27813-27862)

- Always-on reload speed speeds up the **normal form** only; conditional reload speeds up both.
- Status duration perks scale status duration (none on guns today).
- Projectile speed (always-on, and conditional ones at their stacks) stretches falloff ranges like a mod and is sent to
  the engine as `conditionalStats.projectileSpeed`.

### 4.6 Special cases

- Latron family, Evolution IV perk 1 (Flensing Spikes): every mode sends `punctureArmorStrip: 0.2`, whatever its state;
  the base Latron's conditional armor reduction adds `armorStripPerHit` (section 6).
- Latron family, Evolution IV perk 2 (Deadhead): `externalHeadshotMultiplierBonus` +1 in conditionalStats, and the
  perk's headshot multiplier (+1) on the target (section 6).
- Not for guns: melee damage, attack speed on melee, initial combo, heavy attack, slam radius, slide crit, aerial combo,
  Ruvox's Puncture conversion, Arbucep's multishot-to-damage, evolution I conditional stats (melee only).

## 5. Conditional states and their defaults

Ids: `<weapon name>_evo<N>_perk<M>_<Stat with spaces removed>` (L31090-31115). Max stacks (the slider's): the stat's
`MaxStacks`, else "stacks up to Nx" in the perk's text or in `OriginalValue` ("... N times"), else 1. The stat maths
reads only `MaxStacks` and "stacks up to Nx" in the perk text, so a few stats count one stack whatever the slider says;
the app does the same.

A default is `{ isActive, stacks: max when on }`. In order (L31257-31342), with "the modes" being the perk's relevant
modes (both forms with "both modes", the Incarnon Form modes with "incarnon form", the normal ones with "base form" /
"normal form" / "non-incarnon", else the picked mode's parts, else all):

1. crit from status, status from crit and external elemental damage: on;
2. "on hit that is neither critical nor applies a status" / "on non-critical hit": on while the modes' highest crit
   chance is below 100%;
3. "on hitting a target affected by" / "on targets affected by" a status, and "on killing enemy with" a status: on when
   every status the text names has a source (a damage type any mode deals, a status on the target, a buff's element);
4. "on reload from empty": on unless the picked mode is an Incarnon Form;
5. "on slide attack" / "on slide kill": on for a slide attack (never for guns);
6. "hitting enemies in incarnon form": on for an Incarnon Form pick;
7. "critical chance below/under X%": on while the modes' highest crit chance is below X;
8. a text naming a status with "status" or "proc": as 3;
9. phrases a simulated fight never meets ("while aiming", "on equip", "on finisher", "while sliding", "with
   overshields", "less than half health", ...): off;
10. phrases it does ("on kill", "on hit", "on headshot", "on critical hit", "weakpoint hit", "body shot", "with
    channeled ability active", "with armor over", ...): on;
11. anything else: off.

**Two passes.** The site computes the stats with the states it has, applies the defaults from those stats, and
recomputes when a default changed (L24868-24876, L39221-39234). The app does the same in `computeWeaponStats()`: first
with only the user's settings (the automatic ones off, as on a first load), then, if any default turns on, again with
them. The defaults that read the stats (crit thresholds, status sources) therefore see the build without themselves,
as the site's first calculation does.

## 6. The engine input

Besides `weaponStats` (sections 4.1-4.4; the per-mode fields `incarnonBaseDamageBonus`, `simulationAdditiveDamageBonus`,
`nonCritDamageMultiplier`, `guaranteedNonCritDamageMultiplier`, `bleedOnImpactChance`, `forceProcCount`,
`statusDamageBonus`, `finalAccuracy`, `punctureArmorStrip`, `ammoPool*`, `lastMagazine*`, `nativeExpectedFireIterations`):

- `conditionalStats`: `armorStripPerHit`, `bodyshotCritChanceMultiplier`, `projectileSpeed`,
  `externalHeadshotMultiplierBonus` (L34995-35015, L27559-27568), only when not at their defaults, as the app sends
  conditionalStats;
- `enemyConfig.headshotMultiplier` `+=` the perks' headshot multiplier, unless the target's multiplier is 1;
  `enemyConfig.armorStripPerHit` and `simulationParams.armorStripPerHit` with an armor strip (L35073-35090);
- `appState.incarnonData` (already sent) and `useAccurateAmmo` off with a perk's infinite ammo.

The site also sends its `activeConditionals` (perk states included) in the app state. Replaying every capture with an
empty `activeConditionals` gives the same DPS (section 9), so the app keeps sending `{}`.

## 7. Auto Build

On the site (L40029-40276):

- **When**: the weapon has evolutions (the Genesis is always installed) and at least one has no perk. Picked perks are kept (locked).
- **Step 2.7** (after the compositions, before the greedy fill): for each starting point, evolution by evolution, a
  locked perk stays; else the data's `headshot-priority` (with headshots on) or `priority` perk is taken without
  simulating; else every perk is scored (`runs(runs(20))` runs: the site scales the count twice) with the other
  evolutions as they stand, and the best (first on a tie) is kept.
- **Step 4.3** (after the top 3 are re-filled and scored, before the arcane step): the same choice again on each, with
  a final score that replaces the candidate's; then they are re-sorted.
- **Result**: the chosen perks are written to the build; every conditional part of a perk it picked is set **on** at
  the stacks its text names ("stacks up to 3x", else 1) as the user's own setting (no longer automatic); the kept
  perks' states stay.

This app does the same in `src/shared/auto-build.js` (`autoEvolution()`, the `pickPerks` step), with candidates
carrying their perks through every later step (arcanes, refinement). `runAutoBuildJob()` applies the site's after-run
states (`incarnonAfterAutoBuild()`), so the result view's "after" DPS is what the Readout shows once applied. The result
view lists "Incarnon perks: Evolution II: ...", Apply writes them in the same undo step, and a build whose only work is
an empty evolution is not "nothing to fill".

## 8. Decisions

1. **The site's shape** for `build.incarnon`, so featured builds and site builds map one to one.
2. **Only the user's settings are stored** (`conditionals`), not the automatic states; "Automatic" is a choice in the
   UI, so a setting can go back to the site's default (the site has no way back once touched).
3. **Options popover**, not slots beside the mods: the Loadout gains no control at rest except the Options button on
   Incarnon weapons (Braton Prime, the default weapon, now shows it).
4. **Perk names** are parsed from the descriptions for the dropdowns; the full text is always shown.
5. **A weapon change clears the perks** (perk numbers mean different perks on another weapon).
6. **Two passes** for the defaults (section 5), the site's first-load behaviour.
7. **Stug's blobs**: while checking parity, the Blob Explosion's radius came out smaller than the site's; the app now
   grows a stacking mode's radius toward `multishot_stack_max_range` with multishot, as the site does (no DPS change on
   one target).
8. **The Genesis is always installed** (2026-10-25, at the user's request): every player of an Incarnon weapon has it,
   so a switch was one more step for nothing. `build.incarnon` is null until a perk is picked (older builds compare
   equal), the Options popover shows the evolutions straight away, and Auto build picks perks for empty evolutions on
   every Incarnon weapon, as the site does with the Genesis on. The Genesis adds no stats itself, so DPS with no perk
   picked is unchanged.

## 9. Parity with the live site

Method (docs/port-weapon-stats.md section 1): builds injected into underframe.site's `userBuilds` in a headless
browser; an in-page loop opens each one (clicking its `.draggable-build .build-name`), ticks accurate ammo again, picks
the fire mode, runs Calculate DPS and records the input `Module.calculate_dps_wasm` receives. Each capture is replayed
on `core/engine` (seeds 1-8) against the app's own input for the same build (`sim.js` `buildStats()` and
`buildEngineInput()`), on the site's enemy, and every perk-related field is compared.

Builds (426 captures, every gun with evolutions, both its default mode and its first Incarnon pick):

- two perk sets per gun (69 guns): the perks with the most conditional stats (their defaults decided as on the site),
  and the perks with the most always-on stats;
- every gun with conditional perks again with all of them set by hand, on at max stacks or at half;
- hand-set stacks on Boltor, Furis, Braton Prime, Latron and Vasto, and the Latron family's Deadhead.

Result: **426 of 426 captures give the site's DPS exactly** (69 guns, 213 captures in an Incarnon Form mode; the
largest difference over seeds 1-8 is 0), and every perk-related field and conditional state equals the site's (to
1e-6 relative). Replaying them with an empty `activeConditionals` changes nothing either. The first run of the
comparison found one difference, Stug's blob radius (decision 7), now fixed.

What the fields covered: base damage (always-on and flat conditional, per pellet), crit and status edits (per pellet,
per form, Strun variants), crit multiplier steps, magazine (rounds and percent), reload (normal form only), projectile
speed, ammo pool, last-magazine shots and bursts, non-crit damage, armor strip, the Latron's punctured armor and
Deadhead, additive and multiplicative crit, crit from status, status from crit, infinite ammo, elemental damage and
every conditional state (automatic and set by hand), against the site's `activeConditionals`.

Not a difference: the site's enemy panel sets the target's headshot multiplier to 1 for modes flagged
`1x_headshot_multiplier` (Lex, Paris, Dread and Stug's Incarnon modes); the app sends the mode's flag instead. Headshots
were off, so the DPS is the same.

## 10. Gaps

- Melee Incarnons (the app has no melee).
- Perk stats the site does not simulate either (accuracy outside conditional perks, recoil, zoom, ammo maximum,
  holstered reload, ammo restore and replenish chances, instant reload chance, overshields, damage field duration,
  Miter's area of effect, charge rate): they show in the perk text but change nothing, as on the site.
- The site re-derives automatic states from its last calculation each time its panel redraws; a default that its own
  effect could flip (a crit-threshold perk that raises crit) may settle differently there after several redraws. No gun
  perk does that today.
- The site's evolution slots and share links (`ic`) are not ported; the app has no share links.

## 11. Tests

- `test/incarnon.test.js`: perk names; the build field and its cleaning (both cleaners); ids and max stacks; the
  defaults; what perks do on a synthetic weapon (base damage both ways, status, crit multiplier with its threshold per
  mode, magazine, two passes); the engine input for perk builds against captured site values (Braton Prime, Furis
  with stacks, Torid, Burston, Latron, Strun, Felarx); Deadhead; saved builds, content, undo and a weapon change;
  featured builds; a short real-engine Auto Build that picks perks.
- `test/controller.test.js`: a perk and a conditional's stacks as undoable edits.
- `test/model.test.js`: the old "not simulated" note is gone.
