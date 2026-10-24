// Custom 48 px title bar on the backdrop: pane toggle, app mark, app name, build name and save state.
// Native caption buttons are drawn by Windows (titleBarOverlay); this bar never extends under them.
import { Caption1, Hamburger, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp, useWindowFocused } from '../hooks.js';
import { buildToSave, snapshotOf } from '../model.js';
import { AppIcon } from './common.jsx';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '48px',
    // Leave room for the caption buttons: the overlay reports the free area through env().
    width: 'env(titlebar-area-width, calc(100% - 140px))',
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalM,
    boxSizing: 'border-box',
    minWidth: 0,
    userSelect: 'none',
  },
  text: {
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
  },
  build: {
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  inactive: { color: tokens.colorNeutralForegroundDisabled },
  dot: { color: tokens.colorNeutralForeground3 },
  icon: { display: 'inline-flex', flexShrink: 0, marginLeft: tokens.spacingHorizontalXS },
});

export function saveStateText({ build, snapshot, saving }) {
  if (saving) return 'Saving…';
  if (!build?.id) return 'Not saved yet';
  return snapshotOf(build) !== snapshot ? 'Unsaved changes' : 'Saved';
}

export function TitleBar({ libraryOpen }) {
  const styles = useStyles();
  const focused = useWindowFocused();
  const build = useApp(s => s.build);
  const snapshot = useApp(s => s.snapshot);
  const saving = useApp(s => s.saving);
  const state = build ? saveStateText({ build, snapshot, saving }) : '';
  const name = build ? buildToSave(build).name : '';
  const label = libraryOpen ? 'Hide builds (Ctrl+B)' : 'Show builds (Ctrl+B)';
  return (
    <header className={mergeClasses(styles.bar, 'uf-drag')} data-pane-titlebar="">
      <Tooltip content={label} relationship="label">
        <Hamburger className="uf-no-drag" onClick={() => actions.toggleLibrary()} aria-expanded={libraryOpen} data-focus-id="library-toggle" />
      </Tooltip>
      <span className={styles.icon}><AppIcon /></span>
      <Caption1 className={mergeClasses(styles.text, !focused && styles.inactive)}>Underframe Desktop</Caption1>
      {build ? (
        <>
          <Caption1 className={mergeClasses(styles.dot, !focused && styles.inactive)} aria-hidden="true">·</Caption1>
          <Caption1 className={mergeClasses(styles.build, !focused && styles.inactive)} title={`${name} • ${state}`}>
            {name} • {state}
          </Caption1>
        </>
      ) : null}
    </header>
  );
}
