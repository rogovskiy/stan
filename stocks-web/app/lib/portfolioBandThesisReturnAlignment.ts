import type { Band } from '@/app/lib/services/portfolioService';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import { getImpliedReturnMidpointFromPayload } from '@/app/lib/thesisImpliedReturnFromPayload';

export type BandThesisReturnKind = 'no_signal' | 'ok' | 'thesis_incomplete' | 'misaligned';

export type BandThesisReturnSignal =
  | { kind: 'no_signal' }
  | {
      kind: 'ok';
      averageMidPct: number;
      bandMin: number;
      bandMax: number;
      linkedThesisCount: number;
    }
  | {
      kind: 'thesis_incomplete';
      bandMin: number;
      bandMax: number;
      incompleteTickers: string[];
      linkedThesisCount: number;
    }
  | {
      kind: 'misaligned';
      averageMidPct: number;
      bandMin: number;
      bandMax: number;
      linkedThesisCount: number;
    };

function bandHasExpectedReturnRange(band: Band | null | undefined): band is Band {
  if (!band) return false;
  const lo = band.expectedReturnMinPct;
  const hi = band.expectedReturnMaxPct;
  return (
    typeof lo === 'number' &&
    Number.isFinite(lo) &&
    typeof hi === 'number' &&
    Number.isFinite(hi) &&
    lo <= hi
  );
}

/**
 * Band-level thesis implied return vs band `expectedReturnMinPct`–`expectedReturnMaxPct`.
 * Positions without `thesisId` are excluded. Equal-weight average of implied-return midpoints
 * across linked theses. `thesis_incomplete` when the thesis document isn’t available
 * (no payload); blank growth/yield assumptions count as 0% in implied return.
 */
export function computeBandThesisReturnSignal(
  band: Band | null | undefined,
  positions: Array<{ ticker: string; thesisId?: string | null }>,
  thesisPayloadByThesisId: Record<string, PositionThesisPayload | null | undefined>
): BandThesisReturnSignal {
  if (!bandHasExpectedReturnRange(band)) {
    return { kind: 'no_signal' };
  }
  const bandMin = band.expectedReturnMinPct!;
  const bandMax = band.expectedReturnMaxPct!;

  const linked = positions.filter((p) => p.thesisId?.trim());
  if (linked.length === 0) {
    return { kind: 'no_signal' };
  }

  const incompleteTickers: string[] = [];
  const mids: number[] = [];

  for (const p of linked) {
    const id = p.thesisId!.trim();
    const payload = thesisPayloadByThesisId[id];
    const mid = getImpliedReturnMidpointFromPayload(payload ?? null);
    if (mid == null) {
      incompleteTickers.push(p.ticker.toUpperCase());
    } else {
      mids.push(mid);
    }
  }

  if (incompleteTickers.length > 0) {
    return {
      kind: 'thesis_incomplete',
      bandMin,
      bandMax,
      incompleteTickers,
      linkedThesisCount: linked.length,
    };
  }

  const sum = mids.reduce((a, b) => a + b, 0);
  const averageMidPct = sum / mids.length;

  if (averageMidPct < bandMin || averageMidPct > bandMax) {
    return {
      kind: 'misaligned',
      averageMidPct,
      bandMin,
      bandMax,
      linkedThesisCount: linked.length,
    };
  }

  return {
    kind: 'ok',
    averageMidPct,
    bandMin,
    bandMax,
    linkedThesisCount: linked.length,
  };
}

export type PositionThesisReturnRowKind = 'none' | 'incomplete';

/** Per-row: only linked theses can show incomplete; band misalignment is band-level only. */
export function computePositionThesisReturnRowIssue(
  band: Band | null | undefined,
  position: { ticker: string; thesisId?: string | null },
  thesisPayload: PositionThesisPayload | null | undefined
): PositionThesisReturnRowKind {
  if (!bandHasExpectedReturnRange(band)) return 'none';
  if (!position.thesisId?.trim()) return 'none';
  const mid = getImpliedReturnMidpointFromPayload(thesisPayload ?? null);
  if (mid == null) return 'incomplete';
  return 'none';
}
