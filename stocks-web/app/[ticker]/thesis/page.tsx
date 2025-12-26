'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';
import InvestmentThesisBuilder from '../../components/InvestmentThesisBuilder';

export default function ThesisPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [companyName, setCompanyName] = useState<string | null>(null);

  // Fetch company name when ticker changes
  useEffect(() => {
    const fetchCompanyInfo = async () => {
      if (!ticker) return;

      try {
        const response = await fetch(`/api/tickers?ticker=${ticker}`);
        const result = await response.json();
        
        if (result.success && result.data) {
          setCompanyName(result.data.name || null);
        }
      } catch (err) {
        console.error('Error fetching company info:', err);
      }
    };

    fetchCompanyInfo();
  }, [ticker]);

  const handleTickerChange = (newTicker: string) => {
    router.push(`/${newTicker}/thesis`);
  };

  const handleBack = () => {
    router.push(`/${ticker}`);
  };

  const handleSave = (thesis: any) => {
    // Save thesis to localStorage or API
    localStorage.setItem(`thesis-${ticker}`, JSON.stringify(thesis));
    console.log('Thesis saved:', thesis);
    // Could also show a toast notification here
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation 
        selectedTicker={ticker}
        onTickerChange={handleTickerChange}
      />

      <div className="w-full max-w-none px-6 py-6">
        <InvestmentThesisBuilder 
          ticker={ticker} 
          companyName={companyName}
          onBack={handleBack}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}

