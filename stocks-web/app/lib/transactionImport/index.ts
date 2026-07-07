import { fidelityCsvParser } from './fidelityCsvParser';
import { schwabCsvParser } from '../schwabCsvParser';
import type { BrokerCsvParser, BrokerProvider, ParseResult } from './types';
import { stripBom } from './csvUtils';

export type { BrokerProvider, ParseResult, TransactionPayload } from './types';

const PARSERS: BrokerCsvParser[] = [fidelityCsvParser, schwabCsvParser];

export function detectBrokerProvider(csvText: string): BrokerProvider | null {
  const normalized = stripBom(csvText);
  for (const parser of PARSERS) {
    if (parser.detect(normalized)) return parser.id;
  }
  return null;
}

export function parseTransactionsCsv(csvText: string): { provider: BrokerProvider; result: ParseResult } {
  const normalized = stripBom(csvText);
  const provider = detectBrokerProvider(normalized);
  if (!provider) {
    throw new Error('Unrecognized CSV format. Supported: Schwab, Fidelity.');
  }
  const parser = PARSERS.find((p) => p.id === provider)!;
  return { provider, result: parser.parse(normalized) };
}

export function parseTransactionsCsvs(csvTexts: string[]): {
  results: Array<{ provider: BrokerProvider; result: ParseResult }>;
  merged: ParseResult;
} {
  const results = csvTexts.map((csv) => parseTransactionsCsv(csv));
  const merged: ParseResult = { equity: [], cash: [] };
  for (const { result } of results) {
    merged.equity.push(...result.equity);
    merged.cash.push(...result.cash);
  }
  return { results, merged };
}
