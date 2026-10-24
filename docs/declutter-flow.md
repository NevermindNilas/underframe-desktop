# Declutter review: task flow and information architecture ("flow" lens)

Reviewer lens: what is the user doing right now, and does the screen show that and little else?
Date: 2026-10-24. Build reviewed: the renderer built at 17:25 that day (arsenal layout, `docs/arsenal-spec.md`).
Status: proposal. Nothing in the code was changed.

> User feedback (verbatim): "the screen feels so clutterred, the user is bombarded in every direction and the core stuff that you actually care about like weapon stats get cut away."

## 0. The proposal in one paragraph

**Build on the left, read on the right, and show the picker only while you pick.** The screen keeps three regions instead of seven:

- a single 48 px **top bar** (the title bar and the build toolbar merged);
- the **Loadout** on the left: the arsenal arrangement with large card-image slots;
- the **Readout** on the right: the DPS and **every weapon stat (base, modded, change) in one column**, so the number and the reasons for it are read together.

The card gallery is no longer always on screen. It opens as the **Picker** in the lower part of the Loadout when you choose a slot (or press Ctrl+F, or start typing), and it closes again with Esc, Done, or after you equip into a filled slot. While the Picker is open, the slots shrink to a 5x2 strip so you keep the build in view, and the Readout previews the focused card's effect on the stats. At rest, the same lower area shows "Why this DPS" (the health-over-time chart, damage by hit type, and Notes). Compare, the target and the simulation settings move into the Readout, where their results already are. The status bar goes away; the credits line stays visible at the foot of the Readout.

## 1. How this was measured

- Two isolated app instances, normal mode with their own `--user-data-dir`, CDP on ports 9451 (1440x900) and 9452 (1100x700), dark theme. Each was placed on the second monitor and closed after use.
- The scene build was rebuilt through the real UI: 8 mods, Exilus, the arcane, Forma polarities. The capacity was 56/60, no slot was selected, and the pointer was idle.
- Script `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\measure.js`. It counts only elements that are on screen, inside their scroll clip, not hidden and not covered, which it checks with `elementFromPoint`. What it counts:
  - **controls**: the outermost interactive elements;
  - **text strings**: visible text nodes;
  - **chips**: small boxed labels drawn over a different background;
  - **bordered elements**;
  - **accent hues**: saturated colours on text, backgrounds, borders and SVG, in 30 degree buckets, with card art excluded;
  - **scroll regions**: elements that actually overflow;
  - **the stats-rail area**;
  - **the stat rows fully visible**.
- Raw output: `m-1440-full.json`, `m-1100-full.json` and `m-1100-stats.json`, each with its PNG, in the same folder. Region areas come from `areas.js`.
- All 35 scene PNGs were checked in dark 1440x900, light 1440x900 and dark 1100x700, plus the 1920x1080 set.

## 2. Before: measured clutter

| Metric (full build, at rest) | 1440x900 | 1100x700 |
| --- | --- | --- |
| Regions on screen with their own content and controls | 7 (title bar, toolbar, stats rail, stage, gallery, results rail, status bar) | 6 (the stats are folded into a tab) |
| Visible interactive controls | **68**, plus 3 native caption buttons. By region: toolbar 8, stats 10, stage 18, gallery 17, results 10, status 4, title 1 | **54**, or 58 with a slot's hover strip up |
| DOM tab stops / tab stops before the first slot | 63 / **29** | 51 / 14 |
| Visible text nodes / distinct strings | 200 / **139** | 145 / 91 |
| Boxed chips and overlays (drain plates, rank text, "Slot N" tags, badges, sort pill) | **31** | **37** |
| Tinted pills (Partially simulated, delta, "12 stacks") | 3 | 3 |
| Elements with borders (sides) / separators | 32 (66) / 4 | 22 (53) / 3 |
| Accent hue families in the chrome (uses) | **5**: blue 114, green 40, red 15, yellow 5, orange 3. Card art adds gold, silver and bronze on top | 5: blue 64, green 35, red 25, yellow 5, orange 1 |
| Regions that scroll on their own | **3**: stats rail 475/629 px, gallery 208/3019 px, results tabs 449/500 px | 2: gallery 155/2928 px, results 209/482 px |
| Weapon stats share of the viewport | **9.7 %** (264x475) | **0 %** at rest (a tab behind Charts); 9.2 % once the tab is opened |
| Stat lines fully visible without scrolling | **11 / 14** (Slash, Blast and Corrosive are cut) | **0 / 14** at rest; 4 / 14 on the Stats tab |
| Stats the engine computes but never shows | Punch through, status duration, range/falloff, ammo use | same |
| Distance from the DPS number to the stats | about 1,120 px, at opposite screen edges | Not on screen together |
| Chrome (title bar, toolbar and status bar) | 132 px, 14.7 % of the height | 132 px, 18.9 % of the height |
| Gallery at rest | 23.8 % of the viewport for 7 of 102 cards, one row | 19.5 % for 6 cards, each cut off at the bottom (155 px box for 164 px cards) |
| Result card | 6.7 % | 11.6 % |

