export type TransactionPayload = {
  type: 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash';
  ticker: string | null;
  date: string; // YYYY-MM-DD
  quantity: number;
  price: number | null;
  amount: number;
  notes?: string;
};

export type ParseResult = {
  equity: TransactionPayload[];
  cash: TransactionPayload[];
};

export type BrokerProvider = 'schwab' | 'fidelity';

export interface BrokerCsvParser {
  id: BrokerProvider;
  detect(csvText: string): boolean;
  parse(csvText: string): ParseResult;
}
