// Screenshot OCR in the main process: Windows.Media.Ocr through a PowerShell 5.1 helper, run without a shell.
// The image is decoded and preprocessed with Electron's nativeImage, written to a private temp folder that is
// always removed afterwards, and recognised in two stages (the whole image, then crops placed from what the
// first pass found). The rank pips under each mod card are measured from the pixels. Every box in the result
// is in the original image's pixels.

import { app, nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_IMAGE_BYTES, brightTextFilter, findCardAnchors, mapBox, measurePips, planDetailPasses, planFullPass, screenGeometry,
  sniffImageType, toBuffer,
} from './preprocess.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Per helper run; a 4K screenshot takes about 0.5 s per image on a desktop CPU. */
export const OCR_TIMEOUT_MS = 30_000;

export class OcrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The helper script on disk. PowerShell cannot read inside app.asar, so packaged builds unpack it. */
export function helperScriptPath() {
  const p = path.join(here, 'windows-ocr.ps1');
  const packed = `${path.sep}app.asar${path.sep}`;
  return p.includes(packed) ? p.replace(packed, `${path.sep}app.asar.unpacked${path.sep}`) : p;
}

/** Windows PowerShell 5.1 by absolute path, so a powershell.exe earlier on PATH is never picked up. */
function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Recognition language. Mod, weapon and arcane names are matched against their English names, so the helper reads
 * with English OCR whatever the Windows display language is (a Japanese profile's recognizer would turn
 * "Serration" into kana). Without en-US the helper falls back to another Latin-script recognizer, else fails with
 * 'no-ocr-language'.
 */
export const OCR_LANGUAGE = 'en-US';

/** Run the helper over image files; resolves to one {lines, width, height} per file plus the language. */
function runHelper(files, { timeoutMs = OCR_TIMEOUT_MS } = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScriptPath(), '-Language', OCR_LANGUAGE, ...files];
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      let parsed = null;
      try {
        parsed = JSON.parse(String(stdout ?? '').replace(/^\uFEFF/, '').trim());
      } catch {}
      if (parsed?.error) return reject(new OcrError(parsed.error, parsed.message || 'Windows OCR failed.'));
      if (err) {
        if (err.killed || err.signal) return reject(new OcrError('timeout', `Windows OCR did not finish within ${Math.round(timeoutMs / 1000)} s.`));
        if (err.code === 'ENOENT') return reject(new OcrError('ocr-unavailable', 'Windows PowerShell was not found, so Windows OCR cannot run.'));
        return reject(new OcrError('ocr-failed', `Windows OCR failed: ${String(stderr || err.message).trim().slice(0, 300)}`));
      }
      if (!parsed) return reject(new OcrError('ocr-failed', 'Windows OCR returned no result.'));
      const images = parsed.images ?? [{ lines: parsed.lines, width: parsed.width, height: parsed.height }];
      resolve({ language: parsed.language ?? null, images });
    });
  });
}

/** The pass image as PNG bytes: crop, scale, then the optional text filter. */
function renderPass(source, pass) {
  const { region, scale } = pass;
  const size = source.getSize();
  let img = source;
  if (region.x !== 0 || region.y !== 0 || region.width !== size.width || region.height !== size.height) img = img.crop(region);
  if (scale !== 1) img = img.resize({ width: Math.round(region.width * scale), height: Math.round(region.height * scale), quality: 'best' });
  if (pass.filter === 'bright-text') {
    const s = img.getSize();
    img = nativeImage.createFromBitmap(brightTextFilter(img.toBitmap(), pass.threshold ? { threshold: pass.threshold } : {}), { width: s.width, height: s.height });
  }
  return img.toPNG();
}

let queue = Promise.resolve();

/**
 * Recognise a PNG or JPEG screenshot. Resolves to
 * {
 *   width, height, language,
 *   lines: [{ text, pass: 'full' | 'slots' | 'title', words: [{ text, x, y, w, h }] }],
 *   cards: [{ x, y, pips: { lit, spacing, y, first, last, total } | null }],  // x, y: a card name's centre and top
 *   passes: [{ name, region, scale }], ms: { total, ocr }
 * }
 * Only one recognition runs at a time; later calls wait their turn.
 * Rejects with an OcrError whose `code` is one of: unsupported-platform, too-large, bad-image, ocr-unavailable,
 * no-ocr-language, image-too-large, ocr-failed, timeout.
 */
export function recognizeScreenshot(input, options = {}) {
  const run = queue.then(() => recognizeNow(input, options));
  queue = run.catch(() => {});
  return run;
}

async function recognizeNow(input, { timeoutMs = OCR_TIMEOUT_MS, debugDir = null } = {}) {
  const started = Date.now();
  if (process.platform !== 'win32') throw new OcrError('unsupported-platform', 'Screenshot recognition uses Windows OCR and only works on Windows.');
  const bytes = toBuffer(input);
  if (!bytes || bytes.length === 0) throw new OcrError('bad-image', 'No image was given.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new OcrError('too-large', 'The image is larger than 25 MB.');
  if (!sniffImageType(bytes)) throw new OcrError('bad-image', 'Only PNG and JPEG screenshots can be recognised.');
  const source = nativeImage.createFromBuffer(bytes);
  if (source.isEmpty()) throw new OcrError('bad-image', 'The image could not be decoded.');
  const { width, height } = source.getSize();

  const dir = await mkdtemp(path.join(app?.getPath ? app.getPath('temp') : os.tmpdir(), 'uf-ocr-'));
  let ocrMs = 0;
  try {
    const recognise = async passes => {
      const files = [];
      for (const [i, pass] of passes.entries()) {
        const file = path.join(dir, `${i}-${pass.name}.png`);
        await writeFile(file, renderPass(source, pass));
        files.push(file);
      }
      const t0 = Date.now();
      const out = await runHelper(files, { timeoutMs });
      ocrMs += Date.now() - t0;
      return out;
    };
    const toLines = (image, pass) => (image?.lines ?? []).map(line => ({
      text: line.text,
      pass: pass.name,
      words: (line.words ?? []).map(word => mapBox(word, pass)),
    }));

    const full = planFullPass(width, height);
    const first = await recognise([full]);
    const lines = toLines(first.images[0], full);

    const detail = planDetailPasses(width, height, lines);
    const second = await recognise(detail);
    detail.forEach((pass, i) => lines.push(...toLines(second.images[i], pass)));

    // The layout's scale: a crop's comes from its text (screenGeometry).
    const geometry = screenGeometry(width, height, lines.filter(l => l.pass === 'full'));
    const bitmap = source.toBitmap();
    const cards = findCardAnchors(width, height, lines.filter(l => l.pass === 'slots'), geometry)
      .map(anchor => ({ ...anchor, pips: measurePips(bitmap, width, height, anchor, geometry) }));

    return {
      width,
      height,
      language: first.language,
      lines,
      cards,
      geometry,
      passes: [full, ...detail].map(p => ({ name: p.name, region: p.region, scale: Math.round(p.scale * 1000) / 1000 })),
      ms: { total: Date.now() - started, ocr: ocrMs },
    };
  } finally {
    // Development only: keep a copy of the images that were recognised.
    if (debugDir) await cp(dir, debugDir, { recursive: true }).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
