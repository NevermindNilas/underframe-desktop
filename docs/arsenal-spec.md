# Underframe Desktop: arsenal layout, card gallery and screenshot import spec

> **Partly superseded (2026-10-24).** The window layout and the results presentation are replaced by [declutter-spec.md](declutter-spec.md) (Loadout | Readout, the Picker on demand, one 48 px top bar, no status bar). Sections marked "Superseded" below no longer describe the app; the rest still applies.

Status: binding spec for the arsenal redesign of `src/renderer`. It **extends** [ux-spec.md](ux-spec.md). Everything there still applies (shell, 48 px title bar, Mica and solid fallback, theme, type ramp, tokens, toasts, undo, honesty indicators, copy rules, WCAG 2.2 AA) unless this document replaces it. Where they conflict, this document wins. Reviewers check the build against section 11.

Replaced parts of ux-spec.md: 2.1-2.2 (regions and sizes), 4.5 (mod slots), 4.7 (mod picker; the modal `Dialog` is removed), the Best mod tab of 4.10 (it moves into the gallery), and the slot shortcuts in 5.5.

Why: the user asked for (1) OCR that recognises builds from screenshots, (2) the Warframe arsenal layout, (3) arcanes, and (4) mod slots and a mod chooser built from labelled card images, not text lists. Their reference was our current picker: a modal text list with a detail pane (scene `03-picker-search.png`). This spec replaces that picker with an always-present image gallery that has smart search.

## 0. Decisions at a glance

| Topic | Decision |
| --- | --- |
| Layout | The arsenal's Upgrade screen, mapped onto Fluent 2. **Stats rail** on the left. **Stage** in the centre: weapon header, capacity, a special row (Exilus + Arcane), and the 2x4 mod grid. A **gallery** across the bottom under the stats rail and the stage. The **results rail** on the right: the result card (always visible), then the tabs Charts, Target, Notes. |
| Library pane | Inline only at >= 1680 px. Below that it is an overlay, closed by default; the stage needs the width. |
| Slot cards | The compact card image (`core/images/mods/compact`, 2:1), with overlays drawn by us: drain + polarity plate (match green, mismatch red, each with a non-colour cue), rank pips, a 2 px rarity frame, and hover/focus actions (rank -/+, find best, remove). |
| Arcane slot | One weapon arcane slot for primaries and secondaries (the Primary or Secondary Arcane Adapter is assumed fitted); kitguns have a second one for Pax and Residual arcanes, as on underframe.site. The slot is shaped like an arcane: a dome in the art's proportions (an empty slot is a dashed dome), with focus and selection rings following the arch. It shows the arcane image, rank pips (0-5) in a pill under the dome, its name in the caption above ("Arcane · Merciless") and the uptime assumption (stacks, on/off, or for a capped bonus such as Primary Overcharge the bonus itself: "+350% Multishot"). |
| Capacity | `drain total / capacity` in the stage header. Capacity is 60: weapon rank 30 with an Orokin Catalyst, toggleable to 30. Slot polarities **are** modelled, because they are cheap: innate polarities come from `data.polarities`, and a per-slot Forma override is available. Going over capacity warns but does not block. |
| Mod chooser | No modal. An always-present **gallery** with the tabs Mods, Arcanes and Best mod. It is a virtualised grid of **full card images**, lazy-loaded, with a text-card fallback. |
| Search | One `SearchBox` with a parsed grammar: fuzzy free text, synonyms, operators (`drain<=6`, `pol:v`, `rarity:rare`, `is:equipped`, `-word`), filter chips, sort, "Did you mean", and a result count announced to screen readers. A pure, unit-tested parser lives in `src/shared/search.js`. |
| Equip | Click, Enter or drop. A card goes into the **selected slot**, else the first empty slot. Drag and drop works gallery to slot, slot to slot (swap), and slot out (remove), and each has a keyboard equivalent (pick-up mode). |
| OCR | Runs locally: Windows.Media.Ocr (en-US) for the text, plus image similarity against `core/images` for the card faces and the arcane icon. Entry points: a toolbar button, Ctrl+V of an image, dropping an image file on the window, and "Read from game window" (Electron `desktopCapturer`). A review dialog shows the recognised regions and items with confidence, one-click replace, and the choice to apply as a new build or into the current one. |
| Assets | Images live only in the private `core/` submodule (`core/images/**`, index `core/images/index.json`) and are served at `app://local/core/images/...`. The public repo carries no images. Without `core/images`, every card uses the text fallback. |
| Not done | A/B/C configs (a build already plays that role), warframe arcanes that buff weapons, rivens, and reading ranks from screenshots (the rank is assumed max and flagged as such). |

## 1. The arsenal, as researched (2025-2026)

These are the facts the layout copies. Sources are listed in section 12.

- **Upgrade screen arrangement** (Warframe Wiki, Arsenal page):
  - The item name and rank sit top-left, with details such as Forma count.
  - The **Capacity** gauge sits top-left.
  - The **Stats Summary** runs down the left side. Clicking a stat that has a pip searches the inventory for related mods.
  - The search bar sits directly under the stats.
  - The **Config tabs** (A/B/C, purchasable up to six) sit top-middle.
  - The mod slots are in the centre.
  - The **Arcane slots** are on the right.
  - **Mod Selection** runs across the bottom and shows only compatible mods.
  - Actions (Tips, Actions, Mods, Remove All, Back) sit bottom-right.
  - Update 37.0 (2024-10-02) reskinned the Arsenal with larger grids that use the extra screen space. Update 36.0 added a polarity indicator for slots that hold a mismatched mod.
- **Slots**:
  - Weapons have 9 mod slots: 8 general slots in a 2x4 grid, plus an Exilus slot that needs an Exilus Weapon Adapter and appears "at the top or to the right depending on the item".
  - Primaries and secondaries each have **one** arcane slot, unlocked by the Primary or Secondary Arcane Adapter (Update 30.5). (Kitguns are hidden for now: they have no real stats in the data yet. The rest of this point describes the planned behaviour.) Kitguns have a **second** slot that takes only Pax and Residual (kitgun) arcanes; it is shown after the Arcane slot as "Kitgun arcane".
  - Primary and secondary arcanes rank 0-5.
- **Capacity and drain**:
  - Capacity follows the item's rank (30, or 40 for some items). An Orokin Catalyst doubles weapon capacity, so a rank 30 weapon with a catalyst has 60.
  - A mod's drain is its base drain plus its rank.
  - A **matching** polarity halves the drain, rounded up (Serration costs 14, or 7 in a Madurai slot).
  - A **mismatched** polarity adds a quarter, rounded mathematically: +0 for drain 0-1, +1 for 2-5, +2 for 6-9, +3 for 10-13, +4 for 14-16.
  - A universal (Omni Forma) slot halves every polarity except Umbra.
- **Card anatomy** (Mods page):
  - drain and polarity in the top right;
  - rarity diamonds at the top: Common bronze, Uncommon silver, Rare gold, Legendary platinum; Galvanized, Amalgam and similar mods use a material instead of diamonds;
  - the name with a variant prefix (Primed, Galvanized, Amalgam);
  - the effect text and a compatibility label ("RIFLE");
  - blue rank pips along the bottom.
  - Equipped mods use the **collapsed** card (introduced in Update 14.5 so more mods fit on screen): the name on the art, drain and polarity top right, and the pips below.
- **Drag and drop**:
  - You hold the left mouse button on an inventory card and drag it onto a slot.
  - While you drag, matching-polarity slots glow green and mismatched slots glow red, and hovering a slot shows how the drain will change.
  - The dragged card shrinks but keeps its proportions, so its drain and polarity stay readable.
- **Inventory filters**:
  - Search covers mod names, stat keywords and element names.
  - The category tabs (icons in the centre of the selection area) include Polarity, Aura, Exilus, Stance and Augment.
  - Sort By (upper right) offers Name, Rank, Drain, Polarity and Rarity.

What we copy:
- the region arrangement;
- the collapsed equipped cards versus the full inventory cards;
- the green/red polarity feedback while dragging;
- clickable stats that filter the inventory;
- search plus category filters plus sort.

What we don't copy:
- Config tabs. A saved build is the config; "Save as copy" covers variants.
- The bottom-right action buttons; the build toolbar keeps those jobs.
- Game-styled chrome. The frame stays Fluent 2. Only the card images are game art.

## 2. Workspace regions

> **Superseded** by [declutter-spec.md](declutter-spec.md): the regions are now the top bar, the Loadout and the Readout (spec 1-2). The stats rail, the always-on gallery, the results rail and the compare drawer are gone.

