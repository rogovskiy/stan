'use client';

import { useState } from 'react';
import { TransformedDataPoint } from './stockChartTransform';
import { getTrailing4QuartersEps, calculateAnnualEps, QuarterlyDataPoint } from '../lib/calculations';

interface StockDataTableProps {
  tableData: TransformedDataPoint[];
  isQuarterlyMode: boolean;
  stockData: TransformedDataPoint[]; // Full stock data for trailing PE calculation in quarterly mode
}

export default function StockDataTable({
  tableData,
  isQuarterlyMode,
  stockData
}: StockDataTableProps) {
  const [useSplitAdjusted, setUseSplitAdjusted] = useState(true);
  // Format date for table header (matches chart tick formatter)
  // Uses fiscalYear and fiscalQuarter from item
  const formatTableDate = (item: TransformedDataPoint): string => {
    if (isQuarterlyMode) {
      return `${item.fiscalYear}Q${item.fiscalQuarter}`;
    } else {
      return item.fiscalYear!.toString();
    }
  };

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-3 px-1.5 font-bold text-gray-900 w-16 text-sm uppercase tracking-wide">&nbsp;</th>
            {tableData.map((item, index) => (
              <th key={item.fullDate} className={`text-left py-3 font-bold text-gray-900 text-sm tracking-tight ${index === tableData.length - 1 ? 'w-16 px-1.5' : 'px-3'}`}
                  style={index === tableData.length - 1 ? {} : { width: `${100 / tableData.length}%` }}>
                {formatTableDate(item)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-sm">
          <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white transition-colors">
            <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">PE</td>
            {tableData.map((item, index) => {
              // Calculate actual P/E: price / annual EPS
              let actualPE: number | null = null;
              let isEstimated = item.estimated;
              
              if (item.stockPrice !== null && item.stockPrice !== undefined && item.stockPrice > 0) {
                let annualEps: number | null = null;
                
                if (isQuarterlyMode) {
                  // For quarterly mode, use trailing 4 quarters EPS for P/E calculation
                  const currentDate = new Date(item.fullDate);
                  // Extract quarterly data from full stockData for trailing calculation
                  const allQuarterlyData: QuarterlyDataPoint[] = stockData
                    .filter(d => d.hasQuarterlyData)
                    .map(d => ({
                      date: d.fullDate,
                      eps_adjusted: d.eps_adjusted,
                      earnings: d.earnings,
                      stockPrice: d.stockPrice ?? null
                    }));
                  
                  const trailing4Quarters = getTrailing4QuartersEps(allQuarterlyData, currentDate);
                  
                  // If we have less than 4 quarters, this is estimated
                  if (trailing4Quarters.length < 4) {
                    isEstimated = true;
                  }
                  
                  if (trailing4Quarters.length > 0) {
                    const quarterlyEpsValues = trailing4Quarters.map(q => {
                      return q.eps_adjusted !== null && q.eps_adjusted !== undefined 
                        ? q.eps_adjusted 
                        : (q.earnings || 0);
                    });
                    annualEps = calculateAnnualEps(quarterlyEpsValues);
                  }
                } else {
                  // For yearly mode, use the projected annual EPS (already calculated in tableData)
                  annualEps = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
                    ? item.eps_adjusted 
                    : (item.earnings || null);
                }
                
                if (annualEps !== null && annualEps > 0) {
                  actualPE = item.stockPrice / annualEps;
                }
              }
              
              return (
                <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                  {actualPE !== null ? (
                    <span>
                      {actualPE.toFixed(1)}
                      {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                    </span>
                  ) : '-'}
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
            <td className="py-3 px-1.5">
              <div className="flex flex-col gap-1.5">
                <span className="font-bold text-gray-900 tracking-wide">EPS</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSplitAdjusted}
                    onChange={() => setUseSplitAdjusted(!useSplitAdjusted)}
                    className="sr-only"
                  />
                  <div className={`w-7 h-4 rounded-full transition-colors ${
                    useSplitAdjusted ? 'bg-gray-400' : 'bg-gray-200'
                  }`}>
                    <div className={`absolute top-[1px] left-[1px] bg-white border border-gray-300 rounded-full h-3 w-3 transition-transform ${
                      useSplitAdjusted ? 'translate-x-3' : 'translate-x-0'
                    }`}></div>
                  </div>
                  <span className="ml-2 text-xs text-gray-600 font-medium">Splits</span>
                </label>
              </div>
            </td>
            {tableData.map((item, index) => {
              const isEstimated = item.estimated;
              const epsValue = useSplitAdjusted 
                ? (item.eps_adjusted !== null && item.eps_adjusted !== undefined ? item.eps_adjusted : null)
                : (item.earnings !== null && item.earnings !== undefined ? item.earnings : null);
              
              return (
                <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                  {epsValue !== null ? (
                    <span>
                      ${epsValue.toFixed(2)}
                      {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                    </span>
                  ) : '-'}
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
            <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">Dividend</td>
            {tableData.map((item, index) => {
              const isEstimated = item.estimated;
              return (
                <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                  {item.dividend !== null && item.dividend !== undefined ? (
                    <span>
                      ${item.dividend.toFixed(2)}
                      {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                    </span>
                  ) : '-'}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

