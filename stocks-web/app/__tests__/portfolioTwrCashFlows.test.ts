import { buildTwrCashFlowByDate } from '../lib/portfolioTwrCashFlows';

describe('buildTwrCashFlowByDate', () => {
  it('includes cash transactions and RSU vest FMV as contributions', () => {
    const flows = buildTwrCashFlowByDate([
      {
        type: 'buy',
        date: '2025-05-05',
        ticker: 'ORCL',
        quantity: 1533,
        price: null,
        amount: 0,
        notes: 'RSU grant',
      },
      {
        type: 'sell',
        date: '2025-05-06',
        ticker: 'ORCL',
        quantity: -517,
        price: 147.81,
        amount: 76414.76,
        notes: '',
      },
      {
        type: 'cash',
        date: '2025-05-07',
        ticker: null,
        quantity: 0,
        price: null,
        amount: -76325.26,
        notes: 'JOURNALED RSU FEDERAL',
      },
    ]);

    expect(flows['2025-05-05']).toBeCloseTo(1533 * 147.81, 2);
    expect(flows['2025-05-07']).toBeCloseTo(-76325.26, 2);
    expect(flows['2025-05-06']).toBeUndefined();
  });
});
