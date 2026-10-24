# Declutter review: visual density, hierarchy and calm

Lens: **calm**. One of two independent reviews written in answer to this feedback: "the screen feels so cluttered, the user is bombarded in every direction and the core stuff that you actually care about like weapon stats get cut away."

This document holds the before metrics (measured over CDP), what the user needs at each moment, one radical restructure (wireframes and a rendered mockup), the exact list of removals, merges, moves and disclosures, and the target metrics.

---

## 1. How this was measured

- **Builds and screens.** The current renderer build (`build/renderer`, 2026-10-24), dark theme, run in a fresh profile with CDP at 1440x900 and 1100x700.
- **Flows driven:**
  - built from scratch by clicking gallery cards into the first empty slot;
  - Exilus and arcane added through the gallery;
  - ranks lowered to fit capacity (60/60);
  - two pins plus Compare;
  - hover on a slot and the stage menu.
- **Scenes reviewed:** all 35 scenes in `scenes-arsenal/dark-1440x900`, plus the light 1440x900 set and the 1100x700 set.
- **Measurement script:** `scratchpad/declutter-calm/measure.js`, run with `drive.mjs`, `fill.mjs`, `ranks.mjs` and `meas.mjs`.
  - It counts only what is painted: an element counts when it is inside the viewport and inside every clipping ancestor, and is not `visibility:hidden` or opacity 0.
  - Everything is measured at rest: no hover, no focus, mouse parked.
- **Raw output:** `scratchpad/declutter-calm/shots/*-metrics.json`, with the matching PNGs next to them.

The scratchpad root is `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad`.

## 2. Before: clutter metrics

Measured on a full build (8 mods, Exilus, arcane) at rest.

| Metric | 1440x900 | 1100x700 |
| --- | --- | --- |
| Visible interactive controls (outermost) | **76** (toolbar 9, stats 11, stage 14, gallery and status ~32, results 9) | **53** |
| Tab stops | 57 | 40 |
| Visible text nodes / distinct strings | **215 / 155** | 137 / 91 |
| Text below 12 px / at 12 px / at 14 px | 12 / 143 / 53 (**72 % of all text is caption size or smaller**) | 2 / 92 / 38 |
| Font sizes in use | 5 (10, 12, 14, 16, 40) | 5 |
| Coloured pills and badges | 3-4: "Partially simulated", the delta pill, "12 stacks", the Exilus warning | 2 |
| Dark badge plates over card art | **24**: 10 slot drain plates, 7 gallery "Slot N" badges, 7 gallery drain plates | 18 |
| Overlay elements on slot cards | **39** (about 4 per card: slot polarity, drain plate, pips, rank text, badge) | 38 |
| Elements with a visible border (edges) | **72 (205)**; 4 dividers | 54 (181); 3 dividers |
| Accent-tinted elements by hue | blue 107, green 17, red 6, orange 5 (10 distinct accent values), plus yellow, card gold and 6+ damage-type colours | blue 56, green 5, red 4, orange 1 |
| Visible icons (8-28 px SVG) | 45 | ~35 (estimate) |
| Regions with their own scroll | **3**: stats rail (475 of 629 px), gallery (208 of 3,019), results tab panel (449 of 528) | 2: gallery (155 of 2,928), results (209 of 522) |
| Visual regions at rest | **9**: title bar, toolbar, stats rail, stage, gallery header, gallery grid, result card, result tabs, status bar | 8 |
| Viewport share: weapon stats | **8.1 %** (254 px wide) | **0 % at rest**; 7.6 % with the Stats tab open |
| Viewport share: gallery grid (+ header) | 23.8 % (~32 %) | 19.5 % (~27 %) |
| Viewport share: result card | 6.7 % | 11.6 % |
| Stat rows fully visible without scrolling | **11 of 14** (the damage types are cut after Puncture) | **0 of 14 at rest; 4 of 14** with the Stats tab open |
| Helper sentences at rest | 3: "No slot selected: cards go…", "Sheet values before enemy armor…", "One sample run…" | 2 |

