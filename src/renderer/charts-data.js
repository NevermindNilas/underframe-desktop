// Chart data helpers: sampling, axis ranges, kill time. Pure.

/** Keep at most about `max` evenly spaced points, always including the first and the last. */
export function downsample(points, max = 600) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Whether a series ever holds a non-zero value. */
export const hasValues = (points, key) => points.some(p => p[key] > 0);

/**
 * A value axis from 0 with round, evenly spaced ticks (1, 2, 2.5 or 5 times a power of ten) and at most
 * `maxTicks` intervals: { max, step, count } with max = step * count >= v.
 */
export function niceTicks(v, maxTicks = 5) {
  if (!(v > 0)) return { max: 1, step: 0.25, count: 4 };
  let mag = 10 ** Math.floor(Math.log10(v / maxTicks));
  for (;;) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * mag;
      const count = Math.max(2, Math.ceil(v / step - 1e-9));
      if (count <= maxTicks) return { max: +(step * count).toPrecision(12), step, count };
    }
    mag *= 10;
  }
}

/** Points up to `maxTime` only (the engine can log a hit just past the simulated time). */
export function clipTime(points, maxTime) {
  if (!(maxTime > 0)) return points;
  const out = points.filter(p => p.t <= maxTime);
  return out.length ? out : points.slice(0, 1);
}

/** Round axis maximum up to a "nice" number. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}

/**
 * Step-series values at fixed times (0, step, 2*step, ... up to maxTime): the last sample at or before each time.
 * Used for the chart's table view. `points` are sorted by t.
 */
export function sampleEvery(points, step, maxTime) {
  if (!points.length || !(step > 0)) return [];
  const out = [];
  let i = 0;
  const end = Math.max(0, maxTime);
  const count = Math.floor(end / step + 1e-9);
  for (let n = 0; n <= count; n++) {
    const t = +(n * step).toFixed(6);
    while (i + 1 < points.length && points[i + 1].t <= t + 1e-9) i++;
    out.push({ ...points[i], t });
  }
  return out;
}

/** First time all pools are empty (the kill), or null. */
export function killTime(points) {
  return points.find(p => p.t > 0 && p.hp <= 0 && p.shields <= 0 && p.overguard <= 0)?.t ?? null;
}
