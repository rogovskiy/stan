import {
  detectBrokerProvider,
  parseTransactionsCsv,
  parseTransactionsCsvs,
} from '../lib/transactionImport';
import { parseFidelityTransactionsCsv } from '../lib/transactionImport/fidelityCsvParser';
import { parseSchwabTransactionsCsv } from '../lib/schwabCsvParser';
import { resolveRsuGrantPrices } from '../lib/transactionImport/fidelityRsu';
import { applyTransactionToLots, totalQuantityFromLots } from '../lib/taxEstimator';

const FIDELITY_HEADER =
  'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date';

const FIDELITY_EXTENDED_HEADER =
  'Run Date,Action,Symbol,Description,Type,Exchange Quantity,Exchange Currency,Currency,Price,Quantity,Exchange Rate,Commission,Fees,Accrued Interest,Amount,Cash Balance,Settlement Date';

const SCHWAB_HEADER = 'Date,Action,Symbol,Description,Quantity,Price,Amount';

describe('detectBrokerProvider', () => {
  it('detects Fidelity from header with UTF-8 BOM', () => {
    expect(detectBrokerProvider(`\uFEFF${FIDELITY_HEADER}\n`)).toBe('fidelity');
  });

  it('detects Fidelity extended export (Amount without $)', () => {
    expect(detectBrokerProvider(`${FIDELITY_EXTENDED_HEADER}\n`)).toBe('fidelity');
  });

  it('detects Schwab from header', () => {
    expect(detectBrokerProvider(`${SCHWAB_HEADER}\n`)).toBe('schwab');
  });

  it('returns null for unknown format', () => {
    expect(detectBrokerProvider('foo,bar,baz\n1,2,3')).toBeNull();
  });
});