Layout defects seen along the way:

- **Target tab:** at 1440x900 it overflows to the right. The Faction field and its helper ("Sets which faction (bane) mods ap…") are clipped (scene 23).
- **Compare drawer:**
  - it squeezes the gallery to a sliver;
  - it truncates the build ("New…"), mode ("Normal …") and target ("Elite Crewman · L14…") columns;
  - it compares only DPS and TTK, never stats (scene 22).
- **At 1100x700:**
  - the gallery's single card row is cut off at about 60 % of card height;
  - "Enemy health over time" and "Show as table" wrap;
  - the duration dropdown wraps onto its own row;
  - the search placeholder is truncated.

## 3. Everything that appears twice or more

| Item | Where it repeats |
| --- | --- |
| Each equipped mod's name | Slot art **and** the gallery card (8x). The gallery shows equipped mods by default with a "Slot N" badge. |
| Each equipped mod's drain and polarity | Slot drain plate **and** the gallery drain plate. The gallery plate also covers the drain already printed on the card art. |
| Polarity | The slot polarity glyph (top-left) **and** the polarity glyph in the drain plate, on every filled slot. |
| Rank | Pips **and** "5/5" text, on every slot. The gallery art also prints its own pips. |
| Build name and saved state | Title bar "New build • Not saved yet" **and** toolbar name field + "Not saved yet". |
| Weapon name | Picker **and** the "Fits Braton Prime" chip; also the compare table. |
| Fire mode | Stats caption "Normal Attack" **and** the fire mode radios (a dropdown at 1100). |
| Capacity | Bar **and** "54 / 60"; Catalyst and Forma in the stage subtitle **and** in the stage ⋯ menu. |
| Import from screenshot | Toolbar split button **and** the stage ⋯ menu (plus Ctrl+I, Ctrl+V and drop). |
| Exilus / Arcane | Caption above with ⓘ **and** the slot label; "Arcane · Merciless" caption **and** the arcane art. |
| Mod count | "Mods 102" tab **and** "102 mods" at the right. |
| Target | The result card line **and** the Target tab summary line **and** the form fields. |
| Simulated time | "30 s each" in the spread line **and** the "30 s" dropdown. |
| Weapon type | "RIFLE" printed on all 8 visible gallery cards (always true while "Fits weapon" is on). |
| Damage composition | Stats rail damage-type bars **and** the "Damage by hit type" chart. |
| Pin count / delta | The Compare button badge **and** the drawer rows; the DPS delta pill **and** the compare "vs baseline" column. |

## 4. The core loop: what matters at each moment

| Moment | The user needs | Noise at that moment |
| --- | --- | --- |
| **Read the build** (most of the time) | DPS, TTK, all modded stats with base-to-modded changes, the 10 equipped cards, capacity | Gallery header, filters and 7+ cards; charts; target form; status bar; helper text; pips |
| **Choose a mod for a slot** | The selected slot, the search, a row of candidate cards, *what each candidate does to my stats and DPS* | Charts, compare, notes, credits, other slots' pips and badges |
| **Tweak ranks** | The slot's rank stepper and the stat rows changing live | Gallery, charts |
| **Import a screenshot** | The review dialog | Everything behind it. The dialog itself shows a green "High 1.00" pill on every row; only the doubtful rows need attention. |
| **Compare variants** | A side-by-side **stat** diff of the pins | The gallery (the drawer currently sits on top of it), slot art |
| **Change the target** | Enemy, level, faction, Steel Path, and the DPS reacting | The gallery and the stage |

The current UI shows every moment's tools all the time. The weapon stats are the thing that matters in every moment, and they get the least room: 8 % of the screen, or none at all at 1100 px.

---

## 5. Proposal: "The Sheet and the Bench"

**Core idea.** Two columns, one focal point, everything else on request.

