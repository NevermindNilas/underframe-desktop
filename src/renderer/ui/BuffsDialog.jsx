// External buffs (Readout › Buffs; docs/port-external-buffs.md, docs/declutter-spec.md 4): effects from outside the
// weapon (abilities, Helminth, passives, arcanes, shards, mods, or a typed value), statuses already on the target,
// and the user's buff presets. One Fluent dialog; the Readout shows one summary line while something is set.
//
// Layout: the preset row at the top; then two columns (one on narrow windows): what to add on the left (it stays in
// view while the lists scroll), what is active on the right. The footer says what the buffs do to the Average DPS the
// dialog covers ("Average DPS 22,161 → 485,992 ▲"), with Remove all (an inline Undo after it) and Close. Ctrl+Z and
// Ctrl+Y reach the build while it is open, outside text fields.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1, Button, Caption1, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown,
  Field, Input, Link, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Option, OptionGroup, Popover, PopoverSurface,
  Subtitle2, Switch, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import {
  AddRegular, DeleteRegular, DismissRegular, ErrorCircleRegular, InfoRegular, MoreHorizontalRegular, SaveRegular,
} from '@fluentui/react-icons';
import { actions, announce, store } from '../controller.js';
import { useApp, useDerived } from '../hooks.js';
import { fmtInt } from '../format.js';
import { snapshotOf } from '../model.js';
import * as X from '../../shared/external-buffs.js';
import { DeltaText } from './common.jsx';

const NONE = '__none__';
/** A stable empty list for store selectors (a new [] per call would never settle). */
const NO_ROWS = Object.freeze([]);
const CUSTOM = '__custom__';

