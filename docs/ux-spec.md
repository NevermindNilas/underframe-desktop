# Underframe Desktop: Fluent 2 redesign spec

Status: binding spec for the React 19 + Fluent UI React v9 rewrite of `src/renderer`. Reviewers check the build against section 8.

Component names are checked against the published packages: `@fluentui/react-components` 9.74.11, `@fluentui/react-charts` 9.3.29 and `@fluentui/react-icons` 2.0.344 (every component, hook and icon named here is exported by those versions). Tokens such as `colorNeutralBackground1` are the v9 `tokens` names.

## 0. Decisions at a glance

| Topic | Decision |
| --- | --- |
| Library | `@fluentui/react-components` v9 (Fluent 2), `@fluentui/react-icons`, `@fluentui/react-charts` for the health chart. React 19, Vite. |
| Theme | `webLightTheme` / `webDarkTheme` following the system. No custom brand ramp (see 3.4). Small token overrides for Mica layers. |
| Shell | Custom 48 px title bar on Mica, collapsible library pane on the left, workspace layer with an editor column and a results column, a 28 px status bar. |
| Primary metric | Always visible in the results column's **result card**, which never scrolls. Charts and stats sit in tabs directly under it, not below the editor. |
| Mod picker | Modal `Dialog`, master-detail, with search, effect filters and visible conflict reasons. |
| Rank control | Custom horizontal stepper (`role="spinbutton"`) built from v9 `Button`s; `SpinButton` for level and custom pools. |
| Best-mod sweep | Runs in the background; results live in a "Best mod" tab of the results column, and the picker shows the gains. |
| Compare | Bottom `InlineDrawer` with a sortable `DataGrid`, toggled from the build toolbar. |
| Delete | No blocking confirm: delete at once, then a `Toast` with Undo. The only blocking dialog left is "Save changes?" when leaving a dirty build. |
| Undo | Ctrl+Z / Ctrl+Y for build edits, plus Undo actions on destructive toasts. |

## 1. Users and top tasks

**Who:** Warframe players planning gun builds, from newer players copying a featured build to theorycrafters comparing small changes. They open the app next to the game, often on a second monitor, in sessions of 5 to 30 minutes. They know the game's vocabulary (mods, ranks, Steel Path, factions, procs) but not the engine's limits.

**Top tasks, by frequency:**
1. **Tweak loop** (most of the session): change a mod, its rank or the target, then read the change in avg DPS and TTK. This happens dozens of times per session, so it must take one action and the answer must be visible without scrolling.
2. Start a build: pick a weapon (or open a featured or saved build), then fill the slots.
3. Compare: pin a result, change something, pin again, then read the delta.
4. Find the best mod for a slot (sweep), then equip it.
5. Save, rename, duplicate and delete builds; reopen yesterday's build (opened automatically on launch).
6. Read the weapon sheet (crit, status, damage split) to understand *why* the DPS changed.

**Optimise for task 1.** Every layout choice below is judged by: "after I change a mod, can I see the new avg DPS and its delta without moving my eyes off the editor area or scrolling?"

## 2. Information architecture and window layout

### 2.1 Regions

```
+------------------------------------------------------------------------------------+
| [=] [UF] Underframe Desktop  ·  Braton Prime build • Unsaved           [_][□][X]  | title bar 48
+-------------+----------------------------------------------------------------------+
| LIBRARY     |  BUILD TOOLBAR: name · save state · Undo Redo · Save ▾ · ··· · Compare(3)|  56
| (pane)      +-------------------------------------------+--------------------------+
| My builds | |  EDITOR (scrolls)                         |  RESULT CARD (fixed)     |
| Featured    |  Notices (MessageBar)                     |  Avg DPS 5,774 ▲4.2%     |
| [Search]    |  Weapon [Combobox]  Fire mode (Radio)     |  TTK · avg hit · 1st hit |
| [+ New]     |  Mods: 4x2 Card grid + Exilus row         |  vs target · Pin · ⟳ · 30 s|
| list...     |  Target card                              +--------------------------+
| (scrolls)   |  Notes                                    |  Tabs: Charts|Stats|Best |
|             |                                           |  (scrolls)               |
|             +-------------------------------------------+--------------------------+
|             |  COMPARE DRAWER (bottom, optional, DataGrid)                         |
+-------------+----------------------------------------------------------------------+
| Damage engine and game data by Underframe (underframe.site), ...   Data · App · About| status bar 28
+------------------------------------------------------------------------------------+
```

- **Title bar** (Mica, drag region): pane toggle, app icon, app name, current build name and save state.
- **Library pane** (Mica, no fill): saved and featured builds.
- **Workspace layer**: a rounded surface (top-left radius `borderRadiusXLarge`, 1 px `colorNeutralStroke2` stroke) that holds the toolbar, editor, results and compare drawer. This is the WinUI NavigationView content-layer pattern.
- **Status bar** (Mica): credits, data version, app version, links.

### 2.2 Sizes and breakpoints (window width, not screen)

| Width | Library pane | Results column | Mod grid | Gutter |
| --- | --- | --- | --- | --- |
| >= 1680 (e.g. 1920x1080) | inline, 300 px, open | 440 px | 4 columns | 24 px |
| 1280-1679 (e.g. 1440x900) | inline, 264 px, open | 380 px | 4 columns if the editor is >= 680 px wide, else 2 | 24 px |
| 1100-1279 (minimum 1100x700) | overlay (`OverlayDrawer`), closed by default | 360 px | 2 columns | 16 px |

- The editor uses a container query on its own width (not the window width) to choose 4 or 2 slot columns, so a pane toggle reflows it correctly.
- At 1920x1080 the editor is about 1130 px wide: Target and Notes sit side by side under the mods (2-column sub-grid when the editor is >= 1000 px). The editor content has a max width of 1120 px and is left-aligned, so lines stay readable.
- At 1440x900 the result card, the Charts tab with the full health chart, and all 8 slots are visible together without scrolling (verified as an acceptance item).
- At 1100x700 the workspace is 624 px tall under the title and status bars. The result card (about 190 px) stays visible; the editor and the tab area each scroll.
- The window minimum stays 1100x700. Below 1100 CSS px (only reachable by zooming in, e.g. 200% on 1920x1080) the columns stack in one scroll area: result card, then the editor, then the result tabs (section 6, reflow).
- Under 800 px of window height the compare drawer sits under the editor column only, so it never squeezes the results column.

### 2.3 Scrolling rules (no scroll traps)

