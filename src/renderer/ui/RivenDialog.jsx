// The riven dialog (docs/port-rivens.md 11.5): create or edit the riven in one mod slot. Disposition and rank, then
// 2-3 positive stats and at most one negative, each with the value the riven shows in game and the usual roll range
// under it. Validation is inline, worded as on underframe.site; Save equips the riven (one undo step) and can keep a
// copy in the user's rivens. The footer shows what the riven does on paper, before the simulation runs on Save.
// One Fluent dialog whose content is the only scroller; Escape cancels and focus goes back to where it came from.
import { useEffect, useMemo, useState } from 'react';
import {
  Body1, Button, Caption1, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field,
  Input, MessageBar, MessageBarBody, Option, Subtitle2, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular, DismissRegular, InfoRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { fmtInt } from '../format.js';
import { setSlot, slotLabel } from '../model.js';
import { buildStats } from '../sim.js';
import { paperDps } from '../sheet.js';
import { RIVEN_MAX_RANK, RIVEN_POLARITIES, displayUnit, rivenFamily, rivenStatCatalogue, rivenStatUnit } from '../../shared/rivens.js';
import { canAddRow, draftFrom, draftIssues, emptyRow, rowRange } from '../riven-draft.js';
import { PolarityGlyph, polarityName } from './art.jsx';
import { DeltaText } from './common.jsx';

const ABOUT = 'Enter the riven as the game shows it: its disposition (the dots on the weapon, 1.2 if unsure), its rank, its polarity (the symbol at the top right of the card) and each stat\'s value. Changing the disposition or rank keeps the values you typed. Drain is 10 + rank, halved in a slot of its polarity.';
/** The polarity choices: not set (Omni, as on underframe.site), then the three a riven can have in game. */
const POLARITY_CHOICES = [{ value: '', text: 'Not set (Omni)' }, ...RIVEN_POLARITIES.map(p => ({ value: p, text: polarityName(p) }))];
const RANKS = Array.from({ length: RIVEN_MAX_RANK + 1 }, (_, i) => i);

const useStyles = makeStyles({
  surface: { width: 'min(640px, 94vw)', maxWidth: 'min(640px, 94vw)' },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxHeight: 'min(64vh, 640px)', overflowY: 'auto', paddingRight: tokens.spacingHorizontalXS },
  titleRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  top: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: tokens.spacingHorizontalL, alignItems: 'start', '& .fui-Dropdown': { minWidth: 0, width: '100%' } },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  heading: { margin: 0 },
  row: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) 32px', gap: tokens.spacingHorizontalS, alignItems: 'start',
    '& .fui-Dropdown': { minWidth: 0, width: '100%' }, '& .fui-Input': { minWidth: 0, width: '100%' },
  },
  // The remove button lines up with the inputs under the row's labels.
  remove: { marginTop: '26px', minWidth: '32px' },
  adds: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  option: { display: 'flex', justifyContent: 'space-between', gap: tokens.spacingHorizontalM, width: '100%', minWidth: 0 },
  optionSub: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  listbox: { maxHeight: 'min(320px, 45vh)', overflowY: 'auto' },
  muted: { color: tokens.colorNeutralForeground3 },
  dps: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, fontVariantNumeric: 'tabular-nums', minWidth: 0 },
  dpsValue: { fontWeight: tokens.fontWeightSemibold },
  footerStart: { flexGrow: 1, minWidth: 0 },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: 0 },
});

