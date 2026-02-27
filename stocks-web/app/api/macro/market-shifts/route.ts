import { NextResponse } from 'next/server';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const MARKET_SHIFTS_PATH = ['macro', 'us_market', 'market_shifts'] as const;
const META_PATH = ['macro', 'us_market', 'market_shifts_meta'] as const;

/** Shifts with momentumScore below this are considered inactive and are not returned (hidden from UI). */
const MOMENTUM_ACTIVE_THRESHOLD = 2;

export interface ArticleRef {
  url?: string;
  title?: string;
  source?: string;
  publishedAt?: string;
}

export interface MajorDevelopment {
  date: string;
  description: string;
  articleRef?: {
    url?: string;
    title?: string;
    source?: string;
    publishedAt?: string;
  };
}

export interface MarketShiftTimeline {
  firstSurfacedAt: string;
  majorDevelopments: MajorDevelopment[];
}

export type MomentumLabel =
  | 'Just surfaced'
  | 'Picking up steam'
  | 'Accelerating'
  | 'Entrenched'
  | 'Fading'
  | 'Fading — was strong';

export interface MarketShift {
  id: string;
  type: string;
  category: string;
  headline: string;
  summary: string;
  channelIds: string[];
  articleRefs: ArticleRef[];
  asOf?: string;
  fetchedAt?: string;
  timeline?: MarketShiftTimeline;
  analyzedAt?: string;
  momentumScore: number;
  momentumScorePrev: number;
  momentumUpdatedAt?: string;
  firstSeenAt?: string;
  momentumLabel: MomentumLabel;
}

export interface MarketShiftsMeta {
  asOf?: string;
  fetchedAt?: string;
  count?: number;
}

export interface MarketShiftsResponse {
  shifts: MarketShift[];
  meta: MarketShiftsMeta | null;
}

function computeMomentumLabel(score: number, prev: number): MomentumLabel {
  const delta = score - prev;
  if (score < 5) return 'Just surfaced';
  if (prev > 10 && delta < -3) return 'Fading — was strong';
  if (score > 15) {
    return delta > 1 ? 'Accelerating' : 'Entrenched';
  }
  return delta >= 0 ? 'Picking up steam' : 'Fading';
}

export async function GET() {
  try {
    const shiftsRef = collection(
      db,
      MARKET_SHIFTS_PATH[0],
      MARKET_SHIFTS_PATH[1],
      MARKET_SHIFTS_PATH[2]
    );
    const metaRef = doc(
      db,
      META_PATH[0],
      META_PATH[1],
      META_PATH[2],
      'latest'
    );

    const [shiftsSnap, metaSnap] = await Promise.all([
      getDocs(shiftsRef),
      getDoc(metaRef),
    ]);

    const shifts: MarketShift[] = shiftsSnap.docs.map((d) => {
      const data = d.data();
      const momentumScore: number = typeof data.momentumScore === 'number' ? data.momentumScore : 0;
      const momentumScorePrev: number = typeof data.momentumScorePrev === 'number' ? data.momentumScorePrev : 0;
      return {
        id: d.id,
        type: data.type ?? 'RISK',
        category: data.category ?? 'OTHER',
        headline: data.headline ?? '',
        summary: data.summary ?? '',
        channelIds: Array.isArray(data.channelIds) ? data.channelIds : [],
        articleRefs: Array.isArray(data.articleRefs) ? data.articleRefs : [],
        asOf: data.asOf,
        fetchedAt: data.fetchedAt,
        timeline: data.timeline,
        analyzedAt: data.analyzedAt,
        momentumScore,
        momentumScorePrev,
        momentumUpdatedAt: data.momentumUpdatedAt,
        firstSeenAt: data.firstSeenAt,
        momentumLabel: computeMomentumLabel(momentumScore, momentumScorePrev),
      };
    });

    // Exclude inactive shifts (score below threshold); do not display in UI
    const activeShifts = shifts.filter((s) => s.momentumScore >= MOMENTUM_ACTIVE_THRESHOLD);

    // Sort highest momentum first within each type
    activeShifts.sort((a, b) => b.momentumScore - a.momentumScore);

    const meta: MarketShiftsMeta | null = metaSnap.exists()
      ? (metaSnap.data() as MarketShiftsMeta)
      : null;

    const response: MarketShiftsResponse = { shifts: activeShifts, meta };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Market shifts API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch market shifts',
      },
      { status: 500 }
    );
  }
}