### 2.1 Everything that appears twice or more

1. **Build name and save state.** The title bar shows "New build • Not saved yet". The toolbar shows the name field and "Not saved yet" again.
2. **Weapon name.** It appears in the weapon picker and again in the gallery chip "Fits Braton Prime". The library row and the compare row repeat it too.
3. **Fire mode.** The mode radios (or the dropdown at 1100) say "Normal Attack", and so does the "Weapon stats" heading caption.
4. **Equipped mods.** Each equipped mod is drawn on its slot card and again as a gallery card. At 1440 that is 7 names and 7 effect lines shown twice at once.
5. **Slot numbers.** The slots themselves show the slot positions. The gallery repeats them with 7 "Slot N" tags, so the gallery's first row is the equipped build drawn a second time.
6. **Drain.** The slot's drain plate shows "7" for Serration while its gallery card's fit hint shows "14". The same mod shows two different drain numbers on screen.
7. **Rank.** Every slot shows pips and a "5/5" text: 10 slots, 20 rank readouts.
8. **Polarity.** A mod's polarity shows up to three times: the slot glyph at top left, the glyph on the drain plate, and the glyph on its gallery card.
9. **Capacity and Catalyst.** The capacity bar sits next to "56/60". Under the weapon name, "Orokin Catalyst · 8 Forma" repeats the Catalyst and Forma state, and the Catalyst toggle appears again in the stage ⋯ menu.
10. **Honesty.** The result card has a yellow "Partially simulated" badge and an ⓘ "What's simulated" button, and the Exilus slot carries a warning glyph. That is three signals for one fact.
11. **Target.** The result card line reads "vs Elite Crewman · L145 · Corpus". The Target tab summary repeats it, and the stats rail adds "No bane mod for Corpus".
12. **Mod count.** The "Mods 102" tab label and the "102 mods" counter.
13. **Picking hint.** The stage caption "Slot 8 (Vazarin) selected. Click a card in the gallery to put it here." and the gallery line "Picking for slot 8. Click a card to equip it." say the same thing. At rest, "No slot selected: cards go into the first empty slot." takes that place.
14. **Simulated time.** The "30 s" dropdown and the "30 s each" in the range line.
15. **Import.** Three entry points, two of them visible: the toolbar button, its chevron menu, and the stage ⋯ item "Import from screenshot…".
16. **Overflow menus and info icons.** Three ⋯ menus (toolbar, stage, slot) and three ⓘ icons (Exilus, Arcane, Average DPS).
17. **Deltas.** The DPS delta badge is measured against the previous run, while the compare table's column is measured against the baseline. Two different references show at once when Compare is open.
18. **Weapon type.** "RIFLE" is printed on all 7 to 8 visible gallery cards. That is the card art, but it shows how much the always-on gallery repeats.

## 3. The core loop, moment by moment

`docs/ux-spec.md` section 1 already ranks the tweak loop first: "after I change a mod, can I see the new avg DPS and its delta without moving my eyes?" Measured against that, the current screen shows almost everything at every moment:

| Moment | The user's question | What they need | What is noise right now |
| --- | --- | --- | --- |
| 1. Start | "Which gun, which build?" | Weapon picker, library and featured builds, Import | The 102-card gallery and its filters, the charts, the target, the status bar |
| 2. Fill slots | "What goes in slot N?" | The target slot, the candidate cards, search and filters, the drain in *this* slot, capacity, and the effect on stats and DPS | The charts, the target and notes tabs, the status bar, and three hint lines. The stats are 1,100 px away from the DPS, which is exactly where they're needed. |
| 3. Tweak (rank, Forma, swap) | "Did that help?" | The slot and its rank −/+, the DPS with its delta and TTK, and the stat that moved | The gallery (24 % of the screen), its 10 header controls, and the charts |
| 4. Read and understand | "Why is the DPS this?" | The full sheet (base to modded, with the change), the damage split, the health curve | The gallery and the slot overlays. Today the sheet is cut off at 1440 and hidden at 1100. |
| 5. Compare | "Is B better than A?" | The pins, the change against the baseline, and what changed between them | The gallery. Compare itself is spread over three places: Pin (right column), Compare (toolbar, top right) and the table (a drawer at bottom left, over the gallery). |
| 6. Change the target | "Against what?" | The target form and the result | Everything else. This is a rare task. |
| 7. Import | "Get my in-game build in" | The review dialog | Nothing; it is modal, and that is right. |
| 8. Save and manage | "Keep it" | Name, Save, Library | The status bar, and the duplicated save state |

