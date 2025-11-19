export interface DataPoint {
  date: string;
  fyDate: string;
  year: number;
  estimated: boolean;
  frequency: 'daily' | 'quarterly';
  price?: number;
  eps?: number;
  normalPE?: number;
  fairValue?: number;
  dividendsPOR?: number;
}

export interface ChartSeries {
  dataKey: string;
  type: 'line' | 'area';
  color: string;
  label: string;
  yAxisId: 'left' | 'right';
  strokeWidth?: number;
  fillOpacity?: number;
  visible: boolean;
  frequency: 'daily' | 'quarterly';
  interpolation: 'linear' | 'step';
}

export interface ChartConfig {
  title: string;
  height: number;
  timeRange: {
    start: string;
    end: string;
    defaultPeriod: string;
  };
  series: ChartSeries[];
}

export interface HistoricalChartResponse {
  symbol: string;
  companyName: string;
  currency: string;
  data: DataPoint[];
  chartConfig: ChartConfig;
  metadata: {
    lastUpdated: string;
    dataRange: {
      start: string;
      end: string;
    };
    frequencies: string[];
  };
}

// New interfaces for separated data
export interface DailyPriceResponse {
  symbol: string;
  companyName: string;
  currency: string;
  data: DailyDataPoint[];
  metadata: {
    lastUpdated: string;
    dataRange: {
      start: string;
      end: string;
    };
  };
}

export interface QuarterlyDataResponse {
  symbol: string;
  data: QuarterlyDataPoint[];
  metadata: {
    lastUpdated: string;
    dataRange: {
      start: string;
      end: string;
    };
  };
}

export interface DailyDataPoint {
  date: string;
  fyDate: string;
  year: number;
  price: number;
  estimated: boolean;
}

export interface QuarterlyDataPoint {
  date: string;
  fyDate: string;
  year: number;
  quarter: string;
  eps: number;
  normalPE?: number;
  fairValue?: number;
  dividendsPOR?: number;
  estimated: boolean;
}

// Legacy interface for backwards compatibility
export interface APIResponse {
  symbol: string;
  companyName: string;
  currency: string;
  data: DataPoint[];
  chartConfig: ChartConfig;
  metadata: {
    lastUpdated: string;
    dataRange: {
      start: string;
      end: string;
    };
    frequencies: string[];
  };
}