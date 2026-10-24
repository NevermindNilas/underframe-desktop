// Mod slots: 8 cards (4x2 or 2x4 by editor width) plus a full-width Exilus row.
import {
  Body1Strong, Button, Caption1, Card, InfoLabel, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, ProgressBar,
  Subtitle2, Tooltip, makeStyles, mergeClasses, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, ArrowSwapRegular, DeleteRegular, DismissRegular, MoreHorizontalRegular, SparkleRegular,
} from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { EXILUS_SLOT, SLOT_COUNT, polarityInfo, rarityKey, slotLabel } from '../model.js';
import { maxRank, modEffectSummary } from '../../shared/mods.js';
import { EngineOnlyBadge, PartialBadge, Polarity, hasNoStats } from './common.jsx';
import { RankStepper } from './RankStepper.jsx';

const RARITY_TOKEN = {
  common: tokens.colorPaletteBeigeBorderActive,
  uncommon: tokens.colorNeutralForeground3,
  rare: tokens.colorPaletteMarigoldBorderActive,
  legendary: tokens.colorPaletteLavenderBorderActive,
};

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  head: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  hint: { color: tokens.colorNeutralForeground2 },
  grid: { display: 'grid', gap: tokens.spacingHorizontalM },
  card: {
    position: 'relative',
    minWidth: 0,
    gap: tokens.spacingVerticalXS,
    paddingLeft: tokens.spacingHorizontalL,
    minHeight: '132px',
    overflow: 'hidden',
  },
  exilus: { gridColumn: '1 / -1', minHeight: 'auto' },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '3px',
  },
  header: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  headerText: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  nameButton: {
    justifyContent: 'flex-start',
    minWidth: 0,
    maxWidth: '100%',
    paddingLeft: 0,
    paddingRight: 0,
    height: 'auto',
    minHeight: '24px',
    textAlign: 'left',
  },
  nameText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' },
  meta: {
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  effect: {
    color: tokens.colorNeutralForeground2,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    minHeight: '32px',
  },
  badges: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalXS,
    marginTop: 'auto',
  },
  remove: { minWidth: '28px', width: '28px', height: '28px' },
  empty: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    minHeight: '132px',
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingHorizontalXS,
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  emptyExilus: { gridColumn: '1 / -1', minHeight: 'auto', flexDirection: 'row', alignItems: 'center' },
  addButton: {
    flexGrow: 1,
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    minHeight: '76px',
  },
  addButtonExilus: { flexDirection: 'row', minHeight: '48px', justifyContent: 'flex-start', gap: tokens.spacingHorizontalS },
  addLabel: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  addLabelRow: { flexDirection: 'row', gap: tokens.spacingHorizontalS, alignItems: 'baseline' },
  slotCaption: { color: tokens.colorNeutralForeground3 },
  best: { alignSelf: 'center', minHeight: '24px' },
  busy: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, padding: tokens.spacingHorizontalS },
  exilusInfo: { marginLeft: tokens.spacingHorizontalS },
});

export function ModSlots({ columns }) {
  const styles = useStyles();
  const mods = useApp(s => s.build?.mods);
  const used = mods?.filter(Boolean).length ?? 0;
  return (
    <section className={styles.section} aria-labelledby="mods-heading">
      <div className={styles.head}>
        <Subtitle2 as="h2" id="mods-heading">Mods</Subtitle2>
        <Caption1 className={styles.hint}>
          {used === 0 ? 'Add mods to see how they change your DPS.' : `${used} of ${SLOT_COUNT} slots used`}
        </Caption1>
      </div>
      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="list" aria-label="Mod slots">
        {Array.from({ length: SLOT_COUNT }, (_, i) => <Slot key={i} slot={i} />)}
      </div>
    </section>
  );
}

function Slot({ slot }) {
  const value = useApp(s => s.build?.mods[slot] ?? null);
  return (
    <div role="listitem" style={slot === EXILUS_SLOT ? { gridColumn: '1 / -1' } : undefined}>
      {value ? <FilledSlot slot={slot} value={value} /> : <EmptySlot slot={slot} />}
    </div>
  );
}

const BUSY_TIP = 'A best-mod search is running for this slot';

function useSweepState(slot) {
  const sweep = useApp(s => s.sweep);
  const running = sweep?.status === 'running';
  return { running, here: running && sweep.slot === slot };
}

function SweepBusy({ slot }) {
  const styles = useStyles();
  return (
    <Tooltip content={BUSY_TIP} relationship="description">
      <div className={styles.busy} tabIndex={0} aria-disabled="true" aria-label={`${slotLabel(slot)}: finding best mod`}>
        <Caption1>Finding best mod…</Caption1>
        <ProgressBar thickness="medium" aria-hidden="true" />
      </div>
    </Tooltip>
  );
}

