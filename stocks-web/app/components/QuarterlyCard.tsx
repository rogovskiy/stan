'use client';

import { QuarterlyAnalysis } from '../types/api';

interface QuarterlyCardProps {
  analysis: QuarterlyAnalysis;
  index: number;
  onClick: () => void;
}

const formatQuarterLabel = (quarterKey: string): string => {
  const match = quarterKey.match(/^(\d{4})Q(\d)$/);
  return match ? `${match[1]} Q${match[2]}` : quarterKey;
};

const getTrendIcon = (trend?: 'up' | 'down' | 'neutral') => {
  switch (trend) {
    case 'up':
      return (
        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    case 'down':
      return (
        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
        </svg>
      );
    default:
      return null;
  }
};

export function QuarterlyCard({ analysis, index, onClick }: QuarterlyCardProps) {
  const highlights = analysis.highlights || [];
  // Show card even if no highlights - display initiatives or summary instead
  const hasContent = highlights.length > 0 || (analysis.initiatives && analysis.initiatives.length > 0) || analysis.quarterly_highlights;
  
  if (!hasContent) return null;

  // Calculate total expected EPS growth from all theses (optional)
  const totalExpectedGrowth = (analysis.growth_theses || [])
    .filter(t => t.expected_eps_growth != null)
    .reduce((sum, t) => sum + (t.expected_eps_growth || 0), 0);

  // Calculate actual EPS growth (current vs previous quarter)
  const currentEps = analysis.historical_eps?.current ?? analysis.historical_eps?.one_quarter_ago;
  const previousEps = analysis.historical_eps?.one_quarter_ago ?? analysis.historical_eps?.two_quarters_ago;
  
  const actualGrowth = currentEps != null && previousEps != null && previousEps > 0
    ? ((currentEps - previousEps) / previousEps) * 100
    : null;

  return (
    <div
      onClick={onClick}
      className="flex-shrink-0 w-56 bg-gradient-to-br from-gray-50 to-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* Quarter Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-900">
          {formatQuarterLabel(analysis.quarter_key)}
        </h4>
        {index === 0 && (
          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">
            Latest
          </span>
        )}
      </div>

      {/* EPS Growth Anchor - Ultra Compact */}
      {totalExpectedGrowth !== 0 && actualGrowth != null && (
        <div className="mb-1.5 pt-1 border-t border-gray-200">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-500">Actual:</span>
            <span className={`font-bold ${actualGrowth >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {actualGrowth >= 0 ? '+' : ''}{actualGrowth.toFixed(1)}%
            </span>
            {(() => {
              const difference = actualGrowth - totalExpectedGrowth;
              const absDifference = Math.abs(difference);
              if (absDifference < 0.5) return null;
              const status = difference > 0 ? 'beat' : 'miss';
              return (
                <span className={status === 'beat' ? 'text-green-700' : 'text-red-700'}>
                  ({status} {absDifference.toFixed(1)}%)
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {/* Highlights or Initiatives */}
      <div className="space-y-2">
        {highlights.length > 0 ? (
          highlights.slice(0, 3).map((highlight, hIdx) => (
            <div key={hIdx} className="flex items-start gap-2 text-xs">
              {highlight.trend && (
                <div className="mt-0.5 flex-shrink-0">
                  {getTrendIcon(highlight.trend)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-gray-700 font-medium">{highlight.text}</span>
                {highlight.impact && (
                  <span className="text-gray-600 ml-1">{highlight.impact}</span>
                )}
              </div>
            </div>
          ))
        ) : analysis.initiatives && analysis.initiatives.length > 0 ? (
          analysis.initiatives.slice(0, 3).map((initiative, iIdx) => (
            <div key={iIdx} className="flex items-start gap-2 text-xs">
              <div className="flex-1 min-w-0">
                <span className="text-gray-700 font-medium">{initiative.title}</span>
                <span className="text-gray-600 ml-1 text-[10px]">
                  ({initiative.status === 'new' ? 'New' : initiative.status === 'on track' ? 'On Track' : 'At Risk'})
                </span>
              </div>
            </div>
          ))
        ) : analysis.quarterly_highlights ? (
          <div className="text-xs text-gray-600 line-clamp-3">
            {analysis.quarterly_highlights.substring(0, 150)}...
          </div>
        ) : null}
      </div>
    </div>
  );
}

