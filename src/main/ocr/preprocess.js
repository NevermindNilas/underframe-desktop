// Pure image helpers for the OCR pipeline: type sniffing, where to crop a screenshot, a text filter on raw BGRA
// bitmaps, card rank pips, and mapping OCR boxes back to the original image. No Electron imports, so tests can
// use them on synthetic bitmaps.

/** Largest image accepted for recognition, in bytes. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** 'png' | 'jpeg' | null from the first bytes (magic numbers), never from a name or a claimed type. */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

/** Bytes from what the renderer may send over IPC: a Uint8Array/Buffer, an ArrayBuffer or a typed-array view. */
export function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Width of the 16:9 area the upgrade screen is laid out in (ultrawide screenshots centre it). */
export function uiWidth(width, height) {
  return Math.min(width, Math.round(height * 16 / 9));
}

/** The first OCR pass: the whole image, upscaled 2x when it is narrower than 1600 px. */
export function planFullPass(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { name: 'full', region: { x: 0, y: 0, width: w, height: h }, scale: w < 1600 ? 2 : 1, filter: null };
}

/** "Search..." in the languages Warframe ships (the inventory grid starts right under it); one stray letter may lead. */
const SEARCH_RE = /^[^\p{L}]*\p{L}?(search|buscar|procurar|chercher|suche|cerca|szukaj|поиск|пошук|ara|搜索|搜尋|検索|검색)/iu;

/**
 * The second OCR passes, placed from what the full pass found:
 * - slots: the area holding the equipped mod cards, the exilus and the arcane, from the top bar down to the
 *   search box over the inventory (or 85% of the height when there is none), filtered to bright text because
 *   the card art confuses the recogniser;
 * - title: the header line holding the weapon name, filtered the same way.
 * Regions are in source pixels; `scale` multiplies them for the image that is recognised.
 */
export function planDetailPasses(width, height, fullLines = []) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const ui = uiWidth(w, h);
  const left = Math.round((w - ui) / 2);
  const search = fullLines
    .filter(l => SEARCH_RE.test(String(l.text ?? '')) && l.words?.length)
    .map(l => Math.min(...l.words.map(wd => wd.y)))
    .filter(y => y > h * 0.3)
    .sort((a, b) => a - b)[0];
  const top = Math.round(h * 0.12);
  const bottom = search != null ? Math.round(search - h * 0.005) : Math.round(h * 0.85);
  const box = (x, y, x1, y1) => {
    const cx = clamp(Math.round(x), 0, w - 1);
    const cy = clamp(Math.round(y), 0, h - 1);
    return { x: cx, y: cy, width: clamp(Math.round(x1) - cx, 1, w - cx), height: clamp(Math.round(y1) - cy, 1, h - cy) };
  };
  const slots = box(left + 0.2 * ui, top, w, bottom);
  const title = box(left + 0.04 * ui, h * 0.02, left + 0.8 * ui, h * 0.125);
  return [
    // Card names read best at about 1700 px of screen height; 4K is recognised as is.
    { name: 'slots', region: slots, scale: clamp(1700 / h, 1, 3), filter: 'bright-text' },
    // The widely spaced header font is read unreliably, and which size and threshold work varies from one
    // screenshot to the next, so the header is recognised three ways (measured on the fixtures: any one variant
    // finds the weapon in 1-4 of 5 new-layout headers, the three together in 5 of 5).
    ...TITLE_VARIANTS.map(v => ({
      name: 'title', region: title, scale: clamp(v.height / title.height, 0.3, 3), filter: 'bright-text', threshold: v.threshold,
    })),
  ];
}

/** Header recognition variants: the header crop's height in px after scaling, and the text filter threshold. */
const TITLE_VARIANTS = [{ height: 110, threshold: 100 }, { height: 150, threshold: 140 }, { height: 190, threshold: 168 }];

/**
 * Keep bright text, drop the rest: dark text on a white background, as a new BGRA buffer.
 * Mod names are white, gold, peach or lilac, always much brighter than the card art behind them; a pixel is
 * "ink" when its brightest channel clears `threshold`. The result is greyscale with a soft edge so the
 * recogniser still sees anti-aliased strokes.
 */
