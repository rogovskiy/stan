import { transformApiDataForChart, TransformedDataPoint } from '../components/stockChartTransform';
import { APIResponse, DailyDataPoint, QuarterlyDataPoint } from '../types/api';

// Legacy type for backward compatibility in tests
interface LegacyDataPoint {
  date: string;
  fyDate: string;
  year: number;
  estimated: boolean;
  frequency: 'daily' | 'quarterly';
  price?: number;
  eps?: number;
  normalPE?: number;
  fairValue?: number;
  dividendsPOR?: number;
}

// Mock Math.random to make tests deterministic
const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

// Mock console.log to avoid test output noise
const mockConsoleLog = jest.fn();
global.console.log = mockConsoleLog;

describe('transformApiDataForChart (New Separated Function)', () => {
  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  describe('Basic functionality', () => {
    it('should transform daily data without quarterly data', () => {
      const dailyData = createMockDailyData(['2023-01-01', '2023-01-02'], [100, 105]);
      const result = transformApiDataForChart(dailyData);
      
      expect(result).toHaveLength(2);
      expect(result[0].stockPrice).toBe(100);
      expect(result[0].hasQuarterlyData).toBe(false);
      expect(result[1].stockPrice).toBe(105);
      expect(result[1].hasQuarterlyData).toBe(false);
    });

    it('should merge daily and quarterly data on matching dates', () => {
      const dailyData = createMockDailyData(['2023-01-01', '2023-01-02', '2023-01-03'], [100, 105, 110]);
      const quarterlyData = createMockQuarterlyData(['2023-01-02'], [{ eps: 2.5, fairValue: 150 }]);
      
      const result = transformApiDataForChart(dailyData, quarterlyData);
      
      expect(result).toHaveLength(3);
      expect(result[1].hasQuarterlyData).toBe(true);
      expect(result[1].earnings).toBe(2.5);
      expect(result[1].fairValue).toBe(150);
      expect(result[0].hasQuarterlyData).toBe(false);
      expect(result[2].hasQuarterlyData).toBe(false);
    });
  });
});

