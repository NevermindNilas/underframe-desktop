// Editor column: notices, weapon and fire mode, mod slots, target and notes. Scrolls on its own.
import {
  Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarGroup, MessageBarTitle,
  makeStyles, tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useElementWidth } from '../hooks.js';
import { WeaponRow } from './WeaponRow.jsx';
import { ModSlots } from './ModSlots.jsx';
import { TargetCard } from './TargetCard.jsx';
import { NotesCard } from './NotesCard.jsx';

const useStyles = makeStyles({
  scroll: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    outline: 'none',
  },
  // Inside the stacked (zoomed-in) layout the outer area scrolls; the editor must not scroll on its own.
  embedded: { overflowY: 'visible', flexGrow: 0, flexShrink: 0 },
  content: {
    maxWidth: '1120px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    boxSizing: 'border-box',
  },
  lower: { display: 'grid', gap: tokens.spacingHorizontalL, alignItems: 'start' },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
});

function Notices() {
  const styles = useStyles();
  const notices = useApp(s => s.notices);
  const upstream = useApp(s => s.upstream);
  const dismissed = useApp(s => s.upstreamDismissed);
  const showUpstream = upstream?.outdated && !dismissed;
  if (!notices.length && !showUpstream) return null;
  const dismiss = (label, onClick) => (
    <Button appearance="transparent" icon={<DismissRegular />} aria-label={`Dismiss ${label}`} onClick={onClick} />
  );
  return (
    <MessageBarGroup animate="exit-only">
      {showUpstream ? (
        <MessageBar key="upstream" intent="info" layout="multiline">
          <MessageBarBody>Newer Underframe data is available. Update the app to get the latest weapons and mods.</MessageBarBody>
          <MessageBarActions containerAction={dismiss('notice', () => actions.dismissUpstream())} />
        </MessageBar>
      ) : null}
      {notices.map(n => (
        <MessageBar key={n.id} intent={n.intent} layout="multiline">
          <MessageBarBody>
            {n.title ? <MessageBarTitle>{n.title}</MessageBarTitle> : null}
            {n.items.length === 1 ? n.items[0] : <ul className={styles.list}>{n.items.map(t => <li key={t}>{t}</li>)}</ul>}
          </MessageBarBody>
          <MessageBarActions containerAction={dismiss('notice', () => actions.dismissNotice(n.id))} />
        </MessageBar>
      ))}
    </MessageBarGroup>
  );
}

export function Editor({ layout, embedded = false }) {
  const styles = useStyles();
  const [ref, width] = useElementWidth();
  const gutter = layout.gutter;
  const contentWidth = Math.max(0, Math.min(1120, width - 2 * gutter));
  // UX spec 2.2: 2 slot columns in the narrow (overlay) class; otherwise 4 once the editor is wide enough.
  const columns = layout.library === 'overlay' || contentWidth < 680 ? 2 : 4;
  const sideBySide = contentWidth >= 1000;
  return (
    <div
      ref={ref}
      className={embedded ? `${styles.scroll} ${styles.embedded}` : styles.scroll}
      data-pane="editor"
      {...(embedded ? {} : { 'data-scroll-region': '' })}
      role="region"
      aria-label="Editor"
      tabIndex={-1}
    >
      <div className={styles.content} style={{ padding: `${gutter}px` }}>
        <Notices />
        <WeaponRow />
        <ModSlots columns={columns} />
        <div className={styles.lower} style={{ gridTemplateColumns: sideBySide ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
          <TargetCard />
          <NotesCard />
        </div>
      </div>
    </div>
  );
}

