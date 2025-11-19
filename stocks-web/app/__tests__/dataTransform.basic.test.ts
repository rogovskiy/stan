import { transformApiDataForChart, transformLegacyApiDataForChart } from '../lib/dataTransform';
import { DailyDataPoint, QuarterlyDataPoint } from '../types/api';

// Mock Math.random to make tests deterministic
const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

// Mock console.log to avoid test output noise
const mockConsoleLog = jest.fn();
global.console.log = mockConsoleLog;

describe('Data Transform Functions', () => {
  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  describe('transformApiDataForChart (New Function)', () => {
    it('should transform daily data without quarterly data', () => {
      const dailyData: DailyDataPoint[] = [
        { date: '2023-01-01', fyDate: '01/23', year: 2023, price: 100, estimated: false },
        { date: '2023-01-02', fyDate: '01/23', year: 2023, price: 105, estimated: false }
      ];
      
      const result = transformApiDataForChart(dailyData);
      
      expect(result).toHaveLength(2);
      expect(result[0].stockPrice).toBe(100);
      expect(result[0].hasQuarterlyData).toBe(false);
      expect(result[1].stockPrice).toBe(105);
      expect(result[1].hasQuarterlyData).toBe(false);
    });

    it('should merge daily and quarterly data on matching dates', () => {
      const dailyData: DailyDataPoint[] = [
        { date: '2023-01-01', fyDate: '01/23', year: 2023, price: 100, estimated: false },
        { date: '2023-01-02', fyDate: '01/23', year: 2023, price: 105, estimated: false }
      ];
      
      const quarterlyData: QuarterlyDataPoint[] = [
        { 
          date: '2023-01-02', 
          fyDate: '01/23', 
          year: 2023, 
          quarter: 'Q1',
          eps: 2.5, 
          fairValue: 150,
          estimated: false 
        }
      ];
      
      const result = transformApiDataForChart(dailyData, quarterlyData);
      
      expect(result).toHaveLength(2);
      expect(result[0].hasQuarterlyData).toBe(false);
      expect(result[1].hasQuarterlyData).toBe(true);
      expect(result[1].earnings).toBe(2.5);
      expect(result[1].fairValue).toBe(150);
    });
  });
});