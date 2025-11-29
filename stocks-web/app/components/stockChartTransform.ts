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
 * Generate future quarterly forecast data points based on continuous EPS growth
 * 
 * @param latestQuarterly - The most recent quarterly data point (actual data)
 * @param quarterlyGrowthRate - Quarterly growth rate (as decimal, e.g., 0.05 for 5%)
 * @param forecastYears - Number of fiscal years to forecast
 * @param fiscalYearEndMonth - Fiscal year end month (1-12)
 * @param normalPERatio - Normal P/E ratio for calculations
 * @param fairValueRatio - Fair value ratio (typically 18)
 * @returns Array of forecasted quarterly data points
 */
function generateFutureQuarterlyForecasts(
  latestQuarterly: CalculatedQuarterlyDataPoint,
  quarterlyGrowthRate: number | null,
  forecastYears: number,
  fiscalYearEndMonth: number,
  normalPERatio: number | null,
  fairValueRatio: number
): CalculatedQuarterlyDataPoint[] {
  if (!quarterlyGrowthRate || quarterlyGrowthRate === null) {
    return []; // Cannot generate forecasts without growth rate
  }

  const forecasts: CalculatedQuarterlyDataPoint[] = [];
  const numQuarters = forecastYears * 4;
  
  // Get the latest quarter's date and fiscal info
  const latestDate = new Date(latestQuarterly.date);
  const latestFiscalInfo = getFiscalYearAndQuarter(latestDate, fiscalYearEndMonth);
  
  // Start with the latest quarter's EPS values
  let currentEps = latestQuarterly.eps_adjusted ?? latestQuarterly.eps ?? 0;
  let currentEarnings = latestQuarterly.eps ?? 0;
  
  if (currentEps <= 0) {
    return []; // Cannot generate forecasts without valid EPS
  }
  
  // Start with the latest quarter's dividend value
  // If no dividend is available, estimate it from EPS and payout ratio
  let currentDividend = latestQuarterly.dividend ?? 0;
  if (currentDividend <= 0 && latestQuarterly.dividendsPOR) {
    // Calculate dividend from EPS and payout ratio (dividendsPOR is annual percentage)
    const annualPayoutRatio = (latestQuarterly.dividendsPOR ?? 0) / 100;
    const annualDividend = currentEps * 4 * annualPayoutRatio; // Annual dividend
    currentDividend = annualDividend / 4; // Quarterly dividend
  }
  
  // Calculate fiscal year start month (month after fiscal year end)
  const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
  
  // Start forecasting from the next quarter after the latest one
  let currentFiscalYear = latestFiscalInfo.fiscalYear;
  let currentFiscalQuarter = latestFiscalInfo.fiscalQuarter;
  
  // Calculate next quarter
  let nextQuarter = currentFiscalQuarter + 1;
  let nextFiscalYear = currentFiscalYear;
  
  if (nextQuarter > 4) {
    nextQuarter = 1;
    nextFiscalYear += 1;
  }
  
  // Build up trailing quarters for each forecast (include actual latest + previous forecasts)
  const allQuarterlyPoints: Array<{ date: string; eps_adjusted: number; earnings: number }> = [
    {
      date: latestQuarterly.date,
      eps_adjusted: latestQuarterly.eps_adjusted ?? latestQuarterly.eps ?? 0,
      earnings: latestQuarterly.eps ?? 0
    }
  ];
  
  // Generate forecast quarters
  for (let i = 0; i < numQuarters; i++) {
    // Calculate the quarter's end date
    // Quarters end at: Q1=month 3, Q2=month 6, Q3=month 9, Q4=month 12 (of the fiscal year)
    // Fiscal year number corresponds to the calendar year in which it ends
    // For FY2025 ending Sep 2025: Q1 is in previous calendar year (2024), Q2-Q4 are in 2025
    const monthsIntoFiscalYear = nextQuarter * 3; // Q1=3, Q2=6, Q3=9, Q4=12
    let quarterEndMonth = fiscalYearStartMonth + monthsIntoFiscalYear - 1;
    
    // Determine calendar year: fiscal year number is the year it ends
    // Q1 falls in the previous calendar year, Q2-Q4 in the fiscal year's calendar year
    let quarterYear = nextFiscalYear; // Fiscal year number = year it ends
    if (nextQuarter === 1) {
      quarterYear = nextFiscalYear - 1; // Q1 is in the previous calendar year
    }
    
    // Adjust month if it wraps around the calendar year
    // When month > 12, subtract 12 but don't increment year (Q2-Q4 are in fiscal year's calendar year)
    if (quarterEndMonth > 12) {
      quarterEndMonth = quarterEndMonth - 12;
      // Don't increment quarterYear - we're already in the correct calendar year for Q2-Q4
      // For Q1, we already set it to the previous year above
    } else if (quarterEndMonth < 1) {
      quarterEndMonth = quarterEndMonth + 12;
      quarterYear -= 1;
    }
    
    // Use approximate quarter end date (last day of the quarter's last month)
    const daysInMonth = new Date(quarterYear, quarterEndMonth, 0).getDate();
    const quarterDate = new Date(quarterYear, quarterEndMonth - 1, daysInMonth); // month is 0-indexed
    const quarterDateStr = quarterDate.toISOString().split('T')[0];
    
    // Apply quarterly growth rate to EPS
    currentEps = currentEps * (1 + quarterlyGrowthRate);
    currentEarnings = currentEarnings * (1 + quarterlyGrowthRate);
    
    // Apply same growth rate to dividends (assuming dividends grow with earnings)
    currentDividend = currentDividend * (1 + quarterlyGrowthRate);
    
    // Add this forecast to the quarterly points for trailing calculation
    allQuarterlyPoints.push({
      date: quarterDateStr,
      eps_adjusted: currentEps,
      earnings: currentEarnings
    });
    
    // Get trailing 4 quarters for this forecast point
    const trailing4Quarters = allQuarterlyPoints
      .filter(q => new Date(q.date) <= quarterDate)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 4);
    
    // Calculate annual EPS from trailing 4 quarters
    let annualEps: number | null = null;
    if (trailing4Quarters.length > 0) {
      const quarterlyEpsValues = trailing4Quarters.map(q => q.eps_adjusted);
      annualEps = calculateAnnualEps(quarterlyEpsValues);
    }
    
    // Calculate derived metrics
    const fairValue = calculateFairValue(annualEps, fairValueRatio);
    const normalPEValue = annualEps !== null && normalPERatio !== null 
      ? annualEps * normalPERatio 
      : null;
    
    // Calculate dividendScaled for chart display (dividend × normalPE ratio)
    // For forecasted quarters, use normalPERatio since we don't have actual price/PE
    const dividendScaled = currentDividend > 0 && normalPERatio !== null
      ? currentDividend * normalPERatio
      : null;
    
    // Create forecast data point
    const forecast: CalculatedQuarterlyDataPoint = {
      date: quarterDateStr,
      fyDate: quarterDateStr,
      year: quarterYear,
      quarter: `Q${nextQuarter}`,
      eps: currentEarnings,
      eps_adjusted: currentEps,
      normalPE: normalPERatio ?? undefined,
      fairValue: fairValue,
      dividendsPOR: latestQuarterly.dividendsPOR ?? undefined,
      estimated: true,
      stockPrice: null, // No price for future quarters
      normalPEValue: normalPEValue,
      peRatio: null, // Cannot calculate without price
      dividend: currentDividend > 0 ? currentDividend : 0,
      dividendScaled: dividendScaled,
      revenue: currentEps ? (currentEps * 4 * 16.0) : null
    };
    
    forecasts.push(forecast);
    
    // Move to next quarter
    nextQuarter += 1;
    if (nextQuarter > 4) {
      nextQuarter = 1;
      nextFiscalYear += 1;
    }
  }
  
  return forecasts;
}

