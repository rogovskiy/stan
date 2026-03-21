import type { ChannelExposures } from '../../lib/services/portfolioService';

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

export default function SystematicRisksStrip({
  channelExposures,
}: {
  channelExposures?: ChannelExposures;
}) {
  const channels = channelExposures?.channels;
  const systematicRisks: { label: string; level: 'HIGH' | 'MED' | 'LOW-MED' | 'LOW' }[] = channels
    ? Object.entries(channels)
        .map(([ch, exp]) => {
          const absBeta = Math.abs(exp.beta);
          const r2 = exp.rSquared ?? 0;
          const reliableImpact = absBeta * r2;
          const level: 'HIGH' | 'MED' | 'LOW-MED' | 'LOW' =
            reliableImpact >= 0.03
              ? 'HIGH'
              : reliableImpact >= 0.005
                ? 'MED'
                : reliableImpact >= 0.001
                  ? 'LOW-MED'
                  : 'LOW';
          return {
            label: CHANNEL_LABELS[ch] ?? ch,
            reliableImpact,
            level,
          };
        })
        .sort((a, b) => b.reliableImpact - a.reliableImpact)
        .slice(0, 5)
        .map(({ label, level }) => ({ label, level }))
    : [];

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
      <span className="font-medium text-gray-400">Systematic risks:</span>
      {systematicRisks.length > 0 ? (
        systematicRisks.map(({ label, level }) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            {label} <RiskBars level={level} />
          </span>
        ))
      ) : (
        <span className="text-gray-400">Run portfolio channel exposure to see systematic risks</span>
      )}
    </div>
  );
}
