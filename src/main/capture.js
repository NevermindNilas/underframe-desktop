// Window screenshots for smoke and scene modes.

import { desktopCapturer, screen } from 'electron';

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * How automated runs (smoke, scenes) capture: the page itself by default. A screen grab records whatever window is on
 * top of ours (other apps, private content) and an occluded window stalls; UF_CAPTURE_SCREEN=1 asks for it anyway,
 * to review the Mica backdrop and the caption buttons. Interactive runs never capture.
 */
export const captureVia = (env = process.env) => (env.UF_CAPTURE_SCREEN === '1' ? 'screen' : 'page');

/**
 * Chromium switches for automated runs: keep rendering and timers going while the window is covered or in the
 * background, so captures and requestAnimationFrame never stall.
 */
export const AUTOMATION_SWITCHES = [
  ['disable-backgrounding-occluded-windows'],
  ['disable-renderer-backgrounding'],
  ['disable-background-timer-throttling'],
  ['disable-features', 'CalculateNativeWinOcclusion'],
];

/**
 * Capture the window as the user sees it: the Mica backdrop, the title bar overlay and the caption buttons
 * included. Window-level capture APIs render the backdrop as plain white, so this grabs the display the
 * window is on and crops it to the window (the window is raised first). With `via: 'page'`, or when that is
 * unavailable, it captures the page alone (transparent where the page is transparent).
 * Resolves to { png, via: 'screen' | 'page' }.
 */
export async function captureWindow(win, { via = 'screen' } = {}) {
  try {
    if (via === 'screen' && win.isVisible() && !win.isMinimized()) {
      win.moveTop();
      await delay(120);
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const scale = display.scaleFactor ?? 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
      });
      const source = sources.find(s => String(s.display_id) === String(display.id)) ?? (sources.length === 1 ? sources[0] : null);
      if (source && !source.thumbnail.isEmpty()) {
        const rect = {
          x: Math.round((bounds.x - display.bounds.x) * scale),
          y: Math.round((bounds.y - display.bounds.y) * scale),
          width: Math.round(bounds.width * scale),
          height: Math.round(bounds.height * scale),
        };
        const size = source.thumbnail.getSize();
        rect.width = Math.min(rect.width, size.width - rect.x);
        rect.height = Math.min(rect.height, size.height - rect.y);
        if (rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0) {
          return { png: source.thumbnail.crop(rect).toPNG(), via: 'screen' };
        }
      }
    }
  } catch (e) {
    process.stdout.write(`[capture] screen capture failed, using the page: ${e?.message ?? e}\n`);
  }
  const image = await win.webContents.capturePage();
  return { png: image.toPNG(), via: 'page' };
}