**Diagnosis.** The layout is organised by *component*: stats here, slots there, gallery below, results right. It is not organised by *task*. Every moment needs at most two of those components, but all of them are always on, each with its own controls, scroll and colour. The gallery's fixed 24 % slice is the biggest part of the problem, and it is what pushed the stats into a 264 px rail.

## 4. Top 10 clutter problems (ranked by impact on the loop)

1. **Seven regions and 68 controls at rest, in every direction** (54 at 1100). The controls sit left 10, centre 18, bottom 17, right 10, top 8 and bottom edge 4, so there is no resting place for the eye.
2. **The weapon stats are starved.** They get 9.7 % of the screen at 1440, with 11 of 14 lines visible inside their own scroll. At 1100 they get 0 % at rest: 4 of 14 lines, and only after switching away from Charts. No row shows a percentage change, the damage total has no base, and four computed stats are never shown.
3. **The DPS and its explanation are about 1,120 px apart.** Each tweak needs a left-to-right eye sweep across the slots. The tweak loop (task 1) spans three regions.
4. **The always-on gallery uses 23.8 % (1440) and 19.5 % (1100) of the screen at rest** to show 7 cards out of 102 (6 cut off at 1100). Its first row duplicates the equipped build: 7 names, 7 effects and 7 "Slot N" tags.
5. **The gallery header shows 10 controls and 2 hint lines at rest**: 2 tabs, search, sort, view toggle, Effect, Polarity, Rarity, Fits, Hide equipped, a count and a hint. All of them are only useful while picking.
6. **Overlay density: 31 boxed chips at 1440 and 37 at 1100.** Each slot stacks a polarity glyph, a drain plate, pips, "x/y" text and badges, and the rank is encoded twice.
7. **Five accent hue families in the chrome** (blue 114, green 40, red 15, yellow 5, orange 3) on top of gold, silver and bronze card art. The yellow badge and the red or green delta pill compete with the DPS number itself.
8. **Three independent scroll regions at 1440** (two at 1100). The gallery box shows one row of a 15-row grid, the stats rail scrolls 154 px for its last three lines, and the results tabs scroll as well.
9. **Chrome takes 132 px: 14.7 % of the height at 900 px and 18.9 % at 700 px.** The build name and save state are printed twice, and a credits, version and Discord strip is always on.
10. **Scattered secondary tasks.** Compare lives in three places; the target sits in a tab below the result. There are three ⋯ menus, three ⓘ icons and three ways into Import. It takes 29 tab stops to reach the first slot, because the stats rail comes first.

## 5. Proposal: Loadout | Readout, with a context area that follows the task

### 5.1 Structure

```
┌─ top bar (48) ─────────────────────────────────────────────────────────────────────┐
│ builds · name · unsaved dot          undo redo · Import · Save · ⋯   (window caps) │
├─ LOADOUT (task: build) ───────────────────────┬─ READOUT (task: read) ─────────────┤
│ weapon · mode · capacity                       │ DPS + TTK (+ delta)                │
│ Exilus · Arcane · 8 slots (card images)        │ target line · honesty line         │
│ ┌ CONTEXT AREA (follows the task) ───────────┐ │ WEAPON STATS: base → modded, change│
│ │ rest:    "Why this DPS" (charts, notes)    │ │ damage split                       │
│ │ picking: the PICKER (cards, search, best)  │ │ COMPARE (pins)                     │
│ └────────────────────────────────────────────┘ │ credits                            │
└────────────────────────────────────────────────┴────────────────────────────────────┘
```

Three regions, and the screen has two states.

| State | Entered by | Loadout shows | Context area shows | Readout shows |
| --- | --- | --- | --- | --- |
| **Rest / tweak** (default once any mod is equipped) | Esc, Done, equipping into a *filled* slot, opening a build | Weapon header, capacity, special row and 2x4 grid at full size, plus the one-line finder "Add or swap mods… Ctrl+F" | "Why this DPS", with the segments Health over time, Damage by hit and Notes | DPS, stats and Compare |
| **Picking** | Clicking or pressing Enter on a slot; Ctrl+1…9 and Ctrl+Shift+9; Ctrl+F; typing in the finder; a stat row ("find mods that raise crit"); Shift+Enter (best mod); a new or empty build | A compact strip: Exilus and slots 1-4 on top, Arcane and slots 5-8 below, with the target slot ringed | The **Picker**: title "Choose a mod for slot 3 · Madurai · now Point Strike", tabs Mods, Arcanes and Best for slot N, search, a Filters button and a count, and the card grid | The same, plus an **If equipped** column for the focused or hovered card (stats are computed synchronously) and a line with the best-mod DPS gain when the sweep has it |

