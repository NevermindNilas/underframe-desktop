# Port spec: Auto Build (build optimizer) and its blacklists

Status: research result, binding as the behaviour contract for porting underframe.site's **Auto Build** into Underframe Desktop. **Built**: section 12 says what shipped and where it differs from the plan in section 9. It describes what the site does (sections 1-8) and how we port it (sections 9-11). It is written in our own words. No site code is copied; identifiers and data field names are quoted only where a port must match them.

Sources read (site build `staticVersion 1792684257`, the same build as `core/manifest.json`):

- the site's `script.js` (Auto Build pipeline, settings, configs, settings modal, progress overlay) and `home.html` (the Auto Build buttons, the "Auto Build Settings" and "Auto Build Configs" modals, the progress overlay);
- `core/data/data.json` keys `blacklist`, `whitelist`, `exilusMods`, `incompatible_mods`, `mods`, `arcanes`;
- the engine glue `core/engine/dps_calculator.js` and the wasm exports, probed in node;
- our `src/shared/engine-input.js`, `src/renderer/sim.js`, `src/renderer/controller.js` (best-mod sweep), `src/renderer/engine.worker.js`, `src/renderer/engine-client.js`, `src/renderer/model.js`.

Throwaway measurement scripts are in the session scratchpad (`research-autobuild/timing.mjs`, `timing2.mjs`, `timing3.mjs`, `pool.mjs`). Their numbers are in section 10.

## 0. Summary

- **The search runs in JavaScript.** It calls the engine thousands of times. The wasm module has no optimizer export. Its exports are `calculate_dps_wasm`, `seed_rng`, `cache_app_state`, `clear_app_state_cache`, a "prepared candidate" fast path (`prepare_canonical_candidate_v1`, `calculate_prepared_canonical_trial_v1`, `calculate_legacy_canonical_trial_v1`, `release_prepared_candidate_v1`), and GPU-batch helpers (`prepare_ranged_candidate_v1`, `prepare_ranged_candidate_metadata_v1`, `get_prepared_candidate_pointer_v1`, `get_prepared_candidate_byte_size_v1`, `simulate_prepared_batch_v1`, `finalize_prepared_batch_v1`, `describe_gpu_core_v1`, `seeded_cpu_trials_v1`). Every one of these scores a single build.
- **Algorithm.** It is a staged heuristic, not an exhaustive search:
  1. choose an arcane on the starting build;
  2. enumerate the elemental mod compositions that produce each target element combination, and keep the best composition per (target, number of mods);
  3. fill the remaining slots greedily, one slot at a time, from each composition;
  4. keep the top 3 and re-optimise their arcane;
  5. run a "final refinement" local search on the winner: up to 10 iterations, each replacing the mod with the least impact;
  6. re-check the arcane;
  7. make a few cosmetic swaps;
  8. write the result into the build.
- **Objective.** By default, mean `avgDps` over N seeded runs of a 5-second simulation, using the current target, fire mode and headshot setting. Two alternative metrics: "Build for Raw Damage" scores `avgRawPerShot`, and "Build for Status Damage" scores `avgDotPerShot`. Two modifiers: "Build for Single Shot/Hit" simulates with a forced single shot, and "Build for Floor" scores with crit and status chance floored to the guaranteed tier and multishot floored to an integer.
- **Constraints.**
  - Mods already in the build are kept (they act as locks), and so are arcanes already in the build. The Exilus slot is never filled.
  - Rivens are always excluded.
  - The mod blacklist is on by default, seeded from `data.json.blacklist` (144 names). The whitelist is off; when on, it limits candidates to its list and does not force any mod in.
  - The stat blacklist drops mods by stat family. The elemental blacklist drops builds whose element mix contains a blacklisted combination. The elemental whitelist limits the target element combinations.
  - "Cost Control" rejects builds that do not fit capacity with at most N Forma. It also tries half-rank mods.
- **Cost.** At the default settings, an empty Braton Prime takes about 23,500 engine runs before refinement, and each refinement iteration adds about 7,200 more. That is about 35,000-45,000 runs in total. One run takes 3-7 ms at a 5-second sim (up to 17-32 ms for weak builds at 30 s). In our app that is about 3-4 minutes single-threaded, or about 40 s on an 8-worker pool. Run it in a pool of dedicated engine Web Workers (default min(8, cores - 1)), not in the interactive engine worker and not in a utility process (section 10).

## 1. Where it lives on the site

- **Buttons.** Two buttons sit in the editor sidebar: **Auto Build** and **Auto Build Settings**.
- **Running state.** While a run is in progress the Auto Build button is disabled and reads "Optimizing...". It returns to "Auto Build" when the run ends or fails.
- **Progress overlay.** A floating panel (title "Auto Build", default "Build Optimizer") shows:
  - a step line, such as "Step 3: Greedy Algorithm (3 samples)";
  - a progress bar (0-100);
  - a detail line, such as "Added Serration (DPS: 12345)";
  - a **Cancel** button. Pressing it sets a cancel flag, changes the step to "Cancelling...", and disables the button, which then reads "Stopping...".
  
  The panel hides 3 s after success and 5 s after an error. Every update is also broadcast as an `autoBuildProgress` window event and logged to the console. That is test instrumentation, and we do not need it.
- **Who can run it.** Auto Build is refused for a Warframe build, with the error "Auto build is only available for weapons.". It runs for every weapon class the site supports: primaries, secondaries, melee (with a stance step), archguns, companion claws (a separate pipeline), and Progenitor and Incarnon weapons (extra steps).
- **One run at a time.** An "operation ownership" token guards the run. If the user switches builds or enters view-only mode mid-run, the next check throws "Operation cancelled because the selected build changed.", and nothing is written.

## 2. Settings

### 2.1 Fields and defaults

Settings are a flat object per config. The defaults below are the site's function that builds the default settings. Normalisation runs on every load, save and read.

| Field | Default | Normalisation | UI (settings modal) |
| --- | --- | --- | --- |
| `simulationTimeSeconds` | **5** | integer, clamped 1-300 | "Auto Build Sim Time (s)", number 1-300 step 1 |
| `sampleSizeMultiplier` | **3** | number, clamped 0.2-1000 | "Sample Size Multiplier", number min 0.2 step 0.5 (the static HTML says 5; the modal overwrites it with the config value) |
| `finalRefinementEnabled` | **true** | `!== false` | "Final Refinement Pass" switch |
| `finalRefinementSampleSize` | **200** | integer >= 1 | "Refinement Sample Size", shown only while refinement is on |
| `luckAveragedEnabled` | **true** | `=== true` | "Luck Averaged" switch |
| `aoePreference` | `'single'` | one of single, single_with_aoe, aoe, aoe_with_grouping | "Target Priority" slider. **Hidden**: the allowed sequence for both melee and ranged is only `['single']`, so the slider never shows and the AoE code paths are dead. Do not port. |
| `buildForSingleHit` | false | bool | "Build for Single Shot/Hit" |
| `buildForFloor` | false | bool | "Build for Floor" |
| `elementalCandidatesEnabled` | **true** | `!== false` | "Elemental Candidates" |
| `specificElementalCandidatesEnabled` | false | true only when elemental candidates are also on | "Whitelist Specific Elemental Candidates" (a sub-switch, shown under Elemental Candidates) |
| `specificElementalTargets` | [] | trimmed, non-empty strings | chips + quick buttons + "Add preset..." + custom text |
| `elementalBlacklistEnabled` | false | bool | "Elemental Blacklist" |
| `elementalBlacklist` | [] | parsed and de-duplicated by element set (2.4) | chips + quick buttons + "Add preset..." + custom text |
| `costControlEnabled` | false | bool | "Cost Control" |
| `maxForma` | 5 | integer 0-10 | "Maximum Forma", shown only while Cost Control is on |
| `buildForRawDamage` | false | bool; if both raw and status are on, raw is turned off | "Build for Raw Damage" (mutually exclusive with status) |
| `buildForStatusDamage` | false | bool | "Build for Status Damage" |
| `modWhitelistEnabled` | false | bool | "Mod Whitelist" |
| `modWhitelist` | `data.json.whitelist` (31 names) | trimmed, de-duplicated | search box + list with Remove |
| `statBlacklistEnabled` | false | bool | "Stat Blacklist" |
| `statBlacklist` | [] | stat keys (2.5), aliases accepted | quick buttons + chips + "Add stat..." |
| `modBlacklistEnabled` | **true** | `!== false` | "Mod Blacklist" (its list is visible by default) |
| `modBlacklist` | `data.json.blacklist` (144 names) | trimmed, de-duplicated | search box + list with Remove |

Legacy keys are migrated: `limitedElementalCandidatesEnabled` becomes `specificElementalCandidatesEnabled`, and `limitedElementalTargets` becomes `specificElementalTargets`.

The modal's first section also holds two **hardware** controls. They are stored separately under `warframeOptimizerHardwarePreferences` as `{cpuCores, gpuEnabled}`, and are not part of a config:

- **CPU cores**: a slider from 1 to `navigator.hardwareConcurrency` (the static HTML says 4, and the code raises it). The default is all logical cores. This is the number of Web Workers.
- **GPU acceleration**: an optional WebGPU batch path, off by default. Do not port.

### 2.2 Modal behaviour

- **Opening.** Opening the modal with no build selected alerts "Select a build before adjusting auto build settings.".
- **Context line.** For the locked config it reads: Viewing "Default" (read-only). Duplicate it to make changes. For an editable config it reads: Editing "Your Config".
- **Locked config.** While the locked Default config is active, every input is disabled, and so is Save. Only the config picker, Manage and Close stay enabled.
- **Editing.** Edits change a draft. **Save** writes the draft to the active config, persists it and closes the modal. **Close** throws the draft away.
- **Switching configs** with unsaved changes asks "Discard unsaved changes?".
- **Visibility rules.** Sub-panels show only while their switch is on:
  - specific elemental: while Elemental Candidates is on;
  - specific options: while the specific switch is on;
  - the elemental blacklist list;
  - the whitelist search and list;
  - the stat blacklist options;
  - Maximum Forma;
  - the blacklist search and list;
  - Refinement Sample Size.
