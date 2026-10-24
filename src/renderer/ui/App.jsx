// Root: Fluent theme, the window shell (top bar, builds pane, workspace), dialogs and global shortcuts.
import { useEffect, useMemo } from 'react';
import { AriaLiveAnnouncer, FluentProvider, makeStyles } from '@fluentui/react-components';
import { makeTheme, layerVariables, shellBackground } from '../theme.js';
import { useApp, useMediaQuery, useWindowSize, layoutFor } from '../hooks.js';
import { store, isDirty } from '../controller.js';
import { uf } from '../platform.js';
import { buildToSave } from '../model.js';
import { TopBar } from './TopBar.jsx';
import { LibraryPane } from './LibraryPane.jsx';
import { Workspace } from './Workspace.jsx';
import { Toasts } from './Toasts.jsx';
import { OcrDialog } from './OcrDialog.jsx';
import { DropOverlay } from './DropOverlay.jsx';
import { Dialogs } from './Dialogs.jsx';
import { CompareDialog } from './CompareDialog.jsx';
import { BuffsDialog } from './BuffsDialog.jsx';
import { AutoBuildDialog } from './AutoBuildDialog.jsx';
import { Announcer } from './Announcer.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { useShortcuts } from './shortcuts.js';

const useStyles = makeStyles({
  // FluentProvider copies its className onto every portal mount node (tooltips, menus, toasts), so it must
  // carry no layout: a full-height portal node at z-index 1000000 would swallow every mouse click.
  // The shell sizes itself with 100vh instead.
  provider: {
    backgroundColor: 'transparent',
  },
  // One 48 px top bar, then the workspace: no toolbar row, no status bar (docs/declutter-spec.md 1).
  shell: {
    display: 'grid',
    gridTemplateRows: '48px minmax(0, 1fr)',
    height: '100vh',
    overflow: 'hidden',
  },
  main: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
  },
});

export function App() {
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const backdrop = uf.backdrop === 'mica' ? 'mica' : 'solid';
  const theme = useMemo(() => makeTheme({ dark, backdrop }), [dark, backdrop]);
  const vars = useMemo(() => layerVariables({ dark, backdrop }), [dark, backdrop]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.backdrop = backdrop;
    root.style.background = shellBackground({ dark, backdrop });
    document.body.style.background = 'transparent';
  }, [dark, backdrop]);

  return (
    <FluentProvider theme={theme} style={vars} className={useStyles().provider}>
      {/* AriaLiveAnnouncer provides useAnnounce() (the Announcer's completed-result message). */}
      <AriaLiveAnnouncer>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
      </AriaLiveAnnouncer>
    </FluentProvider>
  );
}

function useDocumentTitle() {
  const build = useApp(s => s.build);
  const snapshot = useApp(s => s.snapshot);
  useEffect(() => {
    if (!build) {
      document.title = 'Underframe Desktop';
      return;
    }
    const dirty = isDirty(store.get());
    document.title = `${dirty ? '• ' : ''}${buildToSave(build).name} - Underframe Desktop`;
  }, [build, snapshot]);
}

function Shell() {
  const styles = useStyles();
  const { width, height } = useWindowSize();
  const layout = layoutFor(width, height);
  const libraryOpenPref = useApp(s => s.ui.libraryOpen);
  const overlayOpen = useApp(s => s.overlayLibraryOpen ?? false);
  // The inline pane starts closed: the screen opens on the build, not on a list (docs/declutter-spec.md 5).
  const libraryOpen = layout.library === 'inline' ? libraryOpenPref ?? false : overlayOpen;

  useEffect(() => {
    store.set({ libraryMode: layout.library });
  }, [layout.library]);

  useDocumentTitle();
  useShortcuts();

  return (
    <div className={styles.shell}>
      <TopBar libraryOpen={libraryOpen} />
      <div className={styles.main}>
        <LibraryPane layout={layout} open={libraryOpen} />
        <Workspace layout={layout} />
      </div>
      <Toasts left={libraryOpen ? layout.libraryWidth + 16 : 16} />
      <OcrDialog />
      <DropOverlay />
      <Dialogs />
      <CompareDialog />
      <BuffsDialog />
      <AutoBuildDialog />
      <Announcer />
    </div>
  );
}