describe('parseFidelityTransactionsCsv', () => {
  it('parses buy', () => {
    const csv = `${FIDELITY_HEADER}
01-15-2026,YOU BOUGHT JPMORGAN CHASE &CO. COM (JPM) (Cash),JPM,JPMORGAN CHASE &CO. COM,Cash,311.35,10,"","","",-3113.5,631.07,01-16-2026`;
    const { equity } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(1);
    expect(equity[0]).toMatchObject({
      type: 'buy',
      ticker: 'JPM',
      date: '2026-01-15',
      quantity: 10,
      amount: -3113.5,
    });
  });

  it('parses file with UTF-8 BOM via registry', () => {
    const csv = `\uFEFF${FIDELITY_HEADER}
06-25-2026,DIVIDEND RECEIVED META PLATFORMS INC CLASS A COMMON STOCK (META) (Cash),META,META,Cash,"",0,"","","",11.03,1218.33,""`;
    const { provider, result } = parseTransactionsCsv(csv);
    expect(provider).toBe('fidelity');
    expect(result.equity).toHaveLength(1);
    expect(result.equity[0].amount).toBe(11.03);
  });

  it('parses sell with negative quantity', () => {
    const csv = `${FIDELITY_HEADER}
09-25-2024,YOU SOLD ISHARES TR 20 YR TR BD ETF (TLT) (Cash),TLT,ISHARES TR 20 YR TR BD ETF,Cash,98.06,-100,"",0.28,"",9805.72,15767.75,09-26-2024`;
    const { equity } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(1);
    expect(equity[0]).toMatchObject({
      type: 'sell',
      ticker: 'TLT',
      date: '2024-09-25',
      quantity: -100,
      amount: 9805.72,
      notes: 'Fees: $0.28',
    });
  });

  it('parses dividend', () => {
    const csv = `${FIDELITY_HEADER}
06-25-2026,DIVIDEND RECEIVED META PLATFORMS INC CLASS A COMMON STOCK (META) (Cash),META,META PLATFORMS INC CLASS A COMMON STOCK,Cash,"",0,"","","",11.03,1218.33,""`;
    const { equity } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(1);
    expect(equity[0]).toMatchObject({
      type: 'dividend',
      ticker: 'META',
      date: '2026-06-25',
      quantity: 0,
      amount: 11.03,
    });
  });

  it('maps SPAXX dividend to cash and skips reinvestment', () => {
    const csv = `${FIDELITY_HEADER}
06-30-2026,REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash),SPAXX,FIDELITY GOVERNMENT MONEY MARKET,Cash,1,3.06,"","","",-3.06,1221.39,""
06-30-2026,DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash),SPAXX,FIDELITY GOVERNMENT MONEY MARKET,Cash,"",0,"","","",3.06,1221.39,""`;
    const { equity, cash } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(0);
    expect(cash).toHaveLength(2);
    expect(cash.map((c) => c.amount).sort((a, b) => a - b)).toEqual([-3.06, 3.06]);
    expect(cash.every((c) => c.type === 'cash' && c.ticker == null)).toBe(true);
  });

  it('parses rollover as cash', () => {
    const csv = `${FIDELITY_HEADER}
04-29-2024,ROLLOVER CASH DIRECT ROLLOVER FROM FIRSCO PLAN 55927 NEW RELIC, INC. as of 2024-04-26 (Cash),,No Description,Cash,"",0,"","","",49388.4,49388.4,""`;
    const { cash } = parseFidelityTransactionsCsv(csv);
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({
      type: 'cash',
      ticker: null,
      date: '2024-04-29',
      amount: 49388.4,
    });
    expect(cash[0].notes).toContain('ROLLOVER CASH');
  });

  it('stops at footer disclaimer rows', () => {
    const csv = `${FIDELITY_HEADER}
06-30-2026,DIVIDEND RECEIVED META PLATFORMS INC CLASS A COMMON STOCK (META) (Cash),META,META,Cash,"",0,"","","",11.03,1218.33,""
"The data and information in this spreadsheet is provided to you solely for your use"
"Brokerage services are provided by Fidelity Brokerage Services LLC"`;
    const { equity, cash } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(1);
    expect(cash).toHaveLength(0);
  });

  it('parses extended Fidelity export with Amount column (no $)', () => {
    const csv = `${FIDELITY_EXTENDED_HEADER}
05-19-2026,YOU SOLD ORACLE CORP (ORCL) (Margin),ORCL,ORACLE CORP,Margin,0,,USD,182.6,-82,0,"",0.31,"",14972.89,15162.11,05-20-2026
06-18-2026,DIVIDEND RECEIVED NEOS ETF TRUST NASDAQ 100 HIGH (QQQI) (Margin),QQQI,NEOS ETF TRUST NASDAQ 100 HIGH,Margin,0,,USD,"",0,0,"","","",322.5,412.2,""`;
    const { provider, result } = parseTransactionsCsv(csv);
    expect(provider).toBe('fidelity');
    expect(result.equity).toHaveLength(2);
    expect(result.equity[0]).toMatchObject({
      type: 'sell',
      ticker: 'ORCL',
      date: '2026-05-19',
      quantity: -82,
      amount: 14972.89,
      notes: 'Fees: $0.31',
    });
    expect(result.equity[1]).toMatchObject({
      type: 'dividend',
      ticker: 'QQQI',
      amount: 322.5,
    });
  });

  it('parses RSU grant buy with blank price (no sell-to-cover yet)', () => {
    const csv = `${FIDELITY_EXTENDED_HEADER}
05-05-2025,YOU BOUGHT RSU#### ORACLE CORP (ORCL) (Cash),ORCL,ORACLE CORP,Cash,0,,USD,"",1533,0,"","","",0.00,24.01,05-06-2025`;
    const { equity } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(1);
    expect(equity[0]).toMatchObject({
      type: 'buy',
      ticker: 'ORCL',
      quantity: 1533,
      price: null,
      notes: 'RSU grant',
    });
    expect(equity[0].amount).toBe(0);
  });

  it('derives RSU vest FMV from sell-to-cover within a few days', () => {
    const csv = `${FIDELITY_EXTENDED_HEADER}
05-05-2025,YOU BOUGHT RSU#### ORACLE CORP (ORCL) (Cash),ORCL,ORACLE CORP,Cash,0,,USD,"",1533,0,"","","",0.00,24.01,05-06-2025
05-06-2025,YOU SOLD EXEC ON MULT EXCHG ORACLE CORP (ORCL) (Cash),ORCL,ORACLE CORP,Cash,0,,USD,147.81,-517,0,"","","",76419.77,24.01,05-07-2025`;
    const { equity } = parseFidelityTransactionsCsv(csv);
    const rsuBuy = equity.find((t) => t.type === 'buy' && t.notes?.startsWith('RSU grant'));
    expect(rsuBuy).toMatchObject({
      ticker: 'ORCL',
      quantity: 1533,
      price: 147.81,
      amount: 0,
    });
    expect(rsuBuy?.notes).toContain('vest FMV');
  });

  it('RSU grant at vest FMV creates sellable lots with correct cost basis', () => {
    const lots: { purchaseDate: string; quantity: number; costBasisPerShare: number }[] = [];
    applyTransactionToLots(lots, {
      type: 'buy',
      date: '2025-05-05',
      quantity: 1533,
      price: 147.81,
    });
    applyTransactionToLots(lots, {
      type: 'sell',
      date: '2025-05-06',
      quantity: -517,
      price: 147.81,
    });
    expect(totalQuantityFromLots(lots)).toBe(1016);
    expect(lots[0].costBasisPerShare).toBe(147.81);
  });

  it('resolveRsuGrantPrices matches sell-to-cover for legacy imports without RSU notes', () => {
    const txs = [
      {
        type: 'buy',
        ticker: 'ORCL',
        date: '2025-05-05',
        quantity: 1533,
        price: null,
        amount: 0,
        notes: '',
      },
      {
        type: 'sell',
        ticker: 'ORCL',
        date: '2025-05-06',
        quantity: -517,
        price: 147.81,
        amount: 76414.76,
        notes: 'Fees: $2.13',
      },
    ];
    resolveRsuGrantPrices(txs);
    expect(txs[0].price).toBe(147.81);
    expect(txs[0].notes).toContain('vest FMV');
  });

  it('resolveRsuGrantPrices matches sell-to-cover after vest', () => {
    const txs = [
      {
        type: 'buy',
        ticker: 'ORCL',
        date: '2025-05-05',
        quantity: 1533,
        price: null,
        amount: 0,
        notes: 'RSU grant',
      },
      {
        type: 'sell',
        ticker: 'ORCL',
        date: '2025-05-06',
        quantity: -517,
        price: 147.81,
        amount: 76419.77,
        notes: '',
      },
    ];
    resolveRsuGrantPrices(txs);
    expect(txs[0].price).toBe(147.81);
  });

  it('maps FCASH interest/reinvest pairs to cash (net zero)', () => {
    const csv = `${FIDELITY_EXTENDED_HEADER}
06-30-2026,REINVESTMENT CASH (315994103) (Cash),FCASH,CASH,Cash,0,,USD,1,0.13,0,"","","",-0.13,89.83,""
06-30-2026,INTEREST EARNED CASH (315994103) (Cash),FCASH,CASH,Cash,0,,USD,"",0,0,"","","",0.13,89.83,""`;
    const { equity, cash } = parseFidelityTransactionsCsv(csv);
    expect(equity).toHaveLength(0);
    expect(cash).toHaveLength(2);
    expect(cash.reduce((sum, c) => sum + c.amount, 0)).toBe(0);
    expect(cash.every((c) => c.type === 'cash' && c.ticker == null)).toBe(true);
  });
});

