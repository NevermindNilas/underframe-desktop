# Porting underframe.site's External Buffs, External Statuses and Buff Presets

Status: research spec for a builder (2026-10-24). It describes **behaviour and data contracts** read from underframe.site's front end (studied as data, never run). It quotes no site code. Field names, ids and labels are given because the engine and `core/data/data.json` use them. Every engine claim marked **(probed)** was checked by running `core/engine` in node on Braton Prime. Section 9 has the numbers.

Scope: the weapon-side **External Buffs** list and **External Statuses** list in the site's right-hand Conditionals panel, the **Buff Preset** library, and the "source" system (Warframe abilities, Helminth, passives, arcanes, archon shards, mod sets/amps) that turns a chosen source into buff entries.

## 0. Key facts

| Topic | Fact |
| --- | --- |
| Buff catalogue | `data.conditionals.external_buffs` (64 entries). Each entry has `id`, `name`, `input_type`, an optional `description`, and `stats: [{ type, multiplier?, value?, element?, stacking? }]`, plus optional `hidden`, `cap`, `requires_weapon_classes`, `requires_weapon_names` and `requires_exalted_weapon`. |
| Source catalogue | `data.external_weapon_buffs`: `arcanes`, `archon_shards`, `mods`, `warframe_abilities`, `helminth_abilities`, `passives`, `native_weapon_family_overrides`. Each source maps to a `buff_id` from the catalogue. |
| Screenshot dropdown | "Arcane Pistoleer" is **not** a source. It is the first entry of the **buff type** dropdown, which lists the catalogue in data order. Arcane Pistoleer is an Infinite Ammo toggle. |
| Stored value | A fraction for `percentage` and `elemental` inputs (the UI shows %, stores value/100). A raw number for `value` and `numeric` inputs. `1` for `toggle` and `elemental_fixed`. `heat_inherit` stores `value` = heat%/100 and `factionValue` = faction%/100. |
| Per build | Each weapon build stores `externalBuffs: Buff[]` and `externalStatuses: {type, stacks}[]`. The share URL keys are `eb` and `es`. `ew` (`externalWeaponBuffs`) belongs to **Warframe** builds only: the buffs a Warframe offers to weapons linked to it. |
| Engine path | Buffs **never** reach the engine as a list for weapon sims. The site reduces them into a `conditionalStats` object. **Most stat buffs must be folded into `weaponStats` in JS** (the engine ignores those fields in `conditionalStats`), while a set of fields is applied **only** by the engine. Always send the full reduced object **and** the patched `weaponStats`, as the site does. |
| Statuses path | `appState.externalStatuses = [{ type, stacks }]`. With `appStateRef`, it must be in the **cached** app state. A top-level `externalStatuses` is ignored **(probed)**, unlike a top-level `conditionalStats`, which does override. |
| Presets | `localStorage['warframeExternalBuffPresetsV1']` = `{ version: 1, presets: [{ id, name, buffs }] }`. The library is global (one per user, not per weapon class). Applying a preset filters it to the buffs that suit the current build. |

## 1. Manual buff types (catalogue)

### 1.1 Input types and how the add form behaves

The add form under "External Buffs" holds the buff type select, a value input, an element select, and two heat/faction inputs.

| `input_type` | Value field | Element select | Stored as | List text |
| --- | --- | --- | --- | --- |
| `percentage` | shown, placeholder "Value (%)", step 0.1 | hidden | `value = input/100` | `Name: 60%` |
| `elemental` | shown, "Value (%)" | shown | `value = input/100`, `element` | `Name: 60% Electricity` |
| `elemental_fixed` | hidden | shown | `value = 1`, `element` | `Name: Enabled Heat` |
| `toggle` | hidden | hidden | `value = 1` | `Name` (no value) |
| `value`, `numeric` | shown, placeholder "Value" | hidden | `value = input` (raw) | `Name: 1.2` (2 decimals) |
| `heat_inherit` | replaced by "Heat (%)" + "Faction (%)" | hidden | `value = heat/100`, `factionValue = faction/100` | `Heat Inherit: 225% Heat / 55% Faction` |

- Defaults: the heat_inherit inputs prefill with 225% Heat and 55% Faction, plus any Heat or Faction bonus the build already has. If an override already exists, its values are used instead. The other inputs start empty.
- `corrosive_max_stack` limits its input to 1-4, step 1, and rounds and clamps the value it stores.
- Validation is a blocking alert. "Please enter a valid number for the buff value." (NaN). "Please enter valid numbers for Heat and Faction values." No range checks otherwise; negative values are accepted (useful for vulnerabilities, see `external_elemental_vulnerability`).
- After an add, the value input is cleared.
- The list format is `name` + (`: ` + formatted value, unless toggle) + (` ` + element, if any) + (` (from <sourceBuild>)`, if any). Every row has an "X" remove button. The screenshot rows ("Resupply: 60% Electricity", "External Flat Crit Damage: 1.2") follow this format.
- The type dropdown hides entries with `hidden: true`, and entries whose applicability (1.3) fails for the current build. Balefire Charger is the one weapon whose `balefire_shields` is listed first.

### 1.2 Element select contents

The element select lists the site's status types in this order: Impact, Puncture, Slash, Heat, Cold, Electricity, Toxin, Blast, Corrosive, Gas, Magnetic, Radiation, Viral, Void, Tau. Some buff types filter this list:

- Physical types (Impact, Puncture, Slash) are allowed only for `ext_elemental`, `external_elemental_vulnerability`, `ext_proc_elementalist` and `ext_proc_status_duration`.
- Void and Tau are allowed only for `external_elemental_vulnerability` and `ext_proc_status_duration`.
- `ext_proc_elementalist` is further limited to Slash, Heat, Electricity, Toxin, Gas and Blast.
- Element aliases normalise to the engine's names: Fire becomes Heat, Freeze becomes Cold, Poison becomes Toxin.

### 1.3 Applicability (manual buffs)

A catalogue entry applies unless one of these fails:

- `requires_exalted_weapon`: the weapon must be exalted or pseudo-exalted (`archon_vitality`, `archon_continuity`).
- `requires_weapon_names`: case-insensitive name match. When present, this check alone decides applicability (`balefire_shields`: Balefire Charger).
- `requires_weapon_classes`: the build type must be one of these (`vigilante_set`: Primary).

Entries that do not apply are hidden from the dropdown and from the rendered list, and are dropped when a preset is applied. They are **not** removed from the build. The stat reducer does not re-check applicability, except that Vigilante counts only on Primary builds. Some types are coded per class in the reducer (2.2): `ext_melee_damage` acts only on Melee builds, and on melee `ext_serration` acts only on throw/explosion modes.

### 1.4 Dedup and stacking when adding

