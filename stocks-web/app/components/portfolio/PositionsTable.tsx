'use client';

import { Fragment, type RefObject } from 'react';
import type { Portfolio, Position } from '../../lib/services/portfolioService';
import LiveThesisCardHoverTrigger from '../position-thesis/LiveThesisCardHoverTrigger';
import { buildPositionSections } from './positionsTableUtils';

export default function PositionsTable({
  router,
  selectedPortfolio,
  positionPrices,
  totalPortfolioValue,
  csvFileInputRef,
  importInProgress,
  importMessage,
  handleImportCsv,
  onOpenAddTransaction,
  startEditPositionMetadata,
  openTransactionHistory,
  handleDeletePosition,
}: {
  router: { push: (href: string) => void };
  selectedPortfolio: Portfolio;
  positionPrices: Record<string, number>;
  totalPortfolioValue: number | null;
  csvFileInputRef: RefObject<HTMLInputElement | null>;
  importInProgress: boolean;
  importMessage: string | null;
  handleImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenAddTransaction: () => void;
  startEditPositionMetadata: (position: Position) => void;
  openTransactionHistory: (ticker: string) => void;
  handleDeletePosition: (positionId: string) => void;
}) {
  const sections = buildPositionSections(selectedPortfolio);

  const toolbar = (
    <>
      <input
        ref={csvFileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleImportCsv}
      />
      <button
        type="button"
        onClick={() => csvFileInputRef.current?.click()}
        disabled={importInProgress}
        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {importInProgress ? 'Importing…' : 'Import transactions'}
      </button>
      <button
        onClick={onOpenAddTransaction}
        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 hover:border-gray-300"
      >
        + Add Transaction
      </button>
    </>
  );

  return (
    <div>
      <div className="flex justify-end items-center gap-2 mb-3 flex-wrap">{toolbar}</div>
      {importMessage && <p className="text-sm text-gray-600 mb-2">{importMessage}</p>}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-700">Ticker</th>
              <th className="text-right py-3 px-4 font-medium text-gray-700">Shares</th>
              <th className="text-right py-3 px-4 font-medium text-gray-700">Weight %</th>
              <th className="text-right py-3 px-4 font-medium text-gray-700">Return (since buy)</th>
              <th className="text-right py-3 px-4 font-medium text-gray-700">Drawdown Impact %</th>
              <th className="text-left py-3 px-4 font-medium text-gray-700">
                <div className="inline-flex items-center gap-1.5">
                  <span>Thesis Status</span>
                  <LiveThesisCardHoverTrigger />
                </div>
              </th>
              <th className="text-right py-3 px-4 font-medium text-gray-700">Total value</th>
              <th className="w-28 py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const bandTotalValue =
                totalPortfolioValue != null && totalPortfolioValue > 0
                  ? section.positions.reduce((sum, p) => {
                      const price = positionPrices[p.ticker.toUpperCase()];
                      return sum + (price != null ? p.quantity * price : 0);
                    }, 0)
                  : null;
              const actualPct =
                bandTotalValue != null && totalPortfolioValue != null && totalPortfolioValue > 0
                  ? (bandTotalValue / totalPortfolioValue) * 100
                  : null;
              const targetRange = section.band
                ? `${section.band.sizeMinPct}–${section.band.sizeMaxPct}%`
                : null;
              const isViolation =
                section.band != null &&
                actualPct != null &&
                (actualPct < section.band.sizeMinPct || actualPct > section.band.sizeMaxPct);
              return (
                <Fragment key={section.bandId ?? 'none'}>
                  <tr
                    className={`border-b border-gray-200 ${isViolation ? 'bg-red-50 border-l-4 border-l-red-500' : 'bg-gray-100'}`}
                  >
                    <td colSpan={8} className="py-2 px-4 font-semibold text-gray-800">
                      {section.bandLabel}
                      {isViolation && (
                        <span className="ml-2 text-red-700 font-medium text-xs uppercase tracking-wide">
                          Violation
                        </span>
                      )}
                      {actualPct != null && (
                        <span
                          className={`font-normal ml-2 ${isViolation ? 'text-red-800' : 'text-gray-600'}`}
                        >
                          — {actualPct.toFixed(1)}% of portfolio
                          {targetRange != null && <span> (target {targetRange})</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                  {section.positions.map((position) => {
                    const tickerKey = position.ticker.toUpperCase();
                    const currentPrice = positionPrices[tickerKey];
                    const avgCost = position.purchasePrice ?? null;
                    const totalValue = currentPrice != null ? position.quantity * currentPrice : null;
                    const returnSinceBuy =
                      avgCost != null && avgCost > 0 && currentPrice != null
                        ? ((currentPrice - avgCost) / avgCost) * 100
                        : null;
                    const weightPct =
                      totalPortfolioValue != null &&
                      totalPortfolioValue > 0 &&
                      totalValue != null
                        ? (totalValue / totalPortfolioValue) * 100
                        : null;
                    const maxPositionPct = section.band?.maxPositionSizePct;
                    const isOversized =
                      maxPositionPct != null && weightPct != null && weightPct > maxPositionPct;
                    return (
                      <tr
                        key={position.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 ${isOversized ? 'bg-amber-50' : ''}`}
                      >
                        <td className="py-3 px-4 font-medium text-gray-900">
                          {position.ticker}
                          {isOversized && (
                            <span
                              className="ml-2 text-amber-700 font-normal text-xs"
                              title={`Position is ${weightPct?.toFixed(1)}% of portfolio; max for this band is ${maxPositionPct}%`}
                            >
                              Oversized
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700">
                          {position.quantity.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700">
                          {weightPct != null ? `${weightPct.toFixed(1)}%` : ''}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {returnSinceBuy != null ? (
                            <span
                              className={returnSinceBuy >= 0 ? 'text-green-600' : 'text-red-600'}
                            >
                              {returnSinceBuy >= 0 ? '+' : ''}
                              {returnSinceBuy.toFixed(1)}%
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700" />
                        <td className="py-3 px-4 text-gray-700">
                          {position.thesisId ? (
                            <button
                              type="button"
                              title="Open thesis in builder"
                              aria-label="Open thesis in builder"
                              onClick={() => {
                                const q = new URLSearchParams();
                                q.set('thesisDocId', position.thesisId!);
                                if (selectedPortfolio.id && position.id) {
                                  q.set('portfolioId', selectedPortfolio.id);
                                  q.set('positionId', position.id);
                                }
                                router.push(
                                  `/${position.ticker}/thesis-builder?${q.toString()}`
                                );
                              }}
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors inline-flex"
                            >
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                />
                              </svg>
                            </button>
                          ) : selectedPortfolio.id && position.id ? (
                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/new-thesis?portfolioId=${encodeURIComponent(selectedPortfolio.id!)}&positionId=${encodeURIComponent(position.id!)}&ticker=${encodeURIComponent(position.ticker)}`
                                )
                              }
                              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              Add thesis
                            </button>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-700">
                          {totalValue != null
                            ? `$${totalValue.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : ''}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditPositionMetadata(position)}
                              title="Edit thesis and notes"
                              aria-label="Edit position metadata"
                              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => openTransactionHistory(position.ticker)}
                              title="Transaction history"
                              aria-label="Transaction history"
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePosition(position.id!)}
                              title="Delete position"
                              aria-label="Delete position"
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PositionsEmptyState({
  csvFileInputRef,
  importInProgress,
  importMessage,
  handleImportCsv,
  onOpenAddTransaction,
}: {
  csvFileInputRef: RefObject<HTMLInputElement | null>;
  importInProgress: boolean;
  importMessage: string | null;
  handleImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenAddTransaction: () => void;
}) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-500 mb-4">
        No positions in this portfolio yet. Add a transaction or import from CSV.
      </p>
      <input
        ref={csvFileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleImportCsv}
      />
      <div className="flex justify-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => csvFileInputRef.current?.click()}
          disabled={importInProgress}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importInProgress ? 'Importing…' : 'Import transactions'}
        </button>
        <button
          onClick={onOpenAddTransaction}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200"
        >
          Add Your First Transaction
        </button>
      </div>
      {importMessage && <p className="text-sm text-gray-600 mt-2">{importMessage}</p>}
    </div>
  );
}
