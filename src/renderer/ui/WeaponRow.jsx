// Weapon (searchable Combobox grouped by slot) and fire mode (RadioGroup, or a Dropdown past 4 modes).
import { useMemo, useState } from 'react';
import {
  Body1, Caption1, Combobox, Dropdown, Field, Option, OptionGroup, Radio, RadioGroup, makeStyles, tokens,
} from '@fluentui/react-components';
import { actions } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { INCARNON_NOTE, WEAPON_GROUPS, isIncarnonMode, weaponMatches } from '../model.js';

const useStyles = makeStyles({
  row: { display: 'flex', gap: tokens.spacingHorizontalXXL, flexWrap: 'wrap', alignItems: 'flex-start' },
  weapon: { width: '320px', maxWidth: '100%' },
  combobox: { width: '100%', minWidth: 0 },
  option: { display: 'flex', justifyContent: 'space-between', gap: tokens.spacingHorizontalM, width: '100%' },
  sub: { color: tokens.colorNeutralForeground3 },
  single: { display: 'flex', alignItems: 'center', minHeight: '32px' },
  mode: { minWidth: 0 },
});

function WeaponField() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const weaponName = useApp(s => s.build?.weaponName ?? '');
  const [query, setQuery] = useState(null); // null: not typing, show everything
  const groups = useMemo(() => weaponMatches(ctx, query ?? ''), [ctx, query]);
  const empty = WEAPON_GROUPS.every(g => !groups[g].length);
  return (
    <Field label="Weapon" className={styles.weapon}>
      <Combobox
        className={styles.combobox}
        value={query ?? weaponName}
        selectedOptions={[weaponName]}
        placeholder="Search weapons"
        onChange={e => setQuery(e.target.value)}
        onOptionSelect={(_e, d) => {
          setQuery(null);
          if (d.optionValue && d.optionValue !== weaponName) actions.setWeapon(d.optionValue);
        }}
        onOpenChange={(_e, d) => { if (!d.open) setQuery(null); }}
        positioning={{ autoSize: 'height' }}
        data-focus-id="weapon"
      >
        {WEAPON_GROUPS.map(g => (groups[g].length ? (
          <OptionGroup key={g} label={g}>
            {groups[g].map(w => (
              <Option key={w.name} value={w.name} text={w.name}>
                <span className={styles.option}>
                  <span>{w.name}</span>
                  <Caption1 className={styles.sub}>{w.subtype}</Caption1>
                </span>
              </Option>
            ))}
          </OptionGroup>
        ) : null))}
        {empty ? <Option key="none" value="" text="" disabled>No weapons match "{query}"</Option> : null}
      </Combobox>
    </Field>
  );
}

function FireMode() {
  const styles = useStyles();
  const { stats } = useDerived();
  const modeName = useApp(s => s.build?.modeName ?? '');
  const modes = stats?.selectable ?? [];
  // Honest indicator (UX spec 5.7): an Incarnon form runs, but its evolution bonuses don't.
  const hint = isIncarnonMode(modeName) ? INCARNON_NOTE : undefined;
  if (modes.length <= 1) {
    return (
      <Field label="Fire mode" className={styles.mode} hint={hint}>
        <Body1 className={styles.single}>{modes[0]?.mode_name ?? 'Normal Attack'} (the only mode)</Body1>
      </Field>
    );
  }
  if (modes.length > 4) {
    return (
      <Field label="Fire mode" className={styles.mode} hint={hint}>
        <Dropdown value={modeName} selectedOptions={[modeName]} onOptionSelect={(_e, d) => actions.setMode(d.optionValue)}>
          {modes.map(m => <Option key={m.mode_name} value={m.mode_name}>{m.mode_name}</Option>)}
        </Dropdown>
      </Field>
    );
  }
  return (
    <Field label="Fire mode" className={styles.mode} hint={hint}>
      <RadioGroup layout="horizontal" value={modeName} onChange={(_e, d) => actions.setMode(d.value)}>
        {modes.map(m => <Radio key={m.mode_name} value={m.mode_name} label={m.mode_name} />)}
      </RadioGroup>
    </Field>
  );
}

export function WeaponRow() {
  const styles = useStyles();
  return (
    <div className={styles.row}>
      <WeaponField />
      <FireMode />
    </div>
  );
}
