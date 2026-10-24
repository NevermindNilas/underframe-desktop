// Assemble the JSON document `calculate_dps_wasm` expects.
import { arcaneConditionalStats } from './arcanes.js';
import { externalConditionalStats, mergeConditionalStats, mergeExternalTotals, strippedArmor } from './external-buffs.js';
import { rivenForEngine } from './rivens.js';
import { isCombinedMode, modeLabel } from './fire-modes.js';

/**
 * The large, rarely-changing part of the input. Sent once via cache_app_state and referenced by id.
 * External statuses ([{ type, stacks }]) must be here: the engine ignores a top-level copy next to appStateRef,
 * so the caller caches one app state per weapon and status list.
 */
export function buildAppState(data, weapon, { externalStatuses = [] } = {}) {
  return {
    externalStatuses: (externalStatuses ?? []).map(s => ({ type: s.type, stacks: s.stacks })),
    activeConditionals: {},
    weaponData: weapon,
    stances: data.stances ?? [],
    mode_combo_gain_overrides: data.mode_combo_gain_overrides ?? {},
    mods: data.mods ?? [],
    co_data: data.co_data ?? [],
    stance_co_data: data.stance_co_data ?? {},
    conditionalStats: {},
    incarnonData: (data.incarnons ?? []).find(i => i.name === weapon.name) ?? null,
  };
}

/**
 * Whether the run counts magazines and reloads, as underframe.site decides it: on with reload data, off with Infinite
 * Ammo or when any mode of the weapon costs no ammo (Penta's fire patch); a mode that must count them (a whole-clip
 * shot, a fixed fire rate) turns it back on for the selected mode and the modes that fire with it.
 */
export function useAccurateAmmo(weapon, weaponStats, modeName, reload, external = null, customFireModes = []) {
  const on = Boolean(reload) && !external?.infiniteAmmo && !weaponStats.some(m => m.disablesAccurateAmmo);
  const leaves = new Set(modesFiredBy(weapon, modeName, customFireModes));
  return on || weaponStats.some(m => leaves.has(m.mode_name) && m.forceAccurateAmmo === true);
}

/** The modes a pick fires: a combined mode's parts ("custom:<name>"), or the mode and its child modes. */
function modesFiredBy(weapon, modeName, customFireModes) {
  const cm = isCombinedMode(modeName) ? (customFireModes ?? []).find(c => c.name === modeLabel(modeName)) : null;
  if (cm) return cm.components.map(c => c.mode_name);
  const selected = (weapon.fire_modes ?? []).find(m => m.mode_name === modeName);
  return [modeName, ...[selected?.child_mode ?? []].flat()];
}

/**
 * @param {object} p
 * @param {object} p.weapon        weapon entry from data.weapons
 * @param {Array}  p.modSlots      [{name, rank}] in slot order (nulls allowed)
 * @param {object[]} p.weaponStats output of computeWeaponStats().modes
 * @param {object} p.enemy         {faction, hp, armor, shields, overguard, headshot, headshotMultiplier}
 * @param {string} p.modeName      selected fire mode
 * @param {number} p.maxTime       simulated seconds
 * @param {number|null} p.appStateRef  id from cache_app_state, or null to inline appState
 * @param {object} [p.appState]    required when appStateRef is null
 * @param {object|null} [p.reload] the weapon's reload_data row; without one the engine fires without reloading
 * @param {object|null} [p.arcanes] resolveArcanes() output; the same one passed to computeWeaponStats()
 * @param {object|null} [p.external] reduceExternalBuffs().totals; the same one passed to computeWeaponStats().
 *   Its conditionalStats join the arcanes', and External Armor Strip lowers the armor (unless
 *   `enemy.armorStripImmune`). External statuses are not here: they live in the app state.
 * @param {Array|null} [p.externalStatuses] the target's statuses, only to tell whether they meet an arcane's element
 *   need (a Cold status for Primary Frostbite), the same list passed to computeWeaponStats().
 * @param {object|null} [p.conditionals] resolveModConditionals() output; the same one passed to computeWeaponStats().
 *   Its totals join the external buffs' conditionalStats, as underframe.site sends them.
 */
