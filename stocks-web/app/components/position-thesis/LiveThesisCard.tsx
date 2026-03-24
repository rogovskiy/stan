'use client';

const badgeBase = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border';

export interface LiveThesisCardPanelProps {
  phaseLabel?: string;
  statusBadge?: string;
  badgeClassName?: string;
  forwardReturn?: string;
  /** Small line under forward return — only used for above/below band. */
  forwardReturnSubtitle?: string;
  /** When set with subtitle, tints band position lines (portfolio hover). */
  forwardReturnSubtitleTone?: 'above_band' | 'below_band';
  downside?: string;
  volRegime?: string;
  ruleState?: string;
  recommendation?: string;
}

/** Empty-state placeholders — no sample narrative. */
const defaults: Required<Omit<LiveThesisCardPanelProps, 'forwardReturnSubtitle' | 'forwardReturnSubtitleTone'>> & {
  forwardReturnSubtitle: string;
  forwardReturnSubtitleTone: undefined;
} = {
  phaseLabel: 'n/a',
  statusBadge: 'n/a',
  badgeClassName: 'bg-slate-100 text-slate-600 border-slate-200',
  forwardReturn: '—',
  forwardReturnSubtitle: '',
  forwardReturnSubtitleTone: undefined,
  downside: 'N/A',
  volRegime: '—',
  ruleState: 'n/a',
  recommendation: 'n/a',
};

/** Inner card body (rounded slate panel) — use inside popovers or full section. */
export function LiveThesisCardPanel({
  phaseLabel = defaults.phaseLabel,
  statusBadge = defaults.statusBadge,
  badgeClassName = defaults.badgeClassName,
  forwardReturn = defaults.forwardReturn,
  forwardReturnSubtitle = defaults.forwardReturnSubtitle,
  forwardReturnSubtitleTone = defaults.forwardReturnSubtitleTone,
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
          {forwardReturnSubtitle ? (
            <div
              className={
                forwardReturnSubtitleTone === 'below_band'
                  ? 'text-xs text-amber-800 mt-1 leading-snug'
                  : 'text-xs text-slate-500 mt-1 leading-snug'
              }
            >
              {forwardReturnSubtitle}
            </div>
          ) : null}
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
