import { NextResponse } from 'next/server';
import { getAllTickers } from '../../lib/firebaseService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const getAllTickersParam = searchParams.get('getAllTickers');
  
  try {
    // Fetch all tickers (this is the only implemented functionality for now)
    const tickers = await getAllTickers();
    return NextResponse.json({ 
      success: true, 
      data: tickers,
      count: tickers.length 
    });
    
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }, 
      { status: 500 }
    );
  }
}