// Global keyboard shortcuts (UX spec 5.5) and F6 pane cycling. Inactive while a dialog is open.
import { useEffect } from 'react';
import { actions, focusLater, store } from '../controller.js';
import { EXILUS_SLOT } from '../model.js';

/** Panes in F6 order. Each region carries data-pane="<name>". */
export const PANES = ['builds', 'toolbar', 'editor', 'results', 'compare'];

const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isVisible = el => Boolean(el && (el.offsetParent !== null || el.getClientRects().length));

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
}

/**
 * Whether a modal surface is up: the picker, an app dialog, or any visible element with aria-modal (Fluent
 * dialogs and the overlay builds pane). `except` names a pane whose own modal doesn't count (Ctrl+B must
 * still close the overlay builds pane).
 */
export function dialogOpen({ except = null } = {}) {
  const s = store.get();
  if (s.picker || s.dialog) return true;
  return [...document.querySelectorAll('[aria-modal="true"], [role="alertdialog"]')]
    .some(el => isVisible(el) && !(except && el.closest(`[data-pane="${except}"]`)));
}

/** Move focus to the next (or previous) pane. */
export function cyclePane(direction = 1) {
  const panes = PANES.map(name => document.querySelector(`[data-pane="${name}"]`)).filter(isVisible);
  if (!panes.length) return;
  const current = panes.findIndex(p => p.contains(document.activeElement));
  const next = panes[(current + direction + panes.length) % panes.length] ?? panes[0];
  const target = [...next.querySelectorAll(TABBABLE)].find(isVisible) ?? next;
  if (target === next && !next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
  target.focus();
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented) return;
      const s = store.get();
      const ready = s.phase === 'ready';
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (key === 'F6') {
        if (dialogOpen()) return;
        e.preventDefault();
        cyclePane(e.shiftKey ? -1 : 1);
        return;
      }
      if ((ctrl && (key === '/' || e.code === 'Slash')) || key === 'F1') {
        if (dialogOpen()) return;
        e.preventDefault();
        actions.openDialog('shortcuts');
        return;
      }
      if (ctrl && !e.altKey && key.toLowerCase() === 'b') {
        if (dialogOpen({ except: 'builds' })) return;
        e.preventDefault();
        actions.toggleLibrary();
        return;
      }
      if (!ready || dialogOpen({ except: 'builds' })) return;
      // The overlay builds pane is modal too: build shortcuts (save, undo, new) work from it, but nothing
      // may open another surface behind or on top of it (the picker, compare).
      const overlayPane = dialogOpen();

      if (key === 'F2' && !ctrl) {
        const item = document.activeElement?.closest?.('[data-library-id]');
        e.preventDefault();
        if (item) actions.startRename(item.dataset.libraryId);
        else if (!overlayPane) focusLater('build-name');
        return;
      }
      if (!ctrl || e.altKey) return;
      const k = key.toLowerCase();
      const inText = isTextField(document.activeElement);

      if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) actions.saveAsCopy();
        else actions.save();
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault();
        actions.newBuild();
      } else if (k === 'enter') {
        e.preventDefault();
        actions.runNow();
      } else if (k === 'p') {
        e.preventDefault();
        actions.pinResult();
      } else if (k === 'j') {
        e.preventDefault();
        if (!overlayPane) actions.toggleCompare();
      } else if ((k === 'z' && !e.shiftKey) && !inText) {
        // The newest undoable thing: a delete/unpin/clear whose toast is up, else the last build edit.
        e.preventDefault();
        actions.undoLatest();
      } else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !inText) {
        e.preventDefault();
        actions.redo();
      } else if (/^[1-9]$/.test(key) || /^Digit[1-9]$/.test(e.code)) {
        const n = Number(/^[1-9]$/.test(key) ? key : e.code.slice(5));
        e.preventDefault();
        if (!overlayPane) actions.openPicker(n === 9 ? EXILUS_SLOT : n - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
