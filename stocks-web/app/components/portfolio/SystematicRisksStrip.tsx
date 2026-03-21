import type { ChannelContributor, ChannelExposure, ChannelExposures } from '../../lib/services/portfolioService';

const CHANNEL_LABELS: Record<string, string> = {
  EQUITIES_US: 'Equity market',
  CREDIT: 'Credit',
  VOL: 'Volatility',
  RATES_SHORT: 'Short rates',
  RATES_LONG: 'Long rates',
  USD: 'USD',
  OIL: 'Oil',
  GOLD: 'Gold',
  INFLATION: 'Inflation',
  GLOBAL_RISK: 'Global risk',
};

/**
 * Placeholder annual total-return band for the equity tooltip (UI constants only).
 * Not fetched from market data or Firebase—pick values you want for a rough β× stress illustration.
 */
const ILLUSTRATIVE_SPY_ANNUAL_LOW_PCT = -22;
const ILLUSTRATIVE_SPY_ANNUAL_HIGH_PCT = 28;

const levelBars: Record<string, number> = { HIGH: 3, MED: 2, 'LOW-MED': 2, LOW: 1 };
const levelColors: Record<string, string> = {
  HIGH: '#dc2626',
  MED: '#d97706',
  'LOW-MED': '#ca8a04',
  LOW: '#16a34a',
};

function RiskBars({ level }: { level: keyof typeof levelBars }) {
  const n = levelBars[level];
  const color = levelColors[level];
  const halfSecond = level === 'LOW-MED';
  return (
    <span className="inline-flex items-end gap-0.5" title={level} aria-label={level}>
      {[1, 2, 3].map((i) => {
        const filled = i < n;
        const half = i === n && halfSecond;
        const show = filled || half;
        return (
          <span
            key={i}
            className="w-1 rounded-sm"
            style={{
              height: 10,
              backgroundColor: show ? color : '#e5e7eb',
              opacity: half ? 0.5 : 1,
            }}
          />
        );
      })}
    </span>
  );
}

function connectionAdverb(beta: number): string {
  const a = Math.abs(beta);
  if (!Number.isFinite(a)) return '';
  if (a >= 0.85) return 'strongly';
  if (a >= 0.45) return 'significantly';
  if (a >= 0.2) return 'meaningfully';
  return 'somewhat';
}

/** Short tooltip body: 1% rule, optional illustrative annual band (equity), holdings line. */
function SystematicRiskTooltipBody({
  channelId,
  exposure,
  contributors,
}: {
  channelId: string;
  exposure: ChannelExposure;
  contributors: ChannelContributor[];
}) {
  const { beta, rSquared, proxy } = exposure;
  const betaOk = Number.isFinite(beta);
  const adv = betaOk ? connectionAdverb(beta) : '';

  // +1% proxy move → β% portfolio return (daily return regression)
  const onePctLine = betaOk ? (
    <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
      A <strong>+1%</strong> move in <strong>{proxy}</strong> lines up with about{' '}
      <strong>{beta.toFixed(2)}%</strong> move in this portfolio (historical average, same day).
    </p>
  ) : (
    <p className="mt-2 text-[11px] text-gray-500">β could not be estimated.</p>
  );

  const showSpyStyleBand = channelId === 'EQUITIES_US' && betaOk;
  /** spyTotalReturnPct e.g. -22 for −22% full-period move; portfolio ≈ β × that % (linear). */
  const impactAtSpy = (spyTotalReturnPct: number) => beta * spyTotalReturnPct;
  const bandLow = showSpyStyleBand ? impactAtSpy(ILLUSTRATIVE_SPY_ANNUAL_LOW_PCT) : 0;
  const bandHigh = showSpyStyleBand ? impactAtSpy(ILLUSTRATIVE_SPY_ANNUAL_HIGH_PCT) : 0;

  const holdingsLine =
    contributors.length > 0 ? (
      <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
        <span className="font-medium text-gray-900">Biggest holdings affecting this:</span>{' '}
        {contributors.slice(0, 6).map((c, i) => (
          <span key={c.ticker}>
            {i > 0 ? ', ' : ''}
            <strong>{c.ticker}</strong> ({c.weightPct.toFixed(0)}%)
          </span>
        ))}
        .
      </p>
    ) : null;

  return (
    <div className="space-y-0 text-left">
      <p className="text-[11px] leading-relaxed text-gray-800">
        {betaOk ? (
          <>
            Your portfolio is <strong>{adv}</strong> connected to <strong>{proxy}</strong>.
          </>
        ) : (
          <>Connection to {proxy} could not be quantified.</>
        )}
      </p>

      {onePctLine}

      {showSpyStyleBand && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
          Illustrative: a rough <strong>placeholder</strong> twelve-month band for <strong>{proxy}</strong> of{' '}
          <strong>{ILLUSTRATIVE_SPY_ANNUAL_LOW_PCT}%</strong> to <strong>+{ILLUSTRATIVE_SPY_ANNUAL_HIGH_PCT}%</strong>{' '}
          (set in code, not a live quote). With your β, return <strong>tied to this factor</strong> might
          roughly span <strong>{bandLow.toFixed(1)}%</strong> to <strong>{bandHigh.toFixed(1)}%</strong> (β ×
          those moves). Other drivers also move your portfolio.
        </p>
      )}

      {Number.isFinite(rSquared) && rSquared > 0 && (
        <p className="mt-1.5 text-[10px] text-gray-500">
          R² ≈ {(rSquared * 100).toFixed(0)}% of day-to-day variance moved with {proxy} in this window.
        </p>
      )}

      {holdingsLine}
    </div>
  );
}

