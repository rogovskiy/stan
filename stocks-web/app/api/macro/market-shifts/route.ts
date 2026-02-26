import { NextResponse } from 'next/server';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const MARKET_SHIFTS_PATH = ['macro', 'us_market', 'market_shifts'] as const;
const META_PATH = ['macro', 'us_market', 'market_shifts_meta'] as const;

export interface ArticleRef {
  url?: string;
  title?: string;
  source?: string;
  publishedAt?: string;
}

export interface MarketShift {
  id: string;
  type: string;
  category: string;
  headline: string;
  summary: string;
  channelIds: string[];
  status: string;
  articleRefs: ArticleRef[];
  asOf?: string;
  fetchedAt?: string;
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
      return {
        id: d.id,
        type: data.type ?? 'RISK',
        category: data.category ?? 'OTHER',
        headline: data.headline ?? '',
        summary: data.summary ?? '',
        channelIds: Array.isArray(data.channelIds) ? data.channelIds : [],
        status: data.status ?? 'EMERGING',
        articleRefs: Array.isArray(data.articleRefs) ? data.articleRefs : [],
        asOf: data.asOf,
        fetchedAt: data.fetchedAt,
      };
    });

    const meta: MarketShiftsMeta | null = metaSnap.exists()
      ? (metaSnap.data() as MarketShiftsMeta)
      : null;

    const response: MarketShiftsResponse = { shifts, meta };
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
