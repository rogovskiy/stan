import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';
import { getAdminStorageBucket } from '../../lib/firebase-admin';
import {
  computeAtmBandFromRows,
  parseOptionsSnapshotCsv,
} from '../../lib/optionsProxyBand';

function storagePrefixForProxy(proxy: string): string {
  return `option_data/${proxy.trim().toUpperCase()}/`;
}

/**
 * GET /api/options-proxy-band?proxy=SPY&asOf=2025-03-10
 * Loads option_data/{PROXY}/{asOf}.csv.gz from Firebase Storage, or latest under prefix if missing.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const proxy = searchParams.get('proxy');
  const asOf = searchParams.get('asOf');

  if (!proxy?.trim()) {
    return NextResponse.json({ error: 'query parameter proxy is required' }, { status: 400 });
  }

  const tickerKey = proxy.trim().toUpperCase();
  const prefix = storagePrefixForProxy(tickerKey);

  try {
    const bucket = getAdminStorageBucket();

    let buffer: Buffer | null = null;
    let sourceAsOf: string | null = null;

    if (asOf?.trim()) {
      const path = `${prefix}${asOf.trim()}.csv.gz`;
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (exists) {
        const [data] = await file.download();
        buffer = data;
        sourceAsOf = asOf.trim();
      }
    }

    if (!buffer) {
      const [files] = await bucket.getFiles({ prefix });
      const gz = files.filter((f) => f.name.endsWith('.csv.gz'));
      gz.sort((a, b) => a.name.localeCompare(b.name));
      const latest = gz[gz.length - 1];
      if (!latest) {
        return NextResponse.json(
          { error: `No options snapshot under ${prefix}` },
          { status: 404 }
        );
      }
      const [data] = await latest.download();
      buffer = data;
      const m = latest.name.match(/(\d{4}-\d{2}-\d{2})\.csv\.gz$/);
      sourceAsOf = m ? m[1] : null;
    }

    const csvText = gunzipSync(buffer).toString('utf8');
    const rows = parseOptionsSnapshotCsv(csvText);
    const band = computeAtmBandFromRows(rows);
    if (!band) {
      return NextResponse.json(
        { error: 'Could not compute ATM band from snapshot (missing IV or empty chain)' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ...band,
      sourceAsOf,
      proxyTicker: tickerKey,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('Firebase Admin')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    console.error('options-proxy-band:', e);
    return NextResponse.json({ error: 'Failed to load options snapshot', details: message }, { status: 500 });
  }
}
