# Underframe Desktop: declutter spec ("Loadout | Readout")

Status: **current**. It replaces the window layout of `docs/arsenal-spec.md` (sections 2, 3, 5.1, 8 and parts of 4) and of `docs/ux-spec.md` (sections 2, 3.2, 4.3, 4.9-4.13). Those sections carry a "Superseded" note pointing here. Everything this spec does not mention still holds: the search grammar, drag and drop, the screenshot import, the slot keyboard model, the accessibility rules and the copy rules.

Inputs: the two independent reviews `docs/declutter-flow.md` (task flow and information architecture) and `docs/declutter-calm.md` (visual density and calm), written in answer to this feedback:

> "the screen feels so clutterred, the user is bombarded in every direction and the core stuff that you actually care about like weapon stats get cut away."

## 0. Decision

**Base: the flow review's structure.** That is **Loadout | Readout**, with a lower area that follows the task: the Picker while picking, "Why this DPS" at rest.

**Grafted from the calm review:**
- the visual rules: one type ramp, colour roles, separation by tone instead of borders, and no tinted pills;
- calmer slot cards: drain plate and rank text only;
- the search box that says where a card will go;
- honesty as a line of text;
- the save state shown only when it matters;
- compare with stat rows.

### 0.1 Why

Both reviews agree on the diagnosis and on most of the cure:
- three regions instead of seven to nine;
- one merged 48 px top bar and no status bar;
- weapon stats as a full Base / Modded / Change table next to the DPS;
- a gallery that appears only while you choose a mod;
- Compare, target and simulation settings behind disclosure.

They differ in four places.

| Question | Flow | Calm | Chosen | Why |
| --- | --- | --- | --- | --- |
| What happens to the cards while picking | The slots shrink to a 5x2 strip and the Picker takes the whole lower area (15+ cards) | A tray rises to one row of about 6 cards; the stage slides up | **Flow** | Picking is the second most frequent task. One row of 6 cards means scrolling for almost every search; a grid of 18 to 21 full cards does not. The 5x2 strip keeps every slot visible as a drop target. |
| Where charts, compare, target and notes live | Charts and notes in the lower area at rest; Compare and the target in the Readout | A "Mods \| Analysis" switch swaps the whole bench | **Flow**, with calm's compare stat rows | Calm's switch hides the slots whenever you read the charts, and it adds a mode to learn. Flow keeps every result next to the DPS and uses the space that calm leaves empty under the slots. |
| How a candidate card previews | An "If equipped" column in the stats table | Ghost values inline in the Modded column ("21% → 39%") | **Flow's column** | A separate column never changes the Modded numbers you are comparing against, and it reads as a column, not as a value that flickers. |
| Visual system | Mentioned briefly (no pills, 3 hue families) | Spelled out: type ramp, colour roles, tone over borders, overlay budget | **Calm** | Flow's structure with calm's rules is calmer than either one alone. |

Risk is similar for both, since each moves every component. Flow's two-state model (rest and picking) has one more state than calm's tray. It follows a rule that is easy to say, though: "the cards show while you choose a mod", and every way in (click a slot, Ctrl+1-9, Ctrl+F, typing, a stat row, Best mod) leads to the same place.

## 1. Structure

```
┌─ top bar (48) ──────────────────────────────────────────────────────────────┐
│ ≡  UF  Build name  Unsaved           ↶  ↷   Import ▾   [ Save ]  ⋯    – □ × │
├─ LOADOUT (task: build) ──────────────────────┬─ READOUT (task: read) ────────┤
│ Weapon ▾   [Normal | Incarnon]               │ Average DPS        Time to kill│
│ Capacity ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 54 / 60  ⋯        │ 21,705 ▼2.1%          1.71 s   │
│ [ 1 ][ 2 ][ 3 ][ 4 ] (Arcane)                │ vs Elite Crewman · L145 Change │
│ [ 5 ][ 6 ][ 7 ][ 8 ] [Exilus]                │ ◐ Partially simulated · Details│
│                                              │ Weapon stats  Base Modded Chg  │
│ 🔍 Add or swap mods…                  Ctrl+F │ … all 11 rows, never scrolled  │
│ ┌ lower area: follows the task ───────────┐  │ ▬▬▬ damage by type + legend    │
│ │ rest:    Why this DPS (charts, notes)   │  │ Compare · 2 pinned  Pin  Expand│
│ │ picking: the Picker (card grid)         │  │ pinned rows                    │
│ └─────────────────────────────────────────┘  │ credits · About                │
└──────────────────────────────────────────────┴────────────────────────────────┘
```

| Region | Holds | Never holds |
| --- | --- | --- |
| **Top bar** | Builds (≡), the build name (rename in place), the save state when it matters, Undo, Redo, Import (menu), Save, ⋯ (New, Save a copy, Duplicate, Rename, Delete, Shortcuts, About and credits, Discord) | The app name repeated, a second "Not saved yet" |
| **Loadout** | Notices, the weapon and fire mode, capacity (with Auto build and a menu for Catalyst, Forma reset and clear), Exilus, Arcane, the 8 slots, the search bar, the lower area | Results, help sentences |
| **Readout** | The DPS hero (DPS, delta, TTK), the target line (with Change, which opens the target popover, and Buffs, which opens the External buffs dialog), the honesty line, the **weapon stats table**, damage by type, Compare, the credits | Anything you use to build |

### 1.1 Two states of the Loadout

