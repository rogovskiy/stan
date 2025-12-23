'use client';

/**
 * QuarterlyAnalysisView Component
 * 
 * Displays LLM-generated quarterly performance analysis in a beautiful timeline layout.
 * 
 * Features:
 * - Timeline view with chronological quarter display (most recent first)
 * - Expandable/collapsible quarter sections
 * - Summary section with paragraph and bullet points
 * - Growth theses displayed as cards with strength indicators
 * - Expandable thesis cards showing detailed explanations and supporting evidence
 * - Responsive design that works on mobile and desktop
 * 
 * @example
 * ```tsx
 * import QuarterlyAnalysisView from './components/QuarterlyAnalysisView';
 * 
 * const analyses: QuarterlyAnalysis[] = [
 *   {
 *     ticker: 'AAPL',
 *     quarter_key: '2025Q1',
 *     summary: 'Quarter summary with bullet points...',
 *     growth_theses: [...]
 *   }
 * ];
 * 
 * <QuarterlyAnalysisView analyses={analyses} ticker="AAPL" />
 * ```
 */

import { useState, useMemo } from 'react';
import { QuarterlyAnalysis, EPSGrowthDriver, KPIMetric, Initiative } from '../types/api';
import { GrowthCardWithKPI } from './GrowthCardWithKPI';
import { QuarterlyCard } from './QuarterlyCard';
import { QuarterlyDetailsDrawer } from './QuarterlyDetailsDrawer';

