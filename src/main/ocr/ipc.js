// IPC for screenshot recognition. Registered through main.js's handle(), which refuses calls from any frame that
// is not our own app:// page. Every call resolves to a result or to { error: { code, message } } for the UI to
// show; they never reject with a bare Error, so the message survives the IPC boundary.

import { clipboard, shell } from 'electron';
import { MAX_IMAGE_BYTES, sniffImageType, toBuffer } from './preprocess.js';
import { recognizeScreenshot } from './index.js';
import { captureGameWindow } from './capture-game.js';

const failure = e => ({ error: { code: e?.code ?? 'ocr-failed', message: String(e?.message ?? e ?? 'Screenshot recognition failed.') } });

/** Windows Settings page where OCR languages are added. */
export const LANGUAGE_SETTINGS_URI = 'ms-settings:regionlanguage';

/** Validate what the renderer sent: bytes (any typed array or ArrayBuffer), at most 25 MB, PNG or JPEG by content. */
export function checkImageBytes(input) {
  const bytes = toBuffer(input);
  if (!bytes || !bytes.length) return { error: { code: 'bad-image', message: 'No image was given.' } };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: { code: 'too-large', message: 'The image is larger than 25 MB.' } };
  if (!sniffImageType(bytes)) return { error: { code: 'bad-image', message: 'Only PNG and JPEG screenshots can be recognised.' } };
  return { bytes };
}

export function registerOcrIpc(handle) {
  // PNG/JPEG bytes in, the OCR result out (see recognizeScreenshot in ./index.js).
  handle('uf:ocr:recognize', async input => {
    const checked = checkImageBytes(input);
    if (checked.error) return checked;
    try {
      return await recognizeScreenshot(checked.bytes);
    } catch (e) {
      return failure(e);
    }
  });
  // The Warframe window as { png: Uint8Array, width, height, title }.
  handle('uf:ocr:captureGame', async () => {
    try {
      const shot = await captureGameWindow();
      return { ...shot, png: new Uint8Array(shot.png) };
    } catch (e) {
      return failure(e);
    }
  });
  // The clipboard's image as { png, width, height, hasText }, or { error: { code: 'no-image' } }. Read only on the
  // user's explicit paste command (Ctrl+V or the menu item).
  handle('uf:ocr:clipboardImage', () => {
    try {
      const img = clipboard.readImage();
      const hasText = Boolean(clipboard.readText());
      if (!img || img.isEmpty()) return { error: { code: 'no-image', message: "There's no image on the clipboard." }, hasText };
      const { width, height } = img.getSize();
      return { png: new Uint8Array(img.toPNG()), width, height, hasText };
    } catch (e) {
      return failure(e);
    }
  });
  // Settings > Time & language > Language, where the English (United States) OCR language is added.
  handle('uf:ocr:openLanguageSettings', async () => {
    try {
      await shell.openExternal(LANGUAGE_SETTINGS_URI);
      return true;
    } catch {
      return false;
    }
  });
}
