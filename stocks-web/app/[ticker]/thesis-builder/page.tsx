'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';
import PositionThesisBuilderView from '../../components/position-thesis/PositionThesisBuilderView';
import { useAuth } from '@/app/lib/authContext';
import {
  coercePositionThesisPayload,
  getPositionThesis,
} from '@/app/lib/services/positionThesisService';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import type { ChatHistoryEntry } from '@/app/lib/thesisOnboardHandoff';
import { takeThesisOnboardHandoff } from '@/app/lib/thesisOnboardHandoff';

export default function ThesisBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [initialPayload, setInitialPayload] = useState<PositionThesisPayload | null | undefined>(
    undefined
  );
  const [handoffChatHistory, setHandoffChatHistory] = useState<ChatHistoryEntry[]>([]);
  const [thesisOrigin, setThesisOrigin] = useState<'remote' | 'handoff' | 'empty' | null>(null);
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
      setLoadError(null);
      const handoff = takeThesisOnboardHandoff(ticker);
      if (handoff) {
        setInitialPayload(coercePositionThesisPayload(handoff.payload, ticker));
        setHandoffChatHistory(handoff.chatHistory);
        setThesisOrigin('handoff');
      } else {
        setInitialPayload(null);
        setHandoffChatHistory([]);
        setThesisOrigin('empty');
      }
      return;
    }

    let cancelled = false;
    setInitialPayload(undefined);
    setHandoffChatHistory([]);
    setThesisOrigin(null);
    setLoadError(null);
    getPositionThesis(user.uid, ticker)
      .then((doc) => {
        if (cancelled) return;
        const handoff = takeThesisOnboardHandoff(ticker);
        if (doc) {
          setInitialPayload(doc.payload);
          setThesisOrigin('remote');
          setHandoffChatHistory(handoff?.chatHistory ?? []);
        } else if (handoff) {
          setInitialPayload(coercePositionThesisPayload(handoff.payload, ticker));
          setHandoffChatHistory(handoff.chatHistory);
          setThesisOrigin('handoff');
        } else {
          setInitialPayload(null);
          setHandoffChatHistory([]);
          setThesisOrigin('empty');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load thesis');
        setInitialPayload(null);
        setHandoffChatHistory([]);
        setThesisOrigin('empty');
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
            : `${ticker}-${thesisOrigin}-${initialPayload ? 'hydrate' : 'defaults'}`
        }
        ticker={ticker}
        companyName={companyName}
        userId={user?.uid ?? null}
        initialPayload={initialPayload}
        initialChatHistory={handoffChatHistory}
        loadError={loadError}
        lockTickerInitially={thesisOrigin === 'remote'}
        onTickerCommitted={(canonical) => {
          router.replace(`/${canonical}/thesis-builder`);
        }}
      />
    </div>
  );
}
