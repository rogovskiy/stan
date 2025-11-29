import { TransformedDataPoint } from '../components/stockChartTransform';

/**
 * Minimal interface for quarterly data points used in calculations
 */
export interface QuarterlyDataPoint {
  date: string;
  eps_adjusted: number | null;
  earnings: number | null;
  stockPrice: number | null;
}

/**
 * Calculate Normal P/E Ratio: Average of actual P/E ratios using the same logic as the table
 * For each quarterly point, use trailing 4 quarters EPS (same as table calculation)
 * 
 * @param quarterlyData - Array of quarterly data points with dates, prices, and EPS
 * @returns Average P/E ratio or null if insufficient data
 */
export function calculateNormalPERatio(quarterlyData: QuarterlyDataPoint[]): number | null {
  if (quarterlyData.length === 0) return null;
  
  const quarterlyDataPoints = quarterlyData.filter(item => 
    item.stockPrice !== null && 
    item.stockPrice !== undefined
  );
  
  if (quarterlyDataPoints.length === 0) return null;
  
  const peValues = quarterlyDataPoints
    .map(item => {
      // Calculate trailing 4 quarters EPS for this point (same as table logic)
      const currentDate = new Date(item.date);
      const trailing4Quarters = getTrailing4QuartersEps(quarterlyData, currentDate);
      
      if (trailing4Quarters.length === 0) return null;
      
      // Extract EPS values from trailing quarters
      const quarterlyEpsValues = trailing4Quarters.map(q => {
        return q.eps_adjusted !== null && q.eps_adjusted !== undefined 
          ? q.eps_adjusted 
          : (q.earnings || 0);
      });
      
      const annualEps = calculateAnnualEps(quarterlyEpsValues);
      
      // Calculate P/E: price / annual EPS
      if (annualEps > 0 && item.stockPrice && item.stockPrice > 0) {
        return item.stockPrice / annualEps;
      }
      return null;
    })
    .filter((pe): pe is number => pe !== null && pe !== undefined);
  
  if (peValues.length > 0) {
    return peValues.reduce((sum, pe) => sum + pe, 0) / peValues.length;
  }
  return null;
}

/**
 * Calculate Growth Rate: Annual growth rate for the entire selected period
 * Using CAGR (Compound Annual Growth Rate) formula
 * 
 * @param quarterlyData - Array of quarterly data points with dates and EPS
 * @returns Growth rate as a percentage or null if insufficient data
 */
export function calculateGrowthRate(quarterlyData: QuarterlyDataPoint[]): number | null {
  if (quarterlyData.length === 0) return null;
  
  const allQuarterlyPoints = quarterlyData.filter(item => 
    item.eps_adjusted !== null || item.earnings !== null
  );
  
  if (allQuarterlyPoints.length >= 8) {
    // Calculate annual EPS for first period (first 4 quarters)
    const firstQuarters = allQuarterlyPoints.slice(0, 4);
    const firstEpsValues = firstQuarters.map(item => {
      return item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : (item.earnings || 0);
    });
    const firstSum = calculateAnnualEps(firstEpsValues);
    
    // Calculate annual EPS for last period (last 4 quarters)
    const lastQuarters = allQuarterlyPoints.slice(-4);
    const lastEpsValues = lastQuarters.map(item => {
      return item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : (item.earnings || 0);
    });
    const lastSum = calculateAnnualEps(lastEpsValues);
    
    // Calculate time period in years between first and last quarterly points
    const firstDate = new Date(allQuarterlyPoints[0].date);
    const lastDate = new Date(allQuarterlyPoints[allQuarterlyPoints.length - 1].date);
    const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (firstSum > 0 && lastSum > 0 && yearsDiff > 0) {
      // CAGR formula: ((End/Start)^(1/Years) - 1) * 100
      return (Math.pow(lastSum / firstSum, 1 / yearsDiff) - 1) * 100;
    }
  } else if (allQuarterlyPoints.length >= 2) {
    // Fallback: if less than 8 quarters, compare first and last annualized EPS
    const firstPoint = allQuarterlyPoints[0];
    const lastPoint = allQuarterlyPoints[allQuarterlyPoints.length - 1];
    
    const firstEps = firstPoint.eps_adjusted !== null && firstPoint.eps_adjusted !== undefined 
      ? firstPoint.eps_adjusted 
      : (firstPoint.earnings || 0);
    const lastEps = lastPoint.eps_adjusted !== null && lastPoint.eps_adjusted !== undefined 
      ? lastPoint.eps_adjusted 
      : (lastPoint.earnings || 0);
    
    const firstDate = new Date(firstPoint.date);
    const lastDate = new Date(lastPoint.date);
    const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (firstEps > 0 && lastEps > 0 && yearsDiff > 0) {
      // CAGR formula: ((End/Start)^(1/Years) - 1) * 100
      return (Math.pow(lastEps / firstEps, 1 / yearsDiff) - 1) * 100;
    }
  }
  return null;
}