- `unique_vulnerability`, `sonar` and `external_elemental_vulnerability` always **append** a new row. Each row is a separate multiplier, and the rows multiply.
- For any other id, the selection key is `id` alone, or `id::element` for the multi-element ids (`ext_elemental`, `ext_combining_element`, `external_elemental_vulnerability`, `ext_proc_elementalist`, `ext_proc_status_duration`, `resupply`). Adding a buff whose key already exists **replaces** that row's value; it does not add to it. So two rows can share an id only through different elements or the always-append ids.
- `gladiator_set`, `vigilante_set` and `nira_set` keep `manualValue` (what the user typed) apart from `autoValue` (computed from the build's own equipped set mods), with `value = manual + auto`. Vigilante is capped at 0.3 in total.
- When a list is merged into another (preset "Add" mode, Warframe import), matching keys **sum** their values. Toggles take the max. `overdrive` takes the incoming entry.

### 1.5 Catalogue table

Columns: input type. `stats[].type` with its multiplier when it is not 1. **Where it acts**: `JS` means the site folds it into `weaponStats` (or the enemy) before the engine call, and the engine ignores the conditionalStats field. `ENG` means the engine applies it from `conditionalStats`. `JS+ENG` means both: the direct hit comes from `weaponStats`, while DoT/status maths reads `conditionalStats`. Gun relevance is for this app, which covers Primary and Secondary guns only.

| id | Label | Input | stat type(s) | Where it acts | Guns? |
| --- | --- | --- | --- | --- | --- |
| arcane_pistoleer | Arcane Pistoleer | toggle | infiniteAmmo | JS: `ammoConsumption = 0` (probed +29.9%) | yes |
| void_relic_infinite_ammo | Void Relic Infinite Ammo | toggle | infiniteAmmo | JS, same as above | yes |
| ext_armor_strip | External Armor Strip | percentage | externalArmorStrip | JS: enemy `armor *= 1 - clamp(sum,0,1)`, skipped if the target is immune to armor reduction (probed) | yes |
| seek | Seek | percentage | weakPointDamage x0.75 | JS: `weaponStats.weakPointDamage` | yes |
| ext_headshot_multiplier | External Headshot Multiplier | percentage | externalHeadshotMultiplierBonus | ENG (probed) | yes |
| roar | Roar | percentage | factionDamage | JS: `weaponStats.factionDamage` (probed) | yes |
| sonar | Sonar | percentage | sonarMultiplier | ENG: `sonarActive = true`, `sonarMultiplier *= value` (500% = x5) (probed) | yes |
| eclipse | Eclipse | percentage | eclipseDamage, powerThrow | JS: `weaponStats.eclipseMultiplier = 1 + sum` (probed) | yes |
| overdrive | Overdrive | percentage | overdriveDamage | becomes an extra `finalMultipliers` entry `1 + v` (ENG); last one wins | yes |
| nourish | Nourish | percentage | nourishElement (Viral) | JS+ENG like `ext_elemental` | yes |
| plunder | Plunder | percentage | plunderElement (Corrosive) | JS+ENG like `ext_elemental` | yes |
| gladiator_set | Gladiator Set | percentage | gladiatorSet | JS, melee crit per combo | no |
| vigilante_set | Vigilante Set | percentage | vigilanteSet | ENG `vigilanteSetCritTierChance`, Primary only, cap 0.3 (probed) | primary |
| nira_set | Nira Set | percentage | niraSet | melee slam | no |
| ext_serration | External Weapon Damage% | percentage | damage | JS+ENG: adds to the `damage` bucket (with Serration); `conditionalStats.damage` scales DoTs (probed) | yes |
| ext_melee_damage | External Melee Damage% | percentage | meleeDamage | melee only | no |
| phoenix_talons | Phoenix Talons | toggle | ipsImpact/ipsPuncture/ipsSlash x0.3 | JS: physical multipliers | yes |
| ext_elemental | External Elemental | elemental | externalElement | JS+ENG, see 3.3 (probed) | yes |
| ext_combining_element | External Combining Element | elemental | externalCombiningElement | JS+ENG, see 3.3 (probed) | yes |
| ext_proc_elementalist | Proc Specific Elementalist | elemental | procSpecificElementalist | ENG `procSpecificElementalistPercent[el]` (probed) | yes |
| ext_status_duration | External Status Duration | percentage | externalStatusDuration | ENG `externalStatusDurationPercent` (probed) | yes |
| ext_proc_status_duration | Proc Specific External Status Duration | elemental | procSpecificStatusDuration | ENG `procSpecificStatusDurationPercent[el]` (probed) | yes |
| ext_elementalist | External Elementalist | percentage | elementalist | ENG `externalElementalistPercent` (probed) | yes |
| arcsphere_elec | Arcsphere Elec% | percentage | externalElementNoDot (Electricity) x3; elementalist | JS+ENG: external element tagged `appliesToDot: false`, plus Elementalist | yes |
| ext_add_crit_chance | External Additive Crit Chance | percentage | critChance | JS: crit chance bucket | yes |
| cyte_passive | Cyte Passive | percentage | weakPointCritChance | JS: `weaponStats.weakPointCritChance` | yes |
| ext_add_crit_damage | External Additive Crit Damage | percentage | critDamage | JS: crit damage bucket | yes |
| covenant | Covenant | toggle | covenantFlatCrit | ENG `covenantActive` (+50% body / +200% head flat crit) (probed) | yes |
| ext_flat_crit_chance | External Flat Crit Chance | percentage | flatCritChance | JS: `finalCritChance += v*100` | yes |
| ballistic_bullseye | Ballistic Bullseye | percentage | ballisticBullseye | ENG (probed) | yes |
| ballistic_battery | Ballistic Battery | percentage | ballisticBattery | ENG, first-shot damage (probed) | yes |
| ext_multishot | External Multishot | percentage | multishot | JS: multishot bucket | yes |
| ext_flat_crit_damage | External Flat Crit Damage | value | flatCritDamage | JS: `+v` to the final crit multiplier (probed) | yes |
| ext_mult_crit_damage | External Multiplicative Crit Damage | percentage | multiplicativeCritDamage | JS: final crit multiplier `*= (1+v)` per entry | yes |
| ext_fire_rate | External Fire Rate | percentage | fireRate | JS: fire rate bucket (probed: the cs field alone does nothing) | yes |
| ext_follow_through | External Follow Through | percentage | externalFollowThrough | melee | no |
| ext_reload_speed | External Reload Speed | percentage | reloadTimeReduction | JS: adds to the reload **speed** bucket (`reload`), plus cs `externalReloadReduction` | yes |
| energized_munitions | Energized Munitions | percentage | ammoEfficiency (multiplicative) | JS: `ammoEfficiencyMultipliers` (each one cuts the remaining ammo use) | yes |
| lash | Lash | percentage | lashProc | ENG `lashProc = { value }`, last wins (probed) | yes |
| external_elemental_vulnerability | External Elemental Vulnerability | elemental | externalElementalVulnerability | ENG, pushes `{ value, element }`; rows multiply; -100% blocks the type (probed) | yes |
| resupply | Resupply | elemental | resupplyProc | ENG, pushes `{ value, element }` (probed). Not on Incarnon forms or melee | yes |
| xatas | Xata's Whisper | percentage | xatasProc | ENG `xatasProc = { value }` (probed) | yes |
| valence_formation | Valence Formation | elemental_fixed | externalElement (fixed value 2.0); valenceFormationProc | JS+ENG: +200% of the chosen element, plus `valenceFormationProc = { element }` (forced proc) (probed) | yes |
| stealth_bonus | Stealth Bonus | toggle | stealthBonus | melee / beast | no |
| pageflight | Pageflight | percentage | pageflight | JS+ENG: `pageflightMultiplier = 1 + sum` multiplies per-projectile status chance (JS) and status damage (ENG, probed) | yes |
| heat_inherit | Heat Inherit | heat_inherit | heatInherit | ENG `heatInheritPercentOverride` / `heatInheritFactionOverride` | yes |
| archon_vitality | Archon Vitality | toggle | archonVitality | ENG, exalted only | no |
| archon_continuity | Archon Continuity | toggle | archonContinuity | ENG, exalted only | no |
| corrosive_max_stack | Corrosive Max Stack Increase | numeric 1-4 | corrosiveMaxStacks | ENG `corrosiveMaxStacks = 10 + round(v)` (max over rows) (probed) | yes |
| external_status_chance | External Status Chance | percentage | statusChance | JS: status chance bucket | yes |
| external_flat_status_chance | External Flat Status Chance | percentage | flatStatusChance | JS: per-projectile status `+= v` | yes |
| tornadoes | Tornadoes | toggle | tornadoesProc | AoE sims only | no (no AoE mode) |
| balefire_shields | Shields | numeric | (none) | Balefire Charger only | no |
| arcsphere | Arcsphere | numeric (proc count, max 3) | valenceFormationProc | ENG `arcsphereProc = { element: 'Electricity', count }` (probed) | yes |
| hall_of_mirrors | Hall of Mirrors | percentage | hallOfMirrors | JS: duplicates every fire mode as "(Hall of Mirrors)" with scaled stats | defer |
| unique_vulnerability | Unique Enemy Vulnerability Multiplier | percentage | finalMultiplier | ENG: pushes `1 + v` to `finalMultipliers`; entries multiply (probed) | yes |
| ext_cast_speed | External Cast Speed | percentage | castSpeed | weapons with `uses_cast_speed` only | no |
| ext_heavy_attack_efficiency | (hidden) | percentage | heavyAttackEfficiency | melee | no |
| ext_heavy_attack_windup_speed | (hidden) | percentage | heavyWindupSpeed | melee | no |
| hydroid_enhanced_corrosive | (hidden) Hydroid Passive | toggle | hydroidEnhancedCorrosive | ENG flag | yes (source only) |
| seeking_talons | Seeking Talons | percentage | seekingTalonsChance | ENG, forced Slash proc chance (probed) | yes |
| collective_curse | Collective Curse | percentage (cap 1) | collectiveCurse | AoE sims only | no |
| breach_surge | Breach Surge | percentage | breachSurge | AoE sims only | no |
| shadow_haze | Shadow Haze | percentage | nonRadialFlatCritChance | JS: added to flat crit on non-AoE, non-slam modes | yes |

Legacy ids migrate on load. `ext_element` becomes `ext_combining_element`. `ext_elemental_heat`, `ext_elemental_cold`, `ext_elemental_electric` and `ext_elemental_toxin` become `ext_elemental` with that element. A `unique_vulnerability` entry whose name, stack key or source mentions Sonar becomes `sonar`. If an entry's name is missing, equals its id, or is the old "External Serration", it is replaced with the catalogue `name`. Trusted builds still use `ext_element` and the "External Serration" name.

## 2. Reduction: buffs to the conditionalStats object

### 2.1 Totals and defaults

The site builds one `conditionalStats` object per build. It starts from defaults: zeroes, `uniqueMultiplier: 1`, `sonarMultiplier: 1`, `pageflightMultiplier: 1`, `multiplicativeCritChance: 1`, `multiplicativeCritDamage: 1`, `multiplicativeFireRate: 1`, `overguardDamageMultiplier: 1`, `corrosiveMaxStacks: 10`, the multiplier fields of 1.0, and empty arrays for `externalElements`, `nourishElements`, `plunderElements`, `externalCombiningElements`, `resupplyProc`, `externalElementalVulnerabilities`, `finalMultipliers`, `ammoEfficiencyMultipliers` and `damageConversions`. The arcanes, mods and other conditionals add their parts to it, and then every external buff is reduced into it.

For each buff in the build's list (normalised first), and for each `stat` of its catalogue entry, `v = buff.value * (stat.multiplier ?? 1)`. Where a stat carries a fixed `value` (Valence Formation's 2.0), that value is used instead.

