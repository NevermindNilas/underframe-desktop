// Reading a screenshot off the clipboard. Kept free of the electron import so it can be tested in plain Node.

const NO_IMAGE = { code: 'no-image', message: "There's no image on the clipboard." };

/**
 * The clipboard's image as { png, width, height, hasText }, or { error: { code: 'no-image' }, hasText }.
 * Electron 44's clipboard is the async W3C-style API (read/has/getType); readImage() no longer exists. Windows offers
 * a screenshot (Win+Shift+S, Print Screen) as image/png.
 * @param {Electron.Clipboard} clipboard
 * @param {(buf: Buffer) => Electron.NativeImage} decode  e.g. nativeImage.createFromBuffer
 */
export async function readClipboardImage(clipboard, decode) {
  const hasText = await clipboard.has('text/plain').catch(() => false);
  const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
  if (!item) return { error: NO_IMAGE, hasText };
  const png = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
  const img = png.length ? decode(Buffer.from(png)) : null;
  if (!img || img.isEmpty()) return { error: NO_IMAGE, hasText };
  const { width, height } = img.getSize();
  return { png, width, height, hasText };
}
