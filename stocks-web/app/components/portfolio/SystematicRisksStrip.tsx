import { useEffect, useState } from 'react';
import type { ChannelExposure, ChannelExposures } from '../../lib/services/portfolioService';

/** Response from GET /api/options-proxy-band */
type OptionsProxyBandResponse = {
  proxyLowPct: number;
  proxyHighPct: number;
  atmIv: number;
  expiryUsed: string;
  tYearsUsed: number;
  sourceAsOf: string | null;
  proxyTicker: string;
};

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

/** From portfolio_channel_exposure sequential model: drop strip rows below this unique-variance share. */
const MIN_INCREMENTAL_R2_STRIP = 0.005;

/** Omit a channel from the strip when |β| is below this (portfolio % per +1% proxy). Same unit as tooltip. */
const MIN_ABS_BETA_STRIP_PCT = 0.1;

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

type RiskLevel = 'HIGH' | 'MED' | 'LOW-MED' | 'LOW';

/**
 * Risk bars from |β| only: portfolio % per +1% proxy move (same units as “Same-day sensitivity”).
 * We intentionally do not multiply by R² here — a high R² with small |β| is still a small mechanical sensitivity.
 */
function levelFromAbsBeta(absBeta: number): RiskLevel {
  if (!Number.isFinite(absBeta)) return 'LOW';
  if (absBeta >= 0.2) return 'HIGH';
  if (absBeta >= 0.1) return 'MED';
  if (absBeta >= 0.04) return 'LOW-MED';
  return 'LOW';
}

/** Sort by largest |β| first so order matches “same-day sensitivity,” not |β|×R². */
function sortKeyForExposure(exp: ChannelExposure): number {
  return Number.isFinite(exp.beta) ? Math.abs(exp.beta) : 0;
}

function formatR2Pct(r2: number): string {
  return r2 < 0.01 ? (r2 * 100).toFixed(1) : (r2 * 100).toFixed(0);
}

/** Facts only: fit (R²), sensitivity (β), optional options-implied band, holdings. */
function SystematicRiskTooltipBody({
  exposure,
  optionsBand,
  optionsBandLoading,
}: {
  exposure: ChannelExposure;
  optionsBand: OptionsProxyBandResponse | null | undefined;
  optionsBandLoading: boolean;
}) {
  const { beta, rSquared, proxy, contributors } = exposure;
  const contributorList = Array.isArray(contributors) ? contributors : [];
  const betaOk = Number.isFinite(beta);
  const r2ForDisplay =
    typeof rSquared === 'number' && Number.isFinite(rSquared) ? rSquared : null;
  const weakUnivariateFit = r2ForDisplay !== null && r2ForDisplay < 0.02;

  const impactAtProxyPct = (proxyPct: number) => beta * proxyPct;
  const showOptionsBand = betaOk && optionsBand != null;
  const bandLow = showOptionsBand ? impactAtProxyPct(optionsBand.proxyLowPct) : 0;
  const bandHigh = showOptionsBand ? impactAtProxyPct(optionsBand.proxyHighPct) : 0;

  const holdingsLine =
    contributorList.length > 0 ? (
      <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
        <span className="font-medium text-gray-900">Holdings driving this channel</span> (by |weight × β to{' '}
        {proxy}):{' '}
        {contributorList.slice(0, 6).map((c, i) => (
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
      {r2ForDisplay !== null ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-800">
          <span className="font-medium text-gray-900">Fit</span> (univariate, same window as β): R² ≈{' '}
          {formatR2Pct(r2ForDisplay)}% of day-to-day return variance with <strong>{proxy}</strong> alone.
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-gray-500">R² not available for this factor.</p>
      )}

      {!betaOk && (
        <p className="mt-2 text-[11px] text-gray-500">β could not be estimated.</p>
      )}

      {betaOk && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
          <span className="font-medium text-gray-900">Same-day sensitivity</span>: a <strong>+1%</strong> move in{' '}
          <strong>{proxy}</strong> lines up with about <strong>{beta.toFixed(2)}%</strong> in this portfolio on
          average (historical regression).
          {weakUnivariateFit && (
            <span className="text-gray-500">
              {' '}
              Low R² — treat this slope as indicative, not precise.
            </span>
          )}
        </p>
      )}

      {showOptionsBand && optionsBand && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-800">
          Based on ATM implied vol (~{optionsBand.tYearsUsed.toFixed(2)}y horizon) for <strong>{proxy}</strong>
          {optionsBand.sourceAsOf ? (
            <>
              {' '}
              as of <strong>{optionsBand.sourceAsOf}</strong>
            </>
          ) : null}
          , a symmetric ~1σ band for the proxy is roughly <strong>{optionsBand.proxyLowPct.toFixed(1)}%</strong>{' '}
          to <strong>+{optionsBand.proxyHighPct.toFixed(1)}%</strong>. With your β, return tied to this factor
          might roughly span <strong>{bandLow.toFixed(1)}%</strong> to <strong>{bandHigh.toFixed(1)}%</strong> (β ×
          those moves). Other drivers also move your portfolio.
        </p>
      )}
      {betaOk && !optionsBandLoading && optionsBand === null && (
        <p className="mt-2 text-[11px] text-gray-500">
          No options snapshot in storage for {proxy}, or IV could not be read.
        </p>
      )}

      {holdingsLine}
    </div>
  );
}

