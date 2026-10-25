// The weapon's own options, beside its fire mode (only for weapons that have any): a Kuva, Tenet or Coda weapon's
// Progenitor bonus, an exalted weapon's ability strength, the weapon's passives (src/shared/weapon-passives.js) and its
// Incarnon evolutions (src/shared/incarnon.js). One quiet button that opens a popover, so the Loadout gains no controls
// at rest for most weapons.
import { useEffect, useState } from 'react';
import {
  Body1Strong, Button, Caption1, Divider, Dropdown, Field, Input, Option, Popover, PopoverSurface, PopoverTrigger, Switch, makeStyles, tokens,
} from '@fluentui/react-components';
import { OptionsRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { PROGENITOR_ELEMENTS, PROGENITOR_MAX, effectiveProgenitor } from '../../shared/stats.js';
import { DEFAULT_EXALTED_STRENGTH, exaltedConfig, passiveControl, passiveValue, weaponPassives } from '../../shared/weapon-passives.js';
import { incarnonConditionals, incarnonEvolutions, incarnonFor } from '../../shared/incarnon.js';

const useStyles = makeStyles({
  surface: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, width: '340px', maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', overflowY: 'auto' },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  value: { width: '96px' },
  passive: { display: 'flex', flexDirection: 'column', gap: '2px' },
  muted: { color: tokens.colorNeutralForeground3 },
  perkOption: { display: 'flex', flexDirection: 'column', gap: '2px', paddingBlock: '2px' },
  perkText: { color: tokens.colorNeutralForeground3, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  listbox: { maxWidth: 'min(420px, calc(100vw - 32px))', maxHeight: '50vh' },
});

/** A number input that commits on Enter or blur, clamped by the caller's action. */
function NumberInput({ value, min, max, step = 1, label, onCommit, testId }) {
  const styles = useStyles();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <Input
      className={styles.value}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={label}
      data-testid={testId}
      contentAfter="%"
      onChange={(_e, d) => setText(d.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
    />
  );
}

/** One passive's control: a switch, stacks, a scope tier or a choice. */
function PassiveControl({ entry, build }) {
  const styles = useStyles();
  const c = passiveControl(entry);
  const n = passiveValue(build, entry);
  const set = v => actions.setPassive(entry.name, v);
  const name = entry.display_name && entry.display_name !== entry.name ? `${entry.name}` : entry.name;
  let control;
  if (c.kind === 'toggle') {
    control = <Switch checked={n > 0} label={n > 0 ? 'On' : 'Off'} onChange={(_e, d) => set(d.checked ? 1 : 0)} aria-label={name} />;
  } else {
    const options = c.kind === 'select'
      ? c.options.map(o => ({ value: o.value, label: o.label }))
      : Array.from({ length: c.max + 1 }, (_, i) => ({ value: i, label: i === 0 ? 'Off' : c.kind === 'tier' ? `Tier ${i}` : `${i} ${i === 1 ? 'stack' : 'stacks'}` }));
    const current = options.find(o => o.value === n) ?? options[0];
    control = (
      <Dropdown
        aria-label={name}
        value={current.label}
        selectedOptions={[String(current.value)]}
        onOptionSelect={(_e, d) => set(Number(d.optionValue))}
        style={{ minWidth: 140 }}
      >
        {options.map(o => <Option key={o.value} value={String(o.value)}>{o.label}</Option>)}
      </Dropdown>
    );
  }
  return (
    <div className={styles.passive}>
      <Field label={name}>{control}</Field>
      {c.text ? <Caption1 className={styles.muted}>{c.text}</Caption1> : null}
    </div>
  );
}

/** One evolution's perk: a dropdown of the perks by name, each with its text, and the picked perk's text below. */
function PerkPicker({ evolution, picked }) {
  const styles = useStyles();
  const current = evolution.perks.find(p => p.number === picked) ?? null;
  return (
    <Field label={evolution.label}>
      <Dropdown
        aria-label={`${evolution.label} perk`}
        value={current ? current.name : 'No perk'}
        selectedOptions={[String(current?.number ?? 0)]}
        onOptionSelect={(_e, d) => actions.setIncarnonPerk(evolution.number, Number(d.optionValue))}
        listbox={{ className: styles.listbox }}
        data-testid={`incarnon-perk-${evolution.number}`}
      >
        <Option value="0" text="No perk">No perk</Option>
        {evolution.perks.map(p => (
          <Option key={p.number} value={String(p.number)} text={p.name}>
            <div className={styles.perkOption}>
              <span>{p.name}</span>
              <Caption1 className={styles.perkText}>{p.text}</Caption1>
            </div>
          </Option>
        ))}
      </Dropdown>
      {current ? <Caption1 className={styles.muted}>{current.text}</Caption1> : null}
    </Field>
  );
}

/** A conditional perk stat: automatic (the site's default, shown with what it decides), off, or a stack count. */
function PerkConditional({ def, state, own }) {
  // With the user's own setting, "Automatic" still names what the default would pick.
  const fallback = state?.auto === false ? state.fallback : state;
  const auto = fallback?.isActive ? (def.maxStacks > 1 ? `${fallback.stacks} stacks` : 'on') : 'off';
  const options = [
    { value: 'auto', label: `Automatic (${auto})` },
    { value: '0', label: 'Off' },
    ...(def.maxStacks > 1
      ? Array.from({ length: def.maxStacks }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i ? 'stacks' : 'stack'}` }))
      : [{ value: '1', label: 'On' }]),
  ];
  const value = Number.isFinite(own) ? String(own) : 'auto';
  const current = options.find(o => o.value === value) ?? options[0];
  const evolution = def.label.split(':')[0];
  const name = `${def.stat.Stat.charAt(0).toUpperCase()}${def.stat.Stat.slice(1)} (${evolution})`;
  return (
    <Field label={name} hint={String(def.stat.OriginalValue ?? '').replace(/\s*\/\s*$/, '') || undefined}>
      <Dropdown
        aria-label={name}
        value={current.label}
        selectedOptions={[current.value]}
        onOptionSelect={(_e, d) => actions.setIncarnonConditional(def.id, d.optionValue === 'auto' ? null : Number(d.optionValue))}
        style={{ minWidth: 160 }}
      >
        {options.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
      </Dropdown>
    </Field>
  );
}

/** A perk per evolution and the picked perks' conditional parts. The Genesis is always installed. */
function IncarnonOptions({ weapon, build }) {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const { stats } = useDerived();
  const evolutions = incarnonEvolutions(incarnonFor(ctx.data, weapon));
  const defs = incarnonConditionals(ctx.data, weapon, build.incarnon);
  const states = stats?.incarnon?.states ?? {};
  return (
    <>
      <Divider />
      <Body1Strong as="h3" style={{ margin: 0 }}>Incarnon evolutions</Body1Strong>
      {evolutions.map(evo => <PerkPicker key={evo.number} evolution={evo} picked={build.incarnon?.[`evolution_${evo.number}_perk`] ?? null} />)}
      {defs.length ? (
        <>
          <Caption1 className={styles.muted}>
            Conditional perks. Automatic is underframe.site's choice: on for a trigger the fight meets (On Kill, On Headshot), off
            for one it doesn't (While Aiming, On Equip), and as the stats allow (Critical Chance below 40%).
          </Caption1>
          {defs.map(def => <PerkConditional key={def.id} def={def} state={states[def.id]} own={build.incarnon?.conditionals?.[def.id]} />)}
        </>
      ) : null}
    </>
  );
}

/** "Options" beside the fire mode, for weapons with a Progenitor bonus, an exalted strength, passives or evolutions. */
export function WeaponOptions() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const weapon = build ? ctx.weaponByName.get(build.weaponName) : null;
  const progenitor = effectiveProgenitor(weapon, build?.progenitor);
  const exalted = exaltedConfig(weapon);
  const passives = weapon ? weaponPassives(ctx.data, weapon) : [];
  const incarnon = weapon ? incarnonFor(ctx.data, weapon) : null;
  if (!weapon || (!progenitor && !exalted && !passives.length && !incarnon)) return null;
  const strength = build.exaltedStrength ?? DEFAULT_EXALTED_STRENGTH;
  const perks = incarnon ? incarnonEvolutions(incarnon).filter(e => build.incarnon?.[`evolution_${e.number}_perk`]).length : 0;
  const summary = [
    progenitor ? `${progenitor.element} ${progenitor.value}%` : null,
    exalted ? `${strength}% strength` : null,
    passives.length ? `${passives.filter(e => passiveValue(build, e) > 0).length} of ${passives.length} passives on` : null,
    incarnon ? `${perks} Incarnon ${perks === 1 ? 'perk' : 'perks'}` : null,
  ].filter(Boolean).join(', ');
  return (
    <Popover withArrow positioning="below-start" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<OptionsRegular />} aria-label={`Weapon options: ${summary}`} data-testid="weapon-options">Options</Button>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface} aria-label={`${weapon.name} options`} data-testid="weapon-options-popover">
        <Body1Strong>{weapon.name}</Body1Strong>
        {progenitor ? (
          <Field label="Progenitor bonus" hint={`25 to ${PROGENITOR_MAX}%. Without one set, the bonus is Magnetic 25%, as on underframe.site.`}>
            <div className={styles.row}>
              <Dropdown
                aria-label="Progenitor element"
                value={progenitor.element}
                selectedOptions={[progenitor.element]}
                onOptionSelect={(_e, d) => actions.setProgenitor({ element: d.optionValue })}
                style={{ minWidth: 140 }}
                data-testid="progenitor-element"
              >
                {PROGENITOR_ELEMENTS.map(e => <Option key={e} value={e}>{e}</Option>)}
              </Dropdown>
              <NumberInput
                value={progenitor.value}
                min={25}
                max={PROGENITOR_MAX}
                step={0.1}
                label="Progenitor bonus, percent"
                testId="progenitor-value"
                onCommit={v => actions.setProgenitor({ value: Math.min(PROGENITOR_MAX, Math.max(25, v)) })}
              />
            </div>
          </Field>
        ) : null}
        {exalted ? (
          <Field label="Ability strength" hint={`The exalted weapon's extra status scales with it (${exalted.coefficient * 100}% at 100% strength).`}>
            <NumberInput value={strength} min={1} max={1000} label="Ability strength, percent" testId="exalted-strength" onCommit={v => actions.setExaltedStrength(Math.max(1, v))} />
          </Field>
        ) : null}
        {passives.map(entry => <PassiveControl key={entry.name} entry={entry} build={build} />)}
        {incarnon ? <IncarnonOptions weapon={weapon} build={build} /> : null}
      </PopoverSurface>
    </Popover>
  );
}