- Exactly these scroll containers exist: library list, editor column, results tab panel, compare grid body, mod picker list, mod picker detail. They are **siblings, never nested**. The window itself never scrolls.
- The result card, build toolbar, title bar and status bar never scroll.
- No element inside a scroll container may capture the wheel (charts, `SpinButton`s and `Combobox`es don't react to the wheel unless focused).
- The library list uses `overscroll-behavior: contain`. Each scroll container is keyboard-scrollable (it is focusable when nothing inside it is) and has an accessible name.

### 2.4 Visual hierarchy

1. Avg DPS value (`LargeTitle` 40/52, Segoe UI Variable Display, tabular numerals), the only element of that size.
2. Build name (`Subtitle1` 20/26) and the delta badge.
3. Section headings (`Subtitle2` 16/22): Mods, Target, Notes, tab headers.
4. Body (`Body1` 14/20) for controls; `Caption1` (12/16) for metadata, hints and units.

There is one primary (accent) button per region at most: Save in the toolbar, Equip in the picker, the confirming action in dialogs. Everything else is `secondary`, `subtle` or `transparent`.

## 3. Windows 11 integration

### 3.1 Window and Mica

- `BrowserWindow` options: `titleBarStyle: 'hidden'`, `titleBarOverlay: { color: '#00000000', symbolColor, height: 48 }`, `minWidth: 1100`, `minHeight: 700`.
- **Mica**: if `process.platform === 'win32'` and the OS build is >= 22621 (Windows 11 22H2, read from `os.release()`), and high contrast is off, set `backgroundMaterial: 'mica'` and `backgroundColor: '#00000000'`. The renderer gets `uf.appInfo().backdrop === 'mica'` and sets `data-backdrop="mica"` on `<html>`, which makes `html`, `body`, the title bar, library pane and status bar transparent.
- **Fallback** (Windows 10, older 11 builds, high contrast, env `UF_NO_MICA=1` for testing, or if Mica fails): no `backgroundMaterial`; `backgroundColor` and the shell background are solid: light `#F3F3F3`, dark `#202020` (the WinUI solid base colors). `data-backdrop="solid"`. The layout is otherwise identical.
- Windows already shows an opaque fallback when the window is inactive or "Transparency effects" is off; we do nothing extra.
- Layer tokens (set as CSS variables on the `FluentProvider` root):

| Variable | Light, Mica | Dark, Mica | Light, solid | Dark, solid |
| --- | --- | --- | --- | --- |
| `--uf-layer` (workspace) | `rgba(255,255,255,0.5)` | `rgba(58,58,58,0.3)` | `#F9F9F9` | `#272727` |
| `colorNeutralCardBackground` override (cards) | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.05)` | `#FFFFFF` | `#2B2B2B` |

  Popovers, menus, dialogs and toasts keep their opaque v9 surfaces.
- Keep `show: false` + `ready-to-show`, so no white flash before the first paint.

### 3.2 Title bar

- Height 48 px (WinUI tall title bar, needed because it contains the pane toggle). Contents from left: `Hamburger` (16 px from the edge, toggles the library pane, tooltip "Show builds (Ctrl+B)" / "Hide builds (Ctrl+B)"), app icon 16 px, "Underframe Desktop" in `Caption1`, a separator dot, then the build name and save state in `Caption1` (for example "Braton Prime build • Unsaved changes"), truncated with an ellipsis.
- No global search in v1: the weapon `Combobox` and the mod picker are the search surfaces, and a second search box would duplicate them. The title bar has no other interactive controls.
- Drag: the bar has `app-region: drag` (and `-webkit-app-region: drag`); the `Hamburger` has `no-drag`. The right side reserves `env(titlebar-area-width)`-derived space so content never sits under the caption buttons; text truncates before the overlay.
- Native caption buttons with theme-matched glyphs. `symbolColor` is light `#242424`, dark `#FFFFFF` (`colorNeutralForeground1`), and in high contrast `systemPreferences.getColor('window-text')`. Main listens to `nativeTheme.on('updated')` and calls `win.setTitleBarOverlay({ color, symbolColor, height: 48 })`. `symbolColor` is a supported key on Windows even though the method docs list only color and height; the acceptance test is visual.
- Inactive window: title text uses `colorNeutralForegroundDisabled` while `window` is blurred (Windows convention).
- `document.title` = `"<build name> - Underframe Desktop"` (taskbar and Alt+Tab), with "•" before the name when there are unsaved changes.
- Double-clicking the drag area maximizes (native behaviour, must not be broken by a `no-drag` region that is too large).

### 3.3 Typography

- Override `fontFamilyBase` to `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`. For text >= 20 px (`Subtitle1` and up) use `"Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", sans-serif` via a `makeStyles` class. `fontFamilyNumeric` is the same stack with `font-variant-numeric: tabular-nums` on every number that updates live (KPIs, stats, grid numbers), so digits don't jitter.
- Use only the v9 type ramp components and tokens: `LargeTitle` (KPI), `Subtitle1`, `Subtitle2`, `Body1`, `Body1Strong`, `Caption1`, `Caption1Strong`. No custom font sizes. Minimum text size is 12 px.

### 3.4 Theme and colour

- `FluentProvider` theme = `webDarkTheme` when `matchMedia('(prefers-color-scheme: dark)')` matches, else `webLightTheme`; switch live on `change`, with no reload. Electron's `nativeTheme.themeSource` stays `'system'`.
- **No custom brand colour.** The default Fluent brand ramp (communication blue) is used as is because (a) the app has no brand of its own, and borrowing Underframe's look would suggest it is the official site; (b) the default ramp is pre-validated for AA contrast in both themes, whereas generating a ramp with `createLightTheme`/`createDarkTheme` from one colour (or from the Windows accent) needs manual contrast checks on 16 shades; (c) a neutral blue is the least likely accent to be read as a damage type. The theme is built in one module (`theme.js`), so a brand ramp can be swapped in later.
- Data colours are separate from the brand and always come with text labels:
  - Pools: Health `colorPaletteRedBorderActive`, Shields `colorPaletteBlueBorderActive`, Armor `colorPaletteMarigoldBorderActive`, Overguard `colorPaletteGrapeBorderActive`. The same mapping is used in the target tiles, the chart lines and the legend.
  - Damage types keep the current `--dt-*` hues, re-tuned per theme to >= 3:1 against the card background (WCAG 1.4.11).
  - Gains and losses: `colorStatusSuccessForeground1` / `colorStatusDangerForeground1`, always with `ArrowUpRegular` / `ArrowDownRegular` and a sign.
- **High contrast**: Electron reports `nativeTheme.shouldUseHighContrastColors` and Chromium enables `forced-colors: active`. Then: Mica is off (solid backdrop); v9 components use their built-in forced-colors styles; custom visuals (slot accents, bars, chart lines, pool tiles) get `@media (forced-colors: active)` rules that use `CanvasText`, `Highlight` and `GrayText` and add borders where we rely on fills; chart series also differ by dash pattern (Health solid, Shields dashed, Overguard dotted). Rarity accent bars are hidden (they are decorative). Tested with the "Night sky" and "Desert" contrast themes.

## 4. Screen-by-screen

Every area defines four states: **Empty**, **Loading**, **Error** and **Disabled**. "n/a" means the state can't happen.

### 4.1 App shell and boot

