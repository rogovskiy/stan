import { NextResponse } from 'next/server';
import { getVideos } from '@/app/lib/services/youtubeSubscriptionService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? undefined;
    const limitParam = searchParams.get('limit');
    const limitCount = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 500;

    const videos = await getVideos(userId || undefined, limitCount);

    return NextResponse.json({
      success: true,
      data: videos,
      count: videos.length,
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
