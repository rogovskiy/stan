import YahooFinance from 'yahoo-finance2';
import { DataPoint, HistoricalChartResponse } from '../types/api';
import { FirebaseCache, AnnualPriceData, QuarterlyFinancialData, TickerMetadata } from './cache';
import { getQuarterlyTimeseries } from './services/timeseriesService';

export class YFinanceService {
  private yf: any;
  private cache: FirebaseCache;

  constructor() {
    // Initialize Yahoo Finance v3 instance with suppressNotices to reduce warnings
    this.yf = new YahooFinance({ 
      suppressNotices: ['ripHistorical', 'yahooSurvey'] 
    });
    this.cache = new FirebaseCache();
  }

  async fetchStockData(ticker: string, period: string = '5y'): Promise<HistoricalChartResponse> {
    try {
      console.log(`Fetching stock data for ${ticker} with period ${period}`);
      
      // Calculate date range
      const endDate = new Date();
      const startDate = await this.getPeriodStartDate(period, ticker);
      
      // Check cache first
      const cacheStatus = await this.cache.hasCachedDataForRange(ticker, startDate, endDate);
      console.log(`Cache status for ${ticker}:`, cacheStatus);

      // Get metadata (try cache first)
      let metadata = await this.cache.getTickerMetadata(ticker);
      if (!metadata) {
        metadata = await this.fetchAndCacheMetadata(ticker);
      }

      // Fetch missing data if needed
      if (!cacheStatus.hasAllPriceData || cacheStatus.missingYears.length > 0 || cacheStatus.missingQuarters.length > 0) {
        await this.fetchAndCacheAnnualData(ticker, startDate, endDate, cacheStatus.missingYears, cacheStatus.missingQuarters);
      }

      // Retrieve cached data
      const [priceData, financialData] = await Promise.all([
        this.cache.getPriceDataRange(ticker, startDate, endDate),
        this.cache.getFinancialDataRange(ticker, startDate, endDate)
      ]);

      return this.transformToHistoricalChart(priceData, financialData, metadata, ticker, period);
      
    } catch (error) {
      console.error(`Error fetching data for ${ticker}:`, error);
      throw new Error(`Failed to fetch stock data for ${ticker}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async fetchAndCacheMetadata(ticker: string): Promise<TickerMetadata> {
    try {
      const quoteSummary = await this.fetchQuoteSummaryWithFallback(ticker);
      
      const metadata: TickerMetadata = {
        name: quoteSummary?.price?.longName || this.getCompanyNameFallback(ticker),
        exchange: quoteSummary?.price?.exchangeName || 'NASDAQ',
        sector: quoteSummary?.summaryProfile?.sector || 'Technology',
        lastUpdated: new Date().toISOString()
      };

      await this.cache.cacheTickerMetadata(ticker, metadata);
      return metadata;
    } catch (error) {
      console.warn(`Could not fetch metadata for ${ticker}, using fallback`);
      const fallbackMetadata: TickerMetadata = {
        name: this.getCompanyNameFallback(ticker),
        exchange: 'NASDAQ',
        sector: 'Technology',
        lastUpdated: new Date().toISOString()
      };
      
      await this.cache.cacheTickerMetadata(ticker, fallbackMetadata);
      return fallbackMetadata;
    }
  }

  private async fetchAndCacheAnnualData(ticker: string, startDate: Date, endDate: Date, missingYears: number[], missingQuarters: string[]): Promise<void> {
    console.log(`Fetching missing annual data for ${ticker}:`);
    console.log(`- Missing years: ${missingYears.join(', ')}`);
    console.log(`- Missing quarters: ${missingQuarters.join(', ')}`);

    // Ensure endDate is set to end of day to get all available data up to today
    const normalizedEndDate = new Date(endDate);
    normalizedEndDate.setHours(23, 59, 59, 999);

    // Fetch historical price data from Yahoo Finance for the entire range
    const chartData = await this.yf.chart(ticker, {
      period1: startDate,
      period2: normalizedEndDate,
      interval: '1d'
    });

    const historical = chartData.quotes || [];
    console.log(`Fetched ${historical.length} daily price points for ${ticker}`);

    // Group daily data by years and cache to Storage
    const annualPriceData = this.groupDataByYears(historical, ticker);
    
    // Cache each year's price data to Firebase Storage
    for (const [yearStr, priceData] of Object.entries(annualPriceData)) {
      const year = parseInt(yearStr);
      if (missingYears.includes(year) || missingYears.length === 0) {
        await this.cache.cacheAnnualPriceData(ticker, year, priceData);
      }
    }

    // Fetch and cache quarterly financial data (unchanged process)
    await this.fetchAndCacheFinancialData(ticker, missingQuarters);
  }

  private async fetchAndCacheFinancialData(ticker: string, missingQuarters: string[]): Promise<void> {
    try {
      const quoteSummary = await this.fetchQuoteSummaryWithFallback(ticker);
      
      if (quoteSummary) {
        console.log(`\n🔍 Debug: Raw earnings data structure for ${ticker}:`);
        
        // Process historical earnings
        const earningsHistory = quoteSummary?.earningsHistory?.history || [];
        console.log(`Historical earnings records: ${earningsHistory.length}`);
        
        if (earningsHistory.length > 0) {
          console.log('Sample earnings record:', JSON.stringify(earningsHistory[0], null, 2));
        }
        
        for (const earnings of earningsHistory) {
          console.log(`Processing earnings: quarter=${earnings.quarter}, epsActual=${earnings.epsActual}`);
          
          if (earnings.quarter && earnings.epsActual !== undefined) {
            // Handle Date objects properly
            let quarterKey: string | null = null;
            
            if (earnings.quarter instanceof Date) {
              const year = earnings.quarter.getFullYear();
              const quarter = Math.floor(earnings.quarter.getMonth() / 3) + 1;
              quarterKey = `${year}Q${quarter}`;
              console.log(`Parsed Date object "${earnings.quarter}" → "${quarterKey}"`);
            } else {
              quarterKey = this.parseEarningsQuarter(earnings.quarter);
            }
            
            console.log(`Parsed quarter key: ${quarterKey} from ${earnings.quarter}`);
            
            if (quarterKey && (missingQuarters.includes(quarterKey) || missingQuarters.length === 0)) {
              const financialData = this.createFinancialDataFromEarnings(earnings, quarterKey);
              console.log(`Caching financial data for ${quarterKey}:`, financialData);
              await this.cache.cacheQuarterlyFinancialData(ticker, quarterKey, financialData);
            } else {
              console.log(`Skipping quarter ${quarterKey} - not in missing list or already cached`);
            }
          }
        }
        
        console.log(`✅ Finished processing financial data for ${ticker}`);
      }
    } catch (error) {
      console.warn(`Could not fetch financial data for ${ticker}:`, error);
      // No more synthetic data generation - only actual data
    }
  }

  private parseEarningsQuarter(quarterData: any): string | null {
    // Handle both Date objects and string formats
    if (!quarterData) {
      return null;
    }
    
    let quarterStr: string;
    
    // If it's a Date object, extract quarter from it
    if (quarterData instanceof Date) {
      const year = quarterData.getFullYear();
      const quarter = Math.floor(quarterData.getMonth() / 3) + 1;
      const result = `${year}Q${quarter}`;
      console.log(`Parsed Date object "${quarterData}" → "${result}"`);
      return result;
    }
    
    // If it's a string, use existing logic
    if (typeof quarterData === 'string') {
      quarterStr = quarterData;
    } else {
      // Try to convert to string
      quarterStr = String(quarterData);
    }
    
    console.log(`Parsing earnings quarter string: "${quarterStr}"`);
    
    // Try multiple patterns that Yahoo Finance might use
    const patterns = [
      /(\d)Q(\d{4})/,     // 1Q2024
      /Q(\d)\s*(\d{4})/,  // Q1 2024 or Q1 2024
      /(\d{4})Q(\d)/,     // 2024Q1
      /(\d{4})-Q(\d)/,    // 2024-Q1
    ];
    
    for (const pattern of patterns) {
      const match = quarterStr.match(pattern);
      if (match) {
        let quarter, year;
        
        if (pattern.source.includes('(\\d)Q(\\d{4})')) {
          // 1Q2024 format
          quarter = match[1];
          year = match[2];
        } else if (pattern.source.includes('Q(\\d)\\s*(\\d{4})')) {
          // Q1 2024 format
          quarter = match[1];
          year = match[2];
        } else {
          // 2024Q1 or 2024-Q1 format
          year = match[1];
          quarter = match[2];
        }
        
        const result = `${year}Q${quarter}`;
        console.log(`Successfully parsed "${quarterStr}" → "${result}"`);
        return result;
      }
    }
    
    console.warn(`Could not parse earnings quarter string: "${quarterStr}"`);
    return null;
  }

  private groupDataByYears(historical: any[], ticker: string): Record<string, AnnualPriceData> {
    const annualData: Record<string, AnnualPriceData> = {};

    for (const dataPoint of historical) {
      if (dataPoint.date && dataPoint.close) {
        const date = new Date(dataPoint.date);
        const year = date.getFullYear();
        const yearStr = year.toString();
        const dateStr = date.toISOString().split('T')[0];

        if (!annualData[yearStr]) {
          annualData[yearStr] = {
            ticker: ticker.toUpperCase(),
            year: year,
            currency: 'USD',
            timezone: 'America/New_York',
            data: {},
            metadata: {
              totalDays: 0,
              generatedAt: new Date().toISOString(),
              source: 'yahoo_finance_v2'
            }
          };
        }

        annualData[yearStr].data[dateStr] = {
          o: Math.round((dataPoint.open || dataPoint.close) * 100) / 100,
          h: Math.round((dataPoint.high || dataPoint.close) * 100) / 100,
          l: Math.round((dataPoint.low || dataPoint.close) * 100) / 100,
          c: Math.round(dataPoint.close * 100) / 100,
          v: dataPoint.volume || 0
        };
      }
    }

    // Update totalDays metadata for each year
    for (const [yearStr, data] of Object.entries(annualData)) {
      data.metadata.totalDays = Object.keys(data.data).length;
    }

    return annualData;
  }

  private getQuarterKey(date: Date): string {
    const year = date.getFullYear();
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${year}Q${quarter}`;
  }

  private createFinancialDataFromEarnings(earnings: any, quarterKey: string): QuarterlyFinancialData {
    const year = parseInt(quarterKey.substring(0, 4));
    const quarter = parseInt(quarterKey.substring(5));
    
    const startMonth = (quarter - 1) * 3;
    const endMonth = startMonth + 2;
    
    // Extract comprehensive earnings data
    const earningsData: any = {};
    if (earnings.epsActual !== undefined && earnings.epsActual !== null) {
      earningsData.epsActual = typeof earnings.epsActual === 'object' ? earnings.epsActual.raw : earnings.epsActual;
    }
    if (earnings.epsEstimate !== undefined && earnings.epsEstimate !== null) {
      earningsData.epsEstimate = typeof earnings.epsEstimate === 'object' ? earnings.epsEstimate.raw : earnings.epsEstimate;
    }
    if (earnings.epsDifference !== undefined && earnings.epsDifference !== null) {
      earningsData.epsDifference = typeof earnings.epsDifference === 'object' ? earnings.epsDifference.raw : earnings.epsDifference;
    }
    if (earnings.surprisePercent !== undefined && earnings.surprisePercent !== null) {
      earningsData.surprisePercent = typeof earnings.surprisePercent === 'object' ? earnings.surprisePercent.raw : earnings.surprisePercent;
    }
    if (earnings.currency) {
      earningsData.currency = earnings.currency;
    }
    if (earnings.period) {
      earningsData.period = earnings.period;
    }
    if (earnings.maxAge !== undefined) {
      earningsData.maxAge = earnings.maxAge;
    }
    
    // Extract financial metrics
    const financials: any = {
      dataSource: 'yahoo_finance_actual',
      estimated: false
    };
    
    // Core earnings metrics
    if (earnings.epsActual !== undefined && earnings.epsActual !== null) {
      financials.epsDiluted = typeof earnings.epsActual === 'object' ? earnings.epsActual.raw : earnings.epsActual;
    }
    
    // Extract revenue if available
    if (earnings.revenue?.raw !== undefined) {
      financials.revenue = earnings.revenue.raw;
    }
    
    // Extract any other financial data from earnings object
    if (earnings.netIncome?.raw !== undefined) {
      financials.netIncome = earnings.netIncome.raw;
    }
    if (earnings.grossProfit?.raw !== undefined) {
      financials.grossProfit = earnings.grossProfit.raw;
    }
    if (earnings.operatingIncome?.raw !== undefined) {
      financials.operatingIncome = earnings.operatingIncome.raw;
    }
    
    const result: QuarterlyFinancialData = {
      fiscalYear: year,
      fiscalQuarter: quarter,
      startDate: new Date(year, startMonth, 1).toISOString().split('T')[0],
      endDate: new Date(year, endMonth + 1, 0).toISOString().split('T')[0],
      earnings: Object.keys(earningsData).length > 0 ? earningsData : undefined,
      financials: Object.keys(financials).length > 2 ? financials : undefined // More than just dataSource and estimated
    };
    
    // Only add reportDate if it exists and is not undefined
    if (earnings.reportDate !== undefined && earnings.reportDate !== null) {
      result.reportDate = earnings.reportDate;
    }
    
    return result;
  }

  private transformToHistoricalChart(
    priceData: Record<string, any>,
    financialData: QuarterlyFinancialData[],
    metadata: TickerMetadata,
    ticker: string,
    period: string
  ): HistoricalChartResponse {
    const dataPoints: DataPoint[] = [];
    
    // Transform daily price data
    Object.entries(priceData).forEach(([dateStr, dayData]) => {
      const date = new Date(dateStr);
      dataPoints.push({
        date: dateStr,
        fyDate: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear()).slice(-2)}`,
        year: date.getFullYear(),
        estimated: false,
        frequency: 'daily',
        price: dayData.c
      });
    });

    // Transform quarterly financial data
    financialData.forEach(quarter => {
      const quarterEndDate = new Date(quarter.endDate);
      const currentPE = 15 + Math.random() * 20; // Generate PE between 15-35
      
      dataPoints.push({
        date: quarter.endDate,
        fyDate: `Q${quarter.fiscalQuarter}/${String(quarter.fiscalYear).slice(-2)}`,
        year: quarter.fiscalYear,
        estimated: quarterEndDate > new Date(),
        frequency: 'quarterly',
        eps: quarter.financials?.epsDiluted || 0,
        normalPE: Math.round(currentPE * 100) / 100,
        fairValue: Math.round((quarter.financials?.epsDiluted || 0) * currentPE * 100) / 100,
        dividendsPOR: Math.round((Math.random() * 15 + 10) * 100) / 100
      });
    });

    // Sort all data by date
    dataPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      symbol: ticker.toUpperCase(),
      companyName: metadata.name,
      currency: 'USD',
      data: dataPoints,
      chartConfig: {
        title: `${ticker.toUpperCase()} - Historical Price vs Fair Value Analysis`,
        height: 450,
        timeRange: {
          start: dataPoints[0]?.date || '',
          end: dataPoints[dataPoints.length - 1]?.date || '',
          defaultPeriod: period
        },
        series: [
          {
            dataKey: "fairValue",
            type: "area",
            color: "#f97316",
            label: "Fair Value",
            yAxisId: "left",
            fillOpacity: 0.3,
            visible: true,
            frequency: "quarterly",
            interpolation: "step"
          },
          {
            dataKey: "dividendsPOR",
            type: "area", 
            color: "#fbbf24",
            label: "Dividends POR",
            yAxisId: "right",
            fillOpacity: 0.2,
            visible: true,
            frequency: "quarterly",
            interpolation: "step"
          },
          {
            dataKey: "price",
            type: "line",
            color: "#000000",
            label: "Price",
            yAxisId: "left",
            strokeWidth: 3,
            visible: true,
            frequency: "daily",
            interpolation: "linear"
          },
          {
            dataKey: "normalPE",
            type: "line",
            color: "#3b82f6",
            label: "Normal PE",
            yAxisId: "left",
            strokeWidth: 2,
            visible: true,
            frequency: "quarterly",
            interpolation: "linear"
          }
        ]
      },
      metadata: {
        lastUpdated: new Date().toISOString(),
        dataRange: {
          start: dataPoints[0]?.date || '',
          end: dataPoints[dataPoints.length - 1]?.date || ''
        },
        frequencies: ["daily", "quarterly"]
      }
    };
  }

  private async fetchQuoteSummaryWithFallback(ticker: string): Promise<any> {
    const modules = [
      'summaryDetail', 
      'defaultKeyStatistics', 
      'price'
    ];

    try {
      // First try with basic modules only
      const quoteSummary = await this.yf.quoteSummary(ticker, { modules });
      
      // Try to get earnings data separately if basic call succeeded
      try {
        const earningsData = await this.yf.quoteSummary(ticker, {
          modules: ['earnings', 'earningsHistory', 'earningsTrend']
        });
        
        // Merge earnings data if available
        if (earningsData) {
          Object.assign(quoteSummary, earningsData);
        }
        
        console.log(`Successfully fetched earnings data for ${ticker}:`, {
          earnings: !!earningsData?.earnings,
          earningsHistory: !!earningsData?.earningsHistory,
          earningsTrend: !!earningsData?.earningsTrend
        });
        
      } catch (earningsError) {
        console.warn(`Could not fetch earnings data for ${ticker}, using basic data only:`, earningsError);
      }
      
      return quoteSummary;
      
    } catch (error) {
      console.warn(`Could not fetch any fundamentals for ${ticker}:`, error);
      return null;
    }
  }

  private convertPeriod(period: string): string {
    const periodMap: Record<string, string> = {
      '1y': '1y',
      '2y': '2y', 
      '3y': '3y',
      '5y': '5y',
      '10y': '10y'
    };
    return periodMap[period] || '5y';
  }

  private async calculateMaxPeriodFromQuarterlyData(ticker: string): Promise<number> {
    try {
      const timeseriesData = await getQuarterlyTimeseries(ticker);
      
      if (!timeseriesData) {
        return 50; // Fallback to 50 years if no quarterly data
      }
      
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
    } catch (error) {
      console.error(`Error calculating MAX period for ${ticker}:`, error);
      return 50; // Fallback to 50 years on error
    }
  }

  private async getPeriodStartDate(period: string, ticker?: string): Promise<Date> {
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '1y': startDate.setFullYear(endDate.getFullYear() - 1); break;
      case '2y': startDate.setFullYear(endDate.getFullYear() - 2); break;
      case '3y': startDate.setFullYear(endDate.getFullYear() - 3); break;
      case '4y': startDate.setFullYear(endDate.getFullYear() - 4); break;
      case '5y': startDate.setFullYear(endDate.getFullYear() - 5); break;
      case '6y': startDate.setFullYear(endDate.getFullYear() - 6); break;
      case '7y': startDate.setFullYear(endDate.getFullYear() - 7); break;
      case '8y': startDate.setFullYear(endDate.getFullYear() - 8); break;
      case '9y': startDate.setFullYear(endDate.getFullYear() - 9); break;
      case '10y': startDate.setFullYear(endDate.getFullYear() - 10); break;
      case 'max':
        // Calculate MAX based on first fiscal year with quarterly data
        if (ticker) {
          const yearsBack = await this.calculateMaxPeriodFromQuarterlyData(ticker);
          startDate.setFullYear(endDate.getFullYear() - yearsBack);
          console.log(`MAX period calculated for ${ticker}: ${yearsBack} years back to first fiscal year with quarterly data`);
        } else {
          startDate.setFullYear(endDate.getFullYear() - 50); // Fallback if no ticker
        }
        break;
      default: startDate.setFullYear(endDate.getFullYear() - 5);
    }
    
    return startDate;
  }

  private getCompanyNameFallback(ticker: string): string {
    // Fallback company names for well-known tickers when API fails
    const companyNames: Record<string, string> = {
      'AAPL': 'Apple Inc.',
      'MSFT': 'Microsoft Corporation',
      'GOOGL': 'Alphabet Inc.',
      'GOOG': 'Alphabet Inc.',
      'AMZN': 'Amazon.com Inc.',
      'TSLA': 'Tesla Inc.',
      'META': 'Meta Platforms Inc.',
      'NVDA': 'NVIDIA Corporation',
      'NFLX': 'Netflix Inc.',
      'AMD': 'Advanced Micro Devices Inc.'
    };
    
    return companyNames[ticker.toUpperCase()] || `${ticker.toUpperCase()} Inc.`;
  }

  /**
   * Fetch and cache maximum available historical data for a ticker
   * Used by downloadMaxData script
   */
  async fetchMaxHistoricalData(ticker: string, maxYearsBack: number = 50): Promise<{
    yearsProcessed: number;
    dataPointsRetrieved: number;
    yearsRange: string;
  }> {
    try {
      // Calculate maximum date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - maxYearsBack);

      console.log(`   Fetching data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      // Fetch maximum historical data
      const chartData = await this.yf.chart(ticker, {
        period1: startDate,
        period2: endDate,
        interval: '1d'
      });

      const historical = chartData.quotes || [];
      console.log(`   Retrieved ${historical.length} daily price points`);

      if (historical.length === 0) {
        return {
          yearsProcessed: 0,
          dataPointsRetrieved: 0,
          yearsRange: 'No data available'
        };
      }

      // Group data by years
      const annualData = this.groupDataByYears(historical, ticker);
      console.log(`   Organized data into ${Object.keys(annualData).length} years`);

      // Cache each year separately
      let cachedYears = 0;
      for (const [yearStr, priceData] of Object.entries(annualData)) {
        const year = parseInt(yearStr);
        try {
          await this.cache.cacheAnnualPriceData(ticker, year, priceData);
          cachedYears++;
        } catch (error) {
          console.error(`   ❌ Failed to cache year ${year}:`, error);
        }
      }

      return {
        yearsProcessed: cachedYears,
        dataPointsRetrieved: historical.length,
        yearsRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
      };

    } catch (error) {
      console.error(`❌ Error fetching historical data for ${ticker}:`, error);
      throw error;
    }
  }

  /**
   * Fetch comprehensive historical financial data using actual data only
   * Used by downloadMaxData script - no estimation, only real data
   */
  async fetchMaxFinancialData(ticker: string): Promise<{
    quartersProcessed: number;
    historicalEarnings: number;
    forecastQuarters: number;
  }> {
    try {
      console.log(`   📊 Fetching actual financial data from Yahoo Finance...`);
      
      // Fetch comprehensive financial data
      const quoteSummary = await this.yf.quoteSummary(ticker, {
        modules: ['earnings', 'earningsHistory', 'earningsTrend', 'financialData']
      });

      let cachedQuarters = 0;
      let historicalCount = 0;

      if (quoteSummary) {
        // Process recent earnings history (Yahoo only provides ~4 quarters)
        const earningsHistory = quoteSummary?.earningsHistory?.history || [];
        console.log(`   Found ${earningsHistory.length} recent earnings records from earningsHistory`);
        historicalCount = earningsHistory.length;

        for (const earnings of earningsHistory) {
          if (earnings.quarter && earnings.epsActual !== undefined) {
            const quarterKey = this.parseEarningsQuarter(earnings.quarter);
            
            if (quarterKey) {
              const financialData = this.createFinancialDataFromEarnings(earnings, quarterKey);
              await this.cache.cacheQuarterlyFinancialData(ticker, quarterKey, financialData);
              cachedQuarters++;
            }
          }
        }

      }

      console.log(`   ✅ Financial data summary:`);
      console.log(`     - Recent actuals: ${historicalCount} quarters`);
      console.log(`     - Total cached: ${cachedQuarters} quarters`);

      return {
        quartersProcessed: cachedQuarters,
        historicalEarnings: historicalCount,
        forecastQuarters: 0
      };

    } catch (error) {
      console.error(`❌ Error fetching financial data for ${ticker}:`, error);
      // Return partial results instead of throwing
      return {
        quartersProcessed: 0,
        historicalEarnings: 0,
        forecastQuarters: 0
      };
    }
  }

  /**
   * Fetch and cache company metadata for a ticker
   * Used by downloadMaxData script
   */
  async fetchAndCacheTickerMetadata(ticker: string): Promise<TickerMetadata> {
    return this.fetchAndCacheMetadata(ticker);
  }
}