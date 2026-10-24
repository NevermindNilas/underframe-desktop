// How Auto build states a change in DPS: a signed percentage, or "×N" from 3× up (as the stats table's Change column
// does), so a jump from an empty build reads "×166.6" rather than "+16,555%". Pure.
import { fmtNum, fmtSignedPct } from './format.js';

/** "+12.3%", "×4.2", or '' when either number is missing. */
export function gainText(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return '';
  const ratio = after / before;
  return ratio >= 3 ? `×${fmtNum(ratio, 1)}` : fmtSignedPct(ratio - 1);
}
