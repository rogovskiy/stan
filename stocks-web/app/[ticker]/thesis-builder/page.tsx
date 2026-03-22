'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';
import PositionThesisBuilderView from '../../components/position-thesis/PositionThesisBuilderView';
import { useAuth } from '@/app/lib/authContext';
import {
  buildPortfolioThesisContext,
  buyDateRangeFromTransactions,
  resolveBandForPosition,
} from '@/app/lib/portfolioThesisContext';
import {
  coercePositionThesisPayload,
  getPositionThesis,
  getPositionThesisByDocId,
} from '@/app/lib/services/positionThesisService';
import type { Portfolio } from '@/app/lib/services/portfolioService';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import type { ChatHistoryEntry, ThesisOnboardPortfolioLink } from '@/app/lib/thesisOnboardHandoff';
import { takeThesisOnboardHandoff } from '@/app/lib/thesisOnboardHandoff';

/** Handoff is one-shot; restore link from URL or thesis doc so saves still run the portfolio PUT. */
function resolveThesisPortfolioLink(
  handoffLink: ThesisOnboardPortfolioLink | undefined,
  portfolioIdParam: string | null,
  positionIdParam: string | null,
  doc: { portfolioId?: string | null; positionId?: string | null } | null
): ThesisOnboardPortfolioLink | null {
  if (
    handoffLink &&
    typeof handoffLink.portfolioId === 'string' &&
    handoffLink.portfolioId.trim() &&
    typeof handoffLink.positionId === 'string' &&
    handoffLink.positionId.trim()
  ) {
    return {
      portfolioId: handoffLink.portfolioId.trim(),
      positionId: handoffLink.positionId.trim(),
    };
  }
  if (portfolioIdParam?.trim() && positionIdParam?.trim()) {
    return {
      portfolioId: portfolioIdParam.trim(),
      positionId: positionIdParam.trim(),
    };
  }
  const pid = doc?.portfolioId?.trim();
  const posid = doc?.positionId?.trim();
  if (pid && posid) return { portfolioId: pid, positionId: posid };
  return null;
}

function ThesisBuilderPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [initialPayload, setInitialPayload] = useState<PositionThesisPayload | null | undefined>(
    undefined
  );
  const [handoffChatHistory, setHandoffChatHistory] = useState<ChatHistoryEntry[]>([]);
  const [thesisOrigin, setThesisOrigin] = useState<'remote' | 'handoff' | 'empty' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thesisDocId, setThesisDocId] = useState<string | null>(null);
  const [portfolioLink, setPortfolioLink] = useState<ThesisOnboardPortfolioLink | null>(null);
  const [portfolioContextForCoach, setPortfolioContextForCoach] = useState('');
  const [initialAuthoringHistory, setInitialAuthoringHistory] = useState<
    import('@/app/lib/types/positionThesis').AuthoringContextEntry[] | undefined
  >(undefined);

  const thesisDocIdParam = searchParams.get('thesisDocId');
  const portfolioIdParam = searchParams.get('portfolioId');
  const positionIdParam = searchParams.get('positionId');

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
      if (thesisDocIdParam) {
        setThesisDocId(thesisDocIdParam);
      } else if (handoff?.thesisDocId) {
        setThesisDocId(handoff.thesisDocId);
      }
      if (handoff) {
        setInitialPayload(coercePositionThesisPayload(handoff.payload, ticker));
        setHandoffChatHistory(handoff.chatHistory);
        setThesisOrigin('handoff');
        if (handoff.portfolioLink) setPortfolioLink(handoff.portfolioLink);
        if (handoff.portfolioContextSummary)
          setPortfolioContextForCoach(handoff.portfolioContextSummary);
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
    setPortfolioLink(null);
    setPortfolioContextForCoach('');
    setInitialAuthoringHistory(undefined);
    setThesisDocId(null);

    (async () => {
      try {
        const handoff = takeThesisOnboardHandoff(ticker);
        if (cancelled) return;

        if (thesisDocIdParam) {
          const doc = await getPositionThesisByDocId(user.uid, thesisDocIdParam);
          if (cancelled) return;
          if (doc) {
            setInitialPayload(doc.payload);
            setThesisDocId(doc.id);
            setInitialAuthoringHistory(doc.authoringHistory);
            setHandoffChatHistory(handoff?.chatHistory ?? []);
            setThesisOrigin('remote');
            const pl = resolveThesisPortfolioLink(
              handoff?.portfolioLink,
              portfolioIdParam,
              positionIdParam,
              doc
            );
            if (pl) setPortfolioLink(pl);
            if (handoff?.portfolioContextSummary)
              setPortfolioContextForCoach(handoff.portfolioContextSummary);
            return;
          }
          setLoadError('Thesis document not found.');
          setInitialPayload(null);
          setThesisOrigin('empty');
          return;
        }

        if (handoff) {
          setHandoffChatHistory(handoff.chatHistory);
          const plEarly = resolveThesisPortfolioLink(
            handoff.portfolioLink,
            portfolioIdParam,
            positionIdParam,
            null
          );
          if (plEarly) setPortfolioLink(plEarly);
          if (handoff.portfolioContextSummary)
            setPortfolioContextForCoach(handoff.portfolioContextSummary);
          if (handoff.thesisDocId) {
            const doc = await getPositionThesisByDocId(user.uid, handoff.thesisDocId);
            if (cancelled) return;
            if (doc) {
              setInitialPayload(doc.payload);
              setThesisDocId(doc.id);
              setInitialAuthoringHistory(doc.authoringHistory);
              setThesisOrigin('remote');
              const pl = resolveThesisPortfolioLink(
                handoff.portfolioLink,
                portfolioIdParam,
                positionIdParam,
                doc
              );
              if (pl) setPortfolioLink(pl);
              return;
            }
          }
          setInitialPayload(coercePositionThesisPayload(handoff.payload, ticker));
          if (handoff.thesisDocId) setThesisDocId(handoff.thesisDocId);
          setThesisOrigin('handoff');
          return;
        }

        if (portfolioIdParam && positionIdParam) {
          const res = await fetch(`/api/portfolios/${encodeURIComponent(portfolioIdParam)}`);
          const json = (await res.json()) as {
            success?: boolean;
            data?: Portfolio;
            error?: string;
          };
          if (cancelled) return;
          if (!json.success || !json.data) {
            setLoadError(json.error || 'Portfolio not found');
            setInitialPayload(null);
            setThesisOrigin('empty');
            return;
          }
          const portfolio = json.data;
          const pos = portfolio.positions?.find((p) => p.id === positionIdParam);
          if (!pos || pos.ticker.toUpperCase() !== ticker.toUpperCase()) {
            setLoadError('Position not found or ticker mismatch');
            setInitialPayload(null);
            setThesisOrigin('empty');
            return;
          }
          const link: ThesisOnboardPortfolioLink = {
            portfolioId: portfolioIdParam,
            positionId: positionIdParam,
          };
          setPortfolioLink(link);

          let txRes: Response | null = null;
          try {
            txRes = await fetch(
              `/api/portfolios/${encodeURIComponent(portfolioIdParam)}/transactions?ticker=${encodeURIComponent(ticker)}`
            );
          } catch {
            txRes = null;
          }
          let buyMin: string | undefined;
          let buyMax: string | undefined;
          if (txRes?.ok) {
            const txJson = (await txRes.json()) as {
              success?: boolean;
              data?: import('@/app/lib/services/portfolioService').Transaction[];
            };
            const txs = Array.isArray(txJson.data) ? txJson.data : [];
            const range = buyDateRangeFromTransactions(txs, ticker.toUpperCase());
            buyMin = range.buyDateMin;
            buyMax = range.buyDateMax;
          }

          const band = resolveBandForPosition(portfolio, pos);
          const ctx = buildPortfolioThesisContext({
            portfolio,
            position: pos,
            band,
            buyDateMin: buyMin,
            buyDateMax: buyMax,
            retroactive: true,
          });
          setPortfolioContextForCoach(ctx);

          if (pos.thesisId?.trim()) {
            const doc = await getPositionThesisByDocId(user.uid, pos.thesisId.trim());
            if (cancelled) return;
            if (doc) {
              setInitialPayload(doc.payload);
              setThesisDocId(doc.id);
              setInitialAuthoringHistory(doc.authoringHistory);
              setThesisOrigin('remote');
              return;
            }
          }

          setInitialPayload(null);
          setThesisOrigin('empty');
          return;
        }

        const legacy = await getPositionThesis(user.uid, ticker);
        if (cancelled) return;
        if (legacy) {
          setInitialPayload(legacy.payload);
          setThesisDocId(legacy.id);
          setInitialAuthoringHistory(legacy.authoringHistory);
          setThesisOrigin('remote');
          const pl = resolveThesisPortfolioLink(
            undefined,
            portfolioIdParam,
            positionIdParam,
            legacy
          );
          if (pl) setPortfolioLink(pl);
          return;
        }

        setInitialPayload(null);
        setThesisOrigin('empty');
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load thesis');
        setInitialPayload(null);
        setThesisOrigin('empty');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    ticker,
    thesisDocIdParam,
    portfolioIdParam,
    positionIdParam,
  ]);

  const handleTickerChange = (newTicker: string) => {
    const q = searchParams.toString();
    router.push(q ? `/${newTicker}/thesis-builder?${q}` : `/${newTicker}/thesis-builder`);
  };

  const onThesisDocIdCommitted = useCallback(
    (
      docId: string,
      portfolioForUrl?: { portfolioId: string; positionId: string }
    ) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set('thesisDocId', docId);
      if (portfolioForUrl?.portfolioId?.trim()) {
        p.set('portfolioId', portfolioForUrl.portfolioId.trim());
      }
      if (portfolioForUrl?.positionId?.trim()) {
        p.set('positionId', portfolioForUrl.positionId.trim());
      }
      router.replace(`/${ticker}/thesis-builder?${p.toString()}`);
    },
    [router, searchParams, ticker]
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased">
      <AppNavigation selectedTicker={ticker} onTickerChange={handleTickerChange} />
      <PositionThesisBuilderView
        key={
          initialPayload === undefined
            ? `load-${ticker}`
            : `${ticker}-${thesisOrigin}-${initialPayload ? 'hydrate' : 'defaults'}-${thesisDocId ?? 'new'}`
        }
        ticker={ticker}
        companyName={companyName}
        userId={user?.uid ?? null}
        initialPayload={initialPayload}
        initialChatHistory={handoffChatHistory}
        loadError={loadError}
        lockTickerInitially={thesisOrigin === 'remote'}
        thesisDocId={thesisDocId}
        portfolioLink={portfolioLink}
        portfolioContextForCoach={portfolioContextForCoach}
        initialAuthoringHistory={initialAuthoringHistory}
        onThesisDocIdCommitted={onThesisDocIdCommitted}
        onTickerCommitted={(canonical) => {
          const p = searchParams.toString();
          router.replace(p ? `/${canonical}/thesis-builder?${p}` : `/${canonical}/thesis-builder`);
        }}
      />
    </div>
  );
}

export default function ThesisBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">
          Loading thesis builder…
        </div>
      }
    >
      <ThesisBuilderPageInner />
    </Suspense>
  );
}
