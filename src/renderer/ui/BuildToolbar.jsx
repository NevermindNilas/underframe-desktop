// Build toolbar: name, save state, undo/redo, Save (split), More, Compare toggle.
import { useEffect, useState } from 'react';
import {
  Caption1, CounterBadge, Input, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner, SplitButton,
  Toolbar, ToolbarButton, ToolbarDivider, ToolbarToggleButton, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowRedoRegular, ArrowUndoRegular, CheckmarkRegular, CircleSmallFilled, ClipboardPasteRegular, CopyRegular,
  DeleteRegular, DesktopRegular, EditRegular, FolderOpenRegular, InfoRegular, KeyboardRegular, MoreHorizontalRegular,
  PanelBottomRegular, ScanTextRegular,
} from '@fluentui/react-icons';
import { chooseFile, importFromClipboard, importFromGame } from '../ocr-import.js';
import { actions, focusLater, store } from '../controller.js';
import { useApp } from '../hooks.js';
import { canRedo, canUndo } from '../history.js';
import { snapshotOf } from '../model.js';
import { DISPLAY_FONT } from '../theme.js';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '56px',
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalM,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  name: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: '160px',
    maxWidth: '420px',
    '& input': {
      fontFamily: DISPLAY_FONT,
      fontSize: tokens.fontSizeBase500,
      lineHeight: tokens.lineHeightBase500,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  state: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  dot: { color: tokens.colorBrandForeground1, display: 'inline-flex' },
  spacer: { flexGrow: 1 },
  toolbar: { flexShrink: 0, gap: tokens.spacingHorizontalXS },
  compare: { position: 'relative' },
  counter: { marginLeft: tokens.spacingHorizontalXS },
  visuallyHidden: {
    position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
  },
});

function SaveState({ build, snapshot, saving }) {
  const styles = useStyles();
  let content;
  if (saving) content = <><Spinner size="extra-tiny" aria-hidden="true" /> Saving…</>;
  else if (!build.id) content = <>Not saved yet</>;
  else if (snapshotOf(build) !== snapshot) content = <><span className={styles.dot} aria-hidden="true"><CircleSmallFilled /></span> Unsaved changes</>;
  else content = <><CheckmarkRegular aria-hidden="true" /> Saved</>;
  return <Caption1 className={styles.state} role="status">{content}</Caption1>;
}

/**
 * Name field: edits are live (no re-simulation); the undo step closes when the field loses focus.
 * While focused it keeps its own text (so a save that trims the name doesn't fight the typing), but when
 * another build opens or the build is saved as a copy (`editorEpoch`) it shows that build's name at once.
 */
function NameInput({ build, disabled }) {
  const styles = useStyles();
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
        appearance="underline"
        className={styles.name}
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
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </>
  );
}

