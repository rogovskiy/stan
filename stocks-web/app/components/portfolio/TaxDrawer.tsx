import type { Portfolio } from '../../lib/services/portfolioService';
import type { TaxImpactResult, TaxSummary } from './types';

export default function TaxDrawer({
  open,
  onClose,
  taxDrawerYear,
  setTaxDrawerYear,
  onYearChange,
  taxDrawerLoading,
  taxDrawerSummary,
  taxSummary,
  selectedPortfolio,
  taxImpactTicker,
  setTaxImpactTicker,
  taxImpactShares,
  setTaxImpactShares,
  taxImpactPrice,
  setTaxImpactPrice,
  taxImpactLotsLoading,
  taxImpactResult,
}: {
  open: boolean;
  onClose: () => void;
  taxDrawerYear: number;
  setTaxDrawerYear: (y: number) => void;
  onYearChange: (year: number) => void;
  taxDrawerLoading: boolean;
  taxDrawerSummary: TaxSummary | null;
  taxSummary: TaxSummary | null;
  selectedPortfolio: Portfolio | null;
  taxImpactTicker: string;
  setTaxImpactTicker: (v: string) => void;
  taxImpactShares: string;
  setTaxImpactShares: (v: string) => void;
  taxImpactPrice: string;
  setTaxImpactPrice: (v: string) => void;
  taxImpactLotsLoading: boolean;
  taxImpactResult: TaxImpactResult | null;
}) {
  if (!open) return null;

  const currentYear = new Date().getFullYear();
  const firstYear =
    taxDrawerSummary?.firstTransactionYear ?? taxSummary?.firstTransactionYear ?? currentYear - 30;
  const minYear = Math.max(2000, firstYear);
  const years: number[] = [];
  for (let y = currentYear; y >= minYear; y--) years.push(y);

  const positions = selectedPortfolio?.positions ?? [];
  const openPositions = positions.filter((p) => (Number(p.quantity) || 0) > 0.0001);

  const onTickerSelect = (ticker: string) => {
    setTaxImpactTicker(ticker);
    const pos = positions.find((p) => p.ticker.toUpperCase() === ticker.toUpperCase());
    if (pos) setTaxImpactShares(String(pos.quantity));
  };

  return (
    <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
      <div className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Tax</h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900 p-1" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select
              value={taxDrawerYear}
              onChange={(e) => {
                const y = parseInt(e.target.value, 10);
                setTaxDrawerYear(y);
                onYearChange(y);
              }}
              className="w-full max-w-[8rem] text-sm border border-gray-300 rounded px-3 py-2 text-gray-900 bg-white"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {taxDrawerLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : taxDrawerSummary && !taxDrawerSummary.taxable ? (
            <p className="text-sm text-gray-600">{taxDrawerSummary.message ?? 'No taxable events'}</p>
          ) : taxDrawerSummary?.taxable ? (
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-900">
                Estimated taxes due ({taxDrawerSummary.year ?? taxDrawerYear}): $
                {(taxDrawerSummary.estimatedTaxDue ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <dl className="text-sm text-gray-600 space-y-1">
                <div className="flex justify-between gap-4">
                  <dt>Realized gains YTD</dt>
                  <dd>
                    $
                    {(taxDrawerSummary.realizedGainsYtd ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Dividend income YTD</dt>
                  <dd>
                    $
                    {(taxDrawerSummary.dividendIncomeYtd ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Tax on gains</dt>
                  <dd>
                    $
                    {(taxDrawerSummary.taxOnGains ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </dd>
                </div>
                {taxDrawerSummary.gainsByTicker && Object.keys(taxDrawerSummary.gainsByTicker).length > 0 && (
                  <div className="pl-2 border-l-2 border-gray-200 mt-2 space-y-1.5">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">By ticker</span>
                    {Object.entries(taxDrawerSummary.gainsByTicker)
                      .sort(([, a], [, b]) => (b.taxOnGains ?? 0) - (a.taxOnGains ?? 0))
                      .map(([ticker, { realizedGain, taxOnGains, termType }]) => (
                        <div key={ticker} className="flex justify-between gap-4 text-xs">
                          <dt className="font-medium text-gray-700">
                            {ticker}
                            <span className="ml-1.5 text-gray-500 font-normal normal-case">
                              ({termType?.replace(/-/g, ' ') ?? '—'})
                            </span>
                          </dt>
                          <dd className="text-right">
                            <span className="text-gray-600">
                              $
                              {(realizedGain ?? 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              gain
                            </span>
                            <span className="mx-1.5 text-gray-400">→</span>
                            <span className="font-medium">
                              $
                              {(taxOnGains ?? 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              tax
                            </span>
                          </dd>
                        </div>
                      ))}
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt>Tax on dividends</dt>
                  <dd>
                    $
                    {(taxDrawerSummary.taxOnDividends ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </dd>
                </div>
              </dl>
              {taxDrawerSummary.disclaimer && (
                <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">{taxDrawerSummary.disclaimer}</p>
              )}
              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-800 mb-2">Tax impact of potential actions</h4>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Position</span>
                    <select
                      value={taxImpactTicker}
                      onChange={(e) => onTickerSelect(e.target.value)}
                      className="text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900 min-w-[6rem]"
                    >
                      <option value="">Select…</option>
                      {openPositions.map((p) => (
                        <option key={p.ticker} value={p.ticker}>
                          {p.ticker}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Shares</span>
                    <input
                      type="number"
                      min={1}
                      max={
                        positions.find((p) => p.ticker.toUpperCase() === taxImpactTicker.toUpperCase())
                          ?.quantity ?? 0
                      }
                      value={taxImpactShares}
                      onChange={(e) => setTaxImpactShares(e.target.value)}
                      className="w-24 text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Price (optional)</span>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      placeholder="Current"
                      value={taxImpactPrice}
                      onChange={(e) => setTaxImpactPrice(e.target.value)}
                      className="w-24 text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                    />
                  </label>
                </div>
                {taxImpactLotsLoading && taxImpactTicker && (
                  <p className="mt-2 text-xs text-gray-500">Loading lots…</p>
                )}
                {taxImpactResult && !taxImpactLotsLoading && (
                  <div className="mt-3 text-sm text-gray-700 space-y-1">
                    <p className="font-medium">
                      Estimated gain: $
                      {taxImpactResult.gain.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    {taxImpactResult.useLots &&
                    (taxImpactResult.shortTermGain !== 0 || taxImpactResult.longTermGain !== 0) ? (
                      <>
                        {taxImpactResult.shortTermGain !== 0 && (
                          <p className="text-gray-600">
                            Short-term gain: $
                            {taxImpactResult.shortTermGain.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        )}
                        {taxImpactResult.longTermGain !== 0 && (
                          <p className="text-gray-600">
                            Long-term gain: $
                            {taxImpactResult.longTermGain.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        )}
                        {taxImpactResult.breakdown && taxImpactResult.breakdown.length > 1 && (
                          <details className="mt-1">
                            <summary className="text-xs text-gray-500 cursor-pointer">By lot (FIFO)</summary>
                            <ul className="mt-1 text-xs text-gray-600 list-disc list-inside space-y-0.5">
                              {taxImpactResult.breakdown.map((chunk, i) => (
                                <li key={i}>
                                  {chunk.quantity} sh @ {chunk.purchaseDate} → ${chunk.gain.toFixed(2)}{' '}
                                  {chunk.longTerm ? 'LT' : 'ST'}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : null}
                    <p className="font-medium">
                      Estimated tax: $
                      {taxImpactResult.estimatedTax.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    {!taxImpactResult.useLots && (
                      <p className="text-xs text-gray-500">
                        Using average cost. Add buy/sell history for lot-level (FIFO) accuracy.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
