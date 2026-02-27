import { NextResponse } from 'next/server';
import { getSubscriptions, addSubscription } from '@/app/lib/services/youtubeSubscriptionService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? undefined;

    const subscriptions = await getSubscriptions(userId || undefined);

    return NextResponse.json({
      success: true,
      data: subscriptions,
      count: subscriptions.length,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, label, userId } = body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'URL is required',
        },
        { status: 400 }
      );
    }

    const id = await addSubscription({
      url: url.trim(),
      label: label ?? undefined,
      userId: userId ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        url: url.trim(),
        label: label ?? null,
        userId: userId ?? null,
      },
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
