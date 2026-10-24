# Underframe Desktop

A Windows desktop app for planning Warframe gun builds and simulating their
damage. It is a friendlier front end for [Underframe](https://www.underframe.site)
and runs Underframe's damage engine locally, used with the Underframe
developer's permission.

## Features

- Build library: save, rename, annotate and reopen builds
- Featured builds to start from
- Mod picker with compatibility and conflict checks
- Target presets with level scaling and Steel Path
- Seeded multi-run simulation (reproducible results)
- Enemy HP-over-time chart
- Compare tray for side-by-side builds
- Best-mod sweep: tries candidate mods in a slot and ranks them

## Requirements

- Node.js 22+ and npm
- Windows to build the installer (`npm run dist`)
- Access to the private `core` submodule to run the engine (see below)

## Getting started

```sh
git clone --recurse-submodules <repo-url>
cd underframe-desktop
npm install
npm start
```

`core/` is a **private** submodule (Underframe's engine and game data). Without
access, the clone succeeds but `core/` stays empty: you can still read and
modify the UI, main process and shared logic, and `npm test` covers pure logic
that does not need the engine, but the app cannot load data or run simulations.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Build the renderer, then run the app in development |
| `npm run build:renderer` | Build the React renderer with Vite into `build/renderer/` |
| `npm test` | Run the test suite (`node --test`) |
| `npm run dist` | Build the renderer, then an NSIS installer and a portable exe into `dist/` |
| `npm run update-core` | Refresh `core/` from underframe.site (maintainers with core access); then commit inside `core/` and bump the submodule pointer here |

## Project structure

```
src/main/      Electron main process, app:// protocol, preload, build storage
src/renderer/  UI: React 19 + Fluent UI React v9 (ui/*.jsx), the app controller and pure
               model modules, the engine Web Worker and its client
src/shared/    Pure logic: damage types, factions, enemy scaling, mods, stats, engine input
build/         Vite output (gitignored); the app serves build/renderer
docs/          UX spec for the Fluent 2 UI
test/          node --test suites
core/          Private submodule: Underframe engine (.wasm + loader) and data.json
```

## Architecture

- The UI is React 19 with Fluent UI React v9 (`@fluentui/react-components`,
  Fluent 2), Fluent System Icons and `@fluentui/react-charts`, built with Vite.
  The window uses a Mica backdrop on Windows 11 22H2+ (solid fallback otherwise)
  and a custom title bar over native caption buttons.
- Everything is served from a custom privileged `app://local` protocol that maps
  only the renderer build (`/renderer/` -> `build/renderer`) and the needed
  `core/` files, rejects path traversal and sets a strict CSP per response
  (`script-src 'self'`; inline styles are allowed for Fluent's CSS-in-JS).
- The renderer is sandboxed (`contextIsolation`, `sandbox`, no Node); a small
  preload exposes `window.uf` for app info, saved builds, upstream version
  checks and allowlisted external links.
- The engine runs in a classic Web Worker; only that worker's CSP allows
  `unsafe-eval`/`wasm-unsafe-eval`, which the Emscripten/embind loader needs.
- Game data is sent to the engine once via `cache_app_state`; each simulation
  then passes only the build and target.
- Runs are seeded (`seed_rng`) so multi-run averages are reproducible.
- Weapon stats after mods are computed by our own pipeline in `src/shared/`
  (tested independently); Underframe's engine does the time-based damage
  simulation (crits, procs, armor, shields, overguard).
- Saved builds live in `builds.json` under the Electron user data folder,
  written atomically and validated on read.
- Known v1 limits: guns only. No melee, warframe abilities, arcanes, rivens,
  conditional mods or incarnon-specific bonuses yet.

## Testing modes

| Environment | Effect |
| --- | --- |
| `UF_SMOKE=1` | Scripted end-to-end run of the real UI; prints `UF_SMOKE_RESULT <json>` and exits 0 or 1. `UF_SMOKE_SCREENSHOT=<file.png>` saves screenshots. |
| `UF_SCENES=<dir>` | Drives the UI through the review scenes, saves a PNG of each into `<dir>` and prints `UF_SCENES_DONE <json list>`. `UF_SCENE_BOOT_ERROR=1` captures the loading and boot-error screens instead. `UF_AXE=<axe.min.js>` also writes an axe-core report per scene. |
| `UF_THEME=light|dark` | Forces the theme (default: follow Windows). |
| `UF_WINDOW_SIZE=WxH` | Initial window size (minimum 1100x700). |
| `UF_NO_MICA=1` | Uses the solid background instead of Mica. |
| `UF_SECOND_MONITOR=1` | Opens the window at x=-3400, y=40. |

## Credits

- Damage engine and data: the Underframe developer ([underframe.site](https://www.underframe.site))
- Warframe is a game by Digital Extremes Ltd. This project is not affiliated
  with or endorsed by Digital Extremes.

## License

This repository's code is `AGPL-3.0-only` ([LICENSE](LICENSE)). The `core/`
submodule is proprietary, all rights reserved, and included with permission.
See [NOTICE.md](NOTICE.md) for details.
