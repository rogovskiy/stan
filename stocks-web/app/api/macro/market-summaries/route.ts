import { NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const SUMMARIES_PATH = ['macro', 'us_market', 'market_summaries'] as const;

export interface SummaryDriver {
  headline: string;
  detail: string;
}

export interface MarketSummary {
  mood: string;
  moodDetail: string;
  drivers: SummaryDriver[];
}

export interface MarketSummariesResponse {
  asOf: string | null;
  fetchedAt: string | null;
  yesterdayToday: MarketSummary | null;
  lastWeek: MarketSummary | null;
}

function parseSummary(raw: unknown): MarketSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.mood !== 'string' || !Array.isArray(obj.drivers)) return null;
  return {
    mood: obj.mood,
    moodDetail: typeof obj.moodDetail === 'string' ? obj.moodDetail : '',
    drivers: obj.drivers.map((d: Record<string, unknown>) => ({
      headline: typeof d?.headline === 'string' ? d.headline : '',
      detail: typeof d?.detail === 'string' ? d.detail : '',
    })),
  };
}

export async function GET() {
  try {
    const ref = doc(
      db,
      SUMMARIES_PATH[0],
      SUMMARIES_PATH[1],
      SUMMARIES_PATH[2],
      'latest'
    );
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const empty: MarketSummariesResponse = {
        asOf: null,
        fetchedAt: null,
        yesterdayToday: null,
        lastWeek: null,
      };
      return NextResponse.json(empty);
    }

    const data = snap.data();
    const response: MarketSummariesResponse = {
      asOf: data.asOf ?? null,
      fetchedAt: data.fetchedAt ?? null,
      yesterdayToday: parseSummary(data.yesterdayToday),
      lastWeek: parseSummary(data.lastWeek),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Market summaries API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch market summaries',
      },
      { status: 500 }
    );
  }
}
