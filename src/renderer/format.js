// Number formatting for the UI. Pure, no DOM.

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function fmtInt(n) {
  return Number.isFinite(n) ? intFmt.format(n) : '—';
}

export function fmtNum(n, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
}

/** Short form for large numbers: 1.2k, 3.45M. */
export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${fmtNum(n / 1e9, 2)}B`;
  if (abs >= 1e6) return `${fmtNum(n / 1e6, 2)}M`;
  if (abs >= 1e4) return `${fmtNum(n / 1e3, 1)}k`;
  return fmtInt(n);
}

/** Axis tick labels: one style for every tick ("0", "500", "6.3k", "12.5k", "1.5M"). */
export function fmtAxis(n) {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${fmtNum(n / 1e9, 1)}B`;
  if (abs >= 1e6) return `${fmtNum(n / 1e6, 1)}M`;
  if (abs >= 1e3) return `${fmtNum(n / 1e3, 1)}k`;
  return fmtNum(n, 1);
}

/** A fraction as a signed percentage: 0.3 -> "+30%". */
export function fmtSignedPct(fraction, digits = 1) {
  if (!Number.isFinite(fraction)) return '—';
  const v = fraction * 100;
  const s = fmtNum(Math.abs(v), digits);
  if (s === '0') return '0%';
  return `${v > 0 ? '+' : '−'}${s}%`;
}

/** A value already in percent: 26 -> "26%". */
export function fmtPct(percent, digits = 1) {
  return Number.isFinite(percent) ? `${fmtNum(percent, digits)}%` : '—';
}

export function fmtSeconds(s, digits = 2) {
  return Number.isFinite(s) ? `${fmtNum(s, digits)} s` : '—';
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "just now", "5 min ago", "2 h ago", "3 d ago", else a short date. `now` is injectable for tests. */
export function fmtRelative(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Oct 24, 2026" */
export function fmtShortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
