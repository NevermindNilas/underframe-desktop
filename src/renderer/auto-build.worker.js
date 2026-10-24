// The Auto Build worker (a module worker, bundled by Vite): runs the search off the UI thread. It loads the game data
// itself, starts its own pool of engine workers (nested workers running engine.worker.js), runs the search and posts
// progress, then the result. One run per worker: the page starts a fresh one each time and terminates it after.
// The riven tools (riven-tool-job.js) run here too, with `job: 'riven'`.
//   in:  { type: 'start', build, start, settings, cores }
//        { type: 'start', job: 'riven', build, tool, options, rivens, settings, cores }   { type: 'cancel' }
//   out: { type: 'progress', percent, step, detail, runs, elapsedMs }  { type: 'done', result }
//        { type: 'cancelled' }  { type: 'error', message }
import { createEngineClient } from './engine-client.js';
import { createEnginePool, defaultPoolSize } from './auto-build-pool.js';
import { appStateFor, runAutoBuildJob } from './auto-build-job.js';
import { runRivenToolJob } from './riven-tool-job.js';

const ENGINE_WORKER_URL = '/renderer/engine.worker.js';
const PROGRESS_INTERVAL_MS = 120;

const signal = { aborted: false };
let pool = null;
let started = false;

function post(msg) {
  self.postMessage(msg);
}

async function start({ job, build, start: startBuild, settings, cores, tool, options, rivens }) {
  const t0 = Date.now();
  let lastPost = 0;
  let last = null;
  const progress = p => {
    const t = Date.now();
    const changed = !last || last.step !== p.step || last.percent !== p.percent;
    last = p;
    if (!changed && t - lastPost < PROGRESS_INTERVAL_MS) return;
    lastPost = t;
    post({ type: 'progress', percent: p.percent, step: p.step, detail: p.detail ?? '', runs: p.runs ?? 0, elapsedMs: t - t0 });
  };
  try {
    progress({ percent: 0, step: 'Loading game data', detail: '', runs: 0 });
    const res = await fetch('/core/data/data.json');
    if (!res.ok) throw new Error(`Couldn't load the game data (HTTP ${res.status}).`);
    const data = await res.json();
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const { ctx, appState } = appStateFor(data, build);
    const size = Number.isInteger(cores) && cores > 0 ? cores : defaultPoolSize();
    progress({ percent: 0, step: `Starting ${size} ${size === 1 ? 'engine' : 'engines'}`, detail: '', runs: 0 });
    pool = createEnginePool({ size, appState, createClient: opts => createEngineClient(ENGINE_WORKER_URL, opts) });
    await pool.ready;
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const result = job === 'riven'
      ? await runRivenToolJob({ ctx, build, tool, options, settings, rivens, pool, signal, onProgress: progress })
      : await runAutoBuildJob({ ctx, build, start: startBuild, settings, pool, signal, onProgress: progress });
    post({ type: 'done', result: { ...result, cores: size, elapsedMs: Date.now() - t0 } });
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') post({ type: 'cancelled' });
    else post({ type: 'error', message: e?.message ?? String(e) });
  } finally {
    pool?.terminate();
  }
}

self.onmessage = ({ data: msg }) => {
  if (msg?.type === 'cancel') {
    signal.aborted = true;
    // Stop the engines now: the search notices the abort at its next check and reports "cancelled".
    pool?.terminate();
    return;
  }
  if (msg?.type === 'start' && !started) {
    started = true;
    start(msg);
  }
};
