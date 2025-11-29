'use client';

import { useMemo } from 'react';

type IntervalOption = {
  value: string;
  label: string;
};

interface PeriodSelectorProps {
  currentPeriod: string;
  onPeriodChange: (period: string) => void;
  maxYears?: number; // Maximum years of data available
}

export default function PeriodSelector({ currentPeriod, onPeriodChange, maxYears }: PeriodSelectorProps) {
  // Dynamically generate interval options based on available data
  const intervalOptions = useMemo((): IntervalOption[] => {
    const options: IntervalOption[] = [{ value: 'max', label: 'Max' }];
    
    // If maxYears is provided, generate options up to that value
    // Otherwise, default to 10 years (fallback)
    const max = maxYears || 10;
    
    // Generate options from max down to 1 year
    // Cap at 20 years for UI practicality (can be adjusted if needed)
    for (let years = Math.min(max, 20); years >= 1; years--) {
      options.push({
        value: `${years}y`,
        label: `${years}Y`
      });
    }
    
    return options;
  }, [maxYears]);

  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
      {intervalOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => onPeriodChange(option.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
            currentPeriod === option.value
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