describe('parseSchwabTransactionsCsv', () => {
  it('parses buy and sell', () => {
    const csv = `${SCHWAB_HEADER}
01/15/2026,Buy,AAPL,APPLE INC,10,150,-1500
01/16/2026,Sell,AAPL,APPLE INC,5,160,800`;
    const { equity } = parseSchwabTransactionsCsv(csv);
    expect(equity).toHaveLength(2);
    expect(equity[0]).toMatchObject({ type: 'buy', ticker: 'AAPL', quantity: 10, amount: -1500 });
    expect(equity[1]).toMatchObject({ type: 'sell', ticker: 'AAPL', quantity: -5, amount: 800 });
  });

  it('parses dividend and reinvest shares', () => {
    const csv = `${SCHWAB_HEADER}
02/01/2026,Cash Dividend,MSFT,MICROSOFT,0,0,25
02/01/2026,Reinvest Shares,MSFT,MICROSOFT,0.5,500,-250`;
    const { equity } = parseSchwabTransactionsCsv(csv);
    expect(equity).toHaveLength(2);
    expect(equity[0]).toMatchObject({ type: 'dividend', ticker: 'MSFT', amount: 25 });
    expect(equity[1]).toMatchObject({ type: 'dividend_reinvest', ticker: 'MSFT', quantity: 0.5 });
  });

  it('parses non-equity as cash', () => {
    const csv = `${SCHWAB_HEADER}
03/01/2026,Wire Received,,WIRE,0,0,5000`;
    const { cash } = parseSchwabTransactionsCsv(csv);
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ type: 'cash', amount: 5000 });
  });
});

describe('parseTransactionsCsvs', () => {
  it('merges multiple files', () => {
    const fidelityCsv = `${FIDELITY_HEADER}
06-25-2026,DIVIDEND RECEIVED META PLATFORMS INC CLASS A COMMON STOCK (META) (Cash),META,META,Cash,"",0,"","","",11.03,1218.33,""`;
    const schwabCsv = `${SCHWAB_HEADER}
01/15/2026,Buy,GOOG,ALPHABET,1,100,-100`;

    const { results, merged } = parseTransactionsCsvs([fidelityCsv, schwabCsv]);
    expect(results).toHaveLength(2);
    expect(results[0].provider).toBe('fidelity');
    expect(results[1].provider).toBe('schwab');
    expect(merged.equity).toHaveLength(2);
  });
});

describe('parseTransactionsCsv', () => {
  it('throws for unrecognized format', () => {
    expect(() => parseTransactionsCsv('a,b,c\n1,2,3')).toThrow(/Unrecognized CSV format/);
  });
});
