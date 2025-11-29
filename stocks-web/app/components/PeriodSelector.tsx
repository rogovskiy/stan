'use client';

type IntervalOption = {
  value: string;
  label: string;
};

const INTERVAL_OPTIONS: IntervalOption[] = [
  { value: 'max', label: 'Max' },
  { value: '10y', label: '10Y' },
  { value: '9y', label: '9Y' },
  { value: '8y', label: '8Y' },
  { value: '7y', label: '7Y' },
  { value: '6y', label: '6Y' },
  { value: '5y', label: '5Y' },
  { value: '4y', label: '4Y' },
  { value: '3y', label: '3Y' },
  { value: '2y', label: '2Y' },
  { value: '1y', label: '1Y' }
];

interface PeriodSelectorProps {
  currentPeriod: string;
  onPeriodChange: (period: string) => void;
}

export default function PeriodSelector({ currentPeriod, onPeriodChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
      {INTERVAL_OPTIONS.map((option) => (
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

