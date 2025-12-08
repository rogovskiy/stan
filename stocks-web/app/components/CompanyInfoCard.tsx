'use client';

import { useState, useEffect } from 'react';

interface CompanyInfoCardProps {
  ticker: string;
  showPrice?: boolean;
  // Optional financial data (if provided, will be used instead of fetching)
  stockPrice?: number | null;
  priceChange?: number | null;
  priceChangePercent?: number | null;
  marketCap?: number | null;
  peRatio?: number | null;
  dividend?: number | null;
}

interface CompanyData {
  name: string | null;
  exchange: string | null;
  sector: string | null;
  summary: string | null;
  stockPrice: number | null;
  priceChange: number | null;
  priceChangePercent: number | null;
  marketCap: number | null;
  peRatio: number | null;
  dividend: number | null;
}

export default function CompanyInfoCard({ 
  ticker, 
  showPrice = true,
  stockPrice: propStockPrice,
  priceChange: propPriceChange,
  priceChangePercent: propPriceChangePercent,
  marketCap: propMarketCap,
  peRatio: propPeRatio,
  dividend: propDividend
}: CompanyInfoCardProps) {
  const [data, setData] = useState<CompanyData>({
    name: null,
    exchange: null,
    sector: null,
    summary: null,
    stockPrice: propStockPrice ?? null,
    priceChange: propPriceChange ?? null,
    priceChangePercent: propPriceChangePercent ?? null,
    marketCap: propMarketCap ?? null,
    peRatio: propPeRatio ?? null,
    dividend: propDividend ?? null
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompanyInfo = async () => {
      if (!ticker) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Fetch company metadata
        const [tickerResponse, summaryResponse, priceResponse] = await Promise.all([
          fetch(`/api/tickers?ticker=${ticker}`),
          fetch(`/api/company-summary/${ticker}`),
          showPrice ? fetch(`/api/daily-prices/${ticker}?period=1d`) : Promise.resolve(null)
        ]);
        
        const tickerResult = await tickerResponse.json();
        const companyData: CompanyData = {
          name: tickerResult.success && tickerResult.data ? tickerResult.data.name || null : null,
          exchange: tickerResult.success && tickerResult.data ? tickerResult.data.exchange || null : null,
          sector: tickerResult.success && tickerResult.data ? tickerResult.data.sector || null : null,
          summary: null,
          stockPrice: null,
          priceChange: null,
          priceChangePercent: null,
          marketCap: null,
          peRatio: null,
          dividend: null
        };
        
        const summaryResult = await summaryResponse.json();
        if (summaryResult.success && summaryResult.data?.summary) {
          companyData.summary = summaryResult.data.summary;
        }
        
        // Fetch price data if needed and not provided as props
        if (showPrice && priceResponse && propStockPrice === undefined) {
          const priceResult = await priceResponse.json();
          if (priceResult.data && priceResult.data.length > 0) {
            const priceData = priceResult.data;
            const currentPrice = priceData[priceData.length - 1]?.price;
            const previousPrice = priceData[priceData.length - 2]?.price;
            
            if (currentPrice && previousPrice) {
              companyData.stockPrice = currentPrice;
              companyData.priceChange = currentPrice - previousPrice;
              companyData.priceChangePercent = previousPrice !== 0 
                ? ((companyData.priceChange / previousPrice) * 100) 
                : 0;
            } else if (currentPrice) {
              companyData.stockPrice = currentPrice;
              companyData.priceChange = 0;
              companyData.priceChangePercent = 0;
            }
          }
        }
        
        // Use props if provided, otherwise use fetched data
        setData({
          ...companyData,
          stockPrice: propStockPrice !== undefined ? propStockPrice : companyData.stockPrice,
          priceChange: propPriceChange !== undefined ? propPriceChange : companyData.priceChange,
          priceChangePercent: propPriceChangePercent !== undefined ? propPriceChangePercent : companyData.priceChangePercent,
          marketCap: propMarketCap !== undefined ? propMarketCap : companyData.marketCap,
          peRatio: propPeRatio !== undefined ? propPeRatio : companyData.peRatio,
          dividend: propDividend !== undefined ? propDividend : companyData.dividend
        });
      } catch (err) {
        console.error('Error fetching company info:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCompanyInfo();
  }, [ticker, showPrice, propStockPrice, propPriceChange, propPriceChangePercent, propMarketCap, propPeRatio, propDividend]);
  
  // Update data when props change
  useEffect(() => {
    if (propStockPrice !== undefined || propPriceChange !== undefined || propPriceChangePercent !== undefined ||
        propMarketCap !== undefined || propPeRatio !== undefined || propDividend !== undefined) {
      setData(prev => ({
        ...prev,
        stockPrice: propStockPrice !== undefined ? propStockPrice : prev.stockPrice,
        priceChange: propPriceChange !== undefined ? propPriceChange : prev.priceChange,
        priceChangePercent: propPriceChangePercent !== undefined ? propPriceChangePercent : prev.priceChangePercent,
        marketCap: propMarketCap !== undefined ? propMarketCap : prev.marketCap,
        peRatio: propPeRatio !== undefined ? propPeRatio : prev.peRatio,
        dividend: propDividend !== undefined ? propDividend : prev.dividend
      }));
    }
  }, [propStockPrice, propPriceChange, propPriceChangePercent, propMarketCap, propPeRatio, propDividend]);

  if (!ticker || loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">
            {data.name || ticker}
          </h1>
          <p className="text-gray-500 text-sm font-medium mb-3">
            {data.exchange ? `${data.exchange}: ` : ''}{ticker}
            {data.sector && <span className="ml-2">• {data.sector}</span>}
          </p>
          
          {/* Key Metrics */}
          {(data.marketCap || data.peRatio !== null || data.dividend !== null) && (
            <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
              {data.marketCap && (
                <span>
                  <span className="font-semibold">Market Cap:</span> ${typeof data.marketCap === 'number' && data.marketCap >= 1e9 
                    ? (data.marketCap / 1e9).toFixed(1) + 'B'
                    : typeof data.marketCap === 'number' && data.marketCap >= 1e6
                    ? (data.marketCap / 1e6).toFixed(1) + 'M'
                    : data.marketCap.toFixed(1)}
                </span>
              )}
              {data.peRatio !== null && (
                <span>
                  <span className="font-semibold">P/E:</span> {data.peRatio.toFixed(1)}
                </span>
              )}
              {data.dividend !== null && (
                <span>
                  <span className="font-semibold">Dividend:</span> {data.dividend.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Price Display */}
        {showPrice && data.stockPrice !== null && (
          <div className="text-right ml-4">
            <div className="text-2xl font-bold text-gray-900 tracking-tight mb-1">
              ${data.stockPrice.toFixed(2)}
            </div>
            {data.priceChange !== null && data.priceChangePercent !== null && (
              <div className="flex items-center justify-end gap-1.5">
                <span className={`text-sm font-semibold ${
                  data.priceChange >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {data.priceChange >= 0 ? '+' : ''}{data.priceChange.toFixed(2)}
                </span>
                <span className={`text-sm font-semibold ${
                  data.priceChangePercent >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  ({data.priceChangePercent >= 0 ? '+' : ''}{data.priceChangePercent.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Company Summary */}
      {data.summary && (
        <p className="text-sm text-gray-600 leading-relaxed">
          {data.summary}
        </p>
      )}
    </div>
  );
}
