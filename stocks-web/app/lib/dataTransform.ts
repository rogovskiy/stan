import { APIResponse, DailyDataPoint, QuarterlyDataPoint } from '../types/api';

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
  earnings: number | null;
  eps_adjusted: number | null;
  normalPE: number | null;
  dividendsPOR: number | null;
  hasQuarterlyData: boolean;
  peRatio: number | null;
  revenue: number | null;
  dividend: number | null;
}

// New function signature for separated data
export const transformApiDataForChart = (
  dailyData: DailyDataPoint[], 
  quarterlyData: QuarterlyDataPoint[] = []
): TransformedDataPoint[] => {
  console.log('Data transformation debug:', {
    dailyDataPoints: dailyData.length,
    quarterlyDataPoints: quarterlyData.length,
    sampleQuarterly: quarterlyData.slice(0, 3).map(q => ({
      date: q.date,
      fairValue: q.fairValue,
      eps: q.eps
    }))
  });
  
  // Create a map of quarterly data by date for exact matching
  const quarterlyMap = new Map();
  quarterlyData.forEach(q => {
    quarterlyMap.set(q.date, q);
  });
  
  // Sort daily data by date
  const sortedDailyData = dailyData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Create chart data points - one for each daily price point
  const chartData: TransformedDataPoint[] = [];
  let quarterlyPointsFound = 0;
  
  sortedDailyData.forEach((daily, index) => {
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
      quarterlyPointsFound++;
      const eps = quarterlyDataForThisDate.eps || 0;
      const annualDividendYield = (quarterlyDataForThisDate.dividendsPOR || 0) / 100;
      const quarterlyDividendAmount = (daily.price || 0) * annualDividendYield / 4;
      const payoutRatio = 0.3 + (Math.random() * 0.4);
      const epsBasedDividend = Math.max(eps * payoutRatio / 4, quarterlyDividendAmount);
      
      Object.assign(basePoint, {
        // Quarterly data - only present on quarterly reporting dates
        fairValue: quarterlyDataForThisDate.fairValue || null,
        earnings: eps,
        eps_adjusted: quarterlyDataForThisDate.eps_adjusted !== undefined && quarterlyDataForThisDate.eps_adjusted !== null 
          ? quarterlyDataForThisDate.eps_adjusted 
          : eps, // Fall back to eps if eps_adjusted is not available
        normalPE: quarterlyDataForThisDate.normalPE || null,
        dividendsPOR: quarterlyDataForThisDate.dividendsPOR || null,
        hasQuarterlyData: true,
        // Computed quarterly metrics
        peRatio: quarterlyDataForThisDate.normalPE || null,
        revenue: eps ? (eps * 4 * 16.0) : null,
        dividend: Math.max(epsBasedDividend, 0.5)
      });
      
      console.log('Found quarterly data for date:', dailyDate, {
        fairValue: quarterlyDataForThisDate.fairValue,
        eps: quarterlyDataForThisDate.eps,
        hasData: true
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
      
      Object.assign(chartData[closestIndex], {
        fairValue: q.fairValue || null,
        earnings: eps,
        eps_adjusted: q.eps_adjusted !== undefined && q.eps_adjusted !== null 
          ? q.eps_adjusted 
          : eps, // Fall back to eps if eps_adjusted is not available
        normalPE: q.normalPE || null,
        dividendsPOR: q.dividendsPOR || null,
        hasQuarterlyData: true,
        peRatio: q.normalPE || null,
        revenue: eps ? (eps * 4 * 16.0) : null,
        dividend: Math.max(epsBasedDividend, 0.5)
      });
      
      quarterlyPointsFound++;
      console.log('Applied quarterly data to closest daily point:', {
        quarterlyDate: q.date,
        closestDailyDate: chartData[closestIndex].fullDate,
        daysDifference: Math.abs(qDate.getTime() - new Date(chartData[closestIndex].fullDate).getTime()) / (1000 * 60 * 60 * 24)
      });
    }
  });  console.log('Quarterly data matching results:', {
    quarterlyPointsFound,
    totalDailyPoints: chartData.length,
    sampleChartData: chartData.filter(p => p.hasQuarterlyData).slice(0, 3).map(p => ({
      date: p.date,
      fairValue: p.fairValue,
      hasQuarterlyData: p.hasQuarterlyData
    }))
  });
  
  console.log('Final display data:', {
    totalPoints: chartData.length,
    pointsWithFairValue: chartData.filter(p => p.fairValue !== null).length,
    sampleFairValues: chartData.filter(p => p.fairValue !== null).slice(0, 5).map(p => ({
      date: p.date,
      fairValue: p.fairValue
    }))
  });
  
  return chartData;
};