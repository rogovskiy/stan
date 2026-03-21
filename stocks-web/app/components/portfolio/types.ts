export type ViewMode = 'portfolios' | 'watchlist';

export type TaxSummary = {
  taxable: boolean;
  year?: number;
  firstTransactionYear?: number;
  message?: string;
  realizedGainsYtd?: number;
  dividendIncomeYtd?: number;
  taxOnGains?: number;
  taxOnDividends?: number;
  estimatedTaxDue?: number;
  gainsByTicker?: Record<
    string,
    {
      realizedGain: number;
      shortTermGain: number;
      longTermGain: number;
      termType: 'short-term' | 'long-term' | 'mixed';
      taxOnGains: number;
    }
  >;
  disclaimer?: string;
};

export type TransactionFormType = 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash';

export type TaxImpactResult = {
  gain: number;
  estimatedTax: number;
  shortTermGain: number;
  longTermGain: number;
  breakdown: { quantity: number; purchaseDate: string; gain: number; longTerm: boolean }[];
  useLots: boolean;
};
