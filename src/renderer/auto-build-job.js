// One Auto Build run, given the game data and a pool of engine workers: the env, the scorer over the pool, the search,
// and the before/after comparison at the build's own simulation settings (the Readout's 8 seeded runs, so the result
// view shows the numbers the Readout will show). Runs inside the Auto Build worker; node tests run it directly.
import { createContext, resolveEnemy, SIM_SEEDS } from './model.js';
import { buildAppState } from '../shared/engine-input.js';
import { targetStatusesOf } from './sim.js';
import { normalizeAutoBuildSettings } from '../shared/auto-build-settings.js';
import { incarnonAfterAutoBuild } from '../shared/incarnon.js';
import {
  candidateInput, capacityPlan, chunkJobs, conditionalModStacks, createAutoBuildEnv, formaChanges, meansOf, runAutoBuild,
} from '../shared/auto-build.js';

/** What the pool needs before the search: the app state each worker caches (with the build's target statuses). */
export function appStateFor(data, build) {
  const ctx = createContext(data);
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
  return { ctx, weapon, appState: JSON.stringify(buildAppState(data, weapon, { externalStatuses: targetStatusesOf(ctx, build) })) };
}

/**
 * The env and the scorer over the pool for a build: `score(jobs)` gives each job's mean metric (the search's), and
 * `readout(modLists)` each mod list's Average DPS at the build's own simulation settings (the Readout's 8 seeded runs).
 * `stats()` counts the runs that succeeded and failed, and the first engine error.
 */
export function poolScorer({ ctx, build, settings, pool }) {
  const data = ctx.data;
  const weapon = ctx.weaponByName.get(build.weaponName);
  if (!weapon) throw new Error(`Unknown weapon: ${build.weaponName}`);
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
  return {
    env,
    score: jobs => runTasks(jobs, j => candidateInput(env, j), env.metric),
    readout: (modLists, arcanes = build.arcanes ?? [], incarnon = build.incarnon ?? null) => runTasks(
      modLists.map(mods => ({ mods, arcanes, incarnon, seeds: SIM_SEEDS })),
      j => candidateInput(env, j, { maxTime: build.simTime, plain: true }),
      'avgDps',
    ),
    stats: () => ({ failed, succeeded, firstError }),
  };
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
  const settings = normalizeAutoBuildSettings(rawSettings, data);
  const { env, score, readout, stats } = poolScorer({ ctx, build, settings, pool });
  const result = await runAutoBuild(env, {
    start, score, signal, now, onProgress, deadline: started + settings.timeLimitSeconds * 1000,
  });
  const { failed, succeeded, firstError } = stats();
  if (!succeeded && failed) throw new Error(`The engine rejected every candidate: ${firstError ?? 'no reason given'}`);
  // Before and after at the build's own settings: what the Readout shows.
  onProgress({ percent: 100, step: 'Comparing with the current build', detail: '', runs: result.runs });
  // Perks it picked for empty evolutions come with every conditional part on, as the site writes them.
  const incarnon = incarnonAfterAutoBuild(data, ctx.weaponByName.get(build.weaponName), build.incarnon ?? null, result.incarnon ?? null);
  const [before] = await readout([build.mods]);
  const [after] = await readout([result.mods], result.arcanes, incarnon);
  // Cost Control's plan for the result: the slots to re-polarise so it fits (Apply writes them in the same undo step).
  const plan = settings.costControlEnabled && result.changed ? capacityPlan(env, result.mods) : null;
  return {
    mods: result.mods,
    arcanes: result.arcanes,
    incarnon,
    formaPlan: plan ? formaChanges(env, plan) : [],
    planCapacity: plan ? { used: plan.used, capacity: plan.capacity, added: plan.added } : null,
    // Conditional mods (Galvanized and the like) are scored at the stacks their slots assume (max for new ones).
    conditionalMods: conditionalModStacks(data, result.mods),
    score: result.score,
    metric: result.metric,
    runs: result.runs,
    stoppedEarly: result.stoppedEarly,
    changed: result.changed,
    log: result.log.slice(-40),
    before,
    after,
    failedRuns: stats().failed,
    firstError: stats().firstError,
    ms: now() - started,
    settings,
  };
}
