import { DailyDataPoint, QuarterlyDataPoint } from '../types/api';
import { calculateFairValue, getTrailing4QuartersEps, calculateAnnualEps, QuarterlyDataPoint as CalcQuarterlyDataPoint } from '../lib/calculations';

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
  fairValueEpsAdjusted: number | null;
  earnings: number | null;
  eps_adjusted: number | null;
  normalPE: number | null;
  dividendsPOR: number | null;
  hasQuarterlyData: boolean;
  peRatio: number | null;
  revenue: number | null;
  dividend: number | null;
}

// Transform API daily/quarterly data into chart-ready points.
export const transformApiDataForChart = (
  dailyData: DailyDataPoint[], 
  quarterlyData: QuarterlyDataPoint[] = [],
  fairValueRatio: number = 18
): TransformedDataPoint[] => {
  // Create a map of quarterly data by date for exact matching
  const quarterlyMap = new Map<string, QuarterlyDataPoint>();
  quarterlyData.forEach(q => {
    quarterlyMap.set(q.date, q);
  });
  
  // Sort daily data by date
  const sortedDailyData = [...dailyData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Create chart data points - one for each daily price point
  const chartData: TransformedDataPoint[] = [];
  
  sortedDailyData.forEach((daily) => {
    const dailyDate = daily.date;
    const quarterlyDataForThisDate = quarterlyMap.get(dailyDate);
    
    // Create chart point with daily price
    const basePoint: TransformedDataPoint = {
      date: daily.fyDate || daily.date.slice(5, 7) + '/' + daily.date.slice(2, 4), // MM/YY format
      fullDate: daily.date,
      stockPrice: daily.price,
      estimated: daily.estimated,
      year: daily.year,
      frequency: 'daily',
      // Daily-derived metrics
      marketCap: daily.price ? (daily.price * 16.0) : null,
      volume: 1500000 + Math.random() * 1000000,
      // Initialize quarterly fields
      fairValue: null,
      fairValueEpsAdjusted: null,
      earnings: null,
      eps_adjusted: null,
      normalPE: null,
      dividendsPOR: null,
      hasQuarterlyData: false,
      peRatio: null,
      revenue: null,
      dividend: null
    };

    // Only add quarterly data if this date has actual quarterly data
    if (quarterlyDataForThisDate) {
      const eps = quarterlyDataForThisDate.eps || 0;
      const annualDividendYield = (quarterlyDataForThisDate.dividendsPOR || 0) / 100;
      const quarterlyDividendAmount = (daily.price || 0) * annualDividendYield / 4;
      const payoutRatio = 0.3 + (Math.random() * 0.4);
      const epsBasedDividend = Math.max(eps * payoutRatio / 4, quarterlyDividendAmount);
      
      const epsAdjusted = quarterlyDataForThisDate.eps_adjusted !== undefined && quarterlyDataForThisDate.eps_adjusted !== null 
        ? quarterlyDataForThisDate.eps_adjusted 
        : eps; // Fall back to eps if eps_adjusted is not available
      const normalPE = quarterlyDataForThisDate.normalPE || null;
      
      // Calculate trailing 4 quarters EPS for fairValue calculation
      const currentDate = new Date(dailyDate);
      // Convert quarterlyData to calculation format
      const calcQuarterlyData: CalcQuarterlyDataPoint[] = quarterlyData.map(q => ({
        date: q.date,
        eps_adjusted: q.eps_adjusted ?? null,
        earnings: q.eps ?? null,
        stockPrice: null
      }));
      
      const trailing4Quarters = getTrailing4QuartersEps(calcQuarterlyData, currentDate);
      
      let annualEps: number | null = null;
      if (trailing4Quarters.length > 0) {
        const quarterlyEpsValues = trailing4Quarters.map(q => {
          return q.eps_adjusted !== null && q.eps_adjusted !== undefined 
            ? q.eps_adjusted 
            : (q.earnings || 0);
        });
        annualEps = calculateAnnualEps(quarterlyEpsValues);
      }
      
      // Calculate fairValue using fairValueRatio
      const calculatedFairValue = calculateFairValue(annualEps, fairValueRatio);
      
      Object.assign(basePoint, {
        // Quarterly data - only present on quarterly reporting dates
        fairValue: calculatedFairValue,
        fairValueEpsAdjusted: (epsAdjusted !== null && normalPE !== null) 
          ? epsAdjusted * normalPE 
          : null,
        earnings: eps,
        eps_adjusted: epsAdjusted,
        normalPE: normalPE,
        dividendsPOR: quarterlyDataForThisDate.dividendsPOR || null,
        hasQuarterlyData: true,
        // Computed quarterly metrics
        peRatio: normalPE,
        revenue: eps ? (eps * 4 * 16.0) : null,
        dividend: Math.max(epsBasedDividend, 0.5)
      });
    }
    
    chartData.push(basePoint);
  });
  
  // Find unmatched quarterly data and map to nearest daily dates
  const unmatchedQuarterly = quarterlyData.filter(q => !quarterlyMap.has(q.date) || !sortedDailyData.find(d => d.date === q.date));
  
  unmatchedQuarterly.forEach(q => {
    const qDate = new Date(q.date);
    let closestIndex = 0;
    let minDiff = Infinity;
    
    chartData.forEach((daily, index) => {
      const dailyDate = new Date(daily.fullDate);
      const diff = Math.abs(dailyDate.getTime() - qDate.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = index;
      }
    });
    
    // Apply quarterly data to the closest daily point that doesn't already have quarterly data
    if (closestIndex < chartData.length && !chartData[closestIndex].hasQuarterlyData) {
      const eps = q.eps || 0;
      const annualDividendYield = (q.dividendsPOR || 0) / 100;
      const quarterlyDividendAmount = (chartData[closestIndex].stockPrice || 0) * annualDividendYield / 4;
      const payoutRatio = 0.3 + (Math.random() * 0.4);
      const epsBasedDividend = Math.max(eps * payoutRatio / 4, quarterlyDividendAmount);
      
      const epsAdjusted = q.eps_adjusted !== undefined && q.eps_adjusted !== null 
        ? q.eps_adjusted 
        : eps; // Fall back to eps if eps_adjusted is not available
      const normalPE = q.normalPE || null;
      
      // Calculate trailing 4 quarters EPS for fairValue calculation
      const currentDate = new Date(q.date);
      // Convert quarterlyData to calculation format
      const calcQuarterlyData: CalcQuarterlyDataPoint[] = quarterlyData.map(quarterly => ({
        date: quarterly.date,
        eps_adjusted: quarterly.eps_adjusted ?? null,
        earnings: quarterly.eps ?? null,
        stockPrice: null
      }));
      
      const trailing4Quarters = getTrailing4QuartersEps(calcQuarterlyData, currentDate);
      
      let annualEps: number | null = null;
      if (trailing4Quarters.length > 0) {
        const quarterlyEpsValues = trailing4Quarters.map(quarterly => {
          return quarterly.eps_adjusted !== null && quarterly.eps_adjusted !== undefined 
            ? quarterly.eps_adjusted 
            : (quarterly.earnings || 0);
        });
        annualEps = calculateAnnualEps(quarterlyEpsValues);
      }
      
      // Calculate fairValue using fairValueRatio
      const calculatedFairValue = calculateFairValue(annualEps, fairValueRatio);
      
      Object.assign(chartData[closestIndex], {
        fairValue: calculatedFairValue,
        fairValueEpsAdjusted: (epsAdjusted !== null && normalPE !== null) 
          ? epsAdjusted * normalPE 
          : null,
        earnings: eps,
        eps_adjusted: epsAdjusted,
        normalPE: normalPE,
        dividendsPOR: q.dividendsPOR || null,
        hasQuarterlyData: true,
        peRatio: normalPE,
        revenue: eps ? (eps * 4 * 16.0) : null,
        dividend: Math.max(epsBasedDividend, 0.5)
      });
    }
  });
  
  return chartData;
};


