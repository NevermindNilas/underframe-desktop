// Compare drawer: pinned results in a sortable DataGrid, measured against a baseline pin. Each row says
// what differs from the baseline ("Serration R10→R0", "Steel Path on"), so pins of one build can be told apart.
import { useMemo } from 'react';
import {
  Badge, Button, Caption1, DataGrid, DataGridBody, DataGridCell, DataGridHeader, DataGridHeaderCell, DataGridRow,
  DrawerBody, DrawerHeader, DrawerHeaderTitle, InlineDrawer, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger,
  Tooltip, createTableColumn, makeStyles, tokens,
} from '@fluentui/react-components';
import { DeleteRegular, DismissRegular, MoreHorizontalRegular, PinRegular, TargetRegular } from '@fluentui/react-icons';
import { actions, simKey } from '../controller.js';
import { useApp, useElementWidth } from '../hooks.js';
import { compareRows } from '../model.js';
import { fmtInt } from '../format.js';
import { DeltaBadge } from './common.jsx';

const useStyles = makeStyles({
  drawer: {
    height: 'clamp(200px, 32vh, 360px)',
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  header: { paddingTop: tokens.spacingVerticalS, paddingBottom: tokens.spacingVerticalXS },
  body: { paddingBottom: tokens.spacingVerticalM },
  num: { justifyContent: 'flex-end', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  // The sort button fills the header cell: right-align its content over right-aligned numbers.
  numButton: { justifyContent: 'flex-end', textAlign: 'right' },
  name: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  nameStack: { display: 'flex', flexDirection: 'column', minWidth: 0, paddingTop: tokens.spacingVerticalXXS, paddingBottom: tokens.spacingVerticalXXS },
  sub: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  badge: { flexShrink: 0 },
  measure: { width: '100%' },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  changes: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: tokens.colorNeutralForeground2 },
  empty: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap', paddingTop: tokens.spacingVerticalS },
  actionsCol: { justifyContent: 'flex-end' },
});

/** Relative column widths (flex-grow over a 0 basis); actions is fixed. Text columns get room, numbers fit. */
const COLUMN_FLEX = {
  build: '2 1 0px', changes: '3 1 0px', weapon: '1.6 1 0px', mode: '1.2 1 0px', target: '2.6 1 0px',
  dps: '0 0 84px', delta: '0 0 100px', ttk: '0 0 104px', actions: '0 0 44px',
};
/** Below this grid width, weapon and mode move under the build name instead of having columns. */
const NARROW = 900;
const NARROW_FLEX = { ...COLUMN_FLEX, build: '3 1 0px', changes: '2.4 1 0px', target: '2 1 0px', dps: '0 0 72px', delta: '0 0 92px', ttk: '0 0 88px' };
const NUMERIC = new Set(['dps', 'delta', 'ttk']);

/** Truncated text with the full text in a Fluent tooltip. */
function Clipped({ text, className }) {
  return (
    <Tooltip content={text} relationship="description" positioning="above-start">
      <span className={className}>{text}</span>
    </Tooltip>
  );
}

export function CompareDrawer() {
  const styles = useStyles();
  const open = useApp(s => s.ui.compareOpen);
  const pins = useApp(s => s.pins);
  const baselineId = useApp(s => s.baselineId);
  const sim = useApp(s => s.sim);
  useApp(s => s.build);
  const canPin = sim.summary?.ok && sim.key === simKey() && sim.status === 'done';
  const rows = useMemo(() => compareRows(pins, baselineId), [pins, baselineId]);
  const [measureRef, width] = useElementWidth();
  const narrow = width > 0 && width < NARROW;

  const columns = useMemo(() => [
    createTableColumn({
      columnId: 'build',
      compare: (a, b) => a.buildName.localeCompare(b.buildName),
      renderHeaderCell: () => 'Build',
      renderCell: r => {
        const name = (
          <span className={styles.name}>
            <Clipped text={r.buildName} className={styles.text} />
            {r.baseline ? <Badge appearance="tint" color="brand" size="medium" className={styles.badge}>Baseline</Badge> : null}
          </span>
        );
        if (!narrow) return name;
        return (
          <span className={styles.nameStack}>
            {name}
            <Clipped text={`${r.weaponName} · ${r.modeName}`} className={styles.sub} />
          </span>
        );
      },
    }),
    createTableColumn({
      columnId: 'changes',
      compare: (a, b) => a.changesText.localeCompare(b.changesText),
      renderHeaderCell: () => 'Changes',
      renderCell: r => <Clipped text={r.changesText} className={styles.changes} />,
    }),
    ...(narrow ? [] : [
      createTableColumn({ columnId: 'weapon', compare: (a, b) => a.weaponName.localeCompare(b.weaponName), renderHeaderCell: () => 'Weapon', renderCell: r => <Clipped text={r.weaponName} className={styles.text} /> }),
      createTableColumn({ columnId: 'mode', compare: (a, b) => String(a.modeName).localeCompare(String(b.modeName)), renderHeaderCell: () => 'Mode', renderCell: r => <Clipped text={r.modeName} className={styles.text} /> }),
    ]),
    createTableColumn({ columnId: 'target', compare: (a, b) => a.target.localeCompare(b.target), renderHeaderCell: () => 'Target', renderCell: r => <Clipped text={r.target} className={styles.text} /> }),
    createTableColumn({ columnId: 'dps', compare: (a, b) => a.avgDps - b.avgDps, renderHeaderCell: () => 'Avg DPS', renderCell: r => fmtInt(r.avgDps) }),
    createTableColumn({
      columnId: 'delta',
      compare: (a, b) => (a.delta ?? 0) - (b.delta ?? 0),
      renderHeaderCell: () => 'vs baseline',
      renderCell: r => (r.delta == null ? '—' : <DeltaBadge delta={Math.abs(r.delta) < 0.0005 ? null : r.delta} />),
    }),
    createTableColumn({
      columnId: 'ttk',
      compare: (a, b) => (a.ttk ?? Infinity) - (b.ttk ?? Infinity),
      renderHeaderCell: () => 'TTK',
      renderCell: r => r.ttkText,
    }),
    createTableColumn({
      columnId: 'actions',
      renderHeaderCell: () => <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span>,
      renderCell: r => (
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={`More options for ${r.buildName}`} relationship="label">
              <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<TargetRegular />} disabled={r.baseline} onClick={() => actions.setBaseline(r.id)}>Use as baseline</MenuItem>
              <MenuItem icon={<DeleteRegular />} secondaryContent="Del" onClick={() => actions.unpin(r.id)}>Remove</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      ),
    }),
  ], [styles, narrow]);

  return (
    <InlineDrawer open={open} position="bottom" className={styles.drawer} data-pane="compare" role="region" aria-label="Compare">
      <DrawerHeader className={styles.header}>
        <DrawerHeaderTitle
          action={(
            <>
              {pins.length ? <Button appearance="subtle" onClick={() => actions.clearPins()}>Clear all</Button> : null}
              <Tooltip content="Close compare (Ctrl+J)" relationship="label">
                <Button appearance="subtle" icon={<DismissRegular />} onClick={() => actions.setCompareOpen(false)} />
              </Tooltip>
            </>
          )}
        >
          Compare
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={styles.body} data-scroll-region="" aria-label="Pinned results">
        <div ref={measureRef} className={styles.measure} />
        {pins.length ? (
          <DataGrid
            items={rows}
            columns={columns}
            sortable
            focusMode="composite"
            getRowId={r => r.id}
            size="small"
            data-testid="compare-grid"
            aria-label="Pinned results"
            resizableColumns={false}
          >
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell, columnId }) => (
                  <DataGridHeaderCell
                    style={{ flex: (narrow ? NARROW_FLEX : COLUMN_FLEX)[columnId] }}
                    className={columnId === 'actions' ? styles.actionsCol : undefined}
                    button={NUMERIC.has(columnId) ? { className: styles.numButton } : undefined}
                  >
                    {renderHeaderCell()}
                  </DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody>
              {({ item, rowId }) => (
                <DataGridRow
                  key={rowId}
                  onKeyDown={e => {
                    if (e.key === 'Delete') {
                      e.preventDefault();
                      actions.unpin(item.id);
                    }
                  }}
                >
                  {({ renderCell, columnId }) => (
                    <DataGridCell
                      style={{ flex: (narrow ? NARROW_FLEX : COLUMN_FLEX)[columnId] }}
                      className={NUMERIC.has(columnId) ? styles.num : columnId === 'actions' ? styles.actionsCol : undefined}
                    >
                      {renderCell(item)}
                    </DataGridCell>
                  )}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        ) : (
          <div className={styles.empty}>
            <Caption1>Pin a result to compare builds, mods or targets side by side.</Caption1>
            <Tooltip content={canPin ? 'Pin to compare (Ctrl+P)' : 'Wait for a result to pin'} relationship="description">
              <Button size="small" icon={<PinRegular />} disabledFocusable={!canPin} data-focus-id="pin-current" onClick={() => actions.pinResult()}>Pin current result</Button>
            </Tooltip>
          </div>
        )}
      </DrawerBody>
    </InlineDrawer>
  );
}