/** One stat row: the stat, its value (with its unit and the usual range), and Remove. */
function StatRow({ row, index, draft, catalogue, issue, ranges, onChange, onRemove, showErrors }) {
  const styles = useStyles();
  const sign = row.positive ? 'Positive' : 'Negative';
  const entry = catalogue.find(e => e.key === row.stat) ?? null;
  const label = entry?.label ?? 'stat';
  const others = new Set(draft.rows.filter(r => r.key !== row.key).map(r => r.stat).filter(Boolean));
  const otherSpliced = draft.rows.some(r => r.key !== row.key && catalogue.find(e => e.key === r.stat)?.spliced);
  const options = catalogue.filter(e => row.positive || e.negativeAllowed);
  const range = ranges.get(row.key);
  const unit = row.stat ? displayUnit(row.stat, rivenStatUnit(row.stat)) : '';
  // A wrong sign or a missing stat for typed text shows at once; the rest after Save was pressed.
  const error = issue && (showErrors || /sign|minus|plus|above|below|Pick a stat/.test(issue)) ? issue : null;
  const hint = range ? `In game: ${range.text}${range.outside ? '. Outside the usual roll range.' : ''}` : undefined;
  return (
    <div className={styles.row} data-testid={`riven-row-${index}`}>
      <Field label={`${sign} stat`}>
        <Dropdown
          placeholder="Pick a stat"
          value={entry?.label ?? ''}
          selectedOptions={row.stat ? [row.stat] : []}
          onOptionSelect={(_e, d) => { if (d.optionValue !== row.stat) onChange({ stat: d.optionValue, text: '' }); }}
          listbox={{ className: styles.listbox }}
          data-riven-focus={`stat-${row.key}`}
          aria-label={`${sign} riven stat`}
        >
          {options.map(e => {
            const taken = others.has(e.key);
            const blocked = e.spliced && otherSpliced;
            return (
              <Option key={e.key} value={e.key} text={e.label} disabled={taken || blocked}>
                <span className={styles.option}>
                  <span>{e.label}</span>
                  <span className={styles.optionSub}>{taken ? 'already used' : blocked ? 'one spliced stat only' : e.spliced ? 'spliced' : ''}</span>
                </span>
              </Option>
            );
          })}
        </Dropdown>
      </Field>
      <Field label="Value" validationState={error ? 'error' : range?.outside ? 'warning' : 'none'} validationMessage={error ?? undefined} hint={error ? undefined : hint}>
        <Input
          value={row.text}
          inputMode="decimal"
          disabled={!row.stat}
          contentAfter={unit ? <Caption1 aria-hidden="true">{unit}</Caption1> : undefined}
          onChange={(_e, d) => onChange({ text: d.value })}
          data-riven-focus={`value-${row.key}`}
          aria-label={`${sign} ${label} value${unit === '×' ? ', damage multiplier' : unit === '%' ? ', percent' : unit === 'm' ? ', meters' : ''}`}
        />
      </Field>
      <Tooltip content={`Remove ${sign.toLowerCase()} ${row.stat ? label : 'stat'}`} relationship="label">
        <Button appearance="subtle" className={styles.remove} icon={<DeleteRegular />} onClick={onRemove} />
      </Tooltip>
    </div>
  );
}

/** The footer's line: paper DPS of the build now and with this riven in the slot. */
function PaperLine({ ctx, build, slot, riven, ok }) {
  const styles = useStyles();
  const value = useMemo(() => {
    const dps = mods => { try { return paperDps(buildStats(ctx, build, mods)?.mode); } catch { return NaN; } };
    return { now: dps(build.mods), next: ok ? dps(setSlot(build, slot, riven).mods) : NaN };
  }, [ctx, build, slot, riven, ok]);
  const delta = Number.isFinite(value.now) && Number.isFinite(value.next) && value.now > 0 ? (value.next - value.now) / value.now : null;
  return (
    // The explanation is visible text, so keyboard and screen reader users get it too (not a hover-only tooltip).
    <div className={styles.dps} role="status" data-testid="riven-paper">
      <Caption1 className={styles.muted}>On paper (no armor, status or reloads; Average DPS updates when you save)</Caption1>
      <Body1 className={styles.dpsValue}>{fmtInt(value.now)}{Number.isFinite(value.next) ? ` → ${fmtInt(value.next)}` : ''}</Body1>
      <DeltaText delta={delta} />
    </div>
  );
}

