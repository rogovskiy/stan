import type { DriverRow, FailureRow, PositionThesisPayload } from '@/app/lib/types/positionThesis';

/** String keys merged by sanitizeFormPatch / mergePositionThesisPayload (excludes ticker). */
export const POSITION_THESIS_MERGE_STRING_KEYS: (keyof PositionThesisPayload)[] = [
  'positionRole',
  'holdingHorizon',
  'thesisStatement',
  'portfolioRole',
  'regimeDesignedFor',
  'entryPrice',
  'upsideDividendAssumption',
  'upsideGrowthAssumption',
  'upsideMultipleAssumption',
  'baseDividendAssumption',
  'baseGrowthAssumption',
  'baseMultipleBasis',
  'baseMultipleAssumption',
  'downsideDividendAssumption',
  'downsideGrowthAssumption',
  'downsideMultipleAssumption',
  'upsideScenario',
  'baseScenario',
  'downsideScenario',
  'distanceToFailure',
  'currentVolRegime',
  'riskPosture',
  'trimRule',
  'exitRule',
  'addRule',
  'systemMonitoringSignals',
];

/** Coerce API/Firestore driver objects to the current shape (drops legacy fields). */
export function normalizeDriverRow(x: unknown): DriverRow | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (
    typeof o.driver !== 'string' ||
    typeof o.whyItMatters !== 'string' ||
    typeof o.importance !== 'string'
  ) {
    return null;
  }
  return { driver: o.driver, whyItMatters: o.whyItMatters, importance: o.importance };
}

export function isFailureRow(x: unknown): x is FailureRow {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.failurePath === 'string' &&
    typeof o.trigger === 'string' &&
    typeof o.estimatedImpact === 'string' &&
    typeof o.timeframe === 'string'
  );
}

/** Server/client: coerce unknown JSON into a safe partial payload. */
export function sanitizeFormPatch(
  raw: unknown,
  options?: { tickerLocked?: boolean }
): Partial<PositionThesisPayload> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Partial<PositionThesisPayload> = {};
  const tickerLocked = options?.tickerLocked === true;

  for (const key of POSITION_THESIS_MERGE_STRING_KEYS) {
    const v = src[key as string];
    if (typeof v === 'string') {
      (out as Record<string, string>)[key as string] = v;
    }
  }

  if (!tickerLocked && typeof src.ticker === 'string') {
    const t = src.ticker.trim().toUpperCase();
    if (t) out.ticker = t;
  }

  if (Array.isArray(src.drivers)) {
    const rows = src.drivers
      .map(normalizeDriverRow)
      .filter((r): r is DriverRow => r !== null);
    if (rows.length > 0 && rows.length <= 12) out.drivers = rows;
  }
  if (Array.isArray(src.failures)) {
    const rows = src.failures.filter(isFailureRow);
    if (rows.length > 0 && rows.length <= 12) out.failures = rows;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function mergePositionThesisPayload(
  current: PositionThesisPayload,
  patch: Partial<PositionThesisPayload> | null | undefined,
  options?: { tickerLocked?: boolean }
): PositionThesisPayload {
  if (!patch || Object.keys(patch).length === 0) return current;

  const tickerLocked = options?.tickerLocked === true;
  const next: PositionThesisPayload = { ...current };

  if (!tickerLocked && patch.ticker != null && typeof patch.ticker === 'string') {
    const t = patch.ticker.trim().toUpperCase();
    if (t) next.ticker = t;
  }

  for (const key of POSITION_THESIS_MERGE_STRING_KEYS) {
    const v = patch[key];
    if (typeof v === 'string') {
      (next as unknown as Record<string, string>)[key as string] = v;
    }
  }

  if (Array.isArray(patch.drivers) && patch.drivers.length > 0) {
    const rows = patch.drivers
      .map(normalizeDriverRow)
      .filter((r): r is DriverRow => r !== null);
    if (rows.length > 0) next.drivers = rows;
  }
  if (Array.isArray(patch.failures) && patch.failures.length > 0) {
    const rows = patch.failures.filter(isFailureRow);
    if (rows.length > 0) next.failures = rows;
  }

  return next;
}
