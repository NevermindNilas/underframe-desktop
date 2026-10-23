// Chart geometry: data -> SVG path strings. Pure.

/** Keep at most about `max` evenly spaced points, always including the first and the last. */
export function downsample(points, max = 600) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Step-line path ("hold value until the next sample") for one series.
 * @param {Array<object>} points  sorted by t
 * @param {string} key            value field
 * @param {{ width, height, maxX, maxY, pad? }} box
 */
export function stepPath(points, key, { width, height, maxX, maxY }) {
  if (!points.length || maxX <= 0 || maxY <= 0) return '';
  const x = t => +(t / maxX * width).toFixed(2);
  const y = v => +(height - v / maxY * height).toFixed(2);
  let d = `M${x(points[0].t)},${y(points[0][key])}`;
  let prevY = y(points[0][key]);
  for (let i = 1; i < points.length; i++) {
    const px = x(points[i].t);
    const py = y(points[i][key]);
    if (py === prevY) continue;
    d += `H${px}V${py}`;
    prevY = py;
  }
  return d + `H${width}`;
}

/** Whether a series ever holds a non-zero value. */
export const hasValues = (points, key) => points.some(p => p[key] > 0);

/** Round axis maximum up to a "nice" number. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}