/**
 * Calculate Fair Value: Annual EPS multiplied by fair value ratio
 * 
 * @param annualEps - Annual earnings per share
 * @param fairValueRatio - Fair value ratio (typically 18)
 * @returns Fair value or null if insufficient data
 */
export function calculateFairValue(annualEps: number | null, fairValueRatio: number): number | null {
  if (annualEps === null || annualEps === undefined || annualEps <= 0) {
    return null;
  }
  return annualEps * fairValueRatio;
}

/**
 * Get fiscal year and quarter from a date given the fiscal year end month
 * 
 * @param date - The date to analyze
 * @param fiscalYearEndMonth - The month when the fiscal year ends (1-12)
 * @returns Object with fiscalYear and fiscalQuarter (1-4)
 */
export function getFiscalYearAndQuarter(date: Date, fiscalYearEndMonth: number): { fiscalYear: number; fiscalQuarter: number } {
  const month = date.getMonth() + 1; // getMonth() returns 0-11
  const year = date.getFullYear();
  
  // Fiscal year starts the month after fiscal year end
  const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
  
  // Determine fiscal year
  // For fiscal years that span calendar years (e.g., Oct-Sep):
  // - If month > fiscalYearEndMonth: we're in the NEXT calendar year's fiscal year
  // - If month >= fiscalYearStartMonth: we're in the CURRENT calendar year's fiscal year
  // - If month < fiscalYearStartMonth: we're in the CURRENT calendar year's fiscal year (not previous!)
  //   This is because the fiscal year started in the previous calendar year but continues into current year
  let fiscalYear: number;
  let monthsIntoFiscalYear: number;
  
  if (month > fiscalYearEndMonth) {
    // After fiscal year end (e.g., Oct, Nov, Dec for Sep-end fiscal year)
    // We're in the next calendar year's fiscal year
    fiscalYear = year + 1;
    monthsIntoFiscalYear = month - fiscalYearEndMonth;
  } else if (month >= fiscalYearStartMonth) {
    // Between fiscal year start and end (e.g., Oct-Dec for Sep-end fiscal year)
    fiscalYear = year;
    monthsIntoFiscalYear = month - fiscalYearStartMonth + 1;
  } else {
    // Month is before fiscal year start month (e.g., Jan-Sep for Oct-start fiscal year)
    // This is still in the current calendar year's fiscal year (which started in previous calendar year)
    // For example: March 2024 for FY ending Sep -> FY2024 (which started Oct 2023)
    fiscalYear = year;
    // Calculate months into fiscal year: 
    // (months from fiscal year start in previous calendar year) + (current month)
    monthsIntoFiscalYear = (12 - fiscalYearEndMonth) + month;
  }
  
  // Determine quarter (1-4) based on months into fiscal year
  // Q1: months 1-3, Q2: months 4-6, Q3: months 7-9, Q4: months 10-12
  const fiscalQuarter = Math.ceil(monthsIntoFiscalYear / 3);
  
  return { fiscalYear, fiscalQuarter: Math.min(4, Math.max(1, fiscalQuarter)) };
}

/**
 * Get trailing 4 quarters EPS data points up to a given date
 * 
 * @param quarterlyData - Array of quarterly data points
 * @param asOfDate - The date to calculate trailing quarters up to
 * @returns Array of up to 4 quarterly data points (most recent first)
 */