const useStyles = makeStyles({
  surface: { width: 'min(880px, 94vw)', maxWidth: 'min(880px, 94vw)' },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxHeight: 'min(68vh, 720px)', overflowY: 'auto', paddingRight: tokens.spacingHorizontalXS },
  titleRow: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  // Two columns from about 680 px of content: add on the left (kept in view), what is active on the right.
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`, alignItems: 'start' },
  addColumn: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, minWidth: 0, position: 'sticky', top: 0, backgroundColor: tokens.colorNeutralBackground1, zIndex: 1 },
  activeColumn: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, minWidth: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  heading: { margin: 0 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: tokens.spacingHorizontalS, minWidth: 0 },
  presetRow: { display: 'flex', alignItems: 'flex-end', gap: tokens.spacingHorizontalS, minWidth: 0 },
  grow: { flexGrow: 1, minWidth: '180px', '& .fui-Dropdown': { minWidth: 0, width: '100%' }, '& .fui-Combobox': { minWidth: 0, width: '100%' } },
  presetField: { flexGrow: 1, minWidth: 0, maxWidth: '420px', '& .fui-Dropdown': { minWidth: 0, width: '100%' } },
  inputs: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    alignItems: 'end', '& .fui-Dropdown': { minWidth: 0, width: '100%' }, '& .fui-Input': { minWidth: 0, width: '100%' },
  },
  switches: { display: 'flex', flexWrap: 'wrap', gap: `0 ${tokens.spacingHorizontalL}` },
  preview: { color: tokens.colorNeutralForeground2 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  item: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: tokens.spacingHorizontalS,
    minHeight: '32px', paddingLeft: tokens.spacingHorizontalS, borderRadius: tokens.borderRadiusMedium,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  itemText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: { color: tokens.colorNeutralForeground3, margin: 0 },
  option: { display: 'flex', justifyContent: 'space-between', gap: tokens.spacingHorizontalM, width: '100%', minWidth: 0 },
  optionSub: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' },
  listbox: { maxHeight: 'min(360px, 50vh)', overflowY: 'auto' },
  note: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalXS, color: tokens.colorNeutralForeground1, margin: 0, '& svg': { flexShrink: 0, marginTop: '2px' } },
  popover: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, width: 'min(320px, 86vw)' },
  popoverActions: { display: 'flex', justifyContent: 'flex-end', gap: tokens.spacingHorizontalS },
  dps: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, fontVariantNumeric: 'tabular-nums', minWidth: 0 },
  dpsValue: { fontWeight: tokens.fontWeightSemibold },
  cleared: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  footerStart: { flexGrow: 1, minWidth: 0 },
  // Read by screen readers only (the dialog's description, always present).
  linkTarget: { minHeight: '24px', display: 'inline-flex', alignItems: 'center' },
  srOnly: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', margin: '-1px', padding: 0 },
});

const ABOUT = 'Effects from outside this weapon (Warframe abilities, passives, arcanes, archon shards and mods) and statuses already on the target. They belong to this build and change its DPS as you edit them.';

const numberOrNull = text => {
  const t = String(text ?? '').trim().replace(',', '.');
  return t === '' || !Number.isFinite(Number(t)) ? null : Number(t);
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Focus a list's remove button at `index` (else the one before), else `fallback`, once React has re-rendered. */
function focusAfterRemoval(listSelector, index, fallback) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll(listSelector)];
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else document.querySelector(fallback)?.focus();
  }));
}

/** A labelled number box: free text (so "-20" or "1.25" type naturally), checked on Add. */
function NumberBox({ label, value, onChange, unit, hint, testId }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        value={value}
        inputMode="decimal"
        contentAfter={unit ? <Caption1 aria-hidden="true">{unit}</Caption1> : undefined}
        onChange={(_e, d) => onChange(d.value)}
        data-testid={testId}
      />
    </Field>
  );
}

/** A small whole-number picker as a Dropdown (ranks, counts, stacks). */
function CountPicker({ label, value, min, max, onChange, format = String, testId }) {
  const values = [];
  for (let i = min; i <= max; i++) values.push(i);
  return (
    <Field label={label}>
      <Dropdown value={format(value)} selectedOptions={[String(value)]} onOptionSelect={(_e, d) => onChange(Number(d.optionValue))} data-testid={testId}>
        {values.map(v => <Option key={v} value={String(v)} text={format(v)}>{format(v)}</Option>)}
      </Dropdown>
    </Field>
  );
}

// ---------- presets ----------

function PresetRow() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const library = useApp(s => s.buffPresets);
  const buffs = useApp(s => s.build.externalBuffs ?? NO_ROWS);
  const weaponName = useApp(s => s.build.weaponName);
  const match = X.matchingPreset(library, buffs);
  const selected = match ? match.id : buffs.length ? CUSTOM : NONE;
  const [confirmApply, setConfirmApply] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [saveMsg, setSaveMsg] = useState(null);
  const [replaceAsk, setReplaceAsk] = useState(null);
  const label = selected === NONE ? 'None' : selected === CUSTOM ? 'Custom' : match.name;

  const choose = id => {
    if (id === CUSTOM) return;
    if (id === NONE) { actions.applyBuffPreset(null); return; }
    const weapon = ctx.weaponByName.get(weaponName);
    const applicable = buffs.filter(b => X.buffSupport(b.id, weapon, ctx.data).level === 'full');
    if (applicable.length) setConfirmApply(library.presets.find(p => p.id === id) ?? null);
    else actions.applyBuffPreset(id, 'overwrite');
  };

  const openSave = () => { setName(match?.name ?? ''); setSaveMsg(null); setReplaceAsk(null); setSaveOpen(true); };
  const save = async (replace = false) => {
    const r = await actions.saveBuffPreset(name, { replace });
    if (r.confirm) { setReplaceAsk(r.confirm); setSaveMsg(null); return; }
    if (r.error) { setSaveMsg(r.error); return; }
    setSaveOpen(false);
    setReplaceAsk(null);
    announce(`Saved the buff preset "${r.preset.name}".`);
  };

  return (
    <section className={styles.section} aria-label="Buff presets">
      <div className={styles.presetRow}>
        <Field label="Buff preset" className={styles.presetField}>
          <Dropdown value={label} selectedOptions={[selected]} onOptionSelect={(_e, d) => choose(d.optionValue)} data-testid="preset-select">
            <Option value={NONE} text="None">None</Option>
            {library.presets.map(p => <Option key={p.id} value={p.id} text={p.name}>{p.name}</Option>)}
            {selected === CUSTOM ? <Option value={CUSTOM} text="Custom" disabled>Custom</Option> : null}
          </Dropdown>
        </Field>
        <Popover open={saveOpen} trapFocus withArrow positioning="below-end" onOpenChange={(_e, d) => setSaveOpen(d.open)}>
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content="Save or delete a preset (a list of buffs to reuse on any build)" relationship="label">
                <Button appearance="subtle" icon={<MoreHorizontalRegular />} data-testid="preset-menu" />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {/* Disabled items stay focusable in a menu, and say why. */}
                <MenuItem icon={<SaveRegular />} disabled={!buffs.length} secondaryContent={buffs.length ? undefined : 'Add a buff first'} onClick={openSave} data-testid="preset-save">Save preset…</MenuItem>
                <MenuItem icon={<DeleteRegular />} disabled={!match} secondaryContent={match ? undefined : 'Choose a preset first'} onClick={() => setConfirmDelete(true)} data-testid="preset-delete">Delete preset…</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <PopoverSurface aria-label="Save buff preset">
            <form className={styles.popover} onSubmit={e => { e.preventDefault(); save(false); }}>
              <Field label="Preset name" validationState="none" validationMessage={saveMsg ?? undefined} validationMessageIcon={saveMsg ? <ErrorCircleRegular /> : undefined}>
                <Input value={name} maxLength={X.PRESET_NAME_MAX} autoFocus onChange={(_e, d) => { setName(d.value); setSaveMsg(null); setReplaceAsk(null); }} data-testid="preset-name" />
              </Field>
              {replaceAsk ? <Body1>{replaceAsk}</Body1> : null}
              <div className={styles.popoverActions}>
                <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
                {replaceAsk
                  ? <Button appearance="primary" onClick={() => save(true)} data-testid="preset-replace">Replace</Button>
                  : <Button appearance="primary" type="submit" data-testid="preset-save-confirm">Save</Button>}
              </div>
            </form>
          </PopoverSurface>
        </Popover>
      </div>

      <Dialog modalType="alert" open={Boolean(confirmApply)} onOpenChange={(_e, d) => { if (!d.open) setConfirmApply(null); }}>
        <DialogSurface aria-describedby="apply-preset-body">
          <DialogBody>
            <DialogTitle>Apply Buff Preset</DialogTitle>
            <DialogContent id="apply-preset-body">Add "{confirmApply?.name}" to your current buffs, or overwrite them?</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmApply(null)}>Cancel</Button>
              <Button onClick={() => { actions.applyBuffPreset(confirmApply.id, 'overwrite'); setConfirmApply(null); }} data-testid="preset-overwrite">Overwrite Current Buffs</Button>
              {/* Focus starts on Add, as on the site. */}
              <Button appearance="primary" autoFocus onClick={() => { actions.applyBuffPreset(confirmApply.id, 'add'); setConfirmApply(null); }} data-testid="preset-add">Add to Current Buffs</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog modalType="alert" open={confirmDelete} onOpenChange={(_e, d) => { if (!d.open) setConfirmDelete(false); }}>
        <DialogSurface aria-describedby="delete-preset-body">
          <DialogBody>
            <DialogTitle>Delete preset</DialogTitle>
            <DialogContent id="delete-preset-body">Delete the buff preset "{match?.name}"? Builds keep the buffs they have.</DialogContent>
            <DialogActions>
              <Button autoFocus onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button appearance="primary" onClick={async () => { if (match) await actions.deleteBuffPreset(match.id); setConfirmDelete(false); }} data-testid="preset-delete-confirm">Delete</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}

// ---------- add a buff ----------

const TYPE_PREFIX = 'type:';
const INPUT_HINT = { percentage: 'percent', elemental: 'percent and element', elemental_fixed: 'element', toggle: 'on or off', value: 'number', numeric: 'number', heat_inherit: 'heat and faction' };

function useChoices(ctx, weapon) {
  return useMemo(() => {
    if (!weapon) return [];
    const types = X.offeredBuffTypes(ctx.data, weapon).map(e => ({
      key: `${TYPE_PREFIX}${e.id}`, text: X.buffTypeName(e), sub: X.buffValueKind(e.id) === 'additive' ? INPUT_HINT[e.input_type] ?? '' : 'multiplier',
    }));
    const groups = [{ label: 'Buff types', items: types }];
    const sources = X.sourcesFor(ctx.data, weapon);
    for (const kind of X.SOURCE_GROUP_ORDER) {
      const items = sources.filter(s => s.kind === kind).map(s => {
        const rows = X.sourceRows(s, X.defaultSourceOptions(s), weapon, ctx.data);
        return { key: s.key, text: s.label, sub: rows.map(r => X.buffValueText(r, ctx.data)).join(', '), source: s };
      });
      if (items.length) groups.push({ label: X.sourceGroupLabel(kind), items });
    }
    return groups;
  }, [ctx, weapon]);
}

function SourceInputs({ source, opts, setOpts }) {
  const styles = useStyles();
  const need = X.sourceInputs(source);
  const set = patch => setOpts(o => ({ ...o, ...patch }));
  const num = k => (v => set({ [k]: v }));
  return (
    <>
      <div className={styles.inputs}>
        {need.strength ? <NumberBox label="Ability strength" unit="%" value={opts.strength} onChange={num('strength')} testId="source-strength" /> : null}
        {need.duration ? <NumberBox label="Ability duration" unit="%" value={opts.duration} onChange={num('duration')} /> : null}
        {need.shields ? <NumberBox label="Shield capacity" value={opts.shields} onChange={num('shields')} /> : null}
        {need.gut ? <CountPicker label="Enemies in the gut" value={opts.gut} min={0} max={5} onChange={v => set({ gut: v })} /> : null}
        {need.augmentRank != null && need.augments.length ? <CountPicker label="Augment rank" value={opts.augmentRank} min={0} max={need.augmentRank} onChange={v => set({ augmentRank: v })} /> : null}
        {need.modRank != null ? <CountPicker label="Mod rank" value={opts.modRank} min={0} max={need.modRank} onChange={v => set({ modRank: v })} /> : null}
        {need.setPieces ? <CountPicker label="Set mods equipped" value={opts.setPieces} min={1} max={need.setPieces} onChange={v => set({ setPieces: v })} /> : null}
        {need.shardCount ? <CountPicker label="Shards of this kind" value={opts.shardCount} min={1} max={5} onChange={v => set({ shardCount: v })} /> : null}
        {need.shardTypes ? <CountPicker label="Crimson, azure, violet shards" value={opts.shardTypes} min={0} max={5} onChange={v => set({ shardTypes: v })} /> : null}
      </div>
      {need.augments.length || need.tauforged || need.coaction ? (
        <div className={styles.switches}>
          {need.augments.map(a => (
            <Switch key={a} label={`With ${a}`} checked={Boolean(opts.augments?.[a])} onChange={(_e, d) => set({ augments: { ...opts.augments, [a]: d.checked } })} />
          ))}
          {need.tauforged ? <Switch label="Tauforged" checked={opts.tauforged !== false} onChange={(_e, d) => set({ tauforged: d.checked })} /> : null}
          {need.coaction ? <Switch label="With Coaction Drift" checked={Boolean(opts.coaction)} onChange={(_e, d) => set({ coaction: d.checked })} /> : null}
        </div>
      ) : null}
    </>
  );
}

function AddBuff() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const weaponName = useApp(s => s.build.weaponName);
  const weapon = ctx.weaponByName.get(weaponName);
  const groups = useChoices(ctx, weapon);
  const [choice, setChoice] = useState(null);
  const [query, setQuery] = useState(null);
  const [value, setValue] = useState('');
  const [element, setElement] = useState(null);
  const [heat, setHeat] = useState('225');
  const [faction, setFaction] = useState('55');
  const [opts, setOpts] = useState({});
  const [error, setError] = useState(null);

  const all = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const chosen = all.find(i => i.key === choice) ?? null;
  const entry = chosen && !chosen.source ? X.buffCatalogue(ctx.data).byId.get(choice.slice(TYPE_PREFIX.length)) : null;
  const inputs = entry ? X.buffInputs(entry) : null;
  const elements = entry && inputs?.element ? X.elementsFor(entry.id) : [];
  const warning = entry && inputs?.value === 'percent' ? X.buffValueWarning(entry.id, numberOrNull(value)) : null;

  useEffect(() => { if (choice && !chosen) setChoice(null); }, [choice, chosen]);

  const filtered = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return groups;
    const words = q.split(/\s+/);
    return groups
      .map(g => ({ ...g, items: g.items.filter(i => words.every(w => `${i.text} ${i.sub} ${g.label}`.toLowerCase().includes(w))) }))
      .filter(g => g.items.length);
  }, [groups, query]);

  const pick = key => {
    setChoice(key);
    setQuery(null);
    setError(null);
    const item = all.find(i => i.key === key);
    if (item?.source) {
      setValue('');
      const d = X.defaultSourceOptions(item.source);
      setOpts({ ...d, strength: String(d.strength), duration: String(d.duration), shields: String(d.shields) });
    } else {
      const e = X.buffCatalogue(ctx.data).byId.get(key.slice(TYPE_PREFIX.length));
      const inp = e ? X.buffInputs(e) : null;
      // A multiplier starts at its typical value (Sonar: 500%), so an empty field never reads as ×0.
      setValue(inp?.initial ?? '');
      const els = e && inp?.element ? X.elementsFor(e.id) : [];
      setElement(els.includes(element) ? element : els.includes('Electricity') ? 'Electricity' : els[0] ?? null);
    }
  };

  const sourceRows = chosen?.source
    ? X.sourceRows(chosen.source, {
      ...opts, strength: numberOrNull(opts.strength) ?? NaN, duration: numberOrNull(opts.duration) ?? NaN, shields: numberOrNull(opts.shields) ?? NaN,
    }, weapon, ctx.data)
    : [];

  const add = () => {
    if (!chosen) { setError('Choose a buff or a source.'); return; }
    if (chosen.source) {
      if (!sourceRows.length) { setError('With these settings this source adds nothing to this weapon.'); return; }
      actions.addSourceBuffs(sourceRows);
      setError(null);
      return;
    }
    const r = X.buffFromInput(ctx.data, entry.id, { value: numberOrNull(value), element, heat: numberOrNull(heat), faction: numberOrNull(faction) });
    if (r.error) { setError(r.error); return; }
    actions.addExternalBuff(r.row);
    setError(null);
    setValue(inputs?.initial ?? '');
  };

  return (
    <section className={styles.section} aria-labelledby="buff-add-heading">
      <Subtitle2 as="h3" id="buff-add-heading" className={styles.heading}>Add a buff</Subtitle2>
      <Field label="Buff or source" hint="A buff type and its value, or an ability, passive, arcane, shard or mod that works it out.">
        <Combobox
          value={query ?? chosen?.text ?? ''}
          selectedOptions={choice ? [choice] : []}
          placeholder="Search buffs, abilities, arcanes"
          onChange={e => setQuery(e.target.value)}
          onOptionSelect={(_e, d) => { if (d.optionValue) pick(d.optionValue); }}
          onOpenChange={(_e, d) => { if (!d.open) setQuery(null); }}
          // A fixed-height list: auto-sizing it inside the dialog re-measures in a loop as the search filters it.
          listbox={{ className: styles.listbox }}
          data-testid="buff-type"
          data-focus-id="buff-type"
        >
          {filtered.map(g => (
            <OptionGroup key={g.label} label={g.label}>
              {g.items.map(i => (
                <Option key={i.key} value={i.key} text={i.text} data-key={i.key}>
                  <span className={styles.option}>
                    <span>{i.text}</span>
                    {i.sub ? <Caption1 className={styles.optionSub}>{i.sub}</Caption1> : null}
                  </span>
                </Option>
              ))}
            </OptionGroup>
          ))}
          {filtered.length ? null : <Option key="none" value="" text="" disabled>Nothing matches "{query}"</Option>}
        </Combobox>
      </Field>

      {entry ? (
        <div className={styles.inputs}>
          {inputs.value ? (
            <NumberBox
              label={inputs.label ?? (inputs.value === 'percent' ? 'Value' : entry.id === 'corrosive_max_stack' ? 'Extra stacks (1 to 4)' : entry.id === 'arcsphere' ? 'Procs (0 to 3)' : 'Value')}
              unit={inputs.value === 'percent' ? '%' : undefined}
              value={value}
              onChange={v => { setValue(v); setError(null); }}
              testId="buff-value"
            />
          ) : null}
          {inputs.element ? (
            <Field label="Element">
              <Dropdown value={element ?? ''} selectedOptions={element ? [element] : []} onOptionSelect={(_e, d) => setElement(d.optionValue)} data-testid="buff-element">
                {elements.map(el => <Option key={el} value={el}>{el}</Option>)}
              </Dropdown>
            </Field>
          ) : null}
          {inputs.heatFaction ? (
            <>
              <NumberBox label="Heat" unit="%" value={heat} onChange={setHeat} />
              <NumberBox label="Faction" unit="%" value={faction} onChange={setFaction} />
            </>
          ) : null}
        </div>
      ) : null}
      {chosen?.source ? (
        <>
          <SourceInputs source={chosen.source} opts={opts} setOpts={setOpts} />
          <Caption1 className={styles.preview} data-testid="source-preview">
            {sourceRows.length ? `Adds ${sourceRows.map(r => `${X.buffRowName(r, ctx.data)} ${X.buffValueText(r, ctx.data)}`).join(', ')}.` : 'Adds nothing to this weapon with these settings.'}
          </Caption1>
        </>
      ) : null}
      {entry?.description ? <Caption1 className={styles.preview}>{entry.description}</Caption1> : null}
      {/* Neutral text with a glyph: red is kept for signed changes (docs/declutter-spec.md 3). */}
      {warning ? <Caption1 className={styles.note} data-testid="buff-warning"><InfoRegular aria-hidden="true" /> {warning}</Caption1> : null}
      {error ? <Caption1 role="alert" className={styles.note} data-testid="buff-error"><ErrorCircleRegular aria-hidden="true" /> {error}</Caption1> : null}
      <div className={styles.row}>
        <Button appearance="primary" icon={<AddRegular />} disabledFocusable={!chosen} onClick={add} data-testid="buff-add">Add buff</Button>
      </div>
    </section>
  );
}

function AddStatus() {
  const styles = useStyles();
  const buffs = useApp(s => s.build.externalBuffs ?? NO_ROWS);
  const [type, setType] = useState('Viral');
  const max = X.maxStacksFor(type, buffs);
  const [stacks, setStacks] = useState(10);
  const shown = Math.min(stacks, max);
  return (
    <section className={styles.section} aria-labelledby="status-add-heading">
      <Subtitle2 as="h3" id="status-add-heading" className={styles.heading}>Add a target status</Subtitle2>
      <div className={styles.inputs}>
        <Field label="Status">
          <Dropdown value={type} selectedOptions={[type]} onOptionSelect={(_e, d) => setType(d.optionValue)} data-testid="status-type">
            {X.STATUS_TYPES.map(t => <Option key={t} value={t}>{t}</Option>)}
          </Dropdown>
        </Field>
        {/* A Dropdown, not a SpinButton: its arrows were 24x16, under the app's 24 px target size. */}
        <CountPicker label="Stacks" value={shown} min={1} max={max} onChange={setStacks} format={v => `×${v}`} testId="status-stacks" />
      </div>
      <div className={styles.row}>
        <Button icon={<AddRegular />} onClick={() => actions.addExternalStatus(type, shown)} data-testid="status-add">Add status</Button>
      </div>
    </section>
  );
}

// ---------- the lists ----------

function BuffList() {
  const styles = useStyles();
  const ctx = useApp(s => s.ctx);
  const buffs = useApp(s => s.build.externalBuffs ?? NO_ROWS);
  const weaponName = useApp(s => s.build.weaponName);
  const weapon = ctx.weaponByName.get(weaponName);
  const remove = i => {
    actions.removeExternalBuff(i);
    // Keyboard focus stays in the list: the next row's remove button, else the one before, else the heading.
    focusAfterRemoval('[data-testid="buff-remove"]', i, '#buff-list-heading');
  };
  return (
    <section className={styles.section} aria-labelledby="buff-list-heading">
      <Subtitle2 as="h3" id="buff-list-heading" tabIndex={-1} className={styles.heading}>Active buffs</Subtitle2>
      {buffs.length ? (
        <ul className={styles.list} aria-labelledby="buff-list-heading">
          {buffs.map((b, i) => {
            const line = X.buffLine(b, ctx.data);
            const support = X.buffSupport(b.id, weapon, ctx.data);
            return (
              // eslint-disable-next-line react/no-array-index-key -- rows may repeat (vulnerabilities); the index is their identity
              <li key={`${i}-${line}`} className={styles.item} data-testid="buff-row">
                <Body1 className={styles.itemText} title={support.level === 'none' ? `${line}: not simulated, ${support.note}` : line}>
                  {line}{support.level === 'none' ? <span className={styles.muted}> · not simulated</span> : null}
                </Body1>
                <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label={`Remove ${line}`} onClick={() => remove(i)} data-testid="buff-remove" />
              </li>
            );
          })}
        </ul>
      ) : <Body1 as="p" className={styles.empty}>No external buffs.</Body1>}
    </section>
  );
}

function StatusList() {
  const styles = useStyles();
  const statuses = useApp(s => s.build.externalStatuses ?? NO_ROWS);
  const remove = (type, i) => {
    actions.removeExternalStatus(type);
    focusAfterRemoval('[data-testid="status-remove"]', i, '#status-heading');
  };
  return (
    <section className={styles.section} aria-labelledby="status-heading">
      <Subtitle2 as="h3" id="status-heading" tabIndex={-1} className={styles.heading}>Target statuses</Subtitle2>
      {statuses.length ? (
        <ul className={styles.list} aria-labelledby="status-heading">
          {statuses.map((s, i) => (
            <li key={s.type} className={styles.item} data-testid="status-row">
              <Body1 className={styles.itemText}>{X.statusLine(s)}</Body1>
              <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label={`Remove ${X.statusLine(s)}`} onClick={() => remove(s.type, i)} data-testid="status-remove" />
            </li>
          ))}
        </ul>
      ) : <Body1 as="p" className={styles.empty}>No external statuses configured.</Body1>}
    </section>
  );
}

/** What Remove all took away, with Undo, until the build changes in another way. */
function ClearedLine({ cleared, onDone }) {
  const styles = useStyles();
  const snapshot = useApp(s => snapshotOf(s.build));
  const stale = cleared && snapshot !== cleared.after;
  useEffect(() => { if (stale) onDone(); }, [stale, onDone]);
  if (!cleared || stale) return null;
  return (
    <div className={styles.cleared} data-testid="buffs-cleared">
      <Body1>{cleared.text}</Body1>
      <Link
        as="button"
        className={styles.linkTarget}
        id="buffs-undo-clear"
        onClick={() => { if (snapshotOf(store.get().build) === cleared.after) actions.undo(); onDone(); announce('Restored the buffs and statuses.'); }}
        data-testid="buffs-undo-clear"
      >
        Undo
      </Link>
    </div>
  );
}

/** The footer's live line: the Average DPS when the dialog opened and now, as the hero shows it (which the dialog covers). */
function DpsLine() {
  const styles = useStyles();
  const sim = useApp(s => s.sim);
  const baseline = useApp(s => s.buffsBaseline);
  const { simKey } = useDerived();
  const settled = sim.summary?.ok && sim.key === simKey && sim.status !== 'error' ? sim.summary.avgDps : null;
  const delta = settled != null && baseline > 0 ? (settled - baseline) / baseline : null;
  const changed = baseline != null && settled != null && Math.abs(settled - baseline) > 1e-9;
  return (
    <div className={styles.dps} role="status" data-testid="buffs-dps">
      <Caption1 className={styles.muted}>Average DPS</Caption1>
      {settled == null ? (
        <Body1 className={styles.dpsValue}>{baseline != null ? `${fmtInt(baseline)} → …` : '…'}</Body1>
      ) : changed ? (
        <>
          <Body1 className={styles.dpsValue}>{fmtInt(baseline)} → {fmtInt(settled)}</Body1>
          <DeltaText delta={delta} title="Since the dialog opened" />
        </>
      ) : <Body1 className={styles.dpsValue}>{fmtInt(settled)}</Body1>}
    </div>
  );
}

export function BuffsDialog() {
  const styles = useStyles();
  const open = useApp(s => s.buffsOpen);
  const hasBuild = useApp(s => Boolean(s.build && s.ctx));
  const any = useApp(s => Boolean(s.build?.externalBuffs?.length || s.build?.externalStatuses?.length));
  const [cleared, setCleared] = useState(null);
  const doneRef = useRef(() => setCleared(null));
  useEffect(() => { if (!open) setCleared(null); }, [open]);
  // The dialog opens with focus in the buff search: adding a buff is what it is for. (Fluent's first-focusable rule
  // would pick the title's Close button; autoFocus is not honoured inside the Combobox.)
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('[data-testid="buff-type"]')?.focus()));
  }, [open]);
  // Esc closes the dialog even when focus fell to the page (a removed row, a closed popover).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      if (e.key === 'Escape' && !e.defaultPrevented && (document.activeElement === document.body || !document.activeElement)) {
        e.preventDefault();
        actions.setBuffsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!hasBuild) return null;
  const removeAll = () => {
    const b = store.get().build;
    const nb = b.externalBuffs?.length ?? 0;
    const ns = b.externalStatuses?.length ?? 0;
    if (!actions.clearExternal()) return;
    const what = [nb ? plural(nb, 'buff', 'buffs') : null, ns ? plural(ns, 'status', 'statuses') : null].filter(Boolean).join(' and ');
    setCleared({ text: `Removed ${what}.`, after: snapshotOf(store.get().build) });
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('buffs-undo-clear')?.focus()));
  };
  return (
    <Dialog open={open} onOpenChange={(_e, d) => actions.setBuffsOpen(d.open)}>
      <DialogSurface className={styles.surface} aria-describedby="buffs-about" data-testid="buffs-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" icon={<DismissRegular />} onClick={() => actions.setBuffsOpen(false)} />}>
            <span className={styles.titleRow}>
              External buffs
              <Tooltip relationship="label" content={ABOUT}>
                <Button appearance="subtle" size="small" icon={<InfoRegular />} />
              </Tooltip>
            </span>
          </DialogTitle>
          <span id="buffs-about" className={styles.srOnly}>{ABOUT}</span>
          <DialogContent className={styles.content}>
            <PresetRow />
            <div className={styles.columns}>
              <div className={styles.addColumn}>
                <AddBuff />
                <AddStatus />
              </div>
              <div className={styles.activeColumn}>
                <ClearedLine cleared={cleared} onDone={doneRef.current} />
                <BuffList />
                <StatusList />
              </div>
            </div>
          </DialogContent>
          <DialogActions position="start" className={styles.footerStart}>
            <DpsLine />
          </DialogActions>
          <DialogActions position="end">
            <Button appearance="subtle" disabledFocusable={!any} onClick={removeAll} data-testid="buffs-clear">Remove all</Button>
            <Button onClick={() => actions.setBuffsOpen(false)} data-testid="buffs-close">Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
