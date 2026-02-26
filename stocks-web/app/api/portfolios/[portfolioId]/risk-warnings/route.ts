import { NextResponse } from 'next/server';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../../lib/firebase';

const MARKET_SHIFTS_PATH = ['macro', 'us_market', 'market_shifts'] as const;

// Threshold: momentumScore must exceed this to be considered "significant"
const MOMENTUM_SCORE_THRESHOLD = 10;

// Threshold: |beta| * r² must exceed this for a channel to be "material exposure"
const EXPOSURE_THRESHOLD = 0.001;

const CHANNEL_LABELS: Record<string, string> = {
  EQUITIES_US: 'US equities',
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

export interface RiskWarningShift {
  id: string;
  headline: string;
  summary: string;
  momentumScore: number;
  momentumLabel: string;
  firstSeenAt?: string;
}

export interface RiskWarning {
  channelId: string;
  channelLabel: string;
  /** |beta| * r² — how material the portfolio's exposure is */
  reliableImpact: number;
  exposureLevel: 'HIGH' | 'MED' | 'LOW-MED' | 'LOW';
  shifts: RiskWarningShift[];
}

export interface RiskWarningsResponse {
  warnings: RiskWarning[];
}

function computeMomentumLabel(score: number, prev: number): string {
  const delta = score - prev;
  if (score < 5) return 'Just surfaced';
  if (prev > 10 && delta < -3) return 'Fading — was strong';
  if (score > 15) {
    return delta > 1 ? 'Accelerating' : 'Entrenched';
  }
  return delta >= 0 ? 'Picking up steam' : 'Fading';
}

function exposureLevel(reliableImpact: number): 'HIGH' | 'MED' | 'LOW-MED' | 'LOW' {
  if (reliableImpact >= 0.03) return 'HIGH';
  if (reliableImpact >= 0.005) return 'MED';
  if (reliableImpact >= 0.001) return 'LOW-MED';
  return 'LOW';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;

    const portfolioRef = doc(db, 'portfolios', portfolioId);
    const shiftsRef = collection(db, MARKET_SHIFTS_PATH[0], MARKET_SHIFTS_PATH[1], MARKET_SHIFTS_PATH[2]);

    const [portfolioSnap, shiftsSnap] = await Promise.all([
      getDoc(portfolioRef),
      getDocs(shiftsRef),
    ]);

    if (!portfolioSnap.exists()) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    const portfolioData = portfolioSnap.data();
    const channelExposures: Record<string, { beta: number; rSquared: number }> =
      portfolioData.channelExposures?.channels ?? {};

    // Collect channels with material exposure
    const materialChannels: { channelId: string; reliableImpact: number }[] = [];
    for (const [channelId, exp] of Object.entries(channelExposures)) {
      const reliableImpact = Math.abs(exp.beta) * (exp.rSquared ?? 0);
      if (reliableImpact >= EXPOSURE_THRESHOLD) {
        materialChannels.push({ channelId, reliableImpact });
      }
    }

    if (materialChannels.length === 0) {
      return NextResponse.json<RiskWarningsResponse>({ warnings: [] });
    }

    // Collect significant RISK shifts
    const significantShifts: (RiskWarningShift & { channelIds: string[] })[] = [];
    for (const d of shiftsSnap.docs) {
      const data = d.data();
      if (data.type !== 'RISK') continue;
      const score: number = typeof data.momentumScore === 'number' ? data.momentumScore : 0;
      if (score < MOMENTUM_SCORE_THRESHOLD) continue;
      const prev: number = typeof data.momentumScorePrev === 'number' ? data.momentumScorePrev : 0;
      significantShifts.push({
        id: d.id,
        headline: data.headline ?? '',
        summary: data.summary ?? '',
        momentumScore: score,
        momentumLabel: computeMomentumLabel(score, prev),
        firstSeenAt: data.firstSeenAt,
        channelIds: Array.isArray(data.channelIds) ? data.channelIds : [],
      });
    }

    // Build warnings: for each material channel, find matching shifts
    const warnings: RiskWarning[] = [];
    for (const { channelId, reliableImpact } of materialChannels) {
      const matched = significantShifts
        .filter((s) => s.channelIds.includes(channelId))
        .sort((a, b) => b.momentumScore - a.momentumScore)
        .map(({ id, headline, summary, momentumScore, momentumLabel, firstSeenAt }) => ({
          id,
          headline,
          summary,
          momentumScore,
          momentumLabel,
          firstSeenAt,
        }));
      if (matched.length === 0) continue;
      warnings.push({
        channelId,
        channelLabel: CHANNEL_LABELS[channelId] ?? channelId,
        reliableImpact,
        exposureLevel: exposureLevel(reliableImpact),
        shifts: matched,
      });
    }

    // Sort warnings by exposure severity
    warnings.sort((a, b) => b.reliableImpact - a.reliableImpact);

    return NextResponse.json<RiskWarningsResponse>({ warnings });
  } catch (error) {
    console.error('Risk warnings API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch risk warnings' },
      { status: 500 }
    );
  }
}
