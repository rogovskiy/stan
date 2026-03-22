import { NextResponse } from 'next/server';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../lib/firebase';
import type {
  MarketShift,
  MarketShiftTimeline,
  MomentumLabel,
} from '../route';
import { computeMomentumLabel } from '../route';

const MARKET_SHIFTS_PATH = ['macro', 'us_market', 'market_shifts'] as const;

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(s: string): boolean {
  if (!YYYY_MM_DD.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function docToShift(docId: string, data: Record<string, unknown>): MarketShift {
  const momentumScore: number =
    typeof data.momentumScore === 'number' ? data.momentumScore : 0;
  const momentumScorePrev: number =
    typeof data.momentumScorePrev === 'number' ? data.momentumScorePrev : 0;
  const primary: string | null =
    typeof data.primaryChannel === 'string' ? data.primaryChannel : null;
  const secondary: string[] = Array.isArray(data.secondaryChannels)
    ? (data.secondaryChannels as string[])
    : [];
  const channelIds =
    primary != null || secondary.length > 0
      ? [...(primary ? [primary] : []), ...secondary]
      : Array.isArray(data.channelIds)
        ? (data.channelIds as string[])
        : [];
  return {
    id: docId,
    type: (data.type as string) ?? 'RISK',
    category: (data.category as string) ?? 'OTHER',
    headline: (data.headline as string) ?? '',
    summary: (data.summary as string) ?? '',
    primaryChannel: primary ?? undefined,
    secondaryChannels: secondary.length ? secondary : undefined,
    channelIds,
    articleRefs: Array.isArray(data.articleRefs) ? data.articleRefs : [],
    asOf: data.asOf as string | undefined,
    fetchedAt: data.fetchedAt as string | undefined,
    timeline: data.timeline as MarketShiftTimeline | undefined,
    analyzedAt: data.analyzedAt as string | undefined,
    momentumScore,
    momentumScorePrev,
    momentumUpdatedAt: data.momentumUpdatedAt as string | undefined,
    firstSeenAt: data.firstSeenAt as string | undefined,
    momentumLabel: computeMomentumLabel(
      momentumScore,
      momentumScorePrev
    ) as MomentumLabel,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Missing shift id' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const firstSurfacedAt =
      typeof body?.firstSurfacedAt === 'string'
        ? body.firstSurfacedAt.trim()
        : '';
    if (!firstSurfacedAt || !isValidISODate(firstSurfacedAt)) {
      return NextResponse.json(
        { error: 'Invalid or missing firstSurfacedAt (expected YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const shiftRef = doc(
      db,
      MARKET_SHIFTS_PATH[0],
      MARKET_SHIFTS_PATH[1],
      MARKET_SHIFTS_PATH[2],
      id
    );
    const snapshot = await getDoc(shiftRef);
    if (!snapshot.exists()) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    const data = snapshot.data();
    const existingTimeline = (data?.timeline ?? {}) as Record<string, unknown>;
    const mergedTimeline: MarketShiftTimeline = {
      ...existingTimeline,
      firstSurfacedAt,
      majorDevelopments:
        Array.isArray(existingTimeline.majorDevelopments) ?
          existingTimeline.majorDevelopments
        : [],
      canonicalDriver:
        (existingTimeline.canonicalDriver as string) ?? '',
      canonicalDriverRationale:
        (existingTimeline.canonicalDriverRationale as string) ?? '',
    };

    await updateDoc(shiftRef, { timeline: mergedTimeline });

    const updatedData = { ...data, timeline: mergedTimeline };
    const shift = docToShift(snapshot.id, updatedData);
    return NextResponse.json(shift);
  } catch (error) {
    console.error('Market shift PATCH error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update market shift',
      },
      { status: 500 }
    );
  }
}
