import {
  computeAtmBandFromRows,
  parseCsvLine,
  parseOptionsSnapshotCsv,
  type OptionsSnapshotRow,
} from '../lib/optionsProxyBand';

describe('parseCsvLine', () => {
  it('splits simple commas', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('respects quotes', () => {
    expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });
});

describe('parseOptionsSnapshotCsv', () => {
  const header =
    'ticker,as_of,spot,risk_free_rate,expiry,t_years,type,contractSymbol,strike,lastPrice,bid,ask,iv,volume,openInterest,impliedVolatility';

  it('parses two rows and types', () => {
    const csv = `${header}
SPY,2025-01-10,480,0.05,2026-01-09,0.99726,call,X,480,10,9,11,0.18,100,1000,
SPY,2025-01-10,480,0.05,2026-01-09,0.99726,put,X,480,9,8,10,0.19,50,800,`;
    const rows = parseOptionsSnapshotCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('call');
    expect(rows[1].iv).toBeCloseTo(0.19);
  });
});

describe('computeAtmBandFromRows', () => {
  const base = {
    ticker: 'SPY',
    asOf: '2025-01-10',
    spot: 480,
    riskFreeRate: 0.05,
  };

  function row(
    expiry: string,
    tYears: number,
    type: 'call' | 'put',
    strike: number,
    iv: number | null
  ): OptionsSnapshotRow {
    return {
      ...base,
      expiry,
      tYears,
      type,
      strike,
      iv,
    };
  }

  it('returns symmetric band from ATM call+put IV', () => {
    const rows: OptionsSnapshotRow[] = [
      row('2026-01-09', 0.99, 'call', 480, 0.2),
      row('2026-01-09', 0.99, 'put', 480, 0.2),
    ];
    const band = computeAtmBandFromRows(rows);
    expect(band).not.toBeNull();
    expect(band!.atmIv).toBeCloseTo(0.2);
    expect(band!.proxyLowPct).toBeCloseTo(-20);
    expect(band!.proxyHighPct).toBeCloseTo(20);
  });

  it('picks expiry closest to 1y', () => {
    const rows: OptionsSnapshotRow[] = [
      row('near', 0.25, 'call', 480, 0.3),
      row('near', 0.25, 'put', 480, 0.3),
      row('far', 0.98, 'call', 480, 0.18),
      row('far', 0.98, 'put', 480, 0.22),
    ];
    const band = computeAtmBandFromRows(rows);
    expect(band!.tYearsUsed).toBeCloseTo(0.98);
    expect(band!.atmIv).toBeCloseTo(0.2);
  });

  it('returns null when no IV', () => {
    const rows: OptionsSnapshotRow[] = [
      row('2026-01-09', 0.99, 'call', 480, null),
      row('2026-01-09', 0.99, 'put', 480, null),
    ];
    expect(computeAtmBandFromRows(rows)).toBeNull();
  });
});
