import type { PositionThesisPayload, ReturnPhaseRow } from '@/app/lib/types/positionThesis';
import { parseAssumptionRangeToPctInterval } from '@/app/lib/positionThesisAssumptionRange';

const ZERO_INTERVAL = { min: 0, max: 0 } as const;

// ---------------------------------------------------------------------------
// Phase-level return math
// ---------------------------------------------------------------------------

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Resolve a min/max pair where max defaults to min when null (point estimate).
 */
function resolveRange(
  lo: number | null | undefined,
  hi: number | null | undefined
): { min: number; max: number } {
  const minVal = n(lo);
  const maxVal = hi != null && Number.isFinite(hi) ? hi : minVal;
  return { min: Math.min(minVal, maxVal), max: Math.max(minVal, maxVal) };
}

/**
 * Annualized return contribution from multiple change over a phase duration.
 * `((end / start) ^ (12 / months) - 1) * 100`
 * Returns 0 when either value is null or start <= 0.
 */
function multipleAnnualizedPct(
  start: number | null | undefined,
  end: number | null | undefined,
  durationMonths: number
): number {
  if (start == null || end == null || start <= 0 || durationMonths <= 0) return 0;
  return (Math.pow(end / start, 12 / durationMonths) - 1) * 100;
}

/**
 * Total annualized return interval for a single phase:
 * growth + dividend + multiple-derived %.
 */
export function getPhaseAnnualizedInterval(
  phase: ReturnPhaseRow
): { min: number; max: number } {
  const growth = resolveRange(phase.growthMinPct, phase.growthMaxPct);
  const dividend = resolveRange(phase.dividendMinPct, phase.dividendMaxPct);
  const mult = multipleAnnualizedPct(phase.multipleStart, phase.multipleEnd, phase.durationMonths);
  return {
    min: growth.min + dividend.min + mult,
    max: growth.max + dividend.max + mult,
  };
}

/**
 * Compound phases into a single annualized return interval.
 * Each phase contributes a growth factor over its duration, then the product is
 * re-annualized across the total horizon.
 */
function getImpliedReturnFromPhases(
  phases: ReturnPhaseRow[]
): { min: number; max: number } | null {
  if (phases.length === 0) return null;
  let totalMonths = 0;
  let cumulativeMin = 1;
  let cumulativeMax = 1;
  for (const phase of phases) {
    if (phase.durationMonths <= 0) continue;
    const ann = getPhaseAnnualizedInterval(phase);
    const years = phase.durationMonths / 12;
    cumulativeMin *= Math.pow(1 + ann.min / 100, years);
    cumulativeMax *= Math.pow(1 + ann.max / 100, years);
    totalMonths += phase.durationMonths;
  }
  if (totalMonths <= 0) return null;
  const totalYears = totalMonths / 12;
  return {
    min: (Math.pow(cumulativeMin, 1 / totalYears) - 1) * 100,
    max: (Math.pow(cumulativeMax, 1 / totalYears) - 1) * 100,
  };
}

// ---------------------------------------------------------------------------
// Flat (legacy) base-case return: growth + dividend
// ---------------------------------------------------------------------------

