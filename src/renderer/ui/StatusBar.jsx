// Status bar: credits (never truncated), data and app versions, upstream notice, links, About.
// Right-side items collapse into a "More" menu at narrow widths (Fluent Overflow).
import {
  Badge, Button, Caption1, Link, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Overflow, OverflowItem, Tooltip,
  makeStyles, tokens, useIsOverflowItemVisible, useOverflowMenu,
} from '@fluentui/react-components';
import { MoreHorizontalRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { fmtDate, fmtShortDate } from '../format.js';
import { DISCORD_URL, UNDERFRAME_URL } from './Workspace.jsx';

export const CREDIT_TEXT = 'Damage engine and game data by Underframe (underframe.site), used with permission. Not affiliated with Digital Extremes.';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    height: '28px',
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  credit: { flexShrink: 0, whiteSpace: 'nowrap' },
  right: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexGrow: 1, minWidth: 0, justifyContent: 'flex-end', overflow: 'hidden' },
  item: { whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', minHeight: '24px' },
  link: { minHeight: '24px', display: 'inline-flex', alignItems: 'center' },
  about: { minWidth: 'auto', height: '24px', paddingLeft: tokens.spacingHorizontalS, paddingRight: tokens.spacingHorizontalS },
});

function useItems() {
  const manifest = useApp(s => s.manifest);
  const info = useApp(s => s.appInfo);
  const upstream = useApp(s => s.upstream);
  const items = [];
  if (manifest) {
    const short = String(manifest.dataVersion ?? '?').slice(0, 7);
    items.push({
      id: 'data',
      label: `Data ${short}${manifest.fetchedAt ? ` · ${fmtShortDate(manifest.fetchedAt)}` : ''}`,
      tooltip: `Data version ${manifest.dataVersion ?? 'unknown'}${manifest.fetchedAt ? `, fetched ${fmtDate(manifest.fetchedAt)}` : ''}`,
    });
  }
  if (info) items.push({ id: 'app', label: `App ${info.version}` });
  if (upstream?.outdated) {
    items.push({ id: 'outdated', label: 'Newer data available', badge: true, tooltip: 'Underframe has newer game data. Update the app to get it.' });
  }
  items.push({ id: 'discord', label: 'Discord', run: () => actions.openExternal(DISCORD_URL), link: true });
  items.push({ id: 'about', label: 'About', run: () => actions.openDialog('about'), button: true });
  return items;
}

function ItemView({ item }) {
  const styles = useStyles();
  let el;
  if (item.badge) el = <Badge appearance="tint" color="informative" tabIndex={0}>{item.label}</Badge>;
  else if (item.link) el = <Link className={styles.link} onClick={item.run}>{item.label}</Link>;
  else if (item.button) el = <Button appearance="transparent" size="small" className={styles.about} onClick={item.run}>{item.label}</Button>;
  else el = <Caption1 className={styles.item} tabIndex={item.tooltip ? 0 : undefined}>{item.label}</Caption1>;
  return item.tooltip ? <Tooltip content={item.tooltip} relationship="description">{el}</Tooltip> : el;
}

function OverflowMenuItem({ item }) {
  const visible = useIsOverflowItemVisible(item.id);
  if (visible) return null;
  return <MenuItem onClick={item.run} disabled={!item.run && !item.tooltip}>{item.tooltip && !item.run ? `${item.label} (${item.tooltip})` : item.label}</MenuItem>;
}

function MoreMenu({ items }) {
  const { ref, isOverflowing, overflowCount } = useOverflowMenu();
  if (!isOverflowing) return null;
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button ref={ref} appearance="transparent" size="small" icon={<MoreHorizontalRegular />} aria-label={`${overflowCount} more status items`} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>{items.map(it => <OverflowMenuItem key={it.id} item={it} />)}</MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function StatusBar() {
  const styles = useStyles();
  const items = useItems();
  return (
    <footer className={styles.bar}>
      <Caption1 className={styles.credit}>
        Damage engine and game data by Underframe (<Link className={styles.link} onClick={() => actions.openExternal(UNDERFRAME_URL)} inline>underframe.site</Link>), used with permission. Not affiliated with Digital Extremes.
      </Caption1>
      <Overflow padding={8}>
        <div className={styles.right}>
          {items.map(it => (
            <OverflowItem key={it.id} id={it.id} priority={it.id === 'about' ? 5 : it.id === 'outdated' ? 4 : it.id === 'data' ? 3 : 1}>
              <span className={styles.item}><ItemView item={it} /></span>
            </OverflowItem>
          ))}
          <MoreMenu items={items} />
        </div>
      </Overflow>
    </footer>
  );
}
