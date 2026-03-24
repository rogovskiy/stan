import type { LiveThesisCardPanelProps } from '@/app/components/position-thesis/LiveThesisCard';
import { getImpliedReturnIntervalFromPayload } from '@/app/lib/thesisImpliedReturnFromPayload';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

function fmtRange(i: { min: number; max: number }): string {
  if (i.min === i.max) return `${i.min.toFixed(1)}%`;
  return `${i.min.toFixed(1)}–${i.max.toFixed(1)}%`;
}

/** Use value if non-empty, else em dash (unknown / not in thesis). */
function dash(s: string | undefined, maxLen?: number): string {
  const t = s?.trim();
  if (!t) return '—';
  if (maxLen != null && t.length > maxLen) return `${t.slice(0, maxLen)}…`;
  return t;
}

function bandRange(
  bandER: { min: number; max: number } | null | undefined
): { min: number; max: number } | null {
  if (
    bandER == null ||
    typeof bandER.min !== 'number' ||
    typeof bandER.max !== 'number' ||
    !Number.isFinite(bandER.min) ||
    !Number.isFinite(bandER.max)
  ) {
    return null;
  }
  return bandER;
}

/**
 * Full Live Thesis Card props. Forward return matches band alignment (growth + yield → implied interval).
 * Subtitle under forward return is only "above band" / "below band" when misaligned (portfolio hover).
 * Status, rule state, and system recommendation are always "n/a"; downside is "N/A". Other missing fields use "—".
 */
export function thesisPayloadToLiveCardPanelProps(
  payload: PositionThesisPayload | null | undefined,
  bandExpectedReturn?: { min: number; max: number } | null
): LiveThesisCardPanelProps {
  if (!payload) {
    return {
      phaseLabel: 'n/a',
      statusBadge: 'n/a',
      badgeClassName: 'bg-slate-100 text-slate-600 border-slate-200',
      forwardReturn: '—',
      downside: 'N/A',
      volRegime: '—',
      ruleState: 'n/a',
      recommendation: 'n/a',
    };
  }

  const interval = getImpliedReturnIntervalFromPayload(payload);
  const forwardReturn = interval != null ? fmtRange(interval) : '—';

  const band = bandRange(bandExpectedReturn);
  let forwardReturnSubtitle: string | undefined;
  let forwardReturnSubtitleTone: 'above_band' | 'below_band' | undefined;
  if (interval && band) {
    const mid = (interval.min + interval.max) / 2;
    const { min: lo, max: hi } = band;
    if (mid > hi) {
      forwardReturnSubtitle = 'above band';
      forwardReturnSubtitleTone = 'above_band';
    } else if (mid < lo) {
      forwardReturnSubtitle = 'below band';
      forwardReturnSubtitleTone = 'below_band';
    }
  }

  return {
    phaseLabel: 'n/a',
    statusBadge: 'n/a',
    badgeClassName: 'bg-slate-100 text-slate-700 border-slate-200',
    forwardReturn,
    forwardReturnSubtitle,
    forwardReturnSubtitleTone,
    downside: 'N/A',
    volRegime: dash(payload.currentVolRegime),
    ruleState: 'n/a',
    recommendation: 'n/a',
  };
}
