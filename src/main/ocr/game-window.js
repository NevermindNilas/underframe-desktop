// Which captured window is the Warframe game. Pure, so it can be tested without Electron.
//
// The game's window is titled exactly "Warframe". Browser tabs, Discord channels, Explorer folders and the
// launcher only *mention* Warframe ("r/Warframe - Reddit - Mozilla Firefox", "Warframe screenshots - File
// Explorer"); capturing those would read unrelated, possibly private content, so only the exact title counts.

/** Whether a window title is the game's own window. */
export function isGameWindowTitle(title) {
  return /^warframe$/i.test(String(title ?? '').trim());
}

/** The game window among desktopCapturer sources ({ name, ... }), or null. Several matches: the first. */
export function pickGameSource(sources) {
  return (sources ?? []).find(s => isGameWindowTitle(s?.name)) ?? null;
}
