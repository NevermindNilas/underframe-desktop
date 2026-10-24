// The top bar (docs/declutter-spec.md 1): the only chrome, 48 px, the title bar and the build toolbar in one.
// Builds, the build name (rename in place), the save state when it matters, Undo, Redo, Import, Save and More.
// Native caption buttons are drawn by Windows (titleBarOverlay); this bar never extends under them.
import { useEffect, useState } from 'react';
import {
  Button, Caption1, Hamburger, Input, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner,
  Toolbar, ToolbarButton, Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowRedoRegular, ArrowUndoRegular, ChatRegular, ChevronDownRegular, ClipboardPasteRegular, CopyRegular,
  DeleteRegular, DesktopRegular, EditRegular, FolderOpenRegular, InfoRegular, KeyboardRegular, MoreHorizontalRegular,
  SaveCopyRegular, ScanTextRegular,
} from '@fluentui/react-icons';
import { chooseFile, importFromClipboard, importFromGame } from '../ocr-import.js';
import { actions, focusLater, store } from '../controller.js';
import { useApp, useWindowFocused } from '../hooks.js';
import { canRedo, canUndo } from '../history.js';
import { snapshotOf } from '../model.js';
import { DISPLAY_FONT } from '../theme.js';
import { AppIcon } from './common.jsx';
import { DISCORD_URL } from './links.js';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    height: '48px',
    // Leave room for the caption buttons: the overlay reports the free area through env().
    width: 'env(titlebar-area-width, calc(100% - 140px))',
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
    boxSizing: 'border-box',
    minWidth: 0,
    userSelect: 'none',
  },
  icon: { display: 'inline-flex', flexShrink: 0, marginLeft: tokens.spacingHorizontalXS, marginRight: tokens.spacingHorizontalXS },
  // The name reads as the window's title until it is hovered or focused, then it is a field.
  name: {
    flexShrink: 1,
    minWidth: '120px',
    maxWidth: '360px',
    backgroundColor: 'transparent',
    border: 'none',
    '::after': { display: 'none' },
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
    ':focus-within': { backgroundColor: tokens.colorNeutralBackground1, outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
    '& input': {
      fontFamily: DISPLAY_FONT,
      fontSize: tokens.fontSizeBase400,
      lineHeight: tokens.lineHeightBase400,
      fontWeight: tokens.fontWeightSemibold,
      textOverflow: 'ellipsis',
    },
  },
  inactive: { '& input': { color: tokens.colorNeutralForegroundDisabled } },
  state: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  spacer: { flexGrow: 1, alignSelf: 'stretch', minWidth: '16px' },
  toolbar: { flexShrink: 0, gap: tokens.spacingHorizontalXXS, padding: 0 },
  save: { minWidth: '72px' },
  visuallyHidden: {
    position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
  },
});

/** The save state, only when it says something: "Saving…", "Unsaved" (never saved), "Edited" (changed since). */
export function saveStateText({ build, snapshot, saving }) {
  if (saving) return 'Saving…';
  if (!build) return '';
  if (!build.id) return 'Unsaved';
  return snapshotOf(build) !== snapshot ? 'Edited' : '';
}

/**
 * Name field: edits are live (no re-simulation); the undo step closes when the field loses focus.
 * While focused it keeps its own text (so a save that trims the name doesn't fight the typing), but when
 * another build opens or the build is saved as a copy (`editorEpoch`) it shows that build's name at once.
 */
function NameInput({ build, disabled }) {
  const styles = useStyles();
  const focusedWindow = useWindowFocused();
  const epoch = useApp(s => s.editorEpoch);
  const [value, setValue] = useState(build?.name ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setValue(build?.name ?? '');
  }, [build?.name, focused]);
  useEffect(() => {
    setValue(store.get().build?.name ?? '');
  }, [epoch]);
  return (
    <>
      <label htmlFor="build-name" className={styles.visuallyHidden}>Build name</label>
      <Input
        id="build-name"
        data-focus-id="build-name"
        className={mergeClasses(styles.name, 'uf-no-drag', !focusedWindow && styles.inactive)}
        // As wide as the name (it reads as the window's title), within limits.
        style={{ width: `calc(${Math.min(40, Math.max(8, (value || 'Untitled build').length + 1))}ch + 28px)` }}
        value={value}
        maxLength={120}
        placeholder="Untitled build"
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(_e, d) => {
          setValue(d.value);
          actions.setName(d.value);
        }}
        onBlur={() => {
          setFocused(false);
          actions.endTextEdit();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
      />
    </>
  );
}

