// One riven tool run (docs/port-rivens.md 13), given the game data and a pool of engine workers: the env and scorer
// (Auto Build's, at the tool's sim time and optimisation), the tool's search (src/shared/riven-tools.js), and the
// proposals' Average DPS at the build's own simulation settings, so the result view shows the Readout's numbers.
// Runs inside the Auto Build worker; node tests run it directly.
import { normalizeAutoBuildSettings } from '../shared/auto-build-settings.js';
import { autoRiven, compareRivens, normalizeRivenToolOptions, rivenToolSettings, rollsData, slotMyRiven } from '../shared/riven-tools.js';
import { poolScorer } from './auto-build-job.js';

export const RIVEN_TOOLS = ['slot', 'auto', 'rolls', 'compare'];

/**
 * @param {object} o
 * @param {object} o.ctx createContext(data)
 * @param {object} o.build the working build
 * @param {'slot'|'auto'|'rolls'|'compare'} o.tool
 * @param {object} o.options the setup's choices (normalizeRivenToolOptions)
 * @param {object} o.settings the active Auto Build config's settings (its lists, Cost Control, Forma)
 * @param {object[]} [o.rivens] Slot My Riven: the library; compare: the two rivens
 * @param {{ run(tasks) }} o.pool
 * @returns {Promise<object>} the tool's result plus `readout: { before, proposals: { [key]: dps } }`, `failedRuns`, `ms`
 */
export async function runRivenToolJob({ ctx, build, tool, options: raw, settings: rawSettings, rivens = [], pool, signal = null, onProgress = () => {}, now = Date.now }) {
  if (!RIVEN_TOOLS.includes(tool)) throw new Error(`Unknown riven tool: ${tool}`);
  const started = now();
  const options = normalizeRivenToolOptions(raw);
  const base = normalizeAutoBuildSettings(rawSettings, ctx.data);
  // Slot My Riven and the compare score plain average DPS (the site gives them no optimisation choices).
  const plain = tool === 'slot' || tool === 'compare';
  const settings = rivenToolSettings(base, tool === 'compare' ? { ...options, simulationTimeSeconds: 5 } : options, { plain });
  const { env, score, readout, stats } = poolScorer({ ctx, build, settings, pool });
  const args = { build, options, score, signal, onProgress };
  const result = tool === 'slot' ? await slotMyRiven(env, { ...args, rivens })
    : tool === 'auto' ? await autoRiven(env, args)
      : tool === 'rolls' ? await rollsData(env, args)
        : await compareRivens(env, { ...args, rivens });
  const { failed, succeeded, firstError } = stats();
  if (!succeeded && failed) throw new Error(`The engine rejected every candidate: ${firstError ?? 'no reason given'}`);
  // The proposals at the build's own settings: what the Readout will show once one is applied.
  const proposals = proposalsOf(tool, result);
  let readoutDps = null;
  if (proposals.length) {
    onProgress({ percent: 100, step: 'Comparing with the current build', detail: '', runs: result.runs });
    const values = await readout([build.mods, ...proposals.map(p => p.mods)]);
    readoutDps = { before: values[0], proposals: Object.fromEntries(proposals.map((p, i) => [p.key, values[i + 1]])) };
  }
  return { tool, ...result, readout: readoutDps, options, failedRuns: stats().failed, firstError: stats().firstError, ms: now() - started };
}

/** The builds a result proposes, by key: 'best' and 'same' (Slot My Riven), 'auto', 'left-best' ... (compare). */
export function proposalsOf(tool, r) {
  const out = [];
  const add = (key, p) => { if (p?.mods && !out.some(o => o.mods === p.mods)) out.push({ key, mods: p.mods }); };
  if (tool === 'slot') { add('best', r.best); add('same', r.bestSameElements); }
  if (tool === 'auto' && r.improved) add('auto', r);
  if (tool === 'compare') r.sides.forEach((s, i) => { add(`${i}-best`, s.best); add(`${i}-same`, s.bestSameElements); });
  return out;
}
