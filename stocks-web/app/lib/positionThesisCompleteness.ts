import { mergePositionThesisPayload } from '@/app/lib/positionThesisMerge';
import { scratchPositionThesisPayload } from '@/app/lib/positionThesisScratch';
import type { DriverRow, FailureRow, PositionThesisPayload } from '@/app/lib/types/positionThesis';
import { parseAssumptionRange } from '@/app/lib/positionThesisAssumptionRange';

export type ThesisSectionCompleteness = 'green' | 'yellow' | 'red';

const REQUIRED_FACT_CHECK_KEYS = [
  'basics',
  'thesis',
  'returns',
  'drivers',
  'failures',
] as const;

export type RequiredFactCheckSectionKey = (typeof REQUIRED_FACT_CHECK_KEYS)[number];

const REQUIRED_SECTION_LABELS: Record<RequiredFactCheckSectionKey, string> = {
  basics: 'Position & horizon',
  thesis: 'Thesis statement',
  returns: 'Return expectation',
  drivers: 'Drivers and dependencies',
  failures: 'Downside and failure map',
};

function fieldFilled(s: string): boolean {
  return s.trim().length > 0;
}

function assumptionFilled(stored: string): boolean {
  const { low, high } = parseAssumptionRange(stored);
  return fieldFilled(low) || fieldFilled(high);
}

function weightedRatio(items: { w: number; ok: boolean }[]): number {
  const tw = items.reduce((s, i) => s + i.w, 0);
  if (tw === 0) return 1;
  return items.reduce((s, i) => s + (i.ok ? i.w : 0), 0) / tw;
}

function ratioToCompleteness(ratio: number, kind: 'required' | 'optional'): ThesisSectionCompleteness {
  if (kind === 'optional') {
    if (ratio >= 0.75) return 'green';
    if (ratio > 0) return 'yellow';
    return 'red';
  }
  if (ratio >= 0.78) return 'green';
  if (ratio >= 0.38) return 'yellow';
  return 'red';
}

function driverRowRatio(row: DriverRow): number {
  return weightedRatio([
    { w: 4, ok: fieldFilled(row.driver) },
    { w: 3, ok: fieldFilled(row.whyItMatters) },
    { w: 2, ok: fieldFilled(row.importance) },
  ]);
}

function failureRowRatio(row: FailureRow): number {
  return weightedRatio([
    { w: 3, ok: fieldFilled(row.failurePath) },
    { w: 3, ok: fieldFilled(row.trigger) },
    { w: 2, ok: fieldFilled(row.estimatedImpact) },
    { w: 2, ok: fieldFilled(row.timeframe) },
  ]);
}

export function computeSectionCompleteness(form: PositionThesisPayload): {
  basics: ThesisSectionCompleteness;
  thesis: ThesisSectionCompleteness;
  returns: ThesisSectionCompleteness;
  drivers: ThesisSectionCompleteness;
  failures: ThesisSectionCompleteness;
  rules: ThesisSectionCompleteness;
} {
  const basicsRatio = weightedRatio([
    { w: 3, ok: fieldFilled(form.ticker) },
    { w: 2, ok: fieldFilled(form.positionRole) },
    { w: 1, ok: fieldFilled(form.holdingHorizon) },
  ]);
  const basics =
    !fieldFilled(form.ticker) ? 'red' : ratioToCompleteness(basicsRatio, 'required');

  const thesisRatio = weightedRatio([
    { w: 4, ok: fieldFilled(form.thesisStatement) },
    { w: 2, ok: fieldFilled(form.portfolioRole) },
    { w: 2, ok: fieldFilled(form.regimeDesignedFor) },
    { w: 1, ok: fieldFilled(form.riskPosture) },
  ]);
  const thesis =
    !fieldFilled(form.thesisStatement) ? 'red' : ratioToCompleteness(thesisRatio, 'required');

  const returnsRatio = weightedRatio([
    { w: 1, ok: fieldFilled(form.entryPrice) },
    { w: 2, ok: assumptionFilled(form.baseDividendAssumption) },
    { w: 2, ok: assumptionFilled(form.baseGrowthAssumption) },
    { w: 2, ok: assumptionFilled(form.baseMultipleAssumption) },
    { w: 1, ok: fieldFilled(form.upsideScenario) },
    { w: 2, ok: fieldFilled(form.baseScenario) },
    { w: 1, ok: fieldFilled(form.downsideScenario) },
  ]);
  const returns = ratioToCompleteness(returnsRatio, 'required');

  let drivers: ThesisSectionCompleteness;
  if (form.drivers.length === 0) {
    drivers = 'red';
  } else {
    const avg =
      form.drivers.reduce((s, d) => s + driverRowRatio(d), 0) / form.drivers.length;
    drivers = ratioToCompleteness(avg, 'required');
  }

  let failures: ThesisSectionCompleteness;
  if (form.failures.length === 0) {
    failures = 'red';
  } else {
    const avg =
      form.failures.reduce((s, r) => s + failureRowRatio(r), 0) / form.failures.length;
    failures = ratioToCompleteness(avg, 'required');
  }

  const rulesRatio = weightedRatio([
    { w: 1, ok: fieldFilled(form.trimRule) },
    { w: 1, ok: fieldFilled(form.exitRule) },
    { w: 1, ok: fieldFilled(form.addRule) },
    { w: 1, ok: fieldFilled(form.systemMonitoringSignals) },
  ]);
  const rules = ratioToCompleteness(rulesRatio, 'optional');

  return { basics, thesis, returns, drivers, failures, rules };
}

export function getBlockedRequiredSections(form: PositionThesisPayload): string[] {
  const c = computeSectionCompleteness(form);
  return REQUIRED_FACT_CHECK_KEYS.filter((k) => c[k] === 'red').map(
    (k) => REQUIRED_SECTION_LABELS[k]
  );
}

export function canRunGroundedThesisFactCheck(form: PositionThesisPayload): boolean {
  return getBlockedRequiredSections(form).length === 0;
}

/** Server: parse client thesis JSON and merge onto scratch template for completeness checks. */
export function parseThesisContextForCompleteness(
  json: string,
  requestTicker: string
): PositionThesisPayload | null {
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const t = requestTicker.trim().toUpperCase() || 'UNKNOWN';
    const base = scratchPositionThesisPayload(t);
    return mergePositionThesisPayload(base, raw as Partial<PositionThesisPayload>, {
      tickerLocked: false,
    });
  } catch {
    return null;
  }
}

export function factCheckGateBlockedMessage(blocked: string[]): string {
  if (blocked.length === 0) return '';
  return `Complete these sections first (at least in progress): ${blocked.join(', ')}.`;
}
