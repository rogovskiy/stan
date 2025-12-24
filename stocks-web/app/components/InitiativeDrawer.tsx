'use client';

import { useMemo } from 'react';
import { Initiative, KPIMetric } from '../types/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import AnalysisChart from './AnalysisChart';

interface InitiativeDrawerProps {
  initiative: Initiative;
  kpi?: KPIMetric;
  ticker: string;
  onClose: () => void;
}

// Status Badge Component
function StatusBadge({ status }: { status: 'new' | 'on track' | 'at risk' }) {
  const getStatusColor = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'bg-green-100 text-green-800 border-green-200';
      case 'on track': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'at risk': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'New';
      case 'on track': return '';
      case 'at risk': return 'At Risk';
      default: return status;
    }
  };

  const label = getStatusLabel(status);
  
  // For 'on track', show an icon instead of text
  if (status === 'on track') {
    return (
      <span className={`px-3 py-1 text-sm font-semibold rounded-md border flex items-center justify-center ${getStatusColor(status)}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`px-3 py-1 text-sm font-semibold rounded-md border ${getStatusColor(status)}`}>
      {label}
    </span>
  );
}

// KPI Chart Component
function KPIChart({ kpi }: { kpi: KPIMetric }) {
  const chartData = useMemo(() => {
    return kpi.values.map((value, idx) => ({
      period: kpi.labels?.[idx] || `Q${kpi.values.length - idx}`,
      value: value
    })).reverse(); // Reverse to show oldest to newest
  }, [kpi]);

  const maxValue = Math.max(...kpi.values, 0);
  const minValue = Math.min(...kpi.values, 0);
  const range = maxValue - minValue || 1;
  const isPositiveTrend = kpi.trend === 'up' || (kpi.values.length >= 2 && kpi.values[0] > kpi.values[kpi.values.length - 1]);

  const formatValue = (value: number): string => {
    if (kpi.unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (kpi.unit === '$B') {
      return '$' + value.toFixed(1) + 'B';
    }
    return value.toFixed(1);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold text-gray-900">{data.period}</p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">{kpi.name}:</span> {formatValue(data.value)}
          </p>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) return null;

  const yAxisDomain = [Math.max(0, minValue * 0.9), maxValue * 1.15];

  return (
    <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h4 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-4">
        {kpi.name}
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
            tickFormatter={(value) => {
              if (kpi.unit === '%') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
              if (kpi.unit === '$B') return `$${value.toFixed(1)}B`;
              return value.toFixed(1);
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => {
              const isLatest = index === chartData.length - 1;
              const color = isLatest 
                ? (isPositiveTrend ? '#10b981' : '#ef4444')
                : '#94a3b8';
              return <Cell key={`cell-${index}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-gray-400"></div>
          <span className="text-gray-600">Historical</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded ${isPositiveTrend ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-gray-600">Latest</span>
        </div>
      </div>
    </div>
  );
}

export function InitiativeDrawer({
  initiative,
  kpi,
  ticker,
  onClose
}: InitiativeDrawerProps) {
  return (
    <>
      <div
        className="fixed inset-0 bg-transparent z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {initiative.title}
              </h2>
              <p className="text-sm text-gray-600 capitalize">
                {initiative.status === 'new' ? 'New Initiative' : 
                 initiative.status === 'on track' ? 'On Track' : 
                 'At Risk'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-4"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Initiative Summary */}
          {initiative.summary && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
                Summary
              </h4>
              <p className="text-gray-700 leading-relaxed">
                {initiative.summary}
              </p>
            </div>
          )}

          {/* Cumulative Progress */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
              Cumulative Progress
            </h4>
            {initiative.cumulative_progress && initiative.cumulative_progress.trim() ? (
              <p className="text-gray-700 leading-relaxed">
                {initiative.cumulative_progress}
              </p>
            ) : (
              <p className="text-gray-500 italic">No cumulative progress data available</p>
            )}
          </div>

          {/* Last Quarter Progress */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
              Last Quarter Progress
            </h4>
            {initiative.last_quarter_progress && initiative.last_quarter_progress.trim() ? (
              <p className="text-gray-700 leading-relaxed">
                {initiative.last_quarter_progress}
              </p>
            ) : (
              <p className="text-gray-500 italic">No last quarter progress data available</p>
            )}
          </div>

          {/* Key Points */}
          {initiative.bullet_points && initiative.bullet_points.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
                Key Points
              </h4>
              <ul className="space-y-2.5">
                {initiative.bullet_points.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-gray-700">
                    <span className="text-blue-600 mt-1.5 flex-shrink-0 text-lg font-bold">•</span>
                    <span className="leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* KPI Chart */}
          {kpi && (
            <div className="mb-6">
              <KPIChart kpi={kpi} />
            </div>
          )}

          {/* Initiative Chart */}
          {initiative.chart && (
            <div className="mb-6">
              <AnalysisChart
                chartSpec={initiative.chart}
                ticker={ticker}
                height={300}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