type SystematicRiskRow = {
  channelId: string;
  label: string;
  level: RiskLevel;
  reliableImpact: number;
  exposure: ChannelExposure;
};

function buildRows(channels: Record<string, ChannelExposure>): SystematicRiskRow[] {
  return Object.entries(channels)
    .map(([ch, exp]) => {
      const absBeta = Math.abs(exp.beta);
      const level = levelFromAbsBeta(absBeta);
      return {
        channelId: ch,
        label: CHANNEL_LABELS[ch] ?? ch,
        reliableImpact: absBeta,
        level,
        exposure: exp,
      };
    })
    .sort((a, b) => sortKeyForExposure(b.exposure) - sortKeyForExposure(a.exposure));
}

/**
 * When incrementalR2 is present (post channel-exposure job), hide factors that add little variance
 * after stronger factors in the sequential model — reduces SPY + near-duplicate rates/vol, etc.
 * Order stays |β| within the surviving set. Legacy payloads without incremental skip this.
 */
function applyStripFilter(rows: SystematicRiskRow[]): {
  shown: SystematicRiskRow[];
  removed: SystematicRiskRow[];
} {
  const anyIncremental = rows.some(
    (r) => typeof r.exposure.incrementalR2 === 'number' && Number.isFinite(r.exposure.incrementalR2),
  );
  if (!anyIncremental) return { shown: rows, removed: [] };

  const filtered = rows.filter((r) => {
    const inc = r.exposure.incrementalR2;
    if (typeof inc !== 'number' || !Number.isFinite(inc)) return true;
    return inc >= MIN_INCREMENTAL_R2_STRIP;
  });

  if (filtered.length === 0) return { shown: rows, removed: [] };

  const removed = rows.filter((r) => {
    const inc = r.exposure.incrementalR2;
    if (typeof inc !== 'number' || !Number.isFinite(inc)) return false;
    return inc < MIN_INCREMENTAL_R2_STRIP;
  });

  return { shown: filtered, removed };
}

/**
 * Drop channels with negligible same-day |β| from the strip. If none pass, show all (fallback).
 */
function filterStripByMinAbsBeta(rows: SystematicRiskRow[]): {
  shown: SystematicRiskRow[];
  removed: SystematicRiskRow[];
  usedFallback: boolean;
} {
  const passes = rows.filter(
    (r) => Number.isFinite(r.exposure.beta) && Math.abs(r.exposure.beta) >= MIN_ABS_BETA_STRIP_PCT,
  );
  const removed = rows.filter(
    (r) => !Number.isFinite(r.exposure.beta) || Math.abs(r.exposure.beta) < MIN_ABS_BETA_STRIP_PCT,
  );
  if (passes.length > 0) {
    return { shown: passes, removed, usedFallback: false };
  }
  return { shown: rows, removed: [], usedFallback: true };
}

