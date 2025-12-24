'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { QuarterlyAnalysis, GrowthThesis, Initiative } from '../types/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface QuarterlyDetailsDrawerProps {
  analysis: QuarterlyAnalysis;
  sortedAnalyses: QuarterlyAnalysis[];
  onClose: () => void;
}

const formatQuarterLabel = (quarterKey: string): string => {
  const match = quarterKey.match(/^(\d{4})Q(\d)$/);
  return match ? `${match[1]} Q${match[2]}` : quarterKey;
};

// EPS Progression Chart Component
function EPSProgressionChart({ 
  analysis, 
  sortedAnalyses 
}: { 
  analysis: QuarterlyAnalysis; 
  sortedAnalyses: QuarterlyAnalysis[] 
}) {
  const chartData = useMemo(() => {
    const hist = analysis.historical_eps;
    if (!hist) return [];

    const totalExpectedGrowth = (analysis.growth_theses || [])
      .filter(t => t.expected_eps_growth != null)
      .reduce((sum, t) => sum + (t.expected_eps_growth || 0), 0);

    const currentEps = hist.current ?? hist.one_quarter_ago ?? null;
    const projectedEps = currentEps && totalExpectedGrowth !== 0
      ? currentEps * (1 + totalExpectedGrowth / 100)
      : null;

    const data = [];

    if (hist.two_quarters_ago != null) {
      const quarterMatch = analysis.quarter_key.match(/^(\d{4})Q(\d)$/);
      let twoQuartersBackLabel = '2Q Ago';
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1], 10);
        const quarter = parseInt(quarterMatch[2], 10);
        let backYear = year;
        let backQuarter = quarter - 2;
        if (backQuarter <= 0) {
          backQuarter += 4;
          backYear -= 1;
        }
        twoQuartersBackLabel = `${backYear} Q${backQuarter}`;
      }
      data.push({ period: twoQuartersBackLabel, eps: hist.two_quarters_ago, type: 'historical', label: 'Historical' });
    }

    if (hist.one_quarter_ago != null) {
      const quarterMatch = analysis.quarter_key.match(/^(\d{4})Q(\d)$/);
      let oneQuarterBackLabel = '1Q Ago';
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1], 10);
        const quarter = parseInt(quarterMatch[2], 10);
        let backYear = year;
        let backQuarter = quarter - 1;
        if (backQuarter <= 0) {
          backQuarter += 4;
          backYear -= 1;
        }
        oneQuarterBackLabel = `${backYear} Q${backQuarter}`;
      }
      data.push({ period: oneQuarterBackLabel, eps: hist.one_quarter_ago, type: 'historical', label: 'Historical' });
    }

    if (currentEps != null) {
      const quarterMatch = analysis.quarter_key.match(/^(\d{4})Q(\d)$/);
      const currentLabel = quarterMatch ? `${quarterMatch[1]} Q${quarterMatch[2]}` : 'Current';
      data.push({ period: currentLabel, eps: currentEps, type: 'current', label: 'Current' });
    }

    if (projectedEps != null) {
      const quarterMatch = analysis.quarter_key.match(/^(\d{4})Q(\d)$/);
      let futureLabel = 'Projected';
      if (quarterMatch) {
        const year = parseInt(quarterMatch[1], 10);
        const quarter = parseInt(quarterMatch[2], 10);
        let futureYear = year;
        let futureQuarter = quarter + 1;
        if (futureQuarter > 4) {
          futureQuarter = 1;
          futureYear += 1;
        }
        futureLabel = `${futureYear} Q${futureQuarter} (Proj.)`;
      }
      data.push({ period: futureLabel, eps: projectedEps, type: 'projected', label: 'Projected' });
    }

    return data;
  }, [analysis]);

  if (chartData.length === 0) return null;

  const maxEps = Math.max(...chartData.map(d => d.eps), 0);
  const minEps = Math.min(...chartData.map(d => d.eps), 0);
  const yAxisDomain = [Math.max(0, minEps * 0.9), maxEps * 1.15];

  const getBarColor = (type: string) => {
    switch (type) {
      case 'historical': return '#94a3b8';
      case 'current': return '#3b82f6';
      case 'projected': return '#10b981';
      default: return '#94a3b8';
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold text-gray-900">{data.period}</p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">EPS:</span> ${data.eps.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{data.label}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-4">
        EPS Progression
      </h4>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
          <XAxis 
            dataKey="period" 
            tick={{ fontSize: 12, fill: '#6b7280' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis 
            domain={yAxisDomain}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickFormatter={(value) => `$${value.toFixed(2)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="eps" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.type)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-gray-400"></div>
          <span className="text-gray-600">Historical</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-blue-500"></div>
          <span className="text-gray-600">Current</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-500"></div>
          <span className="text-gray-600">Projected</span>
        </div>
      </div>
    </div>
  );
}

// Initiative Card Component
function InitiativeCard({ initiative }: { initiative: Initiative }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusColor = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'bg-green-100 text-green-800 border-green-200';
      case 'on track': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'at risk': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'New';
      case 'on track': return 'On Track';
      case 'at risk': return 'At Risk';
      default: return status;
    }
  };

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-all hover:shadow-md">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h5 className="text-base font-bold text-gray-900 flex-1 leading-tight">
            {initiative.title}
          </h5>
          <span className={`px-2 py-1 text-xs font-semibold rounded-md border flex-shrink-0 ${getStatusColor(initiative.status)}`}>
            {getStatusLabel(initiative.status)}
          </span>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 space-y-4">
            {/* Initiative Summary */}
            {initiative.summary && (
              <div>
                <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Summary
                </h6>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {initiative.summary}
                </p>
              </div>
            )}
            
            {/* Cumulative Progress */}
            <div>
              <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Cumulative Progress
              </h6>
              {initiative.cumulative_progress && initiative.cumulative_progress.trim() ? (
                <p className="text-sm text-gray-700 leading-relaxed">
                  {initiative.cumulative_progress}
                </p>
              ) : (
                <p className="text-sm text-gray-500 italic">No cumulative progress data available</p>
              )}
            </div>
            
            {/* Last Quarter Progress */}
            <div>
              <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Last Quarter Progress
              </h6>
              {initiative.last_quarter_progress && initiative.last_quarter_progress.trim() ? (
                <p className="text-sm text-gray-700 leading-relaxed">
                  {initiative.last_quarter_progress}
                </p>
              ) : (
                <p className="text-sm text-gray-500 italic">No last quarter progress data available</p>
              )}
            </div>
            
            {/* Bullet Points */}
            {initiative.bullet_points && initiative.bullet_points.length > 0 && (
              <div>
                <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Key Points
                </h6>
                <ul className="space-y-2">
                  {initiative.bullet_points.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-blue-500 mt-1 flex-shrink-0">▸</span>
                      <span className="leading-relaxed">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
        >
          {isExpanded ? (
            <>
              <span>Show Less</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              <span>Show Details</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Thesis Card Component (for backward compatibility)
function ThesisCard({ thesis }: { thesis: GrowthThesis }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStrengthColor = (strength: 'high' | 'medium' | 'low'): string => {
    switch (strength) {
      case 'high': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStrengthBadge = (strength: 'high' | 'medium' | 'low'): string => {
    switch (strength) {
      case 'high': return 'High';
      case 'medium': return 'Medium';
      case 'low': return 'Low';
      default: return '';
    }
  };

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-all hover:shadow-md">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h5 className="text-base font-bold text-gray-900 flex-1 leading-tight">
            {thesis.title}
          </h5>
          <span className={`px-2 py-1 text-xs font-semibold rounded-md border flex-shrink-0 ${getStrengthColor(thesis.strength)}`}>
            {getStrengthBadge(thesis.strength)}
          </span>
        </div>

        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          {thesis.summary}
        </p>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
            <div>
              <p className="text-sm text-gray-600 leading-relaxed">
                {thesis.detailed_explanation}
              </p>
            </div>

            {thesis.supporting_evidence && thesis.supporting_evidence.length > 0 && (
              <div>
                <h6 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Supporting Evidence
                </h6>
                <ul className="space-y-2">
                  {thesis.supporting_evidence.map((evidence, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-blue-500 mt-1 flex-shrink-0">▸</span>
                      <span className="leading-relaxed">{evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
        >
          {isExpanded ? (
            <>
              <span>Show Less</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              <span>Show Details</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function QuarterlyDetailsDrawer({
  analysis,
  sortedAnalyses,
  onClose
}: QuarterlyDetailsDrawerProps) {
  const summaryText = useMemo(() => {
    // Use quarterly_highlights if available, otherwise fall back to summary
    return analysis.quarterly_highlights || analysis.summary || '';
  }, [analysis.summary, analysis.quarterly_highlights]);

    const totalExpectedGrowth = (analysis.growth_theses || [])
      .filter(t => t.expected_eps_growth != null)
      .reduce((sum, t) => sum + (t.expected_eps_growth || 0), 0);

  return (
    <>
      <div
        className="fixed inset-0 bg-transparent z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {formatQuarterLabel(analysis.quarter_key)}
              </h2>
              <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                {analysis.growth_theses && analysis.growth_theses.length > 0 && (
                  <span>{analysis.growth_theses.length} growth theses</span>
                )}
                {analysis.num_documents && (
                  <span>• {analysis.num_documents} document{analysis.num_documents !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
              Summary
            </h4>
            {summaryText && (
              <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                <ReactMarkdown>
                  {summaryText}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Highlights Section */}
          {analysis.highlights && analysis.highlights.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
                Highlights
              </h4>
              <ul className="space-y-2.5">
                {analysis.highlights.map((highlight, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-gray-700">
                    {/* Trend Icon */}
                    <div className="mt-0.5 flex-shrink-0">
                      {highlight.trend === 'up' && (
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                      )}
                      {highlight.trend === 'down' && (
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                        </svg>
                      )}
                      {highlight.trend === 'neutral' && (
                        <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                        </svg>
                      )}
                      {!highlight.trend && (
                        <span className="text-blue-600 text-lg font-bold">•</span>
                      )}
                    </div>
                    {/* Highlight Text and Impact */}
                    <div className="flex-1">
                      <span className="font-medium">{highlight.text}</span>
                      {highlight.impact && (
                        <span className="ml-2 text-gray-600">{highlight.impact}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.historical_eps && (
            <div className="mb-6">
              <EPSProgressionChart 
                analysis={analysis}
                sortedAnalyses={sortedAnalyses}
              />
            </div>
          )}

          {totalExpectedGrowth !== 0 && (
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
                  Total Expected EPS Growth
                </h4>
                <span className={`text-2xl font-bold ${totalExpectedGrowth >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {totalExpectedGrowth >= 0 ? '+' : ''}{totalExpectedGrowth.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-gray-600">
                Combined impact from all growth theses
              </p>
            </div>
          )}

          {analysis.growth_theses && analysis.growth_theses.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">
                Growth Theses
              </h4>
              <div className="grid grid-cols-1 gap-4">
                {analysis.growth_theses.map((thesis, thesisIdx) => (
                  <ThesisCard key={thesisIdx} thesis={thesis} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

