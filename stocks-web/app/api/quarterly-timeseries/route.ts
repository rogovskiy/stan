import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../lib/firebaseService';
import { QuarterlyDataResponse, QuarterlyDataPoint } from '../../types/api';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const maxAgeHours = parseInt(searchParams.get('maxAge') || '24');
    const period = searchParams.get('period') || '5y'; // Add period parameter

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`Quarterly API Request: ${ticker}, period: ${period}, maxAge: ${maxAgeHours}`);

    // Try to get cached quarterly time series data
    const timeseriesData = await firebaseService.getQuarterlyTimeseries(ticker, maxAgeHours);

    if (!timeseriesData) {
      return NextResponse.json(
        { 
          error: 'Quarterly time series data not found',
          message: `No time series data found for ${ticker}. Run the quarterly time series generator script first.`,
          suggestion: `python generate_quarterly_timeseries.py ${ticker}`
        },
        { status: 404 }
      );
    }

    // Transform data to our new quarterly format
    const quarterlyDataPoints: QuarterlyDataPoint[] = [];
    
    // Helper function to calculate MAX period based on first fiscal year with quarterly data
    const calculateMaxPeriod = (timeseriesData: any): number => {
      let allDataPoints: any[] = [];
      
      // Extract all data points from different possible formats
      if (timeseriesData.data && Array.isArray(timeseriesData.data)) {
        allDataPoints = timeseriesData.data;
      } else if (Array.isArray(timeseriesData)) {
        allDataPoints = timeseriesData;
      }
      
      if (allDataPoints.length === 0) {
        return 50; // Fallback to 50 years if no data
      }
      
      // Find the earliest date in the quarterly data
      const dates = allDataPoints
        .map((item: any) => {
          const dateStr = item.date || item.period_end_date;
          return dateStr ? new Date(dateStr) : null;
        })
        .filter((date: Date | null) => date !== null && !isNaN(date.getTime())) as Date[];
      
      if (dates.length === 0) {
        return 50; // Fallback to 50 years if no valid dates
      }
      
      const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const endDate = new Date();
      
      // Calculate years difference
      const yearsDiff = endDate.getFullYear() - earliestDate.getFullYear();
      const monthsDiff = endDate.getMonth() - earliestDate.getMonth();
      
      // Add 1 to include the first year, and round up to ensure we include all data
      const yearsBack = yearsDiff + (monthsDiff < 0 ? 0 : 1);
      
      return Math.max(1, yearsBack); // At least 1 year
    };
    
    // Calculate date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    const normalizedPeriod = period.toLowerCase();
    
    switch (normalizedPeriod) {
      case '6m':
        startDate.setMonth(endDate.getMonth() - 6);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      case '2y':
        startDate.setFullYear(endDate.getFullYear() - 2);
        break;
      case '3y':
        startDate.setFullYear(endDate.getFullYear() - 3);
        break;
      case '4y':
        startDate.setFullYear(endDate.getFullYear() - 4);
        break;
      case '5y':
        startDate.setFullYear(endDate.getFullYear() - 5);
        break;
      case '6y':
        startDate.setFullYear(endDate.getFullYear() - 6);
        break;
      case '7y':
        startDate.setFullYear(endDate.getFullYear() - 7);
        break;
      case '8y':
        startDate.setFullYear(endDate.getFullYear() - 8);
        break;
      case '9y':
        startDate.setFullYear(endDate.getFullYear() - 9);
        break;
      case '10y':
        startDate.setFullYear(endDate.getFullYear() - 10);
        break;
      case 'max':
        // Calculate MAX based on first fiscal year with quarterly data
        const yearsBack = calculateMaxPeriod(timeseriesData);
        startDate.setFullYear(endDate.getFullYear() - yearsBack);
        console.log(`MAX period calculated: ${yearsBack} years back to first fiscal year with quarterly data`);
        break;
      default:
        startDate.setFullYear(endDate.getFullYear() - 5);
    }

    console.log(`Filtering quarterly data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    if (Array.isArray(timeseriesData) && timeseriesData.length > 0) {
      console.log(`Sample data point keys: ${Object.keys(timeseriesData[0]).join(', ')}`);
    }

    // Handle new format: timeseriesData is an array with all metrics combined
    // Check if it's the new format (array) or old format (object with eps.data)
    let dataToProcess: any[] = [];

    if (timeseriesData.data && Array.isArray(timeseriesData.data)) {
      // Alternative format: data property contains array
      dataToProcess = normalizedPeriod === 'max'
        ? timeseriesData.data
        : timeseriesData.data.filter((item: any) => {
            const itemDate = new Date(item.date || item.period_end_date);
            return itemDate >= startDate && itemDate <= endDate;
          });
    }
    // sort by date 
    dataToProcess.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Process each data point
    dataToProcess.forEach((item: any, index: number) => {
      const eps = item.eps;
      
      // Extract date fields - handle different property names
      const date = item.date || item.period_end_date;
      const year = item.year || new Date(date).getFullYear();
      const quarter = item.quarter || `Q${item.fiscal_quarter || 1}`;
      
      // Extract dividend_per_share if available (new format)
      const dividendPerShare = item.dividend_per_share;
      
      let currentPE = item.normalPE || item.pe_ratio || 18.0;
      
      // sum of last 4 quarters before the current item using adjusted EPS
      const annualEps = dataToProcess.slice(Math.max(0, index - 4), index).reduce((sum, item) => {
        // Use eps_adjusted if available, otherwise fall back to eps
        const epsValue = item.eps_adjusted !== undefined && item.eps_adjusted !== null 
          ? item.eps_adjusted 
          : item.eps;
        return sum + (epsValue || 0);
      }, 0);
      const fairValue = annualEps * currentPE;
      
      // Calculate dividendsPOR (Payout Ratio) from dividend_per_share if available
      const dividendsPOR = dataToProcess.slice(Math.max(0, index - 4), index).reduce((sum, item) => sum + item.dividend_per_share, 0);
      quarterlyDataPoints.push({
        date: date,
        fyDate: date,
        year: year,
        quarter: quarter,
        eps: eps,
        eps_adjusted: item.eps_adjusted !== undefined && item.eps_adjusted !== null ? item.eps_adjusted : eps,
        normalPE: Math.round(currentPE * 100) / 100,
        fairValue: fairValue ? Math.round(fairValue * 100) / 100 : undefined,
        dividendsPOR: Math.round(dividendsPOR * 100) / 100,
        estimated: item.estimated || false
      });
    });
    
    // Extract ticker symbol - handle both old and new format
    const tickerSymbol = Array.isArray(timeseriesData) 
      ? (timeseriesData[0]?.ticker || ticker.toUpperCase())
      : (timeseriesData.ticker || timeseriesData.metadata?.ticker || ticker.toUpperCase());
    
    // Extract metadata - handle both old and new format
    const metadata = Array.isArray(timeseriesData)
      ? { updated_at: new Date().toISOString() }
      : (timeseriesData.metadata || { updated_at: new Date().toISOString() });
    
    const response: QuarterlyDataResponse = {
      symbol: tickerSymbol,
      data: quarterlyDataPoints,
      metadata: {
        lastUpdated: metadata.updated_at || metadata.generated_at || new Date().toISOString(),
        dataRange: {
          start: quarterlyDataPoints.length > 0 ? quarterlyDataPoints[0].date : '',
          end: quarterlyDataPoints.length > 0 ? quarterlyDataPoints[quarterlyDataPoints.length - 1].date : ''
        }
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching quarterly time series:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly time series data' },
      { status: 500 }
    );
  }
}