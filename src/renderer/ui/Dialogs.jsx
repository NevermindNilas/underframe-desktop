// Blocking dialogs: "Save changes?" when leaving a dirty build, About, and Keyboard shortcuts.
import {
  Body1, Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link,
  Subtitle2, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { fmtDate } from '../format.js';
import { CREDIT_TEXT } from './StatusBar.jsx';
import { DISCORD_URL, UNDERFRAME_URL } from './Workspace.jsx';
import { WHATS_SIMULATED } from './ResultCard.jsx';

export const SHORTCUTS = [
  ['Build', [
    ['Ctrl+S', 'Save'],
    ['Ctrl+Shift+S', 'Save as copy'],
    ['Ctrl+N', 'New build'],
    ['Ctrl+Z', 'Undo: the delete, unpin or clear whose toast is showing, else the last build edit'],
    ['Ctrl+Y or Ctrl+Shift+Z', 'Redo build edit'],
    ['F2', 'Rename the build, or the focused library item'],
    ['Del', 'Delete the focused library build'],
  ]],
  ['Mods and arcanes', [
    ['Ctrl+1 … Ctrl+8, Ctrl+9, Ctrl+Shift+9', 'Select slot 1-8, the Exilus slot or the arcane slot, and search the gallery'],
    ['Ctrl+F', 'Search the gallery'],
    ['Enter or Space (slot)', 'Select the slot; Space on a selected slot picks its mod up'],
    ['Space (gallery card)', 'Pick the card up: arrows choose a slot, Enter drops, Del removes, Esc cancels'],
    ['Enter (gallery card)', 'Equip into the selected slot, else the first empty slot'],
    ['Alt+Enter', 'Details of the focused card'],
    ['+ / − / Home / End (slot)', 'Raise, lower, zero or max the rank'],
    ['Del (slot)', 'Remove the mod'],
    ['Shift+Enter (slot)', 'Find the best mod for this slot'],
    ['Alt+Shift+Arrow (slot)', 'Swap with the neighbouring slot'],
    ['Shift+F10 (slot or card)', 'Slot or card menu'],
  ]],
  ['Import', [
    ['Ctrl+I', 'Import a build from a screenshot file'],
    ['Ctrl+V', 'Import from a screenshot on the clipboard'],
    ['Ctrl+Shift+G', 'Read the build from the Warframe window'],
  ]],
  ['Results', [
    ['Ctrl+Enter', 'Run the simulation again now'],
    ['Ctrl+P', 'Pin the result to compare'],
    ['Ctrl+J', 'Show or hide compare'],
    ['Del', 'Remove the focused pin'],
  ]],
  ['Navigation', [
    ['Ctrl+B', 'Show or hide the builds pane'],
    ['F6 / Shift+F6', 'Next or previous pane'],
    ['Ctrl+M', 'Move to notifications (Esc returns)'],
    ['Ctrl+Plus / Ctrl+Minus / Ctrl+0', 'Zoom in, zoom out, reset zoom'],
    ['Ctrl+/ or F1', 'Keyboard shortcuts'],
    ['Esc', 'Close a dialog, menu or the overlay pane'],
  ]],
];

const useStyles = makeStyles({
  about: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`, margin: 0 },
  dd: { margin: 0 },
  keys: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', width: '40%' },
  group: { marginTop: tokens.spacingVerticalM },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  shortcuts: { maxHeight: '60vh', overflowY: 'auto' },
});

function closeAction(onClick) {
  return <Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={onClick} />;
}

function LeaveDialog({ dialog }) {
  return (
    <Dialog modalType="alert" open onOpenChange={(_e, d) => { if (!d.open) actions.answerLeave('cancel'); }}>
      <DialogSurface aria-describedby="leave-body">
        <DialogBody>
          <DialogTitle>Save changes to "{dialog.name}"?</DialogTitle>
          <DialogContent id="leave-body">Your changes will be lost if you don't save them.</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => actions.answerLeave('save')}>Save</Button>
            <Button onClick={() => actions.answerLeave('discard')}>Don't save</Button>
            <Button onClick={() => actions.answerLeave('cancel')}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function AboutDialog() {
  const styles = useStyles();
  const info = useApp(s => s.appInfo);
  const manifest = useApp(s => s.manifest);
  return (
    <Dialog open onOpenChange={(_e, d) => { if (!d.open) actions.closeDialog(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle action={closeAction(() => actions.closeDialog())}>About Underframe Desktop</DialogTitle>
          <DialogContent className={styles.about}>
            <dl className={styles.dl}>
              <dt><Caption1>App</Caption1></dt><dd className={styles.dd}><Body1>{info?.version ?? '…'}</Body1></dd>
              <dt><Caption1>Electron</Caption1></dt><dd className={styles.dd}><Body1>{info?.electron ?? '…'} (Chrome {info?.chrome ?? '…'})</Body1></dd>
              <dt><Caption1>Game data</Caption1></dt>
              <dd className={styles.dd}><Body1>{manifest?.dataVersion ?? 'unknown'}{manifest?.fetchedAt ? `, fetched ${fmtDate(manifest.fetchedAt)}` : ''}</Body1></dd>
            </dl>
            <Body1>{CREDIT_TEXT}</Body1>
            <Body1>Code licensed AGPL-3.0-only; Underframe engine and data are proprietary and used with permission.</Body1>
            <div>
              <Subtitle2 as="h3">Known limits</Subtitle2>
              <ul className={styles.list}>
                <li><Body1>Guns only (primary and secondary weapons).</Body1></li>
                <li><Body1>Weapon arcanes are simulated; rivens, conditional mods, incarnon bonuses and warframe arcanes that buff weapons are not yet.</Body1></li>
                <li><Body1>Screenshot import needs an English game client and reads mods by their printed names.</Body1></li>

              </ul>
              <Caption1>{WHATS_SIMULATED}</Caption1>
            </div>
            <Body1>
              <Link onClick={() => actions.openExternal(UNDERFRAME_URL)}>underframe.site</Link>
              {' · '}
              <Link onClick={() => actions.openExternal(DISCORD_URL)}>Discord</Link>
            </Body1>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => actions.closeDialog()}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function ShortcutsDialog() {
  const styles = useStyles();
  return (
    <Dialog open onOpenChange={(_e, d) => { if (!d.open) actions.closeDialog(); }}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle action={closeAction(() => actions.closeDialog())}>Keyboard shortcuts</DialogTitle>
          <DialogContent className={styles.shortcuts} tabIndex={0} aria-label="Keyboard shortcuts list">
            {SHORTCUTS.map(([group, rows]) => (
              <section key={group} className={styles.group} aria-labelledby={`sc-${group}`}>
                <Subtitle2 as="h3" id={`sc-${group}`}>{group}</Subtitle2>
                <Table size="small" aria-labelledby={`sc-${group}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell className={styles.keys}>Keys</TableHeaderCell>
                      <TableHeaderCell>Action</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(([keys, label]) => (
                      <TableRow key={keys + label}>
                        <TableCell className={styles.keys}><Body1>{keys}</Body1></TableCell>
                        <TableCell><Body1>{label}</Body1></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ))}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => actions.closeDialog()}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useApp(s => s.dialog);
  if (!dialog) return null;
  if (dialog.type === 'leave') return <LeaveDialog dialog={dialog} />;
  if (dialog.type === 'about') return <AboutDialog />;
  if (dialog.type === 'shortcuts') return <ShortcutsDialog />;
  return null;
}
