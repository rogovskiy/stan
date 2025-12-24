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
  eps_adjusted?: number;
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

// Quarterly Analysis interfaces
export interface EPSGrowthDriver {
  factor: string; // e.g., "Services Revenue Growth", "Margin Expansion", "Product Sales"
  contribution_percent: number; // Percentage contribution to EPS growth (e.g., 6.5 for 6.5%)
  description?: string; // Optional description of how this factor contributes
  // Thesis points explaining why this growth will happen
  thesis_points?: string[]; // Bullet points explaining the reasoning/thesis
  // Evidence showing why this is achievable
  achievability_evidence?: {
    metric_name: string; // e.g., "Services Revenue YoY Growth"
    current_value: number | string; // e.g., 14.5 or "14.5%"
    historical_trend?: number[]; // Historical values showing trend (e.g., [12.0, 13.2, 14.5])
    supporting_fact?: string; // Text explaining why this is achievable
  }[];
}

export interface GrowthThesis {
  title: string;
  summary: string;
  detailed_explanation: string;
  supporting_evidence: string[];
  strength: 'high' | 'medium' | 'low';
  // EPS growth information
  expected_eps_growth?: number; // Expected EPS growth percentage (e.g., 10 for 10%)
  eps_growth_drivers?: EPSGrowthDriver[]; // Breakdown of factors contributing to EPS growth
}

export interface QuarterHighlight {
  text: string; // e.g., "iPhone 15 sales 10%", "China expansion +10%"
  impact?: string; // e.g., "+3% EPS", "for 3 quarters"
  trend?: 'up' | 'down' | 'neutral'; // Direction indicator
}

export interface KPIMetric {
  name: string; // e.g., "iPhone Sales in China", "Efficiency Ratio"
  unit?: string; // e.g., "%", "$B", "ratio"
  values: number[]; // Historical values (most recent first, e.g., [latest, previous, older])
  labels?: string[]; // Optional labels for each value (e.g., ["Q1", "Q4", "Q3"])
  trend?: 'up' | 'down' | 'stable'; // Overall trend
  description?: string; // Brief description of why this matters
}

export interface Initiative {
  title: string;
  summary: string;
  cumulative_progress: string;
  last_quarter_progress: string;
  status: 'new' | 'on track' | 'at risk';
  bullet_points: string[];
}

export interface QuarterlyAnalysis {
  ticker: string;
  quarter_key: string; // e.g., "2025Q1"
  summary?: string; // Paragraph with bullet points (from quarterly_highlights)
  initiatives: Initiative[]; // Primary data from database
  business_model?: {
    summary?: string;
    industry?: string;
    maturity_level?: string;
  }; // From database (optional, for future use)
  changes?: Array<{
    sentence: string;
    type: 'good' | 'bad' | 'neutral';
  }>; // From database (optional, for future use)
  headline_bullets?: Array<{
    text: string;
    indicator: 'up' | 'down' | 'neutral';
  }>; // From database - for quarter highlights display
  quarterly_highlights?: string; // From database
  overall_quarter_strength?: 'up' | 'down' | 'neutral'; // Overall quarter performance strength
  // Preserved for UI compatibility
  growth_theses?: GrowthThesis[]; // Optional, for backward compatibility
  created_at?: string;
  source_documents?: string[];
  num_documents?: number;
  // Historical and current EPS data for visualization
  historical_eps?: {
    two_quarters_ago?: number; // EPS from 2 quarters back
    one_quarter_ago?: number; // EPS from 1 quarter back
    current?: number; // Current quarter EPS
  };
  // Top highlights for timeline summary (up to 3)
  highlights?: QuarterHighlight[];
  // Key performance indicators / growth factors
  kpi_metrics?: KPIMetric[];
}

export interface QuarterlyAnalysisResponse {
  symbol: string;
  data: QuarterlyAnalysis[];
  metadata?: {
    lastUpdated: string;
  };
}