export function brightTextFilter(bgra, { threshold = 168, soft = 40 } = {}) {
  const out = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    const max = Math.max(bgra[i], bgra[i + 1], bgra[i + 2]);
    const v = Math.round(255 * (1 - clamp((max - threshold) / soft, 0, 1)));
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** Map one OCR word box from a pass image back to source-image pixels. */
export function mapBox(word, pass) {
  const s = pass.scale || 1;
  const r = pass.region;
  const round1 = v => Math.round(v * 10) / 10;
  return {
    text: word.text,
    x: round1(r.x + word.x / s),
    y: round1(r.y + word.y / s),
    w: round1(word.w / s),
    h: round1(word.h / s),
  };
}

const NAME_LIKE = /\p{L}{3}/u;

/**
 * Card anchors from the slots pass: one per card-name line, at the name's centre x and top y. A name that wraps
 * onto a second line counts once (its first line). Lines too wide to be a card name are skipped.
 */
export function findCardAnchors(width, height, slotLines = []) {
  const ui = uiWidth(width, height);
  const boxes = slotLines
    .filter(l => l.words?.length && NAME_LIKE.test(String(l.text ?? '')))
    .map(l => {
      const x = Math.min(...l.words.map(wd => wd.x));
      const y = Math.min(...l.words.map(wd => wd.y));
      const x1 = Math.max(...l.words.map(wd => wd.x + wd.w));
      return { x: (x + x1) / 2, y, width: x1 - x };
    })
    .filter(b => b.width < ui * 0.14)
    .sort((a, b) => a.y - b.y);
  const tops = [];
  for (const b of boxes) {
    const above = tops.find(t => Math.abs(t.x - b.x) < ui * 0.03 && b.y - t.y > 0 && b.y - t.y < height * 0.035);
    if (!above) tops.push(b);
  }
  return tops.map(t => ({ x: Math.round(t.x), y: Math.round(t.y) }));
}


/** Distance between two rank pips, as a fraction of the 16:9 UI width. */
export const PIP_SPACING = 0.0061;

/** measurePips().profile samples the pip row at this many half spacings each side of the centre. */
export const PROFILE_HALF_STEPS = 12;

/** A lit rank pip: bright cyan-blue. */
const isLit = (bgra, i) => bgra[i] >= 140 && bgra[i] >= bgra[i + 2] + 25 && bgra[i + 1] >= 100;
/** An unlit rank pip: light grey. */
export const isGrey = (bgra, i) => {
  const max = Math.max(bgra[i], bgra[i + 1], bgra[i + 2]);
  const min = Math.min(bgra[i], bgra[i + 1], bgra[i + 2]);
  return max >= 115 && max - min <= 40;
};
const brightness = (bgra, i) => Math.max(bgra[i], bgra[i + 1], bgra[i + 2]);

/**
 * Centres of pip-sized blobs in a band, for one pixel test. Only the brightest part of the matching pixels is
 * kept (pip cores; their glow and a lit bar are dimmer) unless `minCore` sets the floor, and rows where the mask runs longer than two pips
 * (a bar drawn through the pip row) are cleared. A pip cut in two by a cleared row is joined again.
 */
export function pipBlobs(bgra, width, height, band, test, ui, { minCore = 0, wholeRows = false } = {}) {
  const { x0, y0, x1, y1 } = band;
  const bw = x1 - x0;
  const bh = y1 - y0;
  const levels = new Uint32Array(256);
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (test(bgra, i)) {
        levels[brightness(bgra, i)]++;
        count++;
      }
    }
  }
  if (!count) return [];
  let p95 = 255;
  for (let v = 255, acc = 0; v >= 0; v--) {
    acc += levels[v];
    if (acc >= count * 0.05) {
      p95 = v;
      break;
    }
  }
  const core = minCore || Math.round(p95 * 0.85);
  const mask = new Uint8Array(bw * bh);
  const barRun = 0.011 * ui;
  for (let y = 0; y < bh; y++) {
    let run = 0;
    let longest = 0;
    for (let x = 0; x <= bw; x++) {
      const i = ((y0 + y) * width + x0 + x) * 4;
      const on = x < bw && test(bgra, i) && brightness(bgra, i) >= core;
      if (x < bw) mask[y * bw + x] = on ? 1 : 0;
      if (on) {
        run++;
        longest = Math.max(longest, run);
      } else {
        // A run longer than two pips is a bar or a frame edge, not a pip.
        if (run > barRun && !wholeRows) mask.fill(0, y * bw + x - run, y * bw + x);
        run = 0;
      }
    }
    // A lit bar's glow reaches past its core, so for lit pips the whole row goes.
    if (wholeRows && longest > barRun) mask.fill(0, y * bw, (y + 1) * bw);
  }
  const seen = new Uint8Array(bw * bh);
  const blobs = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let bx0 = bw, by0 = bh, bx1 = -1, by1 = -1, n = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % bw;
      const y = (p - x) / bw;
      n++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const q = ny * bw + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    blobs.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, n });
  }
  // Lit pips only: join the two halves of a pip that a cleared bar row cut apart (shared columns, a small gap).
  blobs.sort((a, b) => a.y0 - b.y0);
  const merged = [];
  for (const b of blobs) {
    const half = wholeRows && merged.find(p => {
      const overlap = Math.min(p.x1, b.x1) - Math.max(p.x0, b.x0) + 1;
      const narrower = Math.min(p.x1 - p.x0, b.x1 - b.x0) + 1;
      const gap = b.y0 - p.y1;
      return b.y0 >= p.y0 && (wholeRows
        ? overlap >= 1 && gap <= height * 0.012
        : overlap >= narrower * 0.5 && gap <= Math.max(2, height * 0.004));
    });
    if (half) {
      half.x0 = Math.min(half.x0, b.x0);
      half.x1 = Math.max(half.x1, b.x1);
      half.y1 = Math.max(half.y1, b.y1);
      half.n += b.n;
    } else merged.push({ ...b });
  }
  const minSize = Math.max(2, 0.0012 * ui);
  const maxSize = 0.009 * ui;
  return merged
    .filter(b => {
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      return w >= minSize && w <= maxSize && h >= minSize && h <= maxSize * 1.4 && b.n >= minSize * minSize * 0.5;
    })
    .map(b => ({ x: x0 + (b.x0 + b.x1) / 2, y: y0 + (b.y0 + b.y1) / 2 }));
}

