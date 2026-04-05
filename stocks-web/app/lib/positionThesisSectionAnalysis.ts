import type {
  LoadedPositionThesisEvaluation,
  PositionThesisPayload,
  ThesisDriverEvaluation,
  ThesisFailureEvaluation,
} from '@/app/lib/types/positionThesis';

function normalizeKey(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchRowsByKey<T extends { [key: string]: string }>(
  labels: string[],
  assessments: T[],
  assessmentKey: keyof T
): Array<T | null> {
  const assessmentQueues = new Map<string, T[]>();
  for (const assessment of assessments) {
    const normalized = normalizeKey(String(assessment[assessmentKey] ?? ''));
    if (!normalized) continue;
    const existing = assessmentQueues.get(normalized);
    if (existing) {
      existing.push(assessment);
    } else {
      assessmentQueues.set(normalized, [assessment]);
    }
  }

  return labels.map((label) => {
    const normalized = normalizeKey(label);
    if (!normalized) return null;
    const queue = assessmentQueues.get(normalized);
    return queue?.shift() ?? null;
  });
}

export interface PositionThesisSectionAnalysis {
  summary: string | null;
  blockedReason: string | null;
  driverAssessmentsByIndex: Array<ThesisDriverEvaluation | null>;
  failureAssessmentsByIndex: Array<ThesisFailureEvaluation | null>;
  ruleSignals:
    | {
        trimTriggered: boolean;
        exitTriggered: boolean;
        addTriggered: boolean;
        rationale: string;
      }
    | null;
}

export function buildPositionThesisSectionAnalysis(
  payload: Pick<PositionThesisPayload, 'drivers' | 'failures'>,
  evaluation: LoadedPositionThesisEvaluation | null | undefined
): PositionThesisSectionAnalysis {
  const structured = evaluation?.structuredResult;

  if (evaluation?.state === 'blocked') {
    return {
      summary: null,
      blockedReason: evaluation.blockedReason?.trim() || null,
      driverAssessmentsByIndex: payload.drivers.map(() => null),
      failureAssessmentsByIndex: payload.failures.map(() => null),
      ruleSignals: null,
    };
  }

  if (!structured) {
    return {
      summary: null,
      blockedReason: null,
      driverAssessmentsByIndex: payload.drivers.map(() => null),
      failureAssessmentsByIndex: payload.failures.map(() => null),
      ruleSignals: null,
    };
  }

  return {
    summary: structured.summary.trim() || null,
    blockedReason: null,
    driverAssessmentsByIndex: matchRowsByKey(
      payload.drivers.map((row) => row.driver),
      structured.driverAssessments,
      'driver'
    ),
    failureAssessmentsByIndex: matchRowsByKey(
      payload.failures.map((row) => row.failurePath),
      structured.failureAssessments,
      'failurePath'
    ),
    ruleSignals: structured.ruleSignals
      ? {
          trimTriggered: structured.ruleSignals.trimTriggered === true,
          exitTriggered: structured.ruleSignals.exitTriggered === true,
          addTriggered: structured.ruleSignals.addTriggered === true,
          rationale: structured.ruleSignals.rationale?.trim() || '',
        }
      : null,
  };
}
