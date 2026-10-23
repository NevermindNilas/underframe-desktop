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