export function buildEngineInput({ weapon, modSlots, weaponStats, enemy, modeName, maxTime, appStateRef = null, appState, reload = null, debugLog = true, arcanes = null, external: ownExternal = null, externalStatuses = null, conditionals = null, customFireModes = [] }) {
  const external = mergeExternalTotals(ownExternal, conditionals?.totals ?? null);
  const input = {
    weaponStats,
    enemyConfig: {
      faction: enemy.faction,
      hp: enemy.hp,
      armor: strippedArmor(enemy.armor, external, Boolean(enemy.armorStripImmune)),
      shields: enemy.shields,
      overguard: enemy.overguard,
      headshotMultiplier: enemy.headshotMultiplier ?? 2,
      isHeadshot: Boolean(enemy.headshot),
      // A fraction (0..1), as underframe.site sends it.
      headshotAccuracy: enemy.headshot ? 1 : 0,
      headCritEnabled: false,
      headCritMultiplier: 2,
      damageResistanceMultiplier: 1,
      attenuationEnabled: false,
      attenuationMdpt: 0,
      attenuationMdps: 0,
      // -1 means "no cap". 0 is a cap of zero status effects, which silently disables every proc and DoT.
      attenuationStatusCap: -1,
    },
    build: {
      itemName: weapon.name,
      type: weapon.type,
      // A riven goes in scaled: the engine reads its Damage, Status Damage and elements for DoT (docs/port-rivens.md 3.1).
      mods: modSlots.filter(Boolean).map(s => (s.isRiven ? rivenForEngine(s) : { name: s.name, rank: s.rank })),
      // Names only: the engine rejects objects here. It applies a few arcanes by name (Deadhead, Cryogenic, ...).
      arcanes: arcanes?.engineNames ? [...arcanes.engineNames] : [],
      // The weapon's combined modes (data.custom_fire_modes); a "custom:<name>" pick runs one of them.
      customFireModes: customFireModes ?? [],
    },
    simulationParams: {
      maxTime,
      selectedModeName: modeName,
      selectedStanceCombo: '',
      // Simulate magazines and reloads (underframe.site's default); off fires forever without reloading.
      // Weapons with no reload row would otherwise get a placeholder 1-round magazine and reload after every shot.
      useAccurateAmmo: useAccurateAmmo(weapon, weaponStats, modeName, reload, external, customFireModes),
      initialCombo: 0,
      armorStripPerHit: 0,
      generateDebugLog: debugLog,
      omitDebugLog: !debugLog,
    },
  };
  if (arcanes?.startingStacks != null) input.simulationParams.secondaryEnervateStartingStacks = arcanes.startingStacks;
  // Arcane effects the engine reads from conditionalStats (DoT damage, Encumber, Sharpshot, ...), for the simulated mode.
  // A combined mode's first part stands for it.
  const fired = modesFiredBy(weapon, modeName, customFireModes);
  const mode = weaponStats.find(m => m.mode_name === modeName) ?? weaponStats.find(m => m.mode_name === fired[0]) ?? weaponStats[0];
  // External buffs' engine fields (procs, vulnerabilities, Sonar, ...) and their stat buckets (DoT damage) join them.
  const conditionalStats = mergeConditionalStats(
    arcanes ? arcaneConditionalStats(arcanes, mode?.finalDamageTypes, externalStatuses) : null,
    external ? externalConditionalStats(external) : null,
  );
  if (appStateRef != null) {
    input.appStateRef = appStateRef;
    // A top-level conditionalStats replaces the cached app state's (empty) one.
    if (conditionalStats) input.conditionalStats = conditionalStats;
  } else {
    input.appState = conditionalStats ? { ...appState, conditionalStats } : appState;
  }
  return input;
}