```
+--------------------------------------------------------------------------------------------+
| title bar 48 (Mica) - unchanged                                                            |
+--------------------------------------------------------------------------------------------+
| BUILD TOOLBAR 56: name · state · Undo Redo · [Import from screenshot ▾] · Save ▾ · ··· · Compare |
+--------------+--------------------------------------------------+--------------------------+
| STATS RAIL   | STAGE                                            | RESULTS RAIL             |
| Weapon stats | Weapon ▾  Rifle · R30 ·Catalyst  Fire mode ( )( ) | RESULT CARD (fixed)      |
| (scrolls)    | Capacity ███████░░ 48/60                          | Avg DPS 9,874 ▼8.4%      |
| Damage 35.8  | [Exilus   ] [Arcane    ]          Remove all      | TTK · hits · vs target   |
| Crit  32%  ▲ | [ 1 ][ 2 ][ 3 ][ 4 ]                              +--------------------------+
| Status ...   | [ 5 ][ 6 ][ 7 ][ 8 ]                              | Tabs: Charts|Target|Notes|
+--------------+--------------------------------------------------+ (scrolls)                |
| GALLERY: [Mods][Arcanes][Best mod 12/85]  [Search: cc drain<=10 ×]  Sort ▾  Size ▾  24 mods |
| chips: [Effect ▾][Polarity ▾][Rarity ▾] [✓ Fits Braton Prime] [Hide equipped]              |
| [card][card][card][card][card][card][card] ...  (virtualised grid, scrolls)               |
+-----------------------------------------------------------------+--------------------------+
| COMPARE DRAWER (optional; opens over the gallery area only)                                |
+--------------------------------------------------------------------------------------------+
| status bar 28 - unchanged                                                                  |
+--------------------------------------------------------------------------------------------+
```

