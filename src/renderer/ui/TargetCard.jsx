// Target card: enemy preset (or Custom), level, faction, Steel Path, headshots, and the enemy's pools.
import { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionHeader, AccordionItem, AccordionPanel, Body1Strong, Caption1, Card, CardHeader, Combobox, Dropdown,
  Field, Option, OptionGroup, SpinButton, Subtitle2, Switch, makeStyles, tokens,
} from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { CUSTOM_PRESET } from '../model.js';
import { fmtInt } from '../format.js';
import { resolveFaction } from '../../shared/factions.js';
import { STEEL_PATH_MULTIPLIER } from '../../shared/enemy.js';
import { POOL_LABELS, POOL_TOKENS } from '../theme.js';

const POOLS = ['hp', 'shields', 'armor', 'overguard'];

const useStyles = makeStyles({
  card: { gap: tokens.spacingVerticalM, scrollMarginTop: '16px' },
  summary: { color: tokens.colorNeutralForeground2 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    alignItems: 'start',
  },
  wide: { gridColumn: '1 / -1' },
  option: { display: 'flex', justifyContent: 'space-between', gap: tokens.spacingHorizontalM, width: '100%' },
  sub: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' },
  switches: { display: 'flex', flexWrap: 'wrap', gap: `0 ${tokens.spacingHorizontalXL}` },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: tokens.spacingHorizontalS },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopWidth: '3px',
    borderTopStyle: 'solid',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  tileLabel: { color: tokens.colorNeutralForeground2 },
  num: { fontVariantNumeric: 'tabular-nums' },
  accordionHeader: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  panel: { margin: `${tokens.spacingVerticalS} 0 ${tokens.spacingVerticalM}` },
});

export const steelPathHint = () => `${String(STEEL_PATH_MULTIPLIER)}× health and shields`;

/** The Target card's header summary: everything that changes the result, headshots included. */
export function targetSummary(enemy) {
  if (!enemy) return '';
  const head = enemy.preset === CUSTOM_PRESET ? ['Custom target'] : [enemy.preset, `Level ${enemy.level}`];
  return [...head, enemy.faction, enemy.preset !== CUSTOM_PRESET && enemy.steelPath ? 'Steel Path' : null, enemy.headshot ? 'Headshots' : null]
    .filter(Boolean).join(' · ');
}

function EnemyField() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const preset = useApp(s => s.build.enemy.preset);
  const [query, setQuery] = useState(null);
  const groups = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const byFaction = new Map();
    for (const name of ctx.presetNames) {
      if (q && !name.toLowerCase().includes(q)) continue;
      const p = ctx.presets[name];
      const faction = resolveFaction(p.faction).name;
      if (!byFaction.has(faction)) byFaction.set(faction, []);
      byFaction.get(faction).push({ name, level: p.default_level ?? p.base_level ?? 1 });
    }
    const out = [];
    if (!q || 'custom target'.includes(q)) out.push({ label: 'Custom target', items: [{ name: CUSTOM_PRESET, custom: true }] });
    for (const f of ctx.factionNames) if (byFaction.has(f)) out.push({ label: f, items: byFaction.get(f) });
    return out;
  }, [ctx, query]);
  const options = useMemo(() => groups.map(g => (
    <OptionGroup key={g.label} label={g.label}>
      {g.items.map(it => (
        <Option key={it.name} value={it.name} text={it.name}>
          <span className={styles.option}>
            <span>{it.name}</span>
            <Caption1 className={styles.sub}>{it.custom ? 'Enter your own stats' : `Default level ${it.level}`}</Caption1>
          </span>
        </Option>
      ))}
    </OptionGroup>
  )), [groups, styles]);
  return (
    <Field label="Enemy" className={styles.wide}>
      <Combobox
        value={query ?? preset}
        selectedOptions={[preset]}
        placeholder="Search enemies"
        data-focus-id="target-enemy"
        onChange={e => setQuery(e.target.value)}
        onOptionSelect={(_e, d) => {
          setQuery(null);
          if (d.optionValue && d.optionValue !== preset) actions.setTarget({ preset: d.optionValue });
        }}
        onOpenChange={(_e, d) => { if (!d.open) setQuery(null); }}
        positioning={{ autoSize: 'height' }}
      >
        {options}
        {groups.length ? null : <Option key="none" value="" text="" disabled>No enemies match "{query}"</Option>}
      </Combobox>
    </Field>
  );
}

/**
 * SpinButton that commits on blur/Enter/arrows. Invalid text never reaches the engine: the field goes back
 * to the last valid value, and a warning says so ("… Kept 145.") instead of an error that would claim the
 * visible value is wrong. The note clears on the next edit.
 */
