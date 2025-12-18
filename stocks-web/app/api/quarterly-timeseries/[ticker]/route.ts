import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../../lib/firebaseService';
import { QuarterlyDataResponse, QuarterlyDataPoint } from '../../../types/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`Quarterly API Request: ${ticker}`);

    // Try to get cached quarterly time series data
    const timeseriesData = await firebaseService.getQuarterlyTimeseries(ticker);

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
    
    // Extract all data points from different possible formats
    let allDataPoints: any[] = [];
    if (timeseriesData.data && Array.isArray(timeseriesData.data)) {
      allDataPoints = timeseriesData.data;
    } else if (Array.isArray(timeseriesData)) {
      allDataPoints = timeseriesData;
    }
    
    // Return all data - no filtering
    const dataToProcess = allDataPoints;
    console.log(`Returning all ${allDataPoints.length} quarters`);
    
    // Sort by date before processing
    dataToProcess.sort((a, b) => new Date(a.date || a.period_end_date).getTime() - new Date(b.date || b.period_end_date).getTime());
    
    // Process each data point
    dataToProcess.forEach((item: any, index: number) => {
      const eps = item.eps;
      
      // Extract date fields - handle different property names
      const date = item.date || item.period_end_date;
      
      // Extract quarter information from stored data only - do not recalculate
      let quarter: string;
      let year: number;
      
      if (item.quarter_key) {
        // Parse quarter_key format: "YYYYQN" (e.g., "2024Q1")
        const quarterKeyMatch = item.quarter_key.match(/^(\d{4})Q(\d)$/);
        if (quarterKeyMatch) {
          year = parseInt(quarterKeyMatch[1], 10);
          const quarterNum = quarterKeyMatch[2];
          quarter = `Q${quarterNum}`;
        } else {
          // If quarter_key format is unexpected, try to extract from other stored fields
          console.warn(`Unexpected quarter_key format: ${item.quarter_key} for ${ticker}`);
          if (item.fiscal_quarter) {
            quarter = `Q${item.fiscal_quarter}`;
            year = item.fiscal_year || item.year;
          } else if (item.quarter) {
            quarter = item.quarter;
            year = item.year;
          } else {
            // Skip this data point if no quarter info available
            console.warn(`No quarter information found for data point with date ${date}`);
            return;
          }
        }
      } else if (item.fiscal_quarter) {
        quarter = `Q${item.fiscal_quarter}`;
        year = item.fiscal_year || item.year;
      } else if (item.quarter) {
        quarter = item.quarter;
        year = item.year;
      } else {
        // No quarter information in stored data - skip this data point
        console.warn(`No quarter information found in stored data for date ${date}, skipping`);
        return;
      }
      
      // Ensure we have valid year and quarter
      if (!year || !quarter) {
        console.warn(`Invalid year or quarter for data point with date ${date}, skipping`);
        return;
      }
      
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