### 2.2 Combination rules per field

- **Sum**: damage, multishot, critChance, critDamage, statusChance, flatStatusChance, flatCritChance, flatCritDamage, fireRate, reload (and externalReloadReduction), weakPointDamage, weakPointCritChance, factionDamage, eclipseMultiplier, powerThrow, externalHeadshotMultiplierBonus, ipsImpact/ipsPuncture/ipsSlash, ammoEfficiency (additive kind), seekingTalonsChance, externalArmorStrip, castSpeed, collectiveCursePercent, breachSurgePercent, externalElementalistPercent, externalStatusDurationPercent, procSpecific*Percent[element], ballisticBullseye, ballisticBattery, nonRadialFlatCritChance, gladiatorSetCritChancePerCombo, vigilanteSetCritTierChance (then clamped to 0..0.3), niraSetSlamDamageBonus, and `pageflightMultiplier` (starts at 1).
- **Multiply**: multiplicativeCritChance and multiplicativeCritDamage (`*= 1 + v`), and sonarMultiplier (`*= v`, which also sets `sonarActive`).
- **Push one entry per buff**: externalElements, nourishElements, plunderElements, externalCombiningElements (`{ element, value }`); resupplyProc and externalElementalVulnerabilities (`{ value, element }`); finalMultipliers (`1 + v`); ammoEfficiencyMultipliers (`v`).
- **Last wins**: lashProc `{ value }`, xatasProc `{ value }`, valenceFormationProc `{ element }`, arcsphereProc `{ element, count }`, overdriveDamage, and the heatInherit overrides.
- **Flags**: infiniteAmmo, covenantActive, stealthBonus, tornadoesActive, archonVitality, archonContinuity and hydroidEnhancedCorrosive.
- **Max**: corrosiveMaxStacks = max(current, 10 + clamp(round(v), 1, 4)).
- **Class rules**: `damage` from `ext_serration` goes into the `damage` bucket only for non-melee builds. It is always recorded as `externalWeaponDamage`, for melee throw modes. `meleeDamage` goes into `damage` only for Melee builds. Vigilante counts only for Primary. A Physical element chosen on `ext_elemental` (or a physical `externalElement`) is **not** added damage: it goes to `ipsImpact`, `ipsPuncture` or `ipsSlash`, so it scales the weapon's own physical damage like a +X% Slash mod. **(probed: 30% Slash on Braton Prime gives +9.4% first hit)**.

Just before the sim, `overdriveDamage` is removed and pushed as `1 + v` into `finalMultipliers`.

## 3. Engine input contract (weapon simulation)

### 3.1 Call shape (what the site sends)

```
calculate_dps_wasm(JSON {
  weaponStats: [...per fire mode, ALREADY including the JS-side external buffs...],
  enemyConfig: { ..., armor: <armor after external armor strip> },
  build: { itemName, type, mods, arcanes: [names] },
  simulationParams: { ..., armorStripPerHit },
  appState: {
    externalStatuses: [{ type, stacks }],      // the statuses list, verbatim
    activeConditionals, weaponData, stances, mode_combo_gain_overrides, mods, co_data, stance_co_data,
    incarnonData,
    conditionalStats: <full reduced object from section 2, numbers sanitised, finalMultipliers finite>
  }
})
```

