/**
 * Parse options snapshot CSV (plain text after gunzip) and compute ATM ~1y implied band.
 * Schema matches functions_yahoo/yahoo/refresh_options_data.py CSV_HEADER.
 */

export type OptionsSnapshotRow = {
  ticker: string;
  asOf: string;
  spot: number;
  riskFreeRate: number;
  expiry: string;
  tYears: number;
  type: 'call' | 'put';
  strike: number;
  iv: number | null;
};

/** Split one CSV line respecting quoted fields. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  result.push(cur);
  return result;
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseOptionsSnapshotCsv(csvText: string): OptionsSnapshotRow[] {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iTicker = idx('ticker');
  const iAsOf = idx('as_of');
  const iSpot = idx('spot');
  const iR = idx('risk_free_rate');
  const iExpiry = idx('expiry');
  const iTYears = idx('t_years');
  const iType = idx('type');
  const iStrike = idx('strike');
  const iIv = idx('iv');
  if (
    iTicker < 0 ||
    iAsOf < 0 ||
    iSpot < 0 ||
    iR < 0 ||
    iExpiry < 0 ||
    iTYears < 0 ||
    iType < 0 ||
    iStrike < 0 ||
    iIv < 0
  ) {
    return [];
  }

  const out: OptionsSnapshotRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    const typeRaw = (cells[iType] ?? '').trim().toLowerCase();
    if (typeRaw !== 'call' && typeRaw !== 'put') continue;

    const spot = parseNum(cells[iSpot] ?? '');
    const tYears = parseNum(cells[iTYears] ?? '');
    const strike = parseNum(cells[iStrike] ?? '');
    if (spot === null || tYears === null || strike === null) continue;

    const ivRaw = parseNum(cells[iIv] ?? '');

    out.push({
      ticker: (cells[iTicker] ?? '').trim(),
      asOf: (cells[iAsOf] ?? '').trim(),
      spot,
      riskFreeRate: parseNum(cells[iR] ?? '') ?? 0,
      expiry: (cells[iExpiry] ?? '').trim(),
      tYears,
      type: typeRaw as 'call' | 'put',
      strike,
      iv: ivRaw,
    });
  }
  return out;
}

function strikeNear(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) < 1e-5 * scale;
}

export type AtmBandResult = {
  proxyLowPct: number;
  proxyHighPct: number;
  atmIv: number;
  expiryUsed: string;
  tYearsUsed: number;
};

/**
 * Pick expiry with t_years closest to 1.0, ATM strike nearest spot, average call/put IV.
 */
export function computeAtmBandFromRows(rows: OptionsSnapshotRow[]): AtmBandResult | null {
  if (rows.length === 0) return null;

  const byExpiry = new Map<string, OptionsSnapshotRow[]>();
  for (const r of rows) {
    const list = byExpiry.get(r.expiry) ?? [];
    list.push(r);
    byExpiry.set(r.expiry, list);
  }

  let bestExpiry: string | null = null;
  let bestT = 0;
  let bestDist = Infinity;
  for (const [exp, erows] of byExpiry) {
    const t = erows[0]?.tYears;
    if (t === undefined || !Number.isFinite(t)) continue;
    const d = Math.abs(t - 1);
    if (d < bestDist) {
      bestDist = d;
      bestExpiry = exp;
      bestT = t;
    }
  }
  if (!bestExpiry) return null;

  const erows = byExpiry.get(bestExpiry)!;
  const spot = erows[0].spot;

  const strikes = [...new Set(erows.map((r) => r.strike))];
  let bestStrike = strikes[0];
  let bestSd = Math.abs(strikes[0] - spot);
  for (const s of strikes) {
    const d = Math.abs(s - spot);
    if (d < bestSd) {
      bestSd = d;
      bestStrike = s;
    }
  }

  const call = erows.find((r) => r.type === 'call' && strikeNear(r.strike, bestStrike));
  const put = erows.find((r) => r.type === 'put' && strikeNear(r.strike, bestStrike));
  const ivs: number[] = [];
  if (call?.iv != null && Number.isFinite(call.iv)) ivs.push(call.iv);
  if (put?.iv != null && Number.isFinite(put.iv)) ivs.push(put.iv);
  if (ivs.length === 0) return null;

  const atmIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  return {
    proxyLowPct: -atmIv * 100,
    proxyHighPct: atmIv * 100,
    atmIv,
    expiryUsed: bestExpiry,
    tYearsUsed: bestT,
  };
}
