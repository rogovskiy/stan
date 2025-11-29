'use client';

import { TransformedDataPoint } from '../lib/dataTransform';

interface StockSidebarProps {
  currentData: TransformedDataPoint | undefined;
  growthRate: number | null;
  normalPERatio: number | null;
  fairValueRatio: number;
}

export default function StockSidebar({ 
  currentData, 
  growthRate, 
  normalPERatio, 
  fairValueRatio 
}: StockSidebarProps) {

  return (
    <div className="space-y-6">
      {/* Key Metrics Widget */}
      {currentData && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
          <div className="flex gap-4">
            {/* Growth Rate */}
            <div className="flex-1 border border-gray-200 rounded-lg p-4 bg-white">
              <div className="text-xs text-gray-600 mb-2 font-semibold text-center">Growth Rate</div>
              <div className={`text-lg font-bold text-center ${
                growthRate !== null && growthRate >= 0 
                  ? 'text-green-600' 
                  : growthRate !== null 
                  ? 'text-red-600'
                  : 'text-gray-600'
              }`}>
                {growthRate !== null ? `${growthRate.toFixed(2)}%` : 'N/A'}
              </div>
            </div>

            {/* Fair Value Ratio */}
            <div className="flex-1 border border-gray-200 rounded-lg p-4 bg-white">
              <div className="text-xs text-gray-600 mb-2 font-semibold text-center">Fair Value Ratio</div>
              <div className="text-lg font-bold text-center text-orange-600">
                {fairValueRatio.toFixed(2)}x
              </div>
            </div>

            {/* Normal P/E Ratio */}
            <div className="flex-1 border border-gray-200 rounded-lg p-4 bg-white">
              <div className="text-xs text-gray-600 mb-2 font-semibold text-center">Normal P/E Ratio</div>
              <div className="text-lg font-bold text-center text-blue-600">
                {normalPERatio !== null ? `${normalPERatio.toFixed(2)}x` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Card */}
      <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
        <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Key Statistics</h3>
        {currentData ? (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">Fair Value</span>
              <span className="font-bold text-gray-900 text-lg">${currentData.fairValue?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">P/E Ratio</span>
              <span className="font-bold text-gray-900 text-lg">{currentData.peRatio?.toFixed(1) || '0.0'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">EPS</span>
              <span className="font-bold text-gray-900 text-lg">${currentData.earnings?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">Dividend</span>
              <span className="font-bold text-gray-900 text-lg">${currentData.dividend?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">POR %</span>
              <span className="font-bold text-gray-900 text-lg">{currentData.dividendsPOR?.toFixed(1) || '0.0'}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-semibold">Est. Cap</span>
              <span className="font-bold text-gray-900 text-lg">${currentData.marketCap?.toFixed(1) || '0.0'}B</span>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-500">Loading...</div>
        )}
      </div>

      {/* Valuation Analysis Card */}
      <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
        <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Valuation Analysis</h3>
        {currentData ? (
          <div className="space-y-4">
            {(() => {
              const fairValue = currentData.fairValue || 0;
              const currentPrice = currentData.stockPrice || 0;
              const ratio = fairValue > 0 && currentPrice > 0 ? fairValue / currentPrice : 0;
              const premium = ((currentPrice - fairValue) / fairValue) * 100;
              
              return (
                <>
                  <div className="flex items-center gap-4">
                    <div className={`w-4 h-4 rounded-full ${
                      ratio > 1.15 ? 'bg-green-500' : 
                      ratio > 1.05 ? 'bg-blue-500' : 
                      ratio < 0.85 ? 'bg-red-500' : 'bg-yellow-500'
                    }`}></div>
                    <span className="text-gray-700 font-semibold">
                      {ratio > 1.15 ? 'Undervalued' : 
                       ratio > 1.05 ? 'Fair Value' : 
                       ratio < 0.85 ? 'Overvalued' : 'Neutral'}
                    </span>
                    <span className="ml-auto font-bold text-gray-900 text-lg">
                      {ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-600 font-semibold">Current Price</span>
                      <span className="font-bold text-gray-900">${currentPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-600 font-semibold">Fair Value</span>
                      <span className="font-bold text-gray-900">${fairValue.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">Premium</span>
                      <span className={`font-bold ${premium > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {premium > 0 ? '+' : ''}{premium.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <div className="text-center text-gray-500">Loading...</div>
        )}
      </div>
    </div>
  );
}