- The title bar renders immediately, before data loads, so the window can be moved and closed.
- **Loading**: the full layout is shown as `Skeleton`/`SkeletonItem` placeholders (library rows, 9 slot cards, result card). A `ProgressBar` (thickness medium) spans the top of the workspace: determinate while `data.json` downloads with a known content length, indeterminate otherwise. Under it, a `Caption1` status line ("Loading game data… 12.3 MB of 41.0 MB", "Starting the damage engine…", "Reading your builds…") sits in an `aria-live="polite"` region. There is no full-screen spinner card.
- **Error (boot)**: the workspace shows a centred empty state: `ErrorCircleRegular` 48 px, `Subtitle1` "Underframe Desktop couldn't start", a `Body1` explanation ("The game data or the damage engine failed to load."), and a `MessageBar intent="error"` with the technical message. Actions: `Button appearance="primary"` "Try again" (reload), `Button` "Copy details" (clipboard), and a `Link` "Get help on Discord". If it keeps failing, add the hint "Reinstalling the app usually fixes this."
- **Upstream data outdated**: in the status bar, an informative `Badge` "Newer data available" with a `Tooltip` "Underframe has newer game data. Update the app to get it." Also, once per data version, a dismissible `MessageBar intent="info"` at the top of the editor ("Newer Underframe data is available. Update the app to get the latest weapons and mods."). Dismissal is remembered in `localStorage` per data version.
- Unexpected runtime errors raise an error `Toast` ("Something went wrong: …") with "Copy details". The app stays usable.

### 4.2 Library pane (My builds and Featured)

Container: `Drawer` with `type="inline"` (>= 1280) or `type="overlay"` (< 1280), `position="start"`, `separator`. It is a single region labelled "Builds" (`role="region"`, F6 stop). Pane open or closed state persists in `localStorage`. The overlay variant closes after a build is opened.

Header (does not scroll): `TabList size="small"` with tabs "My builds" and "Featured" (the selected tab persists). Under it a `SearchBox` (placeholder "Search builds"; it filters the active tab by name, weapon and tags). On My builds, a full-width `Button` with `AddRegular` "New build" (tooltip "New build (Ctrl+N)").

**My builds list**: `List navigationMode="items"`, sorted by last saved (a `Menu` button in the header, "Sort: Recent / Name / Avg DPS", persisted). Each `ListItem`:
- Line 1: build name (`Body1Strong`, one line, ellipsis, full name in a `Tooltip`).
- Line 2: `Caption1` "Braton Prime · 5.8k DPS · 2 h ago" (DPS is the saved `lastResult`; omit it if there is none).
- The current build is selected (`aria-current="true"`, `colorNeutralBackground1Selected`, 3 px brand indicator bar). When it has unsaved changes, add a `CircleSmallFilled` dot labelled "Unsaved changes".
- A trailing `Menu` trigger (`MoreHorizontalRegular`, `appearance="subtle"`, label "More options for <name>"), visible on hover and focus and always visible on the current item. Menu items: Open, Rename (F2), Duplicate (Ctrl+D), Delete (Del). The same `Menu` opens on right-click (`openOnContext`) and on Shift+F10.
- Enter or click opens the build. Rename is **inline**: the name becomes an `Input`; Enter commits, Esc cancels, an empty name is rejected with an inline `Field` error "Enter a name".
- Delete: removes immediately, focus moves to the next item (else the previous item, else "New build"), and an `intent="success"` Toast "Deleted "<name>"" appears with an **Undo** action (timeout 8 s, `pauseOnHover`, `pauseOnWindowBlur`). Undo re-saves the same object with the same id (the store accepts a known id) and refocuses it. If the deleted build is open, the editor keeps it as an unsaved copy and the toast says so.

**Featured list** (guns only, from `data.trusted_builds`): a `TabList size="small"` filter "All / Primary / Secondary" next to the search. Items show name (2 lines max), `Caption1` "MK1-Braton · Primary", and tags as `Tag size="extra-small" appearance="outline"` in a read-only `TagGroup`. One line of intro text above the list: "Builds curated on Underframe. Opening one makes an unsaved copy you can change."

| State | My builds | Featured |
| --- | --- | --- |
| Empty | `LibraryRegular` icon, "No saved builds yet", "Pick a weapon and mods, then save with Ctrl+S.", `Button` "Browse featured builds" (switches the tab) | "No featured gun builds in this data version." |
| No search match | "No builds match "<q>"." + `Link` "Clear search" | same |
| Loading | 6 `SkeletonItem` rows | 6 rows |
| Error | `MessageBar intent="error"` "Couldn't read your saved builds." + action "Try again". If a corrupt file was backed up: `intent="warning"` "Some saved builds were damaged and moved to a backup file." | n/a (data loaded at boot) |
| Disabled | Menu items Duplicate/Delete are disabled while a save of that build is in flight (`disabledFocusable`, tooltip "Saving…") | n/a |

### 4.3 Build toolbar (top of the workspace)

`Toolbar` (`aria-label="Build"`), single row, 56 px:
- **Build name**: `Input appearance="underline"` styled as `Subtitle1`, with label "Build name" (visually hidden), `maxLength` 120. An empty name saves as "Untitled build".
- **Save state** (`Caption1`, `role="status"`): "Saved" with `CheckmarkRegular`; "Unsaved changes" with a dot; "Not saved yet" (new build); "Saving…" with a tiny `Spinner`.
- `ToolbarButton`s `ArrowUndoRegular` / `ArrowRedoRegular`, with tooltips "Undo (Ctrl+Z)" and "Redo (Ctrl+Y)". They are disabled when their history is empty.
- **Save**: `SplitButton appearance="primary"`, main action "Save" (Ctrl+S), menu: "Save as copy" (Ctrl+Shift+S). When the build is saved and clean, Save is `disabledFocusable` with the tooltip "No changes to save".
- `Menu` "More" (`MoreHorizontalRegular`): New build (Ctrl+N), Duplicate, Rename (F2, focuses the name input), Delete build (same undo flow as 4.2), Keyboard shortcuts (Ctrl+/), About.
- Right end: **Compare** `ToolbarToggleButton` (`PanelBottomRegular`) with a `CounterBadge` showing the pin count (hidden at 0). Tooltip "Compare pinned results (Ctrl+J)".

**Notices** (under the toolbar, inside the editor scroll area, top): build-open warnings from `normalizeBuild` and the featured-build note use a `MessageBarGroup` of `MessageBar intent="warning"` or `"info"` with a dismiss action. Multi-item notices use a bulleted list in `MessageBarBody`.

**Leaving a dirty build** (open another, New build, open featured): `Dialog modalType="alert"`, title `Save changes to "<name>"?`, body "Your changes will be lost if you don't save them.", actions **Save** (primary), **Don't save**, **Cancel** (Windows convention). Esc = Cancel. On close, focus returns to the item that triggered it.

### 4.4 Weapon and fire mode

- **Weapon**: `Field label="Weapon"` + `Combobox` with `OptionGroup label="Primary"` and `OptionGroup label="Secondary"`. Each `Option` shows the name and the subtype (`Caption1`, e.g. "Rifle"), and `text` = name. Filtering uses `useComboboxFilter` on name and subtype, with "No weapons match "<q>"" as the no-options message. Typing filters; Enter selects; Esc restores the current weapon. Selecting the current weapon is a no-op.
- Changing weapon drops incompatible mods (existing `changeWeapon`). The change is immediate and an `intent="warning"` Toast says "Switched to Soma Prime. Removed 2 mods that don't fit: Hornet Strike, Lethal Torrent." with **Undo** (restores the previous build state through the undo stack). Never a blocking confirm.
- **Fire mode**: `Field label="Fire mode"` + `RadioGroup layout="horizontal"` (arrow keys move and select, as native radios do). With one mode only, show plain text "Normal Attack (the only mode)" instead of a single radio. With more than 4 modes, use a `Dropdown` instead.