- **Body grid** (CSS grid on the workspace body):
  - columns `[stats] [stage 1fr] [results]`; rows `[stage auto] [gallery 1fr]`;
  - the stats rail sits in row 1, column 1; the stage in row 1, column 2;
  - the gallery spans row 2, columns 1-2 (like the arsenal's inventory, which runs under the stats);
  - the results rail spans both rows in column 3.
- **Scroll containers** (siblings, never nested): library list, stats rail, gallery grid, results tab panel, compare grid body. The stage and the result card **never scroll**; the stage has a fixed height derived from the slot size.
- **F6 order**: builds → toolbar → stage → gallery → results → compare. Add `stage`, `gallery` and `stats` to `PANES` in `shortcuts.js` in this order: builds, toolbar, stats, stage, gallery, results, compare.
- **The Editor column goes away.** Notices (MessageBars) move to the top of the stage, above the weapon header, and push the gallery down while shown. Target and Notes become results-rail tabs. Weapon and fire mode move into the stage header.

### 2.1 Sizes and breakpoints (window width)

> **Superseded** by [declutter-spec.md](declutter-spec.md): see spec 2 and `src/renderer/layout.js` (`readoutWidth`, slot sizes at rest and in the picking strip, Picker card sizes).

| Width | Library | Stats rail | Results rail | Slot card (w x h) | Gallery card | Gutter |
| --- | --- | --- | --- | --- | --- | --- |
| >= 1920 (1920x1080) | inline 300, open | 300 | 440 | ~210 x 105 | Medium 148 | 24 |
| 1680-1919 | inline 264, open | 264 | 380 | ~180 x 90 | Medium 132 | 24 |
| 1280-1679 (1440x900) | overlay, closed by default | 264 | 380 | ~178 x 89 | Medium 132 | 16 |
| 1100-1279 (1100x700) | overlay, closed | **folded**: becomes a "Stats" tab in the results rail | 340 | ~172 x 86 | Small 112 | 16 |
| < 1100 (zoomed in) | overlay | stacked, see 2.5 | stacked | 2:1, 2 or 4 columns | Small 112 | 12 |

- **Slot width**: `(stageWidth - 2*gutter - 3*12) / 4`, clamped to 150-240 px. The height is always half the width (the compact image is 2:1). A container query on the stage, not the window, picks 4 columns; under 600 px of stage width the grid uses 2 columns (stacked layout only).
- **Stage height**:
  - with no notices it is `header 48 + capacity 28 + special row (h) + grid (2h + 12) + padding 2*gutter + gaps 3*12`, about 400 px at 1440x900;
  - the special row is as tall as a slot;
  - notices add their own height (they are dismissible).
- **Gallery**:
  - gets the remaining height, at least 220 px;
  - when less remains (several notices at 700 px height), the notices collapse into one MessageBar "3 notices" with a "Show" action.
  - Gallery card sizes Small 112 / Medium 132 / Large 168 (width; height = width x 1.36). They are chosen in the gallery "Size" menu (persisted in `localStorage`, default by breakpoint as above).
- **Compare drawer**: opens over the gallery area only (columns 1-2), with height `clamp(200px, 40%, 360px)` of the body. The gallery shrinks to its header row plus at least one card row. The results rail is never covered.

### 2.2 1440x900 (primary target)

> **Superseded** by [declutter-spec.md](declutter-spec.md): see spec 2.1-2.2.

```
title 48 | toolbar 56
stats 264 | stage ~780 (4 x 178 cards)                | results 380
  stats list (scrolls, ~400 tall)                     | result card ~190
gallery (1044 wide, ~310 tall): header 2 rows 84,      | Charts|Target|Notes
  7 cards across x ~1.7 rows visible                  | chart 200 + hit list
status 28
```
Visible without scrolling: the result card, all 9 mod slots and the arcane slot, the capacity, a full row of gallery cards (7 Medium cards), the Charts tab with the health chart, and the first 8 stat rows.

### 2.3 1920x1080

> **Superseded** by [declutter-spec.md](declutter-spec.md): see spec 2.3; the builds pane starts closed.

Library inline 300 + stats 300 + stage ~880 + results 440. The gallery is ~1180 wide, so 7 Medium (148) cards across × 2+ rows (gallery ~440 tall). The results rail shows the result card, then the Charts tab with the chart and the hit list without scrolling.

### 2.4 1100x700

> **Superseded** by [declutter-spec.md](declutter-spec.md): see spec 2.4; the stats are never folded into a tab.

- No inline library; the stats fold into a results-rail tab "Stats" (tab order: Charts, Stats, Target, Notes).
- The stage is ~760 wide (4 x 172 slots) and ~345 tall.
- The gallery is ~220 tall, with its header condensed to one row 40 px tall: tabs, search, a "Filters" `Button` with a `CounterBadge` of active chips that opens the chips in a `Popover`, and Sort.
- That leaves one row of Small cards (112 x 152) visible.
- The result card stays fully visible; the rail tabs scroll below it.

### 2.5 Stacked (< 1100 CSS px, only reachable by zooming)

> **Superseded** by [declutter-spec.md](declutter-spec.md): see spec 2.5; the Readout comes first.

One scroll area, in this order:
1. **Sticky DPS bar** (48 px, `position: sticky; top: 0`, `colorNeutralBackground1` with a bottom stroke): "Average DPS **9,874** ▼ 8.4% · TTK 3.70 s · Updating…". It keeps the headline visible at all times. A `Link` "Details" scrolls to the full result card.
2. The full result card.
3. The stage (2 or 4 slot columns by container width), with a skip `Link` "Go to mod gallery" in its header.
4. The results tabs: Charts, Stats, Target, Notes.
5. The gallery, last, because it is long.

The gallery is virtualised against the **outer** scroll area (scroll offset minus the gallery's `offsetTop`), so there are no nested scroll containers. Selecting a slot scrolls the gallery header into view (`scroll-margin-top: 56px`, clear of the sticky bar).

## 3. Stats rail (left)

> **Superseded** by [declutter-spec.md](declutter-spec.md): the stats are the Readout's Base / Modded / Change table (spec 4).

- `aside` region "Weapon stats" (F6 stop). Header: `Subtitle2` "Weapon stats" + `Caption1` fire mode.
- Content is the current `StatsPanel`, unchanged in data: the damage total, the per-type rows, and the 8 stat rows with base values and up/down arrows.
- **Arsenal behaviour**: each stat row is a `Button appearance="transparent"`. Clicking it puts that stat's search token into the gallery search: Crit chance → `cc`, Crit multiplier → `cd`, Status chance → `sc`, Multishot → `ms`, Fire rate → `fr`, Magazine → `mag`, Reload → `reload`, Faction → `bane`; a damage-type row → that element. It also switches the gallery to Mods. The tooltip reads "Find mods that raise crit chance".
- Below 1280 px this content is the "Stats" tab of the results rail, with the same buttons.

## 4. Stage (centre)

### 4.1 Header

> **Superseded** by [declutter-spec.md](declutter-spec.md): the header holds the weapon and the fire mode only; the Catalyst and Forma line and the stage More menu moved into the capacity line's menu (spec 5).

- **Left**:
  - Weapon `Combobox`, unchanged behaviour (ux-spec 4.4), `appearance="filled-darker"`, with its `Field` label "Weapon" visually hidden. The selected weapon name is shown at `Subtitle1` size.
  - Under it, `Caption1`: "Rifle · Rank 30 · Orokin Catalyst · 2 Forma". "Orokin Catalyst" is a `Link`-styled toggle that opens a `Popover` holding `Switch` "Orokin Catalyst (doubles capacity)". The Forma count is the number of slots whose polarity differs from the innate one.
- **Centre** (where the arsenal has its Config tabs): Fire mode `RadioGroup`, unchanged (ux-spec 4.4).
- **Right**: a "More" `Menu` with: Remove all mods (Undo toast), Reset slot polarities, Import from screenshot.

### 4.2 Capacity

- A `Field` "Capacity" with a horizontal bar (a custom div, not `ProgressBar`, because it must show overflow) and the value `48 / 60` in `Body1Strong`, tabular numerals. `data-testid="capacity"`. `role="meter"`, `aria-valuemin=0`, `aria-valuemax=60`, `aria-valuenow=48`, `aria-valuetext="48 of 60 capacity used"`.
- **Drain per slot**: `d = baseDrain + rank`. In a matching slot `ceil(d/2)`. In a mismatched slot `d + round(d/4)`. In a universal (unpolarised) slot `d`. In an Omni slot `ceil(d/2)` unless the mod is Umbra. This is a pure `slotDrain(mod, rank, slotPolarity)` in `src/shared/capacity.js`, unit-tested against the wiki examples (Serration 14 → 7 / 18).
- **Capacity**: 60 with the Catalyst on, 30 with it off. Progenitor weapons (`weapon.is_progenitor`: Kuva, Tenet, Coda) add `min(forma, 5) × 2 × (catalyst ? 2 : 1)`, up to +20, to model rank 40. The `InfoLabel` (i) states the assumptions: "Assumes weapon rank 30 (40 for Kuva, Tenet and Coda weapons after 5 Forma) and an Orokin Catalyst. Arcanes don't use capacity."
- **Over capacity**: the bar and the value use `colorStatusDangerForeground1`, plus `ErrorCircleRegular` and the text "6 over capacity". The game would refuse this, but a planner allows it so you can plan a Forma: we warn but never block. A gallery card that would overflow shows a caption "+7 → over capacity" in its flyout.

### 4.3 Slot polarities

- **Innate polarities** come from `data.polarities` (`type: "Weapon"`, matched by weapon name; 10 entries). For primaries and secondaries, general slot `i` (0-7) uses index `[7,6,5,4,3,2,1,0][i]` and the Exilus slot uses index 8. This is the mapping Underframe's slot code uses; the slot test checks Lex Prime (data: `AP_ATTACK` at index 0, so it lands in slot 8, and `AP_TACTIC` on the Exilus slot). `AP_UNIVERSAL` means no polarity.
- **Per-slot Forma**: the slot `Menu` has a "Polarity" submenu with `MenuItemRadio` None, Madurai, Vazarin, Naramon, Zenurik, Unairu, Penjaga, Umbra, Omni, plus "Reset to innate". These are stored in `build.slotPolarities[9]`, where `null` means innate. Changes are undoable. Polarity changes are shared by all of a build's mods, as configs share them in-game.
- A slot's own polarity shows as a 16 px glyph at the slot's top-left (the polarity SVGs from `core/images/polarities`, `aria-hidden`; fallback is the text symbol from `polarityInfo`). It is spoken in the slot's name ("Madurai slot").

### 4.4 Special row and grid

- Row 1, left to right: **Exilus** slot (one slot wide), **Arcane** slot (one slot wide), then empty space (the arsenal's top row has Aura and Exilus; weapons have no aura). In the 2-column stacked grid the row wraps into a 2-column row too.
- Rows 2-3: slots 1-4 and 5-8.
- Each slot has a caption above it only in the special row (`Caption1` "Exilus" / "Arcane", plus an `InfoLabel` "Only Exilus mods fit here." / "Primary arcanes only. Assumes a Primary Arcane Adapter."). General slots are uncaptioned; their number shows in the empty state and in the accessible name.

### 4.5 Slot card anatomy (filled mod)

> **Superseded** by [declutter-spec.md](declutter-spec.md): calmer cards: drain plate, rank text and a neutral honesty glyph only; no separate polarity glyph on filled slots, no rarity frame over art, pips only in the hover strip (spec 3).

The card is a 2:1 box with `borderRadiusLarge` and `overflow: hidden`. Layers, bottom to top:

1. **Image**: `<img src="app://local/core/images/mods/compact/<file>.webp" alt="" decoding="async">`, `object-fit: cover`. It is decorative, because the button's accessible name carries all of its information.
2. **Rarity frame**: a 2 px inset border (`box-shadow: inset 0 0 0 2px`) in the rarity colour: the current `RARITY_TOKEN` map (common Beige, uncommon Foreground3, rare Marigold, legendary Lavender). Primed, Galvanized and Amalgam count as legendary (by name prefix, as in-game). It is decorative; rarity is also spoken.
3. **Drain plate** (top-right, 6 px inset):
   - The plate is a fixed dark scrim `rgba(0,0,0,0.72)` with radius `borderRadiusMedium` and padding 2px 6px. It holds the slot-adjusted drain (`Caption1Strong`, tabular) and a 14 px polarity glyph.
   - Colours are **fixed**, because the art is dark in both themes: match `#7FE07A`, mismatch `#FF8F86`, neutral `#FFFFFF`. All are >= 4.5:1 on the scrim.
   - Non-colour cue: match has a 1 px solid outline in the same colour plus an `ArrowDownRegular` 10 px (the drain went down); mismatch has a 1 px dashed outline plus `ArrowUpRegular` 10 px.
   - Tooltip: "Drain 7 (14 halved by the Madurai slot)" / "Drain 18 (14 + 25%, polarity doesn't match the Naramon slot)".
4. **Bottom strip** (24 px, scrim `rgba(0,0,0,0.6)`):
   - Rank pips are CSS dots 6 px with 3 px gaps: filled `#6FC3FF`, empty a 1 px `#6FC3FF` ring at 50%. Their count is the mod's max rank (up to 10; Primed mods have 10). `aria-hidden`.
   - To their right, `Caption1` "5/10" in white for precision.
5. **Badges** (top-left, under the slot polarity glyph): "Partially simulated" / "Engine-only" as 20 px icon-only `Badge`s (`WarningRegular` / `InfoRegular`, `appearance="filled"`, warning/informative). Each is in a focusable `Popover` trigger with the same text as ux-spec 4.5.
6. **Action bar**: the bottom strip expands into it on `:hover`, on `:focus-within`, and always on the **selected** slot:
   - `[−]` `[+]` at the left: the rank stepper buttons, 24x24, `SubtractRegular` / `AddRegular`, tooltips "Lower rank (−)" / "Raise rank (+)";
   - the pips in the centre;
   - `[✦]` "Find best mod for slot 3" (`SparkleRegular`) and `[×]` "Remove (Del)" (`DismissRegular`) at the right;
   - all buttons `appearance="transparent"` with white icons and `colorStrokeFocus2` focus rings that are visible on the scrim;
   - a `MoreHorizontalRegular` menu button (top-right, left of the drain plate, on hover/focus only) holds Change mod (focuses the gallery), Find a better mod, Polarity ▸, Remove.
7. **Selected state**: a 2 px `colorBrandStroke1` outline offset 2 px outside the card, and the caption under the grid: "Slot 3 selected. Click a card in the gallery to put it here."
8. **Sweep running on this slot**: a scrim over the whole card, with "Finding best mod…" and an indeterminate `ProgressBar` (as now).

**Missing image** (no `core/images`, no entry in `index.json`, or `onerror`): the **text slot card** has the same size and overlays, a `colorNeutralBackground3` fill, the rarity frame, and the name centred in `Body1Strong` (2 lines, ellipsis, full name in a `Tooltip`), with the effect at the current rank in `Caption1` under it. The swap happens once per name (cached) with no flicker: the image fades in only after `load`, and is instant with reduced motion.

### 4.6 Empty, Exilus and Arcane states

> **Superseded** by [declutter-spec.md](declutter-spec.md): the captions with info buttons above Exilus and Arcane are gone; the arcane's stacks show as plain text (spec 3).

- **Empty general slot**:
  - A `Button appearance="subtle"` filling the box: 1 px dashed `colorNeutralStroke1`, the slot polarity glyph centred at 24 px in `colorNeutralForeground3`, and `Caption1` "Slot 5" under it.
  - Clicking it **selects** the slot. It does not open anything; the gallery is already there.
  - A hover/focus `[✦]` sits bottom-right.
  - Accessible name: "Slot 5, Madurai slot, empty".
- **Empty Exilus**: the same, with the caption "Exilus". Selecting it scopes the gallery to Exilus mods: a non-removable context chip "Exilus slot" reading "Showing Exilus mods".
- **Arcane slot, filled**:
  - The arcane image (`core/images/arcanes/<file>.webp`, ~1.36:1, `object-fit: contain` on a `colorNeutralBackground3` fill, because arcane art has no printed name). The name sits in a bottom plate with white `Caption1Strong`.
  - Rank pips 0-5 with "3/5", and the same rank -/+ and remove actions as a mod. The rarity frame is Legendary.
  - Below the name: an informative `Badge` "Assumes 12 stacks" when the arcane stacks. Its `Popover` holds a "Stacks" `SpinButton` 0..max_stacks and "Uptime: always active (trigger: On Kill)".
  - Arcane effects reach the engine as data (`build.arcanes` + `appState.conditionalStats/activeConditionals`), not by name.
- **Arcane slot, empty**: a dashed box with an arcane outline glyph (`DiamondRegular`) and "Arcane". Selecting it switches the gallery to the Arcanes tab.
- **Weapon without arcane support in the data** (no matching `conditionals.arcanes` type): the slot shows the disabled state "No arcanes for Bows in the data" (`disabledFocusable`, with that tooltip).

### 4.7 Slot keyboard and semantics

- The slot area is `role="group"` labelled "Mod slots". `useArrowNavigationGroup({ axis: 'grid', memorizeCurrent: true })` moves between the slot **primary buttons** in visual order: Exilus, Arcane, 1-4, 5-8. Tab leaves the group to the gallery.
- **Primary button name**: "Slot 3, Madurai slot: Serration, rank 10 of 10, drain 7, matches polarity". Description (`aria-describedby`): the effect at the current rank, plus "Selected" when selected. `aria-pressed` shows the selection.
- **Keys on a slot**:
  - Enter or Space selects it (Space on an already selected filled slot starts pick-up, see 6.3);
  - `+`/`=` and `-` change the rank; Home and End set rank 0 and max;
  - Del or Backspace removes;
  - Shift+Enter runs "Find best mod" for the slot;
  - Shift+F10 or the context-menu key opens the slot `Menu`;
  - after a remove, focus stays on that slot's (now empty) button.
- **Global shortcuts**:
  - Ctrl+1…Ctrl+8 select slots 1-8, Ctrl+9 the Exilus slot, Ctrl+Shift+9 the Arcane slot, and move focus to the gallery search;
  - Ctrl+F focuses the gallery search;
  - Esc in the gallery returns focus to the selected slot.

## 5. Gallery (bottom)

### 5.1 Header

> **Superseded** by [declutter-spec.md](declutter-spec.md): the gallery is the Picker, shown only while picking, with one header row and a Filters popover; Hide equipped is on by default (spec 1.1).

- **Row 1**:
  - `TabList size="small"`: **Mods** (with a count, e.g. "Mods 214"), **Arcanes**, and **Best mod**. Best mod shows only when a sweep exists; while running its label is "Best mod 12/85" with a tiny `Spinner`.
  - The `SearchBox` (flex 1, min 240, max 560, `data-testid="gallery-search"`; placeholder on Mods: "Search mods: name, effect, cc, drain<=6…", on Arcanes: "Search arcanes").
  - Sort `Dropdown` and a Size `Menu` (`MenuItemRadio` Small, Medium, Large).
  - `Caption1` result count with `role="status"` (`data-testid="gallery-count"`).
- **Row 2 (chips)**: a `Toolbar` "Gallery filters" holding:
  - `Menu` buttons **Effect** (`MenuItemCheckbox` per `EFFECT_CATEGORIES`), **Polarity** (`MenuItemCheckbox` with a glyph per polarity: Madurai, Vazarin, Naramon, Zenurik, Unairu, Penjaga, Umbra, None) and **Rarity** (Common, Uncommon, Rare, Legendary);
  - `ToolbarToggleButton` "Fits Braton Prime" (on by default; off shows incompatible mods dimmed with the reason "Doesn't fit Braton Prime") and "Hide equipped";
  - then the active filters as a dismissible `TagGroup` (`Tag size="small" dismissible`), one tag per parsed operator or menu choice ("Polarity: Madurai ×", "Drain at max rank ≤ 6 ×", "Exilus slot" without ×);
  - a `Link` "Clear filters" when there are any.
- The context line (`Caption1`, under the chips, only when a slot is selected): "Picking for slot 3 (Madurai). Click a card to equip it." / "…for the Exilus slot" / "No slot selected: cards go into the first empty slot."
- At 1100 px the chips move into a "Filters" `Popover` (2.4).

### 5.2 Smart search grammar (`src/shared/search.js`, pure, tested)

`parseQuery(text) → { terms[], phrases[], negations[], filters{drain, rank, pol[], rarity[], is[], has[], gain}, unknown[] }` and `searchMods(index, parsed, ctx) → [{ name, score, reasons[] }]`.

| Syntax | Meaning | Example |
| --- | --- | --- |
| words | Fuzzy match on name (weight 3), stat keywords and categories (2), description (1). Each word must match something (AND). Prefix match counts; edit distance ≤ 1 for words ≥ 4 chars, ≤ 2 for ≥ 8. | `serat` → Serration |
| `"…"` | Exact phrase in name or description | `"status chance"` |
| `-word` | Exclude | `cold -primed` |
| `drain<=6`, `drain:4`, `drain>8` | Max-rank drain compare (`<`, `<=`, `>`, `>=`, `:`/`=`): the number on the card, adjusted for the target slot's polarity when it has one (the fit hint's number). The tag reads "Drain at max rank ≤ 6". | `drain<=6` |
| `rank:10`, `rank>=5` | Max rank | `rank:10` |
| `pol:` / `polarity:` | Madurai `v`/`madurai`, Vazarin `d`, Naramon `-`/`dash`/`naramon`, Zenurik, Unairu, Penjaga, Umbra, `none` | `pol:v` |
| `rarity:` / `r:` | common, uncommon, rare, legendary (also `primed`, which counts as legendary) | `r:rare` |
| `is:` | `equipped`, `fits`, `exilus`, `blocked`, `partial`, `engine-only`, `primed`, `galvanized`, `amalgam`, `augment` | `is:exilus` |
| `has:` | A stat category or synonym | `has:cd` |
| `gain>` | DPS gain % after a sweep | `gain>5` |

**Synonyms** (`src/shared/search-synonyms.js`: our own vocabulary table, no game data). Each entry maps to stat keys (`UpgradeType`s) or name patterns:
- `cc`, `crit`, `crit chance` → critical chance; `cd`, `cm`, `crit dmg`, `crit damage` → critical damage;
- `ms`, `multi` → multishot; `fr`, `firerate`, `aps` → fire rate;
- `sc` → status chance; `sd` → status duration;
- `dmg`, `base`, `damage` → base damage;
- `ips` → impact, puncture, slash; `slash`, `puncture`/`punc`, `impact`;
- elements: `heat`/`fire`, `cold`/`ice`/`cryo`, `elec`/`electric`/`shock`/`lightning`, `toxin`/`tox`/`poison`;
- combined elements expand to their pair, with a hint: `viral` → cold + toxin, `corrosive`/`corro` → electricity + toxin, `radiation`/`rad` → heat + electricity, `blast` → heat + cold, `magnetic`/`mag el` → cold + electricity, `gas` → heat + toxin. The hint "Viral comes from Cold + Toxin: showing both" appears under the count.
- factions: `bane`, `faction`, `grineer`, `corpus`, `infested`, `corrupted`/`orokin`, `murmur`/`the murmur`, `sentient`, `scaldra`, `techrot` → faction-damage mods (resolved against stat keys, not names);
- `primed`, `galvanized`/`galv`, `amalgam`, `prime` (prefix);
- `mag`/`magazine`, `reload`/`rs`, `ammo`, `pt`/`punch`/`punch through`, `zoom`, `recoil`, `accuracy`, `hs`/`headshot`/`weak point`, `exilus`/`utility`, `aug`/`augment`, `dual`/`60/60` (mods with two damage stats).

**Ranking**:
- Best match is the sum of weights, plus 2 for an exact name prefix, plus 1 for "common pick" (the existing `popular` flag).
- Ties sort by name.
- Blocked cards always sort to the end of their group.
- Sort options: Best match, Name (A-Z), Drain (low to high, by slot-adjusted drain for the selected slot), Rarity (legendary first), DPS gain (enabled only when a sweep exists for the selected slot and build; otherwise `disabled` with the option text "DPS gain (run Find best mod first)").

**Did you mean**:
- When there are 0 results, or no result scores above the fuzzy floor, the closest name or synonym within edit distance 2 of each unknown word is offered: "No mods match "seration". Did you mean **Serration**?". The `Link` replaces the word.
- An unknown operator (`drian<5`) gets: "Unknown filter "drian". Did you mean drain?"

**Live behaviour**:
- Filtering runs on every keystroke (< 16 ms for ~400 mods).
- The count text updates at once, and is announced through `useAnnounce` (polite) 600 ms after typing stops: "24 mods" / "No mods match".
- Parsed operators turn into tags when Space or Enter follows them; the raw text stays editable.
- Enter in the search equips the first equippable result into the target slot (the selected slot, else the first empty).
- Down arrow moves to the first card.

### 5.3 Card grid

- **Layout**: CSS grid `repeat(auto-fill, <size>px)`, gap 8 px, cards left-aligned. Each card is `width × round(width*1.36)` (the full-card ratio 312:424).
- **Virtualisation**: our own `useGridWindow` hook, with no new dependency. Rows are fixed height, so it renders only the visible rows plus 2 overscan rows above and below, using spacer padding. Columns are computed from the measured grid width (`ResizeObserver`). The scroll element is the gallery body, or the stacked outer area (2.5).
- **Grid semantics**:
  - `role="grid"`, `aria-label="Mods"`, with `aria-rowcount` and `aria-colcount`;
  - each rendered row is `role="row"` with `aria-rowindex`;
  - each cell is `role="gridcell"` with `aria-colindex`, and contains the card **button**;
  - one roving `tabIndex=0`.
- **Keys**:
  - arrows move by card; Home/End go to the row start or end; Ctrl+Home/End go to the first or last card;
  - PageUp/PageDown move by visible rows;
  - Up from the first row goes back to the search;
  - typing a printable character goes to the search.
  - The focused card scrolls into view (`block: nearest`) and keeps focus when rows re-render (the key is the mod name).
- **Image**:
  - `<img src="app://local/core/images/mods/full/<file>.webp" loading="lazy" decoding="async" alt="" draggable="false">` in a box with a reserved aspect ratio. Before the image loads, a `colorNeutralBackground3` placeholder shows the mod name in `Caption1` (static, no shimmer). The image fades in over 120 ms (instant with reduced motion).
  - The 240 px WebP sources are crisp up to Large (168 CSS px at 1.4x DPR).
  - Note that the full card image shows the **max-rank** effect and drain (that is how the host renders it). Our drain overlay on gallery cards is therefore omitted, and the flyout shows the per-rank values.
- **Overlays on gallery cards** (all on fixed dark scrims, white text):
  - top-left: the "Equipped" badge (`CheckmarkCircleFilled` + "Slot 3"), or the gain badge ("+12.4%" in delta-badge style, `appearance="filled"`) after a sweep;
  - bottom-left: the honesty icon badges (as on slots);
  - top-right: a polarity-fit hint for the selected slot. If the selected slot has a polarity: a green `ArrowDownRegular` "7" when it matches, or a red `ArrowUpRegular` "18" when it doesn't. This is the projected drain, as in the arsenal's drag hover.
- **Card states**:
  - **Hover**: lift with `shadow8` (`shadow4` at rest), a `colorNeutralStroke1Hover` 1 px outline, and the details flyout after 400 ms (5.4).
  - **Focus**: the v9 double focus ring (`createFocusOutlineStyle`, outline radius `borderRadiusLarge`); the flyout after 600 ms of rest.
  - **Equipped**: the badge as above, plus a 2 px `colorBrandStroke1` inset frame. Still clickable: clicking moves it into the target slot (a swap if the target is filled).
  - **Conflict or blocked**:
    - The image is dimmed (`filter: grayscale(1) brightness(0.55)`), and a solid bottom plate (`colorNeutralBackground1`, `colorNeutralForeground1` text, `ProhibitedRegular`) shows the reason: "Conflicts with Serration", "Already in slot 2", "Doesn't fit Braton Prime", "Not an Exilus mod".
    - The card stays focusable with `aria-disabled="true"`, and the reason is in its accessible name.
    - Click and Enter do nothing except announce the reason (`useAnnounce`) and give the plate a 2 px `colorStatusWarningBorder1` outline for 1 s (no motion).
  - **Not simulated / partially simulated**: the honesty badges as above. "Engine-only" mods are not dimmed.
  - **Over capacity if equipped**: no dimming (a planner allows it); the flyout notes it.
- **Card accessible name**: "Serration, rare, Madurai, drain 4 to 14, +165% damage at max rank". Then, as they apply: "equipped in slot 1", "unavailable: conflicts with Split Chamber", "partially simulated", "+12.4% DPS". This matches the current `PickerItem` spoken label, extended.
- **Activation**:
  - Click, Enter or Space equips into the **target slot**: the selected slot, or else the first empty general slot (an Exilus-only mod goes to the Exilus slot if that is empty).
  - Rank defaults to max (ux-spec 4.6).
  - If the selected slot was empty, the selection then advances to the next empty slot, so repeated clicks fill the grid in order. If it was filled (a replace), the selection stays.
  - If no slot is free and none is selected, a toast "All slots are full. Select a slot to replace its mod." appears and the card is not equipped.
  - Focus **stays in the gallery** (fast filling). An announcement says "Serration equipped in slot 1. Average DPS updating."
  - Ctrl+Z undoes.
- **Context menu** (right-click or Shift+F10): Equip in ▸ (Slot 1…8, Exilus; each with its projected drain), Details (Alt+Enter), Find best mod for the selected slot, Copy name.
- **Text-card fallback** (no image): same size; a `colorNeutralBackground2` card with a 4 px rarity top band; drain and polarity top-right (`Caption1Strong` + glyph); name `Body1Strong` (3 lines); effect at max rank `Caption1` (4 lines); the compatibility caption (e.g. "Rifle"); and rank pips (max) at the bottom. In forced-colors mode **every** card uses the text card, because image text can't follow system colours.

### 5.4 Details flyout

- **Trigger and placement**: a `Popover` with `openOnHover` (`mouseLeaveDelay` 150), opened on keyboard focus after a 600 ms rest or with Alt+Enter, positioned `after` with fallbacks and `withArrow`, size `min(360px)`. It is non-modal and never takes focus. Esc closes it. `data-testid="mod-flyout"`.
- **Content**:
  - name (`Subtitle2`), then "Rare · Madurai · drain 4-14 · Rifle";
  - the full description;
  - a per-rank `Table size="extra-small"` with columns Rank, Drain (slot-adjusted for the target slot) and Effect. All ranks are listed when there are 6 or fewer, otherwise ranks 0, 1, mid and max with a "Show all ranks" `Link`;
  - honesty notes (`MessageBar`s as in the current picker detail), the conflict reason, and the sweep gain ("+12.4% DPS in slot 3 · best-mod search, 3 runs");
  - a capacity line "Uses 7 → 55 / 60" or "Uses 18 → 66 / 60 (6 over)".
- **Arcane flyout**: the image, the max-rank description (`max_rank_description`), the trigger, buffs per stack, max stacks and duration (from `conditionals.arcanes`), and "Simulated as always at max stacks" (or "Not simulated" when the arcane has no `conditionals` entry; those cards get the "Engine-only" badge).

### 5.5 Arcanes tab

- **Source**:
  - the weapon arcanes in `data.arcanes` whose name has a matching `data.conditionals.arcanes` entry with `type` equal to the weapon's slot type (Primary, Secondary), or a subtype type (Shotgun, Bow, Pistol…) that fits the weapon;
  - plus weapon-specific ones whose `native_item_compatibility` includes the weapon.
  - Non-fitting arcanes are hidden while "Fits" is on, and dimmed with the reason when it is off.
- **Cards**: the arcane image (contain, on `colorNeutralBackground3`), then a name plate (`Body1Strong`), then `Caption1` "On Kill · +30% damage ×12". Same sizes, states, grid, keys, flyout and fallback as mods. The search grammar applies (`is:equipped`, words, trigger words: `kill`, `headshot`, `reload`).
- Clicking equips into the selected arcane slot at max rank (the first one when a mod slot is selected). On a kitgun, selecting the Kitgun arcane slot lists the Pax and Residual arcanes, and an arcane that only fits the other slot goes there.

### 5.6 Best mod view (replaces the results-rail tab)

- Started from the slot's `[✦]`, the slot menu, the card context menu, or the gallery header `Button` "Find best mod for slot 3" (shown when a slot is selected).
- The tab selects itself on start. Its header:
  - running: a determinate `ProgressBar` "Testing 12 of 85 mods" + Cancel;
  - finished: "Best mod for slot 3 · baseline 5,774 DPS with the slot empty · max rank, 3 seeded runs" + "Run again" + Close.
- The grid is the same card grid, sorted by DPS gain, with gain badges on every card and ranks 1-3 marked ("#1"). Clicking equips into **the swept slot**, not the selected slot, and the context line says so.
- Stale, cancelled, error and empty states and copy are unchanged from ux-spec 4.10, shown as a `MessageBar` above the grid.
- The Mods tab also shows gain badges and enables "Sort: DPS gain" while the sweep matches the selected slot.

### 5.7 Gallery states

| State | Behaviour |
| --- | --- |
| Empty (no match) | `No mods match "<q>".` + "Did you mean …" + `Button` "Clear search" + (with chips) "Clear filters" |
| Empty (no compatible) | "No compatible mods for this slot." (Arcanes: "No arcanes fit the Lex Prime in this data version.") |
| Loading | Data is in memory. `core/images/index.json` loads at boot. Until it arrives, cards render as text cards and are not reflowed when images come. |
| Error | `index.json` missing or invalid → text cards everywhere, plus a one-time info `MessageBar` in the gallery: "Card images aren't installed. Showing text cards." (no error toast) |
| Disabled | During a sweep the slot being swept can't be a drop target ("A best-mod search is running for this slot"). |

## 6. Drag and drop

### 6.1 Mechanics

- Use native HTML5 drag and drop, with no new dependency. Gallery cards and filled slots are `draggable`.
- `setDragImage` uses the **compact** image of the mod (or a 160x80 text plate when the image is missing), mirroring the in-game "shrinks but keeps its proportions".
- The `dataTransfer` type is `application/x-uf-mod` (or `-arcane`), with JSON `{ name, from: 'gallery' | slotIndex }`.

### 6.2 Feedback and results

- **While dragging a mod**:
  - every slot that accepts it shows a 2 px outline: green (`colorPaletteGreenBorder2`) when its polarity matches, red (`colorPaletteRedBorder2`) when it doesn't, neutral (`colorNeutralStroke1`) for an unpolarised slot, each with its projected drain shown in the plate (non-colour cue: the drain number and arrow);
  - slots that refuse the mod (Exilus for a non-Exilus mod, a conflict) dim, and show `ProhibitedRegular` with the reason in a small plate;
  - the hovered slot shows a 3 px brand outline and "Drop to equip (drain 7)" / "Drop to swap with Split Chamber";
  - capacity previews the new total in the meter.
- **Drops**:
  - **Gallery → slot**: equip at max rank; this replaces a filled slot, and Ctrl+Z restores it.
  - **Slot → slot**: swap the two (rank kept). Moving a mod into the Exilus slot is allowed only for Exilus mods.
  - **Slot → outside** (the gallery area, or a drop with no target): remove. While a slot is being dragged, the gallery shows a full-area drop zone `data-testid="drop-remove-zone"` that reads "Drop here to remove Serration" with `DeleteRegular`. Toast: "Removed Serration" with Undo.
  - **Arcane** cards drop only on the arcane slot; dragging the arcane out removes it.
- **Undo**: every drop is one undo step. Esc during a drag cancels it (native).

### 6.3 Keyboard equivalent (pick-up mode)

- **Space** on a gallery card or a filled slot picks it up: `aria-grabbed` is not used; we announce instead. Announcement: "Picked up Serration. Use arrow keys to choose a slot, Enter to drop, Delete to remove, Escape to cancel."
- **Moving**: focus moves to the slot group (the target slot first). Arrows move between slots, which show the same green/red and drain preview as a mouse drag. Each slot announces "Slot 3, Madurai, drain 7, empty" or "…swap with Split Chamber".
- **Dropping**: Enter drops; Delete (when picked up from a slot) removes; Esc cancels and returns focus to the origin.
- Enter on a gallery card stays the one-step equip; pick-up is only needed for choosing a non-target slot or for swapping.
- **Shortcut**: Alt+Shift+Arrow on a filled slot swaps it with its neighbour.

## 7. Screenshot import (OCR)

### 7.1 Entry points

- **Toolbar** `SplitButton` "Import from screenshot" (`ScanTextRegular`; verify every icon name against `@fluentui/react-icons` 2.0.344 and pick the nearest export if one is missing). `data-testid="ocr-button"`.
  - The main action opens the Windows file dialog (PNG, JPG, JPEG, WebP, BMP; ≤ 25 MB).
  - Menu items: "Paste screenshot (Ctrl+V)", "Read from game window (Ctrl+Shift+G)", "Choose file… (Ctrl+I)".
- **Ctrl+V anywhere** when the clipboard holds an image and no text. In a text field with text on the clipboard, the paste stays a normal paste.
- **Dropping an image file** onto the window: a full-window drop overlay "Drop a screenshot to import a build" (dashed brand border, `ImageRegular` 48 px) appears while a file drag with an image type is over the window. Non-image files show "Only images can be imported".
- **Read from game window**:
  - The main process calls `desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 3840, height: 2160 }, fetchWindowIcons: false })` and takes the source whose name is `Warframe` (case-insensitive, exact).
  - This works while the game is in the background, as long as it is not minimised.
  - A new preload method `uf.captureGameWindow()` returns a PNG data URL or `{ error }`.
- **First run** of any entry point shows a privacy note inside the dialog (7.6), not a separate prompt.

### 7.2 Recognition (what the UI can rely on)

- **Pipeline** (main process or a worker, never the network):
  1. decode;
  2. upscale ×2 if the height is < 1000 px;
  3. Windows.Media.Ocr (en-US) → lines with word boxes;
  4. fuzzy-match the lines against weapon names, the compatible mod names (multi-line names merged by box proximity: "Primed Cryo / Rounds") and the arcane names, using the 5.2 matcher;
  5. image similarity (perceptual hash) of each slot-shaped region against `core/images/mods/compact`, and of the arcane slot against `core/images/arcanes` (arcane art has no text);
  6. assign slots by geometry: the 2x4 grid is clustered from the matched boxes, the row above it holds Exilus and Arcane, and mods are ordered left to right, top to bottom.
- **Output**: `{ weapon: {name, confidence, box}, slots: [9] {name|null, raw, confidence, box, rankAssumed: true}, arcane: {...}, unmatched: [{raw, box}] }`.
- **Confidence** combines the text match score and the image score. Bands:
  - **High** ≥ 0.85: `CheckmarkCircleRegular`, success colour;
  - **Check** 0.60-0.85: `WarningRegular`, warning colour;
  - **Low** < 0.60: `QuestionCircleRegular`, neutral. A Low item is **not applied** by default; its slot stays empty, with the suggestion shown.
- **Ranks** are not read from the pips in v1: every item is set to max rank and labelled "Rank assumed max".

### 7.3 Progress

The dialog opens at once with a `ProgressBar` and step text in `role="status"`: "Reading image…" → "Recognising text…" → "Matching mods…" → "Checking card images…". Each step is determinate when the step count is known. A Cancel button is always available. A typical run takes under 2 s; at 20 s the dialog shows "This is taking longer than usual" with Cancel.

### 7.4 Review dialog

- `Dialog modalType="modal"`, surface `min(1200px, 94vw) × min(820px, 92vh)`, `data-testid="ocr-review"`. Title: "Review imported build". Initial focus is on the first item that needs checking, else the primary action.
- **Left (flex 1)**: the screenshot, `object-fit: contain`. Alt text: "Your screenshot, 2560 by 1440 pixels, with 10 recognised regions".
  - Each recognised region is an absolutely positioned box: 2 px border, solid for High, dashed for Check, dotted for Low, in the band colour. It carries a numbered tag (1-10) matching the list, and is `aria-hidden` because the list is the accessible version.
  - Hovering or focusing a list item highlights its box (the border thickens to 3 px, the rest dims to 40%), and the reverse also works. Unmatched text regions are thin grey boxes.
  - A `ToggleButton` "Show unrecognised text" controls them.
  - Zoom: Ctrl+wheel and the +/- buttons; the image pans when zoomed.
- **Right (480 px, scrolls)**:
  - **Weapon** `Combobox`, prefilled with the confidence badge. If the weapon is unsupported: a `MessageBar` warning "Nikana Prime was recognised, but only primary and secondary guns are supported. Pick a gun to continue." Both apply actions stay disabled until a supported weapon is chosen.
  - **Arcane** and **Exilus** items, then **Slots 1-8**, as a list. Each item (`data-testid="ocr-item"`) shows:
    - the compact card image (or a text card);
    - the name, the confidence badge "High 0.93" / "Check 0.71" / "Low 0.42", the raw text in `Caption1` ("Read as: "SERRAT1ON"");
    - "Rank assumed max", with a rank stepper;
    - the actions **Replace** (opens a `Popover` with a mini gallery: the 5.2 search prefilled with the raw text, the 8 best results as labelled card images in two columns, arrow keys between them, Enter picks), **Clear**, and for Low items **Use suggestion**. An item the player picked shows a "Chosen by you" badge instead of a confidence badge, and no "Read as" line; a rank changed with the stepper reads "Rank set by you".
    - Slots nothing was taken from are told apart: **Empty** (the card area has no text), **Not recognised: covered in the screenshot** (a tooltip or other text lies over the card or its column), **Not read from the screenshot** (the slot's row, the exilus or the arcane wasn't found), **Not recognised** (text that matched nothing) and **Riven: not supported**. The middle three carry a Check badge, the hint "Pick the mod you see, or leave it empty", a primary "Pick mod" button, and count for initial focus.
    - When the weapon wasn't recognised but every kept mod and the arcane fit the open build's weapon, that weapon is preselected with a "Check it" message.
    - Slot polarities aren't read from screenshots. When the applied mods would go over capacity with the weapon's own polarities, the slots whose mods save the most drain are given their mod's polarity (as Forma would) until the build fits; the review says so, and the build's notes and the apply toast say how many slots were given a polarity.
  - Conflicts inside the import (two mods from the same family) are flagged in-line ("Conflicts with slot 2"), and the later one is not applied.
  - **Unrecognised text**: a collapsed `Accordion` with the raw lines and "Search for this" links.
- **Actions** (`DialogActions`):
  - **"Open as new build"** (primary, `data-testid="ocr-apply-new"`): an unsaved build named "Imported <Weapon> build", with Notes set to "Imported from a screenshot on Oct 24, 2026. Ranks assumed max; check them." The dirty-build guard (ux-spec 4.3) applies first.
  - **"Apply to current build"** (`data-testid="ocr-apply-current"`): replaces the weapon (if different), the mods and the arcane, and keeps the target, fire mode and notes. This is one undo step; toast: "Imported 9 mods into "Braton build"" + Undo.
  - **"Cancel"**.
  - A caption on the left: "Only items you keep are applied. Low-confidence items stay empty."

### 7.5 Error and empty states

| Case | Copy (in the dialog, `MessageBar` + actions) |
| --- | --- |
| Clipboard has no image | Toast (info): "There's no image on the clipboard. Copy a screenshot first (Win+Shift+S)." |
| Unsupported or corrupt file | "Couldn't open this image. Use a PNG, JPG, WebP or BMP screenshot." [Choose another file] |
| OCR not available | "Windows text recognition isn't available. Add the English (United States) language in Settings > Time & language, then try again." [Open language settings] [Try again] |
| No text found | "No text was found in this image. Use a full-size screenshot of the arsenal's Mods screen." |
| Text but no mods | "We found text but no mod names. Make sure the game is in English and the screenshot shows the Mods screen." [Show recognised text] |
| Game window not found | "Warframe isn't running, or its window is minimised. Open the arsenal's Mods screen and try again." |
| Blank capture (all black) | "The capture came back blank. Switch Warframe to Borderless fullscreen in Display settings and try again." |
| Timeout or cancel | Cancel just closes. Timeout: "Recognition took too long and was stopped." [Try again] |

### 7.6 Privacy

A `Caption1` with `LockClosedRegular` sits permanently in the review and progress dialogs: "Screenshots are read on this PC with Windows' built-in text recognition. Nothing is uploaded, and the image isn't saved." The image lives in memory only and is released when the dialog closes. The window capture happens only on that explicit command, never in the background.

## 8. Results rail changes

> **Superseded** by [declutter-spec.md](declutter-spec.md): there is no results rail: see the Readout (spec 4) and Why this DPS (spec 1.1).

- The result card is unchanged. Its target line keeps "Change", which now selects the **Target** tab and focuses Enemy.
- Tabs: **Charts | Target | Notes** (plus **Stats** first-after-Charts below 1280 px).
- Target and Notes reuse `TargetCard` and `NotesCard` without the outer card chrome.
- The "What's simulated" `InfoLabel` now reads: "Seeded runs of Underframe's engine: crits, status, armor, shields, overguard and weapon arcanes (at the stacks you set). Not yet: rivens, conditional mods, incarnon bonuses, melee."

## 9. Accessibility, motion and contrast (additions to ux-spec 6)

- **Images**:
  - card and slot images use `alt=""`, because the control's accessible name holds the name, rarity, polarity, drain, rank and effect;
  - the OCR screenshot has a descriptive alt (7.4);
  - polarity glyph images use `alt=""` with the polarity spoken in the name;
  - no information is only in an image. The text card is always one keypress away: the gallery Size menu has "Text cards" (persisted), which also helps Narrator users who zoom.
- **Fixed-colour overlays**: their contrast is checked against the scrim, not the theme: white on `rgba(0,0,0,0.6)` over the brightest card art ≥ 4.5:1; drain match and mismatch colours ≥ 4.5:1.
- **Forced colours**: text cards everywhere; slot and drop outlines in `Highlight`; match and mismatch shown as solid and dashed `CanvasText` outlines plus the arrow icons; pips in `CanvasText` and `GrayText`; the conflict plate in `Canvas`/`CanvasText` with a border.
- **Reduced motion**: no image fade, no hover lift transition (the shadow changes instantly), no drag preview animation, and the flyout opens without motion.
- **Target size**: slot action buttons are 24x24 minimum; gallery cards are ≥ 112x152; chip tags are ≥ 24 px tall.
- **Announcements** (`useAnnounce`, polite): equip, remove, swap, rank change ("Serration rank 7 of 10"), result count, pick-up and drop, OCR step completion and the final "Found Braton Prime and 9 mods, 2 need checking".
- **Focus**:
  - after a gallery equip, focus stays on the card;
  - after a drop, on the destination slot;
  - after a remove by drag, on that slot;
  - after the OCR dialog applies, on the build name (new build) or the stage group (current build);
  - after the OCR dialog is cancelled, on the trigger.
- **Screen-reader order**: toolbar → stats → stage → gallery → results, matching F6.

## 10. Implementation notes (UX-affecting)

- **Images**:
  - `core/scripts/images.mjs` writes `core/images/{mods/compact,mods/full,arcanes,polarities}/*.webp|svg` and `core/images/index.json`;
  - `protocol.js` serves `/core/images/**` read-only, with `image/webp` and `image/svg+xml`, and `img-src 'self'` in the page CSP;
  - the renderer resolves names through `index.json` (canonical name → file) in one `src/renderer/images.js` helper (`cardUrl(name, 'compact'|'full')`, `arcaneUrl`, `polarityUrl`), which returns `null` when the image is absent;
  - **no image or URL to the asset host is ever placed in `src/`, `test/` or `docs/`**.
- **New pure modules with `node --test` coverage**: `src/shared/search.js` + `search-synonyms.js` (the parser, matcher, did-you-mean), `src/shared/capacity.js` (`slotDrain`, `capacityOf`, `innateSlotPolarities`, `formaCount`), and the slot selection and target-slot reducer in `model.js`. Test fixtures may use mod names and OCR text strings, but no images.
- **Build model**: `arcanes: [{ name, rank, stacks }]` (length 1), `slotPolarities: (code|null)[9]` and `catalyst: boolean` (default true). `normalizeBuild` defaults missing fields, so old saves load unchanged. All three go into the undo snapshot and `simKeyOf` (arcanes affect the sim; polarities and catalyst don't).
- **Preload additions**:
  - `uf.ocrImage(bytes) → result`, run in the main process via Windows.Media.Ocr. Either a persistent hidden PowerShell 5.1 host, or a small native helper; whichever is used, the UI contract is 7.2.
  - `uf.captureGameWindow()`.
  - `uf.openLanguageSettings()`, which opens `ms-settings:regionlanguage`.
- **The modal picker and `state.picker` are removed.** `actions.openPicker(slot)` becomes `actions.selectSlot(slot, { focusGallery: true })`.

### 10.1 `data-testid` hooks

- **Kept**: `avg-dps`, `ttk`, `result-card`, `library-item`, `featured-item`, `compare-grid`, `slot-<i>` (0-7 general, 8 Exilus), `slot-add-<i>` (the empty slot button).
- **New**:
  - slots: `slot-arcane`, `slot-select-<i>` (the primary button on a filled slot), `slot-rank-dec-<i>`, `slot-rank-inc-<i>`, `slot-remove-<i>`, `slot-best-<i>`, `slot-drain-<i>` (the plate, with `data-match="match|mismatch|neutral"`);
  - stage and stats: `capacity`, `stats-rail`, `stat-filter-<key>`;
  - gallery: `gallery`, `gallery-tab-mods`, `gallery-tab-arcanes`, `gallery-tab-best`, `gallery-search`, `gallery-count`, `gallery-sort`, `gallery-chip-<id>`, `gallery-card` (with `data-mod-name`, `data-state="ok|equipped|blocked"` and `aria-disabled`), `arcane-card`, `mod-flyout`, `drop-remove-zone`;
  - OCR: `ocr-button`, `ocr-progress`, `ocr-review`, `ocr-region` (with `data-index`), `ocr-item`, `ocr-replace`, `ocr-apply-new`, `ocr-apply-current`, `ocr-error`.
- **Removed**: `mod-picker`, `mod-option`. The smoke test's picker steps switch to `gallery-search` + `gallery-card`.

### 10.2 Shortcuts (replace the slot rows in ux-spec 5.5)

> **Superseded** by [declutter-spec.md](declutter-spec.md): Ctrl+F and Ctrl+1-9 open the Picker, Esc closes it, Ctrl+T opens the target, Ctrl+J opens the Compare dialog (spec 5).

| Keys | Action |
| --- | --- |
| Ctrl+1…Ctrl+8, Ctrl+9, Ctrl+Shift+9 | Select slot 1-8, Exilus, Arcane, and focus the gallery search |
| Ctrl+F | Focus the gallery search |
| Ctrl+I / Ctrl+V (image) / Ctrl+Shift+G | Import from a file / from the clipboard / from the game window |
| Space (card or slot) | Pick up for a keyboard drag; arrows choose a slot, Enter drops, Del removes, Esc cancels |
| Alt+Shift+Left/Right/Up/Down | Swap the focused slot's mod with its neighbour |
| Alt+Enter | Show the details flyout for the focused card |
| Shift+Enter (slot) | Find the best mod for this slot |
| + / − / Home / End (slot) | Raise, lower, zero or max the rank |

## 11. Acceptance checklist

Layout
- [ ] 1. At 1440x900, without scrolling, these are all visible: the result card with Average DPS, all 9 mod slots plus the arcane slot, the capacity meter, at least one full row of gallery cards (≥ 6 cards), the Charts tab with the health chart, and ≥ 8 stat rows.
- [ ] 2. At 1920x1080: the library is inline at 300 px, the stats rail 300, the results rail 440, and ≥ 2 full gallery rows are visible.
- [ ] 3. At 1100x700: the stats are a "Stats" tab in the results rail; the 4-column slot grid is fully visible; one gallery row is visible; the result card is fully visible; there is no horizontal scrollbar.
- [ ] 4. Below 1100 px (zoom 200% on 1920x1080): the layout is stacked and the sticky DPS bar stays visible while scrolling to the gallery's end.
- [ ] 5. The gallery spans the stats rail and stage columns; the results rail spans the full height; the compare drawer never covers the results rail.
- [ ] 6. Only the scroll containers listed in section 2 exist, none nested; the window never scrolls.
- [ ] 7. Slot cards keep a 2:1 ratio at every breakpoint; gallery cards keep 1:1.36.

Slots and capacity
- [ ] 8. A filled slot shows the compact card image, a rarity frame, a drain plate with the polarity glyph, rank pips, and an "n/max" caption.
- [ ] 9. Serration at rank 10 shows drain 7 in a Madurai slot (green, solid outline, down arrow), 18 in a Naramon slot (red, dashed outline, up arrow), and 14 in an unpolarised slot (white).
- [ ] 10. The capacity meter shows the correct total for a full build; turning the Catalyst off halves the capacity; over capacity shows the danger colour, the icon and "N over capacity".
- [ ] 11. Lex Prime's innate polarities appear on slot 8 (Madurai) and the Exilus slot (Naramon), per 4.3; changing a slot polarity via the menu is undoable and updates the drain and the Forma count.
- [ ] 12. Hover or focus on a slot reveals rank −/+, find best and remove; all are reachable by keyboard and named.
- [ ] 13. +/−/Home/End/Del work on the focused slot; Narrator reads "Slot 3, Madurai slot: Serration, rank 10 of 10, drain 7, matches polarity".
- [ ] 14. The empty, Exilus and Arcane slot states match 4.6; selecting the Exilus slot scopes the gallery to Exilus mods; selecting the arcane slot switches to the Arcanes tab.
- [ ] 15. The arcane slot shows the arcane image, name, rank pips (0-5) and the stacks badge; changing the stacks or rank re-simulates.
- [ ] 16. With `core/images` absent, every slot and card renders as a text card with no broken-image icons and no layout shift.

Gallery and search
- [ ] 17. The gallery is always visible (there is no modal picker); `mod-picker` doesn't exist in the DOM.
- [ ] 18. Cards are full card images, lazy-loaded; with 400 mods, fewer than 60 card elements are in the DOM at 1440x900.
- [ ] 19. Clicking a card equips it into the selected slot; with no selection, into the first empty slot; selection then advances; with all slots full and none selected, a toast explains.
- [ ] 20. Blocked cards are dimmed, focusable, `aria-disabled`, and show the reason on a readable plate; activating them only announces the reason.
- [ ] 21. Equipped cards show "Slot N"; "Hide equipped" removes them.
- [ ] 22. `cc` finds the critical chance mods; `ms` multishot; `viral` shows cold and toxin mods with the hint line.
- [ ] 23. `drain<=6`, `pol:v`, `r:rare`, `is:exilus` and `-primed` each filter correctly and turn into dismissible tags.
- [ ] 24. `seration` gives "Did you mean Serration?" and the link fixes the query.
- [ ] 25. The result count updates live and is announced once after typing stops.
- [ ] 26. Sort by Name, Drain and Rarity works; DPS gain is disabled until a sweep exists for the selected slot.
- [ ] 27. Effect, Polarity and Rarity menus and the Fits and Hide-equipped toggles combine with the text query.
- [ ] 28. Arrow keys, Home/End, Ctrl+Home/End and PageUp/PageDown move across the grid; Up from the first row returns to search; typing jumps to search.
- [ ] 29. The details flyout opens on hover (400 ms) and on keyboard focus (600 ms) or Alt+Enter, shows per-rank drain and effects, and closes with Esc without moving focus.
- [ ] 30. Clicking a stat in the stats rail fills the search with its token and switches to Mods.
- [ ] 31. The Arcanes tab lists only arcanes that fit the weapon type (with Fits on); equipping one fills the arcane slot.
- [ ] 32. Best mod: the tab appears on start with progress and Cancel; cards are sorted by gain with badges; clicking equips into the swept slot; the stale warning appears after an edit.

Drag and drop
- [ ] 33. Dragging a gallery card shows the compact card as the drag image; slots glow green or red by polarity, with the projected drain; refusing slots show the reason.
- [ ] 34. Dropping on an empty slot equips; on a filled slot replaces; slot to slot swaps; a slot dragged to the remove zone is removed with an Undo toast.
- [ ] 35. Pick-up mode: Space, arrows, Enter equips; Delete removes; Esc cancels; each step is announced.
- [ ] 36. Every drop is one Ctrl+Z step.

OCR import
- [ ] 37. The toolbar split button, Ctrl+V of an image, dropping an image file, and "Read from game window" all open the import dialog.
- [ ] 38. A progress state with steps and Cancel shows within 100 ms of starting.
- [ ] 39. The review shows the screenshot with numbered boxes whose border style differs by confidence band, and a list with an image, name, confidence label, raw text and "Rank assumed max" per item.
- [ ] 40. Hovering or focusing a list item highlights its box.
- [ ] 41. Replace opens a mini gallery search prefilled with the raw text; picking a result updates the item.
- [ ] 42. Low-confidence items aren't applied unless chosen.
- [ ] 43. "Open as new build" creates an unsaved build with the import note; "Apply to current build" is one undo step with a toast.
- [ ] 44. Each error case in 7.5 shows its copy (forced through test hooks); no network request is made during import (verified with the request log).
- [ ] 45. The privacy note is visible in both the progress and review states.

Accessibility and themes
- [ ] 46. axe-core reports zero serious or critical issues for the main screen, the gallery with an active search, the arcanes tab, and the OCR review, in both themes.
- [ ] 47. In forced-colors mode, text cards are used everywhere, and match and mismatch are distinguishable without colour.
- [ ] 48. With reduced motion, no fades, lifts or flyout animations occur.
- [ ] 49. All new pointer targets are ≥ 24x24.
- [ ] 50. Overlay text on card art measures ≥ 4.5:1 against the scrim over the brightest sample card.
- [ ] 51. F6 cycles builds → toolbar → stats → stage → gallery → results → compare.

Regression
- [ ] 52. `npm test` passes, including the new search, capacity and target-slot tests; `UF_SMOKE=1` passes using the gallery hooks; the packaged smoke passes with `core/images` present.
- [ ] 53. `git ls-files` in the public repo lists no `.png`, `.webp` or `.svg` game assets and no asset-host URLs outside `core/`.

### 11.1 Scenes to capture (`UF_SCENES`, both themes, 1440x900 unless noted)

> **Superseded** by [declutter-spec.md](declutter-spec.md): the scene list is in spec 8 and `src/renderer/scenes.js`.

1. `01-arsenal-empty`: a new build, no mods, no slot selected, the gallery showing all mods.
2. `02-arsenal-full`: a full build with an arcane, capacity 52/60, a mix of matched and mismatched polarities, results visible.
3. `03-slot-hover`: the action bar on slot 3, with the drain tooltip open.
4. `04-gallery-search`: the query `cc drain<=10` with tags, the count, and Medium cards.
5. `05-gallery-did-you-mean`: the query `seration`.
6. `06-gallery-conflict`: a selected slot, blocked cards with reason plates, and Hide equipped off.
7. `07-mod-flyout`: the details flyout on Primed Cryo Rounds.
8. `08-arcanes-tab`: the Arcanes tab with the arcane slot selected and Primary Merciless equipped.
9. `09-drag-in-progress`: dragging Serration over the slots, with green and red outlines and the projected drain (simulated in scene mode by setting the drag state).
10. `10-keyboard-pickup`: pick-up mode on slot 2 with the announcement text shown in the debug overlay.
11. `11-best-mod-running` and `12-best-mod-results`.
12. `13-ocr-progress`, `14-ocr-review` (a fixture screenshot from `core/` test assets only, or a synthetic one rendered from compact cards at scene time), `15-ocr-error-no-mods`.
13. `16-over-capacity` and `17-text-cards` (images disabled via `UF_NO_CARD_IMAGES=1`).
14. `18-1920x1080-full`, `19-1100x700-full`, `20-stacked-zoom200` (1920x1080 at 200%).
15. `21-forced-colors` (emulated `forced-colors: active`).

## 12. Sources

- Warframe Wiki, "Arsenal": Upgrade screen layout, Capacity, Stats Summary, Config tabs, Arcane slots on the right, Mod Selection at the bottom, search, sort, category tabs, drag from the selection area, Update 36.0 mismatched polarity indicator, Update 37.0 Arsenal reskin with larger grids. https://wiki.warframe.com/w/Arsenal
- Warframe Wiki, "Mod Capacity": the Orokin Catalyst doubles capacity; matching polarity halves drain (rounded up, Serration 14 → 7); a mismatch adds 25% (rounding table); Omni Forma. https://wiki.warframe.com/w/Mod_Capacity
- Warframe Wiki, "Mods": card anatomy, rarity tiers and materials, blue rank pips, drag feedback (matching slots glow green, mismatched red, drain change on hover, the dragged card shrinks but keeps proportions). https://wiki.warframe.com/w/Mods
- Warframe Wiki, "Arcane Enhancement": one arcane per weapon; primary and secondary arcanes rank 0-5. https://wiki.warframe.com/w/Arcane_Enhancement
- Warframe Wiki, "Primary Arcane Adapter": unlocks the single Primary Arcane Slot (Update 30.5, 2021-07-06). https://wiki.warframe.com/w/Primary_Arcane_Adapter
- Warframe Wiki, "Exilus Weapon Adapter": one Exilus slot per weapon, can be polarised with Forma (Update 26.0). https://wiki.warframe.com/w/Exilus_Weapon_Adapter
- Warframe, "Introducing Our 14.5 Mod Update": collapsible equipped mod cards, ranks moved below the mod. https://www.warframe.com/introducing-our-145-mod-update
- Underframe engine input contract (read only, not copied): `BASE_SLOT_CONFIG` (Primary and Secondary: 9 slots, 1 arcane), `DEFAULT_CAPACITY_LIMIT` 60, the slot-polarity index mapping, `getProgenitorCapacityBonus`.
- Local evidence:
  - the current picker scene `scenes-fix2/dark-1440x900/03-picker-search.png` (the user's reference) and `02-full-build-results.png`;
  - card samples: compact 600x300 with the name printed and no drain; full 312x424 with max-rank drain and polarity printed top right, effect, compatibility label and pips; arcane 464x340 with no name.
