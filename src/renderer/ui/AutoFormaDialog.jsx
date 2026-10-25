// Auto Forma: the fewest Forma that fit the build's mods, and the plans where each extra Forma frees more capacity
// (src/shared/auto-forma.js). The button sits on the capacity line next to Auto build. The dialog lists the plans
// (the fewest Forma first, picked), each with its slot polarities and the mods it moves; Apply sets them as one undo
// step. Options: move mods between slots (free in game), count from the weapon's own polarities, mods at max rank.
import { useEffect, useMemo, useState } from 'react';
import {
  Body1, Button, Caption1, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar,
  MessageBarBody, Radio, RadioGroup, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import { DismissRegular, ShapesRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { formaPlanText } from '../model.js';
import { maxRank } from '../../shared/mods.js';
import { autoFormaFor, movesText, planChanges } from '../auto-forma-flow.js';

const ABOUT = 'Finds the fewest Forma that fit the mods, and where each one goes. Moving a mod to a slot that already matches it costs no Forma; mods that add an element stay put, because their order sets the combined elements.';

const useStyles = makeStyles({
  surface: { width: 'min(600px, 94vw)', maxWidth: 'min(600px, 94vw)' },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, maxHeight: 'min(64vh, 640px)', overflowY: 'auto', '& > *': { flexShrink: 0 } },
  options: { display: 'flex', flexDirection: 'column', gap: 0 },
  plan: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  planTitle: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground2 },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: 0 },
});

const formaWord = n => `${n} Forma`;

/** One plan as a radio label: the Forma it takes, the capacity, then what it changes. */
function PlanLabel({ plan, first, fromScratch, raised, applied }) {
  const styles = useStyles();
  const spent = fromScratch ? `${formaWord(plan.spent)} in all` : !plan.spent ? 'No Forma' : applied ? `${plan.spent} more Forma` : formaWord(plan.spent);
  const lines = [...formaPlanText(plan.changes), ...movesText(plan.moves).map(t => `Move ${t}`)];
  return (
    <span className={styles.plan}>
      <span>
        <span className={styles.planTitle}>{spent}</span>
        {` · ${plan.used} / ${plan.capacity} capacity, ${plan.spare} spare`}
        {first ? <span className={styles.muted}> · fewest Forma</span> : null}
      </span>
      {lines.length ? (
        <ul className={styles.list}>{lines.map(t => <li key={t}><Caption1>{t}</Caption1></li>)}</ul>
      ) : (
        <Caption1 className={styles.muted}>{raised ? 'Polarities as they are.' : 'Nothing to change.'}</Caption1>
      )}
    </span>
  );
}

export function AutoFormaDialog() {
  const styles = useStyles();
  const af = useApp(s => s.autoForma);
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const [picked, setPicked] = useState(0);
  const options = af?.options;
  const r = useMemo(() => (af && ctx && build ? autoFormaFor(ctx, build, options) : null), [af, ctx, build, options]);
  // A new set of plans starts on the fewest Forma.
  useEffect(() => { setPicked(0); }, [r]);
  if (!af || !r) return null;
  const plan = r.options[Math.min(picked, r.options.length - 1)] ?? null;
  const belowMax = build.mods.some(s => s && !s.isRiven && maxRank(ctx.index.byName.get(s.name)) > (Number(s.rank) || 0));
  const anyMods = build.mods.some(Boolean);
  const set = patch => actions.setAutoFormaOptions(patch);
  const now = `${r.current.used} / ${r.current.capacity} capacity, ${formaWord(r.current.forma)} on the weapon${build.catalyst === false ? ', no Catalyst' : ''}.`;
  return (
    <Dialog open onOpenChange={(_e, d) => { if (!d.open) actions.closeAutoForma(); }}>
      <DialogSurface className={styles.surface} aria-describedby="auto-forma-about" data-testid="auto-forma-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.closeAutoForma()} />}>
            Auto Forma
          </DialogTitle>
          <span id="auto-forma-about" className={styles.srOnly}>{ABOUT}</span>
          <DialogContent className={styles.content}>
            <Body1 as="p" style={{ margin: 0 }}>{ABOUT}</Body1>
            <Body1 as="p" style={{ margin: 0 }} data-testid="auto-forma-now">Now: {now}</Body1>
            <div className={styles.options}>
              <Checkbox label="Move mods between slots (free in game)" checked={options.moveMods} onChange={(_e, d) => set({ moveMods: Boolean(d.checked) })} data-testid="auto-forma-move" />
              <Checkbox label="Count from the weapon's own polarities (Forma already applied count again)" checked={options.fromScratch} onChange={(_e, d) => set({ fromScratch: Boolean(d.checked) })} data-testid="auto-forma-scratch" />
              {belowMax || options.maxRanks ? (
                <Checkbox label="Plan for every mod at max rank" checked={options.maxRanks} onChange={(_e, d) => set({ maxRanks: Boolean(d.checked) })} data-testid="auto-forma-max-ranks" />
              ) : null}
            </div>
            {!anyMods ? (
              <MessageBar intent="info"><MessageBarBody>Add mods first: Auto Forma fits the mods on the build.</MessageBarBody></MessageBar>
            ) : !r.options.length ? (
              <MessageBar intent="error" layout="multiline" data-testid="auto-forma-none">
                <MessageBarBody>
                  These mods don't fit with any Forma: the best plan needs {r.best?.used} of {r.best?.capacity} capacity. Remove a mod or lower a rank{build.catalyst === false ? ', or add an Orokin Catalyst' : ''}.
                </MessageBarBody>
              </MessageBar>
            ) : (
              <>
                {r.umbra ? (
                  <MessageBar intent="warning" layout="multiline"><MessageBarBody>Only fits with Umbra Forma: the plans use it where an Umbra mod needs it.</MessageBarBody></MessageBar>
                ) : null}
                {r.raised ? <Caption1 className={styles.muted}>{r.raised} {r.raised === 1 ? 'mod goes' : 'mods go'} to max rank on Apply.</Caption1> : null}
                <RadioGroup aria-label="Plans" value={String(Math.min(picked, r.options.length - 1))} onChange={(_e, d) => setPicked(Number(d.value))} data-testid="auto-forma-plans">
                  {r.options.map((p, i) => (
                    <Radio key={`${p.spent}-${i}`} value={String(i)} label={<PlanLabel plan={p} first={i === 0} fromScratch={options.fromScratch} raised={r.raised} applied={r.current.forma > 0} />} />
                  ))}
                </RadioGroup>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!planChanges(plan, r.raised)} onClick={() => actions.applyAutoForma(Math.min(picked, r.options.length - 1))} data-testid="auto-forma-apply">Apply</Button>
            <Button onClick={() => actions.closeAutoForma()} data-testid="auto-forma-close">{planChanges(plan, r.raised) ? 'Cancel' : 'Close'}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** The capacity line's Auto Forma button, next to Auto build. */
export function AutoFormaButton() {
  const hasMods = useApp(s => Boolean(s.build?.mods.some(Boolean)));
  return (
    <Tooltip content={hasMods ? 'Find the fewest Forma that fit the mods, and where they go' : 'Add mods first: Auto Forma fits the mods on the build'} relationship="description">
      <Button
        appearance="subtle"
        size="small"
        icon={<ShapesRegular />}
        disabledFocusable={!hasMods}
        onClick={() => actions.openAutoForma()}
        data-testid="auto-forma-open"
        data-focus-id="auto-forma-open"
        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        Auto Forma
      </Button>
    </Tooltip>
  );
}