Picker flow rules:

- **Building from scratch** (the target slot was empty): equipping auto-advances to the next empty slot and stays in Picking. Filling the last slot, or pressing Esc, returns to Rest.
- **Swapping** (the target slot was filled): equipping returns to Rest. This is the tweak loop, and the result is read right away.
- **The tab follows the slot.** The Arcane slot opens on Arcanes, a mod slot on Mods, and Shift+Enter opens "Best for slot N".
- **Defaults:** "Hide equipped" and "Fits this weapon" are on by default and are not shown as chips. Only a filter that differs from the default appears, as a removable token beside the search box.

### 5.2 Wireframe, 1440x900, rest

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ≡  UF  New build  ● Unsaved                                   ↶  ↷   ⌗ Import   [ Save ]  ⋯  │ – □ × │ 48
├───────────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ LOADOUT  880 px                                       │ READOUT  560 px (layer background)       │
│                                                       │                                          │
│ Braton Prime ▾    [ Normal Attack | Incarnon Form ]   │ Average DPS                 Time to kill │
│ Capacity ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  56 / 60  Catalyst on 8 Forma │ 18,652                       1.99 s │
│                                                       │ ▼ 15.6% vs previous run                  │
│ Exilus              Arcane · Merciless, 12 stacks     │ vs Elite Crewman · Lv 145 · Corpus Change ⋯ │
│ ┌──────────────┐    ╭────────╮                        │ ◐ Partially simulated: 1 mod · Details   │
│ │Vile Precision│    │ arcane │                        │                                          │
│ └──────────────┘    ╰────────╯                        │ Weapon stats           Base Modded Change │
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐      │ ──────────────────────────────────────── │
│ │Serration ││Split Ch. ││Point Str.││Vital Sen.│ 199  │ Damage per projectile  35.0 1,006.3 +2775%│
│ └──────────┘└──────────┘└──────────┘└──────────┘ x100 │ Crit chance             12%    24%  +100% │
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐      │ Crit multiplier        2.0×   3.2×   +60% │
│ │Infected C││Stormbrin.││Hellfire  ││Cryo Rnds │      │ Status chance           26%    26%     —  │
│ └──────────┘└──────────┘└──────────┘└──────────┘      │ Multishot               1.0    1.9   +90% │
│ ┌ 🔍 Add or swap mods: select a slot, or type   Ctrl+F ┐│ Fire rate            9.58/s 6.13/s  −36% │
│                                                       │ Magazine                 75     75     —  │
│ Why this DPS [Health over time|Damage by hit|Notes]   │ Reload               2.15 s 1.65 s  −23% │
│ ┌───────────────────────────────────────────────────┐ │ Punch through           0 m    0 m     —  │
│ │ health / shields step chart, 830 x 220            │ │ Faction (Corpus)          —   none     —  │
│ │                                                   │ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ damage split bar        │
│ └───────────────────────────────────────────────────┘ │ ■ Impact 1.8→10.9    ■ Puncture 12.3→76.6 │
│                                                       │ ■ Slash 20.9→131.3   ■ Blast 0→393.8      │
│                                                       │ ■ Corrosive 0→393.8                       │
│                                                       │ Compare · 2 pinned        [📌 Pin result] │
│                                                       │ Baseline · before Vital Sense 21,705 1.71s│
│                                                       │ Steel Path on        22,336 4.07 s +2.9% │
│                                                       │ Damage engine and data by underframe.site│
└───────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

### 5.3 Wireframe, 1440x900, picking (slot 3, "Best for slot 3" tab)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ≡  UF  New build  ● Unsaved                                   ↶  ↷   ⌗ Import   [ Save ]  ⋯  │ – □ × │
├───────────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ Braton Prime ▾  Normal Attack        Capacity ▓▓▓▓░ 56/60 │ Average DPS 18,652      Time to kill 1.99 s │
│ [Exilus][ S1 ][ S2 ][▣S3▣][ S4 ]   160x80, 5 columns  │ ▼ 15.6% vs previous run                  │
│ (Arcane)[ S5 ][ S6 ][ S7 ][ S8 ]                      │ vs Elite Crewman · Lv 145 · Corpus Change │
│ Choose a mod for slot 3 · Madurai · now Point Strike  Done Esc │ ◐ Partially simulated · Details  │
│ Mods  Arcanes  [Best for slot 3]  [🔍 Filter results… ]  ⚲ Filters  15 ranked │ ⓘ Primed Bane of Corpus in slot 3: │
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                 │   +31.2% DPS (best-mod run). Enter equips. │
│ │+31%││+13%││+9% ││+8% ││+7% ││+5% │  128x187 cards  │ Weapon stats      Base Modded If equipped│
│ │card││card││card││card││card││card│  6 columns      │ Damage per proj.  35.0 1,006.3            │
│ └────┘└────┘└────┘└────┘└────┘└────┘                 │ Crit chance        12%    24%       12%  ◀ │
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                 │ ... all rows ...                          │
│ │    ││    ││    ││    ││    ││    │                 │ Faction (Corpus)     —   none      +55%  ◀ │
│ └────┘└────┘└────┘└────┘└────┘└────┘                 │ damage split + elements                   │
│ ┌────┐┌────┐┌────┐ … (the grid scrolls; the only scroll region) │ Compare …                  │
└───────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

