// Center column: simulation controls, headline numbers and charts.
import { h, svg, render } from './dom.js';
import { DURATIONS, SIM_SEEDS, ttkText, healthSeries, damageShare } from '../model.js';
import { stepPath, downsample, hasValues, niceMax } from '../charts-data.js';
import { fmtInt, fmtCompact, fmtNum } from '../format.js';

const W = 560;
const H = 180;

const DT_PREFIX = /^(Impact|Puncture|Slash|Heat|Cold|Electricity|Toxin|Blast|Corrosive|Gas|Magnetic|Radiation|Viral|Void|True)\b/;

/** Bar width, coloured by damage type for status ticks ("Toxin Tick"); direct hits keep the accent colour. */
function shareFillStyle(row) {
  const dt = DT_PREFIX.exec(row.type)?.[1];
  return { width: `${row.share * 100}%`, ...(dt ? { background: `var(--dt-${dt.toLowerCase()})` } : {}) };
}

function healthChart(debug, enemy, maxTime) {
  const series = healthSeries(debug.debugLog, enemy);
  const points = downsample(series.points);
  const maxY = niceMax(series.maxValue);
  const maxX = Math.max(series.maxTime, 0.001);
  const box = { width: W, height: H, maxX, maxY };
  const lines = [['overguard', 'Overguard'], ['shields', 'Shields'], ['hp', 'Health']].filter(([k]) => hasValues(points, k));
  const killedAt = points.find(p => p.t > 0 && p.hp <= 0 && p.shields <= 0 && p.overguard <= 0)?.t;
  const grid = [0.25, 0.5, 0.75, 1].map(f => svg('line', { class: 'grid', x1: 0, x2: W, y1: H - f * H, y2: H - f * H }));
  const desc = `Enemy pools over ${fmtNum(maxX, 1)} seconds: ${lines.map(([k, l]) => `${l} from ${fmtInt(enemy[k])}`).join(', ')}${killedAt != null ? `; killed at ${fmtNum(killedAt, 2)} s` : '; not killed'}.`;
  return h('figure', { class: 'chart' },
    h('figcaption', { class: 'chart-title' }, 'Enemy health over time',
      h('span', { class: 'legend' }, lines.map(([k, l]) => h('span', { class: `legend-item series-${k}` }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), l)))),
    h('div', { class: 'chart-frame' },
      h('span', { class: 'axis-y' }, fmtCompact(maxY)),
      svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': desc, class: 'chart-svg' },
        ...grid,
        ...lines.map(([k]) => svg('path', { class: `line series-${k}`, d: stepPath(points, k, box), 'vector-effect': 'non-scaling-stroke' })))),
    h('div', { class: 'axis-x' }, h('span', null, '0 s'),
      killedAt != null ? h('span', { class: 'kill-mark' }, `killed at ${fmtNum(killedAt, 2)} s`) : h('span', null, `survived ${maxTime} s`),
      h('span', null, `${fmtNum(maxX, 1)} s`)));
}

function shareChart(debug) {
  const rows = damageShare(debug.debugLog);
  return h('figure', { class: 'chart' },
    h('figcaption', { class: 'chart-title' }, 'Damage by hit type'),
    rows.length ? h('ul', { class: 'share-list' }, rows.map(r => h('li', { class: 'share-row' },
      h('span', { class: 'share-label' }, r.type),
      h('span', { class: 'share-track', 'aria-hidden': 'true' }, h('span', { class: 'share-fill', style: shareFillStyle(r) })),
      h('span', { class: 'share-value' }, `${fmtNum(r.share * 100, 1)}%`, h('span', { class: 'muted' }, ` · ${fmtCompact(r.damage)}`)))))
      : h('p', { class: 'empty' }, 'No hits recorded.'));
}

