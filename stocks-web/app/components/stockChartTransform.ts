import { DailyDataPoint, QuarterlyDataPoint } from '../types/api';
import { calculateFairValue, getTrailing4QuartersEps, calculateAnnualEps, QuarterlyDataPoint as CalcQuarterlyDataPoint, getFiscalYearAndQuarter } from '../lib/calculations';

export interface TransformedDataPoint {
  date: string;
  fullDate: string;
  stockPrice: number | undefined;
  estimated: boolean;
  year: number;
  frequency: string;
  marketCap: number | null;
  volume: number;
  fairValue: number | null;
  normalPEValue: number | null; // Renamed from fairValueEpsAdjusted
  earnings: number | null;
  eps_adjusted: number | null;
  normalPE: number | null;
  dividendsPOR: number | null;
  hasQuarterlyData: boolean;
  peRatio: number | null;
  revenue: number | null;
  dividend: number | null;
  dividendScaled: number | null;
  calculatedNormalPE: number | null; // Store normal PE for tooltip
  fiscalYear?: number; // Fiscal year for date formatting
  fiscalQuarter?: number; // Fiscal quarter (1-4) for date formatting
}

// Interface for enriched quarterly data with price
interface EnrichedQuarterlyDataPoint extends QuarterlyDataPoint {
  stockPrice: number | null;
}

// Interface for quarterly data with calculated metrics
// Omit conflicting properties from base interface before adding calculated ones
interface CalculatedQuarterlyDataPoint extends Omit<EnrichedQuarterlyDataPoint, 'fairValue' | 'eps_adjusted'> {
  fairValue: number | null; // Override optional to required with null
  normalPEValue: number | null;
  peRatio: number | null;
  dividend: number;
  dividendScaled: number | null;
  revenue: number | null;
  eps_adjusted: number | null; // Override optional to allow null
}

/**
 * Step 1: Enrich quarterly data with prices from daily data
 * For each quarterly date, find the nearest available price from daily data
 */
