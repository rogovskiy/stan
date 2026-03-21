import type { Portfolio } from '../../lib/services/portfolioService';
import type { TaxSummary } from './types';
import TodoPopover from '../TodoPopover';
import SystematicRisksStrip from './SystematicRisksStrip';

export default function PortfolioDetailHeader({
  selectedPortfolio,
  totalPortfolioValue,
  taxSummary,
  onOpenCashDrawer,
  onOpenTaxDrawer,
  onOpenSettings,
}: {
  selectedPortfolio: Portfolio;
  totalPortfolioValue: number | null;
  taxSummary: TaxSummary | null;
  onOpenCashDrawer: () => void;
  onOpenTaxDrawer: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{selectedPortfolio.name}</h1>
          {selectedPortfolio.description && (
            <p className="text-sm text-gray-600 mt-1">{selectedPortfolio.description}</p>
          )}
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          {totalPortfolioValue != null && (
            <div className="flex flex-col">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total value</span>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">
                $
                {totalPortfolioValue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onOpenCashDrawer}
            className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm transition-colors text-left min-w-[7rem] group"
            title="View cash transactions"
          >
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1 group-hover:text-blue-600">
              Cash
              <svg
                className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
            <span className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
              $
              {(selectedPortfolio.cashBalance ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </button>
          {taxSummary?.taxable && (
            <button
              type="button"
              onClick={onOpenTaxDrawer}
              className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm transition-colors text-left min-w-[7rem] group"
              title="View tax details and pick year"
            >
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1 group-hover:text-blue-600">
                Tax (YTD)
                <svg
                  className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
              <span className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
                $
                {(taxSummary.estimatedTaxDue ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </button>
          )}
          <TodoPopover />
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Portfolio settings"
            aria-label="Portfolio settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
      <SystematicRisksStrip
        channelExposures={selectedPortfolio.channelExposures}
        channelExposureAsOf={selectedPortfolio.channelExposures?.asOf}
      />
    </>
  );
}
