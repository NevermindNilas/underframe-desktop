// Best mod tab: the background sweep for one slot. Progress and Cancel while running; ranked results with
// Equip/Replace; stale, cancelled, error and empty states.
import {
  Badge, Body1Strong, Button, Caption1, Field, MessageBar, MessageBarActions, MessageBarBody, ProgressBar, Subtitle2, Table,
  TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { slotLabel, sweepKeyOf, sweepView } from '../model.js';
import { fmtInt } from '../format.js';
import { DeltaBadge } from './common.jsx';

const useStyles = makeStyles({
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, marginBottom: tokens.spacingVerticalM },
  spacer: { flexGrow: 1 },
  stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  progressRow: { display: 'flex', alignItems: 'flex-end', gap: tokens.spacingHorizontalM },
  grow: { flexGrow: 1 },
  rank: { width: '32px', fontVariantNumeric: 'tabular-nums' },
  name: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: '2px', paddingTop: tokens.spacingVerticalXS, paddingBottom: tokens.spacingVerticalXS },
  nameLine: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  gainLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: '2px', fontVariantNumeric: 'tabular-nums' },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  hidden: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' },
  sub: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  basis: { color: tokens.colorNeutralForeground2 },
  gap: { borderTop: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke2}` },
  cellAction: { width: '88px', textAlign: 'right' },
});

/** The line above the table that says what every gain is measured against. */
function basisText(base, running) {
  const runs = 'Each mod: max rank, 3 seeded runs (DPS can differ a little from the 8-run result above).';
  if (base.dps == null) return running ? runs : null;
  if (base.kind === 'mod') return `Gains vs ${base.name} at rank ${base.rank}: ${fmtInt(base.dps)} DPS in this search. ${runs}`;
  return `Gains vs the slot left empty: ${fmtInt(base.dps)} DPS. ${runs}`;
}

export function BestModPanel() {
  const styles = useStyles();
  const sweep = useApp(s => s.sweep);
  const build = useApp(s => s.build);
  const ctx = useApp(s => s.ctx);
  useDerived();
  if (!sweep) return null;
  const label = slotLabel(sweep.slot);
  const running = sweep.status === 'running';
  // Only changes outside the searched slot (other mods, weapon, target, time) make the gains stale.
  const stale = !running && sweep.key !== sweepKeyOf(ctx, build, sweep.slot);
  const slotNow = build.mods[sweep.slot]?.name ?? null;
  const weaponChanged = sweep.weaponName !== build.weaponName;
  const { base, rows } = sweepView(sweep, slotNow);
  const basis = basisText(base, running);

  return (
    <section aria-labelledby="best-heading">
      <div className={styles.head}>
        <Subtitle2 as="h3" id="best-heading">Best mod for {label.toLowerCase()}</Subtitle2>
        <span className={styles.spacer} />
        {running ? null : (
          <Tooltip content="Close results" relationship="label">
            <Button appearance="subtle" icon={<DismissRegular />} onClick={() => actions.dismissSweep()} />
          </Tooltip>
        )}
      </div>
      <div className={styles.stack}>
        {running ? (
          <div className={styles.progressRow}>
            <Field className={styles.grow} label={`Testing ${sweep.done} of ${sweep.total} mods`} validationMessage={null}>
              <ProgressBar value={sweep.total ? sweep.done / sweep.total : 0} thickness="large" />
            </Field>
            <Button onClick={() => actions.cancelSweep()}>Cancel</Button>
          </div>
        ) : null}
        {sweep.status === 'cancelled' ? (
          <Caption1>Cancelled after {sweep.done} of {sweep.total} mods. Showing partial results.</Caption1>
        ) : null}
        {sweep.status === 'error' ? (
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>Couldn't finish the best-mod search. {sweep.error}</MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => actions.startSweep(sweep.slot)}>Try again</Button>
            </MessageBarActions>
          </MessageBar>
        ) : null}
        {stale && sweep.status !== 'error' ? (
          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>Your build changed after this search. Gains may be out of date.</MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => actions.startSweep(sweep.slot)}>Run again</Button>
            </MessageBarActions>
          </MessageBar>
        ) : null}
        {sweep.total === 0 && !running ? <Caption1>No compatible mods to test for this slot.</Caption1> : null}
        {rows.length && basis ? <Caption1 className={styles.basis}>{basis}</Caption1> : null}
        {rows.length ? (
          <Table size="small" aria-label={`Best mods for ${label.toLowerCase()}, ranked by DPS`}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell className={styles.rank}>#</TableHeaderCell>
                <TableHeaderCell>Mod and DPS gain</TableHeaderCell>
                <TableHeaderCell className={styles.cellAction}><span className={styles.hidden}>Action</span></TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const reason = r.equipped ? 'Already equipped' : weaponChanged ? `The weapon changed to ${build.weaponName}` : null;
                const verb = slotNow ? 'Replace' : 'Equip';
                const flat = r.gain == null || Math.abs(r.gain) < 0.0005;
                const detached = i > 0 && r.place !== rows[i - 1].place + 1;
                return (
                  <TableRow key={r.name} className={detached ? styles.gap : undefined}>
                    <TableCell className={styles.rank}>{r.place}</TableCell>
                    <TableCell>
                      <span className={styles.name}>
                        <span className={styles.nameLine}>
                          <Body1Strong className={styles.ellipsis} title={r.name}>{r.name}</Body1Strong>
                          {r.equipped ? <Badge appearance="outline" size="medium">Equipped</Badge> : null}
                        </span>
                        <span className={styles.gainLine}>
                          {r.equipped && base.kind === 'mod' ? <Caption1>Current</Caption1> : flat ? <Caption1>0%</Caption1> : <DeltaBadge delta={r.gain} />}
                          <Caption1 className={styles.sub}>{fmtInt(r.dps)} DPS · rank {r.rank}</Caption1>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className={styles.cellAction}>
                      <Tooltip content={reason ?? `${verb} ${slotNow ? `${slotNow} with ` : ''}${r.name} in ${label.toLowerCase()}`} relationship="description">
                        <Button
                          size="small"
                          disabledFocusable={Boolean(reason)}
                          data-focus-id={`sweep-equip-${r.name}`}
                          onClick={() => actions.equipMod(sweep.slot, r.name, r.rank, { focus: false })}
                        >
                          {verb}
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </section>
  );
}
