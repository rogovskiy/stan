import { getQuarterlyTimeseries } from '../lib/services/timeseriesService';
import { getTickerMetadata, hasTickerData } from '../lib/services/tickerMetadataService';

describe('Quarterly Time Series Integration Tests', () => {
  test('getQuarterlyTimeseries method exists and can retrieve AAPL quarterly timeseries', async () => {
    // Test that the method exists
    expect(getQuarterlyTimeseries).toBeDefined();
    expect(typeof getQuarterlyTimeseries).toBe('function');
    
    // Test retrieving the AAPL quarterly timeseries data from ticker-specific location
    const result = await getQuarterlyTimeseries('AAPL');
    
    console.log('getQuarterlyTimeseries result:', result);
    
    if (result) {
      // If data exists, test the structure
      expect(result).toHaveProperty('ticker', 'AAPL');
      expect(result).toHaveProperty('eps');
      expect(result).toHaveProperty('revenue');
      expect(result).toHaveProperty('dividends');
      expect(result).toHaveProperty('metadata');
      
      // Test EPS data structure
      expect(result.eps).toHaveProperty('data');
      expect(result.eps).toHaveProperty('count');
      expect(Array.isArray(result.eps.data)).toBe(true);
      
      // Test Revenue data structure
      expect(result.revenue).toHaveProperty('data');
      expect(result.revenue).toHaveProperty('count');
      expect(Array.isArray(result.revenue.data)).toBe(true);
      
      console.log('EPS quarters found:', result.eps.count);
      console.log('Revenue quarters found:', result.revenue.count);
      console.log('Latest EPS:', result.eps.latest_value);
      console.log('Latest Revenue:', result.revenue.latest_value);
    } else {
      console.log('No quarterly timeseries data found for AAPL');
      console.log('Make sure to run: python generate_quarterly_timeseries.py AAPL');
    }
  }, 30000); // 30 second timeout for Firebase operations

  test('can access Firebase and retrieve ticker metadata', async () => {
    // Test basic Firebase connectivity by getting ticker metadata
    const metadata = await getTickerMetadata('AAPL');
    console.log('AAPL metadata:', metadata);
    
    if (metadata) {
      expect(metadata).toHaveProperty('name');
      expect(metadata).toHaveProperty('exchange');
    }
  });

  test('can check if ticker data exists', async () => {
    // Test basic Firebase read operations
    const hasData = await hasTickerData('AAPL');
    console.log('AAPL has ticker data:', hasData);
    expect(typeof hasData).toBe('boolean');
  });
});