export function enrichQuarterlyWithPrices(
  quarterlyData: QuarterlyDataPoint[],
  dailyData: DailyDataPoint[]
): EnrichedQuarterlyDataPoint[] {
  // Sort daily data by date for efficient lookup
  const sortedDailyData = [...dailyData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  // Create a map of daily prices by date for exact matching
  const dailyPriceMap = new Map<string, number>();
  sortedDailyData.forEach(d => {
    if (d.price !== undefined && d.price !== null) {
      dailyPriceMap.set(d.date, d.price);
    }
  });
  
  return quarterlyData.map(q => {
    // Try exact date match first
    let stockPrice: number | null = null;
    
    if (dailyPriceMap.has(q.date)) {
      stockPrice = dailyPriceMap.get(q.date)!;
    } else {
      // Find nearest available price (within 30 days)
      const qDate = new Date(q.date);
      const maxDaysDiff = 30;
      let closestPrice: number | null = null;
      let minDaysDiff = Infinity;
      
      sortedDailyData.forEach(d => {
        if (d.price === undefined || d.price === null) return;
        
        const dDate = new Date(d.date);
        const daysDiff = Math.abs((dDate.getTime() - qDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff < minDaysDiff && daysDiff <= maxDaysDiff) {
          minDaysDiff = daysDiff;
          closestPrice = d.price;
        }
      });
      
      stockPrice = closestPrice;
    }
    
    return {
      ...q,
      stockPrice
    };
  });
}

/**
 * Step 2: Calculate derived metrics on enriched quarterly data
 */
export function calculateQuarterlyMetrics(
  enrichedQuarterly: EnrichedQuarterlyDataPoint[],
  normalPERatio: number | null,
  fairValueRatio: number
): CalculatedQuarterlyDataPoint[] {
  // Convert to calculation format for trailing quarters lookup
  const calcQuarterlyData: CalcQuarterlyDataPoint[] = enrichedQuarterly.map(q => ({
    date: q.date,
    eps_adjusted: q.eps_adjusted ?? null,
    earnings: q.eps ?? null,
    stockPrice: q.stockPrice
  }));
  
  return enrichedQuarterly.map(q => {
    const currentDate = new Date(q.date);
    const trailing4Quarters = getTrailing4QuartersEps(calcQuarterlyData, currentDate);
    
    // Calculate annual EPS from trailing 4 quarters
    let annualEps: number | null = null;
    if (trailing4Quarters.length > 0) {
      const quarterlyEpsValues = trailing4Quarters.map(tq => {
        return tq.eps_adjusted !== null && tq.eps_adjusted !== undefined 
          ? tq.eps_adjusted 
          : (tq.earnings || 0);
      });
      annualEps = calculateAnnualEps(quarterlyEpsValues);
    }
    
    // Calculate fairValue
    const fairValue = calculateFairValue(annualEps, fairValueRatio);
    
    // Calculate normalPEValue (trailing 4Q EPS × normalPERatio)
    let normalPEValue: number | null = null;
    if (annualEps !== null && normalPERatio !== null) {
      normalPEValue = annualEps * normalPERatio;
    }
    
    // Calculate peRatio (price / annual EPS)
    let peRatio: number | null = null;
    if (q.stockPrice !== null && q.stockPrice !== undefined && q.stockPrice > 0 && annualEps !== null && annualEps > 0) {
      peRatio = q.stockPrice / annualEps;
    }
    
    // Calculate dividend (similar logic to original)
    const eps = q.eps || 0;
    const annualDividendYield = (q.dividendsPOR || 0) / 100;
    const quarterlyDividendAmount = (q.stockPrice || 0) * annualDividendYield / 4;
    const payoutRatio = 0.3 + (Math.random() * 0.4);
    const epsBasedDividend = Math.max(eps * payoutRatio / 4, quarterlyDividendAmount);
    const dividend = Math.max(epsBasedDividend, 0.5);
    
    // Calculate dividendScaled (dividend × PE ratio)
    const dividendScaled = dividend !== null && peRatio !== null
      ? dividend * peRatio
      : null;
    
    // Calculate revenue
    const revenue = eps ? (eps * 4 * 16.0) : null;
    
    return {
      ...q,
      fairValue,
      normalPEValue,
      peRatio,
      dividend,
      dividendScaled,
      revenue,
      // Keep original fields
      eps_adjusted: q.eps_adjusted !== undefined && q.eps_adjusted !== null 
        ? q.eps_adjusted 
        : eps
    };
  });
}

/**
 * Step 3: Combine enriched quarterly data with daily price data for charting
 */
export function combineDataForCharting(
  enrichedQuarterly: CalculatedQuarterlyDataPoint[],
  dailyData: DailyDataPoint[],
  normalPERatio: number | null
): TransformedDataPoint[] {
  // Create a map of enriched quarterly data by date
  const quarterlyMap = new Map<string, CalculatedQuarterlyDataPoint>();
  enrichedQuarterly.forEach(q => {
    quarterlyMap.set(q.date, q);
  });
  
  // Sort daily data by date
  const sortedDailyData = [...dailyData].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  const chartData: TransformedDataPoint[] = [];
  
  // Add all daily price points
  sortedDailyData.forEach(daily => {
    const quarterlyDataForThisDate = quarterlyMap.get(daily.date);
    
    const basePoint: TransformedDataPoint = {
      date: daily.fyDate || daily.date.slice(5, 7) + '/' + daily.date.slice(2, 4), // MM/YY format
      fullDate: daily.date,
      stockPrice: daily.price,
      estimated: daily.estimated,
      year: daily.year,
      frequency: 'daily',
      marketCap: daily.price ? (daily.price * 16.0) : null,
      volume: 1500000 + Math.random() * 1000000,
      fairValue: null,
      normalPEValue: null,
      earnings: null,
      eps_adjusted: null,
      normalPE: null,
      dividendsPOR: null,
      hasQuarterlyData: false,
      peRatio: null,
      revenue: null,
      dividend: null,
      dividendScaled: null,
      calculatedNormalPE: null
    };
    
    // If this date has quarterly data, enrich the point
    if (quarterlyDataForThisDate) {
      Object.assign(basePoint, {
        fairValue: quarterlyDataForThisDate.fairValue,
        normalPEValue: quarterlyDataForThisDate.normalPEValue,
        earnings: quarterlyDataForThisDate.eps || null,
        eps_adjusted: quarterlyDataForThisDate.eps_adjusted ?? null,
        normalPE: quarterlyDataForThisDate.normalPE || null,
        dividendsPOR: quarterlyDataForThisDate.dividendsPOR || null,
        hasQuarterlyData: true,
        peRatio: quarterlyDataForThisDate.peRatio,
        revenue: quarterlyDataForThisDate.revenue,
        dividend: quarterlyDataForThisDate.dividend,
        dividendScaled: quarterlyDataForThisDate.dividendScaled,
        calculatedNormalPE: normalPERatio
      });
    }
    
    chartData.push(basePoint);
  });
  
  // Add any quarterly data points that don't have matching daily data
  enrichedQuarterly.forEach(q => {
    if (!chartData.find(d => d.fullDate === q.date)) {
      chartData.push({
        date: q.fyDate || q.date.slice(5, 7) + '/' + q.date.slice(2, 4),
        fullDate: q.date,
        stockPrice: q.stockPrice ?? undefined,
        estimated: q.estimated,
        year: q.year,
        frequency: 'quarterly',
        marketCap: q.stockPrice ? (q.stockPrice * 16.0) : null,
        volume: 1500000 + Math.random() * 1000000,
        fairValue: q.fairValue,
        normalPEValue: q.normalPEValue,
        earnings: q.eps || null,
        eps_adjusted: q.eps_adjusted ?? null,
        normalPE: q.normalPE || null,
        dividendsPOR: q.dividendsPOR || null,
        hasQuarterlyData: true,
        peRatio: q.peRatio,
        revenue: q.revenue,
        dividend: q.dividend,
        dividendScaled: q.dividendScaled,
        calculatedNormalPE: normalPERatio
      });
    }
  });
  
  // Sort by date
  return chartData.sort((a, b) => 
    new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime()
  );
}

/**
 * Calculate table data from chart data, filtering by ticks and aggregating when in yearly mode
 */
export function calculateTableData(
  filteredStockData: TransformedDataPoint[],
  xAxisTicks: string[],
  isQuarterlyMode: boolean,
  fiscalYearEndMonth: number
): TransformedDataPoint[] {
  if (xAxisTicks.length === 0) return [];
  
  // If quarterly mode, filter by exact tick dates and add fiscal info
  if (isQuarterlyMode) {
    const tickDatesSet = new Set(xAxisTicks);
    return filteredStockData
      .filter(item => tickDatesSet.has(item.fullDate) && item.hasQuarterlyData)
      .map(item => {
        // Add fiscal year and quarter if not already present
        if (item.fiscalYear === undefined || item.fiscalQuarter === undefined) {
          const date = new Date(item.fullDate);
          const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
          return {
            ...item,
            fiscalYear: fiscalInfo.fiscalYear,
            fiscalQuarter: fiscalInfo.fiscalQuarter
          };
        }
        return item;
      });
  }
  
  // If yearly mode, extract fiscal years from ticks and get ALL quarterly data for those fiscal years
  const tickFiscalYears = new Set(
    xAxisTicks.map(dateStr => {
      const date = new Date(dateStr);
      return getFiscalYearAndQuarter(date, fiscalYearEndMonth).fiscalYear;
    })
  );
  
  // Get all quarterly data points for the fiscal years in ticks
  const quarterlyDataPoints = filteredStockData.filter(item => {
    if (!item.hasQuarterlyData) return false;
    const date = new Date(item.fullDate);
    const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
    return tickFiscalYears.has(fiscalInfo.fiscalYear);
  });
  
  // Aggregate data by fiscal year
  const yearlyData = new Map<number, {
    fullDate: string;
    fiscalYear: number;
    stockPrice: number | null;
    earnings: number[];
    eps_adjusted: number[];
    dividend: number[];
    quarterCount: number; // Track number of quarters for this fiscal year
  }>();
  
  quarterlyDataPoints.forEach(item => {
    const date = new Date(item.fullDate);
    const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
    const fiscalYear = fiscalInfo.fiscalYear;
    
    if (!yearlyData.has(fiscalYear)) {
      yearlyData.set(fiscalYear, {
        fullDate: item.fullDate, // Keep the last date of the fiscal year
        fiscalYear,
        stockPrice: null,
        earnings: [],
        eps_adjusted: [],
        dividend: [],
        quarterCount: 0
      });
    }
    
    const yearData = yearlyData.get(fiscalYear)!;
    
    // Use stock price from the last quarter of the fiscal year
    if (item.stockPrice !== null && item.stockPrice !== undefined) {
      // Update to the latest stock price in the fiscal year
      if (yearData.stockPrice === null || new Date(item.fullDate) > new Date(yearData.fullDate)) {
        yearData.stockPrice = item.stockPrice;
      }
    }
    
    if (item.earnings !== null && item.earnings !== undefined) {
      yearData.earnings.push(item.earnings);
      yearData.quarterCount++;
    }
    // Use eps_adjusted if available, otherwise fall back to earnings
    const epsAdjustedValue = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
      ? item.eps_adjusted 
      : item.earnings;
    if (epsAdjustedValue !== null && epsAdjustedValue !== undefined) {
      // Only increment once per quarter (earnings already counted)
      if (item.earnings === null || item.earnings === undefined) {
        yearData.quarterCount++;
      }
      yearData.eps_adjusted.push(epsAdjustedValue);
    }
    if (item.dividend !== null && item.dividend !== undefined) {
      yearData.dividend.push(item.dividend);
    }
    
    // Update fullDate to the latest date in the year
    if (new Date(item.fullDate) > new Date(yearData.fullDate)) {
      yearData.fullDate = item.fullDate;
    }
  });
  
  // Convert aggregated data back to TransformedDataPoint format
  const sortedYearlyData = Array.from(yearlyData.values())
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  
  return sortedYearlyData.map((yearData, index) => {
    const isLastYear = index === sortedYearlyData.length - 1;
    const hasIncompleteYear = isLastYear && yearData.quarterCount < 4;
    
    // Calculate annual EPS
    let annualEps: number | null = null;
    if (yearData.eps_adjusted.length > 0) {
      const sumEps = yearData.eps_adjusted.reduce((sum, val) => sum + val, 0);
      // If incomplete year (less than 4 quarters), project full year by annualizing
      if (hasIncompleteYear && yearData.quarterCount > 0) {
        annualEps = (sumEps / yearData.quarterCount) * 4;
      } else {
        annualEps = sumEps;
      }
    }
    
    return {
      fullDate: yearData.fullDate,
      date: yearData.fiscalYear.toString(),
      stockPrice: yearData.stockPrice ?? undefined, // Convert null to undefined
      estimated: hasIncompleteYear, // Mark as estimated if incomplete year
      year: yearData.fiscalYear,
      frequency: 'yearly',
      marketCap: null,
      volume: 0,
      fairValue: null,
      normalPEValue: null, // Quarterly metric, not applicable for yearly aggregation
      earnings: yearData.earnings.length > 0 
        ? (hasIncompleteYear && yearData.quarterCount > 0
            ? (yearData.earnings.reduce((sum, val) => sum + val, 0) / yearData.quarterCount) * 4
            : yearData.earnings.reduce((sum, val) => sum + val, 0))
        : null,
      eps_adjusted: annualEps,
      normalPE: null,
      dividendsPOR: null,
      hasQuarterlyData: true,
      peRatio: null, // Will be calculated in the table display
      revenue: null,
      dividend: yearData.dividend.length > 0 
        ? yearData.dividend.reduce((sum, val) => sum + val, 0) 
        : null,
      dividendScaled: null,
      calculatedNormalPE: null,
      fiscalYear: yearData.fiscalYear,
      fiscalQuarter: undefined // No quarter for yearly aggregation
    };
  });
}

// Transform API daily/quarterly data into chart-ready points.
// This function is kept for backward compatibility but now uses the new streamlined functions
export const transformApiDataForChart = (
  dailyData: DailyDataPoint[], 
  quarterlyData: QuarterlyDataPoint[] = [],
  fairValueRatio: number = 18,
  normalPERatio: number | null = null
): TransformedDataPoint[] => {
  // Use the new streamlined approach
  const enrichedQuarterly = enrichQuarterlyWithPrices(quarterlyData, dailyData);
  const calculatedQuarterly = calculateQuarterlyMetrics(enrichedQuarterly, normalPERatio, fairValueRatio);
  return combineDataForCharting(calculatedQuarterly, dailyData, normalPERatio);
};