/** The horizontal row holding the most blobs, sorted left to right. */
/**
 * Rows of the band crossed by a long lit bar. The game draws a glowing bar through the pip row of a mod at max
 * rank (measured on every fixture card: bar present exactly when all pips are lit), so it is a rank signal of
 * its own, and the one that survives when the bar's glow swallows the pips at its ends.
 */
export function litBarRows(bgra, width, band, ui) {
  const rows = [];
  const minRun = 0.04 * ui;
  for (let y = band.y0; y < band.y1; y++) {
    let run = 0;
    let longest = 0;
    for (let x = band.x0; x < band.x1; x++) {
      run = isLit(bgra, (y * width + x) * 4) ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest >= minRun) rows.push(y);
  }
  return rows;
}

export function pipRow(blobs, height) {
  const tolerance = height * 0.006;
  let row = [];
  for (const p of blobs) {
    const members = blobs.filter(q => Math.abs(q.y - p.y) <= tolerance);
    if (members.length > row.length) row = members;
  }
  return row.sort((a, b) => a.x - b.x);
}

/** Pip spacing from a row: gaps divided by the number of spacings they span, near the expected spacing. */
function pipSpacing(row, expected) {
  const steps = row.slice(1).map((p, i) => {
    const gap = p.x - row[i].x;
    return gap / Math.max(1, Math.round(gap / expected));
  }).filter(s => Math.abs(s - expected) < expected * 0.3).sort((a, b) => a - b);
  return steps.length ? steps[Math.floor(steps.length / 2)] : expected;
}

/**
 * Measure the rank pips under one card. A card shows one pip per rank, centred under the card, lit (cyan) up to
 * the mod's current rank and grey after it.
 * Returns, in source pixels, { lit, detected, spacing, y, first, last, center, total, bar, profile } where `lit`
 * counts pip positions from the first to the last lit pip (pips the detector missed in between still count),
 * `center` is the card's centre (its name's centre), `total` the pip count implied by the row being centred
 * there, `bar` whether the max-rank bar is drawn through the row (`lit` is null when the bar's glow hid every
 * pip), and `profile` = { center, samples } the share of lit pixels at each half spacing from the lattice-snapped
 * centre, PROFILE_HALF_STEPS each side, so the reader can check every pip position once it knows the pip count.
 * With no lit pip and no bar but a centred row of grey pips it returns { lit: 0, grey, total, ... } (rank 0).
 * Null when nothing is found (the card is covered, or this is not a card).
 */
