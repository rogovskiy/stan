import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import { parseAssumptionRangeToPctInterval } from '@/app/lib/positionThesisAssumptionRange';

/**
 * Naive forward nominal total return from base-case thesis assumptions:
 * annual growth % (EPS/FCF/revenue, as entered in builder) plus dividend yield % (income only).
 * Missing or unparseable growth or dividend yield is treated as 0% (non-payers / blanks).
 * Multiple expansion is intentionally excluded in v1.
 *
 * For independent intervals G = [gMin,gMax], Y = [yMin,yMax]:
 * total return R ≈ G + Y → [gMin+yMin, gMax+yMax].
 */
const ZERO_INTERVAL = { min: 0, max: 0 } as const;

export function getImpliedReturnIntervalFromPayload(
  payload: PositionThesisPayload | null | undefined
): { min: number; max: number } | null {
  if (!payload) return null;
  const growthParsed = parseAssumptionRangeToPctInterval(payload.baseGrowthAssumption ?? '');
  const growth = growthParsed ?? ZERO_INTERVAL;
  const yieldParsed = parseAssumptionRangeToPctInterval(payload.baseDividendAssumption ?? '');
  const yieldPct = yieldParsed ?? ZERO_INTERVAL;
  return {
    min: growth.min + yieldPct.min,
    max: growth.max + yieldPct.max,
  };
}

export function getImpliedReturnMidpointFromPayload(
  payload: PositionThesisPayload | null | undefined
): number | null {
  const r = getImpliedReturnIntervalFromPayload(payload);
  if (!r) return null;
  return (r.min + r.max) / 2;
}