export function mountResults(root, app) {
  const { actions } = app;
  const duration = h('select', { class: 'input compact', 'aria-label': 'Simulated time' }, DURATIONS.map(d => h('option', { value: d }, `${d} s`)));
  duration.addEventListener('change', () => actions.setDuration(Number(duration.value)));
  const runBtn = h('button', { class: 'btn', type: 'button', title: 'Run again (Ctrl+Enter)', onClick: () => actions.runNow() }, 'Run');
  const pinBtn = h('button', { class: 'btn', type: 'button', title: 'Add this result to the compare tray', onClick: () => actions.pinResult() }, 'Pin result');
  const status = h('span', { class: 'sim-status', role: 'status', 'aria-live': 'polite' });
  const hero = h('div', { class: 'hero' });
  const charts = h('div', { class: 'charts' });

  render(root,
    h('div', { class: 'section-head' },
      h('h2', { class: 'section-title' }, 'Simulation'),
      h('div', { class: 'toolbar' }, status, h('label', { class: 'inline-field' }, h('span', { class: 'muted small' }, 'Duration'), duration), runBtn, pinBtn)),
    hero, charts);

  function renderHero(state) {
    const { sim } = state;
    const s = sim.summary;
    const current = sim.key === app.simKey();
    root.classList.toggle('stale', Boolean(s) && (!current || sim.status === 'pending' || sim.status === 'running'));
    pinBtn.disabled = !(s?.ok && current && sim.status !== 'error');
    status.textContent = sim.status === 'pending' || sim.status === 'running' ? 'Simulating…'
      : sim.status === 'error' ? 'Simulation failed' : s?.ok ? `${s.runs} runs · ${state.build.simTime} s each` : '';
    status.classList.toggle('busy', sim.status === 'pending' || sim.status === 'running');

    if (sim.status === 'error' && current) {
      render(hero, h('div', { class: 'error-box', role: 'alert' },
        h('strong', null, 'The engine could not simulate this build.'),
        h('p', null, sim.error),
        h('button', { class: 'btn', type: 'button', onClick: () => actions.runNow() }, 'Try again')));
      return;
    }
    if (!s?.ok) {
      render(hero, h('div', { class: 'hero-empty' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Running the first simulation…'));
      return;
    }
    render(hero,
      h('div', { class: 'hero-main' },
        h('span', { class: 'hero-label' }, 'Average DPS'),
        h('span', { class: 'hero-value', 'data-testid': 'avg-dps' }, fmtInt(s.avgDps)),
        h('span', { class: 'hero-spread', title: `Lowest and highest of ${s.runs} seeded runs` },
          `${fmtInt(s.minDps)} – ${fmtInt(s.maxDps)} across ${s.runs} runs`)),
      h('dl', { class: 'hero-stats' },
        h('div', null, h('dt', null, 'Time to kill'), h('dd', { 'data-testid': 'ttk' }, ttkText(s))),
        h('div', null, h('dt', null, 'Average hit'), h('dd', null, fmtInt(s.avgHit))),
        h('div', null, h('dt', null, 'First hit'), h('dd', null, fmtInt(s.firstHitDamage)))),
      s.failedRuns ? h('p', { class: 'warn-text' }, `${s.failedRuns} of ${SIM_SEEDS.length} runs failed and were left out.`) : null);
  }

  function renderCharts(state) {
    const { sim } = state;
    if (!sim.debug || !sim.debugEnemy) {
      render(charts, sim.debugError ? h('p', { class: 'warn-text' }, `Charts unavailable: ${sim.debugError}`) : null);
      return;
    }
    render(charts, healthChart(sim.debug, sim.debugEnemy, sim.debugTime), shareChart(sim.debug));
  }

  return (state, prev) => {
    if (state.build.simTime !== prev?.build?.simTime && document.activeElement !== duration) duration.value = String(state.build.simTime);
    if (state.sim !== prev?.sim || state.build !== prev?.build) renderHero(state);
    if (state.sim.debug !== prev?.sim?.debug || state.sim.debugError !== prev?.sim?.debugError) renderCharts(state);
  };
}
