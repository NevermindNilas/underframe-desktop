// One Auto Build run, given the game data and a pool of engine workers: the env, the scorer over the pool, the search,
// and the before/after comparison at the build's own simulation settings (the Readout's 8 seeded runs, so the result
// view shows the numbers the Readout will show). Runs inside the Auto Build worker; node tests run it directly.
import { createContext, resolveEnemy, SIM_SEEDS } from './model.js';
import { buildAppState } from '../shared/engine-input.js';
import { normalizeAutoBuildSettings } from '../shared/auto-build-settings.js';
import {
  candidateInput, capacityPlan, chunkJobs, conditionalModNames, createAutoBuildEnv, formaChanges, meansOf, runAutoBuild,
} from '../shared/auto-build.js';

/** What the pool needs before the search: the app state each worker caches (with the build's target statuses). */
export function appStateFor(data, build) {
  const ctx = createContext(data);
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
  return { ctx, weapon, appState: JSON.stringify(buildAppState(data, weapon, { externalStatuses: build.externalStatuses ?? [] })) };
}

/**
 * @param {object} o
 * @param {object} o.ctx createContext(data)
 * @param {object} o.build the working build (weapon, mode, target, buffs, statuses, polarities)
 * @param {{ mods, arcanes }} o.start the starting point (the kept slots of the build)
 * @param {object} o.settings Auto Build settings (normalised here)
 * @param {{ run(tasks): Promise<Array<{ sum, count, errors, error }>> }} o.pool
 * @param {{ aborted: boolean }} [o.signal]
 * @param {(p) => void} [o.onProgress]
 * @param {() => number} [o.now]
 */
export async function runAutoBuildJob({ ctx, build, start, settings: rawSettings, pool, signal = null, onProgress = () => {}, now = Date.now }) {
  const started = now();
  const data = ctx.data;
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
  const settings = normalizeAutoBuildSettings(rawSettings, data);
  const enemy = { ...resolveEnemy(ctx, build.enemy), armorStripImmune: Boolean(ctx.presets?.[build.enemy?.preset]?.armor_strip_immune) };
  const env = createAutoBuildEnv({ data, weapon, reload: ctx.reloadByName.get(weapon.name) ?? null, build, enemy, settings, index: ctx.index });
  let failed = 0;
  let succeeded = 0;
  let firstError = null;
  const runTasks = async (jobs, inputOf, metric) => {
    const tasks = chunkJobs(jobs);
    const inputs = jobs.map(inputOf);
    const results = await pool.run(tasks.map(t => ({ input: inputs[t.job], seeds: t.seeds, metric })));
    for (const r of results) {
      failed += r?.errors ?? 0;
      succeeded += r?.count ?? 0;
      if (r?.error && !firstError) firstError = r.error;
    }
    return meansOf(jobs.length, tasks, results);
  };
  const score = jobs => runTasks(jobs, j => candidateInput(env, j), env.metric);
  const result = await runAutoBuild(env, {
    start, score, signal, now, onProgress, deadline: started + settings.timeLimitSeconds * 1000,
  });
  if (!succeeded && failed) throw new Error(`The engine rejected every candidate: ${firstError ?? 'no reason given'}`);
  // Before and after at the build's own settings: what the Readout shows.
  onProgress({ percent: 100, step: 'Comparing with the current build', detail: '', runs: result.runs });
  const original = { mods: build.mods, arcanes: build.arcanes ?? [] };
  const [before, after] = await runTasks(
    [original, result].map(c => ({ mods: c.mods, arcanes: c.arcanes, seeds: SIM_SEEDS })),
    j => candidateInput(env, j, { maxTime: build.simTime, plain: true }),
    'avgDps',
  );
  // Cost Control's plan for the result: the slots to re-polarise so it fits (Apply writes them in the same undo step).
  const plan = settings.costControlEnabled && result.changed ? capacityPlan(env, result.mods) : null;
  return {
    mods: result.mods,
    arcanes: result.arcanes,
    formaPlan: plan ? formaChanges(env, plan) : [],
    planCapacity: plan ? { used: plan.used, capacity: plan.capacity, added: plan.added } : null,
    // Conditional mods (Galvanized and the like) are scored on their base stats: the stats model has no stacks.
    conditionalMods: conditionalModNames(data, result.mods),
    score: result.score,
    metric: result.metric,
    runs: result.runs,
    stoppedEarly: result.stoppedEarly,
    changed: result.changed,
    log: result.log.slice(-40),
    before,
    after,
    failedRuns: failed,
    firstError,
    ms: now() - started,
    settings,
  };
}