| State | Entered by | Slots | Lower area | Readout |
| --- | --- | --- | --- | --- |
| **Rest** | Esc, Done, equipping into a *filled* slot, filling the last empty slot, opening a build that has mods | 4-column grid at full size (199x100 at 1440) | **Why this DPS**: segments Health over time · Damage by hit · Notes | Stats: Base / Modded / Change |
| **Picking** | Clicking a slot or pressing Enter on it; Ctrl+1…9 and Ctrl+Shift+9; Ctrl+F; typing in the search bar; a stat row; Shift+Enter or ✦ on a slot (Best mod); a new or empty build | The same 5x2 block, smaller: slots 1-4 then Arcane, slots 5-8 then Exilus; the target slot is ringed | **Picker**: Mods · Arcanes · Best for slot N, the search, Filters, the count, Done; then the card grid (the only scroll region) | Hovering or focusing a card turns the Change column into **If equipped** |

Picker rules:
- **Filling empty slots:** equipping moves the selection on to the next empty slot and stays in Picking. With no slot selected, cards go to the first empty slot. Filling the last empty slot returns to Rest.
- **A full build with no slot chosen** (a stat row, Ctrl+F, typing at rest): the Picker targets the slot whose mod adds the least damage on paper (damage × multishot × fire rate × average crit × faction, without it), rings it in the strip and says so on the target line. Cards preview and equip against it; clicking that slot confirms it, clicking another slot changes it.
- **Swapping** (the target slot was filled), an arcane, or a Best-mod result: equipping returns to Rest, and focus goes to that slot.
- **The tab follows the slot:** the Arcane slot opens Arcanes, a mod slot opens Mods, and ✦ opens "Best for slot N".
- **Hide equipped** is on by default. The equipped build is already in the strip above, so it is not drawn a second time. Non-default filters show as removable tags beside the search.
- **The search box keeps its element across both states** (rest: the bar under the slots; picking: the Picker header), so typing at rest opens the Picker without losing a keystroke.
- **A target line says where a card goes**, on its own line between the bar and the cards, so it is never cut off: "Slot 3 · Madurai · replacing Point Strike" (the search box's `aria-describedby`). The placeholder stays short ("Search mods: name, effect, cc, drain<=6").
- **Card labels are readable.** A card image prints its name and effect too small at gallery size, so the lower part of each card carries them as real text (13 / 12 px). Cards are 104 to 160 px wide and a row fills the grid's width.
- **The details flyout opens only when asked for:** Alt+Enter, the card's ⋯ (shown on hover) or the context menu's Details. Never on hover or focus: hovering only updates the If equipped column. It closes on Esc, a press elsewhere, or (after a short grace) the pointer moving on to another card.
- **Hide equipped explains itself:** when a search matches only hidden equipped cards, the empty state says where they are ("Hellfire is equipped in slot 7") and offers Show equipped.

## 2. Wireframes

### 2.1 1440x900, rest (primary target)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ≡ UF  Braton crit and toxin  Unsaved                          ↶  ↷   Import ▾  [Save]  ⋯ │–□×│ 48
├────────────────── LOADOUT 880 ─────────────────────┬──────────── READOUT 560 (layer tone) ───────┤
│ Braton Prime ▾   [Normal Attack | Incarnon Form]   │ Average DPS                    Time to kill │
│ Capacity ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 54 / 60   ⋯    │ 21,705  ▼ 2.1%                    1.71 s   │
│                                                    │ vs Elite Crewman · L145 · Corpus  Change   ⋯│
│ ┌Serration┐┌Split Ch┐┌Point St┐┌Vital Se┐ ╭arcane╮ │ ◐ Partially simulated: 1 mod · Details     │
│ └─────────┘└────────┘└────────┘└────────┘ 12 stacks │ Weapon stats        Base  Modded   Change  │
│ ┌Infected ┐┌Stormbr.┐┌Hellfire┐┌Cryo R. ┐┌Vile P.┐  │ Damage              35.0  1,006.3   ×28.8  │
│ └─────────┘└────────┘└────────┘└────────┘└────────┘ │ Crit chance          12%     21%    +75%   │
│                                                     │ Crit multiplier     2.0×    3.2×    +60%   │
│                                                     │ Status chance        26%     26%      —    │
│ 🔍 Add or swap mods: select a slot or type   Ctrl+F │ Status duration      6 s     6 s      —    │
│ Why this DPS  [Health over time | Damage by hit | Notes] │ Multishot       1.0     1.9    +90%   │
│ ┌ enemy health step chart, about 830 x 250 ─────┐  │ Fire rate          9.58/s  7.28/s  −24%    │
│ │                                               │  │ Magazine             75      75      —     │
│ │                                               │  │ Reload             2.15 s  1.65 s  −23%    │
│ └───────────────────────────────────────────────┘  │ Punch through       0 m     0 m      —     │
│                                                    │ Faction (Corpus)      —     none      —    │
│                                                    │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ damage by type   │
│                                                    │ ■ Impact 1.8 → 10.9   ■ Puncture 12 → 77    │
│                                                    │ ■ Slash 21 → 51        ■ Toxin 0 → 290       │
│                                                    │ Compare · 2 pinned          Pin   Expand    │
│                                                    │ Baseline            21,705  1.71 s    —    │
│                                                    │ Steel Path on       22,336  4.07 s  +2.9%  │
│                                                    │ Engine and data by Underframe… · About     │
└────────────────────────────────────────────────────┴────────────────────────────────────────────┘
```

### 2.2 1440x900, picking (slot 3)

```
├────────────────── LOADOUT 880 ─────────────────────┬──────────── READOUT 560 ────────────────────┤
│ Braton Prime ▾  [Normal | Incarnon]                │ Average DPS 21,705 ▼2.1%     TTK 1.71 s     │
│ Capacity ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 54 / 60  ⋯          │ vs Elite Crewman · L145 · Corpus  Change   │
│ [ S1 ][ S2 ][▣S3▣][ S4 ](Arcane)  156x78          │ Weapon stats    Base  Modded  If equipped  │
│ [ S5 ][ S6 ][ S7 ][ S8 ][Exilus]                  │ Crit chance      12%    21%       39%  ◀   │
│ Mods  Arcanes  Best │🔍 Search mods for slot 3 … │ Filters │ 98 mods │ Done │ … all rows …        │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  cards about 116 wide,   │ damage by type                             │
│ └──┘└──┘└──┘└──┘└──┘└──┘  6 columns x 3 rows full │ Compare …                                  │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  (the grid is the only   │                                            │
│ └──┘└──┘└──┘└──┘└──┘└──┘   scroll region)          │                                            │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐                           │                                            │
└────────────────────────────────────────────────────┴────────────────────────────────────────────┘
```

### 2.3 1920x1080

- The Loadout is 1320 px wide with the builds pane closed, or 1020 px with it open (≥ 1680 px the pane is inline, and it starts closed).
- The Readout is 600 px.
- Slots are 234x117 at rest and 200x100 in the strip.
- The chart gets about 1270 x 420.
- While picking, the grid shows about 7 columns x 3 rows of 150 px cards.
- The Readout holds the hero, all 11 rows, the type legend in 2 columns and about 8 pinned rows before it would scroll.

### 2.4 1100x700 (minimum window)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ≡ UF Braton crit…  Unsaved               ↶ ↷  Import ▾ [Save] ⋯     – □ × │ 48
├──────────── LOADOUT 640 ─────────────┬───────── READOUT 460 ─────────────────┤
│ Braton Prime ▾  [Normal|Incarnon]    │ Average DPS 21,705 ▼2.1%   TTK 1.71 s│
│ Capacity ▬▬▬▬▬▬▬▬▬▬▬▬▬ 54/60 ⋯       │ vs Elite Crewman · L145 Change   ⋯     │
│ [S1 ][S2 ][S3 ][S4 ](Arc)   112x56   │ ◐ Partially simulated · Details      │
│ [S5 ][S6 ][S7 ][S8 ][Exi]            │ Weapon stats   Base  Modded  Change  │
│                                      │ … all 11 rows at 24 px, no scroll …  │
│ 🔍 Add or swap mods…          Ctrl+F │ ▬▬▬ damage by type, legend 2 columns │
│ Why this DPS [Health|Hits|Notes]     │ Compare · 2 pinned     Pin  Expand   │
│ ┌ chart 600 x 170 ───────────────┐   │ (pinned rows; more scroll below)     │
│ └────────────────────────────────┘   │ credits · About                      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

While picking at 1100x700, the strip is 112x56 slots, and the grid shows 4 columns x 2 rows of about 132 px cards, all 8 full.

Rows here are 24 px high with 13 to 14 px text, and the DPS is 32 px. **Every stat row is visible at rest with no action.** That is better than the brief, which allowed "one action".

### 2.5 Stacked (< 1100 CSS px, only reached by zooming in)

One scroll area, in this order:
1. a sticky DPS bar (DPS, delta, TTK, "Details", which scrolls to the Readout);
2. the **Readout** (hero, stats, Compare, credits);
3. the **Loadout** (weapon, capacity, slots in 2 columns under 600 px, the search bar);
4. the lower area (Why this DPS, or the Picker, whose grid then scrolls with the page).

## 3. Calm rules (from the calm review, applied)

- **Type ramp:** 40 (DPS at ≥ 1400 px; 32 below) / 20 (TTK) / 16 (weapon, build name) / 14 (body, table) / 12 (meta only). Nothing renders below 12 px. Weights are 400 and 600.
- **Colour roles:**
  - brand blue only for Save (when there is something to save), focus, selection, the active tab or segment, and the If equipped values;
  - green and red only for signed changes (Change column, DPS delta, compare delta, mismatch drain);
  - damage-type colours only in the type bar, its legend and the charts.
  - Honesty and capacity bars are neutral, and red only when over capacity.
- **Tone, not borders:**
  - the Readout sits on `--uf-layer`;
  - the Loadout sits on the window background;
  - the only hairlines are under the stats table header and above the Compare section;
  - stat rows, the result and the Picker have no outlines or cards.
- **No tinted pills at rest:**
  - the DPS delta is coloured text with ▲/▼;
  - "Partially simulated" is a neutral line with an icon;
  - arcane stacks are plain text under the dome (with the rank only below max); they open the stacks popover.
  - Picker cards: a matching polarity's drain hint is neutral too.
- **Overlay budget per slot card:** a drain plate (number and polarity; neutral with a ↓ when the polarity matches, red with a dashed outline and ↑ only on a mismatch), the rank as shadowed text only below max ("3/5"; a maxed mod shows none), and, only when needed, a neutral honesty glyph.
  - The Picker's target slot shows just its ring and name (no action strip over the name it replaces); the arcane's stacks are hidden in the strip.
  - No separate slot polarity glyph on a filled slot.
  - No rarity frame over card art (text cards keep a rarity band).
  - No pips at rest; the hover/focus strip still has − n/max + ✦ ×.
- **No help sentences at rest.** The selection hint, the gallery hint and the "Sheet values before armor" footnote go away. Their information moves to the search placeholder, the slot ring, the table caption tooltip and the live region.

## 4. Readout details

- **Hero:**
  - Average DPS (40 or 32 px, tabular) with the delta as coloured text, "vs previous run" in the tooltip;
  - Time to kill at the right in 20 px;
  - a thin progress bar while updating;
  - an error MessageBar with "Try again" when the simulation fails.
- **Target line:** "vs Elite Crewman · L145 · Corpus", then:
  - **Change**, which opens the target popover (the full target form: enemy, level, faction, Steel Path, headshots, custom pools, enemy stats; also Ctrl+T);
  - **Buffs**, which opens the **External buffs** dialog (docs/port-external-buffs.md). While a build has external buffs or target statuses, the same link is their summary, "Buffs: 5 · Statuses: 2", so the Readout gains no line and the control count at rest does not change. The dialog (a Fluent Dialog, 880 px; content scrolls inside it and is the only scroller) opens with focus in the buff search and holds: **Presets**, one row (the Buff preset dropdown: None, the presets by name, and a disabled Custom while the list matches none; a ⋯ menu with Save preset…, disabled with "Add a buff first" while the list is empty, which opens a popover with the name and asks before it replaces a preset of the same name, and Delete preset…, which asks first; applying a preset to a build that already has buffs asks Cancel / Overwrite Current Buffs / Add to Current Buffs); then two columns from about 680 px of content (one below): on the left, kept in view, **Add a buff** (one searchable combobox grouping the buff types and the sources: Warframe abilities, Helminth abilities, Warframe passives, Warframe arcanes, Archon shards, Mods and sets; then only the inputs that type or source needs: value in %, "Multiplier (500% = ×5)" for Sonar, element, heat and faction %, or ability strength / duration, augment switches and rank, shard and mod options, with a line saying what the source adds, and a neutral "This lowers damage" line for a multiplier under ×1) and **Add a target status** (status, stacks ×1-×10 as a dropdown, Add status); on the right **Active buffs** (one readable line per row, "External Fire Rate · +60%", "Resupply · 60% Electricity", "Sonar · ×5", "Roar · +30% · from Roar (Helminth)", each with a remove button; removing one keeps focus in the list; rows this app does not simulate say "not simulated") and **Target statuses** ("Viral ×10" rows; "No external statuses configured." when empty). The title's ⓘ explains what external buffs are. Footer: a live line "Average DPS 20,858 → 478,263 ▲ 2,193%" (the dialog covers the hero), Remove all (then "Removed 5 buffs and 2 statuses. Undo" in the list column) and Close. Ctrl+Z and Ctrl+Y reach the build while it is open, outside text fields. While buffs or statuses are set, the hero caption reads "Average DPS · with external buffs" ("· with target statuses", "· with external buffs and statuses") and the summary link's accessible name starts with its text. Every edit is one undo step and re-simulates at once, so DPS, the delta and the stats table's Modded and Change columns move with it (the Base column stays the weapon's own);
  - **⋯**, a menu with Run again (Ctrl+Enter), **Run details and what's simulated** (a dialog with the range, runs × time, average hit, first hit and what the engine covers) and Simulated time 10 / 30 / 60 s.
- **Honesty line** (only when it applies): "◐ Partially simulated: N mods · Details". The popover lists each mod or arcane and what it leaves out. Engine-only mods are listed there too, and so are external buffs the app keeps but does not simulate (melee, exalted, area-of-effect and Hall of Mirrors buffs, Resupply on an Incarnon form). The slot keeps a small neutral glyph that opens the same kind of popover.
- **Weapon stats table** (`role="grid"`, one tab stop, Up/Down between rows, Enter opens the Picker with that stat's search word). 24 px rows under 800 px of window height, 28 px up to 880, then 32 px rows with 16 px text, so the stats grow with the window (the health chart is capped at 300 px and the slots grow to 280 px):
  - Columns: Stat, Base, Modded, Change (or **If equipped** while a card is hovered or focused in the Picker).
  - Rows: Damage (per projectile), Crit chance, Crit multiplier, Status chance, Status duration, Multishot, Fire rate, Magazine, Reload, Punch through, Faction (vs the target's faction).
  - The Base column comes from the weapon with no mods, no arcanes and no external buffs; Modded includes all three.
  - Change is a signed percentage, or "×N" from 3× up. It is green or red by whether higher or lower is better (Reload −23 % is green), and the sign is always shown.
- **Damage by type:**
  - one stacked bar;
  - a legend in two columns, "Impact 1.8 → 10.9";
  - each legend item opens the Picker searching that element.
- **Compare:**
  - "Compare · N pinned", then **Pin** (Ctrl+P) and **Expand** (Ctrl+J);
  - one row per pin: label (the baseline is marked, else the change list), DPS, TTK and the change against the baseline, plus a ⋯ with Use as baseline and Remove (Del on the row); 1 row under 800 px of height (the header's count and Expand cover the rest, so the credit line stays on screen), 3 up to 1000 px, 6 above;
  - pinning raises no toast (the new row is the feedback; the live region says it), and the same unchanged result is pinned once ("Already pinned");
  - Expand opens a dialog with the full table: Changes, Weapon, Mode, Target, DPS, vs baseline, TTK, crit, status, fire rate, multishot. The stat columns are what calm grafted on.
- **Credits:** the last line, always visible: "Damage engine and game data by Underframe (underframe.site), used with permission. Not affiliated with Digital Extremes. · About".

### 4.1 Auto build

- **Entry:** one quiet subtle button, "Auto build" with a wand icon, on the Loadout's capacity line before the capacity ⋯ menu (also Ctrl+Shift+A). It is the only control the feature adds at rest (34 controls at rest against the cap of 40). With the dialog closed, the same button is the summary: "Auto build · 45%" while a run goes on, "Auto build · result" when a result waits.
- **Dialog** (a Fluent Dialog, 760 px; content scrolls inside it and is the only scroller; it opens with focus on Run): Config dropdown and Manage menu (Default is read-only, with a Duplicate button; "Your Config" starts with Cost Control on); tabs **Run** (what it does, a settings summary, **Keep (8 of 9)** with Keep all / Replace all: the filled slots and arcane as toggle chips with card art and a check, "Replace" on unticked ones, all kept by default; with everything kept, Run is disabled and says to untick mods), **Search** (sim time, sample size, time limit as plain number inputs; engines, refinement, luck averaged, single shot, floor, cost control with maximum Forma, score by), **Elements** (element candidates, the specific targets, the elemental blacklist: one chip list each with one Add box), **Mods** (the mod blacklist with the smart mod search and card chips: the entries that fit this weapon, three rows at a time, "Show N for other weapon types", "Show all N", one tab stop with arrow keys and Delete; Reset to defaults; the whitelist; the 16-stat blacklist). Footer: Close and Run; Cancel while running (focused); Discard and Apply with a result (Apply focused), or one Close when nothing changed.
- **Running:** the step, a progress bar, "N simulations · 12 s of at most 5 min" and the latest detail line; the UI stays responsive and the dialog may be closed.
- **Result** (the config row and tabs are hidden under it): "Average DPS 505 → 80,583 ▲ ×159.6" at the build's own simulation settings (what the Readout then shows); a warning above the changes when it is over capacity (Cost Control off), or the Forma it needs ("5 Forma to fit 58 of 60 capacity: Slot 2 → Vazarin (D), …"); the changes as old card → new card ("Slot 3 · replaces Point Strike"); and honesty lines (stopped at the time limit, Galvanized mods scored without stacks, partially simulated mods). **Apply** ("Apply (29 over capacity)" when it does not fit) writes the mods, the arcane and the Forma as one undo step, with an Undo toast. A run that finishes with the dialog closed raises a toast with Review; a result dropped because the build changed says so on the Run tab.
- Calm rules hold: no colour but the signed change and the primary button, nothing under 12 px, no pills; the toggles show a check, not a tint.

## 5. Where every required feature lives

| Feature (MUST keep working) | New home |
| --- | --- |
| Build library and featured builds | ≡ in the top bar or Ctrl+B. It is an overlay below 1680 px, and inline (starting closed) from 1680 px |
| Save, rename, duplicate, delete, undo | Top bar: Save (Ctrl+S), the name (F2), ↶ ↷ (Ctrl+Z / Ctrl+Y); ⋯: New, Save a copy (Ctrl+Shift+S), Duplicate, Rename, Delete (with an Undo toast) |
| Weapon picker, fire modes | Loadout header: the weapon combobox and a segmented radio toolbar (a dropdown above 3 modes; plain text with 1 mode) |
| 8 mod slots, Exilus, Arcane, ranks, stacks, drag and drop, keyboard | Loadout grid (rest) or strip (picking). The hover/focus strip has − n/max + ✦ ×. The arcane stacks text opens the stacks popover. Drag goes from cards to slots and slot to slot; dragging a slot onto the lower area removes it. Pick-up mode and every slot key are unchanged |
| Card gallery, smart search, filters | The Picker: tabs, search (same grammar, tags, Did you mean), and the Filters popover (Effect, Polarity, Rarity, Fits weapon, Hide equipped, Sort, Card size, Text cards) |
| Best-mod search | ✦ on a slot, Shift+Enter, the slot menu, or the card menu. The Picker opens on "Best for slot N" with gains on the cards |
| Capacity, Catalyst, Forma | Capacity line (meter and number); its ⋯ menu has Orokin Catalyst, Reset slot polarities (N Forma) and Remove all mods; slot menu › Polarity |
| Auto build (optimizer, configs, mod blacklist and whitelist, elemental and stat blacklists) | The capacity line's quiet **Auto build** button (wand) or Ctrl+Shift+A opens the Auto build dialog; see 4.1 and docs/port-auto-build.md 12. Configs are stored by the main process in `auto-build.json` in userData |
| Target presets, level, Steel Path, custom pools | Readout › Change (or Ctrl+T) opens the target popover |
| Weapon stats | Readout stats table (first-class, never cut off) |
| DPS result, TTK, charts, damage breakdown | Readout hero; lower area › Why this DPS (Health over time, Damage by hit, with Show as table); damage by type in the Readout |
| Compare pins | Readout › Compare (Pin, rows, Expand dialog); Ctrl+P, Ctrl+J. Pins record external buffs and statuses, and the change list names them ("+External Fire Rate · +60%", "−Viral ×10") |
| External buffs, external statuses, buff presets | Readout › target line › Buffs (the summary while some are set) opens the External buffs dialog; see 4. Presets are one library per user, stored by the main process in `buff-presets.json` in userData |
| OCR import (toolbar, Ctrl+V, drop, game window, review) | Top bar › Import ▾ (Choose file Ctrl+I, Paste Ctrl+V, Game window Ctrl+Shift+G); dropping on the window; the review dialog (unchanged) |
| Honesty badges | Readout honesty line and its popover; neutral glyph on the slot; ⚠/ⓘ glyphs on Picker cards; About |
| Shortcuts | All kept. New: Esc closes the Picker; Ctrl+T opens the target; Ctrl+J now opens the Compare dialog. Ctrl+/ lists them |
| Accessibility (WCAG 2.2 AA, keyboard) | See 6 |
| Credits | Readout footer (always visible) and About |
| Smoke and scene modes | `src/renderer/smoke.js` and `scenes.js` updated (see 8) |
| Notes | Lower area › Why this DPS › Notes |
| Data version, app version, Discord, newer data | About; ⋯ › Discord; the "newer data" notice in the Loadout |

## 6. Accessibility

- **Landmarks and F6 order:** builds › top bar (`banner`) › Loadout › lower area (the Picker or Why this DPS) › Readout. Each has `data-pane`.
- **Opening the Picker:** it opens only on activation (click, Enter, a shortcut, or typing), never on focus alone (SC 3.2.1). Focus goes to the search. A polite live region announces "N mods" once the results settle.
- **Closing the Picker:** Esc or Done closes it and focus returns to what opened it: the slot, or the stat row or damage type (also when the Picker had chosen the slot itself); equipping into a filled slot closes it and focus goes to that slot.
- **Slots and Tab:** the slot group is one tab stop. Only a slot button moves it (a control inside a slot, like the arcane's stacks, is its own stop), and a slot chosen without focus (Ctrl+1-9, an automatic target) becomes the stop.
- **Pick-up:** Space on any filled slot picks its card up (Enter still opens the Picker for it); arrows move it, Space or Enter drops it.
- **The weapon field:** with nothing typed in it, Ctrl+Z and Ctrl+Y undo and redo the build, not the field's text.
- **The health chart** is out of the tab order (its library makes the line paths focusable); "Show as table" gives the data to the keyboard.
- **Stats table:**
  - `role="grid"` with column headers;
  - each row's first cell is a `rowheader` and the only tab stop;
  - Up/Down/Home/End move between rows, Enter opens the Picker;
  - the description says "Find mods that raise …".
  - Change cells carry a sign. Colour is never the only cue.
- **If equipped preview:** keyboard focus on a card announces the top changes politely ("If equipped: crit chance 21% to 39%"), debounced. Hover only updates the column.
- **Segments and tabs:** the fire mode is a radio toolbar (one tab stop); Why this DPS and the Picker tabs are `TabList`s.
- **Target sizes:** at least 24x24 everywhere (smoke checks it). Strip slots are 112x56 at the smallest.
- **Contrast:** meta text is `colorNeutralForeground3` at 12 px or larger on both surfaces (≥ 4.5:1 in both themes). Forced colours: the honesty glyph, drain plates and bars keep their existing forced-colour rules.
- **Reduced motion:** the switch between rest and picking is instant.

## 7. Target metrics

"Before" numbers are the reviewers' (flow's script, or calm's where noted). "After" numbers were measured with the same scripts on this implementation, on the same full build at rest. They are filled in in section 9 after the build.

| Metric | Before 1440 | Before 1100 | Target |
| --- | --- | --- | --- |
| Regions on screen | 7 | 6 | 3 |
| Interactive controls at rest (outermost, flow's script) | 68 | 54 | ≤ 34 |
| Tab stops before the first slot | 29 | 14 | ≤ 10 |
| Boxed chips and overlays | 31 | 37 | ≤ 12 at rest (cards' drain plates and rank text count) |
| Tinted pills | 3 | 3 | 0 |
| Bordered elements | 32 | 22 | ≤ 14 |
| Accent hue families | 5 | 5 | ≤ 3 |
| Scroll regions at rest / picking | 3 / 3 | 2 / 2 | 0 / 1 (1100: ≤ 1 / ≤ 2) |
| Weapon stats share of the viewport | 9.7 % | 0 % | ≥ 16 % / ≥ 18 % |
| Stat lines fully visible without scrolling | 11 / 14 | 0 / 14 | all (11 rows + type legend), both sizes |
| DPS-to-stats distance | ~1,120 px across | not together | same column |
| Chrome height | 132 px | 132 px | 48 px |
| Gallery share at rest | 23.8 % | 19.5 % | 0 % |
| Full cards visible while picking | 7 | 0 | ≥ 15 / ≥ 8 |
| Text under 12 px (calm's script) | 12 | 2 | 0 |
| Helper sentences at rest | 3 | 2 | 0 |

## 8. Smoke and scenes

- **Smoke** (`UF_SMOKE=1`) keeps every real-click check, now through the Picker (click a slot, then click a card). It adds these checks:
  - every weapon stat row and damage type is fully on screen and not clipped by its scroll container (at the window size);
  - at 1440x900, the stats table, hero and slots are on screen together;
  - controls visible at rest are capped (≤ 40 at 1440x900, outermost interactive elements);
  - tab stops before the first slot are ≤ 10;
  - no gallery cards at rest; the Picker opens on a slot click and closes on Esc with focus back on the slot;
  - no tinted badge at rest;
  - nothing under 12 px font at rest;
  - pointer targets are ≥ 24 px;
  - the signed changes (Change cells, the DPS delta) are 4.5:1 or better against what is behind them;
  - real Tab presses (OS-level input) from the build name reach a slot, also after the arcane's stacks had focus;
  - Space, ArrowRight, Space on a slot swaps two slots; Esc after a stat row returns focus to it; a second Pin of the same result adds nothing and no pin toast shows;
  - External buffs with real clicks: Buffs opens the dialog, search and pick External Fire Rate, type 60, Add buff: the line reads "External Fire Rate · +60%" and the DPS rises; remove it: the DPS is back to the same number; undo and redo; Add status (Viral ×10): the DPS rises; Close returns focus to the link, which now reads "Statuses: 1" and reopens the dialog.
  - External buffs, added checks: focus starts in the buff search; the footer shows the DPS change; a keyboard removal keeps focus in the dialog; real Ctrl+Z and Ctrl+Y while the dialog is open; Remove all, then its Undo; the hero caption and the summary link's accessible name.
  - Auto build with real clicks, on an empty Braton Prime: the Auto build button opens the dialog with focus on Run and "Your Config" (Cost Control on); the blacklist shows at most 3 rows, arrow keys move between chips and Tab leaves them; Mods › search "serration" › click the Serration card adds it to the blacklist (its chip shows the card image, focus stays in the search, the search marks it as listed); Delete on a chip moves focus to the next chip; Run with a short budget: focus on Cancel, then on Apply; all 8 slots filled, no Serration, card images shown, within capacity with its Forma listed, the settings hidden, the "before" DPS equals the Readout's; Apply: the build is within capacity, the Readout's DPS equals the result's "after" and the toast shows; on the complete build Run is disabled; a real Ctrl+Z restores the empty build (mods and polarities) and its DPS; a long run (the Default config) is cancelled mid-way, nothing changes and focus returns to Run; Close returns focus to the button.
  - In every open dialog the smoke checks (once its open animation has settled): no pointer target under 24x24, and at most one scroll region.
- **Captures** in smoke and scene modes are of the page (`webContents.capturePage`), with the solid backdrop and Chromium told not to throttle a covered window, so another window on top is never recorded and nothing stalls; `UF_CAPTURE_SCREEN=1` grabs the screen instead (Mica and the caption buttons). Every scene names the state it must show and fails the run when it never does.
- **Scenes** (`UF_SCENES`) cover:
  - rest (empty and full);
  - picking (a selected slot, a stat row's automatic target, search tags, Did you mean, blocked cards, the flyout, hidden equipped cards, the Arcanes tab, Best mod running and done, the If equipped preview);
  - the target popover, Run details, the Compare section and dialog, Why this DPS (Health, Hits, Notes);
  - the capacity menu, over capacity, text cards, forced colours, the library, delete with undo, shortcuts, the simulation error, OCR;
  - the stacked layout at 1920x1080 / 200 %;
  - External buffs (35-35g): the Buffs link at rest, the dialog empty, with the underframe.site screenshot's list, the presets menu, the statuses, a source (Roar at 250 % strength, 1440x900 only) and the Readout's summary.
  - External buffs, added: Sonar's multiplier warning (35h) and Remove all with its Undo (35i).
  - Auto build (36-36n, not at 1920): the button at rest, the Run tab with Keep, Search, Elements, the blacklist search and the blacklist for this weapon (all of it in 36f2, 1440x900 only), the read-only Default (1440x900 only), nothing to fill (36k), Replace all (36l), a run in progress, a result with its Forma, the applied build with its Undo toast, and (1440x900 only) a result over capacity (36m) and the toast of a run finished in the background (36n).

## 9. Measured results (2026-10-24)

The reviewers' own scripts (`scratchpad/declutter-flow/measure.js`, `scratchpad/declutter-calm/measure.js`) and `scratchpad/declutter-measure/extra.js` were run over CDP. They measured a saved full build at rest: 8 mods, Exilus, arcane and Forma, 55/60, dark theme. They ran on two isolated instances with their own profiles. "Before" figures are the reviewers' numbers.

| Metric | Before 1440 | After 1440 | Before 1100 | After 1100 | Target |
| --- | --- | --- | --- | --- | --- |
| Regions on screen (`data-pane`) | 7 (flow) / 9 (calm) | **3** (top bar, Loadout with lower area, Readout) | 6 / 8 | **3** | 3 |
| Interactive controls at rest (flow script) | 68 | **35** (33 without the chart's 2 focusable SVG legend paths) | 54 | **35** | ≤ 34 |
| Interactive controls at rest (calm script) | 76 | **37** | 53 | **37** | ≤ 35 |
| Tab stops before the first slot | 29 | **8** | 14 | **9** | ≤ 10 |
| Tab stops at rest, total (calm) | 57 | **27** | 40 | **27** | ≤ 25 |
| Boxed chips and overlays (flow) | 31 | **11** | 37 | **11** | ≤ 12 |
| Tinted pills / coloured badges | 3 / 3-4 | **0** (flow lists the arcane's neutral "5/5" plate) | 3 / 2 | **0** | 0 |
| Bordered elements (flow / calm) | 32 / 72 | **3 / 3** | 22 / 54 | **3 / 3** | ≤ 14 / ≤ 20 |
| Blue elements (flow 210° bucket) | 114 | **7** | 64 | **7** | ≤ 12 |
| Scroll regions at rest / picking | 3 / 3 | **0 / 1** (the card grid) | 2 / 2 | **0 / 1** | 0 / 1 |
| Weapon stats share of the viewport (the sheet) | 9.7 % (flow) / 8.1 % (calm) | **17.2 %** | 0 % | **20.8 %** | ≥ 16 % / ≥ 18 % |
| Stat lines fully visible, no scroll | 11 / 14 | **11 / 11 rows + 5 / 5 damage types** | 0 / 14 | **11 / 11 + 5 / 5** | all |
| DPS-to-stats distance | ~1,120 px across | **same column, 0 px across, 62 px down** | not together | **0 px across, 58 px down** | same column |
| Chrome height | 132 px | **48 px** | 132 px | **48 px** | 48 px |
| Gallery cards at rest | 7 (23.8 %) | **0** | 6 cut off (19.5 %) | **0** | 0 |
| Full cards visible while picking | 7 | **18** | 0 | **8** | ≥ 15 / ≥ 8 |
| Text under 12 px | 12 | **0** | 2 | **0** | 0 |
| Text nodes / distinct strings (calm) | 215 / 155 | **168 / 120** | 137 / 91 | 159 / 111 | ≤ 110 / ≤ 95 |
| Helper sentences at rest | 3 | **0** | 2 | **0** | 0 |

Missed or partly met:
- **Controls:** 35 against ≤ 34; 33 without the chart legend paths.
- **Calm's text-node target:** 168 against ≤ 110. The stats table is now complete, with 3 values per row, so it holds more numbers. Calm's own mockup also had fewer stat rows.
- **Accent hue buckets:** still 5 (green, red, blue, orange, gold). Green and red are the signed changes and the drain plates. Orange and gold come from the damage-type swatches and the arcane art. Blue fell from 114 to 7.

Smoke (`src/renderer/smoke.js`, `checkRest`) checks the following on every run:
- every stat row and damage type is unclipped;
- the controls cap (40) and the tab stops before the first slot (≤ 10);
- no gallery cards, tinted badges, small text or scroll regions at rest;
- 15 or more full cards while picking at 1440x900.

## 10. Review fixes (2026-10-24)

The two reviewers verified this redesign on the real app and found the rest state calm but some flows broken. What changed:

| Finding | Change |
| --- | --- |
| The details flyout opened on hover or focus over the next cards and trapped the pointer | Opens only on Alt+Enter, the card's ⋯ or Details; closes on Esc, a press elsewhere or the next card |
| Card text was illegible art | Each card's name and max-rank effect are real text over the lower part of the art |
| A stat row on a full build dead-ended ("All slots are full") | The Picker targets the weakest mod's slot on paper and says so on the target line |
| The "where it goes" sentence was cut off at 1100 px | It is its own line above the cards; the placeholder is short |
| Tab never reached the slots after the arcane's stacks had focus; Space pick-up was unreachable | Only slot buttons move the slot tab stop; Space picks up any filled slot |
| Red changes were 4.28:1 in dark | `colorPaletteRedForeground1` (5.3:1 dark, 5.5:1 light); smoke checks it |
| Green matched drain plates kept five hue families on screen | Matched plates and card hints are neutral; colour only for a mismatch |
| Rank plates, the arcane chip | Rank as shadowed text only below max; stacks as text under the dome |
| The chart took the most room on large windows | Chart capped at 300 px, slots up to 280 px, 16 px stat rows from 880 px of height |
| Pins: duplicate rows, toasts over Compare, the credit line off screen at 1100x700 | One pin per unchanged result, no pin toast, 1 Compare row on short windows |
| Toasts stacked over the Readout | Bottom left over the Loadout; a plain confirmation replaces the last |
| Esc after a stat row lost the row; the boot build opened at rest; weapon Ctrl+Z undid the field | Focus returns to the opener; an empty boot build opens picking; Ctrl+Z undoes the build |
| Best mod showed a second DPS number | Gains only; the 3-run baseline is in the tooltip |
| Chart lines were tab stops; the stacked layout showed the DPS twice | Chart out of the tab order; the sticky bar shows only once the hero scrolls away |
| The import review showed a pill, raw text and a stepper on every row | Rows read clearly collapse to name and rank; "Review all" expands them |
| Scene captures recorded other windows and stalled when covered | Page capture, no background throttling, and a state check per scene |

Measured after the fixes (saved full build at rest, dark, the reviewers' scripts; 1440 / 1100 / 1920): controls 33 / 33 / 33 (flow) and 35 / 35 / 35 (calm); tab stops 25 at every size, 8 before the first slot (real Tab, too); text nodes 147 / 138 / 147 (calm); caption share 35 % / 47 % / 35 %; bordered elements 3; tinted pills 0; scroll regions at rest 0; weapon stats 19.1 % / 20.8 % / 12.9 % of the window with all 11 rows and 5 damage types visible; contrast fails 0 of 100 text nodes in dark. While picking: 21 / 10 / 24 full cards. At 1100x700 with 2 pins the Readout does not scroll and the credit line ends at 690 px. Still over calm's targets: text nodes (≤ 110) and accent families (5: green and red are the signed changes, the rest are damage-type and chart colours).

## 11. Review fixes, round 2 (2026-10-24): External buffs and Auto build

The UX review of the two features found the rest state still calm (35/37 controls by the reviewers' scripts, no small text, no badges, no scroll regions at rest) and the features themselves short in five ways. The fixes keep both behind their one quiet entry and change nothing at rest except a caption: while external buffs or statuses are set, the hero caption reads "Average DPS · with external buffs". Details: docs/port-external-buffs.md 12, docs/port-auto-build.md 12.7.

- **External buffs:** a live DPS line in the footer (the dialog covers the hero); Ctrl+Z / Ctrl+Y while it is open; Remove all with an inline Undo; Sonar and the other multiplicative buffs read "×5" / "×1.5" with a labelled field and a neutral warning under ×1; plain names for the site's internal ones; two columns (add on the left, kept in view; active on the right), presets in one row with a ⋯ menu, the intro as a tooltip; focus starts in the search and stays in the list after a removal; Save preset disabled with a reason; stacks as a dropdown (no 24x16 arrows).
- **Auto build:** "Your Config" starts with Cost Control on and Apply writes the Forma it needs (one undo step), with a warning and "Apply (N over capacity)" when it still does not fit; nothing to fill disables Run and never claims "found nothing better"; focus follows the run (Run → Cancel → Apply, back to Run after Cancel); the blacklist lists this weapon's entries three rows at a time as one tab stop, with text-card thumbs; the content is the only scroller; Keep chips show a check and "Replace"; a toast when a background run finishes; the result alone under a result, as old → new cards.
- **Measured with the smoke** at 1440x900 (dark, dev and packaged): 34 controls at rest, 9 tab stops before the first slot, 11/11 stat rows, no small text, badges or scroll regions at rest; in the open dialogs no pointer target under 24 px and no nested scroll region.
