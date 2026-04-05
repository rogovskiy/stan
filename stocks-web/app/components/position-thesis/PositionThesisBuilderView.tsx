'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { formatAssumptionRange, parseAssumptionRange } from '@/app/lib/positionThesisAssumptionRange';
import {
  computeSectionCompleteness,
  type ThesisSectionCompleteness,
} from '@/app/lib/positionThesisCompleteness';
import {
  deriveThesisEvaluationResult,
  thesisStatusDisplay,
} from '@/app/lib/positionThesisEvaluation';
import { buildPositionThesisSectionAnalysis } from '@/app/lib/positionThesisSectionAnalysis';
import type {
  AuthoringContextEntry,
  DriverRow,
  FailureRow,
  LoadedPositionThesisEvaluation,
  PositionThesisPayload,
  ThesisDriverEvaluation,
  ThesisEvidenceItem,
  ThesisFailureEvaluation,
} from '@/app/lib/types/positionThesis';

const MAX_TABLE_ROWS = 12;

const EMPTY_DRIVER_ROW: DriverRow = {
  driver: '',
  whyItMatters: '',
  importance: '',
};

const DRIVER_IMPORTANCE_STANDARD = ['High', 'Medium', 'Low'] as const;

const EMPTY_FAILURE_ROW: FailureRow = {
  failurePath: '',
  trigger: '',
  estimatedImpact: '',
  timeframe: '',
};

const FAILURE_TIMEFRAME_STANDARD = [
  'Immediate',
  '< 3 months',
  '3–6 months',
  '6–12 months',
  '6–18 months',
  '1–2 years',
  '2+ years',
  'Gradual',
] as const;
import { useSearchParams } from 'next/navigation';
import type { ChatHistoryEntry, ThesisOnboardPortfolioLink } from '@/app/lib/thesisOnboardHandoff';
import type { PersistedChatMessage } from '@/app/lib/types/chatTranscript';
import { savePositionThesisChatTranscript } from '@/app/lib/services/positionThesisChatClient';
import { mergePositionThesisPayload } from '@/app/lib/positionThesisMerge';
import { scratchPositionThesisPayload } from '@/app/lib/positionThesisScratch';
import {
  defaultPositionThesisPayload,
  newThesisDocumentId,
  savePositionThesisByDocId,
} from '@/app/lib/services/positionThesisService';
import { PROMPT_POSITION_THESIS_EVALUATION_REPORT } from '@/app/lib/promptIds';
import { ExecutionFeedbackWidget } from '@/app/components/ExecutionFeedbackWidget';
import ThesisBuilderChat, { type ThesisBuilderChatHandle } from './ThesisBuilderChat';

