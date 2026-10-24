// The fire modes a build can pick: the weapon's own (child modes run with their parent) and the combined modes the
// data defines (data.custom_fire_modes: an impact and its explosion as one attack), named "custom:<name>" as
// underframe.site names them. data.default_fire_modes picks the starting mode for a few weapons (Penta, Ogris: their
// combined impact and explosion; with Napalm Grenades or Nightwatch Napalm equipped, the combined mode with the field).
import { preparedModes, selectableModes } from './stats.js';

export const COMBINED_PREFIX = 'custom:';
export const isCombinedMode = id => String(id ?? '').startsWith(COMBINED_PREFIX);
/** "custom:Rocket Impact (Combined)" -> "Rocket Impact (Combined)". */
export const modeLabel = id => (isCombinedMode(id) ? String(id).slice(COMBINED_PREFIX.length) : String(id ?? ''));

/** The data's combined modes for a weapon, as the engine takes them in build.customFireModes. */
export function combinedModes(data, weapon) {
  const list = data?.custom_fire_modes?.[weapon?.name];
  return Array.isArray(list) ? list : [];
}

/** A combined mode can run when all its parts exist on the weapon with these mods (and its augment is equipped). */
function combinedAvailable(cm, names, equipped) {
  const parts = Array.isArray(cm?.components) ? cm.components : [];
  return parts.length > 0 && parts.every(c => names.has(c.mode_name) && (!c.specialTargeting?.augment || equipped.has(c.specialTargeting.augment)));
}

/**
 * Modes to choose from, in display order: the weapon's own, then its combined modes.
 * @returns {Array<{ id: string, label: string, combined: boolean }>}
 */
export function modeChoices(data, weapon, mods = []) {
  if (!weapon) return [];
  const names = new Set(preparedModes(weapon, mods).map(m => m.mode_name));
  const equipped = new Set((mods ?? []).filter(Boolean).map(s => s.name));
  return [
    ...selectableModes(weapon).filter(m => names.has(m.mode_name)).map(m => ({ id: m.mode_name, label: m.mode_name, combined: false })),
    ...combinedModes(data, weapon).filter(cm => combinedAvailable(cm, names, equipped))
      .map(cm => ({ id: COMBINED_PREFIX + cm.name, label: cm.name, combined: true })),
  ];
}

/** The mode a new build of this weapon starts on: the data's default (one that suits the equipped mods first). */
export function defaultModeId(data, weapon, mods = []) {
  const choices = modeChoices(data, weapon, mods);
  const ids = new Set(choices.map(c => c.id));
  const entry = data?.default_fire_modes?.weapons?.[weapon?.name];
  if (entry && typeof entry === 'object') {
    for (const [mod, id] of Object.entries(entry.equippedModModes ?? {})) {
      if ((mods ?? []).some(s => s?.name === mod) && ids.has(id)) return id;
    }
    if (ids.has(entry.mode)) return entry.mode;
  } else if (typeof entry === 'string' && ids.has(entry)) return entry;
  return choices[0]?.id ?? '';
}

/** A build's mode if it can still run, else the default (a combined mode whose augment was removed). */
export function resolveModeId(data, weapon, mods, id) {
  return modeChoices(data, weapon, mods).some(c => c.id === id) ? id : defaultModeId(data, weapon, mods);
}

/** The combined mode's parts, or null for a plain mode. */
function combinedOf(data, weapon, id) {
  return isCombinedMode(id) ? combinedModes(data, weapon).find(cm => cm.name === modeLabel(id)) ?? null : null;
}

/** The mode whose stats represent a pick: a combined mode's base part (its first hit), else the mode itself. */
export function baseModeName(data, weapon, id) {
  const cm = combinedOf(data, weapon, id);
  if (!cm) return id;
  return (cm.components.find(c => c.isBase) ?? cm.components[0])?.mode_name ?? id;
}

/** Every mode a pick fires: a combined mode's parts, or the mode and its child modes. */
export function modesFired(data, weapon, id) {
  const cm = combinedOf(data, weapon, id);
  if (cm) return cm.components.map(c => c.mode_name);
  const mode = (weapon?.fire_modes ?? []).find(m => m.mode_name === id);
  return [id, ...[mode?.child_mode ?? []].flat()];
}