export function getTrailing4QuartersEps(quarterlyData: QuarterlyDataPoint[], asOfDate: Date): QuarterlyDataPoint[] {
  return quarterlyData
    .filter(q => {
      const qDate = new Date(q.date);
      return qDate <= asOfDate;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);
}

/**
 * Calculate annual EPS from quarterly EPS values
 * 
 * @param quarterlyEpsValues - Array of quarterly EPS values (1-4 quarters)
 * @returns Annualized EPS (multiplies by 4 if less than 4 quarters)
 */
export function calculateAnnualEps(quarterlyEpsValues: number[]): number {
  if (quarterlyEpsValues.length === 0) return 0;
  
  const sum = quarterlyEpsValues.reduce((acc, val) => acc + val, 0);
  
  // Annualize if less than 4 quarters
  return quarterlyEpsValues.length < 4
    ? (sum / quarterlyEpsValues.length) * 4
    : sum;
}

/**
 * Infer fiscal year end month from quarterly dates
 * Looks at the pattern of quarterly dates to determine when fiscal year ends
 * 
 * Strategy: For fiscal years ending in month M, Q4 dates cluster around month M,
 * while Q1 dates cluster around month (M+3) mod 12. We look for the month that
 * appears most frequently as the 3rd month from another cluster (Q4 to Q1 gap).
 * 
 * @param quarterlyDates - Array of quarterly date strings
 * @returns Fiscal year end month (1-12), defaults to 12 if insufficient data
 */
export function inferFiscalYearEndMonth(quarterlyDates: string[]): number {
  if (quarterlyDates.length === 0) return 12; // Default to December
  
  // Convert to dates and sort
  const dates = quarterlyDates.map(d => new Date(d)).sort((a, b) => a.getTime() - b.getTime());
  
  // Group dates by month to find patterns
  // For a fiscal year ending in month M:
  // - Q4 ends in month M (fiscal year end)
  // - Q1 ends in month ((M+3-1) % 12) + 1 = month after M+2 months
  // For September end (month 9): Q4 in Sep (9), Q1 in Dec (12)
  
  // Look for months that appear most frequently with ~3 month gaps
  // Count occurrences of each month
  const monthCounts = new Map<number, number>();
  dates.forEach(date => {
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  });
  
  // Find the month with highest count - this is likely Q4 (fiscal year end)
  // But also check if there's a pattern: Q4 month should have similar counts to Q1, Q2, Q3
  // Q1 is typically 3 months after Q4, Q2 is 6 months after, Q3 is 9 months after
  
  let maxCount = 0;
  let candidateMonth = 12;
  
  // Try each possible fiscal year end month and see which has the best pattern match
  for (let fiscalYearEndMonth = 1; fiscalYearEndMonth <= 12; fiscalYearEndMonth++) {
    const q4Month = fiscalYearEndMonth;
    const q1Month = ((q4Month + 2) % 12) + 1; // 3 months after Q4
    const q2Month = ((q4Month + 5) % 12) + 1; // 6 months after Q4  
    const q3Month = ((q4Month + 8) % 12) + 1; // 9 months after Q4
    
    const q4Count = monthCounts.get(q4Month) || 0;
    const q1Count = monthCounts.get(q1Month) || 0;
    const q2Count = monthCounts.get(q2Month) || 0;
    const q3Count = monthCounts.get(q3Month) || 0;
    
    // Score based on how well quarters cluster in expected months
    // All quarters should have similar counts for a good fiscal year match
    const minCount = Math.min(q1Count, q2Count, q3Count, q4Count);
    const maxQuarterCount = Math.max(q1Count, q2Count, q3Count, q4Count);
    const totalQuarterCount = q1Count + q2Count + q3Count + q4Count;
    
    // Prefer patterns where all quarters have significant counts and are balanced
    const score = minCount > 0 ? totalQuarterCount * (minCount / maxQuarterCount) : 0;
    
    if (score > maxCount) {
      maxCount = score;
      candidateMonth = fiscalYearEndMonth;
    }
  }
  
  // Fallback: if no clear pattern, use the most common month
  if (maxCount === 0) {
    monthCounts.forEach((count, month) => {
      if (count > maxCount) {
        maxCount = count;
        candidateMonth = month;
      }
    });
  }
  
  return candidateMonth;
}

/**
 * Calculate maximum available years from quarterly data
 * Finds the earliest date in the quarterly data and calculates years from that date to today
 * 
 * @param quarterlyData - Array of quarterly data points with date field
 * @param defaultYears - Default fallback value if no data available (default: 10)
 * @returns Maximum available years or default fallback
 */
export function calculateMaxAvailableYears(
  quarterlyData: Array<{ date: string }>,
  defaultYears: number = 10
): number {
  if (quarterlyData.length === 0) {
    return defaultYears;
  }

  // Find the earliest date in the quarterly data
  const dates = quarterlyData
    .map(item => {
      const dateStr = item.date;
      return dateStr ? new Date(dateStr) : null;
    })
    .filter((date: Date | null) => date !== null && !isNaN(date.getTime())) as Date[];

  if (dates.length === 0) {
    return defaultYears;
  }

  const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const endDate = new Date();

  // Calculate years difference
  const yearsDiff = endDate.getFullYear() - earliestDate.getFullYear();
  const monthsDiff = endDate.getMonth() - earliestDate.getMonth();

  // Add 1 to include the first year, and round up to ensure we include all data
  const yearsBack = yearsDiff + (monthsDiff < 0 ? 0 : 1);

  return Math.max(1, yearsBack); // At least 1 year, no upper cap
}

/**
 * Calculate fiscal year start date (Q1) based on period
 * 
 * @param quarterlyDates - Array of quarterly date strings
 * @param period - Period string (e.g., "8y", "max")
 * @param fiscalYearEndMonth - The month when the fiscal year ends (1-12)
 * @returns Q1 start date string or null if insufficient data
 */
export function calculateFiscalYearStartDate(
  quarterlyDates: string[],
  period: string,
  fiscalYearEndMonth: number
): string | null {
  if (quarterlyDates.length === 0) return null;
  
  // Get the period number (e.g., "10y" -> 10)
  const periodMatch = period.match(/(\d+)y/);
  
  // Calculate MAX based on first fiscal year with quarterly data
  let yearsBack: number;
  if (period === 'max') {
    // Find all quarterly data points with their fiscal year info
    const quarterlyPoints = quarterlyDates.map(dateStr => {
      const date = new Date(dateStr);
      const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
      return {
        date,
        fiscalYear: fiscalInfo.fiscalYear,
        fiscalQuarter: fiscalInfo.fiscalQuarter,
        fullDate: dateStr
      };
    });
    
    if (quarterlyPoints.length === 0) {
      yearsBack = 50; // Fallback if no quarterly data
    } else {
      // Find the earliest fiscal year
      const earliestFiscalYear = Math.min(...quarterlyPoints.map(p => p.fiscalYear));
      const latestFiscalYear = Math.max(...quarterlyPoints.map(p => p.fiscalYear));
      
      // Calculate years back from latest to earliest fiscal year
      yearsBack = latestFiscalYear - earliestFiscalYear + 1; // +1 to include both years
    }
  } else {
    yearsBack = periodMatch ? parseInt(periodMatch[1]) : 8;
  }
  
  // Find all quarterly data points with their fiscal year info
  const quarterlyPoints = quarterlyDates.map(dateStr => {
    const date = new Date(dateStr);
    const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
    return {
      date,
      fiscalYear: fiscalInfo.fiscalYear,
      fiscalQuarter: fiscalInfo.fiscalQuarter,
      fullDate: dateStr
    };
  });
  
  if (quarterlyPoints.length === 0) return null;
  
  // Find the latest fiscal year
  const latestFiscalYear = Math.max(...quarterlyPoints.map(p => p.fiscalYear));
  
  // Calculate target fiscal year (N years back)
  const targetFiscalYear = latestFiscalYear - (yearsBack - 1); // -1 because current year is included
  
  // Find Q1 of the target fiscal year
  // Q1 starts the month after fiscal year end
  const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
  const q1StartDate = new Date(targetFiscalYear, fiscalYearStartMonth - 1, 1); // month is 0-indexed
  
  // Always return the fiscal year start date (Q1 start), not the Q1 quarter-end date
  // This ensures the chart starts at the beginning of the fiscal year (e.g., Oct 1 for AAPL)
  return q1StartDate.toISOString().split('T')[0];
}

