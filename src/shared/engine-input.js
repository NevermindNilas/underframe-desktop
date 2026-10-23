// Assemble the JSON document `calculate_dps_wasm` expects.

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
 */
export function buildEngineInput({ weapon, modSlots, weaponStats, enemy, modeName, maxTime, appStateRef = null, appState, debugLog = true }) {
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
      headshotAccuracy: enemy.headshot ? 100 : 0,
      headCritEnabled: false,
      headCritMultiplier: 2,
      damageResistanceMultiplier: 1,
      attenuationEnabled: false,
      attenuationMdpt: 0,
      attenuationMdps: 0,
      attenuationStatusCap: 0,
    },
    build: {
      itemName: weapon.name,
      type: weapon.type,
      mods: modSlots.filter(Boolean).map(s => ({ name: s.name, rank: s.rank })),
      arcanes: [],
    },
    simulationParams: {
      maxTime,
      selectedModeName: modeName,
      selectedStanceCombo: '',
      useAccurateAmmo: false,
      initialCombo: 0,
      armorStripPerHit: 0,
      generateDebugLog: debugLog,
      omitDebugLog: !debugLog,
    },
  };
  if (appStateRef != null) input.appStateRef = appStateRef;
  else input.appState = appState;
  return input;
}