describe('transformLegacyApiDataForChart (Backward Compatibility)', () => {
  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  const createMockDailyData = (dates: string[], prices: number[]): DailyDataPoint[] => {
    return dates.map((date, index) => ({
      date,
      fyDate: date.slice(5, 7) + '/' + date.slice(2, 4),
      year: parseInt(date.slice(0, 4)),
      estimated: false,
      price: prices[index]
    }));
  };

  const createMockQuarterlyData = (dates: string[], data: Partial<QuarterlyDataPoint>[]): QuarterlyDataPoint[] => {
    return dates.map((date, index) => ({
      date,
      fyDate: date.slice(5, 7) + '/' + date.slice(2, 4),
      year: parseInt(date.slice(0, 4)),
      quarter: 'Q1',
      estimated: false,
      eps: 0,
      ...data[index]
    }));
  };

  // Legacy test helpers for backward compatibility
  const createMockLegacyDailyData = (dates: string[], prices: number[]) => {
    return dates.map((date, index) => ({
      date,
      fyDate: date.slice(5, 7) + '/' + date.slice(2, 4),
      year: parseInt(date.slice(0, 4)),
      estimated: false,
      frequency: 'daily' as const,
      price: prices[index]
    }));
  };

  const createMockLegacyQuarterlyData = (dates: string[], data: any[]) => {
    return dates.map((date, index) => ({
      date,
      fyDate: date.slice(5, 7) + '/' + date.slice(2, 4),
      year: parseInt(date.slice(0, 4)),
      estimated: false,
      frequency: 'quarterly' as const,
      ...data[index]
    }));
  };

  const createMockAPIResponse = (dailyData: LegacyDataPoint[], quarterlyData: LegacyDataPoint[] = []): APIResponse => ({
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    currency: 'USD',
    data: [...dailyData, ...quarterlyData],
    chartConfig: {} as any,
    metadata: {} as any
  });

  describe('Basic functionality', () => {
    it('should transform daily data without quarterly data', () => {
      const dailyData = createMockLegacyDailyData(['2023-01-01', '2023-01-02'], [150, 151]);
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        fullDate: '2023-01-01',
        stockPrice: 150,
        frequency: 'daily',
        hasQuarterlyData: false,
        fairValue: null,
        earnings: null
      });
      expect(result[1]).toMatchObject({
        fullDate: '2023-01-02',
        stockPrice: 151,
        frequency: 'daily',
        hasQuarterlyData: false
      });
    });

    it('should merge quarterly data with matching daily data', () => {
      const dailyData = createMockDailyData(['2023-01-01', '2023-01-02'], [150, 151]);
      const quarterlyData = createMockQuarterlyData(['2023-01-01'], [{
        eps: 2.5,
        fairValue: 160,
        normalPE: 20,
        dividendsPOR: 2.5
      }]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result).toHaveLength(2);
      
      // First point should have quarterly data
      expect(result[0]).toMatchObject({
        fullDate: '2023-01-01',
        stockPrice: 150,
        hasQuarterlyData: true,
        fairValue: 160,
        earnings: 2.5,
        normalPE: 20,
        dividendsPOR: 2.5,
        peRatio: 20
      });
      expect(result[0].dividend).toBeGreaterThan(0);
      expect(result[0].revenue).toBe(2.5 * 4 * 16.0);

      // Second point should not have quarterly data
      expect(result[1]).toMatchObject({
        fullDate: '2023-01-02',
        stockPrice: 151,
        hasQuarterlyData: false,
        fairValue: null,
        earnings: null
      });
    });

    it('should handle missing price data gracefully', () => {
      const dailyData: LegacyDataPoint[] = [{
        date: '2023-01-01',
        fyDate: '01/23',
        year: 2023,
        estimated: false,
        frequency: 'daily',
        price: undefined
      }];
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        stockPrice: undefined,
        marketCap: null
      });
    });
  });

  describe('Quarterly data matching', () => {
    it('should use fallback strategy when no exact date matches exist', () => {
      const dailyData = createMockDailyData(['2023-01-01', '2023-01-03'], [150, 152]);
      const quarterlyData = createMockQuarterlyData(['2023-01-02'], [{
        eps: 2.0,
        fairValue: 155,
        normalPE: 18
      }]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      // Should find closest match (2023-01-01 is closer to 2023-01-02 than 2023-01-03)
      expect(result[0]).toMatchObject({
        fullDate: '2023-01-01',
        hasQuarterlyData: true,
        fairValue: 155,
        earnings: 2.0
      });
      expect(result[1]).toMatchObject({
        fullDate: '2023-01-03',
        hasQuarterlyData: false
      });
    });

    it('should handle multiple quarterly data points', () => {
      const dailyData = createMockDailyData(['2023-01-01', '2023-04-01', '2023-07-01'], [150, 155, 160]);
      const quarterlyData = createMockQuarterlyData(['2023-01-01', '2023-04-01'], [
        { eps: 2.0, fairValue: 155 },
        { eps: 2.2, fairValue: 165 }
      ]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0]).toMatchObject({
        hasQuarterlyData: true,
        fairValue: 155,
        earnings: 2.0
      });
      expect(result[1]).toMatchObject({
        hasQuarterlyData: true,
        fairValue: 165,
        earnings: 2.2
      });
      expect(result[2]).toMatchObject({
        hasQuarterlyData: false,
        fairValue: null
      });
    });
  });

  describe('Data sorting and filtering', () => {
    it('should sort daily data by date', () => {
      const dailyData = createMockDailyData(['2023-01-03', '2023-01-01', '2023-01-02'], [152, 150, 151]);
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].fullDate).toBe('2023-01-01');
      expect(result[1].fullDate).toBe('2023-01-02');
      expect(result[2].fullDate).toBe('2023-01-03');
    });

    it('should thin out data when there are too many points', () => {
      // Create 500 daily data points (more than maxDisplayPoints of 300)
      const dates = Array.from({ length: 500 }, (_, i) => {
        const date = new Date('2023-01-01');
        date.setDate(date.getDate() + i);
        return date.toISOString().split('T')[0];
      });
      const prices = Array.from({ length: 500 }, (_, i) => 150 + i * 0.1);
      const dailyData = createMockDailyData(dates, prices);
      
      // Add quarterly data to ensure they're preserved
      const quarterlyData = createMockQuarterlyData([dates[100], dates[200]], [
        { eps: 2.0, fairValue: 160 },
        { eps: 2.1, fairValue: 165 }
      ]);
      
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);
      const result = transformLegacyApiDataForChart(apiResponse);

      // Should be less than original but include quarterly points
      expect(result.length).toBeLessThan(500);
      expect(result.length).toBeGreaterThan(0);
      
      // Quarterly data points should be preserved
      const quarterlyPoints = result.filter(p => p.hasQuarterlyData);
      expect(quarterlyPoints).toHaveLength(2);
      
      // Last point should always be included
      expect(result[result.length - 1].fullDate).toBe(dates[499]);
    });
  });

  describe('Computed metrics', () => {
    it('should calculate market cap based on stock price', () => {
      const dailyData = createMockDailyData(['2023-01-01'], [100]);
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].marketCap).toBe(100 * 16.0);
    });

    it('should calculate dividend based on EPS and dividend payout ratio', () => {
      const dailyData = createMockDailyData(['2023-01-01'], [150]);
      const quarterlyData = createMockQuarterlyData(['2023-01-01'], [{
        eps: 2.0,
        dividendsPOR: 2.0 // 2% annual dividend yield
      }]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].dividend).toBeGreaterThan(0);
      // Should be at least 0.5 (minimum dividend)
      expect(result[0].dividend).toBeGreaterThanOrEqual(0.5);
    });

    it('should calculate revenue based on EPS', () => {
      const dailyData = createMockDailyData(['2023-01-01'], [150]);
      const quarterlyData = createMockQuarterlyData(['2023-01-01'], [{
        eps: 2.5
      }]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].revenue).toBe(2.5 * 4 * 16.0); // eps * 4 quarters * 16.0 multiplier
    });

    it('should handle zero or missing quarterly values', () => {
      const dailyData = createMockDailyData(['2023-01-01'], [150]);
      const quarterlyData = createMockQuarterlyData(['2023-01-01'], [{
        eps: 0,
        fairValue: 0,
        normalPE: 0,
        dividendsPOR: 0
      }]);
      const apiResponse = createMockAPIResponse(dailyData, quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0]).toMatchObject({
        earnings: 0,
        fairValue: null, // 0 gets converted to null
        peRatio: null,
        dividendsPOR: null // 0 gets converted to null
      });
      expect(result[0].dividend).toBeGreaterThanOrEqual(0.5); // Should use minimum
    });
  });

  describe('Date formatting', () => {
    it('should format dates correctly', () => {
      const dailyData: LegacyDataPoint[] = [{
        date: '2023-01-15',
        fyDate: undefined as any,
        year: 2023,
        estimated: false,
        frequency: 'daily',
        price: 150
      }];
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      // Should use formatted date when fyDate is not available
      expect(result[0].date).toBe('01/23'); // MM/YY format
    });

    it('should use fyDate when available', () => {
      const dailyData: LegacyDataPoint[] = [{
        date: '2023-01-15',
        fyDate: 'Q1 2023',
        year: 2023,
        estimated: false,
        frequency: 'daily',
        price: 150
      }];
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].date).toBe('Q1 2023');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty data', () => {
      const apiResponse = createMockAPIResponse([]);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result).toHaveLength(0);
    });

    it('should handle only quarterly data without daily data', () => {
      const quarterlyData = createMockQuarterlyData(['2023-01-01'], [{
        eps: 2.0,
        fairValue: 160
      }]);
      const apiResponse = createMockAPIResponse([], quarterlyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result).toHaveLength(0);
    });

    it('should preserve estimated flag', () => {
      const dailyData: LegacyDataPoint[] = [{
        date: '2023-01-01',
        fyDate: '01/23',
        year: 2023,
        estimated: true,
        frequency: 'daily',
        price: 150
      }];
      const apiResponse = createMockAPIResponse(dailyData);

      const result = transformLegacyApiDataForChart(apiResponse);

      expect(result[0].estimated).toBe(true);
    });
  });
});