// Business Model Card Component with Key Growth Factors
function BusinessModelCard({ 
  businessModel, 
  initiatives, 
  kpiMetrics 
}: { 
  businessModel: { summary?: string; industry?: string; maturity_level?: string };
  initiatives: Initiative[];
  kpiMetrics: KPIMetric[];
}) {
  const getMaturityColor = (level?: string): string => {
    switch (level) {
      case 'early': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'growth': return 'bg-green-100 text-green-800 border-green-200';
      case 'mature': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'declining': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getMaturityLabel = (level?: string): string => {
    switch (level) {
      case 'early': return 'Early Stage';
      case 'growth': return 'Growth';
      case 'mature': return 'Mature';
      case 'declining': return 'Declining';
      default: return level || 'Unknown';
    }
  };

  const normalizeName = (name: string) => name.toLowerCase().replace(/\b(growth|revenue|sales|margin|expansion|ratio|efficiency)\b/gi, '').trim();

  // Match initiatives with KPIs
  const initiativesWithKPI = initiatives.map(initiative => {
    const matchingKPI = kpiMetrics.find(kpi => {
      const kpiName = normalizeName(kpi.name);
      const initiativeName = normalizeName(initiative.title || '');
      return kpiName === initiativeName || kpiName.includes(initiativeName) || initiativeName.includes(kpiName);
    });
    return { initiative, kpi: matchingKPI };
  });

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-900">Business Model</h3>
        {businessModel.maturity_level && (
          <span className={`px-3 py-1 text-xs font-semibold rounded-md border flex-shrink-0 ${getMaturityColor(businessModel.maturity_level)}`}>
            {getMaturityLabel(businessModel.maturity_level)}
          </span>
        )}
      </div>
      
      <div className="space-y-6">
        {/* Business Model Info */}
        <div className="space-y-4">
          {businessModel.industry && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">Industry</h4>
              <p className="text-gray-900">{businessModel.industry}</p>
            </div>
          )}
          
          {businessModel.summary && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Overview</h4>
              <p className="text-gray-700 leading-relaxed">{businessModel.summary}</p>
            </div>
          )}
        </div>

        {/* Initiatives - All in One Row */}
        {initiatives.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">Initiatives</h4>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {initiativesWithKPI.map((item, idx) => {
                const { initiative, kpi } = item;
                return kpi ? (
                  <div key={idx} className="flex-shrink-0 w-64">
                    <InitiativeCardWithKPI metric={kpi} initiative={initiative} />
                  </div>
                ) : (
                  <div key={idx} className="flex-shrink-0 w-64 bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-gray-900 leading-tight">
                        {initiative.title}
                      </h4>
                      <StatusBadge status={initiative.status} />
                    </div>
                    {initiative.bullet_points && initiative.bullet_points.length > 0 && (
                      <div className="mb-2 space-y-1.5">
                        {initiative.bullet_points.map((point, ptIdx) => (
                          <div key={ptIdx} className="flex items-start gap-1.5 text-xs text-gray-800 leading-relaxed">
                            <span className="text-blue-600 mt-0.5 flex-shrink-0 font-bold">•</span>
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: 'new' | 'on track' | 'at risk' }) {
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
    <span className={`px-2 py-1 text-xs font-semibold rounded-md border flex-shrink-0 ${getStatusColor(status)}`}>
      {getStatusLabel(status)}
    </span>
  );
}

// Initiative Card with KPI Component (similar to GrowthCardWithKPI)
function InitiativeCardWithKPI({ metric, initiative }: { metric: KPIMetric; initiative: Initiative }) {
  const chartData = useMemo(() => {
    return metric.values.map((value, idx) => ({
      period: metric.labels?.[idx] || 'Q' + (idx + 1),
      value: value
    }));
  }, [metric]);

  const maxValue = Math.max(...metric.values, 0);
  const minValue = Math.min(...metric.values, 0);
  const range = maxValue - minValue || 1;
  const isPositiveTrend = metric.trend === 'up' || (metric.values.length >= 2 && metric.values[0] > metric.values[metric.values.length - 1]);

  const isRisk = initiative.status === 'at risk';

  const formatValue = (value: number): string => {
    if (metric.unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (metric.unit === '$B') {
      return '$' + value.toFixed(1) + 'B';
    }
    return value.toFixed(1);
  };

  return (
    <div className={`bg-gradient-to-br ${isRisk ? 'from-red-50 to-orange-50' : 'from-white to-gray-50'} rounded-lg border ${isRisk ? 'border-red-200' : 'border-gray-200'} p-3 hover:shadow-sm transition-shadow w-full`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className={`text-sm font-bold ${isRisk ? 'text-red-900' : 'text-gray-900'} leading-tight`}>
          {initiative.title}
        </h4>
        <StatusBadge status={initiative.status} />
      </div>
      {initiative.bullet_points && initiative.bullet_points.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {initiative.bullet_points.map((point, ptIdx) => (
            <div key={ptIdx} className="flex items-start gap-1.5 text-xs text-gray-800 leading-relaxed">
              <span className={`${isRisk ? 'text-red-600' : 'text-blue-600'} mt-0.5 flex-shrink-0 font-bold`}>•</span>
              <span>{point}</span>
            </div>
          ))}
        </div>
      )}
      {/* KPI Data */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500">{metric.name}</span>
          {metric.trend && (
            <div className={`flex-shrink-0 ${metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
              {metric.trend === 'up' && (
                <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              )}
              {metric.trend === 'down' && (
                <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
              )}
            </div>
          )}
        </div>
        {metric.values.length > 0 && (
          <div className="mb-2">
            <div className={`text-sm font-semibold ${isPositiveTrend ? 'text-green-600' : 'text-gray-600'}`}>
              {formatValue(metric.values[0])}
            </div>
          </div>
        )}
        {/* Mini Bar Chart */}
        {chartData.length > 1 && (
          <div className="mt-1">
            <div className="flex items-end gap-0.5 h-6">
              {chartData.map((data, idx) => {
                const height = ((data.value - minValue) / range) * 100;
                const isLatest = idx === 0;
                
                return (
                  <div
                    key={idx}
                    className={`rounded-t transition-all ${
                      isLatest
                        ? isPositiveTrend ? 'bg-green-400' : 'bg-gray-400'
                        : 'bg-gray-300'
                    }`}
                    style={{ 
                      height: Math.max(height, 8) + '%',
                      width: '5px',
                      minWidth: '5px'
                    }}
                    title={data.period + ': ' + formatValue(data.value)}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-0.5 text-[10px] text-gray-400">
              <span>{chartData[chartData.length - 1]?.period}</span>
              <span>{chartData[0]?.period}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface QuarterlyAnalysisViewProps {
  analyses: QuarterlyAnalysis[];
}

export default function QuarterlyAnalysisView({ analyses }: QuarterlyAnalysisViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<QuarterlyAnalysis | null>(null);

  // Sort analyses by quarter (most recent first)
  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      const aMatch = a.quarter_key.match(/^(\d{4})Q(\d)$/);
      const bMatch = b.quarter_key.match(/^(\d{4})Q(\d)$/);
      if (!aMatch || !bMatch) return 0;
      const aYear = parseInt(aMatch[1], 10);
      const aQuarter = parseInt(aMatch[2], 10);
      const bYear = parseInt(bMatch[1], 10);
      const bQuarter = parseInt(bMatch[2], 10);
      if (aYear !== bYear) return bYear - aYear;
      return bQuarter - aQuarter;
    });
  }, [analyses]);


  // Get business model and initiatives from most recent analysis
  const mostRecentAnalysis = sortedAnalyses.length > 0 ? sortedAnalyses[0] : null;
  const businessModel = mostRecentAnalysis?.business_model;
  const initiatives = mostRecentAnalysis?.initiatives || [];
  const kpiMetrics = mostRecentAnalysis?.kpi_metrics || [];

  return (
    <div className="space-y-6">
      {/* Business Model Section with Key Growth Factors */}
      {businessModel && (
        <BusinessModelCard 
          businessModel={businessModel}
          initiatives={initiatives}
          kpiMetrics={kpiMetrics}
        />
      )}

      {/* Quarter Highlights Section */}
      <QuarterlyTimelineSummary 
        analyses={sortedAnalyses} 
        onQuarterClick={(analysis) => {
          setSelectedQuarter(analysis);
          setDrawerOpen(true);
        }}
      />

      {/* Quarter Details Drawer */}
      {drawerOpen && selectedQuarter && (
        <QuarterlyDetailsDrawer
          analysis={selectedQuarter}
          sortedAnalyses={sortedAnalyses}
          onClose={() => {
            setDrawerOpen(false);
            setSelectedQuarter(null);
          }}
        />
      )}
    </div>
  );
}

// Compact Timeline Summary Component (Quarter Highlights Only)
function QuarterlyTimelineSummary({ 
  analyses, 
  onQuarterClick
}: { 
  analyses: QuarterlyAnalysis[]; 
  onQuarterClick: (analysis: QuarterlyAnalysis) => void;
}) {
  if (analyses.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">
        Quarter Highlights
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        {analyses.map((analysis, idx) => (
          <QuarterlyCard
            key={analysis.quarter_key}
            analysis={analysis}
            index={idx}
            onClick={() => onQuarterClick(analysis)}
          />
        ))}
      </div>
    </div>
  );
}


