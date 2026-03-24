/** Remove % signs so numeric regexes match values like "3.5%–6%". */
export function stripAssumptionPercentSigns(stored: string): string {
  return stored.replace(/%/g, '').trim();
}

/**
 * Parse a stored dividend / growth assumption string into numeric [min, max] (inclusive).
 * Returns null if empty or unparseable. Uses `parseAssumptionRange` after stripping `%`.
 */
export function parseAssumptionRangeToPctInterval(stored: string): { min: number; max: number } | null {
  const t = stripAssumptionPercentSigns(stored);
  if (!t) return null;
  const { low, high } = parseAssumptionRange(t);
  if (!low.trim() || !high.trim()) return null;
  const min = parseFloat(low);
  const max = parseFloat(high);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) {
    return { min: max, max: min };
  }
  return { min, max };
}

/** Parse stored assumption into low / high for inputs (legacy single number or "3.5%"). */
export function parseAssumptionRange(stored: string): { low: string; high: string } {
  const t = stored.trim();
  if (!t) return { low: '', high: '' };
  const rangeMatch = t.match(/^(-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (rangeMatch) {
    return { low: rangeMatch[1], high: rangeMatch[2] };
  }
  const toMatch = t.match(/^(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*$/i);
  if (toMatch) {
    return { low: toMatch[1], high: toMatch[2] };
  }
  const single = t.match(/-?\d+(?:\.\d+)?/);
  if (single) {
    const v = single[0];
    return { low: v, high: v };
  }
  return { low: '', high: '' };
}

/** Persist as "low–high" (en-dash) or a single number when both ends match / one side empty. */
export function formatAssumptionRange(low: string, high: string): string {
  const lt = low.trim();
  const ht = high.trim();
  if (!lt && !ht) return '';
  if (!lt) return ht;
  if (!ht) return lt;
  const ln = parseFloat(lt);
  const hn = parseFloat(ht);
  if (Number.isFinite(ln) && Number.isFinite(hn) && ln > hn) {
    return `${ht}–${lt}`;
  }
  if (lt === ht || (Number.isFinite(ln) && Number.isFinite(hn) && ln === hn)) {
    return lt;
  }
  return `${lt}–${ht}`;
}