export function BuildToolbar({ compactToolbar = false }) {
  const styles = useStyles();

  const ready = useApp(s => s.phase === 'ready');
  const build = useApp(s => s.build);
  const snapshot = useApp(s => s.snapshot);
  const saving = useApp(s => s.saving);
  const history = useApp(s => s.history);
  const pins = useApp(s => s.pins.length);
  const compareOpen = useApp(s => s.ui.compareOpen);
  const clean = Boolean(build?.id) && build && snapshotOf(build) === snapshot;
  const saveDisabled = !ready || saving || clean;

  return (
    <div className={styles.bar} data-pane="toolbar" role="region" aria-label="Build">
      <NameInput build={build} disabled={!ready} />
      {build ? <SaveState build={build} snapshot={snapshot} saving={saving} /> : null}
      <span className={styles.spacer} />
      <Toolbar
        aria-label="Build actions"
        className={styles.toolbar}
        checkedValues={{ panels: compareOpen ? ['compare'] : [] }}
        onCheckedValueChange={(_e, d) => { if (d.name === 'panels') actions.setCompareOpen(d.checkedItems.includes('compare')); }}
      >
        <Tooltip content="Undo (Ctrl+Z)" relationship="label">
          <ToolbarButton icon={<ArrowUndoRegular />} disabled={!ready || !canUndo(history)} onClick={() => actions.undo()} />
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Y)" relationship="label">
          <ToolbarButton icon={<ArrowRedoRegular />} disabled={!ready || !canRedo(history)} onClick={() => actions.redo()} />
        </Tooltip>
        <ToolbarDivider />
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            {triggerProps => (
              <Tooltip content="Recognise a build from a screenshot of the arsenal (Ctrl+I)" relationship="description">
                <SplitButton
                  appearance="subtle"
                  icon={<ScanTextRegular />}
                  menuButton={{ ...triggerProps, 'aria-label': 'More import options', disabled: !ready }}
                  primaryActionButton={{ onClick: () => chooseFile(), disabled: !ready, 'data-testid': 'ocr-button', 'data-focus-id': 'ocr-button' }}
                >
                  {compactToolbar ? 'Import' : 'Import from screenshot'}
                </SplitButton>
              </Tooltip>
            )}
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<ClipboardPasteRegular />} secondaryContent="Ctrl+V" onClick={() => importFromClipboard()}>Paste screenshot</MenuItem>
              <MenuItem icon={<DesktopRegular />} secondaryContent="Ctrl+Shift+G" onClick={() => importFromGame()}>Read from game window</MenuItem>
              <MenuItem icon={<FolderOpenRegular />} secondaryContent="Ctrl+I" onClick={() => chooseFile()}>Choose file…</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <ToolbarDivider />
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            {triggerProps => (
              <Tooltip content={clean ? 'No changes to save' : 'Save (Ctrl+S)'} relationship="description">
                {/* Nothing to save: the whole split button turns secondary, so the half-disabled control
                    doesn't read as broken; "Save as copy" stays available in its menu. */}
                <SplitButton
                  appearance={clean ? 'secondary' : 'primary'}
                  menuButton={{ ...triggerProps, 'aria-label': 'More save options', disabled: !ready }}
                  primaryActionButton={{ onClick: () => actions.save(), disabledFocusable: saveDisabled }}
                >
                  Save
                </SplitButton>
              </Tooltip>
            )}
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<CopyRegular />} secondaryContent="Ctrl+Shift+S" onClick={() => actions.saveAsCopy()}>Save as copy</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="More" relationship="label">
              <ToolbarButton icon={<MoreHorizontalRegular />} disabled={!ready} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<AddRegular />} secondaryContent="Ctrl+N" onClick={() => actions.newBuild()}>New build</MenuItem>
              <MenuItem icon={<CopyRegular />} onClick={() => actions.duplicateCurrent()}>Duplicate</MenuItem>
              <MenuItem icon={<EditRegular />} secondaryContent="F2" onClick={() => focusLater('build-name')}>Rename</MenuItem>
              <MenuItem icon={<DeleteRegular />} disabled={!build?.id || saving} onClick={() => actions.deleteCurrent()}>Delete build</MenuItem>
              <MenuDivider />
              <MenuItem icon={<KeyboardRegular />} secondaryContent="Ctrl+/" onClick={() => actions.openDialog('shortcuts')}>Keyboard shortcuts</MenuItem>
              <MenuItem icon={<InfoRegular />} onClick={() => actions.openDialog('about')}>About</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <ToolbarDivider />
        <Tooltip content="Compare pinned results (Ctrl+J)" relationship="description">
          <ToolbarToggleButton
            name="panels"
            value="compare"
            icon={<PanelBottomRegular />}
            disabled={!ready}
            data-focus-id="compare-toggle"
          >
            Compare
            {pins > 0 ? <CounterBadge className={styles.counter} count={pins} size="medium" appearance="filled" color="informative" aria-label={`${pins} pinned`} /> : null}
          </ToolbarToggleButton>
        </Tooltip>
      </Toolbar>
    </div>
  );
}