### 5.4 Wireframe, 1100x700, rest and picking

```
REST                                                     PICKING
┌────────────────────────────────────────────────────┐  ┌────────────────────────────────────────────────────┐
│≡ UF New build ● Unsaved      ↶ ↷ ⌗Import [Save] ⋯ │ │  │≡ UF New build ● Unsaved      ↶ ↷ ⌗Import [Save] ⋯ │ │
├──────────────────────────────┬─────────────────────┤  ├──────────────────────────────┬─────────────────────┤
│ LOADOUT 640                  │ READOUT 460         │  │Braton Prime ▾ NA  Cap ▓▓░56/60│ DPS 18,652  TTK 1.99│
│ Braton Prime ▾ [NA|Incarnon] │ Avg DPS 18,652  1.99 s │ │[Ex][S1][S2][▣S3][S4] 115x58  │ ▼15.6% · vs Elite…  │
│ Capacity ▓▓▓▓▓░ 56/60 Cat 8F │ ▼15.6% vs previous  │  │(Ar)[S5][S6][S7 ][S8]         │ ◐ Partially · Details│
│ Exilus     Arcane · 12 stk   │ vs Elite… Change ⋯  │  │Choose a mod for slot 3  Done │ ⓘ preview line       │
│ [Vile Prec] (arc)            │ ◐ Partially · Details│ │Mods Arcanes Best  🔍  Filters │ Stats Base Mod If eq │
│ [S1 ][S2 ][S3 ][S4 ] 143x72  │ Stats  Base Mod  Chg│  │┌──┐┌──┐┌──┐┌──┐ 112x164 cards │ … all 10 rows …     │
│ [S5 ][S6 ][S7 ][S8 ]         │ … all 10 rows …     │  ││  ││  ││  ││  │ 4 columns     │ split + elements    │
│ [🔍 Add or swap mods  Ctrl+F]│ ▬▬▬ split bar       │  │└──┘└──┘└──┘└──┘               │ (readout scrolls    │
│ Why this DPS [Health|Hit|Notes] │ elements 3 rows  │  │┌──┐┌──┐┌──┐┌──┐               │  below here)        │
│ ┌ chart 592x170 ───────────┐ │ Compare · 2  [Pin]  │  ││  ││  ││  ││  │               │                     │
│ └──────────────────────────┘ │ (pins scroll below) │  │└──┘└──┘└──┘└──┘               │                     │
└──────────────────────────────┴─────────────────────┘  └──────────────────────────────┴─────────────────────┘
```

At 1100 the readout is 460 px. It still fits the whole sheet: 10 rows at 26 px, the split bar and three element lines, between the hero and the Compare header. Only the pinned rows sit below the fold. Below 1100 CSS px (zoomed), the stacked layout shows the Readout first, then the Loadout, then the context area, in one scroll.

### 5.5 Mockup

The static HTML uses the real card art from the local `core/images`, read by `file://` URL only; nothing was copied into the repo. It was rendered offscreen with the project's Electron (`render.cjs`).

- HTML: `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\mockup.html` (`?state=rest|pick`)
- `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\mockup-rest-1440x900.png`
- `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\mockup-pick-1440x900.png`
- `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\mockup-rest-1100x700.png`
- `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-flow\mockup-pick-1100x700.png`
- For comparison, the "before" captures: `m-1440-full.png`, `m-1100-full.png` and `m-1100-stats.png` in the same folder.

## 6. Decisions

### 6.1 Removed

