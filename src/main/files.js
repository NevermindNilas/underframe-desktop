// Text files the user saves or opens through the system dialogs (docs/port-rivens.md 13): the rolls data CSV and the
// riven library's JSON. The renderer never sees a path it didn't get from a dialog; reads are capped. Automated runs
// never show a dialog: a save goes to the run's temp folder, an open is cancelled.
import { dialog } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Opened text files are at most 5 MB (a riven library of 500 rivens is about 150 KB). */
export const MAX_OPEN_BYTES = 5 * 1024 * 1024;
/** Saved text is at most 50 MB (a rolls data CSV of the largest scan is a few MB). */
export const MAX_SAVE_CHARS = 50 * 1024 * 1024;

const FILTERS = {
  csv: [{ name: 'CSV', extensions: ['csv'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
};

/** "a/b:c?.csv" -> "a-b-c-.csv": a file name the dialog can start with. */
export function safeFileName(name, kind) {
  const ext = kind === 'json' ? '.json' : '.csv';
  const base = String(name ?? '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim().slice(0, 120) || 'export';
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

/**
 * @param {object} o
 * @param {() => import('electron').BrowserWindow | null} o.window the window dialogs belong to
 * @param {boolean} [o.automated] smoke and scene runs: no dialogs
 */
export function createFiles({ window, automated = false }) {
  return {
    /** Save text: { kind: 'csv'|'json', name, text } -> { path } or { cancelled: true }. */
    async saveText(req) {
      const kind = req?.kind === 'json' ? 'json' : 'csv';
      const text = String(req?.text ?? '');
      if (text.length > MAX_SAVE_CHARS) throw new Error('The file is too large to save.');
      const name = safeFileName(req?.name, kind);
      let file;
      if (automated) {
        const dir = path.join(os.tmpdir(), 'underframe-desktop-smoke-files');
        await mkdir(dir, { recursive: true });
        file = path.join(dir, name);
      } else {
        const r = await dialog.showSaveDialog(window(), { defaultPath: name, filters: FILTERS[kind] });
        if (r.canceled || !r.filePath) return { cancelled: true };
        file = r.filePath;
      }
      await writeFile(file, text, 'utf8');
      return { path: file };
    },
    /** Open a text file: { kind } -> { text, name } or { cancelled: true }. */
    async openText(req) {
      const kind = req?.kind === 'csv' ? 'csv' : 'json';
      if (automated) return { cancelled: true };
      const r = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters: FILTERS[kind] });
      if (r.canceled || !r.filePaths?.[0]) return { cancelled: true };
      const file = r.filePaths[0];
      if ((await stat(file)).size > MAX_OPEN_BYTES) throw new Error('The file is larger than 5 MB.');
      return { text: (await readFile(file, 'utf8')).replace(/^﻿/, ''), name: path.basename(file) };
    },
  };
}
