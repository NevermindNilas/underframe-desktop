// Turn a build into modded stats and engine input. Pure: no DOM, no worker.
import { computeWeaponStats, effectiveProgenitor, selectableModes } from '../shared/stats.js';
import { buildEngineInput } from '../shared/engine-input.js';
import { arcaneNotes, resolveArcanes } from '../shared/arcanes.js';
import { externalBuffNotes, mergeExternalTotals, reduceExternalBuffs } from '../shared/external-buffs.js';
import { resolveWeaponPassives } from '../shared/weapon-passives.js';
import { resolveModConditionals } from '../shared/conditional-mods.js';
import { baseModeName, combinedModes, modeChoices, resolveModeId } from '../shared/fire-modes.js';
import { resolveEnemy } from './model.js';

/**
 * Modded stats for a build, with its arcanes (resolveArcanes() output in `arcanes`) and external buffs
 * (reduceExternalBuffs().totals in `external`, null without buffs) and conditional mods' stacks (resolveModConditionals()
 * output in `conditionals`) applied.
 * `modeId` is the pick that runs (a combined "custom:" mode, or the default when the build's pick can no longer run);
 * `mode` is its stats: a combined mode's first part.
 * `choices` are the modes the build can pick (modeChoices()).
 * @returns {{ weapon, reload, modes: object[], modifiers: object, mode: object|null, modeId: string, selectable: object[], choices,
 *   enemy, arcanes, arcaneNotes, external, externalNotes, conditionals } | null}
 */
export function buildStats(ctx, build, modSlots = build.mods) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) return null;
  const reload = ctx.reloadByName.get(weapon.name) ?? null;
  const resolved = resolveEnemy(ctx, build.enemy);
  // Some targets (Archons, ...) ignore armor strip, External Armor Strip included.
  // The weapon's passives and options (Enkaus fights the target at 65% health; Dual Coda Torxica adds Cold and a
  // vulnerability) and its conditional mods join the build's own buffs and statuses.
  const passives = resolveWeaponPassives(ctx.data, weapon, build, { accurateAmmo: Boolean(reload) });
  const enemy = {
    ...resolved, hp: resolved.hp * passives.enemyHpScale, armorStripImmune: Boolean(ctx.presets?.[build.enemy?.preset]?.armor_strip_immune),
  };
  const arcanes = resolveArcanes(build.arcanes ?? [], weapon, ctx.data);
  const buffs = [...(build.externalBuffs ?? []), ...passives.buffs];
  const external = buffs.length ? reduceExternalBuffs(buffs, ctx.data, weapon).totals : null;
  const externalStatuses = targetStatusesOf(ctx, build, passives);
  const modConditionals = resolveModConditionals(modSlots, weapon, ctx.data);
  const conditionals = { ...modConditionals, totals: mergeExternalTotals(modConditionals.totals, passives.totals) };
  const { modes, modifiers } = computeWeaponStats(weapon, modSlots, {
    modsByName: ctx.index.byName, reload, targetFaction: enemy.faction, arcanes, external, externalStatuses, conditionals,
    progenitor: effectiveProgenitor(weapon, build.progenitor), data: ctx.data,
  });
  const modeId = resolveModeId(ctx.data, weapon, modSlots, build.modeName);
  const base = baseModeName(ctx.data, weapon, modeId);
  const mode = modes.find(m => m.mode_name === base) ?? modes[0] ?? null;
  return {
    weapon, reload, modes, modifiers, mode, modeId, selectable: selectableModes(weapon), choices: modeChoices(ctx.data, weapon, modSlots), enemy, arcanes,
    arcaneNotes: arcaneNotes(arcanes, mode?.finalDamageTypes, externalStatuses),
    external,
    externalStatuses,
    externalNotes: build.externalBuffs?.length ? externalBuffNotes(build.externalBuffs, ctx.data, weapon, build.modeName) : [],
    conditionals,
    // Health Enkaus's passive took off the target; the displayed DPS adds it back over the kill time, as on the site.
    removedHp: resolved.hp - enemy.hp,
  };
}

/** The statuses on the target: the build's, plus those the weapon's passives add (a higher stack count wins). */
export function targetStatusesOf(ctx, build, passives = null) {
  const weapon = ctx.weaponByName.get(build.weaponName);
  const added = (passives ?? resolveWeaponPassives(ctx.data, weapon, build)).statuses;
  const out = (build.externalStatuses ?? []).map(s => ({ ...s }));
  for (const s of added) {
    const at = out.findIndex(o => o.type === s.type);
    if (at < 0) out.push({ ...s });
    else out[at] = { ...out[at], stacks: Math.max(out[at].stacks, s.stacks) };
  }
  return out;
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
    modeName: stats.modeId || stats.mode?.mode_name || build.modeName,
    maxTime: build.simTime,
    reload: stats.reload,
    appStateRef,
    debugLog,
    arcanes: stats.arcanes,
    external: stats.external,
    externalStatuses: stats.externalStatuses,
    conditionals: stats.conditionals,
    customFireModes: combinedModes(ctx.data, stats.weapon),
  });
}