function getFlatImpliedReturn(
  payload: PositionThesisPayload
): { min: number; max: number } {
  const growth = parseAssumptionRangeToPctInterval(payload.baseGrowthAssumption ?? '') ?? ZERO_INTERVAL;
  const yieldPct = parseAssumptionRangeToPctInterval(payload.baseDividendAssumption ?? '') ?? ZERO_INTERVAL;
  return {
    min: growth.min + yieldPct.min,
    max: growth.max + yieldPct.max,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Implied forward return interval. Prefers phase-weighted calculation when
 * `returnPhases` is non-empty; falls back to flat growth + dividend.
 */
export function getImpliedReturnIntervalFromPayload(
  payload: PositionThesisPayload | null | undefined
): { min: number; max: number } | null {
  if (!payload) return null;
  const phases = payload.returnPhases;
  if (Array.isArray(phases) && phases.length > 0) {
    const phased = getImpliedReturnFromPhases(phases);
    if (phased) return phased;
  }
  return getFlatImpliedReturn(payload);
}

/**
 * Phase-weighted return from just the phases array (for inline display in builder).
 * Returns null when phases are empty or invalid.
 */
export function getImpliedReturnFromPhasesForDisplay(
  phases: ReturnPhaseRow[] | undefined
): { min: number; max: number } | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  return getImpliedReturnFromPhases(phases);
}

// ---------------------------------------------------------------------------
// Phase-weighted component decomposition
// ---------------------------------------------------------------------------

export interface WeightedComponents {
  growth: { min: number; max: number };
  dividend: { min: number; max: number };
  /** Terminal multiple from the last phase with multiples, null when no phase has multiples. */
  multiple: { min: number; max: number } | null;
}

/**
 * Compute duration-weighted component averages across all phases.
 * Growth and dividend are compounded then re-annualized.
 * Multiple uses the last phase that specifies one (terminal/steady-state target).
 */
export function getPhaseWeightedComponents(
  phases: ReturnPhaseRow[]
): WeightedComponents | null {
  if (phases.length === 0) return null;
  let totalMonths = 0;
  let gCumMin = 1, gCumMax = 1;
  let dCumMin = 1, dCumMax = 1;
  let lastMultiple: { min: number; max: number } | null = null;

  for (const phase of phases) {
    if (phase.durationMonths <= 0) continue;
    const years = phase.durationMonths / 12;

    const g = resolveRange(phase.growthMinPct, phase.growthMaxPct);
    gCumMin *= Math.pow(1 + g.min / 100, years);
    gCumMax *= Math.pow(1 + g.max / 100, years);

    const d = resolveRange(phase.dividendMinPct, phase.dividendMaxPct);
    dCumMin *= Math.pow(1 + d.min / 100, years);
    dCumMax *= Math.pow(1 + d.max / 100, years);

    if (phase.multipleStart != null && phase.multipleEnd != null) {
      lastMultiple = {
        min: Math.min(n(phase.multipleStart), n(phase.multipleEnd)),
        max: Math.max(n(phase.multipleStart), n(phase.multipleEnd)),
      };
    }

    totalMonths += phase.durationMonths;
  }

  if (totalMonths <= 0) return null;
  const totalYears = totalMonths / 12;

  return {
    growth: {
      min: (Math.pow(gCumMin, 1 / totalYears) - 1) * 100,
      max: (Math.pow(gCumMax, 1 / totalYears) - 1) * 100,
    },
    dividend: {
      min: (Math.pow(dCumMin, 1 / totalYears) - 1) * 100,
      max: (Math.pow(dCumMax, 1 / totalYears) - 1) * 100,
    },
    multiple: lastMultiple,
  };
}

// ---------------------------------------------------------------------------
// Drift detection (component-level, all phases vs base case)
// ---------------------------------------------------------------------------

export interface ComponentDrift {
  label: string;
  phases: string;
  baseCase: string;
}

export interface PhaseBaseCaseDrift {
  components: ComponentDrift[];
}

function fmtInterval(lo: number, hi: number, unit: string): string {
  const f = (v: number) => Number.isInteger(v) ? v.toString() : v.toFixed(1);
  if (Math.abs(lo - hi) < 0.05) return `${f(lo)}${unit}`;
  return `${f(lo)}–${f(hi)}${unit}`;
}

/**
 * Compare duration-weighted component averages (across ALL phases) against the
 * base-case assumption fields. Returns null when phases are empty or all
 * components are within tolerance.
 */
export function getPhaseBaseCaseDrift(
  payload: PositionThesisPayload
): PhaseBaseCaseDrift | null {
  const wc = getPhaseWeightedComponents(payload.returnPhases);
  if (!wc) return null;

  const components: ComponentDrift[] = [];

  const baseGrowth = parseAssumptionRangeToPctInterval(payload.baseGrowthAssumption ?? '');
  const hasPhaseGrowth = wc.growth.min !== 0 || wc.growth.max !== 0;
  if (baseGrowth) {
    const drift = Math.abs((wc.growth.min + wc.growth.max) / 2 - (baseGrowth.min + baseGrowth.max) / 2);
    if (drift > 1) {
      components.push({
        label: 'Growth',
        phases: hasPhaseGrowth ? fmtInterval(wc.growth.min, wc.growth.max, '%') : '—',
        baseCase: fmtInterval(baseGrowth.min, baseGrowth.max, '%'),
      });
    }
  } else if (hasPhaseGrowth) {
    components.push({
      label: 'Growth',
      phases: fmtInterval(wc.growth.min, wc.growth.max, '%'),
      baseCase: '—',
    });
  }

  const baseDividend = parseAssumptionRangeToPctInterval(payload.baseDividendAssumption ?? '');
  const hasPhaseDividend = wc.dividend.min !== 0 || wc.dividend.max !== 0;
  if (baseDividend) {
    const drift = Math.abs((wc.dividend.min + wc.dividend.max) / 2 - (baseDividend.min + baseDividend.max) / 2);
    if (drift > 1) {
      components.push({
        label: 'Dividend',
        phases: hasPhaseDividend ? fmtInterval(wc.dividend.min, wc.dividend.max, '%') : '—',
        baseCase: fmtInterval(baseDividend.min, baseDividend.max, '%'),
      });
    }
  } else if (hasPhaseDividend) {
    components.push({
      label: 'Dividend',
      phases: fmtInterval(wc.dividend.min, wc.dividend.max, '%'),
      baseCase: '—',
    });
  }

  const baseMultiple = parseAssumptionRangeToPctInterval(payload.baseMultipleAssumption ?? '');
  if (baseMultiple && wc.multiple) {
    const drift = Math.abs((wc.multiple.min + wc.multiple.max) / 2 - (baseMultiple.min + baseMultiple.max) / 2);
    if (drift > 1) {
      components.push({
        label: 'Multiple',
        phases: fmtInterval(wc.multiple.min, wc.multiple.max, '×'),
        baseCase: fmtInterval(baseMultiple.min, baseMultiple.max, '×'),
      });
    }
  } else if (baseMultiple && !wc.multiple) {
    components.push({
      label: 'Multiple',
      phases: '—',
      baseCase: fmtInterval(baseMultiple.min, baseMultiple.max, '×'),
    });
  } else if (!baseMultiple && wc.multiple) {
    components.push({
      label: 'Multiple',
      phases: fmtInterval(wc.multiple.min, wc.multiple.max, '×'),
      baseCase: '—',
    });
  }

  if (components.length === 0) return null;
  return { components };
}

export function getImpliedReturnMidpointFromPayload(
  payload: PositionThesisPayload | null | undefined
): number | null {
  const r = getImpliedReturnIntervalFromPayload(payload);
  if (!r) return null;
  return (r.min + r.max) / 2;
}
