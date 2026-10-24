// Assemble the JSON document `calculate_dps_wasm` expects.
import { arcaneConditionalStats } from './arcanes.js';

/** The large, rarely-changing part of the input. Sent once via cache_app_state and referenced by id. */
export function buildAppState(data, weapon) {
  return {
    externalStatuses: [],
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
 */
export function buildEngineInput({ weapon, modSlots, weaponStats, enemy, modeName, maxTime, appStateRef = null, appState, reload = null, debugLog = true, arcanes = null }) {
  const input = {
    weaponStats,
    enemyConfig: {
      faction: enemy.faction,
      hp: enemy.hp,
      armor: enemy.armor,
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
      mods: modSlots.filter(Boolean).map(s => ({ name: s.name, rank: s.rank })),
      // Names only: the engine rejects objects here. It applies a few arcanes by name (Deadhead, Cryogenic, ...).
      arcanes: arcanes?.engineNames ? [...arcanes.engineNames] : [],
    },
    simulationParams: {
      maxTime,
      selectedModeName: modeName,
      selectedStanceCombo: '',
      // Simulate magazines and reloads (underframe.site's default); off fires forever without reloading.
      // Weapons with no reload row would otherwise get a placeholder 1-round magazine and reload after every shot.
      useAccurateAmmo: Boolean(reload),
      initialCombo: 0,
      armorStripPerHit: 0,
      generateDebugLog: debugLog,
      omitDebugLog: !debugLog,
    },
  };
  if (arcanes?.startingStacks != null) input.simulationParams.secondaryEnervateStartingStacks = arcanes.startingStacks;
  // Arcane effects the engine reads from conditionalStats (DoT damage, Encumber, Sharpshot, ...), for the simulated mode.
  const mode = weaponStats.find(m => m.mode_name === modeName) ?? weaponStats[0];
  const conditionalStats = arcanes ? arcaneConditionalStats(arcanes, mode?.finalDamageTypes) : null;
  if (appStateRef != null) {
    input.appStateRef = appStateRef;
    // A top-level conditionalStats replaces the cached app state's (empty) one.
    if (conditionalStats) input.conditionalStats = conditionalStats;
  } else {
    input.appState = conditionalStats ? { ...appState, conditionalStats } : appState;
  }
  return input;
}