function RivenEditor({ dialog }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const inLibrary = useApp(s => Boolean(dialog.riven?.id && s.rivenLibrary.rivens.some(r => r.id === dialog.riven.id)));
  const weapon = ctx.weaponByName.get(build.weaponName);
  const family = rivenFamily(weapon?.name);
  const catalogue = useMemo(() => rivenStatCatalogue(ctx.data, weapon), [ctx, weapon]);
  // A riven read from a screenshot starts the draft as a new riven; a compare riven is edited for the compare only.
  const [draft, setDraft] = useState(() => draftFrom(dialog.riven ?? dialog.initial ?? null));
  const compare = dialog.purpose?.kind === 'compare';
  const noSlot = dialog.slot == null && !compare;
  const [toLibrary, setToLibrary] = useState(!dialog.riven && !compare);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const env = { data: ctx.data, weapon, family };
  const issues = draftIssues(draft, env);
  const ranges = new Map(draft.rows.map(r => [r.key, rowRange(draft, r, env)]));
  const edit = patch => { setSaveError(null); setDraft(d => ({ ...d, ...patch })); };
  const editRow = (key, patch) => edit({ rows: draft.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) });

  // Focus starts on Disposition for a new riven and on the first stat for an edit.
  useEffect(() => {
    const target = (dialog.riven || dialog.initial) && draft.rows[0] ? `stat-${draft.rows[0].key}` : 'disposition';
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-riven-focus="${target}"]`)?.focus()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusFirstError = () => requestAnimationFrame(() => {
    const row = draft.rows.find(r => issues.rows.has(r.key));
    const target = issues.disposition ? 'disposition' : issues.rank ? 'rank' : row ? (row.stat ? `value-${row.key}` : `stat-${row.key}`) : 'messages';
    document.querySelector(`[data-riven-focus="${target}"]`)?.focus();
  });
  const save = () => {
    setShowErrors(true);
    if (!issues.ok) { focusFirstError(); return; }
    const r = actions.saveRiven(issues.riven, { toLibrary });
    if (!r.ok) setSaveError(r.errors?.[0]?.message ?? "Couldn't save the riven.");
  };
  const addRow = positive => {
    const row = emptyRow(positive);
    edit({ rows: [...draft.rows, row] });
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-riven-focus="stat-${row.key}"]`)?.focus()));
  };
  const removeRow = i => {
    const rows = draft.rows.filter((_, j) => j !== i);
    edit({ rows });
    // Focus stays in the list: the next row's stat, else Add positive stat.
    const next = rows[Math.min(i, rows.length - 1)];
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(next ? `[data-riven-focus="stat-${next.key}"]` : '[data-riven-focus="add-positive"]')?.focus()));
  };
  const positives = draft.rows.map((r, i) => ({ r, i })).filter(x => x.r.positive);
  const negatives = draft.rows.map((r, i) => ({ r, i })).filter(x => !x.r.positive);
  const rowProps = ({ r, i }) => ({
    row: r, index: i, draft, catalogue, issue: issues.rows.get(r.key) ?? null, ranges, showErrors,
    onChange: patch => editRow(r.key, patch), onRemove: () => removeRow(i),
  });
  const messages = [...(showErrors ? issues.messages : []), ...(saveError ? [saveError] : [])];
  const title = compare ? `${dialog.purpose.side ? 'Right' : 'Left'} riven · ${family}`
    : `${dialog.riven ? 'Edit riven' : dialog.initial ? 'Riven from screenshot' : 'New riven'} · ${family}`;

  return (
    <DialogSurface className={styles.surface} aria-describedby="riven-about" data-testid="riven-dialog">
      <DialogBody>
        <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.closeRivenDialog()} />}>
          <span className={styles.titleRow}>
            {title}
            <Tooltip relationship="label" content={ABOUT}>
              <Button appearance="subtle" size="small" icon={<InfoRegular />} />
            </Tooltip>
          </span>
        </DialogTitle>
        <span id="riven-about" className={styles.srOnly}>{`${dialog.slot != null ? `${slotLabel(dialog.slot)}. ` : ''}${ABOUT}`}</span>
        <DialogContent className={styles.content}>
          {dialog.initial ? (
            <MessageBar intent={dialog.note ? 'warning' : 'info'} layout="multiline" style={{ flexShrink: 0 }} data-testid="riven-screenshot-note">
              <MessageBarBody>
                Read from the screenshot: check each value, the polarity (its symbol isn't read), the disposition (the card doesn't show it) and the rank.{dialog.note ? ` ${dialog.note}` : ''}
                {noSlot ? ' Every slot is full, so Save keeps it in your rivens.' : ''}
              </MessageBarBody>
            </MessageBar>
          ) : null}
          <div className={styles.top}>
            <Field
              label="Disposition"
              validationState={showErrors && issues.disposition ? 'error' : 'none'}
              validationMessage={showErrors ? issues.disposition ?? undefined : undefined}
              hint="The weapon's riven disposition (1.2 if unsure)"
            >
              <Input value={draft.disposition} inputMode="decimal" onChange={(_e, d) => edit({ disposition: d.value })} data-riven-focus="disposition" data-testid="riven-disposition" />
            </Field>
            <Field label="Rank" validationState={showErrors && issues.rank ? 'error' : 'none'} validationMessage={showErrors ? issues.rank ?? undefined : undefined} hint={`Drain ${10 + draft.rank}`}>
              <Dropdown value={String(draft.rank)} selectedOptions={[String(draft.rank)]} onOptionSelect={(_e, d) => edit({ rank: Number(d.optionValue) })} data-riven-focus="rank">
                {RANKS.map(r => <Option key={r} value={String(r)}>{String(r)}</Option>)}
              </Dropdown>
            </Field>
            <Field label="Polarity" hint={draft.polarity ? `Halved in a ${polarityName(draft.polarity)} slot` : 'Counts as Omni: halved in any polarised slot'}>
              <Dropdown
                value={POLARITY_CHOICES.find(c => c.value === draft.polarity)?.text ?? ''}
                selectedOptions={[draft.polarity]}
                onOptionSelect={(_e, d) => edit({ polarity: d.optionValue ?? '' })}
                data-riven-focus="polarity"
                data-testid="riven-polarity"
              >
                {POLARITY_CHOICES.map(c => (
                  <Option key={c.value || 'none'} value={c.value} text={c.text}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
                      {c.value ? <PolarityGlyph code={c.value} size={16} /> : null}
                      {c.text}
                    </span>
                  </Option>
                ))}
              </Dropdown>
            </Field>
          </div>
          <section className={styles.section} aria-labelledby="riven-positive">
            <Subtitle2 as="h3" id="riven-positive" className={styles.heading}>Positive stats</Subtitle2>
            {positives.map(x => <StatRow key={x.r.key} {...rowProps(x)} />)}
            {!positives.length ? <Caption1 className={styles.muted}>No positive stats yet: a riven has 2 or 3.</Caption1> : null}
          </section>
          <section className={styles.section} aria-labelledby="riven-negative">
            <Subtitle2 as="h3" id="riven-negative" className={styles.heading}>Negative stat</Subtitle2>
            {negatives.map(x => <StatRow key={x.r.key} {...rowProps(x)} />)}
            {!negatives.length ? <Caption1 className={styles.muted}>None. A riven may have one.</Caption1> : null}
          </section>
          <div className={styles.adds}>
            <Tooltip content={canAddRow(draft, true) ? 'Add a positive stat' : 'A riven has at most 3 positive stats'} relationship="description">
              <Button icon={<AddRegular />} disabledFocusable={!canAddRow(draft, true)} onClick={() => addRow(true)} data-riven-focus="add-positive">Add positive stat</Button>
            </Tooltip>
            <Tooltip content={canAddRow(draft, false) ? 'Add a negative stat' : 'A riven has at most 1 negative stat'} relationship="description">
              <Button icon={<AddRegular />} disabledFocusable={!canAddRow(draft, false)} onClick={() => addRow(false)}>Add negative stat</Button>
            </Tooltip>
          </div>
          {messages.length ? (
            <MessageBar intent="error" layout="multiline" tabIndex={-1} style={{ flexShrink: 0 }} data-riven-focus="messages">
              <MessageBarBody>{messages.join(' ')}</MessageBarBody>
            </MessageBar>
          ) : null}
          {noSlot ? null : inLibrary ? <Caption1 className={styles.muted}>Saving also updates this riven in your rivens.</Caption1> : (
            <Checkbox checked={toLibrary} onChange={(_e, d) => setToLibrary(Boolean(d.checked))} label="Also save to your rivens" />
          )}
        </DialogContent>
        <DialogActions position="start" className={styles.footerStart}>
          {dialog.slot != null ? <PaperLine ctx={ctx} build={build} slot={dialog.slot} riven={issues.riven} ok={issues.ok} /> : null}
        </DialogActions>
        <DialogActions position="end">
          <Button appearance="primary" onClick={save} data-testid="riven-save">{compare ? 'Use in compare' : noSlot ? 'Save to your rivens' : 'Save'}</Button>
          <Button onClick={() => actions.closeRivenDialog()}>Cancel</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  );
}

export function RivenDialog() {
  const dialog = useApp(s => s.rivenDialog);
  const ready = useApp(s => Boolean(s.build && s.ctx));
  if (!ready) return null;
  return (
    <Dialog open={Boolean(dialog)} onOpenChange={(_e, d) => { if (!d.open) actions.closeRivenDialog(); }}>
      {/* A fresh editor per opening: the draft starts from the slot's riven (or empty) each time. */}
      {dialog ? <RivenEditor key={`${dialog.slot}:${dialog.riven?.id ?? 'new'}:${dialog.purpose?.side ?? ''}:${dialog.initial ? 'shot' : ''}`} dialog={dialog} /> : null}
    </Dialog>
  );
}