- **Enabling the whitelist with an empty list** refills it from the defaults in `data.json`.
- **Turning Cost Control on** has a side effect, applied once: if the build supports an Exilus slot, the slot is on and the slot is empty, the build's Exilus slot is turned off, and the build is saved and re-rendered. Do not port this; we never fill the Exilus slot anyway (4.3).

### 2.3 Configs

- **Storage.** Settings live in localStorage under `warframeAutoBuildSettingsV2` as `{activeConfigId, configs: [{id, name, locked, settings}]}`.
- **Default config.** `default` / "Default" is always present, always first, `locked: true`, and always holds the current default settings. They are recomputed, never stored values, so new data defaults flow in.
- **Your Config.** `your_config` / "Your Config" is created at first run (editable, with the defaults) and is the initial active config.
- **Invariants.** There is always at least one editable config. An unknown active id falls back to the first editable config.
- **Manage** opens the "Auto Build Configs" modal. Its intro reads "Manage multiple named auto build settings profiles.". It has:
  - **New Config**, which prompts for a name and copies the current effective settings; the new config does not become active;
  - per row: **Duplicate** ("Copy of X"), **Rename** (prompt), and **Delete** (confirm);
  - drag to reorder; the Default config stays at index 0.

  The rules, with the site's alerts:
  - Default cannot be renamed, deleted or saved: "The Default auto build config cannot be changed. Duplicate it (or create a new config) to make edits.".
  - The active config cannot be deleted: "You cannot delete the currently selected auto build config. Select a different config first.".
  - The name "Default" is reserved: "The name "Default" is reserved.".
  - Names are made unique case-insensitively with " (2)", " (3)", and so on.
  - Ids are slugs of the name.
- **Migration.**
  - An older `{global, perWeapon}` shape becomes Default, plus Your Config (from `global`), plus "Legacy: item (type)" configs.
  - An older standalone blacklist under `warframeBuildOptimizerBlacklist` is copied into every editable config, then deleted.
- **Override.** A transient override object (`autoBuildSettingsOverride`) is merged over the active config when settings are read. Only the riven "rolls scan" feature uses it, to mirror its own raw/status/floor/single-hit toggles. A plain Auto Build run never sets it.

### 2.4 Elemental targets: the specific whitelist and the elemental blacklist

Both lists use the same presets (15): Heat, Cold, Electricity, Toxin, Viral, Corrosive, Radiation, Blast, Gas, Magnetic, Viral Heat, Viral Electricity, Corrosive Heat, Corrosive Cold, Corrosive Blast.

- **Quick buttons**: Heat, Viral, Viral Heat. Each toggles its entry.
- **"Add preset..."**: a select listing the other presets.
- **Custom text**: free combinations such as "Viral Heat" or "Corrosive Blast".

Parsing of a label:

1. "No Element" or "None" means an empty target.
2. A preset name maps to its element list.
3. Anything else is split on `,` `+` and whitespace. Each token is normalised through aliases: fire = Heat, freeze = Cold, poison = Toxin, electric = Electricity; other tokens are capitalised.
4. The element set is sorted and de-duplicated.

The elemental blacklist is also de-duplicated by its element set, and empty targets are dropped.

- **Specific whitelist semantics.** When it is on and non-empty, the parsed targets **replace** the weapon's default candidate list (3.3). "No Element" is not added unless it is listed. The final refinement then keeps the element signature (4.6).
- **Elemental blacklist semantics.** A build is blocked when its element signature contains **all** elements of any blacklisted target, so blacklisting "Heat" blocks every build that ends up with Heat in it. The check runs in four places:
  - on each candidate target;
  - on each composition and greedy candidate build;
  - on each refinement swap;
  - on the final build.

  If it blocks the final build, the run fails ("The final build was rejected by the elemental blacklist.").

The signature is the list of final element types of the selected fire mode, innate elements included.

### 2.5 Stat blacklist

There are 16 options, keyed as follows: `damage` Damage, `critChance` Critical Chance, `critDamage` Critical Damage, `statusChance` Status Chance, `multishot` Multishot, `speed` Fire Rate/Attack Speed, `punchThrough` Punch Through, `reloadSpeed` Reload Speed, `magazine` Magazine, `faction` Faction Damage, `cold`, `heat`, `electricity`, `toxin`, `initialCombo` Initial Combo, `range` Range.

The quick buttons are Damage, Fire Rate/Attack Speed and Multishot. The other options sit behind "Add stat...". Labels and aliases normalise to keys: "crit chance", "fire rate", "attack speed", "magazine size" and so on.

A mod is dropped when any of its stat families is blacklisted. Families are derived from each stat's `UpgradeType`:

| Family | `UpgradeType` contains |
| --- | --- |
| critChance | CRITICAL_CHANCE or CRIT_CHANCE, but not SLIDE |
| critDamage | CRITICAL_DAMAGE or CRIT_DAMAGE |
| statusChance | PROC_CHANCE or STATUS_CHANCE |
| multishot | MULTISHOT or FIRE_ITERATIONS |
| punchThrough | PUNCTURE_DEPTH |
| speed | FIRE_RATE or ATTACK_SPEED |
| damage | equals WEAPON_DAMAGE_AMOUNT, or contains MELEE_DAMAGE or DAMAGE_AMOUNT |
| reloadSpeed | RELOAD_SPEED |
| magazine | CLIP_MAX, MAGAZINE or AMMO_MAX |
| faction | FACTION_DAMAGE or DAMAGE_TO_FACTION |
| initialCombo | INITIAL_COMBO |
| range | equals WEAPON_ATTACK_RANGE, or ends with _RANGE |
| cold, heat, electricity, toxin | a base-damage-added stat (`WEAPON_PERCENT_BASE_DAMAGE_ADDED` or the `_POST_COALESCE` variant) of that element |

Name-based extras:

- Hunter Synergy counts as critChance.
- Mecha Overdrive counts as statusChance.
- The Semi-Cannonade mods, and any mod whose description says fire rate cannot be modified, count as speed.

### 2.6 Mod blacklist and whitelist UI

- **Blacklist.** The search box ("Search for a mod or arcane to add...") matches substrings of every mod name, every arcane name and the literal "Riven Mod", minus entries already listed. Results are sorted and capped at 50; clicking one adds it. The list below is sorted A-Z, each row with a **Remove** button, and an empty list reads "No items in the blacklist.". The blacklist applies to **arcanes too**.
- **Whitelist.** The same pattern, mods only ("Search for a mod to add..."), with the empty text "No mods in the whitelist.".
- **No filtering in the UI.** Neither list filters by weapon compatibility in the UI. The filter is applied at run time.

## 3. Inputs, candidate pools and filters

### 3.1 What a run reads

- **The active build.** Its weapon, its mods (slots that are filled are **locked**: they are never removed or swapped) and its arcanes (filled arcane slots are locked).
- **The current editor context**:
  - the selected fire mode, or for melee the stance combo;
  - the enemy config, as on the live readout;
  - the headshot toggle;
  - the "accurate ammo" toggle;
  - external statuses and buffs;
  - the active conditionals.
- **The effective settings.**

The sim time is the **Auto Build** sim time (default 5 s), not the editor's. The enemy, mode, headshots and buffs are the editor's.

### 3.2 Run-time blacklist additions

These are added to the user's blacklist for this run only:

- **Riven Mod**, always. Rivens are never candidates. A riven already in the build is a locked slot and stays.
- When headshots are off: Galvanized Scope, Galvanized Crosshairs, Primary Deadhead and Secondary Deadhead (the last two are arcanes).
- When no selected leaf mode is a heavy attack or a recall explosion: Killing Blow and Corrupt Charge (melee).
- In the hidden AoE modes: every Condition Overload-style mod (dead code).

When the mod blacklist switch is off, only these additions apply.

Every pool below is filtered by the **blacklist**, the **whitelist** (when on: only listed names pass) and the **stat blacklist**. Weapon compatibility is checked as well:

- the mod's `Type` must match the weapon;
- the `Compat Name` rules apply (rifle mods fit non-shotgun primaries, pistol mods fit secondaries, a weapon-specific augment fits only its weapon family);
- weapon tag rejections apply;
- Sinister Reach and Split Flights have special cases;
- Semi-Cannonade mods need `cannonade_compatible`.

The **incompatible_mods** table is respected pairwise in both directions: Primed and un-Primed versions, and mutually exclusive mods. Conclave (PvP) mods are not filtered in the main pipeline. The only PvP entries in `data.json` are 21 stances, all in the default blacklist, so they matter only for melee.

### 3.3 Elemental targets ("possibilities")

| Weapon | Default target list (always plus "No Element") |
| --- | --- |
| Rifle-type primary (not shotgun) | Heat; Viral; Viral + Heat; Corrosive; Corrosive + Heat |
| Shotgun | Heat; Viral; Viral + Electricity; Corrosive; Corrosive + Cold |
| Secondary | Heat; Viral; Viral + Heat; Corrosive; Corrosive + Heat |
| Melee | Viral (raw); Corrosive (raw); Electricity; Toxin; Toxin (raw); Viral + Electricity; Gas + Electricity |

Targets are added from the weapon's innate elements (only when no specific whitelist is set and elementals are on):

- shotgun with innate Heat: Viral + Heat, Corrosive + Heat;
- rifle with innate Toxin: Toxin;
- melee with innate Heat: Gas + Electricity;
- melee with innate Toxin or Cold: Viral + Electricity;
- Torid in Incarnon Form: three special targets.

When the **Xata's Whisper external buff** is active, the run adds Blast, Blast + Toxin, and Corrosive + Blast (the last with exactly 4 mods). This matters for the External Buffs port.

