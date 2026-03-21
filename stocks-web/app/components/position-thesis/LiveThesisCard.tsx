'use client';

const badgeBase = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border';

export interface LiveThesisCardPanelProps {
  phaseLabel?: string;
  statusBadge?: string;
  badgeClassName?: string;
  forwardReturn?: string;
  downside?: string;
  volRegime?: string;
  ruleState?: string;
  recommendation?: string;
}

const defaults: Required<LiveThesisCardPanelProps> = {
  phaseLabel: 'Harvest Phase',
  statusBadge: 'Partially Realized',
  badgeClassName: 'bg-amber-50 text-amber-700 border-amber-200',
  forwardReturn: '5–7%',
  downside: '-15% to -25%',
  volRegime: 'High',
  ruleState: 'Trim watch',
  recommendation:
    'Gains have likely pulled forward several years of expected return. Keep the core thesis, but consider trimming if current oil volatility persists and forward return remains compressed.',
};

/** Inner card body (rounded slate panel) — use inside popovers or full section. */
export function LiveThesisCardPanel({
  phaseLabel = defaults.phaseLabel,
  statusBadge = defaults.statusBadge,
  badgeClassName = defaults.badgeClassName,
  forwardReturn = defaults.forwardReturn,
  downside = defaults.downside,
  volRegime = defaults.volRegime,
  ruleState = defaults.ruleState,
  recommendation = defaults.recommendation,
}: LiveThesisCardPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 space-y-4 bg-slate-50">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-slate-500">Status</div>
          <div className="text-xl font-semibold">{phaseLabel}</div>
        </div>
        <span className={`${badgeBase} ${badgeClassName}`}>{statusBadge}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <div className="text-slate-500">Forward return</div>
          <div className="text-lg font-semibold">{forwardReturn}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <div className="text-slate-500">Downside</div>
          <div className="text-lg font-semibold">{downside}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <div className="text-slate-500">Vol regime</div>
          <div className="text-lg font-semibold">{volRegime}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3">
          <div className="text-slate-500">Rule state</div>
          <div className="text-lg font-semibold">{ruleState}</div>
        </div>
      </div>
      <div>
        <div className="text-sm font-medium mb-2">System recommendation</div>
        <div className="rounded-xl bg-white border border-slate-200 p-3 text-sm text-slate-700">
          {recommendation}
        </div>
      </div>
    </div>
  );
}

const sectionShell = 'bg-white rounded-2xl shadow-sm border border-slate-200 p-5';

export interface LiveThesisCardProps extends LiveThesisCardPanelProps {
  /** Full block with section chrome and heading (thesis builder sidebar). */
  className?: string;
}

export default function LiveThesisCard({ className = '', ...panelProps }: LiveThesisCardProps) {
  return (
    <div className={`${sectionShell} ${className}`.trim()}>
      <h2 className="text-lg font-semibold mb-4">Live Thesis Card</h2>
      <LiveThesisCardPanel {...panelProps} />
    </div>
  );
}
