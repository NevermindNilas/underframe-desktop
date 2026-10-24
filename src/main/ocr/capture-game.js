// Grab the Warframe game window as a PNG, for screenshot recognition without saving a screenshot first.

import { desktopCapturer, screen } from 'electron';
import { OcrError } from './index.js';
import { pickGameSource } from './game-window.js';

export { isGameWindowTitle } from './game-window.js';

/**
 * The Warframe window's contents as { png, width, height, title }. The thumbnail is requested at the size of the
 * largest display so the capture keeps the game's resolution. Rejects with OcrError 'game-not-found' when no
 * Warframe window is open, or 'game-minimized' when it is minimised (Windows gives an empty image then).
 */
export async function captureGameWindow() {
  const largest = screen.getAllDisplays().reduce((best, d) => {
    const w = Math.round(d.size.width * (d.scaleFactor || 1));
    const h = Math.round(d.size.height * (d.scaleFactor || 1));
    return w * h > best.width * best.height ? { width: w, height: h } : best;
  }, { width: 1920, height: 1080 });
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: largest, fetchWindowIcons: false });
  const game = pickGameSource(sources);
  if (!game) throw new OcrError('game-not-found', 'No Warframe window is open. Start the game, open the weapon\'s upgrade screen and try again.');
  const size = game.thumbnail.getSize();
  if (game.thumbnail.isEmpty() || size.width < 64 || size.height < 64) {
    throw new OcrError('game-minimized', 'The Warframe window is minimised. Bring it back on screen and try again.');
  }
  return { png: game.thumbnail.toPNG(), width: size.width, height: size.height, title: game.name };
}