| Element | Why | Where its job goes |
| --- | --- | --- |
| Status bar (the whole 28 px strip) | Always-on noise | The credits line stays visible as the last line of the Readout. Data version, app version and Discord move to About (also in top bar ⋯ › "About and credits", "Discord") |
| The separate build toolbar row (56 px) | Its contents fit the title bar | The top bar (6.2) |
| The title-bar caption "New build • Not saved yet" and the "Not saved yet" text | Duplicate | One dot plus "Unsaved" after the name; the Save button state |
| "Rifle · Rank 30" meta line | The rank is always 30; the type appears in the weapon picker list | The weapon picker's option text |
| "Fire mode" heading and the mode caption in the stats heading | Duplicate | One segmented control beside the weapon, shown only when the weapon has more than one mode; otherwise plain text |
| Rank "x/y" text on every slot at rest | Rank is encoded twice | Pips at rest. The number and −/+ appear in the hover or focus strip; the accessible name keeps "rank 5 of 5" |
| A slot's separate polarity glyph once a mod is equipped | Shown three times | Kept on the drain plate (number and glyph; red text plus the plate's tooltip when mismatched). The glyph shows on its own only on empty slots |
| "Slot N" tags on gallery cards, and equipped cards in the gallery | They duplicate the build | Hide equipped is on by default in the Picker; the build stays visible in the strip above |
| "Mods 102" count in the tab label | Duplicate | One count at the end of the Picker header |
| The gallery hint line and the stage's selection caption | The same message twice | One Picker title: "Choose a mod for slot 3 · Madurai · now Point Strike" |
| Pill styling on the delta and honesty badges | Colour noise | The delta is plain coloured text with ▲/▼; honesty is a neutral line with the ◐ glyph |
| The "30 s" duration dropdown, rerun button, run range, average hit and first hit on the result card | Rarely read | Readout ⋯ (Run again Ctrl+Enter, Simulated time) and the Details popover on the DPS (range, runs, average hit, first hit) |
| The Compare toolbar button | Third place for one task | The Compare section in the Readout; Ctrl+J moves focus to it |
| Stage ⋯ menu, and its duplicate "Import from screenshot" | Third ⋯ menu, third Import door | The capacity popover (Catalyst, Reset Forma, Clear mods); Import stays in the top bar |
| ⓘ icons beside Exilus and Arcane | Help shown permanently | The empty-slot text and the slot tooltips explain them |
| The always-on gallery (23.8 % / 19.5 %) | Used only while picking | The Picker, on demand (5.1) |

### 6.2 Merged