- **The Sheet** (left, always visible) is the weapon: its name, the DPS hero, and a full **Base → Modded → Change table** of every stat. It is the only place results live.
- **The Bench** (right) is where you work. It has two views behind one segmented control:
  - **Mods**: the arsenal slot arrangement with card art, plus a gallery **tray** that is a single search bar until you ask for mods;
  - **Analysis**: charts, compare, target details and notes.
- **Gone at rest:** the gallery grid, its filters and helper text, the charts panel, the compare drawer, the status bar and the separate title bar.

The arsenal feel stays: the 2x4 card grid with Exilus and the arcane dome, card art, and drag and drop. While choosing a mod, the Sheet shows **ghost previews** of the changes ("21% → 39%"), so the stats are the feedback loop instead of a side panel.

### 5.1 Wireframe, 1440x900 (rest: reading the build)

```
┌────────────────────────────────────────────────────────────────────────────────────────────── 48 ┐
│ ≡  Braton crit and toxin  Edited                          ↶ ↷   ▣ Import screenshot  [ Save ]  ⋯  — □ ✕ │
├──────────── SHEET 440 ────────────┬──────────────────────── BENCH ──────────────────────────────────┤
│ Braton Prime ▾      Rifle·R30·Cat·8F │ [Mods | Analysis · 2 pins]              Capacity ▬▬▬▬▬▬▬▬ 54/60 ⋯ │
│                                      │                                                                 │
│ Average DPS                 [📌 Pin] │                                                                 │
│ 21,705  ↓ 2.1%                       │                    ┌──────────┐   ◠◠◠                           │
│ 17.5k–28.9k · 8 runs × 30 s · ⚠ Partially simulated      │ !  Vile  4⟂│  (arcane)                      │
│ Time to kill  Average hit  First hit │                    │ Precision 3/5│ 5/5·12 stacks                 │
│ 1.71 s        1,469        1,619     │                    └──────────┘                                 │
│ (vs Elite Crewman · L145 · Corpus ▾) │   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│                                      │   │Serration│ │Split Ch.│ │Point St.│ │Vital S.│  216x108 cards   │
│ Weapon stats        [Normal|Incarnon]│   │   7⟂ 10/10│ │  8⟂  5/5│ │  3⟂  2/5│ │ 8⟂! 2/5│                   │
│              Base   Modded   Change  │   └────────┘ └────────┘ └────────┘ └────────┘                   │
│ ──────────────────────────────────── │   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│ Damage / projectile 35.0 1,006.3 ×28.8│   │Infected │ │Stormbr. │ │Hellfire │ │Cryo R. │                   │
│ Crit chance         12%    21%   +75%│   └────────┘ └────────┘ └────────┘ └────────┘                   │
│ Crit multiplier     2.0×   3.2×  +60%│                                                                 │
│ Status chance       26%    26%       │                                                                 │
│ Multishot           1      1.9   +90%│                    (calm empty space: the stage                 │
│ Fire rate           9.58/s 7.28/s −24%│                     is centred in what is left)                 │
│ Magazine            75     75        │                                                                 │
│ Reload              2.15 s 1.65 s −23%│                                                                 │
│ Faction bonus       —      none      │                                                                 │
│                                      │                                                                 │
│ Damage by type · per projectile      │                                                                 │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (stacked)  │                                                                 │
│ ■Impact 10.9 ■Puncture 76.6 ■Slash 51│                                                                 │
│ ■Toxin 290   ■Cold 255   ■Radiation 322├─────────────────────────────────────────────────────────────────┤
│ Engine and data by Underframe… · About│ 🔍 Add a mod: name, effect, cc, drain<=6…  [Mods|Arcanes] Filters ˄│
└──────────────────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

**Choosing a mod** (slot 3 selected, or Ctrl+3, or typing in the search):

- The tray rises to one card row (~230 px). The stage slides up; nothing else moves.
- The slot shows a brand outline.
- The search says "replacing Point Strike in slot 3".
- Hovering or focusing a card ghosts its changes into the Sheet ("Crit chance 21% → 39%") and gives the card a DPS gain chip once best-mod has run.
- Esc closes the tray and returns focus to the slot.

**Analysis view** (Ctrl+J or the segment):

- The stage is swapped for two columns:
  - left: Charts (Enemy health | Damage by hit | Table) with "Simulate 30 s ▾ · Run again" under them, then Target and Notes;
  - right: Compare, a pin table with **stat rows**, labelled by pin ("A · baseline", "B · Steel Path").
- The Sheet stays put, so you read the stats and the charts together.

### 5.2 Wireframe, 1100x700 (rest)

```
┌──────────────────────────────────────────────────────────────────────────────────── 44 ┐
│ ≡ Braton crit and toxin  Edited                      ↶ ↷  ▣  [ Save ]  ⋯     — □ ✕ │
├────────── SHEET 352 ──────────┬────────────────────── BENCH ───────────────────────────┤
│ Braton Prime ▾                │ [Mods | Analysis · 2 pins]       Capacity ▬▬▬▬▬ 54/60 ⋯ │
│ Average DPS          [📌 Pin] │                                                         │
│ 21,705 ↓ 2.1%                 │               ┌────────┐  ◠◠◠                           │
│ 17.5k–28.9k · 8 runs × 30 s   │               │ Vile P. │  5/5 · 12 stacks              │
│ ⚠ Partially simulated         │               └────────┘                               │
│ TTK 1.71 s  Avg 1,469  First 1,619 │ ┌──────┐┌──────┐┌──────┐┌──────┐  166x83 cards     │
│ (vs Elite Crewman·L145·Corpus ▾)│  │Serr.  ││Split  ││Point  ││Vital │                  │
│ Weapon stats   [Normal|Incarnon]│  └──────┘└──────┘└──────┘└──────┘                  │
│           Base  Modded Change │  ┌──────┐┌──────┐┌──────┐┌──────┐                    │
│ Damage/proj. 35.0 1,006.3 ×28.8│  │Infect.││Storm. ││Hellf. ││Cryo  │                  │
│ Crit chance  12%   21%   +75% │  └──────┘└──────┘└──────┘└──────┘                    │
│ Crit mult.   2.0×  3.2×  +60% │                                                         │
│ Status       26%   26%        │                                                         │
│ Multishot    1     1.9   +90% │                                                         │
│ Fire rate    9.58  7.28  −24% │                                                         │
│ Magazine     75    75         │                                                         │
│ Reload       2.15s 1.65s −23% │                                                         │
│ Faction      —     none       │                                                         │
│ Damage by type ▬▬▬▬▬▬▬▬▬▬▬▬▬  │                                                         │
│ Impact 10.9 Puncture 76.6 …   ├─────────────────────────────────────────────────────────┤
│ Underframe credit · About     │ 🔍 Add a mod…            [Mods|Arcanes]  Filters  ˄      │
└───────────────────────────────┴─────────────────────────────────────────────────────────┘
```

- Rows are 24 px with 13-14 px text.
- Import is icon-only.
- The open tray (choosing) takes one 112 px-wide card row; the slots move up, and the Sheet still shows every row (see `mock-1100-choose.png`).
- Analysis opens in the Bench, as at 1440.

### 5.3 Rendered mockup

- **Source:** `…\scratchpad\declutter-calm\mockup.html`, a static HTML page. Its card art is referenced from the local private `core/` checkout for the render only; nothing is copied into this repo.
- **Renderer:** `render.cjs` (Electron offscreen) via `render.sh`. The same script runs `measure.js` on the mockup.
- **PNGs** (all under `C:\Users\nilas\AppData\Local\Temp\claude\D--\27878ae4-50b6-4c3c-8181-593b046e8ff5\scratchpad\declutter-calm\`):
  - `mock-1440-rest.png`: reading the build
  - `mock-1440-choose.png`: slot 3 selected, tray open, ghost preview "21% → 39%", best-mod gains on the cards
  - `mock-1440-analysis.png`: charts, compare with stat rows, target and notes
  - `mock-1100-rest.png`
  - `mock-1100-choose.png`
- **Before captures for comparison:** `…\scratchpad\declutter-calm\shots\d1440-full.png`, `d1100-full.png` and `d1100-stats.png`.

---

## 6. Decisions

### 6.1 Removed

| What | Why / replacement |
| --- | --- |
| The separate 48 px title bar | Merged with the build toolbar into one 48 px bar: menu, build name (inline edit, F2), "Edited" when dirty, undo, redo, Import screenshot, Save, ⋯, window controls. Saves 58 px and one region. |
| The status bar (credits sentence, data version, app version, Discord, About) | The credit line moves to the foot of the Sheet (12 px, foreground3, with "About"). Data version, app version and Discord move to About and to ⋯ › "Join the Discord". |
| "Not saved yet" (x2) | "Edited" (foreground3) after the name, only when dirty. A saved build shows nothing. |
| Save split chevron, Import split chevron | Save as copy goes to ⋯ (Ctrl+Shift+S). Import options (from file, game window, clipboard) go to ⋯ › Import ▸. The button itself still opens the file picker; Ctrl+V and drop are unchanged. |
| The Compare toolbar button | The pin count shows on the "Analysis · 2 pins" segment. Ctrl+J opens Analysis › Compare. |
| Rank pips at rest (slots) | "5/5" text only. Pips and −/+ stay in the existing hover, focus and selected action bar. |
| The duplicate slot polarity glyph on filled slots | Polarity shows once, in the drain plate. A mismatch keeps its red outline and up arrow (non-colour cue). Empty slots keep their centred glyph. |
| The in-app rarity overlay frame on slot cards | The card art already carries the rarity frame. Rarity is still spoken. |
| Exilus / Arcane captions with ⓘ, "Arcane · Merciless" | Slot labels and art carry this; explanations move to tooltips. The arcane name is in its tooltip and accessible name. |
| The "12 stacks" pill | Plain text under the dome: "5/5 · 12 stacks". The stacks popover is unchanged. |
| The selection caption ("Slot 3 selected. Click a card…") and the gallery hint ("No slot selected: cards go…") | The search field says it in place: "Add a mod…", "Add to slot 3…", "replacing Point Strike in slot 3". |
| "102 mods" count | Lives in the Filters popover and in the polite live status; the tab label is just "Mods". |
| "RIFLE" type tag, "Slot N" badges, and drain plates on gallery cards | Hide equipped is on by default, so equipped cards are not repeated. Drain and polarity are printed on the art. The honesty icon and the best-mod gain chip stay. |
| Yellow "Partially simulated" pill, red/green delta pill | Text with an icon: "⚠ Partially simulated" (a button opening the same popover) and "↓ 2.1%" in status colour. Same honesty, no fills. |
| "Sheet values before enemy armor…" footnote | Tooltip on the table caption ⓘ. |
| Capacity bar in brand blue | Neutral bar; red only over capacity, with the "36 over capacity" text (unchanged). |

### 6.2 Merged

| What | Into |
| --- | --- |
| Weapon stats rail + result card + Stats tab (<1280) | **The Sheet**: weapon picker, DPS hero, KPIs, target chip, stats table, damage-by-type bar. One column at every size, never folded into a tab. |
| Fire mode radios (+ "Fire mode" label) and the stats mode caption | One segmented control in the stats table caption, rendered only when the weapon has 2 or more modes. Stats and DPS are per mode, so the control sits on the thing it changes. |
| Stats damage-type bars | One stacked composition bar + a 3-column legend (12 px). Clicking a legend item searches that element (today's stat-row search behaviour). |
| Gallery tabs, filters row, sort, view toggle, count, hint | One tray header row: search · [Mods / Arcanes (/ Best for slot 3)] · Filters · collapse chevron. The Filters popover holds Effect, Polarity, Rarity, Fits weapon, Hide equipped, Sort, Card size and the count. Non-default filters show as removable tokens inside the search field. |
| Compare drawer + Charts / Target / Notes tabs | The **Analysis** view in the Bench. Compare gains stat rows (DPS, TTK, crit, status, fire rate, multishot, target) and pin labels from the "Changes" text, so names no longer truncate. |
| Duration dropdown + Run again (result card) | Analysis › Charts footer: "Simulate 30 s ▾ · Run again". Ctrl+Enter is unchanged. |
| Stage ⋯ and toolbar ⋯ | The stage ⋯ next to capacity keeps the build-mechanics items (Catalyst, Forma, reset polarities, remove all). Everything about the file (save copy, duplicate, delete, import options, shortcuts, about) goes to the top bar ⋯. Import no longer appears in two menus. |

### 6.3 Behind disclosure, and how to reach it

| Hidden at rest | Reached by |
| --- | --- |
| Gallery cards and filters | **Tray.** It opens on: a click on any slot (empty or filled); typing in or focusing the always-visible search; Ctrl+F; Ctrl+1…9 / Ctrl+Shift+9; the chevron; the start of a drag. It closes on Esc (focus returns to the slot), on the chevron, or after equipping into the last empty slot. On a new or empty build it starts open with slot 1 selected. A "Keep open" preference is in the Filters popover; it is a per-viewer convenience in localStorage, wrapped in try/catch. `aria-expanded` sits on the chevron. |
| Charts, compare, notes, simulation settings, full target form, custom pools, enemy stats | **Analysis** segment (Ctrl+J). The pin count is on the segment. |
| Common target settings | The **target chip** in the hero opens a Popover with enemy, level, faction and Steel Path, plus "More target options" (goes to Analysis › Target). |
| Rank −/+, best mod, remove, slot menu | The existing hover, focus and selected action bar and Shift+F10 (unchanged). |
| Best-mod results | ✦ on a slot (or Shift+Enter): the tray opens on "Best for slot 3" with gain chips on the cards. |
| Builds library, featured | ≡ / Ctrl+B (unchanged overlay). |
| Credits detail, versions, Discord | About (Sheet foot and ⋯). |

### 6.4 What gets more room

- **Weapon stats.**
  - From a 254 px rail (8.1 %) with two-line rows to a **392 px table**: about 12.6 % for the table alone, and 29 % for the Sheet with DPS.
  - One line per stat, with Base, Modded and a signed Change column; Modded is bold when changed.
  - All 9 stat rows and every damage type are visible at 1440x900 **and** 1100x700, with no inner scroll.
  - The free space under the table at 1440 (~150 px) has room for 4-5 more engine stats (punch through, accuracy, ammo, falloff) if the engine exposes them.
- **DPS** stays the 40 px display number, now next to the stats that explain it.
- **Card art.** Slots keep 216x108 at 1440. With fewer overlays the art and the printed name read clearly.
- **Calm space.** At rest the Bench has empty space around the centred slot block. That space is what the tray uses when you ask for mods; when you don't, it is room to breathe.

### 6.5 Visual system (the calm rules)

- **Type ramp:** 40 (DPS) / 20 (weapon) / 16 (KPI values, build name) / 14 (body, table) / 12 (meta only). Nothing below 12 px. Weights 400 and 600 only.
- **Colour roles:**
  - brand blue only for Save, focus, selection, the active segment and ghost previews;
  - green and red only for signed changes (the Change column, the DPS delta, the compare diff) and drain mismatch;
  - yellow only on the honesty icon;
  - damage-type colours only in the composition bar and the charts;
  - links inside the app become subtle buttons.
- **Separation by surface tone, not strokes:**
  - the Sheet uses `--uf-layer`, the Bench the window background;
  - the only hairlines are under the table header and above the tray;
  - no per-row borders and no card around the result.
- **Spacing:** 8 px grid; column padding 24 (Sheet) / 32 (Bench); table rows 28 px (24 px when height < 800).
- **Overlays on a slot card:** at most a drain plate, rank text and (when needed) the honesty icon.

### 6.6 Accessibility and keyboard (still WCAG 2.2 AA, full keyboard)

- **Stats table:** a real `<table>` with a `<caption>` (includes the mode) and column headers.
  - Change cells carry a sign and an arrow, never colour alone.
  - Row-click "Find mods that raise X" becomes a grid: one tab stop, arrow keys, Enter. A hover/focus "Find mods" icon replaces 11 always-on buttons.
- **Ghost preview:** announced politely on card focus, for example "Critical Delay: crit chance 21 to 39 percent, DPS up 18.2 percent", reusing the Announcer.
- **Segmented controls** (Mods/Analysis, mode, Mods/Arcanes) are a `TabList` / `RadioGroup` with one tab stop each.
- **F6 order:** builds → top bar → Sheet → Bench (slots) → tray → Analysis.
- **Shortcuts:**
  - every existing shortcut is kept;
  - Ctrl+J now means "Show Analysis › Compare";
  - Esc closes the tray;
  - Ctrl+F opens the tray and focuses the search.
- **Focus rules:**
  - closing the tray returns focus to the selected slot;
  - opening Analysis focuses its first tab.
- **Contrast:** meta text at 12 px stays at foreground3 ≥ 4.5:1 on both surfaces (check in light theme: `#616161` on `#f5f5f5`).

