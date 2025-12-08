import { NextRequest } from 'next/server';
import { GET } from '../api/stock/[ticker]/route';

describe('Stock API Integration Tests', () => {
  // Increase timeout for real API calls
  jest.setTimeout(30000);

  describe('Real API Integration', () => {
    it('should return price data for a valid ticker (AAPL)', async () => {
      const url = new URL('http://localhost:3000/api/stock/AAPL?period=1y');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: 'AAPL' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('symbol', 'AAPL');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);

      // Verify price data exists
      const priceData = data.data.filter((d: any) => d.frequency === 'daily');
      expect(priceData.length).toBeGreaterThan(0);
      
      // Check that price data has required fields
      const firstPricePoint = priceData[0];
      expect(firstPricePoint).toHaveProperty('date');
      expect(firstPricePoint).toHaveProperty('price');
      expect(firstPricePoint).toHaveProperty('frequency', 'daily');
      expect(typeof firstPricePoint.price).toBe('number');
      expect(firstPricePoint.price).toBeGreaterThan(0);
    });

    it('should return earnings data for a valid ticker (AAPL)', async () => {
      const url = new URL('http://localhost:3000/api/stock/AAPL?period=2y');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: 'AAPL' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);

      // Verify quarterly earnings data exists
      const quarterlyData = data.data.filter((d: any) => d.frequency === 'quarterly');
      expect(quarterlyData.length).toBeGreaterThan(0);

      // Check for historical earnings (estimated: false)
      const historicalEarnings = quarterlyData.filter((d: any) => !d.estimated);
      expect(historicalEarnings.length).toBeGreaterThan(0);

      const firstHistorical = historicalEarnings[0];
      expect(firstHistorical).toHaveProperty('date');
      expect(firstHistorical).toHaveProperty('eps');
      expect(firstHistorical).toHaveProperty('fairValue');
      expect(firstHistorical).toHaveProperty('normalPE');
      expect(firstHistorical).toHaveProperty('frequency', 'quarterly');
      expect(firstHistorical).toHaveProperty('estimated', false);
      expect(typeof firstHistorical.eps).toBe('number');
      expect(typeof firstHistorical.fairValue).toBe('number');

      // Check for forecasted earnings (estimated: true)
      const forecastedEarnings = quarterlyData.filter((d: any) => d.estimated);
      expect(forecastedEarnings.length).toBeGreaterThan(0);

      const firstForecasted = forecastedEarnings[0];
      expect(firstForecasted).toHaveProperty('date');
      expect(firstForecasted).toHaveProperty('eps');
      expect(firstForecasted).toHaveProperty('fairValue');
      expect(firstForecasted).toHaveProperty('frequency', 'quarterly');
      expect(firstForecasted).toHaveProperty('estimated', true);
      expect(typeof firstForecasted.eps).toBe('number');
    });

    it('should work with different tickers (MSFT)', async () => {
      const url = new URL('http://localhost:3000/api/stock/MSFT?period=1y');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: 'MSFT' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('symbol', 'MSFT');
      expect(data).toHaveProperty('companyName');
      expect(data.companyName).toContain('Microsoft');

      // Verify both price and earnings data
      const dailyData = data.data.filter((d: any) => d.frequency === 'daily');
      const quarterlyData = data.data.filter((d: any) => d.frequency === 'quarterly');

      expect(dailyData.length).toBeGreaterThan(0);
      expect(quarterlyData.length).toBeGreaterThan(0);

      // Verify price data structure
      expect(dailyData[0]).toHaveProperty('price');
      expect(typeof dailyData[0].price).toBe('number');

      // Verify earnings data structure
      expect(quarterlyData[0]).toHaveProperty('eps');
      expect(typeof quarterlyData[0].eps).toBe('number');
    });

    it('should handle cache functionality correctly', async () => {
      const ticker = 'GOOGL';
      
      // First call - should fetch fresh data
      const url1 = new URL(`http://localhost:3000/api/stock/${ticker}?period=1y&refresh=true`);
      const request1 = new NextRequest(url1);

      const response1 = await GET(request1, { params: Promise.resolve({ ticker }) });
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1).toHaveProperty('symbol', ticker.toUpperCase());

      // Second call without refresh - should use cache if available
      const url2 = new URL(`http://localhost:3000/api/stock/${ticker}?period=1y`);
      const request2 = new NextRequest(url2);

      const startTime = Date.now();
      const response2 = await GET(request2, { params: Promise.resolve({ ticker }) });
      const endTime = Date.now();
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2).toHaveProperty('symbol', ticker.toUpperCase());

      // Cached response should be faster (less than 2 seconds)
      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(2000);

      // Data structure should be the same
      expect(data2).toHaveProperty('data');
      expect(Array.isArray(data2.data)).toBe(true);
    });

    it('should return error for invalid ticker', async () => {
      const url = new URL('http://localhost:3000/api/stock/INVALIDTICKER123');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: 'INVALIDTICKER123' }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Unable to fetch data for ticker INVALIDTICKER123');
    });

    it('should return error when no ticker provided', async () => {
      const url = new URL('http://localhost:3000/api/stock/');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: '' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Ticker symbol is required');
    });

    it('should handle different time periods correctly', async () => {
      const periods = ['1y', '2y', '5y'];
      
      for (const period of periods) {
        const url = new URL(`http://localhost:3000/api/stock/AAPL?period=${period}&refresh=true`);
        const request = new NextRequest(url);

        const response = await GET(request, { params: Promise.resolve({ ticker: 'AAPL' }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty('symbol', 'AAPL');

        const dailyData = data.data.filter((d: any) => d.frequency === 'daily');
        expect(dailyData.length).toBeGreaterThan(0);

        // Longer periods should have more data points
        if (period === '5y') {
          expect(dailyData.length).toBeGreaterThan(1000); // Roughly 5 years of trading days
        } else if (period === '2y') {
          expect(dailyData.length).toBeGreaterThan(400); // Roughly 2 years of trading days
        } else if (period === '1y') {
          expect(dailyData.length).toBeGreaterThan(200); // Roughly 1 year of trading days
        }
      }
    });

    it('should validate data quality and consistency', async () => {
      const url = new URL('http://localhost:3000/api/stock/AAPL?period=1y');
      const request = new NextRequest(url);

      const response = await GET(request, { params: Promise.resolve({ ticker: 'AAPL' }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const dailyData = data.data.filter((d: any) => d.frequency === 'daily');
      const quarterlyData = data.data.filter((d: any) => d.frequency === 'quarterly');

      // Validate daily price data
      for (const point of dailyData.slice(0, 10)) { // Check first 10 points
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('price');
        expect(point.price).toBeGreaterThan(0);
        expect(point.frequency).toBe('daily');
        expect(new Date(point.date)).toBeInstanceOf(Date);
      }

      // Validate quarterly earnings data
      for (const point of quarterlyData.slice(0, 5)) { // Check first 5 quarters
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('eps');
        expect(point).toHaveProperty('fairValue');
        expect(point).toHaveProperty('estimated');
        expect(point.frequency).toBe('quarterly');
        expect(typeof point.eps).toBe('number');
        expect(typeof point.fairValue).toBe('number');
        expect(typeof point.estimated).toBe('boolean');
        expect(new Date(point.date)).toBeInstanceOf(Date);
      }

      // Verify we have both historical and forecasted earnings
      const historical = quarterlyData.filter((d: any) => !d.estimated);
      const forecasted = quarterlyData.filter((d: any) => d.estimated);
      
      expect(historical.length).toBeGreaterThan(0);
      expect(forecasted.length).toBeGreaterThan(0);
    });
  });
});