// Library pane: saved builds ("My builds") and Underframe's featured builds. Inline from 1280 px, overlay below.
import { useMemo, useRef, useState } from 'react';
import {
  Body1Strong, Button, Caption1, DrawerBody, DrawerHeader, Field, InlineDrawer, Input, Link, List, ListItem, Menu,
  MenuButton, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarActions, MessageBarBody,
  OverlayDrawer, SearchBox, Skeleton, SkeletonItem, Tab, TabList, Tag, TagGroup, Tooltip, createFocusOutlineStyle,
  makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowSortRegular, CircleSmallFilled, DeleteRegular, CopyRegular, DismissRegular, EditRegular,
  LibraryRegular, MoreHorizontalRegular, OpenRegular,
} from '@fluentui/react-icons';
import { actions, focusLater, isDirty, store } from '../controller.js';
import { useApp } from '../hooks.js';
import { LIBRARY_SORTS, matchesBuildQuery, sortBuilds } from '../model.js';
import { fmtCompact, fmtRelative } from '../format.js';
import { EmptyState } from './common.jsx';

const useStyles = makeStyles({
  drawer: {
    backgroundColor: 'transparent',
    height: '100%',
    flexShrink: 0,
  },
  overlay: {
    // Overlay surfaces are opaque (UX spec 3.1). The pane opens under the title bar, so the pane toggle,
    // the build name and the caption buttons stay visible.
    backgroundColor: tokens.colorNeutralBackground2,
    top: '48px',
    height: 'calc(100% - 48px)',
  },
  overlayBackdrop: { top: '48px' },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
  },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  tabsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalS },
  grow: { flexGrow: 1 },
  body: {
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
    paddingBottom: tokens.spacingVerticalM,
    overscrollBehavior: 'contain',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '2px', margin: 0, padding: 0 },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minHeight: '52px',
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    outlineStyle: 'none',
    ...createFocusOutlineStyle({ style: { outlineRadius: tokens.borderRadiusMedium } }),
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
    ':hover .uf-item-more': { opacity: 1 },
    ':focus-within .uf-item-more': { opacity: 1 },
  },
  current: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Selected },
    '::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '12px',
      bottom: '12px',
      width: '3px',
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorBrandBackground,
    },
  },
  itemText: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  nameLine: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name2: {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  meta: { color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  more: { opacity: 0, flexShrink: 0 },
  moreVisible: { opacity: 1 },
  dirtyDot: { color: tokens.colorBrandForeground1, flexShrink: 0, display: 'inline-flex' },
  tags: { marginTop: tokens.spacingVerticalXS, flexWrap: 'wrap', rowGap: tokens.spacingVerticalXS },
  intro: { color: tokens.colorNeutralForeground2 },
  skeletonRow: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, padding: tokens.spacingHorizontalM },
  renameItem: { padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`, listStyle: 'none' },
});

export function LibraryPane({ layout, open }) {
  const styles = useStyles();
  if (layout.library === 'inline') {
    return (
      <InlineDrawer
        open={open}
        separator
        position="start"
        className={styles.drawer}
        style={{ width: layout.libraryWidth }}
        role="region"
        aria-label="Builds"
        data-pane="builds"
      >
        <LibraryContent />
      </InlineDrawer>
    );
  }
  // The overlay is a modal drawer: it keeps Fluent's role="dialog" (aria-modal), only named "Builds".
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_e, d) => actions.setLibraryOpen(d.open)}
      position="start"
      className={styles.overlay}
      backdrop={{ className: styles.overlayBackdrop }}
      style={{ width: layout.libraryWidth }}
      aria-label="Builds"
      data-pane="builds"
    >
      <LibraryContent overlay />
    </OverlayDrawer>
  );
}

function LibraryContent({ overlay = false }) {
  const styles = useStyles();
  const tab = useApp(s => s.ui.libraryTab);
  const sort = useApp(s => s.ui.librarySort);
  const featuredType = useApp(s => s.ui.featuredType);
  const ready = useApp(s => s.phase === 'ready');
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  return (
    <>
      <DrawerHeader className={styles.header}>
        <div className={styles.tabsRow}>
          <TabList size="small" selectedValue={tab} onTabSelect={(_e, d) => actions.setLibraryTab(d.value)} aria-label="Build lists">
            <Tab value="mine">My builds</Tab>
            <Tab value="featured">Featured</Tab>
          </TabList>
          {overlay ? (
            <Tooltip content="Close (Esc)" relationship="label">
              <Button appearance="subtle" icon={<DismissRegular />} onClick={() => actions.setLibraryOpen(false)} />
            </Tooltip>
          ) : null}
        </div>
        <SearchBox
          ref={searchRef}
          placeholder="Search builds"
          aria-label={tab === 'mine' ? 'Search my builds' : 'Search featured builds'}
          value={query}
          onChange={(_e, d) => setQuery(d.value)}
          disabled={!ready}
        />
        {tab === 'mine' ? (
          <div className={styles.row}>
            <Tooltip content="New build (Ctrl+N)" relationship="description">
              <Button className={styles.grow} icon={<AddRegular />} onClick={() => actions.newBuild()} data-focus-id="new-build" disabled={!ready}>
                New build
              </Button>
            </Tooltip>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Tooltip content={`Sort: ${LIBRARY_SORTS[sort]}`} relationship="label">
                  <MenuButton appearance="subtle" icon={<ArrowSortRegular />} aria-label={`Sort: ${LIBRARY_SORTS[sort]}`} />
                </Tooltip>
              </MenuTrigger>
              <MenuPopover>
                <MenuList checkedValues={{ sort: [sort] }} onCheckedValueChange={(_e, d) => actions.setLibrarySort(d.checkedItems[0])}>
                  {Object.entries(LIBRARY_SORTS).map(([value, label]) => (
                    <MenuItemRadio key={value} name="sort" value={value}>{label}</MenuItemRadio>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        ) : (
          <>
            <TabList size="small" selectedValue={featuredType} onTabSelect={(_e, d) => actions.setFeaturedType(d.value)} aria-label="Weapon type">
              <Tab value="All">All</Tab>
              <Tab value="Primary">Primary</Tab>
              <Tab value="Secondary">Secondary</Tab>
            </TabList>
            <Caption1 className={styles.intro}>Builds curated on Underframe. Opening one makes an unsaved copy you can change.</Caption1>
          </>
        )}
      </DrawerHeader>
      <DrawerBody className={styles.body} aria-label={tab === 'mine' ? 'My builds' : 'Featured builds'} data-scroll-region="">
        {tab === 'mine' ? <MyBuilds query={query} onClear={clearSearch} /> : <FeaturedBuilds query={query} type={featuredType} onClear={clearSearch} />}
      </DrawerBody>
    </>
  );
}

function SkeletonRows() {
  const styles = useStyles();
  return (
    <Skeleton aria-label="Loading builds">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <SkeletonItem size={16} style={{ width: '70%' }} />
          <SkeletonItem size={12} style={{ width: '50%' }} />
        </div>
      ))}
    </Skeleton>
  );
}

function NoMatch({ query, onClear }) {
  return (
    <EmptyState>
      No builds match "{query}". <Link onClick={onClear}>Clear search</Link>
    </EmptyState>
  );
}

function MyBuilds({ query, onClear }) {
  const styles = useStyles();
  const phase = useApp(s => s.phase);
  const status = useApp(s => s.savedStatus);
  const error = useApp(s => s.savedError);
  const saved = useApp(s => s.savedBuilds);
  const sort = useApp(s => s.ui.librarySort);
  const currentId = useApp(s => s.build?.id);
  const renamingId = useApp(s => s.renamingId);
  useApp(s => s.snapshot);
  const dirty = isDirty(store.get());
  const list = useMemo(() => sortBuilds(saved, sort).filter(b => matchesBuildQuery(b, query)), [saved, sort, query]);

  if (phase === 'error') return <EmptyState>Your builds appear once the app has started.</EmptyState>;
  if (phase === 'loading' || status === 'loading') return <SkeletonRows />;
  if (status === 'error') {
    return (
      <MessageBar intent="error" layout="multiline">
        <MessageBarBody>Couldn't read your saved builds. {error}</MessageBarBody>
        <MessageBarActions>
          <Button size="small" onClick={() => actions.reloadSavedBuilds()}>Try again</Button>
        </MessageBarActions>
      </MessageBar>
    );
  }
  if (!saved.length) {
    return (
      <EmptyState
        icon={<LibraryRegular />}
        title="No saved builds yet"
        actions={<Button size="small" onClick={() => actions.setLibraryTab('featured')}>Browse featured builds</Button>}
      >
        Pick a weapon and mods, then save with Ctrl+S.
      </EmptyState>
    );
  }
  if (!list.length) return <NoMatch query={query} onClear={onClear} />;
  return (
    <List navigationMode="items" className={styles.list} aria-label="My builds">
      {list.map(b => (b.id === renamingId
        ? <RenameRow key={b.id} build={b} />
        : <SavedItem key={b.id} build={b} current={b.id === currentId} dirty={b.id === currentId && dirty} />))}
    </List>
  );
}

function SavedItem({ build, current, dirty }) {
  const styles = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const saving = useApp(s => s.saving && s.build?.id === build.id);
  const meta = [build.weaponName, build.lastResult?.avgDps ? `${fmtCompact(build.lastResult.avgDps)} DPS` : null, fmtRelative(build.updatedAt)]
    .filter(Boolean).join(' · ');
  const name = build.name || 'Untitled build';
  const onKeyDown = e => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      if (!saving) actions.startRename(build.id);
    } else if (e.key === 'Delete' && !saving) {
      e.preventDefault();
      actions.deleteSaved(build.id);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !saving) {
      e.preventDefault();
      actions.duplicateSaved(build.id);
    } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      setMenuOpen(true);
    }
  };
  return (
    <ListItem
      value={build.id}
      className={mergeClasses(styles.item, current && styles.current)}
      aria-current={current ? 'true' : undefined}
      aria-label={`${name}, ${meta}${dirty ? ', unsaved changes' : ''}`}
      data-testid="library-item"
      data-focus-id={`library-${build.id}`}
      data-library-id={build.id}
      onAction={() => actions.openBuild(build.id)}
      onKeyDown={onKeyDown}
      onContextMenu={e => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <span className={styles.itemText}>
        <span className={styles.nameLine}>
          <Tooltip content={name} relationship="description" positioning="after">
            <Body1Strong className={styles.name}>{name}</Body1Strong>
          </Tooltip>
          {dirty ? <span className={styles.dirtyDot} role="img" aria-label="Unsaved changes"><CircleSmallFilled /></span> : null}
        </span>
        <Caption1 className={styles.meta}>{meta}</Caption1>
      </span>
      <Menu open={menuOpen} onOpenChange={(_e, d) => {
        setMenuOpen(d.open);
        if (!d.open) focusLater(`library-${build.id}`);
      }}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            icon={<MoreHorizontalRegular />}
            aria-label={`More options for ${name}`}
            tabIndex={-1}
            className={mergeClasses('uf-item-more', styles.more, current && styles.moreVisible)}
            onClick={e => e.stopPropagation()}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<OpenRegular />} onClick={() => actions.openBuild(build.id)}>Open</MenuItem>
            <MenuItem icon={<EditRegular />} secondaryContent="F2" disabled={saving} onClick={() => actions.startRename(build.id)}>Rename</MenuItem>
            <MenuItem icon={<CopyRegular />} secondaryContent="Ctrl+D" disabled={saving} onClick={() => actions.duplicateSaved(build.id)}>Duplicate</MenuItem>
            <MenuItem icon={<DeleteRegular />} secondaryContent="Del" disabled={saving} onClick={() => actions.deleteSaved(build.id)}>Delete</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </ListItem>
  );
}

function RenameRow({ build }) {
  const styles = useStyles();
  const [value, setValue] = useState(build.name);
  const [error, setError] = useState(null);
  const commit = async () => {
    if (!value.trim()) {
      setError('Enter a name');
      return;
    }
    await actions.renameSaved(build.id, value);
  };
  return (
    <li className={styles.renameItem}>
      <Field label="Rename build" validationMessage={error} validationState={error ? 'error' : 'none'} size="small">
        <Input
          autoFocus
          value={value}
          maxLength={120}
          onChange={(_e, d) => { setValue(d.value); if (error) setError(null); }}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); actions.cancelRename(); }
          }}
          onBlur={() => { if (value.trim()) commit(); else actions.cancelRename(); }}
        />
      </Field>
    </li>
  );
}

function FeaturedBuilds({ query, type, onClear }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const phase = useApp(s => s.phase);
  const list = useMemo(
    () => (ctx?.featured ?? []).filter(f => (type === 'All' || f.weaponType === type) && matchesBuildQuery(f, query)),
    [ctx, type, query],
  );
  if (phase === 'error') return <EmptyState>Featured builds appear once the app has started.</EmptyState>;
  if (phase === 'loading') return <SkeletonRows />;
  if (!ctx?.featured?.length) return <EmptyState>No featured gun builds in this data version.</EmptyState>;
  if (!list.length) return <NoMatch query={query || type} onClear={onClear} />;
  return (
    <List navigationMode="items" className={styles.list} aria-label="Featured builds">
      {list.map(f => (
        <ListItem
          key={f.key}
          value={f.key}
          className={styles.item}
          data-testid="featured-item"
          aria-label={`${f.name}, ${f.weaponName}, ${f.weaponType}${f.tags.length ? `, ${f.tags.join(', ')}` : ''}`}
          onAction={() => actions.openFeatured(f.key)}
        >
          <span className={styles.itemText}>
            <Tooltip content={f.name} relationship="description" positioning="after">
              <Body1Strong className={styles.name2}>{f.name}</Body1Strong>
            </Tooltip>
            <Caption1 className={styles.meta}>{f.weaponName} · {f.weaponType}</Caption1>
            {f.tags.length ? (
              <TagGroup className={styles.tags} aria-label="Tags" role="list">
                {f.tags.map(t => <Tag key={t} size="extra-small" appearance="outline" role="listitem">{t}</Tag>)}
              </TagGroup>
            ) : null}
          </span>
        </ListItem>
      ))}
    </List>
  );
}