Each target is then completed with the weapon's innate elements that its combined elements do not consume. For example, a weapon with innate Toxin aiming at Viral does not need an extra Toxin. "No Element" becomes exactly the innate elements. Targets blocked by the elemental blacklist are removed.

- When **Elemental Candidates** is off, the only target is "No Element". No elemental mods are placed, but the greedy fill can still add the direct Radiation and Magnetic mods (3.4).
- When the **specific whitelist** is set, the targets are exactly the parsed list.

### 3.4 The three mod pools

1. **Elemental pool** (compositions). Compatible mods that have a base-damage-added stat whose damage type is not Impact, Puncture or Slash. This includes dual-stat mods such as Thermite Rounds and Malignant Force. It excludes the "direct combined" mods that add Radiation or Magnetic outright, a fixed list of 14 names: Accelerated Isotope, Atomic Fallout, Containment Breach, Critical Meltdown, Focus Radon, Magnetic Capacity, Magnetic Claws, Magnetic Might, Magnetic Rush, Magnetic Strafe, Magnetized Core, Magnetized Cycle, Radiated Reload, Radon Claws. For Braton Prime with the default blacklist there are 9: Hellfire, High Voltage, Infected Clip, Malignant Force, Primed Cryo Rounds, Rime Rounds, Stormbringer, Thermite Rounds, Wildfire.
2. **Greedy pool** (filling). Compatible mods with a "DPS stat" that are not elemental. The direct Radiation and Magnetic mods are allowed here.
   - A **DPS stat** is an `UpgradeType` containing DAMAGE, CRIT, FIRE_RATE, FIRE_ITERATIONS, PROC_CHANCE, RELOAD_SPEED or STATUS_CHANCE, or equal to WEAPON_ATTACK_RANGE, or ending in _RANGE.
   - **Always admitted**: Internal Bleeding for primaries and Hemorrhage for secondaries, if compatible; Blood Rush, Weeping Wounds and Galvanized Reflex for melee.
   - For Braton Prime this pool has 27 mods, including Vile Precision, an Exilus mod that can also go in a normal slot. (Vile Acceleration, Hammer Shot and Speed Trigger are not Exilus mods: `data.json.exilusMods` is the list.)
3. **Refinement pool** (swaps). Mods of exactly the weapon's mod `Type` that are compatible and have a DPS stat, **or** are weapon-specific augments. It **excludes everything in `data.json.exilusMods`**, unlike the greedy pool. **Elemental mods are included**, unless elemental swaps are restricted (4.6). For Braton Prime this pool has about 35 mods.

### 3.5 Arcane candidates

The candidates are the arcanes that fit the slot's category:

- for primaries: a name starting with "Primary", or a conditional entry typed Primary or typed with the weapon subtype;
- for secondaries: the same, with "Secondary";
- kitguns use the Pax and Residual names, Zaws their own, and archguns allow both.

They are filtered by the blacklist and by element requirements: Primary Frostbite needs Cold, Primary Blight needs Toxin, Cascadia Flare needs Heat, Conjunction Voltage and Melee Influence need Electricity. The requirement is met by the build's final elements, by an extra-hit element, or (Frostbite only) by an external status. Companions have no arcanes.

Arcanes are equipped by **name**, at max rank. A build with one normal arcane slot is tested one arcane at a time in slot 0. Kitgun and archgun slots with specialised categories enumerate the full cartesian product of their per-slot candidates, including "none", while respecting locked slots.

## 4. The pipeline (weapons other than companion claws)

Notation: `runs(b) = max(1, round(b / 5 x multiplier))`. With the default multiplier 3, that gives runs(5) = 3, runs(10) = 6, runs(20) = 12, runs(30) = 18, runs(40) = 24 and runs(50) = 30. A **job** scores one candidate build: it runs the engine `runs` times and averages the metric (4.8). Jobs are spread over the worker pool.

### 4.0 Preparation

1. Snapshot the build (deep copy) and record the **locked mod indices** (every filled slot).
2. Record the locked arcane indices. If every arcane slot is filled, the arcane steps are skipped.
3. **Force-equip weapon-specific elemental augments.** These are augments whose conditional entry grants elemental damage. Each one goes into the first empty non-stance, non-Exilus slot at max rank and becomes locked. One already equipped is ranked up to max and locked.
4. Build the run's blacklist (3.2) and the shared engine input: enemy, the Auto Build sim time, mode, ammo setting, initial combo, armour strip, and the app state with external statuses and active conditionals.
5. Hand off to the separate companion-claw pipeline if needed; then, for melee without a valid stance, run the stance step (out of scope for us).

### 4.1 Step 1.5: arcane pre-pass (progress 5%)

On the starting build (normally empty apart from locks):

1. Score the current arcane loadout as the baseline. Use 10 runs; this count is **not** scaled by the multiplier.
2. Score every arcane candidate in slot 0, 10 runs each.
3. Keep the best one if it beats the baseline.
4. Keep the full **ranked list** as a *fallback order*. Whenever a later build makes the chosen arcane ineligible (for example, the elements changed and Primary Blight lost its Toxin), the slot is refilled with the best still-eligible arcane from that list, with no new simulation.

**Step 1.55, secondaries only**, when elementals are on, Secondary Enervate is not blacklisted and a compatible Heat mod exists. The run seeds two builds with that Heat mod in the first slot: one with the current arcane and one with Secondary Enervate. It greedy-fills both (runs(5) per candidate), scores both (runs(5)) and keeps Enervate if it wins. The detail line shows either "Selected Secondary Enervate (X DPS, +Y)" or "Kept ... (X DPS)".

### 4.2 Step 2: elemental compositions (progress 10-35%)

1. **Step 2.1, "Determining Best Base Element".** For Heat, Cold, Toxin and Electricity in turn, place the highest-rank compatible single-element mod for that element in the first empty slot, and score the build (runs(10)). The winner is only **reported** ("Best base element is X."). Nothing later uses it. Porting it is optional; it costs 4 jobs.
2. **Step 2.2, "Finding Best Compositions".** The number of elemental slots is `k = min(3, number of empty non-Exilus slots)`, unless the target fixes it (4 for the special Corrosive + Blast targets). For each target and for each size from 1 to k:
   - enumerate every combination of that many **distinct** mods from the elemental pool, and **every ordering** of each combination, because element order decides which pairs combine;
   - skip orderings that contain a mod already equipped, or that conflict (`incompatible_mods`) with the equipped mods or with each other;
   - place the mods at max rank into the first empty non-Exilus slots, in order;
   - with Cost Control on, skip it if it does not fit capacity (4.7);
   - skip it if the elemental blacklist blocks it;
   - compute the build's final element list for the selected mode and keep the ordering only if it **equals the target exactly**, as sorted sets.

   Every kept ordering becomes a job (runs(10)). For Braton Prime the 9 mods give 585 orderings of size 1-3, and about 130 of them match one of the 5 targets.
3. **Result: the "candidate bases".**
   - "No Element" with zero added mods (target = the innate elements).
   - A zero-mod base for a target that equals the innate elements.
   - For each (target, size), the single best-scoring ordering, named "Viral Heat (3 mods)" and so on.

   For a rifle that is typically about 10-16 bases.
4. **Several leaf modes.** When the selected recipe mode has several leaf modes, the step runs once per leaf mode and merges the bases, de-duplicated.

### 4.3 Step 3: greedy fill per base (progress 35-70%)

For each base, the composition's mods go into the first empty non-Exilus slots, and any arcane fallback is applied. Then, repeatedly:

1. Take the **first empty slot that is not the Exilus or stance slot**. If there is none, stop.
2. The candidates are the greedy pool minus the equipped mods and minus mods incompatible with them.
3. Try each candidate in that slot at **max rank**. With Cost Control on, **also try floor(max/2)**. Drop tries that break capacity or the elemental blacklist.
4. Score every try (runs(10)) and equip the best one, by strictly greater mean, so ties go to the first in data order. The detail line reads "Added X (DPS: N)".
5. Stop when no candidate is left.

Then re-apply the arcane fallback and score the filled build with runs(5).

**The site never fills the Exilus slot**, and neither the stance slot outside the stance step. A mod already in the Exilus slot is simply kept. This app adds a step 7.5 for an empty Exilus slot (section 14).

### 4.4 Step 4: top 3 (progress 70-95%)

1. Sort the filled bases by score and keep the **top 3**.
2. For each one, run the greedy fill again with runs(30). Every slot is already full at this point, so this fill **normally does nothing**; it only matters if Step 3 ran out of candidates and left holes.
3. Re-apply the arcane fallback.
4. Score with runs(50), in chunks of 10 runs per job.

**Step 5, arcane re-optimisation per top-3 candidate** (progress 87-95%). The run re-runs the arcane search on the full build, with runs(30) per arcane plus the baseline, and scores the result with runs(50). The new arcane is kept only if that score beats the candidate's score. The detail line reads "Selected A (X DPS, +Y)", "No better arcane found." or "A tested; keeping B.".

Incarnon evolution steps (2.7 and 4.3) are ported (docs/port-incarnon.md section 7). The stance re-check (4.5) and Progenitor element logic also run here for weapons that have them; both are out of scope for us.

### 4.5 Step 6: final selection (progress 95%)

Sort by score and pick the best. There is no tie-break beyond the sort order.

### 4.6 Step 7: final refinement pass (progress 97%), when enabled

This is a local search on the winner. The sample size is `finalRefinementSampleSize` (default 200). It is **not** scaled by the multiplier, and it is chunked into jobs of 10 runs.

