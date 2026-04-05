import { deriveThesisEvaluationResult, thesisStatusDisplay } from '../lib/positionThesisEvaluation';
import { buildPositionThesisSectionAnalysis } from '../lib/positionThesisSectionAnalysis';
import { thesisPayloadToLiveCardPanelProps } from '../lib/thesisPayloadToLiveCardPanel';
import type {
  LoadedPositionThesisEvaluation,
  PositionThesisPayload,
} from '../lib/types/positionThesis';

const payload: PositionThesisPayload = {
  ticker: 'ABC',
  positionRole: '',
  holdingHorizon: '',
  thesisStatement: '',
  portfolioRole: '',
  regimeDesignedFor: '',
  entryPrice: '$100',
  upsideDividendAssumption: '',
  upsideGrowthAssumption: '',
  upsideMultipleAssumption: '',
  baseDividendAssumption: '2–3',
  baseGrowthAssumption: '5–7',
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

function evalDoc(
  overrides: Partial<LoadedPositionThesisEvaluation> = {}
): LoadedPositionThesisEvaluation {
  return {
    id: 'latest',
    thesisDocId: 't1',
    userId: 'u1',
    ticker: 'ABC',
    state: 'ready',
    structuredResult: {
      summary: 'Test summary',
      systemRecommendation: 'The thesis remains on track. Keep monitoring the main evidence points.',
      driverAssessments: [
        {
          driver: 'Demand',
          whyItMatters: 'Revenue driver',
          importance: 'High',
          score: 'working',
          rationale: 'Demand remains solid.',
          evidence: [{ source: 'earnings', detail: 'Management reiterated demand strength.' }],
        },
      ],
      failureAssessments: [
        {
          failurePath: 'Margin collapse',
          trigger: 'Gross margin falls',
          estimatedImpact: '-20%',
          timeframe: '6–12 months',
          score: 'inactive',
          rationale: 'No evidence of margin pressure.',
          evidence: [{ source: 'earnings', detail: 'Margins remained stable.' }],
        },
      ],
      ruleSignals: {
        trimTriggered: false,
        exitTriggered: false,
        addTriggered: false,
        rationale: '',
      },
    },
    derivedResult: undefined,
    promptMetadata: {
      reportPromptId: 'position_thesis_evaluation_report',
      reportPromptVersion: 1,
      reportExecutionId: 'report-exec-1',
      structuringPromptId: 'position_thesis_evaluation_structurize',
      structuringPromptVersion: 1,
      structuringExecutionId: 'struct-exec-1',
      model: 'gemini-test',
      groundingUsed: true,
    },
    ...overrides,
  };
}

describe('deriveThesisEvaluationResult', () => {
  it('derives healthy from strong drivers and low failure pressure', () => {
    const derived = deriveThesisEvaluationResult(evalDoc());
    expect(derived?.status).toBe('healthy');
    expect(derived?.recommendationLabel).toBe('Hold and monitor.');
  });

  it('prioritizes explicit exit rule signals', () => {
    const derived = deriveThesisEvaluationResult(
      evalDoc({
        structuredResult: {
          ...evalDoc().structuredResult!,
          ruleSignals: {
            trimTriggered: false,
            exitTriggered: true,
            addTriggered: false,
            rationale: 'Exit conditions are met.',
          },
        },
      })
    );
    expect(derived?.status).toBe('exit');
    expect(derived?.ruleRegime).toBe('exit');
  });

  it('recognizes possible add when add signal is present and thesis remains healthy', () => {
    const derived = deriveThesisEvaluationResult(
      evalDoc({
        structuredResult: {
          ...evalDoc().structuredResult!,
          ruleSignals: {
            trimTriggered: false,
            exitTriggered: false,
            addTriggered: true,
            rationale: 'Healthy thesis with improved entry point.',
          },
        },
      })
    );
    expect(derived?.status).toBe('possible_add');
  });
});

describe('thesisStatusDisplay', () => {
  it('maps statuses to user-facing labels', () => {
    expect(thesisStatusDisplay('unsure').phaseLabel).toBe('Watch closely.');
    expect(thesisStatusDisplay('trim').statusBadge).toBe('Trim');
  });
});

describe('thesisPayloadToLiveCardPanelProps', () => {
  it('uses evaluation-derived status and recommendation', () => {
    const panel = thesisPayloadToLiveCardPanelProps(payload, evalDoc(), { min: 6, max: 10 });
    expect(panel.phaseLabel).toBe('Hold and monitor.');
    expect(panel.statusBadge).toBe('Healthy');
    expect(panel.recommendation).toBe(
      'The thesis remains on track. Keep monitoring the main evidence points.'
    );
    expect(panel.forwardReturn).toBe('7.0–10.0%');
  });

  it('falls back to blocked reason when no derived result exists', () => {
    const blocked = evalDoc({
      state: 'blocked',
      blockedReason: 'Complete these sections first.',
      structuredResult: undefined,
    });
    const panel = thesisPayloadToLiveCardPanelProps(payload, blocked, null);
    expect(panel.recommendation).toBe('Complete these sections first.');
  });
});

describe('buildPositionThesisSectionAnalysis', () => {
  const mappedPayload: PositionThesisPayload = {
    ...payload,
    drivers: [
      { driver: 'Demand growth', whyItMatters: 'Supports revenue', importance: 'High' },
      { driver: 'Pricing', whyItMatters: 'Supports margins', importance: 'Medium' },
    ],
    failures: [
      {
        failurePath: 'Margin collapse',
        trigger: 'Gross margin falls',
        estimatedImpact: '-20%',
        timeframe: '6–12 months',
      },
      {
        failurePath: 'Demand shock',
        trigger: 'Customer pullback',
        estimatedImpact: '-15%',
        timeframe: '3–6 months',
      },
    ],
  };

  it('maps summary, matched rows, and rule signals from the latest evaluation', () => {
    const analysis = buildPositionThesisSectionAnalysis(
      mappedPayload,
      evalDoc({
        structuredResult: {
          summary: 'Latest thesis summary.',
          systemRecommendation: 'Stay patient but monitor the trim threshold carefully.',
          driverAssessments: [
            {
              driver: ' demand   growth ',
              whyItMatters: 'Supports revenue',
              importance: 'High',
              score: 'working',
              rationale: 'Demand remains solid.',
              evidence: [{ source: 'earnings', detail: 'Orders improved.' }],
            },
            {
              driver: 'Pricing',
              whyItMatters: 'Supports margins',
              importance: 'Medium',
              score: 'mixed',
              rationale: 'Pricing power is moderating.',
              evidence: [{ source: 'filings', detail: 'Mix shifted lower.' }],
            },
          ],
          failureAssessments: [
            {
              failurePath: 'margin collapse',
              trigger: 'Gross margin falls',
              estimatedImpact: '-20%',
              timeframe: '6–12 months',
              score: 'inactive',
              rationale: 'Margins remain stable.',
              evidence: [{ source: 'earnings', detail: 'Gross margin held.' }],
            },
          ],
          ruleSignals: {
            trimTriggered: true,
            exitTriggered: false,
            addTriggered: false,
            rationale: 'Trim threshold has been reached.',
          },
        },
      })
    );

    expect(analysis.summary).toBe('Latest thesis summary.');
    expect(analysis.blockedReason).toBeNull();
    expect(analysis.driverAssessmentsByIndex[0]?.score).toBe('working');
    expect(analysis.driverAssessmentsByIndex[1]?.score).toBe('mixed');
    expect(analysis.failureAssessmentsByIndex[0]?.score).toBe('inactive');
    expect(analysis.failureAssessmentsByIndex[1]).toBeNull();
    expect(analysis.ruleSignals).toEqual({
      trimTriggered: true,
      exitTriggered: false,
      addTriggered: false,
      rationale: 'Trim threshold has been reached.',
    });
  });

  it('falls back to blocked reason when evaluation is blocked', () => {
    const analysis = buildPositionThesisSectionAnalysis(
      mappedPayload,
      evalDoc({
        state: 'blocked',
        blockedReason: 'Complete these sections first.',
        structuredResult: undefined,
      })
    );

    expect(analysis.summary).toBeNull();
    expect(analysis.blockedReason).toBe('Complete these sections first.');
    expect(analysis.driverAssessmentsByIndex).toEqual([null, null]);
    expect(analysis.failureAssessmentsByIndex).toEqual([null, null]);
    expect(analysis.ruleSignals).toBeNull();
  });
});
