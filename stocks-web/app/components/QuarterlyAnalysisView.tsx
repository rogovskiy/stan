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
import { QuarterlyAnalysis, EPSGrowthDriver, KPIMetric } from '../types/api';
import { GrowthCardWithKPI } from './GrowthCardWithKPI';
import { QuarterlyCard } from './QuarterlyCard';
import { QuarterlyDetailsDrawer } from './QuarterlyDetailsDrawer';

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

  // Get first 2 growth factors (for display in timeline summary)
  const firstGrowthFactors = useMemo(() => {
    if (sortedAnalyses.length === 0) return [];
    const mostRecent = sortedAnalyses[0];
    if (!mostRecent.growth_theses || !mostRecent.kpi_metrics) return [];

    const factors: Array<{ kpi?: KPIMetric; driver?: EPSGrowthDriver }> = [];
    const normalizeName = (name: string) => name.toLowerCase().replace(/\b(growth|revenue|sales|margin|expansion|ratio|efficiency)\b/gi, '').trim();

    for (const thesis of mostRecent.growth_theses) {
      if (factors.length >= 2) break;
      if (!thesis.eps_growth_drivers) continue;
      
      for (const driver of thesis.eps_growth_drivers) {
        if (factors.length >= 2) break;
        if (!driver.thesis_points?.length) continue;
        
        const matchingKPI = mostRecent.kpi_metrics.find(kpi => {
          const kpiName = normalizeName(kpi.name);
          const driverName = normalizeName(driver.factor || '');
          return kpiName === driverName || kpiName.includes(driverName) || driverName.includes(kpiName);
        });

        factors.push(matchingKPI ? { kpi: matchingKPI, driver } : { driver });
      }
    }
    return factors;
  }, [sortedAnalyses]);

  return (
    <div className="space-y-6">
      {/* Key Growth Factors Section */}
      <QuarterlyTimelineSummary 
        analyses={sortedAnalyses} 
        firstGrowthFactors={firstGrowthFactors}
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

// Compact Timeline Summary Component
function QuarterlyTimelineSummary({ 
  analyses, 
  firstGrowthFactors,
  onQuarterClick
}: { 
  analyses: QuarterlyAnalysis[]; 
  firstGrowthFactors: Array<{ kpi?: KPIMetric; driver?: EPSGrowthDriver }>;
  onQuarterClick: (analysis: QuarterlyAnalysis) => void;
}) {
  if (analyses.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
      <div className="flex gap-4">
        {/* First 2 Growth Factors - Left Side (50%) */}
        {firstGrowthFactors.length > 0 && (
          <div className="flex-shrink-0 w-1/2">
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">
              Key Growth Factors
            </h3>
            <div className="flex gap-3">
              {firstGrowthFactors.map((factor, idx) => {
                if (!factor.driver) return null;
                
                return factor.kpi && factor.driver ? (
                  <div key={idx} className="flex-1 min-w-0">
                    <GrowthCardWithKPI metric={factor.kpi} driver={factor.driver} />
                  </div>
                ) : (
                  <div key={idx} className="flex-1 min-w-0 bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 p-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-gray-900 leading-tight">
                        {factor.driver.factor || 'Unknown Factor'}
                      </h4>
                      {factor.driver.contribution_percent !== undefined && (
                        <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                          {factor.driver.contribution_percent >= 0 ? '+' : ''}{factor.driver.contribution_percent.toFixed(1)}% EPS
                        </span>
                      )}
                    </div>
                    {factor.driver.thesis_points && factor.driver.thesis_points.length > 0 && (
                      <div className="mb-2 space-y-1.5">
                        {factor.driver.thesis_points.slice(0, 2).map((point, ptIdx) => (
                          <div key={ptIdx} className="flex items-start gap-1.5 text-xs text-gray-800 leading-relaxed">
                            <span className="text-blue-600 mt-0.5 flex-shrink-0 font-bold">•</span>
                            <span className="line-clamp-2">{point}</span>
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

        {/* Quarter Highlights Carousel - Right Side (50%) */}
        <div className="flex-1 min-w-0">
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
      </div>
    </div>
  );
}


