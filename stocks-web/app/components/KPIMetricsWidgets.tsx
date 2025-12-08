'use client';

import { useMemo } from 'react';
import { QuarterlyAnalysis, KPIMetric, EPSGrowthDriver } from '../types/api';

// KPI Metrics Widgets Component
export function KPIMetricsWidgets({ analyses }: { analyses: QuarterlyAnalysis[] }) {
  // Normalize name for matching (remove common words, lowercase, trim)
  const normalizeName = (name: string | undefined): string => {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\b(growth|revenue|sales|margin|expansion|ratio|efficiency)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Check if two names match (after normalization)
  const namesMatch = (name1: string | undefined, name2: string | undefined): boolean => {
    if (!name1 || !name2) return false;
    const norm1 = normalizeName(name1);
    const norm2 = normalizeName(name2);
    if (!norm1 || !norm2) return false;
    // Check if one contains the other or they're very similar
    return norm1 === norm2 || 
           norm1.includes(norm2) || 
           norm2.includes(norm1) ||
           (norm1.length > 3 && norm2.length > 3 && 
            (norm1.substring(0, Math.min(norm1.length, norm2.length)) === 
             norm2.substring(0, Math.min(norm1.length, norm2.length))));
  };

  // Collect all unique KPIs across all quarters
  const allKPIs = useMemo(() => {
    const kpiMap = new Map<string, KPIMetric>();
    
    // Go through quarters in reverse order (oldest to newest) to build historical data
    [...analyses].reverse().forEach((analysis, idx) => {
      if (analysis.kpi_metrics) {
        analysis.kpi_metrics.forEach(kpi => {
          if (!kpiMap.has(kpi.name)) {
            // Initialize with empty values array
            kpiMap.set(kpi.name, {
              ...kpi,
              values: [],
              labels: []
            });
          }
          
          const existingKPI = kpiMap.get(kpi.name)!;
          // Add the latest value from this quarter
          if (kpi.values && kpi.values.length > 0) {
            existingKPI.values.unshift(kpi.values[0]); // Add to beginning (most recent first)
            if (kpi.labels && kpi.labels.length > 0) {
              existingKPI.labels?.unshift(kpi.labels[0]);
            } else {
              existingKPI.labels?.unshift(analysis.quarter_key);
            }
          }
        });
      }
    });
    
    return Array.from(kpiMap.values());
  }, [analyses]);

  // Collect all thesis points from EPS growth drivers across all quarters
  const allThesisDrivers = useMemo(() => {
    const thesisMap = new Map<string, { driver: EPSGrowthDriver; quarter: string }>();
    
    // Get the most recent quarter's growth drivers and their thesis points
    const mostRecentAnalysis = analyses[0]; // analyses are already sorted most recent first
    if (mostRecentAnalysis && mostRecentAnalysis.growth_theses) {
      mostRecentAnalysis.growth_theses.forEach(thesis => {
        if (thesis.eps_growth_drivers) {
          thesis.eps_growth_drivers.forEach(driver => {
            // Use factor name as key to avoid duplicates
            if (driver.factor && !thesisMap.has(driver.factor)) {
              thesisMap.set(driver.factor, {
                driver,
                quarter: mostRecentAnalysis.quarter_key
              });
            }
          });
        }
      });
    }
    
    return Array.from(thesisMap.values());
  }, [analyses]);

  // Match KPIs with thesis drivers and create combined items
  const combinedItems = useMemo(() => {
    const items: Array<{ type: 'combined' | 'kpi' | 'thesis'; kpi?: KPIMetric; driver?: EPSGrowthDriver }> = [];
    const matchedKPIKeys = new Set<string>();
    const matchedDriverKeys = new Set<string>();

    // Try to match each KPI with a thesis driver
    allKPIs.forEach(kpi => {
      if (!kpi.name) return;
      const matchingDriver = allThesisDrivers.find(({ driver }) => 
        namesMatch(kpi.name, driver.factor)
      );

      if (matchingDriver && matchingDriver.driver.factor) {
        items.push({
          type: 'combined',
          kpi,
          driver: matchingDriver.driver
        });
        matchedKPIKeys.add(kpi.name);
        matchedDriverKeys.add(matchingDriver.driver.factor);
      }
    });

    // Add unmatched KPIs
    allKPIs.forEach(kpi => {
      if (!matchedKPIKeys.has(kpi.name)) {
        items.push({ type: 'kpi', kpi });
      }
    });

    // Add unmatched thesis drivers (only if they have thesis points)
    allThesisDrivers.forEach(({ driver }) => {
      if (driver.factor && !matchedDriverKeys.has(driver.factor) && driver.thesis_points && driver.thesis_points.length > 0) {
        items.push({ type: 'thesis', driver });
      }
    });

    return items;
  }, [allKPIs, allThesisDrivers]);

  if (combinedItems.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">
        Key Growth Factors
      </h3>
      
      {/* Combined Grid: KPIs and Thesis Points */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {combinedItems.map((item, idx) => {
          if (item.type === 'combined' && item.kpi && item.driver) {
            return <CombinedWidget key={`combined-${idx}`} metric={item.kpi} driver={item.driver} />;
          } else if (item.type === 'kpi' && item.kpi) {
            return <KPIMetricWidget key={`kpi-${idx}`} metric={item.kpi} />;
          } else if (item.type === 'thesis' && item.driver) {
            return <ThesisWidget key={`thesis-${idx}`} driver={item.driver} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

// Combined Widget Component (KPI + Thesis)
export function CombinedWidget({ metric, driver }: { metric: KPIMetric; driver: EPSGrowthDriver }) {
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

  // Detect if this is a risk (negative contribution or factor name contains "Risk")
  const isRisk = (driver.contribution_percent !== undefined && driver.contribution_percent < 0) || 
                 (driver.factor && driver.factor.toLowerCase().includes('risk'));

  const formatValue = (value: number): string => {
    if (metric.unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (metric.unit === '$B') {
      return '$' + value.toFixed(1) + 'B';
    }
    return value.toFixed(1);
  };

  return (
    <div className={'bg-gradient-to-br ' + (isRisk ? 'from-red-50 to-orange-50' : 'from-white to-gray-50') + ' rounded-lg border ' + (isRisk ? 'border-red-200' : 'border-gray-200') + ' p-2 hover:shadow-sm transition-shadow'}>
      {/* Header with Factor Name and EPS Contribution */}
      <div className="flex items-center justify-between mb-2">
        <h4 className={'text-[11px] font-bold ' + (isRisk ? 'text-red-900' : 'text-gray-900') + ' leading-tight'}>{driver.factor || 'Unknown Factor'}</h4>
        {driver.contribution_percent !== undefined && (
          <span className={'text-[10px] font-semibold ' + (isRisk ? 'text-red-700 bg-red-100' : 'text-blue-700 bg-blue-100') + ' px-1.5 py-0.5 rounded'}>
            {driver.contribution_percent >= 0 ? '+' : ''}{driver.contribution_percent.toFixed(1)}% EPS
          </span>
        )}
      </div>

      {/* Thesis Points - Prominent */}
      {driver.thesis_points && driver.thesis_points.length > 0 && (
        <div className="mb-2 space-y-1">
          {driver.thesis_points.slice(0, 3).map((point, ptIdx) => (
            <div key={ptIdx} className="flex items-start gap-1.5 text-[10px] text-gray-800 leading-relaxed">
              <span className={(isRisk ? 'text-red-600' : 'text-blue-600') + ' mt-0.5 flex-shrink-0 font-bold'}>•</span>
              <span className="line-clamp-2">{point}</span>
            </div>
          ))}
          {driver.thesis_points.length > 3 && (
            <div className="text-[9px] text-gray-500 mt-1">
              +{driver.thesis_points.length - 3} more
            </div>
          )}
        </div>
      )}

      {/* KPI Data - Secondary (below thesis) */}
      <div className="mt-2 pt-2 border-t border-gray-200">
        {/* KPI Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-medium text-gray-500">{metric.name}</span>
          {metric.trend && (
            <div className={'flex-shrink-0 ' + (
              metric.trend === 'up' ? 'text-green-600' : 
              metric.trend === 'down' ? 'text-red-600' : 
              'text-gray-500'
            )}>
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

        {/* Current Value */}
        {metric.values.length > 0 && (
          <div className="mb-1">
            <div className={'text-xs font-semibold ' + (isPositiveTrend ? 'text-green-600' : 'text-gray-600')}>
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
                    className={'rounded-t transition-all ' + (
                      isLatest
                        ? isPositiveTrend ? 'bg-green-400' : 'bg-gray-400'
                        : 'bg-gray-300'
                    )}
                    style={{ 
                      height: Math.max(height, 8) + '%',
                      width: '5px',
                      minWidth: '5px'
                    }}
                    title={`${data.period}: ${formatValue(data.value)}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-0.5 text-[7px] text-gray-400">
              <span>{chartData[chartData.length - 1]?.period}</span>
              <span>{chartData[0]?.period}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Thesis Widget Component
function ThesisWidget({ driver }: { driver: EPSGrowthDriver }) {
  // Detect if this is a risk (negative contribution or factor name contains "Risk")
  const isRisk = (driver.contribution_percent !== undefined && driver.contribution_percent < 0) || 
                 (driver.factor && driver.factor.toLowerCase().includes('risk'));

  return (
    <div className={'bg-gradient-to-br ' + (isRisk ? 'from-red-50 to-orange-50' : 'from-white to-gray-50') + ' rounded-lg border ' + (isRisk ? 'border-red-200' : 'border-gray-200') + ' p-2 hover:shadow-sm transition-shadow'}>
      {/* Header with Factor Name and EPS Contribution */}
      <div className="flex items-center justify-between mb-2">
        <h4 className={'text-[11px] font-bold ' + (isRisk ? 'text-red-900' : 'text-gray-900') + ' leading-tight'}>{driver.factor || 'Unknown Factor'}</h4>
        {driver.contribution_percent !== undefined && (
          <span className={'text-[10px] font-semibold ' + (isRisk ? 'text-red-700 bg-red-100' : 'text-blue-700 bg-blue-100') + ' px-1.5 py-0.5 rounded'}>
            {driver.contribution_percent >= 0 ? '+' : ''}{driver.contribution_percent.toFixed(1)}% EPS
          </span>
        )}
      </div>

      {/* Thesis Points - Prominent */}
      {driver.thesis_points && driver.thesis_points.length > 0 && (
        <div className="mb-2 space-y-1">
          {driver.thesis_points.slice(0, 3).map((point, ptIdx) => (
            <div key={ptIdx} className="flex items-start gap-1.5 text-[10px] text-gray-800 leading-relaxed">
              <span className={(isRisk ? 'text-red-600' : 'text-blue-600') + ' mt-0.5 flex-shrink-0 font-bold'}>•</span>
              <span className="line-clamp-2">{point}</span>
            </div>
          ))}
          {driver.thesis_points.length > 3 && (
            <div className="text-[9px] text-gray-500 mt-1">
              +{driver.thesis_points.length - 3} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual KPI Metric Widget
function KPIMetricWidget({ metric }: { metric: KPIMetric }) {
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

  const formatValue = (value: number): string => {
    if (metric.unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (metric.unit === '$B') {
      return '$' + value.toFixed(1) + 'B';
    }
    return value.toFixed(1);
  };

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 p-2 hover:shadow-sm transition-shadow">
      {/* Header with Metric Name */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-bold text-gray-900 leading-tight">{metric.name}</h4>
        {metric.trend && (
          <div className={'flex-shrink-0 ' + (
            metric.trend === 'up' ? 'text-green-600' : 
            metric.trend === 'down' ? 'text-red-600' : 
            'text-gray-500'
          )}>
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

      {/* KPI Data - Secondary (matching CombinedWidget layout) */}
      <div className="mt-2">
        {/* Current Value */}
        {metric.values.length > 0 && (
          <div className="mb-1">
            <div className={'text-xs font-semibold ' + (isPositiveTrend ? 'text-green-600' : 'text-gray-600')}>
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
                    className={'rounded-t transition-all ' + (
                      isLatest
                        ? isPositiveTrend ? 'bg-green-400' : 'bg-gray-400'
                        : 'bg-gray-300'
                    )}
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
            <div className="flex justify-between mt-0.5 text-[7px] text-gray-400">
              <span>{chartData[chartData.length - 1]?.period}</span>
              <span>{chartData[0]?.period}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