### 6.7 Feature checklist (all still reachable)

| Feature | Where it lives now |
| --- | --- |
| Library and featured | ≡ / Ctrl+B |
| Save, rename, duplicate, delete, undo | Top bar + ⋯ + F2 / Ctrl+S / Ctrl+Z |
| Weapon picker and fire modes | Sheet header and table caption |
| 8 slots, Exilus, arcane, ranks, stacks, drag and drop, keyboard | Bench, unchanged mechanics |
| Card gallery, smart search and filters | Tray |
| Best mod | ✦ → tray |
| Capacity, Catalyst, Forma | Bench header + stage ⋯ |
| Target presets, level, Steel Path, custom pools | Target chip popover + Analysis › Target |
| Weapon stats | Sheet table |
| DPS, TTK, charts, breakdown | Sheet hero + Analysis |
| Compare pins | Pin (Ctrl+P) + Analysis › Compare |
| OCR import (toolbar, Ctrl+V, drop, game window, review) | Unchanged entry points. The review dialog shows only low-confidence rows highlighted, with "Read as" on expand, instead of a green "High 1.00" pill on every row. |
| Honesty | Hero "⚠ Partially simulated" popover, the slot honesty icon, the gallery card icon, Analysis notes |
| Credits | Sheet foot + About |
| Smoke and scene modes | Keep the existing test IDs on the moved components (`stats-rail` on the Sheet table, `result-card` on the hero, `gallery*` in the tray). Add scenes for tray open/closed, Analysis and the target popover; scenes that expect an always-visible gallery need to open the tray first. |

