import fs from 'fs/promises';
import path from 'path';

export class DataCache {
  private cacheDir: string;

  constructor(cacheDir = './cache') {
    this.cacheDir = cacheDir;
  }

  async ensureCacheDir() {
    try {
      await fs.access(this.cacheDir);
    } catch {
      await fs.mkdir(this.cacheDir, { recursive: true });
    }
  }

  getCacheFilePath(ticker: string, dataType: string = 'historical'): string {
    return path.join(this.cacheDir, `${ticker.toUpperCase()}_${dataType}.json`);
  }

  async getCachedData(ticker: string, dataType: string = 'historical'): Promise<any | null> {
    try {
      const filePath = this.getCacheFilePath(ticker, dataType);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached = JSON.parse(data);
      
      // Different cache durations based on data type
      const cacheAge = Date.now() - cached.timestamp;
      let maxAge: number;
      
      switch (dataType) {
        case 'realtime':
          maxAge = 5 * 60 * 1000; // 5 minutes
          break;
        case 'quarterly':
        case 'earnings':
          maxAge = 12 * 60 * 60 * 1000; // 12 hours for earnings data
          break;
        case 'fundamentals':
          maxAge = 6 * 60 * 60 * 1000; // 6 hours for fundamental data
          break;
        case 'historical':
        default:
          maxAge = 24 * 60 * 60 * 1000; // 24 hours for historical price data
          break;
      }
      
      if (cacheAge < maxAge) {
        console.log(`Cache hit for ${ticker} ${dataType} (age: ${Math.round(cacheAge / (60 * 1000))} minutes)`);
        return cached.data;
      }
      
      // Cache expired
      console.log(`Cache expired for ${ticker} ${dataType} (age: ${Math.round(cacheAge / (60 * 1000))} minutes, max: ${Math.round(maxAge / (60 * 1000))} minutes)`);
      return null;
    } catch (error) {
      console.log(`No cache found for ${ticker} ${dataType}`);
      return null;
    }
  }

  async setCachedData(ticker: string, data: any, dataType: string = 'historical'): Promise<void> {
    await this.ensureCacheDir();
    
    const cacheData = {
      ticker: ticker.toUpperCase(),
      timestamp: Date.now(),
      dataType,
      data
    };

    const filePath = this.getCacheFilePath(ticker, dataType);
    await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2));
    console.log(`Cached ${ticker} ${dataType} data`);
  }

  async clearCache(ticker?: string): Promise<void> {
    if (ticker) {
      const patterns = ['historical', 'realtime', 'fundamentals', 'quarterly', 'earnings'];
      for (const pattern of patterns) {
        try {
          const filePath = this.getCacheFilePath(ticker, pattern);
          await fs.unlink(filePath);
        } catch {
          // File doesn't exist, ignore
        }
      }
    } else {
      // Clear all cache
      try {
        const files = await fs.readdir(this.cacheDir);
        await Promise.all(
          files.map(file => fs.unlink(path.join(this.cacheDir, file)))
        );
      } catch {
        // Directory doesn't exist, ignore
      }
    }
  }
}