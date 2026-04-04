'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { LiveThesisCardPanel, type LiveThesisCardPanelProps } from '@/app/components/position-thesis/LiveThesisCard';
import { thesisPayloadToLiveCardPanelProps } from '@/app/lib/thesisPayloadToLiveCardPanel';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import type { StressDrawdownPosition } from '@/app/lib/services/portfolioService';

const HOVER_LEAVE_MS = 200;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

function stressDownsideFromRow(
  rawStressDrawdownPct: number | null | undefined,
  stressRow: StressDrawdownPosition | null | undefined,
  stressPercentile: number | null | undefined,
): { downside: string; downsideSubtitle?: string } | null {
  const stressPct = stressRow?.stressDrawdownPct;
  const displayedStressPct =
    stressPct != null && Number.isFinite(stressPct) ? stressPct : rawStressDrawdownPct;

  if (displayedStressPct == null || !Number.isFinite(displayedStressPct)) {
    return null;
  }
  const downside = `${displayedStressPct.toFixed(1)}%`;
  const method = stressRow?.method;
  const cur = stressRow?.currentPe;
  const norm = stressRow?.normalPe;
  const currentDd = stressRow?.currentDrawdownPct;
  const remainingDd = stressRow?.remainingStressDrawdownPct;
  // Prefer P/E copy whenever the job saved multiples (even if method string is stale on the doc).
  if (
    cur != null &&
    norm != null &&
    Number.isFinite(cur) &&
    Number.isFinite(norm) &&
    norm > 0
  ) {
    const cx = cur.toFixed(1);
    const nx = norm.toFixed(1);
    let downsideSubtitle: string;
    if (cur < norm) {
      downsideSubtitle = `Trades below normal P/E — about ${cx}× vs a typical ~${nx}×`;
    } else if (cur > norm) {
      downsideSubtitle = `Trades above normal P/E — about ${cx}× vs a typical ~${nx}×`;
    } else {
      downsideSubtitle = `Near the historical average P/E (~${nx}×)`;
    }
    return {
      downside,
      downsideSubtitle,
    };
  }

  if (method === 'normal_multiple') {
    return {
      downside,
      downsideSubtitle: 'Drawdown if price reverts to trailing EPS × historical average P/E',
    };
  }

  if (method === 'historical_percentile') {
    const realizedText =
      currentDd != null && Number.isFinite(currentDd)
        ? `Already down ${currentDd.toFixed(1)}%`
        : 'Current drawdown not available';
    const remainingText =
      remainingDd != null && Number.isFinite(remainingDd)
        ? `leaving ${remainingDd.toFixed(1)}% downside under this stress case`
        : 'remaining downside not available';
    return {
      downside,
      downsideSubtitle:
        stressPercentile != null && Number.isFinite(stressPercentile)
          ? `${realizedText}, ${remainingText}. Stress is based on past selloffs.`
          : `${realizedText}, ${remainingText}. Stress is based on this asset's historical swings.`,
    };
  }

  return { downside };
}

/**
 * Wraps the thesis icon (or any control): hover shows the same Live Thesis Card layout as the (i) demo,
 * filled from the loaded thesis payload. Optional band range enables growth/yield hint when misaligned.
 */
export default function PositionThesisCardHoverTrigger({
  ticker,
  thesisPayload,
  loading = false,
  bandExpectedReturn,
  /** Fallback displayed downside % when row-level stress details are unavailable. */
  rawStressDrawdownPct,
  /** Per-position row from portfolio stressDrawdown (method, P/E breakdown for stocks). */
  stressRow,
  /** Portfolio-level percentile (e.g. 0.9) for historical_percentile subtitle. */
  stressPercentile,
  children,
}: {
  ticker: string;
  thesisPayload: PositionThesisPayload | null | undefined;
  loading?: boolean;
  /** Band target %/yr (min–max); used only to tint the growth+yield subtitle when above/below band. */
  bandExpectedReturn?: { min: number; max: number } | null;
  rawStressDrawdownPct?: number | null;
  stressRow?: StressDrawdownPosition | null;
  stressPercentile?: number | null;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const panelProps: LiveThesisCardPanelProps = useMemo(() => {
    const stressDown = stressDownsideFromRow(rawStressDrawdownPct, stressRow, stressPercentile);
    if (loading) {
      const base = thesisPayloadToLiveCardPanelProps(null, bandExpectedReturn);
      return {
        ...base,
        forwardReturn: '…',
        forwardReturnSubtitle: '',
        forwardReturnSubtitleTone: undefined,
        ...(stressDown ?? {}),
      };
    }
    const base = thesisPayloadToLiveCardPanelProps(thesisPayload, bandExpectedReturn);
    if (stressDown) {
      return { ...base, ...stressDown };
    }
    return base;
  }, [loading, thesisPayload, bandExpectedReturn, rawStressDrawdownPct, stressRow, stressPercentile]);

  const computePosition = useCallback(() => {
    const trigger = wrapRef.current;
    const tip = tooltipRef.current;
    if (!trigger) return;

    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const tipH = tip?.offsetHeight ?? 320;
    const tipW = tip?.offsetWidth ?? Math.min(352, vw - 2 * VIEWPORT_MARGIN);

    const spaceBelow = vh - r.bottom - VIEWPORT_MARGIN;
    const spaceAbove = r.top - VIEWPORT_MARGIN;
    const heightBelow = GAP + tipH;
    const heightAbove = GAP + tipH;

    let top: number;
    if (spaceBelow >= heightBelow) {
      top = r.bottom + GAP;
    } else if (spaceAbove >= heightAbove) {
      top = r.top - GAP - tipH;
    } else {
      // Prefer the side with more room, then clamp into viewport.
      if (spaceBelow >= spaceAbove) {
        top = r.bottom + GAP;
      } else {
        top = r.top - GAP - tipH;
      }
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - tipH - VIEWPORT_MARGIN));
    }

    let left = r.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tipW - VIEWPORT_MARGIN));

    setCoords({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    const id = requestAnimationFrame(() => computePosition());
    return () => cancelAnimationFrame(id);
  }, [open, computePosition, panelProps]);

  useEffect(() => {
    if (!open) return;
    const tip = tooltipRef.current;
    if (!tip || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => computePosition());
    ro.observe(tip);
    return () => ro.disconnect();
  }, [open, computePosition, panelProps]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => computePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, computePosition]);

  const handleEnter = useCallback(() => {
    clearLeaveTimer();
    setOpen(true);
  }, [clearLeaveTimer]);

  const handleLeave = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => setOpen(false), HOVER_LEAVE_MS);
  }, [clearLeaveTimer]);

  const panel =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={tooltipRef}
        className="fixed z-[9999] w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-2 shadow-xl ring-1 ring-black/5"
        style={{ top: coords.top, left: coords.left }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        role="tooltip"
      >
        <p className="text-xs text-gray-500 px-1 pb-2 border-b border-gray-100 mb-2">
          Thesis snapshot · {ticker.toUpperCase()}
        </p>
        <LiveThesisCardPanel {...panelProps} />
      </div>,
      document.body
    );

  return (
    <>
      <div
        ref={wrapRef}
        className="relative inline-flex items-center align-middle"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </div>
      {panel}
    </>
  );
}