---

## 7. Target metrics

"Mockup" values are `measure.js` run on the static mockup. It has no real buttons, so control counts come from the design inventory instead.

| Metric | Before 1440 | Before 1100 | Target | Mockup 1440 / 1100 |
| --- | --- | --- | --- | --- |
| Visible interactive controls at rest | 76 | 53 | **≤ 35 / ≤ 32**: more than halved at 1440. Inventory: top bar 7, Sheet 7, Bench header 3, slots 10, tray bar 5 = 32. | n/a |
| Tab stops at rest | 57 | 40 | **≤ 25** | n/a |
| Visible text nodes / distinct | 215 / 155 | 137 / 91 | **≤ 110 / ≤ 95** | 106 / 92 · 104 / 90 |
| Text < 12 px | 12 | 2 | **0** | 1 (a glyph) |
| Share of text at caption size (12 px) | 67 % | 67 % | **≤ 50 %** | 46 % / 40 % |
| Coloured pills / badges at rest | 3-4 | 2 | **0** (delta and honesty become text) | 0 |
| Dark plates over card art | 24 | 18 | **≤ 11** (10 drain plates + honesty icons) | 10 |
| Overlay elements on slot cards | 39 | 38 | **≤ 21** | 21 |
| Bordered elements (edges) | 72 (205) | 54 (181) | **≤ 20 (≤ 40)** | 5 (5) |
| Dividers | 4 | 3 | **≤ 2** | 2 |
| Brand-blue elements | 107 | 56 | **≤ 12** | 2-3 |
| Visible icons | 45 | ~35 (est.) | **≤ 25** | ~23 |
| Scroll regions at rest | 3 | 2 | **0** (1 while the tray or Analysis is open) | 0 |
| Visual regions at rest | 9 | 8 | **3** (top bar, Sheet, Bench) | 3 |
| Weapon stats share (table only) | 8.1 % | 0 % (7.6 % in tab) | **≥ 12 % at both sizes** (Sheet ≥ 25 %) | 12.6 % / 13.4 % (Sheet 29 % / 30 %) |
| Stat rows fully visible, no scroll | 11 / 14 | 0 / 14 (4 / 14 in tab) | **All rows, both sizes** | 15 / 15 · 15 / 15 |
| Semantic duplicates at rest (section 3) | 16 kinds | ~14 kinds | **0** | 0 |
| Helper sentences at rest | 3 | 2 | **0** | 0 |

