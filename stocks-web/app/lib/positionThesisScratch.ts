import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

/** Empty template for onboarding / scratch builds (no sample copy). */
export function scratchPositionThesisPayload(initialTicker = ''): PositionThesisPayload {
  const t = initialTicker.trim().toUpperCase();
  return {
    ticker: t,
    positionRole: '',
    holdingHorizon: '',
    thesisStatement: '',
    portfolioRole: '',
    regimeDesignedFor: '',
    entryPrice: '',
    upsideDividendAssumption: '',
    upsideGrowthAssumption: '',
    upsideMultipleAssumption: '',
    baseDividendAssumption: '',
    baseGrowthAssumption: '',
    baseMultipleBasis: 'P/E',
    baseMultipleAssumption: '',
    downsideDividendAssumption: '',
    downsideGrowthAssumption: '',
    downsideMultipleAssumption: '',
    upsideScenario: '',
    baseScenario: '',
    downsideScenario: '',
    drivers: [],
    failures: [],
    distanceToFailure: '',
    currentVolRegime: '',
    riskPosture: '',
    trimRule: '',
    exitRule: '',
    addRule: '',
    systemMonitoringSignals: '',
  };
}
