// Undo/redo stack for build edits. Pure: the controller keeps one history per open build.
// A step stores the build *content* before the edit. Edits that share a group (one text-editing session,
// e.g. typing a name) collapse into one step until the group ends.

export const HISTORY_LIMIT = 100;

export const emptyHistory = () => ({ past: [], future: [], group: null });

/** Record `before` as an undo step and clear the redo side. Consecutive records in the same group merge. */
export function record(history, before, group = null) {
  if (group && history.group === group) return history;
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [], group };
}

/** Close the current group, so the next edit starts a new step. */
export function endGroup(history) {
  return history.group ? { ...history, group: null } : history;
}

/** Step back. Returns { history, value } where value is the content to restore, or null when empty. */
export function undo(history, current) {
  if (!history.past.length) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future].slice(0, HISTORY_LIMIT), group: null },
    value: history.past[history.past.length - 1],
  };
}

/** Step forward again. Returns { history, value } or null when there is nothing to redo. */
export function redo(history, current) {
  if (!history.future.length) return null;
  return {
    history: { past: [...history.past, current].slice(-HISTORY_LIMIT), future: history.future.slice(1), group: null },
    value: history.future[0],
  };
}

export const canUndo = history => history.past.length > 0;
export const canRedo = history => history.future.length > 0;
