// The weapon's own options, beside its fire mode (only for weapons that have any): a Kuva, Tenet or Coda weapon's
// Progenitor bonus, an exalted weapon's ability strength, and the weapon's passives (src/shared/weapon-passives.js).
// One quiet button that opens a popover, so the Loadout gains no controls at rest for most weapons.
import { useEffect, useState } from 'react';
import {
  Body1Strong, Button, Caption1, Dropdown, Field, Input, Option, Popover, PopoverSurface, PopoverTrigger, Switch, makeStyles, tokens,
} from '@fluentui/react-components';
import { OptionsRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { PROGENITOR_ELEMENTS, PROGENITOR_MAX, effectiveProgenitor } from '../../shared/stats.js';
import { DEFAULT_EXALTED_STRENGTH, exaltedConfig, passiveControl, passiveValue, weaponPassives } from '../../shared/weapon-passives.js';

const useStyles = makeStyles({
  surface: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, width: '340px', maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', overflowY: 'auto' },
  row: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  value: { width: '96px' },
  passive: { display: 'flex', flexDirection: 'column', gap: '2px' },
  muted: { color: tokens.colorNeutralForeground3 },
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

/** "Options" beside the fire mode, for weapons with a Progenitor bonus, an exalted strength or passives. */
export function WeaponOptions() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const weapon = build ? ctx.weaponByName.get(build.weaponName) : null;
  const progenitor = effectiveProgenitor(weapon, build?.progenitor);
  const exalted = exaltedConfig(weapon);
  const passives = weapon ? weaponPassives(ctx.data, weapon) : [];
  if (!weapon || (!progenitor && !exalted && !passives.length)) return null;
  const strength = build.exaltedStrength ?? DEFAULT_EXALTED_STRENGTH;
  const summary = [
    progenitor ? `${progenitor.element} ${progenitor.value}%` : null,
    exalted ? `${strength}% strength` : null,
    passives.length ? `${passives.filter(e => passiveValue(build, e) > 0).length} of ${passives.length} passives on` : null,
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
      </PopoverSurface>
    </Popover>
  );
}