| State | Behaviour |
| --- | --- |
| Empty | n/a: a build always has a weapon (default Braton Prime) |
| Loading | `Skeleton` during boot only |
| Error | A saved weapon missing from the data → notice "Burston is not available; switched to Braton Prime." |
| Disabled | Weapon and mode stay enabled during a sweep; changing the weapon cancels a running sweep, and the toast says so |

### 4.5 Mod slots

Grid of 8 `Card`s (4x2 or 2x4, see 2.2) plus a full-width Exilus row. Each slot is a `Card size="small" appearance="filled"` with a 3 px left accent in the rarity colour (decorative, `aria-hidden`).

**Filled slot**:
- `CardHeader`: header = the mod name as a `Button appearance="transparent"` (`Body1Strong`, ellipsis, opens the picker, accessible name "Slot 1: Serration, rank 10 of 10. Change mod"); description = `Caption1` "Slot 1" + polarity glyph (with `aria-label` "Madurai polarity") + base drain; action = `Menu` (`MoreHorizontalRegular`) with: Change mod… (Enter), Find a better mod (runs the sweep for this slot), Remove (Del).
- **Effect line** (recognition over recall): `Caption1`, at most 2 lines, the mod's stats **at the current rank** (e.g. "+165% damage"), built from `statValue()` + `friendlyStat()`, falling back to the data description. Full text in a `Tooltip`.
- **Honesty badges**: "Partially simulated" (`Badge appearance="tint" color="warning"`, `WarningRegular`) and "Engine-only" (`Badge appearance="tint" color="informative"`, `InfoRegular`). Each badge sits in a focusable trigger that opens a `Popover`: "Not modelled: Recoil, Zoom. Results for this build may be off." / "This mod has no numeric stats in the data. Its effect counts only if the Underframe engine models it itself."
- **Footer**: the rank stepper (4.6) and a visible remove `Button appearance="subtle" icon={<DismissRegular/>}` (label "Remove Serration", tooltip "Remove (Del)").

**Empty slot**: the whole card is one `Button appearance="subtle"` with a dashed `colorNeutralStroke1` border, showing `AddRegular` "Add mod" and `Caption1` "Slot 5" (accessible name "Slot 5: add a mod"). A secondary `Button appearance="transparent" size="small"` with `SparkleRegular` shows tooltip and label "Find best mod for slot 5".

**Exilus row**: same card, labelled "Exilus", with an `InfoLabel` "Only Exilus mods fit here."

**Section header**: `Subtitle2` "Mods" + `Caption1` "8 of 9 slots used". There is no capacity or drain total (not modelled, and showing one would imply it is).

| State | Behaviour |
| --- | --- |
| Empty | Empty-slot card as above. With all 9 slots empty, the header hint reads "Add mods to see how they change your DPS." |
| Loading | `Skeleton` card shapes during boot |
| Error | A dropped mod on open → build notice (4.3). An equip failure (conflict, wrong slot) can't happen from the UI because the picker blocks it; any API-level failure shows a warning Toast with the reason. |
| Disabled | During a sweep on slot N, that slot shows "Finding best mod…" with a small `ProgressBar` and is not clickable (`disabledFocusable`, tooltip "A best-mod search is running for this slot"). Other slots stay editable. Every slot's "Find best mod" is `disabledFocusable` with the tooltip "A best-mod search is already running". |

Keyboard on a slot's primary button: Enter opens the picker, Del removes, `+`/`-` change rank. Ctrl+1…Ctrl+8 open the picker for slots 1-8, Ctrl+9 for Exilus. After an equip, focus goes to that slot's name button; after a remove, to that slot's "Add mod" button.

### 4.6 Rank control

The Fluent `SpinButton` stacks two half-height arrows (below the 24x24 target size for a control used dozens of times per session), so rank uses a **horizontal stepper**:
- `[−] R5/5 [+]`: two `Button size="small" appearance="subtle"` (`SubtractRegular`, `AddRegular`, hit area 28x28) around a value element with `role="spinbutton"`, `aria-valuemin`/`aria-valuemax`/`aria-valuenow`, `aria-valuetext="rank 5 of 5"` and `aria-label="Serration rank"`.
- The value element is the single Tab stop; the buttons are `tabIndex=-1` (mouse targets). Keys: Up/Right +1, Down/Left −1, Home 0, End max, PageUp/PageDown ±3.
- At a limit, that button is disabled. Max rank shows `Caption1` "max" next to the value. Ranks default to max on equip.
- Each step recomputes (debounced, 5.1). Holding a button doesn't auto-repeat.

`SpinButton` (medium) is used for **Level** (1-9999, step 1, stepPage 10) and **custom pools** (Health >= 1, others >= 0, stepPage 1000), where typing is the main input.

### 4.7 Mod picker

**Choice: modal `Dialog`**, not `OverlayDrawer`. Picking a mod is a short, focused choice with a clear commit (Equip) and cancel (Esc). It needs a wide surface for a list *and* a detail pane, and it is launched from 9 places across the editor, so a centred surface is spatially neutral. An end-side drawer would cover the result card anyway (no gain in context) and is narrower. The build context the user needs inside the picker (what is equipped and what conflicts) is shown on each list item.

Layout: `DialogSurface` width `min(1040px, 92vw)`, height `min(760px, 88vh)`.
- `DialogTitle` "Choose a mod for slot 5" (Exilus: "Choose an Exilus mod"), with a close action (`DismissRegular`, "Close").
- Filter row (fixed): `SearchBox` (autofocused, placeholder "Search by name or effect, like crit or toxin"), then a `Toolbar` with a `ToolbarRadioGroup` of effect filters as `ToolbarRadioButton`s: All, Damage, Critical, Status, Multishot, Elemental, Fire rate, Faction, Utility (categories come from a new pure `modEffectCategories(mod)` in `src/shared/mods.js`, unit-tested). A `Dropdown` "Sort": Best match (default) / Name / DPS gain (enabled only when a sweep result exists for this slot and build; otherwise `disabledFocusable` with the tooltip "Run Find best mod to sort by DPS gain").
- **List** (left, flexible, scrolls): `List navigationMode="items"` with sections. With no query or filter: "Common picks", then "All compatible mods". Otherwise one flat list. Each item shows:
  - name (`Body1Strong`), effect at max rank (`Caption1`, 1 line), polarity glyph + drain at the trailing edge;
  - badges: "Equipped" (current mod of this slot), "Partially simulated", "Engine-only", and the DPS gain badge ("+12.4%") when sweep data exists;
  - blocked mods stay **focusable** with `aria-disabled="true"`. They show the reason visibly with `ProhibitedRegular`: "Already in slot 2" or "Conflicts with Serration". Their name uses `colorNeutralForeground3`, not the disabled colour, so the reason stays readable. Blocked items sort to the end of each section.