function ImportMenu({ disabled }) {
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Import a build from a screenshot of the arsenal" relationship="description">
          <ToolbarButton
            className="uf-no-drag"
            icon={<ScanTextRegular />}
            disabled={disabled}
            data-testid="ocr-button"
            data-focus-id="ocr-button"
          >
            Import <ChevronDownRegular style={{ marginLeft: 4, fontSize: 12 }} aria-hidden="true" />
          </ToolbarButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<FolderOpenRegular />} secondaryContent="Ctrl+I" onClick={() => chooseFile()} data-testid="ocr-choose-file">Choose screenshot file…</MenuItem>
          <MenuItem icon={<ClipboardPasteRegular />} secondaryContent="Ctrl+V" onClick={() => importFromClipboard()}>Paste screenshot</MenuItem>
          <MenuItem icon={<DesktopRegular />} secondaryContent="Ctrl+Shift+G" onClick={() => importFromGame()}>Read from game window</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function MoreMenu({ disabled, build, saving }) {
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="More" relationship="label">
          <Button appearance="subtle" className="uf-no-drag" icon={<MoreHorizontalRegular />} disabled={disabled} data-testid="top-more" />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<AddRegular />} secondaryContent="Ctrl+N" onClick={() => actions.newBuild()}>New build</MenuItem>
          <MenuItem icon={<SaveCopyRegular />} secondaryContent="Ctrl+Shift+S" onClick={() => actions.saveAsCopy()}>Save a copy</MenuItem>
          <MenuItem icon={<CopyRegular />} onClick={() => actions.duplicateCurrent()}>Duplicate</MenuItem>
          <MenuItem icon={<EditRegular />} secondaryContent="F2" onClick={() => focusLater('build-name')}>Rename</MenuItem>
          <MenuItem icon={<DeleteRegular />} disabled={!build?.id || saving} onClick={() => actions.deleteCurrent()}>Delete build</MenuItem>
          <MenuDivider />
          <MenuItem icon={<KeyboardRegular />} secondaryContent="Ctrl+/" onClick={() => actions.openDialog('shortcuts')}>Keyboard shortcuts</MenuItem>
          <MenuItem icon={<InfoRegular />} onClick={() => actions.openDialog('about')}>About and credits</MenuItem>
          <MenuItem icon={<ChatRegular />} onClick={() => actions.openExternal(DISCORD_URL)}>Discord</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function TopBar({ libraryOpen }) {
  const styles = useStyles();
  const ready = useApp(s => s.phase === 'ready');
  const build = useApp(s => s.build);
  const snapshot = useApp(s => s.snapshot);
  const saving = useApp(s => s.saving);
  const history = useApp(s => s.history);
  const clean = Boolean(build?.id) && build && snapshotOf(build) === snapshot;
  const state = saveStateText({ build, snapshot, saving });
  const label = libraryOpen ? 'Hide builds (Ctrl+B)' : 'Show builds (Ctrl+B)';
  return (
    <header className={mergeClasses(styles.bar, 'uf-drag')} data-pane="topbar" aria-label="Build">
      <Tooltip content={label} relationship="label">
        <Hamburger className="uf-no-drag" onClick={() => actions.toggleLibrary()} aria-expanded={libraryOpen} data-focus-id="library-toggle" />
      </Tooltip>
      <span className={styles.icon}><AppIcon /></span>
      <NameInput build={build} disabled={!ready} />
      <Caption1 className={styles.state} role="status" data-testid="save-state">
        {saving ? <Spinner size="extra-tiny" aria-hidden="true" /> : null}
        {state}
      </Caption1>
      <span className={styles.spacer} />
      <Toolbar aria-label="Build actions" className={styles.toolbar}>
        <Tooltip content="Undo (Ctrl+Z)" relationship="label">
          <ToolbarButton className="uf-no-drag" icon={<ArrowUndoRegular />} disabled={!ready || !canUndo(history)} onClick={() => actions.undo()} />
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Y)" relationship="label">
          <ToolbarButton className="uf-no-drag" icon={<ArrowRedoRegular />} disabled={!ready || !canRedo(history)} onClick={() => actions.redo()} />
        </Tooltip>
        <ImportMenu disabled={!ready} />
      </Toolbar>
      <Tooltip content={clean ? 'No changes to save' : 'Save (Ctrl+S)'} relationship="description">
        <Button
          className={mergeClasses(styles.save, 'uf-no-drag')}
          appearance={clean ? 'subtle' : 'primary'}
          disabledFocusable={!ready || saving || clean}
          onClick={() => actions.save()}
          data-testid="save"
        >
          Save
        </Button>
      </Tooltip>
      <MoreMenu disabled={!ready} build={build} saving={saving} />
    </header>
  );
}
