'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';
import PositionThesisBuilderView from '../../components/position-thesis/PositionThesisBuilderView';
import { useAuth } from '@/app/lib/authContext';
import { getPositionThesis } from '@/app/lib/services/positionThesisService';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

export default function ThesisBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [initialPayload, setInitialPayload] = useState<PositionThesisPayload | null | undefined>(
    undefined
  );
  const [loadError, setLoadError] = useState<string | null>(null);

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

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setInitialPayload(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setInitialPayload(undefined);
    setLoadError(null);
    getPositionThesis(user.uid, ticker)
      .then((doc) => {
        if (cancelled) return;
        setInitialPayload(doc ? doc.payload : null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load thesis');
        setInitialPayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, ticker]);

  const handleTickerChange = (newTicker: string) => {
    router.push(`/${newTicker}/thesis-builder`);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased">
      <AppNavigation selectedTicker={ticker} onTickerChange={handleTickerChange} />
      <PositionThesisBuilderView
        key={
          initialPayload === undefined
            ? `load-${ticker}`
            : `${ticker}-${initialPayload ? 'doc' : 'defaults'}`
        }
        ticker={ticker}
        companyName={companyName}
        userId={user?.uid ?? null}
        initialPayload={initialPayload}
        loadError={loadError}
      />
    </div>
  );
}
