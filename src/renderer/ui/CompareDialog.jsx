// The Compare dialog (Readout › Expand, Ctrl+J; docs/declutter-spec.md 4): every pinned result in a sortable
// DataGrid against a baseline pin, with the sheet values next to DPS and TTK. Each row says what differs from the
// baseline ("Serration R10→R0", "Steel Path on"), so pins of one build can be told apart.
import { useMemo } from 'react';
import {
  Button, Caption1, DataGrid, DataGridBody, DataGridCell, DataGridHeader, DataGridHeaderCell, DataGridRow, Dialog, DialogActions,
  DialogBody, DialogContent, DialogSurface, DialogTitle, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip,
  createTableColumn, makeStyles, tokens,
} from '@fluentui/react-components';
import { DeleteRegular, DismissRegular, MoreHorizontalRegular, TargetRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { compareRows } from '../model.js';
import { fmtInt, fmtNum, fmtPct } from '../format.js';
import { DeltaText } from './common.jsx';

const useStyles = makeStyles({
  surface: { maxWidth: 'min(1180px, 96vw)', width: 'min(1180px, 96vw)' },
  content: { maxHeight: '60vh', overflowY: 'auto' },
  num: { justifyContent: 'flex-end', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  numButton: { justifyContent: 'flex-end', textAlign: 'right' },
  nameStack: { display: 'flex', flexDirection: 'column', minWidth: 0, paddingTop: tokens.spacingVerticalXXS, paddingBottom: tokens.spacingVerticalXXS },
  sub: { color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  actionsCol: { justifyContent: 'flex-end' },
});

/** Relative column widths (flex-grow over a 0 basis); numbers are fixed. */
const COLUMN_FLEX = {
  build: '3 1 170px', changes: '3 1 130px', target: '3 1 170px',
  dps: '0 0 72px', delta: '0 0 76px', ttk: '0 0 64px', crit: '0 0 52px', status: '0 0 56px', fireRate: '0 0 72px',
  actions: '0 0 40px',
};
const NUMERIC = new Set(['dps', 'delta', 'ttk', 'crit', 'status', 'fireRate']);

const stat = (r, k, fmt) => (Number.isFinite(r.stats?.[k]) ? fmt(r.stats[k]) : '—');

export function CompareDialog() {
  const styles = useStyles();
  const open = useApp(s => s.compareOpen);
  const pins = useApp(s => s.pins);
  const baselineId = useApp(s => s.baselineId);
  const rows = useMemo(() => compareRows(pins, baselineId), [pins, baselineId]);

  const columns = useMemo(() => [
    createTableColumn({
      columnId: 'build',
      compare: (a, b) => a.buildName.localeCompare(b.buildName),
      renderHeaderCell: () => 'Build',
      renderCell: r => (
        <span className={styles.nameStack}>
          <span className={styles.text} title={r.buildName}>{r.baseline ? <><strong>Baseline</strong> · </> : null}{r.buildName}</span>
          <Caption1 className={styles.sub} title={`${r.weaponName} · ${r.modeName}`}>{r.weaponName} · {r.modeName}</Caption1>
        </span>
      ),
    }),
    createTableColumn({
      columnId: 'changes',
      compare: (a, b) => a.changesText.localeCompare(b.changesText),
      renderHeaderCell: () => 'Changes',
      renderCell: r => <span className={styles.text} title={r.changesText}>{r.changesText}</span>,
    }),
    createTableColumn({ columnId: 'target', compare: (a, b) => a.target.localeCompare(b.target), renderHeaderCell: () => 'Target', renderCell: r => <span className={styles.text} title={r.target}>{r.target}</span> }),
    createTableColumn({ columnId: 'dps', compare: (a, b) => a.avgDps - b.avgDps, renderHeaderCell: () => 'Avg DPS', renderCell: r => fmtInt(r.avgDps) }),
    createTableColumn({
      columnId: 'delta',
      compare: (a, b) => (a.delta ?? 0) - (b.delta ?? 0),
      renderHeaderCell: () => 'vs baseline',
      renderCell: r => (r.delta == null || Math.abs(r.delta) < 0.0005 ? <span className={styles.muted}>—</span> : <DeltaText delta={r.delta} />),
    }),
    createTableColumn({ columnId: 'ttk', compare: (a, b) => (a.ttk ?? Infinity) - (b.ttk ?? Infinity), renderHeaderCell: () => 'TTK', renderCell: r => r.ttkText }),
    createTableColumn({ columnId: 'crit', compare: (a, b) => (a.stats?.critChance ?? 0) - (b.stats?.critChance ?? 0), renderHeaderCell: () => 'Crit', renderCell: r => stat(r, 'critChance', v => fmtPct(v, 0)) }),
    createTableColumn({ columnId: 'status', compare: (a, b) => (a.stats?.statusChance ?? 0) - (b.stats?.statusChance ?? 0), renderHeaderCell: () => 'Status', renderCell: r => stat(r, 'statusChance', v => fmtPct(v, 0)) }),
    createTableColumn({ columnId: 'fireRate', compare: (a, b) => (a.stats?.fireRate ?? 0) - (b.stats?.fireRate ?? 0), renderHeaderCell: () => 'Fire rate', renderCell: r => stat(r, 'fireRate', v => `${fmtNum(v, 2)}/s`) }),
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
  ], [styles]);

  return (
    <Dialog open={open} onOpenChange={(_e, d) => actions.setCompareOpen(d.open)}>
      <DialogSurface className={styles.surface} data-testid="compare-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.setCompareOpen(false)} />}>
            Compare · {pins.length} pinned
          </DialogTitle>
          <DialogContent className={styles.content}>
            {pins.length ? (
              <DataGrid items={rows} columns={columns} sortable focusMode="composite" getRowId={r => r.id} size="small" data-testid="compare-grid" aria-label="Pinned results" resizableColumns={false}>
                <DataGridHeader>
                  <DataGridRow>
                    {({ renderHeaderCell, columnId }) => (
                      <DataGridHeaderCell
                        style={{ flex: COLUMN_FLEX[columnId] }}
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
                    <DataGridRow key={rowId} onKeyDown={e => { if (e.key === 'Delete') { e.preventDefault(); actions.unpin(item.id); } }}>
                      {({ renderCell, columnId }) => (
                        <DataGridCell style={{ flex: COLUMN_FLEX[columnId] }} className={NUMERIC.has(columnId) ? styles.num : columnId === 'actions' ? styles.actionsCol : undefined}>
                          {renderCell(item)}
                        </DataGridCell>
                      )}
                    </DataGridRow>
                  )}
                </DataGridBody>
              </DataGrid>
            ) : <Caption1>Nothing pinned yet. Pin a result (Ctrl+P) to compare builds, mods or targets side by side.</Caption1>}
          </DialogContent>
          <DialogActions>
            {pins.length ? <Button onClick={() => actions.clearPins()}>Clear all</Button> : null}
            <Button appearance="primary" onClick={() => actions.setCompareOpen(false)}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