**Acceptance.** Re-run `measure.js` (via `drive.mjs`/`meas.mjs`) on the implemented UI at 1440x900 and 1100x700, in both themes, with the same full build. Every target in this table must hold. Then:

- the axe scenes must stay clean;
- every row of the feature checklist (6.7) must be exercised by smoke or scenes.

---

## 8. Top 10 clutter problems (ranked)

1. **Weapon stats are starved.**
   - 8.1 % of the screen at 1440 with 11 of 14 rows visible;
   - **0 % at rest** at 1100, and 4 of 14 rows even with the Stats tab open;
   - two-line rows with a "base X" caption, and the change is only an arrow, never a number.
2. **Everything is always on:** 9 regions, 76 controls and 57 tab stops at rest, for a screen whose usual job is reading one build.
3. **The gallery is permanent:** ~32 % of the screen at 1440, 21+ controls, filters, sort, view toggle, count and hint line, even when no mod is being chosen.
4. **3 competing scroll areas** (stats rail, gallery, results panel), each clipping its own content.
5. **Repetition:** 16 kinds of duplicate (mod names x2, drain x2, polarity x2, rank pips + text, build name, "Not saved yet" x2, weapon, mode, capacity, Import in 2 menus, target x3, "RIFLE" x8…).
6. **Overlays on card art:** 39 overlay elements on 10 slot cards, plus 14 plates on 7 gallery cards that cover information already printed on the art.
7. **Accent noise:** 107 brand-blue elements (pips, capacity, links, radio, tabs, chart, Save), so blue means nothing. Plus green, red, orange, yellow, card gold and 6 damage colours.
8. **Border noise:** 72 bordered elements (205 edges); every stat row, panel and card is outlined.
9. **Flat hierarchy:** 72 % of the text is 12 px or smaller (12 nodes at 10 px), so only the DPS number stands out.
10. **Chrome and helper text:** two stacked bars (title + toolbar = 106 px), a status bar with a legal sentence, and 3 helper sentences at rest. Layout defects: the Target tab is clipped at 1440, the compare drawer truncates names and hides the gallery, and the 1100 card row is cut off.
