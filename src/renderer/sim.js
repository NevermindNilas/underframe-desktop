// Turn a build into modded stats and engine input. Pure: no DOM, no worker.
import { computeWeaponStats, selectableModes } from '../shared/stats.js';
import { buildEngineInput } from '../shared/engine-input.js';
import { arcaneNotes, resolveArcanes } from '../shared/arcanes.js';
import { externalBuffNotes, reduceExternalBuffs } from '../shared/external-buffs.js';
import { resolveEnemy } from './model.js';

/**
 * Modded stats for a build, with its arcanes (resolveArcanes() output in `arcanes`) and external buffs
 * (reduceExternalBuffs().totals in `external`, null without buffs) applied.
 * @returns {{ weapon, reload, modes: object[], modifiers: object, mode: object|null, selectable: object[], enemy, arcanes,
 *   arcaneNotes, external, externalNotes } | null}
 */
export function buildStats(ctx, build, modSlots = build.mods) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) return null;
  const reload = ctx.reloadByName.get(weapon.name) ?? null;
  const resolved = resolveEnemy(ctx, build.enemy);
  // Some targets (Archons, ...) ignore armor strip, External Armor Strip included.
  const enemy = { ...resolved, armorStripImmune: Boolean(ctx.presets?.[build.enemy?.preset]?.armor_strip_immune) };
  const arcanes = resolveArcanes(build.arcanes ?? [], weapon, ctx.data);
  const buffs = build.externalBuffs ?? [];
  const external = buffs.length ? reduceExternalBuffs(buffs, ctx.data, weapon).totals : null;
  const externalStatuses = build.externalStatuses ?? [];
  const { modes, modifiers } = computeWeaponStats(weapon, modSlots, {
    modsByName: ctx.index.byName, reload, targetFaction: enemy.faction, arcanes, external, externalStatuses,
  });
  const mode = modes.find(m => m.mode_name === build.modeName) ?? modes[0] ?? null;
  return {
    weapon, reload, modes, modifiers, mode, selectable: selectableModes(weapon), enemy, arcanes,
    arcaneNotes: arcaneNotes(arcanes, mode?.finalDamageTypes, externalStatuses),
    external,
    externalStatuses,
    externalNotes: buffs.length ? externalBuffNotes(buffs, ctx.data, weapon, build.modeName) : [],
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
    external: stats.external,
    externalStatuses: stats.externalStatuses,
  });
}
