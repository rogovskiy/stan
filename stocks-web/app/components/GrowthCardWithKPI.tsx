'use client';

import { useMemo } from 'react';
import { KPIMetric, EPSGrowthDriver } from '../types/api';

interface GrowthCardWithKPIProps {
  metric: KPIMetric;
  driver: EPSGrowthDriver;
}

export function GrowthCardWithKPI({ metric, driver }: GrowthCardWithKPIProps) {
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