export function measurePips(bgra, width, height, anchor) {
  const ui = uiWidth(width, height);
  // Ten pips span about 0.055 of the UI width; the row sits 0.045-0.065 of the height below the name's top.
  const band = {
    x0: clamp(Math.round(anchor.x - 0.04 * ui), 0, width - 1),
    y0: clamp(Math.round(anchor.y + 0.033 * height), 0, height - 1),
  };
  band.x1 = clamp(Math.round(anchor.x + 0.04 * ui), band.x0 + 1, width);
  band.y1 = clamp(Math.round(anchor.y + 0.078 * height), band.y0 + 1, height);
  const expected = PIP_SPACING * ui;
  const round1 = v => Math.round(v * 10) / 10;

  const row = pipRow(pipBlobs(bgra, width, height, band, isLit, ui, { wholeRows: true }), height);
  const bars = litBarRows(bgra, width, band, ui);
  const rowY = row.length ? row.reduce((a, p) => a + p.y, 0) / row.length : anchor.y + 0.055 * height;
  const bar = bars.some(y => Math.abs(y - rowY) <= height * 0.012);
  if (row.length) {
    const spacing = pipSpacing(row, expected);
    const first = row[0].x;
    const last = row[row.length - 1].x;
    const y = row.reduce((a, p) => a + p.y, 0) / row.length;
    // Pips sit on a lattice of half spacings around the card centre (whole or half steps, by pip count). Snap
    // the centre to the lattice the detected pips lie on (a name read short moves its centre a little), then
    // sample the share of lit pixels at every lattice point: dim pips the blob search missed still show here.
    const half = spacing / 2;
    const residuals = row.map(p => {
      const r = (p.x - anchor.x) / half;
      return r - Math.round(r);
    }).sort((a, b) => a - b);
    const center = anchor.x + residuals[Math.floor(residuals.length / 2)] * half;
    const samples = [];
    const ry = Math.max(1, Math.round(height * 0.004));
    const rx = Math.max(1, Math.round(spacing * 0.25));
    for (let j = -PROFILE_HALF_STEPS; j <= PROFILE_HALF_STEPS; j++) {
      const cx = Math.round(center + j * half);
      let on = 0, n = 0;
      for (let yy = Math.round(y) - ry; yy <= Math.round(y) + ry; yy++) {
        for (let xx = cx - rx; xx <= cx + rx; xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          n++;
          if (isLit(bgra, (yy * width + xx) * 4)) on++;
        }
      }
      samples.push(n ? Math.round((on / n) * 100) / 100 : 0);
    }
    return {
      profile: { center: round1(center), samples },
      lit: Math.round((last - first) / spacing) + 1,
      detected: row.length,
      spacing: round1(spacing),
      y: round1(row.reduce((a, p) => a + p.y, 0) / row.length),
      first: round1(first),
      last: round1(last),
      center: anchor.x,
      total: Math.round((2 * (anchor.x - first)) / spacing + 1),
      bar,
    };
  }
  if (bar) return { lit: null, detected: 0, spacing: null, y: round1(rowY), first: null, last: null, center: anchor.x, total: null, bar };
  // Rank 0: a row of evenly spaced grey pips centred under the card.
  // Grey pips are dim (about 160 of 255), so a fixed floor replaces the brightest-part rule.
  const grey = pipRow(pipBlobs(bgra, width, height, band, isGrey, ui, { minCore: 120 }), height);
  if (grey.length >= 2) {
    const spacing = pipSpacing(grey, expected);
    const evenly = grey.slice(1).every((p, i) => {
      const k = (p.x - grey[i].x) / spacing;
      return Math.abs(k - Math.round(k)) < 0.25 && Math.round(k) === 1;
    });
    const mid = (grey[0].x + grey[grey.length - 1].x) / 2;
    if (evenly && Math.abs(mid - anchor.x) < spacing * 0.6) {
      return {
        lit: 0,
        grey: grey.length,
        detected: 0,
        spacing: round1(spacing),
        y: round1(grey.reduce((a, p) => a + p.y, 0) / grey.length),
        first: round1(grey[0].x),
        last: round1(grey[grey.length - 1].x),
        center: anchor.x,
        total: grey.length,
      };
    }
  }
  return null;
}
