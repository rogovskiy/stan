import { TransformedDataPoint } from './dataTransform';

/**
 * Calculate Normal P/E Ratio: Average of actual P/E ratios using the same logic as the table
 * For each quarterly point, use trailing 4 quarters EPS (same as table calculation)
 * 
 * @param stockData - Array of transformed stock data points
 * @returns Average P/E ratio or null if insufficient data
 */
export function calculateNormalPERatio(stockData: TransformedDataPoint[]): number | null {
  if (stockData.length === 0) return null;
  
  const quarterlyDataPoints = stockData.filter(item => 
    item.hasQuarterlyData && 
    item.stockPrice !== null && 
    item.stockPrice !== undefined
  );
  
  if (quarterlyDataPoints.length === 0) return null;
  
  const peValues = quarterlyDataPoints
    .map(item => {
      // Calculate trailing 4 quarters EPS for this point (same as table logic)
      const currentDate = new Date(item.fullDate);
      const trailing4Quarters = stockData
        .filter(d => {
          const dDate = new Date(d.fullDate);
          return dDate <= currentDate && d.hasQuarterlyData;
        })
        .sort((a, b) => new Date(b.fullDate).getTime() - new Date(a.fullDate).getTime())
        .slice(0, 4);
      
      if (trailing4Quarters.length === 0) return null;
      
      const trailingEps = trailing4Quarters.reduce((sum, d) => {
        const epsValue = d.eps_adjusted !== null && d.eps_adjusted !== undefined 
          ? d.eps_adjusted 
          : (d.earnings || 0);
        return sum + epsValue;
      }, 0);
      
      // Annualize if less than 4 quarters
      const annualEps = trailing4Quarters.length < 4
        ? (trailingEps / trailing4Quarters.length) * 4
        : trailingEps;
      
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
 * @param stockData - Array of transformed stock data points
 * @returns Growth rate as a percentage or null if insufficient data
 */
export function calculateGrowthRate(stockData: TransformedDataPoint[]): number | null {
  if (stockData.length === 0) return null;
  
  const allQuarterlyPoints = stockData.filter(item => item.hasQuarterlyData && (item.eps_adjusted !== null || item.earnings !== null));
  
  if (allQuarterlyPoints.length >= 8) {
    // Calculate annual EPS for first period (first 4 quarters)
    const firstQuarters = allQuarterlyPoints.slice(0, 4);
    const firstSum = firstQuarters.reduce((sum, item) => {
      // Use eps_adjusted if available, otherwise fall back to earnings
      const epsValue = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : (item.earnings || 0);
      return sum + epsValue;
    }, 0);
    
    // Calculate annual EPS for last period (last 4 quarters)
    const lastQuarters = allQuarterlyPoints.slice(-4);
    const lastSum = lastQuarters.reduce((sum, item) => {
      // Use eps_adjusted if available, otherwise fall back to earnings
      const epsValue = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : (item.earnings || 0);
      return sum + epsValue;
    }, 0);
    
    // Calculate time period in years between first and last quarterly points
    const firstDate = new Date(allQuarterlyPoints[0].fullDate);
    const lastDate = new Date(allQuarterlyPoints[allQuarterlyPoints.length - 1].fullDate);
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
    
    const firstDate = new Date(firstPoint.fullDate);
    const lastDate = new Date(lastPoint.fullDate);
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