The weapon sim's `appState` has **no** `externalBuffs` key. Only the Warframe **ability** sim adds `appState.externalBuffs` (the merged list), alongside the same `conditionalStats`. The engine's strings `externalWeaponBuffs` and `external-weapon-buffs` belong to that ability or partner path.

In this app (`src/shared/engine-input.js`), `buildAppState()` carries `externalStatuses: []` and `conditionalStats: {}`. `buildEngineInput()` already merges an arcane `conditionalStats`. The port has to:

1. Reduce the buffs (section 2), then **merge** that object with the arcane one: sum the shared numeric fields and concatenate the arrays.
2. Put the merged object at top level (`input.conditionalStats`) when using `appStateRef`, since that overrides the cached one **(probed)**, or inside the inline `appState`.
3. Put `externalStatuses` **into the cached app state** and re-cache it (`cache_app_state`) whenever the statuses change. A top-level `externalStatuses` next to `appStateRef` is ignored **(probed: Viral x10 had no effect at top level)**. The alternative is to inline `appState` for builds with statuses.
4. Fold the JS-side buffs into `weaponStats` (3.2, 3.3) and the enemy armor (3.4).

### 3.2 JS-side formulas the site uses (per fire mode)

All `*Bucket` terms are additive with the equipped mods' bonuses of the same kind.

- Damage multiplier `= 1 + (mods.damage + cs.damage)`. External Weapon Damage% is additive with Serration.
- Physical: `type *= (1 + mods.physical[type]) * (1 + cs.ipsType)`. The site applies the external physical multiplier after its elemental build.
- Multishot `= base * (1 + mods.multishot + cs.multishot)`.
- Fire rate `= base * (1 + mods.fireRate + cs.fireRate) * cs.multiplicativeFireRate`. The site's bow and other special cases are unchanged.
- Reload: reload speed `= 1 + mods.reload + cs.reload`, and the reload time divides by it.
- Crit chance (percent units, as in weapon data) `= (base% * (1 + mods.critChance + cs.critChance) + (cs.flatCritChance + (non-AoE and non-slam ? cs.nonRadialFlatCritChance : 0)) * 100) * cs.multiplicativeCritChance`. **(probed: `finalCritChance` is in percent; +0.5 does nothing, +50 is +50 points)**
- Crit multiplier `= (base * (1 + mods.critDamage + cs.critDamage) + cs.flatCritDamage) * cs.multiplicativeCritDamage`.
- Status per projectile `= base * (1 + mods.statusChance + cs.statusChance) * cs.pageflightMultiplier + cs.flatStatusChance` (fractions). The aggregated multi-pellet chance follows as usual.
- `weaponStats.weakPointDamage = cs.weakPointDamage + ...` and `weaponStats.weakPointCritChance = cs.weakPointCritChance`.
- `weaponStats.factionDamage = cs.factionDamage` (Roar). The site sends bane mods per faction in `factionDamageByFaction`. **The engine adds the two (probed: 0.3 + 0.3 = 0.6)**, so the port may keep both in this app's single `factionDamage` field.
- `weaponStats.eclipseMultiplier = 1 + cs.eclipseMultiplier`.
- Ammo: additive efficiency `a = mods + cs.ammoEfficiency`. Each multiplicative entry `m` adds `remaining * m` (where `remaining = 1 - min(max(a,0),1)` and shrinks). The combined value is **capped at 0.75** (the site's cap). `ammoConsumption = infiniteAmmo ? 0 : max(0, 1 - combined)`. Note: this app's `stats.js` lets 100% make ammo free, which differs from the site's 75% cap. Align it when porting.
- `cs.finalMultipliers`, Sonar, the procs (lash, resupply, xatas, valence, arcsphere), vulnerabilities, elementalist and status duration need **no** JS change. The engine applies them.

### 3.3 Elements (exact ordering)

Let `B` = the mode's total base damage (physical + innate elements, the site's `modeTotalBaseForMods`). Let `D` = the damage multiplier (3.2).

1. Mod elements, in slot order, each `B * mod%`.
2. Then the "late" elements: the weapon's innate elements **plus** each `externalCombiningElements` entry as `B * value`, summed per type, walked in the order **Heat, Cold, Electricity, Toxin**, then any other type. Each one joins an existing entry of the same type, or is appended. Then base elements pair in order to form combined elements (the game's HCET rule). So an External Combining Element behaves like an innate element that combines **after** mods. **(probed: 240% Electricity with Infected Clip turns the Toxin into Corrosive; Braton Prime first hit 178.5 → 554.2)**
3. After combination (and after the physical multipliers), each `externalElements`, `nourishElements` and `plunderElements` entry adds `B * value` to its own type. These never combine. An existing entry of the same type is summed into.
4. Every type is multiplied by `D`. External elements therefore scale with Serration and External Weapon Damage%.
5. Also send the same arrays in `conditionalStats`. The engine reads them for DoT and status maths **(probed: Electricity 100% gives +28.1% DPS from weaponStats alone and +36.9% with the cs array too; the direct hit is identical)**.

Valence Formation adds an `externalElements` entry of fixed value 2.0 for its element, plus the forced proc. Arcsphere Elec% adds `{ Electricity, 3 * v, appliesToDot: false }` plus `v` Elementalist.

### 3.4 Enemy

`enemyConfig.armor = rawArmor * (1 - clamp(cs.externalArmorStrip, 0, 1))`. This is skipped when the target preset is immune to armor reduction. External Armor Strip does nothing as a cs field **(probed)**.

## 4. External statuses

