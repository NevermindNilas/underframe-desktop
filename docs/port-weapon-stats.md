# Weapon stats parity with underframe.site

Status: done (2026-10-25). The app's engine input now matches underframe.site's for every supported gun at its
default mode: 371 of 371 guns give the site's DPS to 0.02% on the same build (section 1). This document says how
that was checked and what changed. It describes behaviour in our own words; the site's code was read, never copied.

Related: docs/port-external-buffs.md (buffs and statuses), docs/port-auto-build.md (Auto build), docs/port-rivens.md
(rivens).

## 1. How parity is checked

Earlier parity checks replayed 5 hand-made builds. This round checked all guns:

1. **One build per gun.** For each of the 371 guns the app supports, a build with up to 6 common mods that fit it
   (damage, multishot, crit, status, fire rate, an element; the app's own compatibility picks them).
2. **Captured on the site.** The builds are put into underframe.site's saved builds in a headless browser. A loop in
   the page opens each one, runs Calculate DPS and records the exact engine input the site sends (`weaponStats`,
   `conditionalStats`, `build`, `simulationParams`, the enemy).
3. **Replayed here.** Each capture runs on `core/engine` against the input the app builds for the same build, through
   the app's own path (`sim.js`: default mode, Progenitor default, passives, conditional mods), on the site's enemy
   and simulation time, seeds 1-4.

Two artefacts of the site had to be avoided: its "accurate ammo" checkbox stays unticked after any weapon that
disables it (the capture ticks it again before each build), and without a data default the site keeps the previous
weapon's mode when the new weapon has a mode of the same name (3 bows; with the site's mode forced, they match too).

Result: before this round 274 of 371 guns differed (some by 2-3x); after it, none.

## 2. What changed in the stats (src/shared/stats.js)

`computeFireMode()` now builds the site's per-mode object (the fields the engine reads) instead of copying the raw
data mode. By finding:

| Finding | Now |
| --- | --- |
| Burst weapons fired as if every shot were single (Burst Laser, Sicarus, Burston, Tiberon: 25-70% off) | `burstCount` and `burstDelay`; the delay shrinks with fire rate where the data says so (`burst_delay_scales_with_fire_rate`), unless the fire rate is locked |
| Charged shots ignored their charge time (Cernos, Daikyu, Opticor, Lenz: up to 2.5x off) | A charge cycle: the charge (sped up by fire rate, or by charge rate where the mode says so) plus the release at the modded rate; `rangedPhaseTiming` and `effectiveFireRate` are sent. Lanka fires once per charge |
| Ammo cost counted twice for beams and heavy shots (Amprex, Glaxion, Bassocyst) | The magazine is in shots (rounds / ammo cost), consumption is the efficiency alone; a mode that empties the clip fires once per magazine; a mode that costs nothing never reloads; Incarnon forms use their charge pool |
| Beam status was combined over the beams like pellets | A beam's status chance is per tick |
| Modes without their own crit had none (Staticor's explosion, Buzlok's beacon) | They take the normal attack's crit chance and multiplier, and status if they have none |
| Battery, shell-by-shell and delayed reloads were plain (Cycron, Strun, Bubonico, Basmu) | The three reload models |
| Special status durations were 6 s (Epitaph, Bubonico, Nightwatch) | 6 s plus the mode's extra time |
| Hitscan area modes, Sobek's acid shells, Glory's alternate fire, bows' quick shots, Phage beams | Per-mode multishot, damage and fire rate locks; a bow's uncharged or quick shot is instant; Phage and Phantasma scale only the extra beams |
| Kuva, Tenet and Coda weapons had no Progenitor bonus (the site defaults to Magnetic 25%) | `build.progenitor` ({ element, value 25-60 }), default Magnetic 25%, added to the base so mods scale it; a direct-hit taper's floor follows the larger base |
| Plinx's alternate fire, Tenet Detron's extra pellets, Penta's fire patch, Ogris's Nightwatch field, Shedu's empty-magazine pulse | Ported as the site does them |
| Range, blast radius, projectile speed, charge rate, body shot, Thunderbolt, follow through, flat status and magazine stats were ignored | New buckets; falloff ranges stretch with projectile speed or blast radius; Thunderbolt's contact explosions |
| Accurate ammo was on whenever the weapon had reload data | Off with Infinite Ammo or when any mode costs no ammo, back on for a mode that must count |
| Condition Overload (`conditionOverload`, `co_factor`) was always 0 | Sent, with the data's CO factor per mode |

## 3. Conditional mods (src/shared/conditional-mods.js)

Galvanized mods, "when aiming" mods and the weapon augments that stack were scored on their base stats only.
Now:

- A slot stores `stacks` only below max; a freshly equipped mod is at max, as on the site. The slot card shows a chip
  ("×5", or On/Off for a one-stack conditional) that opens a popover to set them; the slot menu has "Stacks…".
- Each stack is worth `bonus_per_rank × (rank + 1)` (or `value`). The bonuses reduce into the same totals as external
  buffs, so they reach the stats and the engine's conditionalStats the same way. Galvanized Aptitude, Savvy and Shot
  feed Condition Overload; Double Tap and Lasting Purity multiply; Wild Frenzy fixes the Grakata's rate at 80;
  Sentient Barrage's crit applies to the Battacor's charged shot only; Biotic Rounds adds Viral and Magnetic.
- Featured builds apply their `activeConditionals` (off is 0 stacks).
- Auto build scores candidates at max stacks and kept slots at their own; it forces the weapon's elemental augments
  in, as the site does (Biotic Rounds on the AX-52).

Checked on the site: 9 builds (Galvanized Chamber and Scope, Aptitude with statuses, Shot and Diffusion, Double Tap,
Wild Frenzy, Sentient Barrage, Lasting Purity, Sentient Surge, Biotic Rounds) match to the decimal
(test/parity.test.js replays five of them).

## 4. Combined fire modes (src/shared/fire-modes.js)

The data defines combined modes for 128 guns (`custom_fire_modes`: an impact and its explosion as one attack), and
defaults for a few (`default_fire_modes`: Penta and Ogris start on their combined mode; with Napalm Grenades or
Nightwatch Napalm equipped, on the combined mode with the field). The fire mode picker lists them after the weapon's
own modes, as "custom:<name>" picks; the engine gets the weapon's list in `build.customFireModes`. A combined mode
whose augment is removed falls back to the default. The stats sheet shows the combined mode's first part.

## 5. Weapon passives and options (src/shared/weapon-passives.js)

- **Passives** (data.conditionals.passives, 57 for guns): toggles, stacks, scope tiers and choices. Off by default
  except Cantare's and Enkaus's, as on the site. Stat bonuses use the conditional-mod rules; the engine models a few
  by name (Cedo, Cernos Prime, Enkaus, Gotva, Sagek Prime, Cantare: flags in conditionalStats); Komorex's full zoom
  doubles physical bonuses and combined elements; Dual Coda Torxica adds Cold ×10 and a 50% vulnerability; Reconifex
  adds a Heat resupply. Enkaus fights the target at 65% health and the shown DPS adds the removed health back over
  the kill time, as the site shows it.
- **Exalted weapons** (Regulators, Neutralizer, Lizzie, Glory, Artemis Bow, Noctua, Balefire Charger, Dex Pixia):
  an extra status proc scaled by ability strength (`build.exaltedStrength`, default 100%).
- **UI:** an "Options" button beside the fire mode, only for weapons with a Progenitor bonus, an exalted strength or
  passives, opens a popover with each control.

## 6. Mod compatibility (src/shared/mods.js)

The picker and Auto build now use the game's rules as the site applies them: the weapon's and mod's compatibility
tags (Cannonade mods only on semi-automatic weapons, Combustion Beam only on beams, Terminal Velocity not on hitscan),
the mods that list their weapon classes (Adhesive Blast fits launchers), weapon-family augments (Kuva Sobek takes Sobek
augments), Tainted Mag on rifles only, Semi-Cannonade, Split Flights and Sinister Reach. A diff over every gun and gun
mod against the site's rules finds no difference. Adhesive Blast's card art was added to the private core.

## 7. Tests

- `test/weapon-stats.test.js`: charge timing, bursts, beams and magazines, reload models, inherited crit, status
  duration, Progenitor, combined modes, passives, exalted procs, weapon options as content, accurate ammo; the
  expected numbers are the site's captured values.
- `test/conditional-mods.test.js`: stacks, Condition Overload with the real engine, the weapon augments, the totals
  merge, storage and featured builds.
- `test/parity.test.js`: the site replays of section 3 and the per-mode locks.
- `test/shared.test.js`: the compatibility rules.
- Smoke: the stacks chip (real clicks and keys, 1440×900 and 1100×700), the weapon options popover on Kuva Bramma.

## 8. Not ported

- Kitguns, melee, companions and archguns (out of scope, as before). Incarnon evolutions (perks) are ported now:
  docs/port-incarnon.md.
- Primary Compression's radius and damage effects (the arcane is equipped but its compression is not modelled).
- The site's distance slider: the app simulates at the start of a weapon's falloff, the site's default.
- User-made combined modes (the site's custom fire mode editor); the data's combined modes are offered.
- Zymos spores' special crit link and Sobek's acid shells' on-kill damage (not reached by default modes).