/**
 * Step 3: Combine enriched quarterly data with daily price data for charting
 */
export function combineDataForCharting(
  enrichedQuarterly: CalculatedQuarterlyDataPoint[],
  dailyData: DailyDataPoint[],
  normalPERatio: number | null,
  quarterlyGrowthRate: number | null = null,
  forecastYears: number = 0,
  fiscalYearEndMonth: number = 12
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
  
  // Generate and add forecast data points if growth rate and forecast years are provided
  if (quarterlyGrowthRate !== null && forecastYears > 0 && enrichedQuarterly.length > 0) {
    // Sort enriched quarterly to get the latest
    const sortedQuarterly = [...enrichedQuarterly].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const latestQuarterly = sortedQuarterly[0];
    
    // Generate forecasts
    const forecasts = generateFutureQuarterlyForecasts(
      latestQuarterly,
      quarterlyGrowthRate,
      forecastYears,
      fiscalYearEndMonth,
      normalPERatio,
      18 // fairValueRatio - hardcoded to 18
    );
    
    // Convert forecasts to TransformedDataPoint format and add to chart data
    forecasts.forEach(f => {
      const fiscalInfo = getFiscalYearAndQuarter(new Date(f.date), fiscalYearEndMonth);
      chartData.push({
        date: f.fyDate || f.date.slice(5, 7) + '/' + f.date.slice(2, 4),
        fullDate: f.date,
        stockPrice: undefined, // No price for future quarters
        estimated: true,
        year: f.year,
        frequency: 'quarterly',
        marketCap: null,
        volume: 0,
        fairValue: f.fairValue,
        normalPEValue: f.normalPEValue,
        earnings: f.eps || null,
        eps_adjusted: f.eps_adjusted ?? null,
        normalPE: f.normalPE || null,
        dividendsPOR: f.dividendsPOR || null,
        hasQuarterlyData: true,
        peRatio: null,
        revenue: f.revenue,
        dividend: f.dividend,
        dividendScaled: f.dividendScaled,
        calculatedNormalPE: normalPERatio,
        fiscalYear: fiscalInfo.fiscalYear,
        fiscalQuarter: fiscalInfo.fiscalQuarter
      });
    });
  }
  
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
    
    // Create a map for quick lookup by date, preserving tick order
    const tickOrderMap = new Map<string, number>();
    xAxisTicks.forEach((date, index) => {
      tickOrderMap.set(date, index);
    });
    
    const filtered = filteredStockData
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
    
    // Sort by tick order first (to match xAxisTicks order), then by fiscal year/quarter as fallback
    const sorted = filtered.sort((a, b) => {
      const orderA = tickOrderMap.get(a.fullDate) ?? Infinity;
      const orderB = tickOrderMap.get(b.fullDate) ?? Infinity;
      
      // If both have tick order, use that (preserves xAxisTicks order)
      if (orderA !== Infinity && orderB !== Infinity) {
        return orderA - orderB;
      }
      
      // Fallback: sort by fiscal year and quarter
      if (a.fiscalYear !== b.fiscalYear) {
        return (a.fiscalYear || 0) - (b.fiscalYear || 0);
      }
      if (a.fiscalQuarter !== b.fiscalQuarter) {
        return (a.fiscalQuarter || 0) - (b.fiscalQuarter || 0);
      }
      // Finally by date
      return new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime();
    });
    
    // Skip the first data point if it's Q4 from the previous fiscal year
    // (we include it for the chart boundary but don't want it in the quarterly table)
    if (sorted.length > 0) {
      const firstItem = sorted[0];
      // Check if first item is Q4 and from a fiscal year before the second item's fiscal year
      if (sorted.length > 1 && 
          firstItem.fiscalQuarter === 4 && 
          firstItem.fiscalYear !== undefined &&
          sorted[1].fiscalYear !== undefined &&
          firstItem.fiscalYear < sorted[1].fiscalYear) {
        return sorted.slice(1); // Skip the first item
      }
    }
    
    return sorted;
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
    hasEstimatedQuarters: boolean; // Track if any quarter is estimated
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
        quarterCount: 0,
        hasEstimatedQuarters: false
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
    
    // Check if this quarter is estimated
    if (item.estimated) {
      yearData.hasEstimatedQuarters = true;
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
    
    // Mark as estimated if incomplete year OR if any quarters are estimated (forecasted)
    const isEstimated = hasIncompleteYear || yearData.hasEstimatedQuarters;
    
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
      estimated: isEstimated, // Mark as estimated if incomplete year or has estimated quarters
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