1. Score the winner (200 runs).
2. Repeat up to **10 iterations**:
   1. The *swappable* mods are those not locked, not a riven, not in the aura, stance or Exilus slot, and not forced. If there are none, stop ("No auto-slotted mods to refine. Finalizing.").
   2. For each swappable mod, score the build **without** it (200 runs each). The "worst" mod is the one whose removal leaves the **highest** score, that is, the least useful mod.
   3. Empty that slot. The candidates are the refinement pool, minus equipped mods, minus mods incompatible with them, minus the Radiation/Magnetic restriction below. Each is tried at max rank (and half rank with Cost Control), and a try is skipped if it:
      - breaks capacity;
      - breaks an equipped arcane's element requirement;
      - is blocked by the elemental blacklist;
      - when the specific elemental whitelist is active, changes the build's element signature.
   4. Score every remaining try (200 runs each), one candidate at a time, each split into 10-run chunks across the workers.
   5. If the best try beats the current score, swap it in ("Swapped X for Y. DPS: a -> b") and iterate. Otherwise stop ("No further improvements found for X. Finalizing build.").

**Restricted elemental swaps** apply when the targeting is not single (dead) or when the specific elemental whitelist is active. Without the whitelist, the restriction admits only mods whose elements are all Magnetic or Radiation. With the whitelist, the signature check above replaces it.

Only **one slot** is reconsidered per iteration. The current score is carried forward from the accepted swap's measurement; it is not re-measured.

**Step 7.5.** Re-apply the arcane fallback. If it changed anything, re-score with runs(30).

### 4.7 Step 8: final arcane check, Step 9: cosmetic swaps, then apply

- **Step 8 (progress 98%).** Re-run the arcane search on the refined build (runs(30) per arcane), score with runs(50), and keep the result if it is better.
- **Step 9, "Final Quality-of-Life Swaps" (progress 99%).** No simulation is involved:
  - **Heavy Caliber -> Serration** when Serration is allowed, not equipped and not in conflict. This is unconditional, even though Heavy Caliber also lowers accuracy and the DPS can differ slightly.
  - Each **conditional mod** (galvanized and misc conditional mods) is replaced by a non-conditional mod with **identical stats at max rank**, when one exists, is allowed and is not equipped.
  - Weapon-specific augments are skipped, and so are Blood Rush, Weeping Wounds, Galvanized Reflex, Internal Bleeding and Hemorrhage.
  - The detail line reads "Swapped: A -> B, ...".
- **Final check.** If the final build fails the elemental blacklist, the run errors.
- **Apply.**
  1. The build's `mods` and `arcanes` are **replaced in place** (and `progenitor` / `incarnon` where relevant). Locked arcane values are re-asserted.
  2. **All active conditionals are reset**, then each newly equipped item's conditional is switched on.
  3. The build is saved and the editor re-rendered.
  4. The overlay reads "Finished! Best DPS: N" and hides after 3 s.

  There is **no preview, no comparison and no undo** on the site. The previous build is simply overwritten in local storage.

**Cost Control's capacity check.** A build passes when the site's polarity optimiser (`calculatePolarityOptimizationPlan` with `maxForma`, which counts existing Forma toward the total) can choose slot polarities so that the remaining capacity is >= 0. The capacity is 60 with a catalyst (30 without), plus the Progenitor/adversary Forma bonus where applicable. The optimiser only answers "can it fit". Auto Build **does not write** any Forma or polarity to the build. With Cost Control off, capacity is never checked, and the result can be over capacity.

### 4.8 Scoring metric and simulation modes

Every engine run returns `avgDps`, `avgRawPerShot`, `avgDotPerShot`, `firstHitDamage`, `ttk`, and so on. The job's metric per run:

| Mode | Metric |
| --- | --- |
| default | `avgDps` |
| Build for Raw Damage (`useRawDamage`) | `avgRawPerShot` |
| Build for Status Damage (`singleHitMode = 'status'`) | `avgDotPerShot` |
| (internal) `singleHitMode = 'total'` / `'raw'` | raw + dot per shot / `firstHitDamage`; not reachable from the weapon pipeline |

Modifiers that change the simulation, not the metric:

- **Build for Single Shot/Hit.** The engine input gets `simulationParams.forceSingleShot = true`, and custom fire modes get `fireOnce: true`. The metric is still the one above. (In the site's code a separate run-count multiplier of 100 exists for a "single hit" mode, but the weapon pipeline always passes `useSingleHit = false`, so it is never used for guns.)
- **Build for Floor.** When the per-candidate stats are computed, each mode's `finalCritChance`, `finalStatusChance` and `simulationPerProjectileStatusChance` are floored to a multiple of 100 (these are percentages: 235% becomes 200%). `finalMultishot` is floored to an integer, minimum 1. This scores the build by its guaranteed crit tier and guaranteed multishot, with no luck.

Stats for each candidate are computed exactly as for the live readout. Every conditional mod or arcane in the candidate is auto-activated at **max stacks** for the evaluation. The run score is the arithmetic mean of the per-run metrics; failed runs are dropped from the mean.

### 4.9 Sampling, determinism and noise

- **Luck Averaged on** (the default). Each job seeds the engine with `seed_rng(base + i)` for runs i = 0..n-1. `base` is a 32-bit hash of the job id, job type, build, weapon stats, enemy, sim params, combo, run count, metric mode and the flag. Results are therefore **reproducible**: the same build and settings give the same picks. The seeds differ between candidates, so this is **not** "common random numbers".
- **Luck Averaged off.** Runs are unseeded; the engine RNG simply continues.
- **Noise we measured** (Braton Prime with 4 mods, 5 s): one run has an SD of about 9.6% of the mean, so a 6-run mean has about 3.9%, an 18-run mean about 2.3%, and a 200-run mean about 0.7%. The greedy fill (6 runs) therefore often cannot tell close candidates apart. The final refinement (200 runs) exists to fix that.

### 4.10 Workers, cancellation, progress

- **Workers.** The site creates `cpuCores` Web Workers per run. Each worker gets the engine JS and wasm binary inline and caches the app state once (`cache_app_state` with a token; later jobs send `appStateRef`). Jobs go out from a queue: a worker takes the next job when it finishes one.
  - Per job, the main thread computes the weapon stats and conditional stats, and the worker runs the engine `runCount` times. The worker uses the prepared-candidate fast path when `runCount > 1` and the engine supports it.
  - Arcane baselines run on the **main thread** (`getAverageDpsHeadless`).
  - The site tears the workers down at the end of every run.
- **Cancellation.** The Cancel button sets a flag. It is checked:
  - before each greedy slot;
  - in every refinement loop;
  - on every job completion;
  - by a 200 ms interval timer in the job runner.

  Cancelling terminates all workers and throws "Operation cancelled by user.". The overlay then shows "Error!" with that message. Nothing is written to the build.
- **Progress.** The percentages are fixed per step: 0 initialising, 5 arcane, 10-35 elementals, 35-70 greedy (linear over the bases), 70-95 top 3, 87-95 arcane re-opt, 95 selection, 97 refinement, 98 arcane check, 99 cosmetic swaps, 100 done. The step text includes the sample count.

## 5. data.json lists

- **`blacklist` (144 names), the default mod blacklist.** It holds 133 mods and 10 arcanes; one name ("Riven Mod") is synthetic. The mods are 34 primary, 33 secondary, 39 melee, 21 stance, 5 warframe and 1 aura. All 21 PvP mod names in `data.json` are in it. In effect it removes four kinds of mod:
  1. **mods dominated by a better version**: un-Primed and Amalgam variants (Split Chamber, Point Strike, Cryo Rounds, Barrel Diffusion, Pistol Gambit, Target Cracker, Convulsion, Pressure Point, True Steel, Fever Strike, Heavy Trauma, Sure Shot...) and lower faction mods (Bane / Cleanse / Expel / Smite of each faction, except the Primed ones kept for Grineer and Orokin);
  2. **utility mods with no or a situational DPS value** (Fast Hands, Loose Magazine, Full Capacity, Toxin Resistance, Antitoxin, Counterweight...);
  3. **Conclave (PvP) stances** (Argent Scourge, Crashing Havoc, Shadow Harvest...);
  4. **set mods and other niche mods** (Gladiator set mods, Synth Charge, Saxum/Carnis/Jugulus set mods).

  The 10 arcanes in it are Akimbo Slip Shot, Cascadia Overcharge, Melee Afflictions, Melee Careen, Primary Bulwark, Primary Dexterity, Primary Overcharge, Secondary Dexterity, Secondary Encumber and Secondary Outburst.
- **`whitelist` (31 names), the default mod whitelist.** It is a "budget/common" set: Serration, Split Chamber, Point Strike, Vital Sense, Hellfire, Cryo Rounds, Stormbringer, Infected Clip, Point Blank, Hell's Chamber, Ravage, Incendiary Coat, Chilling Grasp, Charged Shell, Contagious Spread, Hornet Strike, Barrel Diffusion, Pistol Gambit, Target Cracker, Heated Charge, Deep Freeze, Convulsion, Pathogen Rounds, Pressure Point, Fury, True Steel, Organ Shatter, Molten Impact, North Wind, Shocking Touch, Fever Strike. These are un-Primed mods that a new player owns.
  - **Edge case.** Ten of the whitelist names (Split Chamber, Point Strike, Cryo Rounds, Barrel Diffusion, Pistol Gambit, Target Cracker, Convulsion, Pressure Point, True Steel, Fever Strike) are also in the default **blacklist**. Both filters apply. A user who turns on the whitelist but leaves the blacklist on loses those ten, so a "budget rifle" gets no Split Chamber. The site does nothing about this; we document it in our UI (9.3).
  - **Our app already uses this list** as `ctx.popular`, the "popular" flag in the picker.
- **`exilusMods` (157 names).** They are excluded from the refinement pool only (3.4).

## 6. Edge cases and messages (site)

| Situation | Behaviour / message |
| --- | --- |
| No build | "Build not found." (error) |
| Warframe build | "Auto build is only available for weapons." |
| Weapon data missing | "Weapon data not found for this build." |
| Build switched mid-run | "Operation cancelled because the selected build changed." |
| Cancel | "Cancelling..." / "Stopping...", then "Error!" "Operation cancelled by user." |
| All slots filled (locked) | The arcane steps still run, and the greedy and refinement steps do nothing. The result equals the input plus the arcane. |
| All arcane slots filled | "Existing arcanes (X) locked; skipping optimization." at each arcane step |
| No arcane slot | "No arcane slot detected; skipping." |
| No candidate survives the elemental blacklist (Progenitor path) | "No auto build candidates remain after applying the elemental blacklist." |
| The winner or the final build is blocked by the elemental blacklist | "The selected candidate was rejected by the elemental blacklist." / "The final build was rejected by the elemental blacklist." |
| No candidates at all | "Optimization failed to find a suitable build." |
| A whitelist that leaves no candidates | The greedy fill stops early and slots stay empty. There is no message. |
| An elemental augment with no free slot | console warning only; the run continues |
| A worker error on one job | That job is dropped from the comparison. A failing run inside a job is dropped from its mean. |

## 7. What the result changes

- **Changed**: the mods (only empty, non-Exilus slots) and the arcanes (only empty slots); a Heavy Caliber or conditional mod may be swapped in Step 9.
- **Unchanged**: polarities, Forma, the Exilus slot, rivens, the target, the fire mode and every setting.
- **Conditionals**: reset, with the new items' conditionals switched on.
- **No preview, comparison or undo.** The site shows only the final "Best DPS" number in the overlay.

## 8. Out of scope for our port (not supported by this app)

- Melee and stances (Steps 1 and 4.5); melee-only targets and raw candidates.
- Companion claws (their own pipeline).
- Archguns and kitguns (multi-slot arcane products). The app has no archguns; kitguns are unsupported (`isKitgun`).
- ~~Incarnon evolution selection (Steps 2.7 and 4.3); the app does not model evolutions.~~ Ported with the evolutions (docs/port-incarnon.md section 7).
- Progenitor element logic; the app does not model the Progenitor bonus.
- AoE targeting modes (hidden on the site too).
- GPU batching, the external-runner hooks, the `autoBuildProgress` event and the `__lastAutoBuildResult` global.
- The riven rolls-scan override and "minor tweaks" (they reuse the blacklist, whitelist and stat blacklist, but they are separate features).
- The Cost Control side effect on the Exilus toggle.

The Xata's Whisper extra targets depend on the External Buffs port. Wire them in once external buffs exist (3.3).

## 9. Port plan for Underframe Desktop

### 9.1 Decisions (made here; the user asked not to be asked)

1. **Faithful algorithm, primaries and secondaries only.** Same steps, the same run-count formula and the same defaults (sim time 5 s, multiplier 3, refinement on with 200 runs, Luck Averaged on, mod blacklist on with the defaults). Step 2.1 (the base-element probe) is kept for progress parity; it costs about 24 runs. The Step 4 "re-greedy" is kept as written, since it is cheap.
2. **Seeds: common random numbers.** With Luck Averaged on, every evaluation in a step uses the **same** seed list 1..n. This deviates from the site's per-candidate hash: it is still deterministic, and it makes the comparisons between candidates much less noisy for the same cost. With Luck Averaged off, each evaluation draws its seeds at random. Document this as a known difference.
3. **Filled slots are locks, as on the site.** The Exilus slot is never filled. A filled arcane slot is a lock. To get a full auto build, the user clears the build first. The Auto Build dialog says this in one line ("Mods already equipped stay; empty slots are filled.").
4. **Apply as one undoable edit.** Record a single `history` step, then show a success toast: "Auto Build: X -> Y DPS (+Z%)" with **Undo** (`ctrlZ: true`), using the existing `notify`. The Readout's delta badge then compares automatically, because the previous completed result is the pre-build state. We do not port the site's conditional reset; our stats model has no conditional toggles.
5. **The search sim time is separate from the build's.** Candidates are scored with the Auto Build sim time. After applying, the normal live simulation runs with the build's own `simTime` and its 8 seeds. The toast reports the **live** result, not the search score, because the scores are not comparable across sim times.
6. **Configs.** Port Default (locked, read-only) plus Your Config, named configs, and the Duplicate, Rename, Delete and reorder rules. Persist them in renderer localStorage through `storageGet`/`storageSet` under `uf.autoBuild` (shape `{activeConfigId, configs}`), and the CPU-core preference under `uf.autoBuildCores`. Do not read the site's keys.
7. **Lists.** Keep the mod blacklist (mods **and** arcanes), the whitelist, the stat blacklist, the elemental blacklist and the specific elemental whitelist, all with the same semantics and presets. Our search for adding entries reuses `src/shared/mod-search.js`. For the blacklist, we add the arcanes and "Riven Mod" as entries.
8. **Cost Control** maps onto `src/shared/capacity.js`. A candidate passes if some assignment of at most `maxForma` total Forma (existing overrides count toward it), over the 8 general slots and the Exilus slot, makes `capacityUse <= capacityOf({catalyst, forma})`. Implement it as greedy slot re-polarisation by the largest drain saving, which matches the site's planner closely enough for a feasibility test. Like the site, do not write Forma to the build.
9. **Run-time additions** as on the site: Riven Mod; the Galvanized Scope/Crosshairs and the Deadhead arcanes when the target's headshot flag is off. Melee-only additions are not needed.
10. **Single Shot/Hit and Floor.** Port both. Single Shot sets `simulationParams.forceSingleShot = true` in our engine input. Floor post-processes our `computeWeaponStats` modes as described in 4.8. Our `finalCritChance` is in percent (`crit_chance` 12 = 12%), so the rule is the same.

### 9.2 Code shape

- **`src/shared/auto-build.js`** (pure, node-testable): pool building (3.2-3.5), target parsing (2.4), the element signature via `computeWeaponStats(...).modes[...].finalDamageTypes` (our `combineElements` order rules), the staged pipeline as an async generator, and settings normalisation.
  - It takes an injected `score(jobs) -> Promise<number[]>` and a `signal` for cancellation. It yields progress events `{percent, step, detail}`.
  - Unit-test it with a fake scorer (pick order, locks, the filters, blacklist semantics, the whitelist+blacklist intersection, the Cost Control half-rank, refinement stop rules) and with one real-engine smoke test (a short budget on Braton Prime).
- **`src/renderer/auto-build-pool.js`**: N engine workers (the existing `engine.worker.js`, extended with a `simulateBatch` request). For each item `{input, seeds, metric}` the worker:
  - uses `prepare_canonical_candidate_v1` and `calculate_prepared_canonical_trial_v1` when supported (falling back to `calculate_dps_wasm`), and releases the preparation;
  - returns only the mean metric and the error count.

  The pool dispatches dynamically (a worker pulls the next job when it finishes one). Each worker caches the weapon's app state once (1.8 MB, 70-110 ms per worker).
- **Controller**: `actions.autoBuild()`, `actions.cancelAutoBuild()`, and a store slice `autoBuild: {status, percent, step, detail, error}`. A token guard drops the result if the opened build changed, as `sweepToken` does. The engine inputs are built on the renderer thread (about 0.1 ms each, so 40k candidates take about 4 s spread over the run); yield to the event loop between batches.
- **UI** (placement per docs/declutter-spec.md):
  - an "Auto build" command in the Loadout header, next to the build actions;
  - the settings in a Dialog with the same sections and switches as 2.1 (minus Target Priority, GPU and Exilus side effects);
  - progress as a card in the Readout area (step, bar, detail, Cancel) while running;
  - the result as the undo toast.

  Keep the smoke test's rules: no tiny targets, no pointer-blocked controls, and controls stay put at rest.
- **Smoke extension**:
  1. Open Auto Build Settings and set a tiny budget (multiplier 0.2, refinement off).
  2. Run it on an empty Braton Prime with real OS clicks.
  3. Assert that slots get filled, the toast appears, Undo restores the empty build, and Cancel mid-run leaves the build unchanged.
  4. Add scenes for the settings dialog and the running card.

### 9.3 Copy (ours)

- Blacklist help: "Auto Build never uses these. Arcanes count too."
- Whitelist help: "Auto Build only uses these mods. The blacklist still applies."
  - When a whitelisted name is also blacklisted, show a warning row: "N whitelisted mods are also blacklisted and won't be used."
- Elemental blacklist help: "Skips any build whose elements include all of a listed combination."
- Stat blacklist help: "Skips mods that change these stats."
- Cost Control help: "Only builds that fit capacity with at most N Forma. Also tries half-rank mods."

## 10. Feasibility measurements (this machine: i7-13700K, 16 cores / 24 threads; node, same wasm)

These were measured on Braton Prime against the default target (Elite Crewman, level 145, Corpus), using our `engineInputFor`.

| Build | 5 s sim | 30 s sim | 60 s sim |
| --- | --- | --- | --- |
| empty (TTK > sim) | 3.0-3.9 ms/run | 17 ms/run | 34 ms/run |
| 2 mods | 4.9-5.9 ms | 13.7-31.8 ms | |
| 4 mods | 4.9-5.5 ms | 6.7-17.1 ms | |
| 8 mods (kills in 1.9 s) | 2.7 ms | 2.7 ms | 2.7 ms |

- A run ends at the kill, so the cost is about min(TTK, sim time) x 0.55 ms per simulated second, plus a fixed cost.
- The site's 5 s search sim time caps the cost at about 6-7 ms per run. Using the build's 30 s default would make weak early candidates 3-5x slower, which is why decision 9.1.5 keeps a separate search sim time.
- Building one engine input (`computeWeaponStats` + JSON): about 0.1-0.2 ms cold, 0.02 ms warm.
- The prepared-candidate path costs 5.0 ms per run against 6.3 ms for `calculate_dps_wasm` on the same 4-mod build: **about 20% faster**, with identical results.
- The same seed gives the identical result (verified).

**Run budget at the site's defaults, empty Braton Prime** (9 elemental and 27 greedy candidates, 10 arcanes):

| Step | Engine runs |
| --- | --- |
| 1.5 arcane pre-pass | 110 |
| 2.1 base element probe | 24 |
| 2.2 compositions (about 127 matching orderings x 6) | 762 |
| 3 greedy fill (about 12-16 bases x up to 8 slots x about 20-27 candidates x 6) | 11,000-14,400 |
| 4 top-3 scoring | 90 |
| 5 arcane re-opt (3 x (11 x 18 + 30)) | 684 |
| 7 refinement, **per iteration** ((8 removals + about 28 replacements) x 200) | about 7,200 |
| 8 final arcane check | 228 |
| **Total** | **about 20,000-23,500 + 7,200 per refinement iteration** (typically 2-4 iterations: some accepted swaps, then one rejected) |

So expect about **35,000-45,000 runs**, at about 3-7 ms each.

**Throughput of N engine instances** (worker_threads, 120 runs each, the work split statically):

| Instances | runs/s | Memory (RSS total) |
| --- | --- | --- |
| 1 | 171-174 | 130 MB |
| 4 | 646-648 | 180-270 MB |
| 8 | 1,056-1,093 | 330-390 MB |
| 12 | 664-673 | 540-740 MB |
| 16 | 566-579 | 870-880 MB |
| 22 | 563-578 | 1.2 GB |

Throughput scales up to 8 instances (the P-cores), then drops. With a static split, the slowest workers (E-cores and SMT siblings) set the pace, and the extra instances add memory pressure. Dynamic dispatch would recover part of that, but beyond 8 the gain is small and the memory cost is large: each engine instance takes about 35-50 MB, and caching its app state takes 70-110 ms, rising to 300-450 ms when 16-22 instances start at once.

**Estimated wall time for a default run on an empty Braton Prime**:

| Setup | Time |
| --- | --- |
| 1 engine instance, as with our current single worker | about 3-4 min |
| 4 workers | about 60-70 s |
| **8 workers** | **about 35-45 s** |
| 8 workers, multiplier 1 (runs(10) = 2) | about 20 s; refinement dominates |

The prepared path takes a further 15-20% off.

**Recommendation.**

- Run Auto Build on a **dedicated pool of engine Web Workers in the renderer**, separate from the interactive engine worker, so the live readout and the best-mod sweep stay responsive.
- Default the pool to **min(8, navigator.hardwareConcurrency - 1)**. Offer the site's "CPU cores" slider (1 to hardwareConcurrency) in the settings.
- Use dynamic dispatch and batches of about 10 runs per message, as the site does.
- Use the prepared-candidate path, and send `appStateRef` rather than the 1.8 MB app state.
- Tear the pool down when the run ends or is cancelled. Cancelling terminates the workers outright, as the site does.
- A utility process is **not** needed. The work is pure wasm compute and Web Workers give real parallelism. The engine already runs in a Web Worker served from `/core/`, and a utility process would add IPC, a second wasm loader and packaging work for no throughput gain. Reconsider only if renderer memory (about 400 MB at 8 workers) becomes a problem.

## 11. Acceptance checklist for the builder

- [x] Settings defaults and clamps equal 2.1. Default is locked and Your Config is the initial active config. The Save, Close and switch-discard rules hold.
- [x] The blacklist defaults equal `data.json.blacklist`, the whitelist defaults equal `data.json.whitelist`, and enabling an empty whitelist refills it.
- [x] Blacklisted mods **and arcanes** never appear in a result. Riven Mod is always excluded. The Deadhead arcanes and Galvanized Scope/Crosshairs are excluded when headshots are off.
- [x] With the whitelist on, only whitelisted mods are added, and pre-filled slots stay.
- [x] A stat blacklist entry such as "Multishot" excludes every mod with a MULTISHOT or FIRE_ITERATIONS stat.
- [x] The elemental blacklist ("Heat") yields no result whose final elements include Heat.
- [x] Filled slots, a filled Exilus slot and a filled arcane slot are unchanged after a run.
- [x] The step order, run counts (runs(b) formula, the 200-run refinement, at most 10 iterations, one slot per iteration) and the progress percentages match section 4.
- [x] The metric switches (raw / status) and the modifiers (single shot, floor) change the scoring as in 4.8.
- [x] Cancel stops within about 200 ms of the current job, leaves the build untouched, and the pool is terminated.
- [x] The result is applied as one Undo step, and the toast shows live old -> new DPS.
- [x] `npm test` passes, the smoke covers run, undo and cancel, and the scenes are captured for the settings dialog and the running state.

## 12. As built (2026-10-24)

What shipped, and where it differs from the plan in section 9. Sections 1-8 still describe the site.

### 12.1 Where it lives

- **Entry point.** A quiet "Auto build" button (wand icon) on the Loadout's capacity line, next to the capacity menu, and **Ctrl+Shift+A**. At rest it adds one control (the smoke counts 34 against the cap of 40). With the dialog closed it reads "Auto build · 45%" while a run is going and "Auto build · result" when a result is waiting.
- **The dialog** (Fluent Dialog, 760 px; the content scrolls inside it):
  - a **Config** dropdown ("Default (read-only)", "Your Config", named configs) and **Manage** (New config…, Duplicate, Rename…, Move up/down, Delete… with a confirmation). With Default active, a line reads 'Viewing "Default" (read-only). Duplicate it to make changes.' next to a Duplicate button, and every setting is disabled;
  - four tabs:
    - **Run**: one sentence on what it does (weapon, target, fire mode, buffs), a summary of the active settings, and **Keep**: the build's filled slots and arcane as toggle chips with their card art, all kept by default;
    - **Search**: search sim time, sample size multiplier (with the resulting runs per candidate), our time limit, the engine count, the refinement switch and sample size, Luck averaged, Build for single shot/hit, Build for floor, Cost Control with Maximum Forma, and "Score by" (Average DPS / Raw damage per shot / Status damage per shot);
    - **Elements**: Elemental candidates, "Only these element targets" (the specific whitelist), and the elemental blacklist. Both lists have the quick buttons Heat / Viral / Viral Heat, "Add preset…" and a custom combination field;
    - **Mods**: the mod blacklist (mods, arcanes and "Riven Mod"; searched with the app's smart mod search, shown as card chips, with Reset to defaults), the whitelist (mods only) with the overlap warning, and the stat blacklist (16 toggles).
  - footer: Close and **Run** at rest; **Cancel** (then "Stopping…") while running; **Discard** and **Apply** with a result.
- **Running** shows the step ("Step 3: Greedy fill (6 samples)"), a progress bar, "3,618 simulations · 2 s of at most 5 min", and the latest detail line ("Heat (2 mods): added Vital Sense (32,264)."). The UI never blocks; the dialog can be closed and the run goes on.
- **The result** shows the Average DPS before → after, the slots that change as compact card art with "Slot 3 · replaces Point Strike" or "was empty", and lines that keep it honest:
  - both DPS numbers are the build's own sim time with the Readout's 8 seeded runs, so they equal what the Readout shows after Apply (the smoke checks this);
  - when the result needs more capacity than the build has: "Needs 89 of 60 capacity (29 over)… Cost Control is off, so capacity was not checked";
  - "Stopped at the 5 min limit: this is the best build found so far.";
  - "Partially simulated: …" for chosen mods and arcanes the stat model only partly covers;
  - "Auto build found nothing better than the current build." when nothing changed.
- **Apply** writes the mods and the arcane as **one undo step**, closes the dialog and shows a toast "Auto build applied: 507 → 84,469 DPS (×166.6)" with Undo (Ctrl+Z works while it is up). **Discard** forgets the result. A result is refused (with a warning) if the build changed while the run was going, and opening another build cancels a run.

### 12.2 Decisions

1. **Faithful pipeline for guns** (primaries and secondaries): steps 1.5, 1.55 (Secondary Enervate), 2.1, 2.2, 3, 4, 5, 6, 7, 7.5, 8 and 9, with the site's run counts, progress percentages, pools, targets, the elemental blacklist checks, the refinement rules and the messages. Melee, stances, companions, archguns, kitguns and Progenitor steps stay out (section 8); the Incarnon steps 2.7 and 4.3 were ported later (docs/port-incarnon.md section 7).
2. **Common random numbers.** With Luck Averaged on, every evaluation uses seeds 1..n (decision 9.1.2). Results are reproducible: the same build and settings give the same picks, regardless of the number of engines. With it off, seeds are random.
3. **Locks, as on the site, plus Keep.** Filled slots and a filled arcane slot are locks, and the Exilus slot is never filled. In the dialog the user can untick kept mods (or the arcane) to have them replaced. That is the natural form of "lock a slot": the run's starting build is the build minus the unticked mods. The Exilus mod always stays.
4. **A result view, then Apply.** The site overwrites the build at once with no preview and no undo. We show the proposed build against the current one (DPS, changed slots with card art) and apply it as one undo step, with the toast's Undo. The site's conditional reset (new mods at max stacks) is the app's default: a slot without `stacks` is at max.
5. **Configs are stored by the main process** in `auto-build.json` in userData (`uf.autoBuild.get/set`; `src/main/auto-build-store.js` keeps the document plain and bounded). This replaces decision 9.1.6 (localStorage), because the app keeps user data in the main process. Default is recomputed on every load and never stored. Smoke and scene runs always start from the defaults. **Edits save as you make them**: there is no draft and no Save button; Default is read-only instead. Configs: Default + "Your Config" (active at first) + named configs, with the site's rules and messages (reserved name, unique names, no deleting Default or the active config, Default stays first). The engine count is a device preference stored in the same document (`cores`), not part of a config.
6. **Our own time limit** (`timeLimitSeconds`, default 300 s, 10-3600 s), which the site does not have. When it runs out, the search stops where it is, skips the remaining steps (top 3, arcane re-optimisation, refinement, final arcane check), keeps the best build so far (a fill cut short keeps the score of its last step) and says so. Cancel discards everything.
7. **Where it runs.** A module Web Worker (`auto-build.worker.js`, bundled by Vite) loads the game data itself, starts its own pool of engine workers (nested workers running `engine.worker.js`, separate from the interactive one), runs the search and posts progress. The pool defaults to min(8, logical cores − 1) and caches the app state once per worker. Tasks are at most 10 runs, handed out dynamically. The engine worker has a new `score` request that runs the seeds through the prepared-candidate path (`prepare_canonical_candidate_v1`, falling back to `calculate_dps_wasm`) and returns only the metric's sum and count. Cancel stops the engines at once; the page also terminates the worker after 1.5 s if it has not answered. The packaged app loads it under the app:// CSP (the page policy's `worker-src 'self'` for the module worker, the engine worker's own policy for the nested ones).
8. **Extra compatibility rules.** The app's mod compatibility lacks a few of the site's rules, so Auto build adds them for its own candidates: Semi-Cannonade mods need `cannonade_compatible`, Split Flights is not offered on the AoE bows, and Sinister Reach only fits beam primaries. Without these rules the first prototype put Semi-Rifle Cannonade on Braton Prime. The picker itself is unchanged.
9. **Element signature.** It is computed from the mods and the innate elements with the app's own combination order (the same one the simulation uses). The site's helper pairs adjacent primaries instead, which can differ when a pre-combined element sits between them. External buffs are left out, as on the site. Xata's Whisper adds the site's extra targets (Blast, Blast Toxin, Corrosive Blast with 4 mods).
10. **Arcane eligibility uses the app's rule**: an element-gated arcane (Frostbite, Blight, Cascadia Flare, Conjunction Voltage) needs its element in the mode's final damage types, external elements included. A Cold status already on the target also lets Primary Frostbite build stacks (the site's rule, for Frostbite only), here and in the live readout (12.7).
11. **Not ported:**
    - ~~the forced weapon-specific elemental augments (step 4.0.3)~~: ported once conditional elements were simulated (12.6);
    - the Cost Control side effect on the Exilus toggle;
    - GPU and the riven override (section 8).
12. **Cost Control** re-polarises slots greedily, largest drain saving first, to each mod's own polarity, and returns the plan (`capacityPlan()`, `formaChanges()`). As on the site, the Forma already on the build count toward the maximum: each re-polarised slot costs one Forma (a slot that already had one needs another), and the plan may add at most `maxForma` − existing. It uses `capacity.js` (with the Progenitor bonus). **Apply writes the plan's slot polarities** with the mods, in the same undo step (12.7); the site writes none.
13. **"Minimal fire rate"** is the site's internal name for Build for Single Shot/Hit. The candidate's fire rate fields are set to 0.01 and `forceSingleShot` is sent, as on the site.
14. **The run uses the build's own context**: weapon, fire mode, target (with its headshot flag), external buffs and target statuses (cached in each engine's app state), slot polarities and Catalyst. The search sim time is separate from the build's (decision 9.1.5).

### 12.3 Algorithm as implemented

`src/shared/auto-build.js` `runAutoBuild(env, { start, score, signal, deadline, onProgress })`, with runs(b) = max(1, round(b / 5 × multiplier)):

1. **Preparation.** Locks are the filled general slots. The arcane is locked if filled. The run blacklist is the user's list (when on), plus Riven Mod, plus Galvanized Scope/Crosshairs and the Deadheads when the target's headshot flag is off. The pools, in data order:
   - **elemental**: adds a non-physical element, not one of the 14 direct Radiation/Magnetic mods;
   - **greedy**: a DPS stat, not elemental; Internal Bleeding / Hemorrhage always admitted;
   - **refinement**: the weapon's own Type, a DPS stat or a weapon augment, not in `exilusMods`;
   - **arcanes**: `arcanesFor(weapon)` minus the blacklist.

   Every pool is filtered by compatibility, the blacklist, the whitelist and the stat blacklist.
2. **Arcane pre-pass** at 10 runs (not scaled): the baseline plus every arcane eligible on the starting build. The best is kept if it beats the baseline, and the ranked list is the fallback order.
3. **Secondary Enervate check** (secondaries): two greedy fills from a Heat start at runs(5), scored at runs(5).
4. **Base element probe** (Heat, Cold, Toxin, Electricity at runs(10)), reported only.
5. **Compositions**: every ordering of 1..min(3, empty slots) distinct elemental mods; conflicts, Cost Control and the elemental blacklist are checked. An ordering is kept when its signature equals a target exactly. Each is scored at runs(10), and the best per (target, size) becomes a starting point, plus "No Element" and a zero-mod point for a target equal to the innate elements.
6. **Greedy fill** per starting point: the first empty general slot, every greedy candidate at max rank (plus half rank with Cost Control), scored at runs(10). The best (strictly greater; ties go to data order) is added, until no slot or candidate is left. Then the arcane fallback, and a score at runs(5).
7. **Top 3**: the re-fill at runs(30) (normally a no-op), a score at runs(50), then the arcane re-optimisation at runs(30) per arcane plus runs(50), kept only if better.
8. **Winner** by score.
9. **Final refinement** (sample size, not scaled, default 200), at most 10 iterations:
   - remove each auto-placed mod in turn;
   - the slot whose removal scores highest is reconsidered with every refinement candidate (checking Cost Control, the elemental blacklist, the equipped arcane's element and, with the specific whitelist, an unchanged signature);
   - swap in the best only if it beats the current score, else stop.
10. **Arcane fallback**, re-scored at runs(30) if it changed. **Final arcane check** (runs(30) per arcane, runs(50)).
11. **Quality-of-life swaps** without simulating: Heavy Caliber → Serration, and a conditional mod → a plain mod with identical max-rank stats; kept slots are never touched.
12. **Final elemental blacklist check.** If it fails, the run errors with "The final build was rejected by the elemental blacklist."

`src/renderer/auto-build-job.js` wraps it: env, the scorer over the pool (10-run chunks, means), then **before/after** at the build's own sim time with seeds 1-8 (the Readout's runs).

### 12.4 Timings (i7-13700K, Braton Prime, empty build, Elite Crewman L145)

| Setup | Runs | Time |
| --- | --- | --- |
| Site defaults (multiplier 3, refinement 200), 8 engines (node worker_threads, the same pool code) | 31,152 | 10.5 s search + 0.2 s engine start-up |
| The smoke's short budget (multiplier 0.2, no refinement), 8 engines in the app (dev and packaged) | 1,637 (+16 for before/after) | 1.4 s from the click to the result |
| The real-engine unit test (multiplier 0.2, a 7-mod whitelist), 1 engine in-process | about 500 | 1.5 s |
| Cancel in the app | | 26-28 ms from the click to "Cancelled" |

The default run is about 3-4× faster than section 10 estimated. The 5 s search simulation ends at the kill, and the default target dies in 1-2 s once a build has a few mods, so most runs cost about 1-3 ms. The result for the defaults was 507 → 94,259 DPS:
- mods: Infected Clip, Primed Cryo Rounds, Critical Delay, Galvanized Chamber, Vile Acceleration, Vital Sense, Vigilante Armaments, Serration;
- arcane: Primary Merciless;
- the refinement swapped Thermite Rounds for Critical Delay, and step 9 turned Heavy Caliber into Serration.

### 12.5 Tests, smoke and scenes

- `test/auto-build.test.js` (23 tests):
  - settings defaults and clamps, the runs formula and metrics;
  - element target parsing and the elemental blacklist rule;
  - stat families;
  - configs (locked Default, unique and reserved names, delete rules, order, stored shape);
  - the main-process store;
  - the pools (default blacklist, rivens, Exilus, the Cannonade rule, Deadhead without headshots, the blacklist on arcanes, whitelist, whitelist + blacklist overlap, stat blacklist, blacklist off);
  - element targets and signatures, and Cost Control;
  - the search with a fake scorer: locks and Exilus kept, blacklisted mods never used, whitelist only, elemental blacklist, a kept arcane, determinism, the run counts, cancellation, and the time limit;
  - step 9, floor and single shot, chunking, the pool (dynamic dispatch, re-cache after a crash, terminate);
  - the engine worker's `score` request against `simulate`;
  - a short real-engine run that is reproducible;
  - the gain text.
- **Smoke** (`checkAutoBuild`, real OS clicks):
  1. Auto build button → dialog ("Your Config" active);
  2. Mods tab → type "serration" → click the Serration card: it is in the blacklist and its chip shows the card image;
  3. Run with a short budget: done, all 8 slots filled, no Serration in the result or in the change list, card images shown, "before" equals the Readout;
  4. Apply: the build holds the result, the Readout's DPS equals the result's "after" (within 0.1%), the toast is shown;
  5. a real Ctrl+Z restores the empty build and its exact DPS;
  6. a Default-config run is cancelled mid-way: "Cancelled. Nothing changed." and the build is unchanged;
  7. Close returns focus to the button.
- **Scenes** 36-36j:
  - entry at rest;
  - the Run tab with Keep;
  - Search, Elements, the blacklist search and the blacklist;
  - the read-only Default (1440 only);
  - running, the result, and applied with the toast.

### 12.6 Gaps

- No melee, companions, archguns or kitguns (section 8). ~~Incarnon evolutions~~: ported, perks included (docs/port-incarnon.md).
- ~~Galvanized and other conditional mods are scored on their base stats only~~: fixed (docs/port-weapon-stats.md 3). Candidates are scored at max stacks and kept slots at their own stacks, as on the site; the result names them with their stacks ("Scored with Galvanized Chamber at 5 stacks (On Kill), as underframe.site does").
- ~~Weapon-specific elemental augments are not forced in~~: fixed. The weapon's elemental augments (a weapon-family augment whose conditional adds an element: Biotic Rounds on the AX-52) go in at max rank and are kept, and the log says so.
- Progenitor bonuses, combined fire modes and weapon passives count in every candidate, as in the Readout (docs/port-weapon-stats.md).
- With Cost Control off (the read-only Default, as on the site) the result can be over capacity; the result view says so in a warning above the changes, and Apply reads "Apply (29 over capacity)".
- ~~The tag-based compatibility rejections of the site are not applied~~: fixed. The app's compatibility (src/shared/mods.js) now follows the site's rules for every gun and gun mod, the picker's too (docs/port-weapon-stats.md 6); `fitsWeapon` is that compatibility.
- The site's per-candidate seed hash is replaced by common random numbers (12.2.2), so picks can differ from the site's for close candidates.
- A new config is created from the active settings and becomes active (the site keeps the old one active).

### 12.7 Review fixes (2026-10-24, round 2)

A parity review (the live site, its engine input captured and replayed) and a UX review (the real app over CDP) checked Auto build. What changed:

| Finding | Change |
| --- | --- |
| Stat locks were not applied, so Auto build stacked dead fire-rate and multishot mods (and External Fire Rate) on Semi-Cannonade and Acuity builds, and scored them about 2× too high | Fixed in `stats.js` (docs/port-external-buffs.md 12.1): a candidate with a Semi-Cannonade keeps the weapon's own fire rate, one with Acuity its own multishot, whatever else adds. Auto build needed no change of its own. Test: a short real run on Lex Prime with more alternatives than slots never pairs the Cannonade with Gunslinger or Anemic Agility |
| Galvanized mods are scored on base stats (documented, but not said on the result) | The result names them: "Galvanized Chamber is scored without its stacking bonus (this app has no stacks); underframe.site counts max stacks, so it may rank it higher." (`conditionalModNames()` over `data.conditionals.galvanized_mods` and `misc_mods`). Stacks themselves stay a gap (12.6) |
| The default result could not be equipped (33-46 over capacity), even with Cost Control on | 1. **"Your Config" starts with Cost Control on** (an app decision; the read-only Default keeps the site's off). 2. Cost Control's plan is returned with the result and **Apply writes its slot polarities** with the mods, in one undo step; the result lists them ("5 Forma to fit 58 of 60 capacity: Slot 2 → Vazarin (D), …") and the Apply toast repeats them. 3. Why the 8-Forma run matched Cost Control off: the limit was max(maxForma, existing Forma) = 8, and re-polarising an already-Forma'd slot was free, so every max-rank build "fit" and nothing was applied. Now the existing Forma count toward the maximum and each re-polarised slot costs one (12.2.12). 4. A result still over capacity shows a warning above the changes and "Apply (29 over capacity)" |
| Run on a complete build did nothing and still said "found nothing better" | With every slot and the arcane kept, Run is disabled (still focusable) with "Untick mods under Keep to let Auto build replace them", and the Keep text says there is nothing to fill. Keep has "Keep all" and "Replace all". A run with nothing to do (runs = 0) says "Nothing to fill", never "found nothing better"; a zero change is neutral ("no change", never a red ▼ 0%); an unchanged result has one Close button |
| Focus fell to the page after Run, a result, a blacklist add or a chip removal, and Esc then did nothing | The dialog opens on Run (Apply with a result); Run moves focus to Cancel, a result to Apply (or Close), Cancel or an error back to Run, Discard back to Run; adding from the search keeps focus in the search box with its text selected; removing a chip focuses the next chip (else the previous one, else the search). Esc with focus on the page closes the dialog |
| The blacklist showed 144 chips (77 for other weapon types, 69 without art) as 144 tab stops | The list shows the entries that fit this weapon first ("144 in the blacklist; 26 apply to Braton Prime", by the app's mod and arcane compatibility), with "Show 118 for other weapon types"; three rows at a time with "Show all N"; names added while the dialog is open come first. Items without art get a text-card thumb (polarity on a neutral tone, a rarity band). The grid is one tab stop with arrow keys (Fluent's arrow navigation group) and Delete removes the focused chip. Every chip has its full name as a tooltip |
| Up to 3 nested scroll regions | The lists no longer scroll on their own: the dialog content is the only scroller (smoke checks at most one scroll region in an open dialog) |
| Keep chips did not look like toggles | Kept chips show a check; unticked ones say "Replace" (and a dashed outline). The heading reads "Keep (8 of 9)" |
| A run finished in the background was easy to miss; a stale result vanished silently | With the dialog closed, a finished run raises a toast "Auto build finished: 2,451 → 92,553 DPS (×37.8)" with Review (an error raises one too). Reopening after the build changed says "The build changed, so the last result was dropped. Run again." |
| The result kept the config row and the settings tabs; the diff showed only the new side | With a result, only the result is shown. Each change is the old card → the new card (an outlined empty box for an empty slot), then the text. The DPS line, the capacity warning and the Forma plan come before the changes |
| Focus opened on the X | See above (Run / Apply) |
| SpinButton arrows were 24x16 | The Search tab's numbers are plain inputs, committed on Enter or blur and clamped; smoke checks every pointer target in the open dialogs |
| `aria-describedby` pointed at nothing outside the idle Run tab | An always-present description |
| The default whitelist contradicted the default blacklist | Names on both lists are left out of the default whitelist (the blacklist wins anyway); a search shows names already in the list as "Already in the blacklist" instead of leaving them out |
| Elements: quick toggles repeated the chips; a truncated placeholder | One chip list per section and one Add box (a free-form Combobox offering the presets and taking any combination) |

Tests: `test/auto-build.test.js` adds Your Config's Cost Control default and the whitelist overlap, the Forma plan (it fits once applied with `withFormaPlan`, existing Forma count toward the maximum), `nothingToFill`, and `conditionalModNames`; `test/parity.test.js` adds the Lex Prime run. Smoke (`checkAutoBuild`) adds: Your Config has Cost Control on; the dialog opens on Run; the blacklist shows at most 3 rows, arrow keys move between chips and Tab leaves the grid; adding from the search keeps focus in it and the search marks Serration as already listed; Delete on a chip moves focus to the next chip; focus moves to Cancel while running and to Apply on the result; the result is within capacity and lists its Forma; the settings are hidden under a result; Apply leaves the build within capacity; on the complete build Run is disabled; Ctrl+Z restores the empty build's mods and polarities; after Cancel focus is on Run; pointer targets and scroll regions in the open dialog. Scenes add 35h/35i (buffs), 36f2 (all blacklist entries), 36k (nothing to fill), 36l (Replace all), 36m (over capacity, Cost Control off) and 36n (the finished toast).

## 13. Auto Forma (2026-10-25)

The "Auto Forma" button on the capacity line, next to Auto build. It ports the behaviour of underframe.site's Auto Polarize (`calculatePolarityOptimizationPlan`, script.js L12004; read as data, none of it copied) for the mods on the build, and goes further.

- **As on the site:** slots are re-polarised to their mods' polarities (an Omni riven's slot to Madurai), or cleared; Umbra Forma are used only when nothing fits without; a Progenitor weapon's capacity per Forma is counted, so a Forma on an empty slot can pay off.
- **Exact:** `src/shared/auto-forma.js` `planForma` is a dynamic program over the slots (mods placed, Forma spent, Forma on the weapon), not a greedy pick. It takes about 20 ms on a full build.
- **Moves:** moving a mod to a slot that already matches costs no Forma, so mods may move between the general slots. Mods that add an element (their order sets the combined elements) and the weapon's own augments stay put (`pinnedSlot`), so DPS doesn't change. Off with "Move mods between slots".
- **The plans:** the fewest Forma that fit, then one plan per Forma count that frees more capacity; each lists its polarities and moves. Apply sets them as one undo step, with Undo in the toast.
- **Options:** count from the weapon's own polarities (Forma already applied count again; a stray Forma can be undone), and plan for every mod at max rank (shown when one is below it; Apply raises them).
- The capacity line's tools (Auto build, Auto Forma, Riven, the menu) are one toolbar: one tab stop, arrow keys between them, which keeps the tab stops before the first slot at 10 or fewer.
- Tests: `test/auto-forma.test.js`. Smoke (`checkAutoForma`): a build over capacity without a Catalyst, the button and Apply by real clicks, the build fits, Undo restores it.

## 14. Departure: the Exilus slot (step 7.5)

The site never fills the Exilus slot. Users expect Auto build to, so the app adds one step after the final refinement
(7) and before the final arcane check (8), only when the Exilus slot is empty:

- **Candidates**: the `exilus` pool, the allowed Exilus mods (`data.json.exilusMods`) that fit the weapon, add no
  element and raise a stat the simulation counts (`hasDpsStat` with a positive value, so Vile Precision, whose fire
  rate is a penalty, is never tried); and each auto-placed (not kept) Exilus mod in a
  general slot moved to the Exilus slot, with the freed slot filled again from the greedy pool. Cost Control, the
  elemental blacklist and the arcane's requirement apply as in the other steps.
- **Choice**: every candidate and the build as it is, at `runs(30)`; the best is kept only when it scores higher.
- **Log**: "Added <mod> to the Exilus slot", "Moved <mod> to the Exilus slot and added <mod>", or "Exilus slot: no
  Exilus mod adds damage to this build; left empty."
- A build with every general slot kept and the arcane kept still runs, for the Exilus slot alone, when the pool has a
  mod. The dialog's Run counts that too (`nothingToFill` with the data): for most guns the pool is empty, so a full
  build still reads "nothing to fill".

Few Exilus mods raise simulated damage (as of 2026-10-25: Bhisaj-Bal on Paris Prime; Sinister Reach and Ruinous
Extension, range, for about 47 guns), so the slot usually stays empty, and the log says why. Most Exilus mods are utility (recoil, ammo, zoom, projectile speed) and the data has no stats for many of them.