const section = 'bg-white rounded-2xl shadow-sm border border-slate-200 p-5';
const label = 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2';
/** Same height for assumption label rows so columns with a dropdown stay aligned with plain labels. */
const assumptionLabelRow = 'mb-2 min-h-[2.75rem]';
const input =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300';
const numberAssumptionInput =
  `${input} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
const multipleBasisSelect =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300';

const VALUATION_MULTIPLE_BASIS = ['P/E', 'P/FCF'] as const;
const textarea =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm min-h-[96px] focus:outline-none focus:ring-2 focus:ring-slate-300';
/** Repeatable row blocks (drivers / failures): wrap text without huge min height per field. */
const cardTextarea =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm min-h-[72px] max-h-48 resize-y focus:outline-none focus:ring-2 focus:ring-slate-300';
const repeatableCard =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100';
const assumptionTierCard =
  'rounded-xl border border-slate-200 bg-slate-50/50 p-4 ring-1 ring-slate-100';
const tierHeading = 'text-sm font-semibold text-slate-800 mb-3';
const badge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border';
const latestAnalysisShell = 'mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3';

function AssumptionRangeFields({
  title,
  hint,
  titleAccessory,
  stored,
  onCommit,
  placeholders,
  formFieldKey,
  registerAssumptionRangeFlush,
}: {
  title: string;
  hint?: string;
  titleAccessory?: ReactNode;
  stored: string;
  onCommit: (value: string) => void;
  placeholders: [string, string];
  formFieldKey: keyof PositionThesisPayload;
  registerAssumptionRangeFlush: (flush: () => Record<string, string>) => () => void;
}) {
  const [draftLow, setDraftLow] = useState(() => parseAssumptionRange(stored).low);
  const [draftHigh, setDraftHigh] = useState(() => parseAssumptionRange(stored).high);
  const pairRef = useRef({ low: draftLow, high: draftHigh });
  pairRef.current.low = draftLow;
  pairRef.current.high = draftHigh;

  useEffect(() => {
    const p = parseAssumptionRange(stored);
    setDraftLow(p.low);
    setDraftHigh(p.high);
  }, [stored]);

  const commit = () => {
    onCommit(formatAssumptionRange(draftLow, draftHigh));
  };

  useEffect(() => {
    return registerAssumptionRangeFlush(() => ({
      [formFieldKey]: formatAssumptionRange(pairRef.current.low, pairRef.current.high),
    }));
  }, [formFieldKey, registerAssumptionRangeFlush]);

  return (
    <div>
      <div className={assumptionLabelRow}>
        {titleAccessory ? (
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <div className={`${label} mb-0 min-w-0 flex-1 leading-snug`}>{title}</div>
            <div className="shrink-0">{titleAccessory}</div>
          </div>
        ) : (
          <div className={`${label} mb-0 leading-snug`}>{title}</div>
        )}
      </div>
      {hint ? <p className="text-xs text-slate-500 mb-2">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`${numberAssumptionInput} min-w-0 flex-1`}
          placeholder={placeholders[0]}
          value={draftLow}
          onChange={(e) => setDraftLow(e.target.value)}
          onBlur={commit}
        />
        <span className="shrink-0 text-sm text-slate-400">–</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`${numberAssumptionInput} min-w-0 flex-1`}
          placeholder={placeholders[1]}
          value={draftHigh}
          onChange={(e) => setDraftHigh(e.target.value)}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

/** Single visible tier: base-case dividend / growth / multiple (upside & downside assumption keys remain on payload for older saves). */
const BASE_RETURN_ASSUMPTION_KEYS = {
  dividendKey: 'baseDividendAssumption' as const satisfies keyof PositionThesisPayload,
  growthKey: 'baseGrowthAssumption' as const satisfies keyof PositionThesisPayload,
  multipleKey: 'baseMultipleAssumption' as const satisfies keyof PositionThesisPayload,
};

const SECTION_HELP = {
  basics:
    'Please help me refine the **ticker**, **position role**, and **holding horizon** for this thesis. Ask clarifying questions and suggest concrete wording I can paste into the form.',
  thesis:
    'Please help me strengthen **section 1 — thesis statement**, **portfolio role**, **regime designed for**, and **risk posture**. Review what I have in the draft and propose improvements or follow-up questions.',
  returns:
    'Please help me with **section 2 — return expectations**: entry price, **base-case ranges** (low–high) for dividend yield (% per year), growth (% per year), valuation multiple (×) with **P/E vs P/FCF**, plus the **upside / base / downside scenario** narratives.',
  drivers:
    'Please help me fill or improve **section 3 — drivers and dependencies**. Suggest drivers, why they matter, and importance (High, Medium, or Low).',
  failures:
    'Please help me with **section 4 — downside and failure map**: failure paths (short labels), triggers, impacts, and timeframes (e.g. 3–6 months, Gradual).',
  rules:
    'Please help me draft **section 5 — decision rules**: **trim**, **exit**, and **add** rules, plus **system monitoring signals**.',
} as const;

function SectionChatHelpButton({
  sectionTitle,
  prompt,
  disabled,
  onRequestHelp,
}: {
  sectionTitle: string;
  prompt: string;
  disabled?: boolean;
  onRequestHelp: (text: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={`Ask the thesis assistant to help with ${sectionTitle}`}
      aria-label={`Get chat help for ${sectionTitle}`}
      onClick={() => onRequestHelp(prompt)}
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/80 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-40"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
    </button>
  );
}

function updateDriver(
  rows: DriverRow[],
  index: number,
  field: keyof DriverRow,
  value: string
): DriverRow[] {
  const next = [...rows];
  next[index] = { ...next[index], [field]: value };
  return next;
}

function isDriverRowEmpty(row: DriverRow): boolean {
  return (
    !row.driver.trim() && !row.whyItMatters.trim() && !(row.importance || '').trim()
  );
}

function isFailureRowEmpty(row: FailureRow): boolean {
  return (
    !row.failurePath.trim() &&
    !row.trigger.trim() &&
    !row.estimatedImpact.trim() &&
    !(row.timeframe || '').trim()
  );
}

function importanceBadgeTone(imp: string): string {
  const u = imp.trim().toLowerCase();
  if (u === 'high') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (u === 'medium') {
    return 'border-sky-200 bg-sky-50 text-sky-900';
  }
  if (u === 'low') {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }
  if (!imp.trim()) {
    return 'border-slate-200 bg-white text-slate-500';
  }
  return 'border-violet-200 bg-violet-50 text-violet-900';
}

const rowIconBtn =
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-30';

const readMoreProseClass =
  'text-sm leading-relaxed text-slate-700 whitespace-pre-wrap';

/** "Read more" only when line-clamp actually hides text (scrollHeight vs clientHeight). */
function ReadMoreClamp({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowWhenCollapsed, setOverflowWhenCollapsed] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    if (!text.trim()) {
      setOverflowWhenCollapsed(false);
      return;
    }
    if (expanded) {
      return;
    }
    const el = textRef.current;
    if (!el) return;

    const measure = () => {
      const n = textRef.current;
      if (!n) return;
      setOverflowWhenCollapsed(n.scrollHeight > n.clientHeight + 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    const t = window.setTimeout(measure, 0);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [text, expanded]);

  if (!text.trim()) return null;

  return (
    <>
      <div
        ref={textRef}
        className={`${readMoreProseClass} ${expanded ? '' : 'line-clamp-4'}`}
      >
        {text}
      </div>
      {overflowWhenCollapsed || expanded ? (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </>
  );
}

function evaluationScoreTone(score: string): string {
  switch (score) {
    case 'working':
    case 'inactive':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'mixed':
    case 'emerging':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'failing':
    case 'active':
      return 'bg-red-50 text-red-800 border-red-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function ruleSignalTone(triggered: boolean): string {
  return triggered
    ? 'bg-amber-50 text-amber-900 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
}

function AssessmentEvidenceList({ evidence }: { evidence: ThesisEvidenceItem[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        Evidence
      </p>
      <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600">
        {evidence.map((item, index) => (
          <li key={`${item.source}-${item.detail}-${index}`}>
            <span className="font-medium text-slate-700">{item.source}:</span> {item.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LatestSectionAnalysis({
  summary,
  blockedReason,
  phaseLabel,
  badgeClassName,
  recommendation,
  feedbackExecutionId,
}: {
  summary?: string | null;
  blockedReason?: string | null;
  phaseLabel?: string;
  badgeClassName?: string;
  recommendation?: string;
  feedbackExecutionId?: string | null;
}) {
  const cleanSummary = summary?.trim() || '';
  const cleanBlockedReason = blockedReason?.trim() || '';
  const cleanRecommendation = recommendation?.trim() || '';
  const cleanFeedbackExecutionId = feedbackExecutionId?.trim() || '';
  const showStatus = Boolean(phaseLabel && badgeClassName);

  if (!cleanSummary && !cleanBlockedReason && !cleanRecommendation) return null;

  if (cleanBlockedReason) {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          Latest analysis
        </div>
        <p className="mt-2 text-sm leading-relaxed text-amber-950">{cleanBlockedReason}</p>
      </div>
    );
  }

  return (
    <div className={latestAnalysisShell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Latest analysis
        </div>
        {showStatus ? <span className={`${badge} ${badgeClassName}`}>{phaseLabel}</span> : null}
      </div>
      {cleanSummary ? (
        <div className="mt-2">
          <ReadMoreClamp text={cleanSummary} />
        </div>
      ) : null}
      {cleanRecommendation ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            System recommendation
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{cleanRecommendation}</p>
        </div>
      ) : null}
      {cleanFeedbackExecutionId ? (
        <ExecutionFeedbackWidget
          provenance={[{ analysis: cleanFeedbackExecutionId }]}
          promptId={PROMPT_POSITION_THESIS_EVALUATION_REPORT}
          className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
        />
      ) : null}
    </div>
  );
}

function DriverAssessmentPanel({
  assessment,
}: {
  assessment: ThesisDriverEvaluation | null;
}) {
  if (!assessment) return null;
  return (
    <div className={latestAnalysisShell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Latest analysis
        </div>
        <span className={`${badge} ${evaluationScoreTone(assessment.score)}`}>
          {assessment.score}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{assessment.rationale}</p>
      <AssessmentEvidenceList evidence={assessment.evidence} />
    </div>
  );
}

function FailureAssessmentPanel({
  assessment,
}: {
  assessment: ThesisFailureEvaluation | null;
}) {
  if (!assessment) return null;
  return (
    <div className={latestAnalysisShell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Latest analysis
        </div>
        <span className={`${badge} ${evaluationScoreTone(assessment.score)}`}>
          {assessment.score}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{assessment.rationale}</p>
      <AssessmentEvidenceList evidence={assessment.evidence} />
    </div>
  );
}

function RuleSignalsAnalysis({
  blockedReason,
  ruleSignals,
}: {
  blockedReason?: string | null;
  ruleSignals?:
    | {
        trimTriggered: boolean;
        exitTriggered: boolean;
        addTriggered: boolean;
        rationale: string;
      }
    | null;
}) {
  if (blockedReason?.trim()) {
    return <LatestSectionAnalysis blockedReason={blockedReason} />;
  }
  if (!ruleSignals) return null;
  return (
    <div className={latestAnalysisShell}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Latest analysis
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`${badge} ${ruleSignalTone(ruleSignals.trimTriggered)}`}>
          Trim: {ruleSignals.trimTriggered ? 'Triggered' : 'Not triggered'}
        </span>
        <span className={`${badge} ${ruleSignalTone(ruleSignals.exitTriggered)}`}>
          Exit: {ruleSignals.exitTriggered ? 'Triggered' : 'Not triggered'}
        </span>
        <span className={`${badge} ${ruleSignalTone(ruleSignals.addTriggered)}`}>
          Add: {ruleSignals.addTriggered ? 'Triggered' : 'Not triggered'}
        </span>
      </div>
      {ruleSignals.rationale ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-700">{ruleSignals.rationale}</p>
      ) : null}
    </div>
  );
}

function ThesisDriverCard({
  row,
  index,
  editing,
  assessment,
  onEdit,
  onDoneEditing,
  onRemove,
  onChange,
}: {
  row: DriverRow;
  index: number;
  editing: boolean;
  assessment: ThesisDriverEvaluation | null;
  onEdit: () => void;
  onDoneEditing: () => void;
  onRemove: () => void;
  onChange: (field: keyof DriverRow, value: string) => void;
}) {
  const empty = isDriverRowEmpty(row);
  const showForm = empty || editing;

  const why = row.whyItMatters.trim();
  const title = row.driver.trim() || 'Untitled driver';

  return (
    <div
      className={`${repeatableCard} ${
        showForm
          ? 'w-full basis-full'
          : 'h-full min-w-[min(100%,17rem)] max-w-md flex-1'
      }`}
    >
      <div
        className={`mb-3 flex items-start gap-2 ${showForm ? 'justify-between' : 'justify-end'}`}
      >
        {showForm ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Driver {index + 1}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {showForm ? (
            <button
              type="button"
              className={rowIconBtn}
              title="Finish editing"
              aria-label={`Finish editing driver ${index + 1}`}
              onClick={onDoneEditing}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={rowIconBtn}
              title="Edit driver"
              aria-label={`Edit driver ${index + 1}`}
              onClick={onEdit}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            className={rowRemoveBtn}
            title="Remove driver"
            aria-label={`Remove driver ${index + 1}`}
            onClick={onRemove}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className={label}>Driver</div>
            <input
              className={input}
              value={row.driver}
              onChange={(e) => onChange('driver', e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <div className={label}>Why it matters</div>
            <textarea
              className={cardTextarea}
              value={row.whyItMatters}
              onChange={(e) => onChange('whyItMatters', e.target.value)}
            />
          </div>
          <div className="md:max-w-xs">
            <div className={label}>Importance</div>
            <select
              className={input}
              value={row.importance}
              onChange={(e) => onChange('importance', e.target.value)}
            >
              <option value="">—</option>
              {row.importance &&
              !(DRIVER_IMPORTANCE_STANDARD as readonly string[]).includes(row.importance) ? (
                <option value={row.importance}>
                  {row.importance} (custom)
                </option>
              ) : null}
              {DRIVER_IMPORTANCE_STANDARD.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold leading-snug text-slate-900 pr-2">{title}</h3>
            {row.importance.trim() ? (
              <span
                className={`${badge} shrink-0 ${importanceBadgeTone(row.importance)}`}
              >
                {row.importance}
              </span>
            ) : (
              <span className={`${badge} shrink-0 ${importanceBadgeTone('')}`}>Importance —</span>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Why it matters
            </p>
            {why ? (
              <ReadMoreClamp text={row.whyItMatters} />
            ) : (
              <p className="text-sm text-slate-500 italic">No notes yet.</p>
            )}
          </div>
        </div>
      )}
      <DriverAssessmentPanel assessment={assessment} />
    </div>
  );
}

function timeframeBadgeTone(tf: string): string {
  const u = tf.trim().toLowerCase();
  if (u === 'immediate') {
    return 'border-red-200 bg-red-50 text-red-900';
  }
  if (u === 'gradual') {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }
  if (u.includes('month') || u.includes('year')) {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (!tf.trim()) {
    return 'border-slate-200 bg-white text-slate-500';
  }
  return 'border-violet-200 bg-violet-50 text-violet-900';
}

function ThesisFailureCard({
  row,
  index,
  editing,
  assessment,
  onEdit,
  onDoneEditing,
  onRemove,
  onChange,
}: {
  row: FailureRow;
  index: number;
  editing: boolean;
  assessment: ThesisFailureEvaluation | null;
  onEdit: () => void;
  onDoneEditing: () => void;
  onRemove: () => void;
  onChange: (field: keyof FailureRow, value: string) => void;
}) {
  const empty = isFailureRowEmpty(row);
  const showForm = empty || editing;

  const trigger = row.trigger.trim();
  const impact = row.estimatedImpact.trim();
  const title = row.failurePath.trim() || 'Untitled failure path';

  return (
    <div
      className={`${repeatableCard} ${
        showForm
          ? 'w-full basis-full'
          : 'h-full min-w-[min(100%,17rem)] max-w-md flex-1'
      }`}
    >
      <div
        className={`mb-3 flex items-start gap-2 ${showForm ? 'justify-between' : 'justify-end'}`}
      >
        {showForm ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Failure path {index + 1}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {showForm ? (
            <button
              type="button"
              className={rowIconBtn}
              title="Finish editing"
              aria-label={`Finish editing failure path ${index + 1}`}
              onClick={onDoneEditing}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={rowIconBtn}
              title="Edit failure path"
              aria-label={`Edit failure path ${index + 1}`}
              onClick={onEdit}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            className={rowRemoveBtn}
            title="Remove failure path"
            aria-label={`Remove failure path ${index + 1}`}
            onClick={onRemove}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className={label}>Failure path</div>
            <input
              className={input}
              value={row.failurePath}
              onChange={(e) => onChange('failurePath', e.target.value)}
            />
          </div>
          <div>
            <div className={label}>Trigger</div>
            <textarea
              className={cardTextarea}
              value={row.trigger}
              onChange={(e) => onChange('trigger', e.target.value)}
            />
          </div>
          <div className="md:max-w-xs">
            <div className={label}>Timeframe</div>
            <select
              className={input}
              value={row.timeframe}
              onChange={(e) => onChange('timeframe', e.target.value)}
            >
              <option value="">—</option>
              {row.timeframe &&
              !(FAILURE_TIMEFRAME_STANDARD as readonly string[]).includes(row.timeframe) ? (
                <option value={row.timeframe}>
                  {row.timeframe} (custom)
                </option>
              ) : null}
              {FAILURE_TIMEFRAME_STANDARD.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <div className={label}>Estimated impact</div>
            <textarea
              className={cardTextarea}
              value={row.estimatedImpact}
              onChange={(e) => onChange('estimatedImpact', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold leading-snug text-slate-900 pr-2">{title}</h3>
            {row.timeframe.trim() ? (
              <span className={`${badge} shrink-0 ${timeframeBadgeTone(row.timeframe)}`}>
                {row.timeframe}
              </span>
            ) : (
              <span className={`${badge} shrink-0 ${timeframeBadgeTone('')}`}>Timeframe —</span>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Trigger
            </p>
            {trigger ? (
              <ReadMoreClamp text={row.trigger} />
            ) : (
              <p className="text-sm text-slate-500 italic">No trigger described yet.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Estimated impact
            </p>
            {impact ? (
              <ReadMoreClamp text={row.estimatedImpact} />
            ) : (
              <p className="text-sm text-slate-500 italic">No impact estimate yet.</p>
            )}
          </div>
        </div>
      )}
      <FailureAssessmentPanel assessment={assessment} />
    </div>
  );
}

function updateFailure(
  rows: FailureRow[],
  index: number,
  field: keyof FailureRow,
  value: string
): FailureRow[] {
  const next = [...rows];
  next[index] = { ...next[index], [field]: value };
  return next;
}

const completenessBadgeTone: Record<
  ThesisSectionCompleteness,
  { className: string; label: string; hint: string }
> = {
  green: {
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    label: 'Complete',
    hint: 'This section meets the bar for weighted completeness.',
  },
  yellow: {
    className: 'bg-amber-50 text-amber-900 border-amber-200',
    label: 'In progress',
    hint: 'Some important fields are still empty or thin.',
  },
  red: {
    className: 'bg-red-50 text-red-800 border-red-200',
    label: 'Needs attention',
    hint: 'Critical fields are missing or the section is mostly empty.',
  },
};

function SectionCompletenessBadge({
  level,
  optionalSection,
}: {
  level: ThesisSectionCompleteness;
  optionalSection?: boolean;
}) {
  if (optionalSection && level === 'red') {
    return null;
  }
  const tone = completenessBadgeTone[level];
  return (
    <span
      className={`${badge} shrink-0 ${tone.className}`}
      title={tone.hint}
    >
      {tone.label}
    </span>
  );
}

const rowRemoveBtn =
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:pointer-events-none disabled:opacity-30';
const addRowBtn =
  'mt-4 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:opacity-40';

export interface PositionThesisBuilderViewProps {
  /** Ticker from the URL / nav (Firestore load key). */
  ticker: string;
  companyName?: string | null;
  userId: string | null;
  /** undefined = remote load in progress; null = no saved doc; object = hydrate */
  initialPayload: PositionThesisPayload | null | undefined;
  loadError?: string | null;
  /** After first save, if form ticker differs from URL, navigate here so the route matches the doc. */
  onTickerCommitted?: (canonicalTicker: string) => void;
  /**
   * When true and initialPayload is a hydrated object, ticker starts locked (saved Firestore doc).
   * When false (e.g. onboard handoff), ticker stays editable until first save.
   */
  lockTickerInitially?: boolean;
  /** Chat history from server transcript and/or new-thesis onboarding. */
  initialChatHistory?: Array<ChatHistoryEntry | PersistedChatMessage>;
  /** Firebase ID token for saving chat transcript after publish. */
  getIdToken?: () => Promise<string | null>;
  /** Firestore thesis document id (opaque or legacy `userId_TICKER`). Omit for first save → mint new id. */
  thesisDocId?: string | null;
  /** When user arrived from a portfolio position funnel. */
  portfolioLink?: ThesisOnboardPortfolioLink | null;
  /** String passed to thesis coach (portfolio band, sizing, dates). */
  portfolioContextForCoach?: string;
  /** Latest authoring snapshots from Firestore. */
  initialAuthoringHistory?: AuthoringContextEntry[];
  latestEvaluation?: LoadedPositionThesisEvaluation | null;
  /** After first save mints or confirms doc id, parent updates URL. */
  onThesisDocIdCommitted?: (
    docId: string,
    portfolioForUrl?: { portfolioId: string; positionId: string }
  ) => void;
}

export default function PositionThesisBuilderView({
  ticker,
  companyName,
  userId,
  initialPayload,
  loadError,
  onTickerCommitted,
  lockTickerInitially,
  initialChatHistory,
  thesisDocId: thesisDocIdProp,
  portfolioLink,
  portfolioContextForCoach,
  initialAuthoringHistory,
  latestEvaluation,
  getIdToken,
  onThesisDocIdCommitted,
}: PositionThesisBuilderViewProps) {
  const routeTicker = ticker.toUpperCase();
  const displayTicker = routeTicker;
  const searchParams = useSearchParams();
  /** Prefer parent state; fall back to query params so PUT/link works if state hydration lags. */
  const resolvedPortfolioLink = useMemo((): ThesisOnboardPortfolioLink | null => {
    if (
      portfolioLink &&
      typeof portfolioLink.portfolioId === 'string' &&
      portfolioLink.portfolioId.trim() &&
      typeof portfolioLink.positionId === 'string' &&
      portfolioLink.positionId.trim()
    ) {
      return {
        portfolioId: portfolioLink.portfolioId.trim(),
        positionId: portfolioLink.positionId.trim(),
      };
    }
    const pid = searchParams.get('portfolioId');
    const posid = searchParams.get('positionId');
    if (pid?.trim() && posid?.trim()) {
      return { portfolioId: pid.trim(), positionId: posid.trim() };
    }
    return null;
  }, [portfolioLink, searchParams]);

  const [resolvedThesisDocId, setResolvedThesisDocId] = useState<string | null>(
    thesisDocIdProp ?? null
  );
  useEffect(() => {
    setResolvedThesisDocId(thesisDocIdProp ?? null);
  }, [thesisDocIdProp]);

  const [form, setForm] = useState<PositionThesisPayload>(() =>
    initialPayload === undefined
      ? defaultPositionThesisPayload(displayTicker)
      : initialPayload === null
        ? scratchPositionThesisPayload(displayTicker)
        : initialPayload
  );
  const [tickerLocked, setTickerLocked] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [patchHint, setPatchHint] = useState<string | null>(null);
  const [chatAutoSend, setChatAutoSend] = useState<{ nonce: number; text: string } | null>(null);
  const [editingDriverIndex, setEditingDriverIndex] = useState<number | null>(null);
  const [editingFailureIndex, setEditingFailureIndex] = useState<number | null>(null);
  const [authoringShown, setAuthoringShown] = useState(false);
  const thesisChatRef = useRef<ThesisBuilderChatHandle>(null);

  const assumptionRangeFlushersRef = useRef<Array<() => Record<string, string>>>([]);
  const registerAssumptionRangeFlush = useCallback((flush: () => Record<string, string>) => {
    assumptionRangeFlushersRef.current.push(flush);
    return () => {
      assumptionRangeFlushersRef.current = assumptionRangeFlushersRef.current.filter((f) => f !== flush);
    };
  }, []);

  const requestSectionChatHelp = useCallback((text: string) => {
    setChatAutoSend({ nonce: Date.now(), text });
  }, []);

  useEffect(() => {
    if (initialPayload === undefined) return;
    if (initialPayload === null) {
      setTickerLocked(false);
      return;
    }
    const lock = lockTickerInitially !== false;
    setTickerLocked(lock);
  }, [initialPayload, lockTickerInitially]);

  const symbol = form.ticker.trim().toUpperCase() || routeTicker;
  const titleName =
    symbol === routeTicker && companyName ? `${companyName} (${symbol})` : symbol;
  const portfolioBackHref = resolvedPortfolioLink
    ? `/portfolios/${encodeURIComponent(resolvedPortfolioLink.portfolioId)}`
    : '/portfolios';

  const sectionCompleteness = useMemo(() => computeSectionCompleteness(form), [form]);
  const sectionAnalysis = useMemo(
    () => buildPositionThesisSectionAnalysis(form, latestEvaluation),
    [form, latestEvaluation]
  );
  const latestDerivedResult = useMemo(
    () => latestEvaluation?.derivedResult ?? deriveThesisEvaluationResult(latestEvaluation),
    [latestEvaluation]
  );
  const latestStatusUi = useMemo(
    () => thesisStatusDisplay(latestDerivedResult?.status),
    [latestDerivedResult]
  );
  const latestAnalysisFeedbackExecutionId =
    latestEvaluation?.promptMetadata?.reportExecutionId ?? null;

  const persist = useCallback(async () => {
      if (!userId) {
        setSaveState('error');
        setSaveMessage('Sign in to publish your thesis.');
        return;
      }
      const saveSymbol = form.ticker.trim().toUpperCase();
      if (!saveSymbol) {
        setSaveState('error');
        setSaveMessage('Set a ticker before publishing.');
        return;
      }
      setSaveState('saving');
      setSaveMessage(null);
      try {
        const rangeOverlay: Record<string, string> = {};
        for (const flush of assumptionRangeFlushersRef.current) {
          Object.assign(rangeOverlay, flush());
        }
        const payload = { ...form, ...rangeOverlay, ticker: saveSymbol };
        let docId = resolvedThesisDocId;
        if (!docId) {
          docId = newThesisDocumentId();
          setResolvedThesisDocId(docId);
          onThesisDocIdCommitted?.(
            docId,
            resolvedPortfolioLink
              ? {
                  portfolioId: resolvedPortfolioLink.portfolioId,
                  positionId: resolvedPortfolioLink.positionId,
                }
              : undefined
          );
        }

        const authoringEntry: AuthoringContextEntry = {
          source: resolvedPortfolioLink ? 'portfolio_position' : 'standalone',
          capturedAt: new Date().toISOString(),
          portfolioId: resolvedPortfolioLink?.portfolioId,
          positionId: resolvedPortfolioLink?.positionId,
          retroactive: Boolean(resolvedPortfolioLink),
          coachContextSummary: portfolioContextForCoach?.trim().slice(0, 2000),
        };

        await savePositionThesisByDocId(userId, docId, saveSymbol, payload, 'published', {
          portfolioId: resolvedPortfolioLink?.portfolioId ?? null,
          positionId: resolvedPortfolioLink?.positionId ?? null,
          authoringEntry,
        });
        setForm(payload);
        setTickerLocked(true);
        setSaveState('saved');
        let msg = 'Thesis published.';
        if (getIdToken) {
          const token = await getIdToken();
          if (token) {
            const persistable = thesisChatRef.current?.getPersistableMessages() ?? [];
            const chatSave = await savePositionThesisChatTranscript(docId, persistable, token);
            if (!chatSave.ok) {
              msg += ` Chat log was not saved (${chatSave.error}).`;
            }
          }
        }
        if (resolvedPortfolioLink) {
          try {
            const putRes = await fetch(
              `/api/portfolios/${encodeURIComponent(resolvedPortfolioLink.portfolioId)}/positions/${encodeURIComponent(resolvedPortfolioLink.positionId)}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thesisId: docId }),
              }
            );
            const putJson = (await putRes.json()) as { success?: boolean; error?: string };
            if (!putRes.ok || putJson.success === false) {
              msg += ' (could not link to portfolio position.)';
            } else {
              msg += ' Linked to portfolio position.';
            }
          } catch {
            msg += ' (could not link to portfolio position.)';
          }
        }
        setSaveMessage(msg);
        if (saveSymbol !== routeTicker && onTickerCommitted) {
          onTickerCommitted(saveSymbol);
        }
        window.setTimeout(() => {
          setSaveState('idle');
          setSaveMessage(null);
        }, 4500);
      } catch (e) {
        setSaveState('error');
        setSaveMessage(e instanceof Error ? e.message : 'Publish failed.');
      }
    },
    [
      userId,
      routeTicker,
      form,
      onTickerCommitted,
      resolvedThesisDocId,
      resolvedPortfolioLink,
      portfolioContextForCoach,
      onThesisDocIdCommitted,
      getIdToken,
    ]
  );

  const handleFormPatch = useCallback(
    (patch: Partial<PositionThesisPayload> | null | undefined) => {
      if (!patch || Object.keys(patch).length === 0) return;
      setForm((prev) => mergePositionThesisPayload(prev, patch, { tickerLocked }));
      setPatchHint('Form updated from assistant.');
      window.setTimeout(() => setPatchHint(null), 4000);
    },
    [tickerLocked]
  );

  /** Parent should remount with `key` when remote payload is first resolved so state matches Firestore. */
  const loadingRemote = initialPayload === undefined;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center">
          <Link
            href={portfolioBackHref}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            ← Back to portfolio
          </Link>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 mb-2">Position Thesis Builder</p>
            <h1 className="text-3xl font-bold tracking-tight">Build Thesis — {titleName}</h1>
            <p className="text-slate-600 mt-2 max-w-3xl">
              Set or confirm the ticker, then use the assistant to describe your thesis in plain language
              and fill sections collaboratively. Publishing locks the ticker. The system will later score
              this thesis against live market conditions.
            </p>
            {resolvedPortfolioLink && portfolioContextForCoach?.trim() && (
              <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm text-sky-950">
                <p className="font-semibold text-sky-900">Portfolio context</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sky-900/90 text-[13px] leading-relaxed">
                  {portfolioContextForCoach.trim()}
                </pre>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-3">
              <button
                type="button"
                disabled={loadingRemote}
                onClick={() => void persist()}
                className="rounded-2xl bg-slate-900 text-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              >
                Publish Thesis
              </button>
            </div>
            {!userId && (
              <p className="text-xs text-amber-700 max-w-xs text-right">Sign in to publish to Firebase.</p>
            )}
            {loadError && <p className="text-xs text-red-600 max-w-xs text-right">{loadError}</p>}
            {saveMessage && (
              <p
                className={`text-xs max-w-xs text-right ${
                  saveState === 'error' ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {saveState === 'saving' ? 'Publishing…' : saveMessage}
              </p>
            )}
            {patchHint && (
              <p className="text-xs max-w-xs text-right text-slate-600">{patchHint}</p>
            )}
          </div>
        </div>

        {loadingRemote && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Loading saved thesis…
          </div>
        )}

        {!loadingRemote && initialAuthoringHistory && initialAuthoringHistory.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between font-semibold text-slate-800"
              onClick={() => setAuthoringShown((s) => !s)}
            >
              Authoring context
              <span className="text-slate-500">{authoringShown ? '▼' : '▶'}</span>
            </button>
            {authoringShown && (
              <ul className="mt-3 space-y-3 text-slate-700">
                {initialAuthoringHistory.slice(0, 8).map((a, i) => (
                  <li key={`${a.capturedAt}-${i}`} className="border-b border-slate-100 pb-3 last:border-0">
                    <p className="text-xs text-slate-500">
                      {a.capturedAt} · {a.source}
                      {a.retroactive ? ' · retroactive' : ''}
                    </p>
                    {a.coachContextSummary && (
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-[13px]">{a.coachContextSummary}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loadingRemote && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">Position & horizon</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionCompletenessBadge level={sectionCompleteness.basics} />
                    <SectionChatHelpButton
                      sectionTitle="position and horizon"
                      prompt={SECTION_HELP.basics}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <div className={label}>Ticker</div>
                    <input
                      className={`${input} ${tickerLocked ? 'bg-slate-50 text-slate-600 cursor-not-allowed' : ''}`}
                      value={form.ticker}
                      readOnly={tickerLocked}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))
                      }
                      aria-readonly={tickerLocked}
                    />
                    {tickerLocked && (
                      <p className="text-[11px] text-slate-500 mt-1">Ticker is fixed after publish.</p>
                    )}
                  </div>
                  <div>
                    <div className={label}>Position Role</div>
                    <input
                      className={input}
                      value={form.positionRole}
                      onChange={(e) => setForm((f) => ({ ...f, positionRole: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Holding Horizon</div>
                    <input
                      className={input}
                      value={form.holdingHorizon}
                      onChange={(e) => setForm((f) => ({ ...f, holdingHorizon: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">1. Thesis Statement</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionCompletenessBadge level={sectionCompleteness.thesis} />
                    <SectionChatHelpButton
                      sectionTitle="thesis statement and portfolio context"
                      prompt={SECTION_HELP.thesis}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <textarea
                  className={textarea}
                  value={form.thesisStatement}
                  onChange={(e) => setForm((f) => ({ ...f, thesisStatement: e.target.value }))}
                />
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className={label}>Why does this belong in the portfolio?</div>
                    <textarea
                      className={textarea}
                      value={form.portfolioRole}
                      onChange={(e) => setForm((f) => ({ ...f, portfolioRole: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>What regime is this thesis designed for?</div>
                    <textarea
                      className={textarea}
                      value={form.regimeDesignedFor}
                      onChange={(e) => setForm((f) => ({ ...f, regimeDesignedFor: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className={label}>Risk posture</div>
                  <input
                    className={input}
                    value={form.riskPosture}
                    onChange={(e) => setForm((f) => ({ ...f, riskPosture: e.target.value }))}
                  />
                </div>
                <LatestSectionAnalysis
                  summary={sectionAnalysis.summary}
                  blockedReason={sectionAnalysis.blockedReason}
                  phaseLabel={
                    latestDerivedResult ? latestStatusUi.phaseLabel : undefined
                  }
                  badgeClassName={
                    latestDerivedResult ? latestStatusUi.badgeClassName : undefined
                  }
                  recommendation={latestEvaluation?.structuredResult?.systemRecommendation}
                  feedbackExecutionId={latestAnalysisFeedbackExecutionId}
                />
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">2. Return Expectation</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionCompletenessBadge level={sectionCompleteness.returns} />
                    <SectionChatHelpButton
                      sectionTitle="return expectations"
                      prompt={SECTION_HELP.returns}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <div className="max-w-xs">
                  <div className={label}>Entry Price</div>
                  <input
                    className={input}
                    value={form.entryPrice}
                    onChange={(e) => setForm((f) => ({ ...f, entryPrice: e.target.value }))}
                  />
                </div>
                <div className="mt-4">
                  <div className={assumptionTierCard}>
                    <h3 className={tierHeading}>Base case assumptions (ranges)</h3>
                    <p className="text-xs text-slate-500 mb-4">
                      Each row is <span className="font-medium text-slate-600">low – high</span> in the
                      units shown. Use the same value twice for a single point estimate.
                    </p>
                    <div className="grid gap-6 md:grid-cols-3">
                      <AssumptionRangeFields
                        title="Dividend yield (% per year)"
                        stored={form[BASE_RETURN_ASSUMPTION_KEYS.dividendKey]}
                        onCommit={(value) =>
                          setForm((f) => ({
                            ...f,
                            [BASE_RETURN_ASSUMPTION_KEYS.dividendKey]: value,
                          }))
                        }
                        placeholders={['Low %', 'High %']}
                        formFieldKey={BASE_RETURN_ASSUMPTION_KEYS.dividendKey}
                        registerAssumptionRangeFlush={registerAssumptionRangeFlush}
                      />
                      <AssumptionRangeFields
                        title="Growth (% per year)"
                        stored={form[BASE_RETURN_ASSUMPTION_KEYS.growthKey]}
                        onCommit={(value) =>
                          setForm((f) => ({
                            ...f,
                            [BASE_RETURN_ASSUMPTION_KEYS.growthKey]: value,
                          }))
                        }
                        placeholders={['Low %', 'High %']}
                        formFieldKey={BASE_RETURN_ASSUMPTION_KEYS.growthKey}
                        registerAssumptionRangeFlush={registerAssumptionRangeFlush}
                      />
                      <AssumptionRangeFields
                        title="Valuation multiple (×)"
                        titleAccessory={
                          <select
                            className={multipleBasisSelect}
                            aria-label="Valuation multiple basis"
                            value={
                              VALUATION_MULTIPLE_BASIS.includes(
                                form.baseMultipleBasis as (typeof VALUATION_MULTIPLE_BASIS)[number]
                              )
                                ? form.baseMultipleBasis
                                : 'P/E'
                            }
                            onChange={(e) =>
                              setForm((f) => ({ ...f, baseMultipleBasis: e.target.value }))
                            }
                          >
                            {VALUATION_MULTIPLE_BASIS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        }
                        stored={form[BASE_RETURN_ASSUMPTION_KEYS.multipleKey]}
                        onCommit={(value) =>
                          setForm((f) => ({
                            ...f,
                            [BASE_RETURN_ASSUMPTION_KEYS.multipleKey]: value,
                          }))
                        }
                        placeholders={['Low ×', 'High ×']}
                        formFieldKey={BASE_RETURN_ASSUMPTION_KEYS.multipleKey}
                        registerAssumptionRangeFlush={registerAssumptionRangeFlush}
                      />
                    </div>
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4 mt-6">
                  <div>
                    <div className={label}>Upside Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.upsideScenario}
                      onChange={(e) => setForm((f) => ({ ...f, upsideScenario: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Base Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.baseScenario}
                      onChange={(e) => setForm((f) => ({ ...f, baseScenario: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Downside Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.downsideScenario}
                      onChange={(e) => setForm((f) => ({ ...f, downsideScenario: e.target.value }))}
                    />
                  </div>
                </div>
                <LatestSectionAnalysis
                  summary={sectionAnalysis.summary}
                  blockedReason={sectionAnalysis.blockedReason}
                />
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">3. Drivers and Dependencies</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionCompletenessBadge level={sectionCompleteness.drivers} />
                    <SectionChatHelpButton
                      sectionTitle="drivers and dependencies"
                      prompt={SECTION_HELP.drivers}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-stretch gap-4">
                  {form.drivers.length === 0 ? (
                    <p className="w-full rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
                      No drivers yet. Add one to capture what moves this thesis.
                    </p>
                  ) : (
                    form.drivers.map((row, i) => (
                      <ThesisDriverCard
                        key={i}
                        row={row}
                        index={i}
                        editing={editingDriverIndex === i}
                        assessment={sectionAnalysis.driverAssessmentsByIndex[i] ?? null}
                        onEdit={() => setEditingDriverIndex(i)}
                        onDoneEditing={() =>
                          setEditingDriverIndex((prev) => (prev === i ? null : prev))
                        }
                        onRemove={() => {
                          setForm((f) => ({
                            ...f,
                            drivers: f.drivers.filter((_, idx) => idx !== i),
                          }));
                          setEditingDriverIndex((prev) =>
                            prev === i ? null : prev !== null && prev > i ? prev - 1 : prev
                          );
                        }}
                        onChange={(field, value) =>
                          setForm((f) => ({
                            ...f,
                            drivers: updateDriver(f.drivers, i, field, value),
                          }))
                        }
                      />
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className={addRowBtn}
                  disabled={form.drivers.length >= MAX_TABLE_ROWS}
                  onClick={() =>
                    setForm((f) => {
                      const idx = f.drivers.length;
                      setEditingDriverIndex(idx);
                      return {
                        ...f,
                        drivers: [...f.drivers, { ...EMPTY_DRIVER_ROW }],
                      };
                    })
                  }
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add driver
                </button>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">4. Downside and Failure Map</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionCompletenessBadge level={sectionCompleteness.failures} />
                    <SectionChatHelpButton
                      sectionTitle="downside and failure map"
                      prompt={SECTION_HELP.failures}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-stretch gap-4">
                  {form.failures.length === 0 ? (
                    <p className="w-full rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
                      No failure paths yet. Add one to spell out how the thesis could break.
                    </p>
                  ) : (
                    form.failures.map((row, i) => (
                      <ThesisFailureCard
                        key={i}
                        row={row}
                        index={i}
                        editing={editingFailureIndex === i}
                        assessment={sectionAnalysis.failureAssessmentsByIndex[i] ?? null}
                        onEdit={() => setEditingFailureIndex(i)}
                        onDoneEditing={() =>
                          setEditingFailureIndex((prev) => (prev === i ? null : prev))
                        }
                        onRemove={() => {
                          setForm((f) => ({
                            ...f,
                            failures: f.failures.filter((_, idx) => idx !== i),
                          }));
                          setEditingFailureIndex((prev) =>
                            prev === i ? null : prev !== null && prev > i ? prev - 1 : prev
                          );
                        }}
                        onChange={(field, value) =>
                          setForm((f) => ({
                            ...f,
                            failures: updateFailure(f.failures, i, field, value),
                          }))
                        }
                      />
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className={addRowBtn}
                  disabled={form.failures.length >= MAX_TABLE_ROWS}
                  onClick={() =>
                    setForm((f) => {
                      const idx = f.failures.length;
                      setEditingFailureIndex(idx);
                      return {
                        ...f,
                        failures: [...f.failures, { ...EMPTY_FAILURE_ROW }],
                      };
                    })
                  }
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add failure path
                </button>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">5. Decision Rules</h2>
                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                    <span
                      className={`${badge} shrink-0 bg-slate-100 text-slate-600 border-slate-200`}
                      title="You can publish without filling this section."
                    >
                      Optional
                    </span>
                    <SectionCompletenessBadge
                      level={sectionCompleteness.rules}
                      optionalSection
                    />
                    <SectionChatHelpButton
                      sectionTitle="decision rules"
                      prompt={SECTION_HELP.rules}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className={label}>Trim rule</div>
                    <textarea
                      className={textarea}
                      value={form.trimRule}
                      onChange={(e) => setForm((f) => ({ ...f, trimRule: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Exit rule</div>
                    <textarea
                      className={textarea}
                      value={form.exitRule}
                      onChange={(e) => setForm((f) => ({ ...f, exitRule: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className={label}>Add rule</div>
                    <textarea
                      className={textarea}
                      value={form.addRule}
                      onChange={(e) => setForm((f) => ({ ...f, addRule: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>System monitoring signals</div>
                    <textarea
                      className={textarea}
                      value={form.systemMonitoringSignals}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, systemMonitoringSignals: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <RuleSignalsAnalysis
                  blockedReason={sectionAnalysis.blockedReason}
                  ruleSignals={sectionAnalysis.ruleSignals}
                />
              </div>
            </div>

            <div className="space-y-6 xl:sticky xl:top-6 xl:self-start w-full">
              <ThesisBuilderChat
                ref={thesisChatRef}
                apiTicker={symbol}
                companyName={companyName}
                form={form}
                tickerLocked={tickerLocked}
                onFormPatch={handleFormPatch}
                initialMessages={initialChatHistory}
                autoSendMessage={chatAutoSend}
                portfolioContext={portfolioContextForCoach ?? ''}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