| Was | Becomes |
| --- | --- |
| Title bar plus build toolbar | **Top bar**, 48 px: ≡ Builds (Ctrl+B) · name (inline rename) · unsaved dot · ↶ ↷ · Import (one menu button: file Ctrl+I, clipboard Ctrl+V, game window Ctrl+Shift+G) · Save (Ctrl+S) · ⋯ (Save a copy, Rename, Delete, Notes, Shortcuts, About and credits, Discord) · window caption buttons |
| Stats rail plus the result card | **Readout**: DPS and TTK at equal weight, then the full stats table (Base, Modded, Change) with the damage split |
| Pin, the Compare button and the Compare drawer | The Readout's **Compare** section: [Pin this result] and the pinned rows (DPS, TTK, change against the baseline; each row's menu has Set as baseline, Open and Remove). "Expand" opens the full table (Changes, Weapon, Mode, Target) as a dialog over the Loadout |
| Capacity bar, "Orokin Catalyst · 8 Forma" and the Catalyst menu item | One capacity line; clicking it opens the capacity popover |
| Three honesty signals | One neutral line, "◐ Partially simulated: 1 mod · Details" (the popover lists the mods and explains What's simulated), plus a small neutral ◐ in that slot's corner. Engine-only results use the same pattern |
| The Charts and Notes tabs | The context area at rest: "Why this DPS" [Health over time · Damage by hit · Notes], with "Show as table" in its ⋯ |
| Gallery and the Best-mod view | **Picker** tabs: Mods, Arcanes and Best for slot N |
| Two damage-type displays (stats rail bars, charts) | One stacked split bar with a base→modded legend inside the stats; "Damage by hit" (projectile vs status) stays in the context area |

### 6.3 Moved behind disclosure, and how each is reached

| Item | How it is reached |
| --- | --- |
| Card gallery and search | Picker: click or Enter a slot, Ctrl+1…9 and Ctrl+Shift+9, Ctrl+F, typing in the finder, a stat row, or dropping an image (OCR, unchanged) |
| Effect, Polarity and Rarity filters, Fits, Hide equipped, Sort, card size | The Picker's Filters popover. Non-default filters show as tokens. The search grammar (`pol:v`, `drain<=6`, `rarity:rare` …) still works in the box |
| Best mod | Picker tab "Best for slot N", Shift+Enter on a slot, or ✦ in the slot's hover or focus strip |
| Target (enemy, level, faction, Steel Path, headshots, custom pools, enemy stats) | "Change" on the Readout's target line opens a popover form; Ctrl+T |
| Simulated time, rerun, run details | Readout ⋯ and the Details popover; Ctrl+Enter reruns |
| Forma and polarity per slot | The slot's ⋯ or right-click › Polarity (as now) |
| Catalyst, Reset Forma, Clear mods | The capacity popover |
| Notes | Context area › Notes, or top bar ⋯ › Notes |
| Library and featured builds | ≡ overlay (Ctrl+B), unchanged |
| The full compare table | Compare › Expand, or Ctrl+J then Enter |
| Shortcuts | ⋯ › Keyboard shortcuts (Ctrl+/), unchanged |
| Version, data version, Discord | About |

### 6.4 What gets more room

- **Weapon stats** grow from 264x475 (9.7 %) in a scrolling rail to a 516x426 block in the Readout at 1440 (16.9 %), and to 424x359 at 1100 (19.8 %; it was 0 % at rest). They gain:
  - all 10 sheet rows, adding **Punch through** (status duration is optional);
  - a **Base** column (with a base for the damage total) and a **Change** column in percent;
  - higher-is-better or lower-is-better colouring (Reload −23 % is green);
  - the five damage types as base→modded values beside the split bar.

  Each row is still a search shortcut: Enter or click opens the Picker with that token, as in the arsenal. The table is one tab stop with arrow-key roving.
- **DPS and TTK** become a 44 px hero (36 px at 1100) with TTK at equal weight. The stats sit directly under them: 0 px horizontal distance, about 130 px vertical.
- **Slots at rest** grow from 172x86 to 199x100 at 1440. Trade-off: at 1100 they shrink from 160x80 to 143x72, because the Readout takes 460 px to fit the whole sheet. Names remain legible in the mockup.
- **Cards while picking** go from 7 to 18 visible at 1440, 15 of them full (6 columns). At 1100, 8 full cards (4 columns) replace 6 cut-off ones.
- **The chart** gets 830x220 at rest at 1440 instead of a 330 px wide tab panel.

## 7. Everything that must keep working, and where it lives

| Feature | New home |
| --- | --- |
| Build library and featured builds | ≡ overlay (unchanged) |
| Save, rename, duplicate, delete, undo | Top bar: Save, the inline name, ⋯ (Save a copy, Delete with an undo toast), ↶ ↷ |
| Weapon picker and fire modes | The Loadout header (the segmented control appears only with more than one mode) |
| 8 mod slots, Exilus and Arcane, with ranks, stacks, drag and drop, keyboard | The Loadout grid (rest) or strip (picking); the hover and focus strip; pick-up mode and all slot keys unchanged. You can drag from the Picker to any slot in the strip, and drag a slot out to remove it |
| Card gallery with smart search and filters | Picker (search grammar, Did you mean, Filters popover) |
| Best-mod search | Picker tab "Best for slot N" |
| Capacity, Catalyst, Forma | The capacity line and its popover; slot Polarity menu |
| Target presets, level, Steel Path, custom pools | The target popover from the Readout |
| Weapon stats | Readout table (first-class) |
| DPS result, TTK, charts, damage breakdown | The Readout hero; the context area "Why this DPS"; the split in the stats |
| Compare pins | The Readout's Compare section, and Expand for the full table |
| OCR import (toolbar, Ctrl+V, drop, game window, review dialog) | Top bar Import menu, the same shortcuts, the drop overlay, the review dialog (unchanged) |
| Honesty badges | The neutral Readout line with its Details popover, and the slot corner glyph |
| Shortcuts | Unchanged, plus: Esc closes the Picker, Ctrl+T opens the target, Ctrl+J focuses Compare |
| Accessibility (WCAG 2.2 AA, full keyboard) | See 7.1 |
| Credits | Always visible as the Readout's last line; full text in About |
| Smoke mode and scene mode | Keep the existing `data-testid`s (`gallery-card`, `slot-*`, `stat-filter-*`, `result-card`, `avg-dps`, `compare-grid` …). The scene list gains "rest" and "picking" captures; the gallery scenes start by selecting a slot |

### 7.1 Accessibility notes for the state change

- **Opening the Picker** happens only on activation (a click, Enter, or a shortcut), never on focus alone (SC 3.2.1). Focus moves to the search box, and a polite live region announces "Choosing a mod for slot 3, 15 results."
- **Closing the Picker** (Esc or Done) returns focus to the slot that opened it.
- **F6 order:** top bar › Loadout › context area (Picker or Why this DPS) › Readout.
- **The If equipped preview** is part of each card's accessible description ("Crit chance 24% to 12%, Faction +55%"). It is not announced on every hover.
- **No meaning by colour alone:** the deltas carry ▲ and ▼ and signs, the mismatch drain carries a tooltip and the a11y text, and the honesty line carries a glyph and words.
- **Reduced motion:** the strip collapse is an instant swap when reduced motion is set; otherwise a 150 ms height transition.
- **Target sizes:** compact strip slots are at least 115x58, well above 24x24.
- **Reflow at 400 %:** the stacked layout puts the Readout first.

## 8. Target metrics

| Metric | 1440 now | 1440 target | 1100 now | 1100 target |
| --- | --- | --- | --- | --- |
| Regions on screen | 7 | **3** | 6 | **3** |
| Interactive controls at rest | 68 | **≤ 34** (−50 %) | 54 | **≤ 34** (−37 %) |
| Tab stops before the first slot | 29 | **≤ 10** | 14 | **≤ 10** |
| Distinct text strings outside the stats sheet | about 107 | **≤ 55** | about 91 | **≤ 45** |
| Boxed chips and overlays | 31 | **≤ 12** | 37 | **≤ 12** |
| Tinted pills | 3 | **0** | 3 | **0** |
| Bordered elements (10 of them are the slot rarity frames) | 32 | **≤ 14** | 22 | **≤ 14** |
| Separators | 4 | **≤ 2** | 3 | **≤ 2** |
| Accent hue families in the chrome | 5 | **3** (blue only for the primary action and selection; green and red only for deltas) | 5 | **3** |
| Scroll regions at rest / while picking | 3 / 3 | **0 / 1** (the card grid) | 2 / 2 | **1 / 2** (the Readout's pins, the card grid) |
| Weapon stats share of the viewport | 9.7 % | **≥ 16 %** | 0 % (9.2 % on the tab) | **≥ 18 %, at rest** |
| Stat lines visible without scrolling | 11 / 14 | **16 / 16** (10 rows, the total, 5 types) | 0 / 14 (4 / 14 on the tab) | **16 / 16, at rest** |
| Distance from DPS to stats | about 1,120 px across | **same column, ≤ 200 px down** | not visible together | **same column** |
| Chrome height | 132 px | **48 px** | 132 px | **48 px** |
| Gallery share at rest | 23.8 % | **0 %** (on demand) | 19.5 % | **0 %** |
| Cards visible while picking | 7 | **≥ 15 full** | 6, cut off | **≥ 8 full** |
| Places involved in comparing | 3 | **1** | 3 | **1** |

The planned rest-state controls at 1440 total 33:

| Group | Controls | Count |
| --- | --- | --- |
| Top bar | Builds, name, ↶, ↷, Import, Save, ⋯ | 7 |
| Loadout | Weapon, mode ×2, capacity, 10 slots, finder | 15 |
| Context area | Segments ×3, ⋯ (Show as table) | 4 |
| Readout | Change, ⋯, Details, stats grid (one roving stop), Pin, Compare Expand | 6 |
| Credits | Link | 1 |
| Total | | 33 |

Verify all of these with the same `measure.js` once the design is built.

## 9. Implementation sketch (for the orchestrator; not done here)

- `layout.js`: replace the four-column classes with `{ loadoutWidth, readoutWidth }`. Use 880/560 from 1400 px, about 640/460 from 1100 to 1399 px, the readout at 600 or more from 1680 px, and stacked below 1100 px. Add slot sizes for the `rest` grid and the `picking` 5x2 strip.
- `controller.js`: add `ui.picker: { open, slot, tab }`, derived from `selectedSlot` plus an explicit open flag. Equip adds the auto-advance and return-to-rest rules (5.1). Add `previewStats(cardName)`, which runs the synchronous `buildStats` with the card in the target slot.
- `Workspace.jsx`: render two columns. The Loadout holds `Stage` (`compact` when picking) and either `ContextArea` or `Gallery`. The Readout is new: `ResultCard` (hero only), `StatsPanel` as a table, and a Compare section.
- `TitleBar.jsx` and `BuildToolbar.jsx` become one top bar. `StatusBar.jsx` is removed; its credits move to the Readout and the rest to About.
- `TargetCard.jsx` becomes popover content; `CompareDrawer.jsx` becomes a section plus an Expand dialog; `ChartsPanel.jsx` and `NotesCard.jsx` become the context area segments.
- `Gallery.jsx`: the header becomes one row (tabs, search, Filters popover, count). Drop the slot tags; "Hide equipped" defaults to on in the Picker.
- `SlotCard.jsx`: drop the rank text at rest and the equipped slot's separate polarity glyph; make the honesty badge a neutral corner glyph.
- `scenes.js`: add captures for rest, picking, picking-best, the target popover and compare in the Readout, and keep the existing ids.
