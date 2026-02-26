'use client';

interface MajorDevelopment {
  date: string;
  description: string;
  articleRef?: { url?: string; title?: string; source?: string; publishedAt?: string };
}

interface MarketShiftTimeline {
  firstSurfacedAt: string;
  majorDevelopments: MajorDevelopment[];
}

interface MarketShift {
  id: string;
  type: string;
  category: string;
  headline: string;
  summary: string;
  channelIds: string[];
  articleRefs: { url?: string; title?: string; source?: string; publishedAt?: string }[];
  asOf?: string;
  fetchedAt?: string;
  timeline?: MarketShiftTimeline;
  analyzedAt?: string;
  momentumScore: number;
  momentumScorePrev: number;
  momentumLabel: string;
  firstSeenAt?: string;
}

interface MarketShiftDrawerProps {
  shift: MarketShift;
  onClose: () => void;
}

function daysAgo(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const MOMENTUM_LABEL_STYLES: Record<string, string> = {
  'Accelerating': 'bg-amber-100 text-amber-800',
  'Entrenched': 'bg-orange-100 text-orange-800',
  'Picking up steam': 'bg-blue-100 text-blue-800',
  'Fading — was strong': 'bg-gray-200 text-gray-500',
  'Fading': 'bg-gray-100 text-gray-500',
  'Just surfaced': 'bg-gray-100 text-gray-400',
};

function MomentumBadge({ label }: { label: string }) {
  const cls = MOMENTUM_LABEL_STYLES[label] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function formatFriendlyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function MarketShiftDrawer({ shift, onClose }: MarketShiftDrawerProps) {
  const hasTimeline = shift.timeline && (shift.timeline.firstSurfacedAt || (shift.timeline.majorDevelopments?.length ?? 0) > 0);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">
              {shift.headline}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
              aria-label="Close"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                shift.type === 'TAILWIND'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {shift.type}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
              {shift.category.replace(/_/g, ' ')}
            </span>
            <MomentumBadge label={shift.momentumLabel} />
            {shift.firstSeenAt && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                First detected {daysAgo(shift.firstSeenAt)}
              </span>
            )}
          </div>

          {shift.summary && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                Summary
              </h4>
              <p className="text-gray-700 leading-relaxed">
                {shift.summary}
              </p>
            </div>
          )}

          <div className="mb-6">
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
              Timeline
            </h4>
            {hasTimeline ? (
              <div className="space-y-4">
                {shift.timeline!.firstSurfacedAt && (
                  <p className="text-sm text-gray-600">
                    First surfaced: {formatFriendlyDate(shift.timeline!.firstSurfacedAt)}
                  </p>
                )}
                {shift.timeline!.majorDevelopments && shift.timeline!.majorDevelopments.length > 0 ? (
                  <ul className="space-y-3">
                    {shift.timeline!.majorDevelopments.map((d, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="text-gray-500 text-sm shrink-0 w-24">{formatFriendlyDate(d.date)}</span>
                        <span className="text-gray-700 text-sm">
                          {d.description}
                          {d.articleRef?.url && (
                            <a
                              href={d.articleRef.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 text-blue-600 hover:underline"
                            >
                              {d.articleRef.title || d.articleRef.source || 'Source'}
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">
                Timeline not yet analyzed.
              </p>
            )}
          </div>

          {shift.articleRefs && shift.articleRefs.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                Sources
              </h4>
              <ul className="space-y-1.5 text-sm">
                {shift.articleRefs.map((ref, i) => (
                  <li key={i}>
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {ref.title || ref.source || 'Source'}
                      </a>
                    ) : (
                      <span className="text-gray-600">{ref.title || ref.source || 'Source'}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
