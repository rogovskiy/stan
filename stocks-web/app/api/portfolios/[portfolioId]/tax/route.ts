import { NextResponse } from 'next/server';
import { getPortfolio, getTransactions, getSnapshotsUpToDate } from '../../../../lib/services/portfolioService';
import {
  computeYtdRealizedGainsByTicker,
  computeYtdDividendIncome,
  estimateTaxDue,
  TAX_RATES,
} from '../../../../lib/taxEstimator';

export interface GainsByTickerEntry {
  realizedGain: number;
  shortTermGain: number;
  longTermGain: number;
  termType: 'short-term' | 'long-term' | 'mixed';
  taxOnGains: number;
}

export interface TaxSummaryResponse {
  taxable: boolean;
  year?: number;
  /** Earliest transaction year in the portfolio (for year dropdown). */
  firstTransactionYear?: number;
  message?: string;
  realizedGainsYtd?: number;
  dividendIncomeYtd?: number;
  taxOnGains?: number;
  taxOnDividends?: number;
  estimatedTaxDue?: number;
  /** Per-ticker breakdown of realized gains and tax on gains. */
  gainsByTicker?: Record<string, GainsByTickerEntry>;
  disclaimer?: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    if (!portfolioId) {
      return NextResponse.json(
        { success: false, error: 'Portfolio ID is required' },
        { status: 400 }
      );
    }

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json(
        { success: false, error: 'Portfolio not found' },
        { status: 404 }
      );
    }

    const accountType = portfolio.accountType ?? 'taxable';
    if (accountType !== 'taxable') {
      return NextResponse.json({
        success: true,
        data: {
          taxable: false,
          message: 'IRA – no taxable events',
        } as TaxSummaryResponse,
      });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const currentYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    if (!Number.isFinite(currentYear) || currentYear < 2000 || currentYear > 2100) {
      return NextResponse.json(
        { success: false, error: 'Invalid year' },
        { status: 400 }
      );
    }
    const dateMax = `${currentYear}-12-31`;
    const [transactions, snapshots] = await Promise.all([
      getTransactions(portfolioId, null),
      getSnapshotsUpToDate(portfolioId, dateMax),
    ]);
    const snapshotsAsc = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

    const {
      total: realizedGainsYtd,
      totalShortTerm,
      totalLongTerm,
      byTicker: gainsByTicker,
    } = computeYtdRealizedGainsByTicker(
      transactions,
      snapshotsAsc,
      currentYear,
      TAX_RATES
    );
    const dividendIncomeYtd = computeYtdDividendIncome(
      transactions,
      currentYear
    );
    const { taxOnGains, taxOnDividends, estimatedTaxDue } = estimateTaxDue(
      realizedGainsYtd,
      dividendIncomeYtd,
      TAX_RATES,
      totalShortTerm,
      totalLongTerm
    );

    const firstTransactionYear =
      transactions.length > 0
        ? Math.min(...transactions.map((tx) => new Date(tx.date).getFullYear()))
        : currentYear;

    const data: TaxSummaryResponse = {
      taxable: true,
      year: currentYear,
      firstTransactionYear,
      realizedGainsYtd,
      dividendIncomeYtd,
      taxOnGains,
      taxOnDividends,
      estimatedTaxDue,
      gainsByTicker: Object.keys(gainsByTicker).length > 0 ? gainsByTicker : undefined,
      disclaimer:
        'Estimated federal tax only. Rates are placeholders (e.g. 24% on gains, 15% on qualified dividends). Verify with your CPA.',
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Tax summary error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to compute tax summary',
      },
      { status: 500 }
    );
  }
}
