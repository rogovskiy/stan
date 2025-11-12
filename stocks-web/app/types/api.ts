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