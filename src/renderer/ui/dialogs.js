// Modal confirm / prompt dialogs and toasts. Electron has no window.prompt, so these replace the native ones.
import { h } from './dom.js';

/** Show a <dialog> built by `build(close)` modally; resolves with the value passed to close(). */
export function modal(build, { className = '' } = {}) {
  return new Promise(resolve => {
    let result = null;
    const dlg = h('dialog', { class: `dialog ${className}` });
    const close = value => { result = value; dlg.close(); };
    dlg.append(build(close));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return modal(close => {
    const ok = h('button', { class: danger ? 'btn danger' : 'btn primary', type: 'button', onClick: () => close(true) }, confirmLabel);
    queueMicrotask(() => ok.focus());
    return h('div', { class: 'dialog-body small' },
      h('h2', { class: 'dialog-title' }, title),
      message ? h('p', { class: 'muted' }, message) : null,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => close(false) }, 'Cancel'),
        ok));
  }).then(v => v === true);
}

export function promptDialog({ title, label, value = '', confirmLabel = 'Save' }) {
  return modal(close => {
    const input = h('input', { class: 'input', type: 'text', value, maxlength: 120, 'aria-label': label });
    queueMicrotask(() => { input.focus(); input.select(); });
    const submit = e => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) close(v);
    };
    return h('form', { class: 'dialog-body small', onSubmit: submit },
      h('h2', { class: 'dialog-title' }, title),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, confirmLabel)));
  });
}

let toastHost = null;

/** Brief message in the corner, announced to screen readers. kind: 'info' | 'warn' | 'error' | 'ok'. */
export function toast(message, kind = 'info', ms = 4500) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${kind}` }, message,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onClick: () => el.remove() }, '×'));
  toastHost.append(el);
  setTimeout(() => el.remove(), ms);
}
