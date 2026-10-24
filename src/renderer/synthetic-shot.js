// Smoke and scene mode only: a stand-in screenshot for a recorded OCR result (text only, no game image in the
// repo). It draws the recorded text at its boxes on a dark background, with the compact card images of the
// recognised mods behind their names, so the review screen has something to point its boxes at.

/** Load an image (resolves to null when it can't be loaded). */
function loadImage(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * A JPEG data: URL the size of the recorded screenshot.
 * @param {object} ocr the recorded OCR result ({ width, height, lines })
 * @param {object} rec recognizeBuild() of it (slot boxes and names)
 * @param {object|null} cards the card image resolver
 */
export async function syntheticScreenshot(ocr, rec, cards) {
  const width = ocr.width || 1920;
  const height = ocr.height || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const bg = g.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#10161c');
  bg.addColorStop(1, '#1d262e');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  const ui = Math.min(width, Math.round((height * 16) / 9));
  const cardW = Math.round(ui * 0.115);
  const cardH = Math.round(cardW / 2);
  const cardsFor = [...(rec?.slots ?? []), ...(rec?.exilus ? [rec.exilus] : [])].filter(s => s?.name && s.box);
  for (const s of cardsFor) {
    const img = await loadImage(cards?.modCompactUrl?.(s.name));
    const cx = s.box.x + s.box.w / 2;
    const cy = s.box.y + s.box.h / 2;
    const x = Math.round(cx - cardW / 2);
    const y = Math.round(cy - cardH / 2);
    if (img) g.drawImage(img, x, y, cardW, cardH);
    else {
      g.fillStyle = '#2f3a44';
      g.fillRect(x, y, cardW, cardH);
    }
  }
  const arcane = rec?.arcanes?.[0];
  if (arcane?.box) {
    const img = await loadImage(cards?.arcaneUrl?.(arcane.name));
    if (img) g.drawImage(img, arcane.box.x + arcane.box.w / 2 - cardW / 2, arcane.box.y - cardW * 0.75, cardW, cardW * 0.73);
  }
  g.textBaseline = 'top';
  for (const line of ocr.lines ?? []) {
    if (line.pass !== 'full') continue;
    for (const w of line.words ?? []) {
      g.font = `600 ${Math.max(10, Math.round(w.h * 0.95))}px "Segoe UI", sans-serif`;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillText(w.text, w.x + 1, w.y + 1, Math.max(8, w.w));
      g.fillStyle = '#e8eef3';
      g.fillText(w.text, w.x, w.y, Math.max(8, w.w));
    }
  }
  return canvas.toDataURL('image/jpeg', 0.82);
}
