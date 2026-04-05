import type {
  LoadedPositionThesisEvaluation,
  ThesisDriverEvaluation,
  ThesisEvaluationDerivedResult,
  ThesisEvaluationStatus,
  ThesisFailureEvaluation,
  ThesisRuleRegime,
} from '@/app/lib/types/positionThesis';

const DRIVER_SCORE_VALUE: Record<ThesisDriverEvaluation['score'], number> = {
  working: 1,
  mixed: 0.5,
  failing: 0,
};

const FAILURE_SCORE_VALUE: Record<ThesisFailureEvaluation['score'], number> = {
  inactive: 0,
  emerging: 0.5,
  active: 1,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function deriveRuleRegime(
  ruleSignals: {
    trimTriggered?: boolean;
    exitTriggered?: boolean;
    addTriggered?: boolean;
  } | null | undefined
): ThesisRuleRegime {
  if (!ruleSignals) return 'none';
  if (ruleSignals.exitTriggered) return 'exit';
  if (ruleSignals.trimTriggered) return 'trim';
  if (ruleSignals.addTriggered) return 'add';
  return 'monitor';
}

export function deriveThesisEvaluationResult(
  evaluation: Pick<LoadedPositionThesisEvaluation, 'structuredResult'> | null | undefined
): ThesisEvaluationDerivedResult | undefined {
  const structured = evaluation?.structuredResult;
  if (!structured) return undefined;

  const driverHealthScore = clamp01(
    avg(structured.driverAssessments.map((item) => DRIVER_SCORE_VALUE[item.score]))
  );
  const failurePressureScore = clamp01(
    avg(structured.failureAssessments.map((item) => FAILURE_SCORE_VALUE[item.score]))
  );
  const thesisConfidenceScore = clamp01(driverHealthScore * (1 - failurePressureScore));
  const ruleRegime = deriveRuleRegime(structured.ruleSignals);

  let status: ThesisEvaluationStatus;
  let statusRationale: string;

  if (ruleRegime === 'exit') {
    status = 'exit';
    statusRationale = structured.ruleSignals?.rationale?.trim() || 'Exit rule appears triggered.';
  } else if (ruleRegime === 'trim') {
    status = 'trim';
    statusRationale = structured.ruleSignals?.rationale?.trim() || 'Trim rule appears triggered.';
  } else if (
    ruleRegime === 'add' &&
    driverHealthScore >= 0.7 &&
    failurePressureScore <= 0.35
  ) {
    status = 'possible_add';
    statusRationale =
      structured.ruleSignals?.rationale?.trim() ||
      'Thesis looks healthy and add conditions appear to be met.';
  } else if (driverHealthScore >= 0.75 && failurePressureScore <= 0.3) {
    status = 'healthy';
    statusRationale = 'Core thesis drivers look intact and failure signals remain contained.';
  } else if (driverHealthScore <= 0.35 || failurePressureScore >= 0.7) {
    status = 'problematic';
    statusRationale = 'Multiple drivers are deteriorating or failure signals appear materially active.';
  } else {
    status = 'unsure';
    statusRationale = 'Signals are mixed and the thesis likely needs closer re-underwriting.';
  }

  const recommendationLabel =
    status === 'healthy'
      ? 'Hold and monitor.'
      : status === 'possible_add'
        ? 'Possible add if the pullback does not reflect thesis damage.'
        : status === 'trim'
          ? 'Consider trimming and re-underwriting forward return.'
          : status === 'exit'
            ? 'Consider exiting because the thesis or exit rule appears broken.'
            : status === 'problematic'
              ? 'Reduce risk and re-underwrite the thesis.'
              : 'Watch closely and re-underwrite before adding.';

  return {
    status,
    statusRationale,
    recommendationLabel,
    ruleRegime,
    driverHealthScore,
    failurePressureScore,
    thesisConfidenceScore,
  };
}

export function thesisStatusDisplay(status: ThesisEvaluationStatus | undefined): {
  phaseLabel: string;
  statusBadge: string;
  badgeClassName: string;
} {
  switch (status) {
    case 'healthy':
      return {
        phaseLabel: 'Hold and monitor.',
        statusBadge: 'Healthy',
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      };
    case 'possible_add':
      return {
        phaseLabel: 'Possible add.',
        statusBadge: 'Possible add',
        badgeClassName: 'bg-blue-100 text-blue-700 border-blue-200',
      };
    case 'trim':
      return {
        phaseLabel: 'Consider trimming.',
        statusBadge: 'Trim',
        badgeClassName: 'bg-amber-100 text-amber-800 border-amber-200',
      };
    case 'exit':
      return {
        phaseLabel: 'Consider exiting.',
        statusBadge: 'Exit',
        badgeClassName: 'bg-red-100 text-red-700 border-red-200',
      };
    case 'problematic':
      return {
        phaseLabel: 'Reduce risk.',
        statusBadge: 'Problematic',
        badgeClassName: 'bg-rose-100 text-rose-700 border-rose-200',
      };
    case 'unsure':
      return {
        phaseLabel: 'Watch closely.',
        statusBadge: 'Unsure',
        badgeClassName: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      };
    default:
      return {
        phaseLabel: 'n/a',
        statusBadge: 'n/a',
        badgeClassName: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
}