export default function SystematicRisksStrip({
  channelExposures,
  channelExposureAsOf,
}: {
  channelExposures?: ChannelExposures;
  /** Prefer passing from portfolio; falls back to channelExposures.asOf */
  channelExposureAsOf?: string;
}) {
  const channels = channelExposures?.channels;
  const exposureAsOf = channelExposureAsOf ?? channelExposures?.asOf;
  const sortedRows = channels ? buildRows(channels) : [];
  const betaPass = channels ? filterStripByMinAbsBeta(sortedRows) : { shown: [], removed: [], usedFallback: true };
  const { shown: afterFilter, removed: removedByIncremental } = channels
    ? applyStripFilter(betaPass.shown)
    : { shown: [], removed: [] };
  const systematicRisks = afterFilter.slice(0, 5);

  const proxyKey = [...new Set(systematicRisks.map((r) => r.exposure.proxy))]
    .sort()
    .join('|');

  const [bandsByProxy, setBandsByProxy] = useState<Record<string, OptionsProxyBandResponse | null>>({});
  const [bandsLoading, setBandsLoading] = useState(false);

  useEffect(() => {
    if (!proxyKey) {
      setBandsByProxy({});
      setBandsLoading(false);
      return;
    }
    const proxies = proxyKey.split('|').filter(Boolean);
    let cancelled = false;
    setBandsLoading(true);
    (async () => {
      const results = await Promise.all(
        proxies.map(async (proxy) => {
          const params = new URLSearchParams({ proxy });
          if (typeof exposureAsOf === 'string' && exposureAsOf.trim()) {
            params.set('asOf', exposureAsOf.trim());
          }
          try {
            const res = await fetch(`/api/options-proxy-band?${params.toString()}`);
            if (!res.ok) return [proxy, null] as const;
            const json = (await res.json()) as OptionsProxyBandResponse;
            return [proxy, json] as const;
          } catch {
            return [proxy, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setBandsByProxy(Object.fromEntries(results));
      setBandsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [proxyKey, exposureAsOf]);

  const removedByBetaLabels = !betaPass.usedFallback
    ? betaPass.removed.map((r) => r.label).join(', ')
    : '';
  const removedIncrementalLabels = removedByIncremental.map((r) => r.label).join(', ');
  const showHiddenInfo =
    (!betaPass.usedFallback && betaPass.removed.length > 0) || removedByIncremental.length > 0;

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 overflow-visible">
      <span className="inline-flex items-center gap-1 font-medium text-gray-400">
        Systematic risks:
        {showHiddenInfo && (
          <span className="group relative inline-flex cursor-help">
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold leading-none text-gray-400"
              aria-label="About hidden factors"
            >
              i
            </span>
            <div
              className="pointer-events-none invisible absolute bottom-full left-0 z-[100] mb-1 max-h-[min(16rem,50vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2.5 text-left text-[11px] leading-snug text-gray-600 shadow-lg opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100"
              role="tooltip"
            >
              <p className="font-medium text-gray-800">Not shown in the strip</p>
              {!betaPass.usedFallback && betaPass.removed.length > 0 && (
                <p className="mt-1 text-gray-600">
                  <strong className="text-gray-800">|β| &lt; {MIN_ABS_BETA_STRIP_PCT}%</strong> (same-day
                  sensitivity too small): <strong className="text-gray-800">{removedByBetaLabels}</strong>.
                </p>
              )}
              {removedByIncremental.length > 0 && (
                <p className="mt-1 text-gray-600">
                  <strong className="text-gray-800">Low incremental R²</strong> (under{' '}
                  {(MIN_INCREMENTAL_R2_STRIP * 100).toFixed(1)}% after other factors):{' '}
                  <strong className="text-gray-800">{removedIncrementalLabels}</strong>.
                </p>
              )}
            </div>
          </span>
        )}
      </span>
      {systematicRisks.length > 0 ? (
        systematicRisks.map(({ channelId, label, level, exposure }) => {
          const optionsBand = bandsByProxy[exposure.proxy];
          return (
            <div
              key={channelId}
              className="group relative inline-flex cursor-help items-center gap-1.5 overflow-visible before:absolute before:left-0 before:top-full before:z-40 before:h-2 before:w-full before:content-['']"
            >
              <span className="inline-flex items-center gap-1.5">
                {label} <RiskBars level={level} />
              </span>
              <div
                className="pointer-events-none invisible absolute left-0 top-full z-[100] mt-1 max-h-[min(24rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100"
                role="tooltip"
              >
                <p className="font-semibold text-gray-900">{label}</p>
                <SystematicRiskTooltipBody
                  exposure={exposure}
                  optionsBand={optionsBand}
                  optionsBandLoading={bandsLoading}
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