function NumberField({ label, value, min, max, stepPage, onCommit, disabled, hint, invalidText }) {
  const [note, setNote] = useState(null);
  return (
    <Field label={label} hint={note ? undefined : hint} validationState={note ? 'warning' : 'none'} validationMessage={note}>
      <SpinButton
        value={value}
        min={min}
        max={max}
        step={1}
        stepPage={stepPage}
        disabled={disabled}
        onInput={() => { if (note) setNote(null); }}
        onChange={(_e, d) => {
          let v = d.value;
          if (v === undefined && d.displayValue !== undefined) v = Number(String(d.displayValue).replace(/[\s,]/g, ''));
          if (v == null || !Number.isFinite(v)) {
            setNote(`${invalidText}. Kept ${fmtInt(value)}.`);
            return;
          }
          setNote(null);
          onCommit(Math.min(max ?? Infinity, Math.max(min, Math.round(v))));
        }}
      />
    </Field>
  );
}

export function TargetCard() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const enemyCfg = useApp(s => s.build.enemy);
  const { enemy } = useDerived();
  const custom = enemyCfg.preset === CUSTOM_PRESET;
  const [open, setOpen] = useState(custom);
  useEffect(() => { if (custom) setOpen(true); }, [custom]);
  const statsSummary = `${fmtInt(enemy.hp)} health · ${fmtInt(enemy.shields)} shields · ${fmtInt(enemy.armor)} armor${enemy.overguard ? ` · ${fmtInt(enemy.overguard)} overguard` : ''}`;

  return (
    <Card appearance="filled" className={styles.card} id="target-card" data-testid="target-card">
      <CardHeader
        header={<Subtitle2 as="h2">Target</Subtitle2>}
        description={<Caption1 className={styles.summary}>{targetSummary(enemyCfg)}</Caption1>}
      />
      <div className={styles.grid}>
        <EnemyField />
        <NumberField
          label="Level"
          value={custom ? null : enemyCfg.level}
          min={1}
          max={9999}
          stepPage={10}
          disabled={custom}
          hint={custom ? 'Custom targets use the stats you enter.' : '1 to 9999'}
          invalidText="Enter a level from 1 to 9999"
          onCommit={level => actions.setTarget({ level })}
        />
        <Field label="Faction" hint="Sets which faction (bane) mods apply.">
          <Dropdown value={enemyCfg.faction} selectedOptions={[enemyCfg.faction]} onOptionSelect={(_e, d) => actions.setTarget({ faction: d.optionValue })}>
            {ctx.factionNames.map(f => <Option key={f} value={f}>{f}</Option>)}
          </Dropdown>
        </Field>
        <div className={mergeWide(styles)}>
          <Field hint={custom ? 'Not available for custom targets.' : steelPathHint()}>
            <Switch label="Steel Path" checked={Boolean(enemyCfg.steelPath)} disabled={custom} onChange={(_e, d) => actions.setTarget({ steelPath: d.checked })} />
          </Field>
          <Field hint="Every shot hits the head.">
            <Switch label="Headshots" checked={Boolean(enemyCfg.headshot)} onChange={(_e, d) => actions.setTarget({ headshot: d.checked })} />
          </Field>
        </div>
      </div>
      <Accordion collapsible openItems={open ? ['stats'] : []} onToggle={(_e, d) => setOpen(d.openItems.includes('stats'))}>
        <AccordionItem value="stats">
          <AccordionHeader expandIconPosition="end">
            <span className={styles.accordionHeader}>
              <Body1Strong>Enemy stats</Body1Strong>
              <Caption1 className={`${styles.summary} ${styles.num}`}>{statsSummary}</Caption1>
            </span>
          </AccordionHeader>
          <AccordionPanel className={styles.panel}>
            <div className={styles.tiles}>
              {POOLS.map(k => (custom ? (
                <div key={k} className={`${styles.tile} uf-pool-tile`} style={{ borderTop: `3px solid ${tokens[POOL_TOKENS[k]]}` }}>
                  <NumberField
                    label={POOL_LABELS[k]}
                    value={enemy[k]}
                    min={k === 'hp' ? 1 : 0}
                    max={1e12}
                    stepPage={1000}
                    invalidText={`Enter a number${k === 'hp' ? ' of at least 1' : ''}`}
                    onCommit={v => actions.setTarget({ [k]: v })}
                  />
                </div>
              ) : (
                <div key={k} className={`${styles.tile} uf-pool-tile`} style={{ borderTop: `3px solid ${tokens[POOL_TOKENS[k]]}` }}>
                  <Caption1 className={styles.tileLabel}>{POOL_LABELS[k]}</Caption1>
                  <Body1Strong className={styles.num}>{fmtInt(enemy[k])}</Body1Strong>
                </div>
              )))}
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

const mergeWide = styles => `${styles.wide} ${styles.switches}`;
