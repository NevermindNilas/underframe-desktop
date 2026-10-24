// Turn a build into modded stats and engine input. Pure: no DOM, no worker.
import { computeWeaponStats, selectableModes } from '../shared/stats.js';
import { buildEngineInput } from '../shared/engine-input.js';
import { arcaneNotes, resolveArcanes } from '../shared/arcanes.js';
import { resolveEnemy } from './model.js';

/**
 * Modded stats for a build, with its arcanes applied (resolveArcanes() output in `arcanes`).
 * @returns {{ weapon, reload, modes: object[], modifiers: object, mode: object|null, selectable: object[], enemy, arcanes, arcaneNotes } | null}
 */
export function buildStats(ctx, build, modSlots = build.mods) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) return null;
  const reload = ctx.reloadByName.get(weapon.name) ?? null;
  const enemy = resolveEnemy(ctx, build.enemy);
  const arcanes = resolveArcanes(build.arcanes ?? [], weapon, ctx.data);
  const { modes, modifiers } = computeWeaponStats(weapon, modSlots, {
    modsByName: ctx.index.byName, reload, targetFaction: enemy.faction, arcanes,
  });
  const mode = modes.find(m => m.mode_name === build.modeName) ?? modes[0] ?? null;
  return {
    weapon, reload, modes, modifiers, mode, selectable: selectableModes(weapon), enemy, arcanes,
    arcaneNotes: arcaneNotes(arcanes, mode?.finalDamageTypes),
  };
}

/** Engine input for a build; `modSlots` overrides the build's mods (used by the best-mod sweep). */
export function engineInputFor(ctx, build, { appStateRef, debugLog = false, modSlots = build.mods } = {}) {
  const stats = buildStats(ctx, build, modSlots);
  if (!stats) throw new Error(`Unknown weapon: ${build.weaponName}`);
  return buildEngineInput({
    weapon: stats.weapon,
    modSlots,
    weaponStats: stats.modes,
    enemy: stats.enemy,
    modeName: stats.mode?.mode_name ?? build.modeName,
    maxTime: build.simTime,
    reload: stats.reload,
    appStateRef,
    debugLog,
    arcanes: stats.arcanes,
  });
}