function EmptySlot({ slot }) {
  const styles = useStyles();
  const { running, here } = useSweepState(slot);
  const exilus = slot === EXILUS_SLOT;
  const label = slotLabel(slot);
  return (
    <div className={mergeClasses(styles.empty, exilus && styles.emptyExilus)} data-testid={`slot-${slot}`}>
      {here ? <SweepBusy slot={slot} /> : (
        <Button
          appearance="subtle"
          className={mergeClasses(styles.addButton, exilus && styles.addButtonExilus)}
          icon={<AddRegular />}
          data-testid={`slot-add-${slot}`}
          data-focus-id={`slot-add-${slot}`}
          onClick={() => actions.openPicker(slot)}
        >
          <span className={mergeClasses(styles.addLabel, exilus && styles.addLabelRow)}>
            <span>Add mod</span>
            <Caption1 className={styles.slotCaption}>{label}</Caption1>
          </span>
        </Button>
      )}
      {exilus ? <InfoLabel className={styles.exilusInfo} info="Only Exilus mods fit here.">Exilus</InfoLabel> : null}
      {here ? null : (
        <Tooltip content={running ? 'A best-mod search is already running' : `Find best mod for ${label.toLowerCase()}`} relationship="description">
          <Button
            className={styles.best}
            appearance="transparent"
            size="small"
            icon={<SparkleRegular />}
            aria-label={`Find best mod for ${label.toLowerCase()}`}
            disabledFocusable={running}
            onClick={() => actions.startSweep(slot)}
          >
            Find best mod
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

function FilledSlot({ slot, value }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const { partialMap } = useDerived();
  const { running, here } = useSweepState(slot);
  const mod = ctx.index.byName.get(value.name);
  const max = maxRank(mod);
  const label = slotLabel(slot);
  const effect = modEffectSummary(mod, value.rank);
  const partial = partialMap.get(value.name) ?? [];
  const noStats = hasNoStats(ctx, value.name);
  const exilus = slot === EXILUS_SLOT;

  const onNameKey = e => {
    if (e.key === 'Delete') {
      e.preventDefault();
      actions.clearSlot(slot);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      actions.setRank(slot, value.rank + 1);
    } else if (e.key === '-') {
      e.preventDefault();
      actions.setRank(slot, value.rank - 1);
    }
  };

  return (
    <Card
      size="small"
      appearance="filled"
      className={mergeClasses(styles.card, exilus && styles.exilus)}
      data-testid={`slot-${slot}`}
    >
      <span className={mergeClasses(styles.accent, 'uf-rarity-accent')} style={{ backgroundColor: RARITY_TOKEN[rarityKey(mod?.Rarity)] }} aria-hidden="true" />
      <div className={styles.header}>
        <div className={styles.headerText}>
          {here ? <SweepBusy slot={slot} /> : (
            <Button
              appearance="transparent"
              className={styles.nameButton}
              aria-label={`${label}: ${value.name}, rank ${value.rank} of ${max}. Change mod`}
              data-focus-id={`slot-name-${slot}`}
              onClick={() => actions.openPicker(slot)}
              onKeyDown={onNameKey}
            >
              <Body1Strong className={styles.nameText}>{value.name}</Body1Strong>
            </Button>
          )}
          <Caption1 className={styles.meta}>
            <span>{label}</span>
            {mod?.Polarity && polarityInfo(mod.Polarity).symbol ? (
              <>
                <span aria-hidden="true">·</span>
                <Polarity polarity={mod.Polarity} />
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>drain {mod?.['Base Drain'] ?? '?'}</span>
          </Caption1>
        </div>
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={here ? BUSY_TIP : `More options for ${label.toLowerCase()}`} relationship={here ? 'description' : 'label'}>
              <Button
                appearance="subtle"
                size="small"
                icon={<MoreHorizontalRegular />}
                className={styles.remove}
                aria-label={`More options for ${label.toLowerCase()}`}
                disabledFocusable={here}
              />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<ArrowSwapRegular />} secondaryContent="Enter" onClick={() => actions.openPicker(slot)}>Change mod…</MenuItem>
              <MenuItem icon={<SparkleRegular />} disabled={running} onClick={() => actions.startSweep(slot)}>Find a better mod</MenuItem>
              <MenuItem icon={<DeleteRegular />} secondaryContent="Del" onClick={() => actions.clearSlot(slot)}>Remove</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <Tooltip content={String(mod?.Description ?? effect).replace(/\r?\n/g, ' ')} relationship="description">
        <Caption1 className={styles.effect} tabIndex={-1}>{effect || 'No description'}</Caption1>
      </Tooltip>
      {partial.length || noStats ? (
        <div className={styles.badges}>
          {partial.length ? <PartialBadge stats={partial} modName={value.name} /> : null}
          {noStats ? <EngineOnlyBadge modName={value.name} /> : null}
        </div>
      ) : null}
      <div className={styles.footer}>
        {/* While a best-mod search runs on this slot, editing it would make the search stale (UX spec 4.5). */}
        <RankStepper
          value={value.rank}
          max={max}
          label={`${value.name} rank`}
          focusId={`slot-rank-${slot}`}
          disabled={here}
          onChange={r => actions.setRank(slot, r)}
        />
        <Tooltip content={here ? BUSY_TIP : 'Remove (Del)'} relationship="description">
          <Button
            appearance="subtle"
            size="small"
            className={styles.remove}
            icon={<DismissRegular />}
            aria-label={`Remove ${value.name}`}
            disabledFocusable={here}
            onClick={() => actions.clearSlot(slot)}
          />
        </Tooltip>
      </div>
    </Card>
  );
}