- **Detail** (right, 360 px, scrolls): name (`Subtitle2`), "Rare · Madurai · drain 4", the full description, a small stat table (rank 0 and max), honesty notes, the conflict reason, and the sweep result if any ("+12.4% DPS in this slot · best-mod search, 3 runs"). Footer: rank stepper (default max) + **Equip** (`appearance="primary"`, disabled with the reason for blocked mods). The detail follows the focused or hovered item. Below a 760 px dialog width the detail pane is hidden, and Enter equips at max rank.
- `DialogActions`: on the left, `Caption1` "Mods that conflict with your equipped mods can't be selected."; on the right, "Find best mod" (secondary; starts the sweep, closes the dialog, selects the Best mod tab), "Remove <mod>" when the slot is filled, and "Cancel".
- **Keyboard flow**: on open, focus is in the search. Down → first list item. Up on the first item → search. Up/Down/Home/End move in the list. Enter equips the focused item (or Equip in the detail). Typing a printable character in the list sends it to the search. Esc closes (one press, consistent with every dialog). Enter in the search equips the first *equippable* result. After an equip, the dialog closes, focus goes to the slot card, and the result card shows "Updating…".

| State | Behaviour |
| --- | --- |
| Empty | No query: "No compatible mods for this slot." With a query: `No mods match "<q>".` + `Button` "Clear search" (and "Show all effects" when a filter is active) |
| Loading | n/a (data is in memory). The list renders in < 100 ms, virtualised only if it measures slower |
| Error | n/a, except an equip rejection, which shows an inline `MessageBar intent="warning"` in the detail pane |
| Disabled | Blocked mods (above). "Find best mod" is `disabledFocusable` while another sweep runs ("A best-mod search is already running") |

### 4.8 Target

A `Card` with the header "Target" and a summary `Caption1` in the header ("Elite Crewman · Level 145 · Corpus · Steel Path"), placed after the mods in the editor. The result card repeats the summary with a "Change" `Link` that scrolls the target card into view and focuses Enemy.

- **Enemy**: `Combobox` with an `OptionGroup` per faction (plus a first group "Custom target" with one option "Custom"). Options show the name and `Caption1` "Default level 145". `useComboboxFilter`.
- **Level**: `SpinButton` (4.6). An invalid value shows the `Field` error "Enter a level from 1 to 9999" and the sim keeps the last valid level. Disabled for Custom (the hint says "Custom targets use the stats you enter").
- **Faction**: `Dropdown`, with the hint "Sets which faction (bane) mods apply." Defaults to the enemy's faction.
- **Steel Path**: `Switch`, label "Steel Path", hint built from `STEEL_PATH_MULTIPLIER` ("2.5× health and shields"). The current "+250%" tooltip is wrong for a 2.5× multiplier; never hard-code it. Disabled for Custom.
- **Headshots**: `Switch`, label "Headshots", hint "Every shot hits the head."
- **Enemy stats** (progressive disclosure): an `Accordion collapsible` item "Enemy stats", collapsed by default. Its header shows the summary "22,815 health · 13,256 shields · 0 armor". Expanded, it shows 4 tiles (label, value, 3 px top border in the pool colour). For **Custom** the item auto-expands and the tiles become `SpinButton`s with labels.

| State | Behaviour |
| --- | --- |
| Empty | n/a (always a default target) |
| Loading | `Skeleton` at boot |
| Error | Missing saved preset → notice "Target X is not available; using the default target." |
| Disabled | Level and Steel Path for Custom, as above |

### 4.9 Result card (always visible)

Top of the results column. A `Card` that never scrolls:

```
Average DPS                         [⚠ Partially simulated]  (i)
5,774   ▲ 4.2%
5,564–6,273 across 8 runs · 30 s each
Time to kill 6.26 s   Average hit 270   First hit 265
vs Elite Crewman · L145 · Corpus  Change
[Pin to compare]  [⟳]  [30 s ▾]
```

- Value: `LargeTitle`, `data-testid="avg-dps"`. Delta: `Badge appearance="tint"` with success or danger colour, an arrow icon and a signed percent, compared with the **previous completed result in this session**. Tooltip "Previous result: 5,540 DPS". Hidden when there is no previous result or the change is < 0.05%.
- Secondary metrics: label `Caption1`, value `Subtitle2` (TTK has `data-testid="ttk"`). "Not killed in 30 s" when the target survives.
- `InfoLabel` (i) "What's simulated": "Seeded runs of Underframe's engine: crits, status, armor, shields and overguard. Not yet: arcanes, rivens, conditional mods, incarnon bonuses, melee."
- Actions: `Button` with `PinRegular` "Pin to compare" (Ctrl+P), a `Button appearance="subtle"` `ArrowClockwiseRegular` (tooltip "Run again (Ctrl+Enter)"), and a `Dropdown` "Simulated time" with 10 s / 30 s / 60 s (visible label in the tooltip and `aria-label`).
- Pin gives a Toast "Pinned "<name>" to compare." with action "Open compare". At 20 pins the oldest is dropped and the toast says "Compare holds 20 results; removed the oldest."

| State | Behaviour |
| --- | --- |
| First load | `SkeletonItem` lines in place of the numbers. No spinner. |
| Updating | Keep the last numbers at full opacity. After 150 ms of pending or running, show a 2 px indeterminate `ProgressBar` on the card's top edge and replace the "across 8 runs" line with "Updating…". `aria-busy="true"`. No fade, no count-up animation, no layout shift (fixed-height rows). |
| Error (current build) | Numbers become "—". `MessageBar intent="error"` "Couldn't simulate this build." + the engine message + action "Try again". `Caption1`: "Last result 5,774 DPS was for an earlier version of this build." |
| Partial runs | `Caption1` warning "7 of 8 runs failed and were left out." with `WarningRegular` |
| Disabled | Pin is `disabledFocusable` while updating or after an error (tooltip "Wait for the result to finish updating" / "Fix the simulation error first"). Run again is never disabled. |

### 4.10 Results tabs: Charts, Stats, Best mod

`TabList` under the result card: **Charts** | **Stats** | **Best mod** (the Best mod tab appears only when a sweep exists; while running it shows "Best mod 12/85"). The selected tab persists. The panel below is the column's only scroll container.

**Charts**
- "Enemy health over time": `LineChart` from `@fluentui/react-charts`, `lineOptions.curve: 'stepAfter'`, one series per pool that has values (Health, Shields, Overguard; colours from 3.4), x in seconds, y compact ("25k"), height 200 px (160 px below 800 px window height). Header: `Subtitle2` + `Caption1` "Killed at 5.95 s" or "Survived 30 s". The legend is the built-in one. Tooltips use the chart callout. The chart's `aria-label` is the existing text summary.
- A `ToggleButton size="small"` with `TableRegular` "Show as table" switches to a `Table` of samples every 0.5 s (time, health, shields, overguard). It is the keyboard and screen-reader alternative.
- "Damage by hit type": a token-styled bar list (no chart library). Each `li` shows label, a decorative bar (damage-type colour, `aria-hidden`), and a percent + compact value. Rows sort by share.
- If `@fluentui/react-charts` can't run under the page CSP or the bundle budget, fall back to the existing `charts-data.js` SVG path drawn with the same tokens. The visual spec stays the same.
- States: **Loading** → previous chart stays, with a header `Spinner size="extra-tiny"` "Updating chart…". **Error** → `MessageBar intent="warning"` "Charts unavailable: <reason>." The KPIs are still valid. **Empty** → "No hits recorded."

