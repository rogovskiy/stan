import { NextRequest, NextResponse } from 'next/server';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

export interface IRUrl {
  id: string;
  url: string;
  last_scanned: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/ir-urls/[ticker]
 * Get all IR URLs for a ticker
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    
    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    const tickerUpper = ticker.toUpperCase();
    const irUrlsRef = collection(db, 'tickers', tickerUpper, 'ir_urls');
    const snapshot = await getDocs(irUrlsRef);
    
    const urls: IRUrl[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      urls.push({
        id: doc.id,
        url: data.url,
        last_scanned: data.last_scanned || null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
    });

    // Sort by created_at descending (most recent first)
    urls.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({ urls });
  } catch (error: any) {
    console.error('Error fetching IR URLs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch IR URLs', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ir-urls/[ticker]
 * Add a new IR URL for a ticker
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const body = await request.json();
    const { url } = body;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    const tickerUpper = ticker.toUpperCase();
    const now = new Date().toISOString();

    // Create document ID from URL hash to avoid duplicates
    const crypto = require('crypto');
    const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);

    const irUrlRef = doc(db, 'tickers', tickerUpper, 'ir_urls', urlHash);
    
    // Check if URL already exists
    const existingDoc = await getDocs(
      query(collection(db, 'tickers', tickerUpper, 'ir_urls'), where('url', '==', url))
    );

    if (!existingDoc.empty) {
      // URL already exists, return existing
      const existing = existingDoc.docs[0];
      return NextResponse.json({
        id: existing.id,
        url: existing.data().url,
        last_scanned: existing.data().last_scanned || null,
        created_at: existing.data().created_at,
        updated_at: existing.data().updated_at,
      });
    }

    // Create new URL
    const urlData = {
      url,
      created_at: now,
      updated_at: now,
      last_scanned: null,
    };

    await setDoc(irUrlRef, urlData);

    return NextResponse.json({
      id: urlHash,
      ...urlData,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding IR URL:', error);
    return NextResponse.json(
      { error: 'Failed to add IR URL', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ir-urls/[ticker]?id={urlId}
 * Delete an IR URL for a ticker
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const urlId = searchParams.get('id');

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    if (!urlId) {
      return NextResponse.json(
        { error: 'URL ID is required' },
        { status: 400 }
      );
    }

    const tickerUpper = ticker.toUpperCase();
    const irUrlRef = doc(db, 'tickers', tickerUpper, 'ir_urls', urlId);
    await deleteDoc(irUrlRef);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting IR URL:', error);
    return NextResponse.json(
      { error: 'Failed to delete IR URL', details: error.message },
      { status: 500 }
    );
  }
}
