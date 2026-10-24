// Top-level error boundary: a render-time exception shows a recovery panel instead of a blank window. The build
// lives in the store, outside React, so "Try again" re-mounts the UI with the build as it was; it clears the
// transient UI state (gallery search, dialogs, drags) that most likely caused the error.
import { Component } from 'react';
import { Body1, Button, Caption1, Subtitle1, makeStyles, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { DEFAULT_GALLERY, errors, store } from '../controller.js';

const useStyles = makeStyles({
  wrap: {
    display: 'grid',
    placeItems: 'center',
    height: '100vh',
    padding: '16px',
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '520px',
    padding: '24px',
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
  },
  head: { display: 'flex', alignItems: 'center', gap: '8px' },
  icon: { color: tokens.colorPaletteRedForeground1, fontSize: '24px' },
  detail: { color: tokens.colorNeutralForeground3, overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
});

function Fallback({ error, onRetry }) {
  const styles = useStyles();
  return (
    <div className={styles.wrap}>
      <div className={styles.panel} role="alert" data-testid="error-boundary">
        <div className={styles.head}>
          <ErrorCircleRegular className={styles.icon} aria-hidden="true" />
          <Subtitle1 as="h1">Something went wrong</Subtitle1>
        </div>
        <Body1>
          Part of the window failed to draw. Your build is still open: Try again redraws the window and clears the
          gallery search. Reload restarts the window and drops unsaved changes.
        </Body1>
        <Caption1 className={styles.detail}>{String(error?.message ?? error)}</Caption1>
        <div className={styles.actions}>
          <Button appearance="primary" onClick={onRetry} autoFocus>Try again</Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = () => {
      store.set(s => ({ gallery: { ...DEFAULT_GALLERY, tab: s.gallery?.tab === 'arcanes' ? 'arcanes' : 'mods' }, dialog: null, ocr: null, drag: null, pickup: null }));
      this.setState({ error: null });
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    errors.push(`render: ${error?.message ?? error}`);
    console.error('UI render error', error, info?.componentStack);
  }

  render() {
    if (this.state.error) return <Fallback error={this.state.error} onRetry={this.retry} />;
    return this.props.children;
  }
}
