'use client';

import { ValuationMethod } from '../types/api';

interface ValuationChartSelectorProps {
  methods: ValuationMethod[];
  selectedMethod: string | null;
  onMethodChange: (method: string) => void;
}

export default function ValuationChartSelector({ 
  methods, 
  selectedMethod, 
  onMethodChange 
}: ValuationChartSelectorProps) {
  // Sort methods by preference order
  const sortedMethods = [...methods].sort((a, b) => a.preference_order - b.preference_order);

  if (sortedMethods.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
      {sortedMethods.map((method) => (
        <button
          key={method.method}
          onClick={() => onMethodChange(method.method)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
            selectedMethod === method.method
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
          title={method.explanation}
        >
          {method.method}
        </button>
      ))}
    </div>
  );
}

