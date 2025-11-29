'use client';

import { useState, useEffect, useRef } from 'react';

interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
  exchange?: string;
}

interface TickerSearchProps {
  selectedTicker: string;
  onTickerChange: (ticker: string) => void;
}

export default function TickerSearch({ selectedTicker, onTickerChange }: TickerSearchProps) {
  const [allTickers, setAllTickers] = useState<Ticker[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTickers, setFilteredTickers] = useState<Ticker[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all tickers
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/tickers?getAllTickers=true');
        const result = await response.json();
        
        if (result.success) {
          // Map the API response to match our interface
          const tickers = result.data.map((t: any) => ({
            symbol: t.symbol || t.ticker || '',
            name: t.name || '',
            sector: t.sector || '',
            exchange: t.exchange || ''
          }));
          setAllTickers(tickers);
        }
      } catch (err) {
        console.error('Error fetching tickers:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTickers();
  }, []);

  // Filter tickers based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTickers([]);
      setIsOpen(false);
      return;
    }

    const query = searchQuery.toUpperCase().trim();
    const filtered = allTickers
      .filter(ticker => 
        ticker.symbol.toUpperCase().includes(query) ||
        ticker.name.toUpperCase().includes(query)
      )
      .slice(0, 10); // Limit to 10 results for performance

    setFilteredTickers(filtered);
    setIsOpen(filtered.length > 0);
  }, [searchQuery, allTickers]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleTickerSelect = (ticker: string) => {
    onTickerChange(ticker);
    setSearchQuery('');
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredTickers.length > 0) {
      handleTickerSelect(filteredTickers[0].symbol);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={searchRef} className="relative w-full max-w-md">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (filteredTickers.length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder={isLoading ? "Loading tickers..." : "Search ticker (e.g., AAPL)"}
          className="w-full px-4 py-2 pl-10 pr-4 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400"
        />
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && filteredTickers.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
          {filteredTickers.map((ticker) => (
            <button
              key={ticker.symbol}
              onClick={() => handleTickerSelect(ticker.symbol)}
              className="w-full px-4 py-2 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{ticker.symbol}</span>
                  {ticker.name && (
                    <span className="text-sm text-gray-500 truncate max-w-xs">
                      {ticker.name}
                    </span>
                  )}
                </div>
                {ticker.exchange && (
                  <span className="text-xs text-gray-400">{ticker.exchange}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