**Stats** (weapon sheet for the selected fire mode)
- Header: `Subtitle2` "Weapon stats" + `Caption1` mode name.
- "Damage per projectile" total, then per-type rows in the fixed type order (swatch, name, decorative bar, value).
- A `dl` of rows: Crit chance, Crit multiplier, Status chance (per projectile), Multishot, Fire rate, Magazine, Reload, Faction bonus. Each shows the modded value (`Body1Strong`) and the base value (`Caption1` "Base 12%"). A changed value gets an up or down arrow.
- Footnote: "Sheet values before enemy armor and resistances. The simulation accounts for those."
- **Empty**: "No damage data for this fire mode." **Error**: n/a (pure computation; on exception show "Couldn't compute stats for this mode.").

**Best mod** (sweep)
- Header: `Subtitle2` "Best mod for slot 5"; a close button (`DismissRegular`, "Close results") when not running.
- Running: `ProgressBar` (determinate, `value=done/total`) labelled with a `Field` "Testing 12 of 85 mods", and a `Button` "Cancel". Results stream in, ranked.
- Results: a `Table` (rank #, mod, rank, DPS gain, DPS, action) of the top 10. Gain uses the delta badge style. The action is `Button size="small"` "Equip" (or "Replace" when the slot is filled), disabled with a tooltip when the slot changed ("Slot 5 is no longer empty") or the weapon changed. Focus is preserved by mod name when rows reorder.
- Footnote: "Baseline 5,774 DPS with the slot empty. Each mod tested at max rank over 3 seeded runs."
- **Stale**: `MessageBar intent="warning"` "Your build changed after this search. Gains may be out of date." + "Run again". **Cancelled**: `Caption1` "Cancelled after 12 of 85 mods. Showing partial results." **Error**: `MessageBar intent="error"` + "Try again". **Empty**: "No compatible mods to test for this slot."
- The live recompute keeps priority: the sweep issues one engine call at a time, so a live sim waits for at most one candidate.
- For a filled slot ("Find a better mod"), the baseline is the slot emptied, and the current mod is listed with an "Equipped" badge.

### 4.11 Compare drawer

`InlineDrawer position="bottom"` inside the workspace, height `clamp(200px, 32vh, 360px)`. It opens with the toolbar Compare toggle or Ctrl+J; its open state persists.
- `DrawerHeader` with `DrawerHeaderTitle` "Compare" and actions "Clear all" (with an Undo toast) and close.
- `DataGrid` with `sortable` columns: Build, Changes (what differs from the baseline pin, e.g. "Serration R10→R0, Steel Path on"), Weapon, Mode, Target, Avg DPS, vs baseline, TTK, and an actions column. Below 900 px of grid width, weapon and mode move under the build name. "vs baseline" uses the delta badge style. The baseline is the first pin by default; the row `Menu` offers "Use as baseline" and "Remove". The baseline row shows a `Badge` "Baseline". Numeric columns are right-aligned and use tabular numerals.
- Keyboard: grid navigation (`focusMode="composite"`); Del removes the focused row (with an Undo toast).
- **Empty**: "Pin a result to compare builds, mods or targets side by side." + "Pin current result" (disabled with a reason if there is no current result). **Loading/Error**: n/a (pins come from `localStorage`; invalid pins are dropped by `sanitizePins`). **Disabled**: n/a.

### 4.12 Notes

`Card` "Notes" with an auto-growing `Textarea` (resize vertical, max 10,000 chars, counter shown above 9,000). Featured builds put their description here. It is part of the build snapshot (dirty tracking and undo). **Empty**: placeholder "Add notes about this build, like the rotation or which enemies it's for."

### 4.13 Status bar, About, shortcuts

- **Status bar** (28 px, `Caption1`, Mica): left, the exact credit text "Damage engine and game data by Underframe (underframe.site), used with permission. Not affiliated with Digital Extremes." with `underframe.site` as a `Link` (opens externally). Right, inside `Overflow` so items collapse into a "More" menu at narrow widths: "Data 5919d50 · Oct 24, 2026" (short hash; full hash and fetch time in a `Tooltip`), "App 0.1.0", the outdated `Badge` (4.1), `Link` "Discord", `Button appearance="transparent"` "About". The credit text never truncates; it wraps to 2 lines only below 1100 px.
- **About** `Dialog`: app name and version, Electron/Chrome versions, data version and fetch date, the credits above, "Code licensed AGPL-3.0-only; Underframe engine and data are proprietary and used with permission.", known limits (guns only; no arcanes, rivens, conditional mods, incarnon bonuses), and links. Action: "Close".
- **Keyboard shortcuts** `Dialog` (Ctrl+/ or F1): a two-column `Table` grouped by Build, Mods, Results and Navigation, matching 5.5.

### 4.14 Toasts and dialogs (shared rules)

- One `Toaster` (`position="bottom-end"`, offset above the status bar), max 3 visible, `politeness` "polite" (errors "assertive"). Timeouts: success/info 5 s, warning 8 s, toasts with Undo 8 s, errors stay until dismissed. All have `pauseOnHover` and `pauseOnWindowBlur`. The action button is in `ToastTitle`'s `action` slot.
- Blocking dialogs only for: Save changes? (4.3), About, Shortcuts, Mod picker. There are no confirm dialogs for delete, remove or clear; those use undo.
- Every dialog: initial focus on the first field or the safest primary action; focus returns to the trigger, or to the documented replacement element when the trigger no longer exists.

## 5. Interaction and UX rules

### 5.1 Live recompute

- Every build edit that changes `simKeyOf` schedules a sim 300 ms after the last change (existing debounce). Name and notes edits never re-simulate.
- Ctrl+Enter or the Run again button runs immediately.
- During pending or running, the last result stays fully visible (4.9 Updating). The indicator appears only after 150 ms, so fast sims never flash. Charts update after the debug run without clearing first.
- Results from superseded runs are discarded (existing `simGen`). The delta badge compares with the previous **completed** result, never a superseded one.
- Screen readers: when a result completes and the user hasn't edited for 1 s, announce once (via `useAnnounce`) "Average DPS 5,774, up 4.2 percent". At most one announcement per completed result.

### 5.2 Error prevention and recovery

- Incompatible and conflicting mods can't be equipped; the reason is shown before the attempt (4.7).
- The Exilus slot lists only Exilus mods.
- Numeric fields clamp on blur and show the valid range in the `Field` hint. Invalid input never reaches the engine.
- Destructive actions are undoable instead of confirmed: delete build, remove mod (Ctrl+Z), clear compare, weapon change that drops mods.
- Undo stack: build edits (weapon, mode, mods, ranks, target, duration, name on blur, notes on blur), max 100 steps, reset when another build is opened. Ctrl+Z and Ctrl+Y act on the build only when focus is not in a text field (text fields keep their native undo).
- Leaving a dirty build asks Save / Don't save / Cancel (4.3). Closing the window with a dirty build asks the same: main handles `close`, the renderer answers over IPC, with a 5 s timeout that then closes.
- One sweep at a time; starting another is disabled with the reason given.

### 5.3 Recognition over recall

- Slot cards show the effect at the current rank. Picker items show the effect; the picker detail shows the full description and per-rank values.
- Every icon-only button has a `Tooltip` with its name and shortcut. Weapon options show the subtype; enemy options show the default level and are grouped by faction.
- The target summary repeats in the result card; the build name and state repeat in the title bar.
- Featured builds carry their description into Notes, and unapplied features (arcanes, rivens and so on) are named in a notice.

### 5.4 Consistency

- One component per job: `Combobox` = searchable pick (weapon, enemy); `Dropdown` = short fixed list (faction, duration, sort); `RadioGroup` = visible exclusive choice (fire mode); `Switch` = immediate boolean (Steel Path, headshots); `SpinButton` = typed number; the rank stepper = small bounded integer.
- Delta badges use the same style everywhere (result card, compare, sweep, picker).
- The same terms everywhere: "build", "mod", "slot", "rank", "target", "Average DPS", "Time to kill", "Pin to compare", "Find best mod", "Partially simulated", "Engine-only".
- Spacing uses only v9 spacing tokens (`spacingHorizontalM` 12, `L` 16, `XL` 20, `XXL` 24); radii: controls `borderRadiusMedium`, cards `borderRadiusLarge`, workspace layer `borderRadiusXLarge`.

### 5.5 Keyboard shortcuts (discoverable)

They appear in tooltips ("Save (Ctrl+S)"), in menu items (`MenuItem secondaryContent`), and in the shortcuts dialog. Global shortcuts are inactive while a dialog is open, except inside it.

| Keys | Action |
| --- | --- |
| Ctrl+S / Ctrl+Shift+S | Save / Save as copy |
| Ctrl+N | New build |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo build edit; Ctrl+Z first undoes a delete, unpin or clear whose Undo toast is showing and is newer than the last edit |
| Ctrl+M | Move focus to the notifications (Esc returns) |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset (also in the packaged app) |
| Ctrl+Enter | Run simulation again now |
| Ctrl+P | Pin result to compare |
| Ctrl+J | Show or hide compare |
| Ctrl+B | Show or hide builds pane |
| Ctrl+1…Ctrl+8, Ctrl+9 | Choose a mod for slot 1-8, Exilus |
| F2 | Rename build (toolbar) or the focused library item |
| Del | Remove focused mod / delete focused library build / remove focused pin (all undoable) |
| F6 / Shift+F6 | Next / previous pane: builds → toolbar → editor → results → compare |
| Ctrl+/ or F1 | Keyboard shortcuts |
| Esc | Close dialog, popover, menu or overlay pane |

### 5.6 Keyboard operability and focus

- Everything is reachable by keyboard in a logical order: title bar toggle → library → toolbar → editor (notices, weapon, mode, slots in reading order, target, notes) → result card → tabs → compare.
- Composite widgets use arrow keys with one Tab stop: `TabList`, `RadioGroup`, `List`, `DataGrid`, `Toolbar`, `Menu`. Implement with v9 built-ins or `useArrowNavigationGroup`.
- Focus is visible on everything (v9 `colorStrokeFocus2` double ring, via `createFocusOutlineStyle` on custom elements). Never `outline: none` without a replacement.
- Focus is never lost to `body`: after equip, remove, delete, undo, dialog close and toast actions, focus goes to the documented target (4.2, 4.5, 4.7).
- Re-renders must not steal or drop focus (React keys stable by slot index or build id).

### 5.7 Honest accuracy indicators

- "Partially simulated" on slot cards, in the picker and in the result card (aggregate, with a `Popover` listing the mods and unmodelled stats).
- "Engine-only" on slot cards and in the picker.
- The result card always shows the spread (min-max across runs), the run count, the simulated time and the target.
- Notices name what a featured build had that we drop. Failed runs are reported. Stale sweep results are flagged.
- The "What's simulated" `InfoLabel` lists the v1 limits. Never present a sheet value as simulated, or a sweep estimate as the 8-run result.

### 5.8 Copy guidelines (Fluent voice: warm, crisp, helpful)

- Sentence case everywhere (titles, buttons, tabs, menu items). Game proper nouns keep their case (Steel Path, Exilus, Madurai).
- Buttons start with a verb and say what happens: "Save", "Pin to compare", "Find best mod", "Run again", "Equip", "Try again". Avoid "OK" and "Submit".
- Address the user as "you". No "please", no exclamation marks, no blame ("Couldn't save the build", not "You entered an invalid…").
- Errors give what happened, why if known, and what to do: "Couldn't save the build. The file is in use. Try again in a moment."
- Units: a space before "s" ("6.26 s"), "DPS" in caps, × for multipliers, thousands separators from the system locale, compact numbers (5.8k) only in lists and axes.
- Use contractions ("can't", "isn't"). Truncate with an ellipsis and always show the full text in a `Tooltip`.
- Rewrites from v1: "Pin result" → "Pin to compare"; "Run" → "Run again"; "partially simulated" → "Partially simulated"; "engine-only" → "Engine-only"; "Couldn't start" → "Underframe Desktop couldn't start"; "Steel Path: +250% health and shields" → "2.5× health and shields" (from the constant); "Your own numbers" → "Custom target".

## 6. Accessibility (WCAG 2.2 AA)

- **Contrast**: text >= 4.5:1 (>= 3:1 for >= 18.66 px bold or 24 px), measured on the actual layer, including Mica worst case (light theme over a white wallpaper, dark over black). Don't use `colorNeutralForeground4` or disabled colours for meaningful text. Non-text UI and chart lines and bars >= 3:1 (1.4.11).
- **Colour is never the only cue**: deltas have arrows and signs, pools have labels, chart series have legend labels (plus dash patterns in high contrast), conflicts have text reasons, rarity is decorative.
- **Focus visible** (2.4.7) and **not obscured** (2.4.11): sticky regions (result card, toolbar, compare drawer) must not cover a focused element. Focused elements in the editor scroll into view with `scroll-margin` of 16 px.
- **Target size** (2.5.8): every pointer target is >= 24x24 CSS px. Primary controls use v9 medium size (32 px). The rank stepper buttons are 28x28.
- **Labels** (1.3.1, 2.5.3, 4.1.2): every input in a `Field` with a visible label, or `aria-label` matching the visible text; icon buttons named; regions named (Builds, Build, Editor, Result, Compare); status messages via `role="status"` or `useAnnounce` (4.1.3).
- **Reduced motion** (2.3.3): with `prefers-reduced-motion: reduce`, drawer and dialog motion is instant (v9 motion respects it; check custom transitions), and no chart animation. There are no count-up numbers in any mode.
- **Reflow and zoom**: usable at 200% zoom on a 1920x1080 window (the layout falls back to the 1100-class arrangement); text spacing overrides don't clip.
- **Keyboard** (2.1.1, 2.1.2): no keyboard traps except modal dialogs, which close with Esc.
- **High contrast**: as in 3.4; every control boundary is visible in forced colours.
- **Screen readers**: tested with Narrator in Edge-equivalent Chromium. The mod picker list announces name, effect and reason ("Serration, +165% damage, unavailable, already in slot 1").

## 7. Implementation notes that affect UX

- Keep the logic modules (`model.js`, `sim.js`, `charts-data.js`, `format.js`, `engine-client.js`, `engine.worker.js` served at `/renderer/engine.worker.js` with its own CSP) and `src/shared/*`. New pure helpers (`modEffectSummary(mod, rank)`, `modEffectCategories(mod)`, the undo stack reducer) go in tested modules with `node --test` coverage.
- No remote images or fonts; Segoe UI Variable comes from the OS.
- Preload additions: `appInfo().backdrop` (`'mica' | 'solid'`), and a close-guard IPC pair for 5.2.
- **Smoke mode** keeps working against the real UI and the same report shape. Stable hooks: `data-testid` = `avg-dps`, `ttk`, `slot-<i>` (card), `slot-add-<i>`, `mod-picker` (DialogSurface), `mod-option` (each item, with `aria-disabled` on blocked ones), `library-item` (with `aria-current` on the open build), `featured-item`, `compare-grid`, `result-card`. Smoke screenshots must show the charts without scrolling at 1440x900.

## 8. Acceptance checklist

Shell and Windows integration
- [ ] On Windows 11 22H2+, the title bar, library pane and status bar show Mica (the desktop tint is visible in a screenshot); the workspace layer is visibly a separate translucent surface.
- [ ] With Mica unavailable (forced via env flag `UF_NO_MICA=1`) or high contrast on, the window is solid `#F3F3F3`/`#202020` with no transparent artefacts.
- [ ] No native frame or menu bar; caption buttons are native, 48 px tall, and their glyphs follow light, dark and high-contrast themes live (switching the system theme updates them without restart).
- [ ] The title bar drags the window and double-click maximises; the pane toggle is clickable; no content sits under the caption buttons at 1100 px width.
- [ ] Theme follows the system live; both themes are screenshot-tested.
- [ ] Computed `font-family` of body text starts with "Segoe UI Variable"; the KPI uses tabular numerals.

Layout
- [ ] At 1440x900: the result card, the Charts tab with the health chart, and all 9 slots are visible without scrolling anything.
- [ ] At 1920x1080: library inline at 300 px, results 440 px, 4 slot columns, Target and Notes side by side.
- [ ] At 1100x700: the library is an overlay closed by default, the result card is fully visible, 2 slot columns, the status bar credit text is not truncated, and there is no horizontal scrollbar anywhere.
- [ ] The window never scrolls; the only scroll containers are those listed in 2.3, and none is nested in another.
- [ ] Changing a mod's rank at any window size leaves Average DPS on screen.

Core loop
- [ ] Equipping a mod, changing a rank or changing the target updates Average DPS within debounce + sim time; the old value stays visible meanwhile; "Updating…" never appears for runs under 150 ms; nothing fades or shifts.
- [ ] The delta badge shows the signed % change vs the previous completed result, with an arrow icon.
- [ ] A sim error shows the error MessageBar with "Try again" and does not show stale numbers as current.
- [ ] Ctrl+Z after removing a mod restores it with its rank; Ctrl+Y re-applies.

Mod picker
- [ ] Opens as a modal Dialog with focus in the search; Down/Up/Enter/Esc work as in 4.7; after an equip, focus is on that slot's card.
- [ ] Equipped and conflicting mods are listed, focusable, `aria-disabled`, and show the reason text ("Already in slot 1", "Conflicts with Serration"); Equip is impossible for them.
- [ ] Effect filters and search combine; empty results show the empty state with "Clear search".
- [ ] Each item shows its effect text; "Partially simulated" and "Engine-only" badges appear where `unmodeledStats`/`hasNoStats` say so.

Library and builds
- [ ] Save, Save as copy, inline rename (F2), duplicate and delete work from the toolbar, the item menu, the context menu and the keyboard.
- [ ] Delete has no confirm dialog; the toast's Undo restores the build with the same id and focuses it.
- [ ] Leaving a dirty build (open, new, featured, window close) asks Save / Don't save / Cancel, and each option does what it says.
- [ ] Featured builds filter by search and type, open as unsaved copies, fill Notes with the description and show the unapplied-features notice.
- [ ] The last opened build reopens on launch (not in smoke mode).

Results, sweep, compare
- [ ] Charts tab: step line chart with Health/Shields/Overguard in the pool colours, a kill-time caption, "Show as table" alternative and the damage-by-hit-type list.
- [ ] Stats tab shows all eight stat rows with base values and the footnote.
- [ ] Find best mod shows a determinate ProgressBar with "Testing N of M mods", Cancel works, results stream in ranked, Equip/Replace works, and stale results show the warning.
- [ ] Pin to compare adds a DataGrid row; columns sort; the baseline can be changed; Clear all and row removal are undoable; the 20-pin limit is announced.

States and feedback
- [ ] Boot shows the skeleton layout with a progress line, never a blank window; a forced data failure shows the boot error screen with Try again and Copy details.
- [ ] Every area in section 4 shows its specified empty state (verified with an empty builds file and a build with no mods).
- [ ] Toasts: success/info 5 s, Undo toasts 8 s, errors persistent; at most 3 visible; they pause on hover.
- [ ] The upstream-outdated badge and the one-time MessageBar appear when `checkUpstream` reports outdated.
- [ ] The footer credit text matches 4.13 exactly.

Keyboard and accessibility
- [ ] Every action in this spec can be done without a mouse; Tab order follows 5.6; F6 cycles panes; all shortcuts in 5.5 work and are listed in the shortcuts dialog and the tooltips.
- [ ] No focus is lost to `<body>` after equip, remove, delete, undo, or dialog close (checked with `document.activeElement`).
- [ ] An axe-core scan of the main screen, the picker and each dialog reports zero serious or critical violations in both themes.
- [ ] Contrast spot checks pass for: Caption1 secondary text on the Mica layer (light and dark), delta badges, chart lines vs card background, and the rank stepper.
- [ ] All pointer targets are >= 24x24 px (measure the rank stepper, the slot remove button, toast actions and the status bar links).
- [ ] With Windows high contrast on, all controls, slot cards, bars and chart lines are visible, and series are distinguishable by dash pattern.
- [ ] With reduced motion on, drawers and dialogs appear without animation.
- [ ] Narrator reads the slot name buttons, the rank stepper value ("rank 5 of 5"), conflict reasons and the completed-result announcement.

Regression
- [ ] `npm test` passes, including new tests for `modEffectSummary`, `modEffectCategories` and the undo reducer.
- [ ] `UF_SMOKE=1` passes against the new UI with the `data-testid` hooks in section 7 and produces final, picker and results screenshots, with the results screenshot taken without scrolling.
