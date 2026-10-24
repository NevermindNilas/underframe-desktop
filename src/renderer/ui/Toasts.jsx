// One Toaster (bottom-end, above the status bar, at most 3). Controller notifications become Fluent toasts.
// Keyboard: Ctrl+M moves focus into the toasts (Fluent pauses them while focused); Up/Down move between
// toasts, Tab reaches the action, and Esc closes them and returns focus to where it was. Undo toasts also
// answer to Ctrl+Z from anywhere (see actions.undoLatest).
import { useEffect } from 'react';
import {
  Link, Toast, ToastBody, ToastFooter, ToastTitle, ToastTrigger, Toaster, useId, useToastController,
} from '@fluentui/react-components';
import { onToast } from '../controller.js';

/** Toast actions are text links; give them a 24 px pointer target (WCAG 2.5.8). */
const TARGET = { minHeight: '24px', display: 'inline-flex', alignItems: 'center' };

/** Ctrl+M (see TOAST_FOCUS_SHORTCUT in the controller and the shortcuts dialog). */
const SHORTCUTS = { focus: e => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm' };

export function Toasts() {
  const toasterId = useId('toaster');
  const { dispatchToast, dismissToast, dismissAllToasts } = useToastController(toasterId);
  useEffect(() => onToast(t => {
    if (t.clear) {
      dismissAllToasts();
      return;
    }
    if (t.dismiss) {
      dismissToast(t.dismiss);
      return;
    }
    const { toastId } = t;
    const action = t.action ? (
      <Link style={TARGET} onClick={() => {
        dismissToast(toastId);
        t.action.run();
      }}
      >
        {t.action.label}
      </Link>
    ) : t.intent === 'error' ? (
      <ToastTrigger><Link style={TARGET}>Dismiss</Link></ToastTrigger>
    ) : null;
    dispatchToast(
      <Toast data-testid="toast">
        <ToastTitle action={action}>{t.title}</ToastTitle>
        {t.body ? <ToastBody>{t.body}</ToastBody> : null}
        {t.action && t.intent === 'error' ? (
          <ToastFooter><ToastTrigger><Link style={TARGET}>Dismiss</Link></ToastTrigger></ToastFooter>
        ) : null}
      </Toast>,
      {
        toastId,
        intent: t.intent,
        timeout: t.timeout,
        pauseOnHover: true,
        pauseOnWindowBlur: true,
        politeness: t.intent === 'error' ? 'assertive' : 'polite',
      },
    );
  }), [dispatchToast, dismissToast, dismissAllToasts]);
  return <Toaster toasterId={toasterId} position="bottom-end" offset={{ horizontal: 16, vertical: 40 }} limit={3} shortcuts={SHORTCUTS} />;
}