type RiskLevel = 'HIGH' | 'MED' | 'LOW-MED' | 'LOW';

type SystematicRiskRow = {
  channelId: string;
  label: string;
  level: RiskLevel;
  reliableImpact: number;
  exposure: ChannelExposure;
};

export default function SystematicRisksStrip({
  channelExposures,
}: {
  channelExposures?: ChannelExposures;
}) {
  const channels = channelExposures?.channels;
  const systematicRisks: SystematicRiskRow[] = channels
    ? Object.entries(channels)
        .map(([ch, exp]) => {
          const absBeta = Math.abs(exp.beta);
          const r2 = exp.rSquared ?? 0;
          const reliableImpact = absBeta * r2;
          const level: RiskLevel =
            reliableImpact >= 0.03
              ? 'HIGH'
              : reliableImpact >= 0.005
                ? 'MED'
                : reliableImpact >= 0.001
                  ? 'LOW-MED'
                  : 'LOW';
          return {
            channelId: ch,
            label: CHANNEL_LABELS[ch] ?? ch,
            reliableImpact,
            level,
            exposure: exp,
          };
        })
        .sort((a, b) => b.reliableImpact - a.reliableImpact)
        .slice(0, 5)
    : [];

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 overflow-visible">
      <span className="font-medium text-gray-400">Systematic risks:</span>
      {systematicRisks.length > 0 ? (
        systematicRisks.map(({ channelId, label, level, exposure }) => {
          const contributors = exposure.contributors ?? [];

          return (
            <div
              key={channelId}
              className="group relative inline-flex cursor-help items-center gap-1.5 overflow-visible before:absolute before:left-0 before:top-full before:z-40 before:h-2 before:w-full before:content-['']"
            >
              <span className="inline-flex items-center gap-1.5">
                {label} <RiskBars level={level} />
              </span>
              <div
                className="pointer-events-none invisible absolute left-0 top-full z-[100] mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100"
                role="tooltip"
              >
                <p className="font-semibold text-gray-900">{label}</p>
                <SystematicRiskTooltipBody
                  channelId={channelId}
                  exposure={exposure}
                  contributors={contributors}
                />
              </div>
            </div>
          );
        })
      ) : (
        <span className="text-gray-400">Run portfolio channel exposure to see systematic risks</span>
      )}
    </div>
  );
}
