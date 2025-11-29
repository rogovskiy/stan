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
  // If current month is after fiscal year-end month, we're in next fiscal year
  // If current month is before fiscal year start, we're in previous fiscal year
  let fiscalYear: number;
  let monthsIntoFiscalYear: number;
  
  if (month > fiscalYearEndMonth) {
    // After fiscal year end, so we're in the next fiscal year
    fiscalYear = year + 1;
    monthsIntoFiscalYear = month - fiscalYearEndMonth;
  } else if (month < fiscalYearStartMonth) {
    // Before fiscal year start, so we're in the previous fiscal year
    fiscalYear = year - 1;
    monthsIntoFiscalYear = (12 - fiscalYearEndMonth) + month;
  } else {
    // Between fiscal year start and end
    fiscalYear = year;
    monthsIntoFiscalYear = month - fiscalYearStartMonth + 1;
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
 * @param quarterlyDates - Array of quarterly date strings
 * @returns Fiscal year end month (1-12), defaults to 12 if insufficient data
 */
export function inferFiscalYearEndMonth(quarterlyDates: string[]): number {
  if (quarterlyDates.length === 0) return 12; // Default to December
  
  // Group by calendar year and find the latest quarter in each year
  const quartersByYear = new Map<number, Date[]>();
  quarterlyDates.forEach(dateStr => {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    if (!quartersByYear.has(year)) {
      quartersByYear.set(year, []);
    }
    quartersByYear.get(year)!.push(date);
  });
  
  // Find the most common month for the latest quarter in each year
  // This should be the fiscal year end month
  const latestQuarterMonths: number[] = [];
  quartersByYear.forEach((dates) => {
    const latestDate = dates.sort((a, b) => b.getTime() - a.getTime())[0];
    latestQuarterMonths.push(latestDate.getMonth() + 1); // getMonth() returns 0-11
  });
  
  // Find the most common month (fiscal year end)
  const monthCounts = new Map<number, number>();
  latestQuarterMonths.forEach(month => {
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  });
  
  let maxCount = 0;
  let fiscalYearEndMonth = 12;
  monthCounts.forEach((count, month) => {
    if (count > maxCount) {
      maxCount = count;
      fiscalYearEndMonth = month;
    }
  });
  
  return fiscalYearEndMonth;
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
  
  // Find the actual Q1 data point closest to this date
  const q1Points = quarterlyPoints.filter(p => 
    p.fiscalYear === targetFiscalYear && p.fiscalQuarter === 1
  );
  
  if (q1Points.length > 0) {
    // Return the earliest Q1 date
    return q1Points.sort((a, b) => a.date.getTime() - b.date.getTime())[0].fullDate;
  }
  
  // If no Q1 found, return the calculated Q1 start date
  return q1StartDate.toISOString().split('T')[0];
}