- UI (weapon Conditionals panel): heading "External Statuses". A select of the 15 status types (Impact ... Tau, same order as 1.2). A number input (min 1, max 10, default 1). A "+" button. The list renders `Viral x10` rows with an "X" button. When the list is empty, the text is **"No external statuses configured."** The Warframe DPS tab has a twin control: label "Status", "Stacks" default 10, and "Add Status".
- Rules: stacks must be a finite number of at least 1, or the add is silently ignored. There is no upper clamp in the UI. A type that is already listed gets its stacks **replaced** (one row per type). The list is saved on the build and re-rendered.
- Engine field: `appState.externalStatuses = [{ type, stacks }]`. Rows may carry a `source` tag; the Dual Coda passive adds and removes its own Cold x10 row by that tag. The engine treats each row as statuses already on the target for the whole sim.
- Effects measured on Braton Prime (section 9): Viral x1 +100%, x10 +325% (DPS and first hit), and x20 is the same as x10 (the engine caps at the status's max stacks). Cold x10: +18% DPS (crit damage), first hit unchanged. Corrosive x10 strips armor (500 armor: +31%). Above 10 stacks it needs `corrosiveMaxStacks` (x14 with max 14: +105% on 1000 armor). Magnetic x10 vs shields: +325% hit. Heat x1: armor strip plus a DoT. **Damaging statuses (Slash, Toxin, Electricity, Heat, Gas) tick for damage**: the debug log gains "Toxin Tick" events, so the engine attributes ticks from the weapon's hits (Toxin x10 +9.8%, Gas x10 +5.2%, Electricity x10 +5.2%, Slash x10 +3.7%). Puncture x10 gives +11.5% DPS (its crit-chance effect) with the first hit unchanged. Impact x10 gives 0 here. Impact and Puncture still matter for status-count effects such as Condition Overload or Galvanized mods.
- Engine warning string: "These target settings do not yet support damaging external statuses without native packet attribution". It is in the wasm and is presumably returned as `error` for target setups that cannot attribute those ticks. It was not reproduced with the plain targets probed here. Surface it in the honesty line rather than as a crash.
- The site also counts external statuses (and buff elements) as available elements for element-gated arcanes (for example Primary Frostbite: Cold).

## 5. Buff presets

- Storage: `localStorage` key `warframeExternalBuffPresetsV1`, value `{ version: 1, presets: [{ id, name, buffs: Buff[] }] }`. A plain array also loads. On load, unnamed entries and duplicate names (case-insensitive) are dropped. Names are trimmed to 80 characters. A missing, duplicate or `__custom__` id gets a new UUID. Each preset's buff list is normalised. The library is sorted by name. If saving fails: "Could not save buff presets to your browser's storage."
- Select contents: "None" (value `''`), then the presets by name, then a **disabled "Custom"** (`__custom__`), present only while the current list matches no preset. "Custom" is never selectable; choosing it does nothing.
- State: when a build loads, the selection is the preset whose normalised list is JSON-equal to the build's list. If none matches, it is Custom (non-empty list) or None (empty list). Any manual add or remove switches it to Custom, or to None when the list becomes empty.
- Applying: choosing a preset (or "None") takes the preset's buffs that suit this build (1.3). If the build already has applicable buffs and a real preset was chosen, a modal asks "Apply Buff Preset": "Add "<name>" to your current buffs, or overwrite them?", with the buttons Cancel, "Overwrite Current Buffs" and "Add to Current Buffs" (focus starts on Add; Esc or a backdrop click cancels). Overwrite replaces the list, and the selection becomes the preset. Add merges by key with values summed (1.4), and the selection becomes Custom. Choosing "None" clears the list without asking. The result is saved to the build.
- Save Preset: "Add at least one buff before saving a preset." when the list is empty. "Enter a name for the buff preset." when the name is blank. A name that already exists (case-insensitive) asks to confirm "Replace the existing buff preset "<name>"?" and keeps that preset's id. Saving stores a normalised copy of the **whole** list (not only the applicable rows) and selects the preset. The name field shows the selected preset's name and is cleared on None.
- Delete: enabled only while a real preset is selected. It confirms "Delete the buff preset "<name>"?", then the selection becomes Custom or None and the name field is cleared.
- Read-only (view-only) mode disables every preset control.

## 6. Source-based buffs (Warframe, Helminth, passives, arcanes, shards, mods)

On the site these are computed on a **Warframe build** (its External Buffs tab, "These buffs will be offered to weapon builds when this Warframe is linked as a partner."). Linking that Warframe to a weapon build as a partner asks "Import external weapon buffs from <name>?", then whether to overwrite ("Click OK to overwrite or Cancel to add them to your current buffs."). The imported rows land in the weapon's `externalBuffs` with `sourceBuild` set to the Warframe build's name, and render as "(from <name>)".

### 6.1 Source record schema

Fields used across `data.external_weapon_buffs.*`:

- `buff_id`, and `element` for elemental buff ids.
- Value: `base_value` (fixed) plus scaling, `value += scale * scaling_multiplier`. `scaling_type` is `strength` (ability strength as a **ratio**, 1.0 = 100%), `duration` (ratio), `shields` (Warframe shield capacity), or `grendel_gut_enemies` (0-5, default 5). `scaling_rank_values[augmentRank]` replaces `scaling_multiplier` when present (the augment's rank, default 0). `cap` clamps the result.
- `requires_augment`: the named augment mod must be equipped on the Warframe, or the entry is skipped. `instances`: add N separate rows (Sonar has 2). `vanity`: a display label suffix ("Attack Speed" for Warcry).
- Weapon filters (6.2): `class` + `class_type` (include/exclude; a string or a list), `subtype` + `subtype_type`, `native_weapon_types`, `weapon_class` (matches the weapon's `passive_weapon_class`), `weapon_name_prefix` + `weapon_name_prefix_type`, and `weapon_value_overrides { weaponName: value }`.
- Arcanes: `{ name, buff_id, value, filters }`. Present if the arcane is equipped on the Warframe.
- Mods: `{ name, mod_names[], buff_id, value, rank_values?, coaction_scaling? }`. The value is per equipped copy; with `rank_values`, the equipped rank's value is used. With `coaction_scaling`, the value is multiplied by `(1 + 0.025 * (CoactionDriftRank + 1))^2`. The Nira set is special: `value * 1.5 * min(3, distinct members)`. Corrosive Projection in an aura slot adds `ext_armor_strip` of `0.03 * (rank+1) * coaction`.
- Archon shards: `{ type, effect_matches[], base_value, tau_value, ... }`. A match uses the shard's effect text. Tauforged shards use `tau_value`. `energy_threshold` with `energy_threshold_multiplier` doubles the value when the Warframe's max energy is at least the threshold. `per_shard_bonus_types` adds `per_shard_base_bonus` (or `per_shard_tau_bonus`) times the number of listed shard types equipped.
- Passives: `{ warframe, source_label, ... }`, which apply when the Warframe build is that frame.
- Helminth abilities use `helminth_abilities[name]` (often weaker numbers than the frame's own ability, for example Roar `strength*0.3` vs `strength*0.5`).
- Display name of a row: `from <Owner>'s <Ability>` (+ ` (<vanity>)`).

### 6.2 Which weapons a source applies to

A source applies to a weapon only if **all** of these hold (an absent filter passes):

- `native_weapon_types`: the weapon's native families must intersect the filter. Families come from `native_weapon_family_overrides[weaponName]` if present. Otherwise: Secondary gives `LotusPistol`; Melee gives `LotusMeleeWeapon`; Primary gives `LotusLongGun`, plus `LotusShotgun` for the Shotgun subtype or `LotusRifle` for Rifle, Bow, Sniper and Speargun. Comparison is case-insensitive.
- `weapon_class`: the weapon's `passive_weapon_class` (default "Other") is in the list.
- `weapon_name_prefix`: the weapon name starts with (include) or does not start with (exclude) one of the prefixes.
- `class`/`class_type` against the build type, and `subtype`/`subtype_type` against the weapon subtype.

The weapon-specific value is the sum of the applicable sources' values (with `weapon_value_overrides` taking precedence), plus the row's `manualValue`. A total of 0 drops the row. `ext_cast_speed` is dropped unless the weapon `uses_cast_speed`. Arcane Crepuscular also records `nativeAvatarCritDamageBonus` on its `ext_flat_crit_damage` row.

### 6.3 Special cases

- Yareli's Sea Snares with Loyal Merulina: the two multiply rather than add.
- Overdrive (Minelayer) replaces rather than adds.
- The arcsphere count is normalised to 0-3, and the corrosive max-stack value to 1-4.
- Vigilante and Nira import their set members, so the weapon's own equipped set mods are not double-counted.

## 7. Where it lives and the copy (site)

- Weapon builds: the collapsible right sidebar "Conditionals" (toggle "»"). In order: Target Dummy, "Conditionals", the conditional toggles, **External Statuses**, External Initial Combo (melee), and last **External Buffs**. The External Buffs section holds: a "Buff Preset" label + select, a "Preset name" input (max length 80), "Save Preset" and "Delete" (styled as a delete button), then the type select, the value input, the heat/faction inputs, the element select, an "Add Buff" button, and the list.
- Warframe builds: an "External Buffs" tab with the heading "External Weapon Buffs" and a "Warframe" badge. It has Buff / Value / Heat % / Faction % / Element fields and an "Add Manual Buff" button. Its rows show the auto and manual split with their sources. An "External Abilities or Buffs" strip adds other frames' abilities or stat sources (External Strength or Duration, Lorak, Thara, Fissure Buff, and others) to the Warframe build.
- Share URL (v3): `eb` = externalBuffs. Each entry is compressed to `[idIndex|id, value, sourceBuild?]` when it has no extra fields. Otherwise it is `{ i, v, e: element, sk: stackKey, so: source, md: sourceMod, sb: sourceBuild, f: factionValue, m: manualValue, a: autoValue, ae: 0 (autoEnabled false), sm: setMembers, sv: setMemberValue, cb: companionBondSources, ncd: nativeAvatarCritDamageBonus, n: custom name }`. The id index comes from a fixed id list that starts `ext_serration, ext_multishot, ext_crit_chance, ...` (append-only). `es` = externalStatuses, verbatim. `ew` = a Warframe's externalWeaponBuffs, verbatim. This app has no share URLs, so this is informational. The app's featured (trusted) builds do use the decompressed shape: `{ id, name, value, element?, sourceBuild? }`. 22 of the 89 trusted gun builds carry `externalBuffs`, and 7 carry `externalStatuses` (mostly 10 stacks each of Impact, Puncture, Cold, Corrosive, Magnetic and Radiation, for Condition Overload counts). `model.js unappliedFeatures()` currently reports these as "external buffs".

## 8. Edge cases and warnings

- Buffs of another class stay stored but are hidden and ignored on render or preset apply. The reducer still applies some of them (for example an `ext_fire_rate` row on any class). For this gun-only app, hide the melee, exalted, AoE, Balefire, cast-speed and hidden ids from the add dropdown (1.5, "Guns?" = no). If a featured or imported build carries them, keep them but mark them "not simulated".
- `resupply` has no effect on Incarnon forms (the catalogue text says so). It is an extra instance, so the first hit is unchanged but DPS rises.
- `hall_of_mirrors` rewrites fire modes into duplicates. Defer it and list it as "not simulated".
- `collective_curse`, `breach_surge` and `tornadoes` only matter in the site's AoE sims; this app has none.
- Negative `external_elemental_vulnerability` reduces damage; -100% blocks that damage type, including external bonuses (the site's target help says the same).
- Ammo efficiency is capped at 75% unless Infinite Ammo is on (3.2).
- Engine message to surface: "These target settings do not yet support damaging external statuses without native packet attribution" (4).

## 9. Probe results (Braton Prime, Serration 10, Split Chamber 5, Point Strike 5, Vital Sense 5, Infected Clip 5; Grineer level 1, 1e6 HP, 0 armor unless stated; 20 s; seed 11)

Baseline: 8995 DPS, first hit 178.5. The probe scripts are in the scratchpad (`research-buffs/probe*.mjs`); they are not part of the repo.

| Case | DPS | Change | First hit change |
| --- | --- | --- | --- |
| External Fire Rate 60%, folded into weaponStats | 13720 | +52.5% | 0 |
| `conditionalStats.fireRate 0.6` only | 8995 | 0 | 0 |
| External Elemental 100% Electricity, weaponStats + cs | 12312 | +36.9% | +51.9% |
| same, cs `externalElements` only | 8995 | 0 | 0 |
| same, weaponStats only | 11526 | +28.1% | +51.9% |
| External Elemental 30% Slash (as ipsSlash) | 9501 | +5.6% | +9.4% |
| External Combining Element 240% Electricity (combines with Toxin into Corrosive) | 17877 | +98.7% | 178.5 → 554.2 |
| Resupply 60% Electricity (cs.resupplyProc) | 23268 | +158.7% | 0 |
| External Flat Crit Damage 1.2 (weaponStats) | 10938 | +21.6% | 0 |
| Roar 50% (weaponStats.factionDamage) | 15316 | +70.3% | +50% |
| Eclipse 200% (weaponStats.eclipseMultiplier 3.0) | 26986 | +200% | +200% |
| Unique Vulnerability 50% x2 rows (finalMultipliers [1.5, 1.5]) | 20240 | +125% | +125% |
| External Armor Strip 50% vs 500 armor | 6690 vs 5735 | +16.7% | |
| Arcane Pistoleer (ammoConsumption 0) | 11684 | +29.9% | 0 |
| External status Viral x10 | 38231 | +325% | +325% |
| External status Viral x1 / x20 | 17991 / 38231 | +100% / +325% (capped) | |
| External status Cold x10 | 10615 | +18.0% | 0 |
| External status Toxin x10 | 9877 | +9.8% | 0 (adds Toxin Ticks) |
| HS: `externalHeadshotMultiplierBonus 1.0` (headshot on) | 38546 vs 19273 | +100% | +100% |
| `sonarActive` + `sonarMultiplier 5` | 44977 | +400% | +400% |
| `externalElementalistPercent 1.0` | 11426 | +27.0% | 0 |
| `externalStatusDurationPercent 1.0` | 10473 | +16.4% | 0 |
| `procSpecificElementalistPercent { Toxin: 1 }` | 10849 | +20.6% | 0 |
| `pageflightMultiplier 1.5` (cs only) | 10211 | +13.5% | 0 |
| `covenantActive` | 14902 | +65.7% | +340% (crit) |
| `vigilanteSetCritTierChance 0.3` | 10136 | +12.7% | 0 |
| `factionDamage 0.3` + `factionDamageByFaction { Grineer: 0.3 }` | 16726 | = factionDamage 0.6 | +60% |
| Screenshot set: Resupply 60% Elec, Fire Rate 60%, Elemental 298% Elec, Combining 240% Elec, Flat Crit Damage 1.2 | 331492 | +3585% | 830.6 |

Fields that did **nothing** when sent only in `conditionalStats`: fireRate, multishot, statusChance, reload, externalReloadReduction, flatCritChance, flatCritDamage, multiplicativeCritDamage, factionDamage, eclipseMultiplier, externalArmorStrip, weakPointDamage, weakPointCritChance, ipsSlash, statusVulnerability, nonRadialFlatCritChance, uniqueMultiplier, infiniteAmmo, externalCombiningElements and externalElements (for the direct hit). These must be folded into `weaponStats` or the enemy, as in 3.2-3.4. `cs.damage` alone raised DPS by 10.2% with no first-hit change, so it scales DoTs. Send it **and** fold it in.

## 10. Recommended port shape (decisions for this app)

- **Model**: add `externalBuffs: [{ id, name, value, element?, factionValue?, sourceBuild?, stackKey? }]` and `externalStatuses: [{ type, stacks }]` to the build (`model.js` normalise and `builds-store.js` persist). Use the site's shape, so featured builds apply directly. Run the legacy-id migration (1.5) in normalise.
- **Pure module** `src/shared/external-buffs.js` (testable, our own code): `buffCatalogue(data)` filtered for guns; `reduceExternalBuffs(buffs, weapon)` returning the conditionalStats part (section 2); `externalModifiers(reduced)` returning the stats.js bucket additions; and a weaponStats patch step for elements, crit, status, eclipse, faction and ammo (3.2-3.3). `computeWeaponStats` takes `external` next to `arcanes`. `buildEngineInput` merges the external conditionalStats with the arcane one, puts statuses into the app state, and applies the enemy armor strip.
- **Engine cache**: key the cached app state on the statuses as well (or inline `appState` when statuses exist), because a top-level `externalStatuses` is ignored.
- **UI** (Readout or Loadout per declutter-spec): an "External buffs" section with the add form (type, value or element per 1.1), the list with remove, and a preset row (None / presets / Custom, name, Save, Delete). Next to it, "External statuses" (type, stacks 1-10, add, list, "No external statuses configured."). Use Fluent dialogs instead of `alert`/`confirm`, keeping the site's wording.
- **Presets**: store them in the app's own store (electron-store or the builds store), with the same `{ version: 1, presets }` shape and the same rules (section 5), so a user could paste a site export.
- **Sources** (optional second step): "Add from source…": pick a Warframe ability, Helminth ability, passive, arcane, mod or shard from `data.external_weapon_buffs`; enter Ability Strength % (and Duration %, augment rank, shields or gut count when the record scales by them); compute the rows for the current weapon with 6.1-6.2; add them with `sourceBuild` = "<Ability> (<Frame>)". No Warframe builds are needed.
- **Honesty line**: list the stored buffs that are not simulated for guns (melee, AoE, Hall of Mirrors, exalted), and surface the engine's damaging-status message.

## 11. What was ported (implementation, 2026-10-24)

The port follows sections 1-6 and 10. The code is this app's own; nothing of the site's front end was copied.

### 11.1 Where it lives

| Part | File |
| --- | --- |
| Catalogue, add/replace/merge rules, reduction to totals, conditionalStats, stat buckets, statuses, sources, presets, text | `src/shared/external-buffs.js` (pure) |
| JS-side folding into `weaponStats` (3.2-3.3): combining and non-combining elements, physical multipliers, flat and multiplicative crit, flat status, Pageflight, Eclipse, Energized Munitions, Infinite Ammo, the 75 % ammo-efficiency cap | `src/shared/stats.js` (`computeWeaponStats({ external })`, `computeFireMode(..., ext)`, `ammoConsumptionOf`) |
| Merging with the arcanes' conditionalStats, External Armor Strip on the enemy (skipped on `armor_strip_immune` targets), statuses in the app state | `src/shared/engine-input.js` |
| Build state, undo, featured builds, pins | `src/renderer/model.js` (`externalBuffs`, `externalStatuses`, `hasExternal`, `externalSummary`), `src/renderer/sim.js` |
| Actions, app-state cache keyed on weapon + statuses, presets I/O, focus return | `src/renderer/controller.js` |
| Saved builds | `src/main/builds-store.js` (`cleanExternalBuff`, `cleanExternalStatus`) |
| Preset library on disk | `src/main/buff-presets-store.js` (`buff-presets.json` in userData, IPC `uf:buffPresets:get/set`, `window.uf.buffPresets`) |
| UI | `src/renderer/ui/BuffsDialog.jsx`; the entry in `src/renderer/ui/Readout.jsx` (target line) |
| Tests | `test/external-buffs.test.js` (pure rules, stores, model, and the real engine) |

### 11.2 Decisions

- **Stored shape is the site's.** Rows are `{ id, name, value, element?, factionValue?, sourceBuild? }` with the site's units (fractions for percentages, raw numbers for value types, 1 for toggles); statuses are `{ type, stacks }`. The 26 featured gun builds that carry them (22 with buffs, 7 with statuses) now apply them; `unappliedFeatures` only reports a Warframe build's own buff sources (`externalWeaponBuffs`, `externalAbilities`, `archon_shards`), which gun builds do not use.
- **Engine path exactly as probed.** The engine receives the reduced totals as `conditionalStats` (every non-default field, Overdrive turned into one more final multiplier), merged with the arcanes' (numbers add, lists join). The JS-side stats are folded into `weaponStats`. Statuses go into the cached app state, and the controller caches one app state per weapon and status list (a top-level copy is ignored). Section 9's numbers were measured before the parity fixes of section 12 (damage quantization, `nonCritDamageMultiplier` 0), so the engine tests now hold the app's own regression values; the independent check is `test/parity.test.js`, which replays inputs captured on underframe.site itself (section 12.1).
- **External physical choices add to the physical bucket** (`1 + mods + external`), as the site's code adds `ipsSlash` to the same modifier the mods use; section 3.2's product form was a simplification. The probe number (+9.4 % first hit for 30 % Slash) matches.
- **Late elements:** with an External Combining Element, the innate elements and the external ones combine in Heat, Cold, Electricity, Toxin order after the mods' elements (3.3). Without one, the innate order is unchanged, so no existing result moved.
- **Ammo:** the 75 % cap now applies to every build (it was 100 % before), as on the site. Infinite Ammo makes shots free.
- **Rows and sources:** a manual add replaces the row with the same id (and element) as on the site; vulnerability-type rows always append. Rows from a source carry `sourceBuild` (the source's label, e.g. "Roar (Helminth)"), and their key includes it: re-adding a source with new strength replaces its rows, while two sources of the same buff (Vex Armor and Arcane Arachne) stack, as they do in game. The site only has sources through a linked Warframe build; this app offers them directly, with Ability Strength / Duration (%), augment switches (on by default) and augment rank, Tauforged and shard counts, mod rank, Coaction Drift and set pieces as each record needs.
- **Gun-only filter:** the add list hides hidden entries, ids that need another weapon class (Vigilante off Primary), and ids this app cannot simulate (melee, exalted, AoE-only, Hall of Mirrors, cast speed, Balefire shields). Sources are listed only when they give the weapon at least one simulated row. Stored rows of those ids are kept, ignored by the reduction and listed as "not simulated" in the dialog and the honesty popover.
- **Presets** are one library per user in the site's `{ version: 1, presets }` shape (a site export can be dropped in as `buff-presets.json`), written by the main process like saved builds, not browser storage. The select shows None, the presets, and a disabled Custom while the list matches none. Applying keeps only the rows that suit the weapon; with buffs already on the build it asks Cancel / Overwrite Current Buffs / Add to Current Buffs (Add sums matching rows). Saving asks before replacing a preset of the same name (case-insensitive) and keeps its id; names are capped at 80 characters; Delete asks first. The site's messages are kept ("Add at least one buff before saving a preset.", "Enter a name for the buff preset.", "Replace the existing buff preset "…"?", "Please enter a valid number for the buff value.").
- **UI** follows docs/declutter-spec.md: one quiet entry (the target line's Buffs link, which becomes the summary "Buffs: 5 · Statuses: 2" so the Readout gains no line), one Fluent Dialog, no new region. Status stacks go 1-10 (Corrosive up to 10 + the Corrosive Max Stack bonus).
- **Errors:** the engine's "damaging external statuses without native packet attribution" message is turned into a plain sentence in the simulation error. The browser's benign "ResizeObserver loop completed with undelivered notifications" note (Fluent's popup positioning re-measuring the filtered list) is no longer reported as an app error.

### 11.3 Not ported

- **Warframe builds and linking** (the site's Warframe External Buffs tab, "Import external weapon buffs from …", `ew`): this app has no Warframe builds. Sources are added directly instead; the special cases that need a linked Warframe's state are approximations: Vigilante and Nira set members (the set-pieces count is typed in), Corrosive Projection in an aura slot, `energy_threshold` (melee-only shards), and Arcane Crepuscular's `nativeAvatarCritDamageBonus`.
- **`manualValue` / `autoValue`** for Gladiator, Vigilante and Nira (the weapon's own equipped set mods): not computed; Gladiator and Nira are melee and hidden here, Vigilante is a plain value.
- **Melee, exalted and AoE effects**, Hall of Mirrors and Tornadoes: kept on a build, not simulated (listed as such).
- **Heat Inherit defaults** prefill 225 % Heat and 55 % Faction without the build's own Heat / Faction bonus.
- **Share URLs** (`eb`, `es`): this app has none.
- ~~Element-gated arcanes and external statuses~~: fixed in section 12 (a Cold status lets Primary Frostbite build stacks, as on the site; the site does this for Frostbite only).
- **Inline edit** of a row's value: re-adding the same buff replaces it, as on the site.

## 12. Review fixes (2026-10-24, round 2)

Two reviews checked the port: one against the live site (5 test builds injected into underframe.site, its engine input captured and replayed on `core/engine`), one on the real app's UX. What changed:

### 12.1 Parity

| Finding | Change |
| --- | --- |
| "Fire Rate cannot be modified" (Semi-Cannonade) and "Multishot cannot be modified" (Primary/Pistol Acuity) were ignored, so External Fire Rate, fire-rate mods and arcanes counted on locked weapons (Lex Prime VP-E: 584.0 DPS against the site's 273.7) | `stats.js collectModifiers()` sets `fireRateLocked` / `multishotLocked` from the equipped mods' descriptions; `computeFireMode()` then keeps the mode's own fire rate and multishot. The check runs on the merged modifiers (mods + external buffs + arcanes), so every source is cancelled, as on the site |
| `nonCritDamageMultiplier` was sent as 1 (the site sends 0, "no override"): about 1-2 % too much DPS | Sent as 0; `guaranteedNonCritDamageMultiplier` stays 1, as the site's sanitiser defaults it |
| Damage was not quantized (physical and element values up to 25 % off per type) | Behaviour ported: each damage type is rounded to steps of the mode's base damage / 32 after the external elements join and before the damage multiplier (`quantizeDamageTypes`), and the base crit multiplier to steps of 32/4095 (`quantizeCritMultiplier`: 2 becomes 2.0004884). Base values in the stats table and the damage legend are quantized too (Braton Prime's Impact 1.75 shows as 2.2), as in game |
| External statuses did not satisfy element-gated arcanes | `arcanes.js arcaneRequirementMet()`: a Cold status on the target meets Primary Frostbite's need (the site does this for Frostbite only); threaded through `computeWeaponStats({ externalStatuses })`, `buildEngineInput({ externalStatuses })`, the readout's arcane notes and Auto build's `arcaneEligible()` |
| The app-state cache (4 entries) re-used an evicted ref while a run could still target it; a status edit makes a new key | `src/renderer/app-state-cache.js`: every miss caches under a fresh ref, runs hold their entry (`withAppState`), and an evicted ref is released (`releaseAppState`, a new engine worker request that forgets the document) only when no run holds it |

**Result:** with the fixes, our engine input gives the site's DPS to the decimal on all five captured builds (Braton Prime VP-A 195,148.3, VP-B 7,710.5; Lex Prime VP-C 4,549.1, VP-E 273.7; Hek VP-D 4,702.8), and our `weaponStats` equal the site's (`finalDamageTypes`, crit multiplier, fire rate, multishot). `test/parity.test.js` replays VP-A and VP-E with the captured values.

### 12.2 UX

| Finding | Change |
| --- | --- |
| The dialog covered the DPS it changes; Ctrl+Z did nothing while it was open; Remove all had no undo | The footer has a live line, "Average DPS 20,858 → 478,263 ▲ 2,193%" (the DPS when the dialog opened, then now, with the hero's delta). Ctrl+Z and Ctrl+Y reach the build while the dialog is open (not in text fields, not under a confirmation). Remove all shows "Removed 5 buffs and 2 statuses. Undo" in the list column, with focus on Undo |
| Sonar read "+10%" but is a multiplier (×0.1, −87 % DPS) | Multiplicative buffs read as multipliers: Sonar "×5" (the value is the multiplier), multiplicative crit damage, enemy vulnerability, Overdrive and Pageflight "×1.5" (1 + value). Sonar's field is "Multiplier (500% = ×5)" and starts at 500; a multiplier under ×1 (or a negative multiplicative bonus) shows a neutral "This lowers damage" line. Every percentage type was audited: only Sonar uses the value itself as the multiplier |
| Catalogue names leaked site internals | Display names (rows keep the site's name for presets and share compatibility): Arcsphere Electricity, External Weapon Damage, External Melee Damage, Elementalist / Status Duration for one element, Cyte-09 Passive (weak point crit chance), Enemy Vulnerability, Balefire Charger Shields, External Crit Chance / Crit Damage / Crit Damage Multiplier, Corrosive Max Stacks |
| The dialog scrolled with 5 buffs; the order worked against the task | 880 px wide with two columns from about 680 px of content: what to add on the left (sticky, so it stays in view while the lists scroll), Active buffs and Target statuses on the right. Presets are one row: the dropdown and a ⋯ menu (Save preset…, Delete preset…). The intro paragraph is a tooltip on the title's ⓘ (and the dialog's always-present description) |
| Focus started on the X; removing a row sent focus to Save preset | Focus starts in the buff search. Removing a row focuses the next row's remove button, else the previous one, else the list heading. Esc closes the dialog even when focus fell to the page |
| Save preset was enabled with no buffs | The menu item is disabled (still focusable) with "Add a buff first" |
| Status stacks used a SpinButton with 24x16 arrows | A Dropdown "×1 … ×10" |
| The DPS carried no qualifier; the summary link's name did not start with its text | The hero caption reads "Average DPS · with external buffs" (or "· with target statuses", "· with external buffs and statuses"), and the honesty popover adds "Also applied: …". The link's accessible name starts with its visible text ("Buffs: 5 · Statuses: 1, 5 external buffs and 1 target status. Edit …", WCAG 2.5.3) |

### 12.3 Tests and smoke

- `test/parity.test.js`: quantization; the VP-A replay (types, crit, fire rate, multishot, `nonCritDamageMultiplier`, DPS 195,148.3); the Semi-Cannonade lock (Lex Prime + Gunslinger + External Fire Rate 60 %: fire rate 2.08, DPS 273.7); the Acuity lock (multishot 1 against Split Chamber and External Multishot); Frostbite with Cold; the app-state cache's refs and releases; and Auto build on Lex Prime no longer pairing a Semi-Cannonade with fire-rate mods.
- `test/external-buffs.test.js`: multipliers (Sonar ×5 / ×0.1 with its warning, ×1.5 types), display names; the probe numbers are the app's regression values.
- Smoke (`checkBuffs`): focus starts in the buff search; the footer shows the change; a keyboard removal keeps focus in the dialog; real Ctrl+Z / Ctrl+Y while the dialog is open; Remove all, then its Undo (focused); the hero caption and the summary's accessible name; no pointer target under 24 px and at most one scroll region in the dialog.
