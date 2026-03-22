'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DriverRow, FailureRow, PositionThesisPayload } from '@/app/lib/types/positionThesis';

const MAX_TABLE_ROWS = 12;

const EMPTY_DRIVER_ROW: DriverRow = {
  driver: '',
  whyItMatters: '',
  importance: '',
};

const DRIVER_IMPORTANCE_STANDARD = ['High', 'Medium', 'Low'] as const;

const EMPTY_FAILURE_ROW: FailureRow = {
  failurePath: '',
  trigger: '',
  estimatedImpact: '',
  timeframe: '',
};

const FAILURE_TIMEFRAME_STANDARD = [
  'Immediate',
  '< 3 months',
  '3–6 months',
  '6–12 months',
  '6–18 months',
  '1–2 years',
  '2+ years',
  'Gradual',
] as const;
import type { ChatHistoryEntry } from '@/app/lib/thesisOnboardHandoff';
import { mergePositionThesisPayload } from '@/app/lib/positionThesisMerge';
import {
  defaultPositionThesisPayload,
  savePositionThesis,
} from '@/app/lib/services/positionThesisService';
import ThesisBuilderChat from './ThesisBuilderChat';

const section = 'bg-white rounded-2xl shadow-sm border border-slate-200 p-5';
const label = 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2';
const input =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300';
const textarea =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm min-h-[96px] focus:outline-none focus:ring-2 focus:ring-slate-300';
/** Repeatable row blocks (drivers / failures): wrap text without huge min height per field. */
const cardTextarea =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm min-h-[72px] max-h-48 resize-y focus:outline-none focus:ring-2 focus:ring-slate-300';
const repeatableCard =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100';
const assumptionTierCard =
  'rounded-xl border border-slate-200 bg-slate-50/50 p-4 ring-1 ring-slate-100';
const tierHeading = 'text-sm font-semibold text-slate-800 mb-3';
const badge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border';

const RETURN_ASSUMPTION_TIERS: {
  title: string;
  dividendKey: keyof PositionThesisPayload;
  growthKey: keyof PositionThesisPayload;
  multipleKey: keyof PositionThesisPayload;
}[] = [
  {
    title: 'Upside assumptions',
    dividendKey: 'upsideDividendAssumption',
    growthKey: 'upsideGrowthAssumption',
    multipleKey: 'upsideMultipleAssumption',
  },
  {
    title: 'Base assumptions',
    dividendKey: 'baseDividendAssumption',
    growthKey: 'baseGrowthAssumption',
    multipleKey: 'baseMultipleAssumption',
  },
  {
    title: 'Downside assumptions',
    dividendKey: 'downsideDividendAssumption',
    growthKey: 'downsideGrowthAssumption',
    multipleKey: 'downsideMultipleAssumption',
  },
];

const SECTION_HELP = {
  basics:
    'Please help me refine the **ticker**, **position role**, and **holding horizon** for this thesis. Ask clarifying questions and suggest concrete wording I can paste into the form.',
  thesis:
    'Please help me strengthen **section 1 — thesis statement**, **portfolio role**, **regime designed for**, and **risk posture**. Review what I have in the draft and propose improvements or follow-up questions.',
  returns:
    'Please help me with **section 2 — return expectations**: entry price, **three sets** of dividend / growth / **multiple** assumptions (upside, base, downside), and the **upside / base / downside scenario** narratives.',
  drivers:
    'Please help me fill or improve **section 3 — drivers and dependencies**. Suggest drivers, why they matter, and importance (High, Medium, or Low).',
  failures:
    'Please help me with **section 4 — downside and failure map**: failure paths (short labels), triggers, impacts, and timeframes (e.g. 3–6 months, Gradual).',
  rules:
    'Please help me draft **section 5 — decision rules**: **trim**, **exit**, and **add** rules, plus **system monitoring signals**.',
} as const;

function SectionChatHelpButton({
  sectionTitle,
  prompt,
  disabled,
  onRequestHelp,
}: {
  sectionTitle: string;
  prompt: string;
  disabled?: boolean;
  onRequestHelp: (text: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={`Ask the thesis assistant to help with ${sectionTitle}`}
      aria-label={`Get chat help for ${sectionTitle}`}
      onClick={() => onRequestHelp(prompt)}
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/80 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-40"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
    </button>
  );
}

function updateDriver(
  rows: DriverRow[],
  index: number,
  field: keyof DriverRow,
  value: string
): DriverRow[] {
  const next = [...rows];
  next[index] = { ...next[index], [field]: value };
  return next;
}

function updateFailure(
  rows: FailureRow[],
  index: number,
  field: keyof FailureRow,
  value: string
): FailureRow[] {
  const next = [...rows];
  next[index] = { ...next[index], [field]: value };
  return next;
}

const rowRemoveBtn =
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:pointer-events-none disabled:opacity-30';
const addRowBtn =
  'mt-4 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-100 disabled:opacity-40';

export interface PositionThesisBuilderViewProps {
  /** Ticker from the URL / nav (Firestore load key). */
  ticker: string;
  companyName?: string | null;
  userId: string | null;
  /** undefined = remote load in progress; null = no saved doc; object = hydrate */
  initialPayload: PositionThesisPayload | null | undefined;
  loadError?: string | null;
  /** After first save, if form ticker differs from URL, navigate here so the route matches the doc. */
  onTickerCommitted?: (canonicalTicker: string) => void;
  /**
   * When true and initialPayload is a hydrated object, ticker starts locked (saved Firestore doc).
   * When false (e.g. onboard handoff), ticker stays editable until first save.
   */
  lockTickerInitially?: boolean;
  /** Chat history from new-thesis onboarding to carry over. */
  initialChatHistory?: ChatHistoryEntry[];
}

export default function PositionThesisBuilderView({
  ticker,
  companyName,
  userId,
  initialPayload,
  loadError,
  onTickerCommitted,
  lockTickerInitially,
  initialChatHistory,
}: PositionThesisBuilderViewProps) {
  const routeTicker = ticker.toUpperCase();
  const displayTicker = routeTicker;

  const [form, setForm] = useState<PositionThesisPayload>(() =>
    initialPayload === null || initialPayload === undefined
      ? defaultPositionThesisPayload(displayTicker)
      : initialPayload
  );
  const [tickerLocked, setTickerLocked] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [patchHint, setPatchHint] = useState<string | null>(null);
  const [chatAutoSend, setChatAutoSend] = useState<{ nonce: number; text: string } | null>(null);

  const requestSectionChatHelp = useCallback((text: string) => {
    setChatAutoSend({ nonce: Date.now(), text });
  }, []);

  useEffect(() => {
    if (initialPayload === undefined) return;
    if (initialPayload === null) {
      setTickerLocked(false);
      return;
    }
    const lock = lockTickerInitially !== false;
    setTickerLocked(lock);
  }, [initialPayload, lockTickerInitially]);

  const symbol = form.ticker.trim().toUpperCase() || routeTicker;
  const titleName =
    symbol === routeTicker && companyName ? `${companyName} (${symbol})` : symbol;

  const persist = useCallback(
    async (status: 'draft' | 'published') => {
      if (!userId) {
        setSaveState('error');
        setSaveMessage('Sign in to save your thesis.');
        return;
      }
      const saveSymbol = form.ticker.trim().toUpperCase();
      if (!saveSymbol) {
        setSaveState('error');
        setSaveMessage('Set a ticker before saving.');
        return;
      }
      setSaveState('saving');
      setSaveMessage(null);
      try {
        const payload = { ...form, ticker: saveSymbol };
        await savePositionThesis(userId, saveSymbol, payload, status);
        setForm(payload);
        setTickerLocked(true);
        setSaveState('saved');
        setSaveMessage(status === 'draft' ? 'Draft saved.' : 'Thesis published.');
        if (saveSymbol !== routeTicker && onTickerCommitted) {
          onTickerCommitted(saveSymbol);
        }
        window.setTimeout(() => {
          setSaveState('idle');
          setSaveMessage(null);
        }, 3500);
      } catch (e) {
        setSaveState('error');
        setSaveMessage(e instanceof Error ? e.message : 'Save failed.');
      }
    },
    [userId, routeTicker, form, onTickerCommitted]
  );

  const handleFormPatch = useCallback(
    (patch: Partial<PositionThesisPayload> | null | undefined) => {
      if (!patch || Object.keys(patch).length === 0) return;
      setForm((prev) => mergePositionThesisPayload(prev, patch, { tickerLocked }));
      setPatchHint('Form updated from assistant.');
      window.setTimeout(() => setPatchHint(null), 4000);
    },
    [tickerLocked]
  );

  /** Parent should remount with `key` when remote payload is first resolved so state matches Firestore. */
  const loadingRemote = initialPayload === undefined;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 mb-2">Position Thesis Builder</p>
            <h1 className="text-3xl font-bold tracking-tight">Build Thesis — {titleName}</h1>
            <p className="text-slate-600 mt-2 max-w-3xl">
              Set or confirm the ticker, then use the assistant to describe your thesis in plain language
              and fill sections collaboratively. Save locks the ticker. The system will later score
              this thesis against live market conditions.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-3">
              <button
                type="button"
                disabled={loadingRemote}
                onClick={() => persist('draft')}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={loadingRemote}
                onClick={() => persist('published')}
                className="rounded-2xl bg-slate-900 text-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              >
                Publish Thesis
              </button>
            </div>
            {!userId && (
              <p className="text-xs text-amber-700 max-w-xs text-right">Sign in to save to Firebase.</p>
            )}
            {loadError && <p className="text-xs text-red-600 max-w-xs text-right">{loadError}</p>}
            {saveMessage && (
              <p
                className={`text-xs max-w-xs text-right ${
                  saveState === 'error' ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {saveState === 'saving' ? 'Saving…' : saveMessage}
              </p>
            )}
            {patchHint && (
              <p className="text-xs max-w-xs text-right text-slate-600">{patchHint}</p>
            )}
          </div>
        </div>

        {loadingRemote && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Loading saved thesis…
          </div>
        )}

        {!loadingRemote && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">Position & horizon</h2>
                  <SectionChatHelpButton
                    sectionTitle="position and horizon"
                    prompt={SECTION_HELP.basics}
                    disabled={loadingRemote}
                    onRequestHelp={requestSectionChatHelp}
                  />
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <div className={label}>Ticker</div>
                    <input
                      className={`${input} ${tickerLocked ? 'bg-slate-50 text-slate-600 cursor-not-allowed' : ''}`}
                      value={form.ticker}
                      readOnly={tickerLocked}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))
                      }
                      aria-readonly={tickerLocked}
                    />
                    {tickerLocked && (
                      <p className="text-[11px] text-slate-500 mt-1">Ticker is fixed after save.</p>
                    )}
                  </div>
                  <div>
                    <div className={label}>Position Role</div>
                    <input
                      className={input}
                      value={form.positionRole}
                      onChange={(e) => setForm((f) => ({ ...f, positionRole: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Holding Horizon</div>
                    <input
                      className={input}
                      value={form.holdingHorizon}
                      onChange={(e) => setForm((f) => ({ ...f, holdingHorizon: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">1. Thesis Statement</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`${badge} bg-emerald-50 text-emerald-700 border-emerald-200`}>
                      Required
                    </span>
                    <SectionChatHelpButton
                      sectionTitle="thesis statement and portfolio context"
                      prompt={SECTION_HELP.thesis}
                      disabled={loadingRemote}
                      onRequestHelp={requestSectionChatHelp}
                    />
                  </div>
                </div>
                <textarea
                  className={textarea}
                  value={form.thesisStatement}
                  onChange={(e) => setForm((f) => ({ ...f, thesisStatement: e.target.value }))}
                />
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className={label}>Why does this belong in the portfolio?</div>
                    <textarea
                      className={textarea}
                      value={form.portfolioRole}
                      onChange={(e) => setForm((f) => ({ ...f, portfolioRole: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>What regime is this thesis designed for?</div>
                    <textarea
                      className={textarea}
                      value={form.regimeDesignedFor}
                      onChange={(e) => setForm((f) => ({ ...f, regimeDesignedFor: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className={label}>Risk posture</div>
                  <input
                    className={input}
                    value={form.riskPosture}
                    onChange={(e) => setForm((f) => ({ ...f, riskPosture: e.target.value }))}
                  />
                </div>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">2. Return Expectation</h2>
                  <SectionChatHelpButton
                    sectionTitle="return expectations"
                    prompt={SECTION_HELP.returns}
                    disabled={loadingRemote}
                    onRequestHelp={requestSectionChatHelp}
                  />
                </div>
                <div className="max-w-xs">
                  <div className={label}>Entry Price</div>
                  <input
                    className={input}
                    value={form.entryPrice}
                    onChange={(e) => setForm((f) => ({ ...f, entryPrice: e.target.value }))}
                  />
                </div>
                <div className="mt-4 space-y-4">
                  {RETURN_ASSUMPTION_TIERS.map((tier) => (
                    <div key={tier.title} className={assumptionTierCard}>
                      <h3 className={tierHeading}>{tier.title}</h3>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <div className={label}>Dividend assumption</div>
                          <input
                            className={input}
                            value={form[tier.dividendKey] as string}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                [tier.dividendKey]: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <div className={label}>Growth assumption</div>
                          <input
                            className={input}
                            value={form[tier.growthKey] as string}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                [tier.growthKey]: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <div className={label}>Multiple assumption</div>
                          <input
                            className={input}
                            value={form[tier.multipleKey] as string}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                [tier.multipleKey]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-3 gap-4 mt-6">
                  <div>
                    <div className={label}>Upside Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.upsideScenario}
                      onChange={(e) => setForm((f) => ({ ...f, upsideScenario: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Base Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.baseScenario}
                      onChange={(e) => setForm((f) => ({ ...f, baseScenario: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Downside Scenario</div>
                    <textarea
                      className={textarea}
                      value={form.downsideScenario}
                      onChange={(e) => setForm((f) => ({ ...f, downsideScenario: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">3. Drivers and Dependencies</h2>
                  <SectionChatHelpButton
                    sectionTitle="drivers and dependencies"
                    prompt={SECTION_HELP.drivers}
                    disabled={loadingRemote}
                    onRequestHelp={requestSectionChatHelp}
                  />
                </div>
                <div className="space-y-4">
                  {form.drivers.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
                      No drivers yet. Add one to capture what moves this thesis.
                    </p>
                  ) : (
                    form.drivers.map((row, i) => (
                      <div key={i} className={repeatableCard}>
                        <div className="mb-4 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Driver {i + 1}
                          </span>
                          <button
                            type="button"
                            className={rowRemoveBtn}
                            title="Remove driver"
                            aria-label={`Remove driver ${i + 1}`}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                drivers: f.drivers.filter((_, idx) => idx !== i),
                              }))
                            }
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <div className={label}>Driver</div>
                            <input
                              className={input}
                              value={row.driver}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'driver', e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <div className={label}>Why it matters</div>
                            <textarea
                              className={cardTextarea}
                              value={row.whyItMatters}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'whyItMatters', e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div className="md:max-w-xs">
                            <div className={label}>Importance</div>
                            <select
                              className={input}
                              value={row.importance}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'importance', e.target.value),
                                }))
                              }
                            >
                              <option value="">—</option>
                              {row.importance &&
                              !(DRIVER_IMPORTANCE_STANDARD as readonly string[]).includes(
                                row.importance
                              ) ? (
                                <option value={row.importance}>
                                  {row.importance} (custom)
                                </option>
                              ) : null}
                              {DRIVER_IMPORTANCE_STANDARD.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className={addRowBtn}
                  disabled={form.drivers.length >= MAX_TABLE_ROWS}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      drivers: [...f.drivers, { ...EMPTY_DRIVER_ROW }],
                    }))
                  }
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add driver
                </button>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">4. Downside and Failure Map</h2>
                  <SectionChatHelpButton
                    sectionTitle="downside and failure map"
                    prompt={SECTION_HELP.failures}
                    disabled={loadingRemote}
                    onRequestHelp={requestSectionChatHelp}
                  />
                </div>
                <div className="space-y-4">
                  {form.failures.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
                      No failure paths yet. Add one to spell out how the thesis could break.
                    </p>
                  ) : (
                    form.failures.map((row, i) => (
                      <div key={i} className={repeatableCard}>
                        <div className="mb-4 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Failure path {i + 1}
                          </span>
                          <button
                            type="button"
                            className={rowRemoveBtn}
                            title="Remove failure path"
                            aria-label={`Remove failure path ${i + 1}`}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                failures: f.failures.filter((_, idx) => idx !== i),
                              }))
                            }
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <div className={label}>Failure path</div>
                            <input
                              className={input}
                              value={row.failurePath}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'failurePath', e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <div className={label}>Trigger</div>
                            <textarea
                              className={cardTextarea}
                              value={row.trigger}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'trigger', e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div className="md:max-w-xs">
                            <div className={label}>Timeframe</div>
                            <select
                              className={input}
                              value={row.timeframe}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'timeframe', e.target.value),
                                }))
                              }
                            >
                              <option value="">—</option>
                              {row.timeframe &&
                              !(FAILURE_TIMEFRAME_STANDARD as readonly string[]).includes(
                                row.timeframe
                              ) ? (
                                <option value={row.timeframe}>
                                  {row.timeframe} (custom)
                                </option>
                              ) : null}
                              {FAILURE_TIMEFRAME_STANDARD.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <div className={label}>Estimated impact</div>
                            <textarea
                              className={cardTextarea}
                              value={row.estimatedImpact}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(
                                    f.failures,
                                    i,
                                    'estimatedImpact',
                                    e.target.value
                                  ),
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className={addRowBtn}
                  disabled={form.failures.length >= MAX_TABLE_ROWS}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      failures: [...f.failures, { ...EMPTY_FAILURE_ROW }],
                    }))
                  }
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add failure path
                </button>
              </div>

              <div className={section}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-lg font-semibold">5. Decision Rules</h2>
                  <SectionChatHelpButton
                    sectionTitle="decision rules"
                    prompt={SECTION_HELP.rules}
                    disabled={loadingRemote}
                    onRequestHelp={requestSectionChatHelp}
                  />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className={label}>Trim rule</div>
                    <textarea
                      className={textarea}
                      value={form.trimRule}
                      onChange={(e) => setForm((f) => ({ ...f, trimRule: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Exit rule</div>
                    <textarea
                      className={textarea}
                      value={form.exitRule}
                      onChange={(e) => setForm((f) => ({ ...f, exitRule: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className={label}>Add rule</div>
                    <textarea
                      className={textarea}
                      value={form.addRule}
                      onChange={(e) => setForm((f) => ({ ...f, addRule: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>System monitoring signals</div>
                    <textarea
                      className={textarea}
                      value={form.systemMonitoringSignals}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, systemMonitoringSignals: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6 xl:sticky xl:top-6 xl:self-start w-full">
              <ThesisBuilderChat
                apiTicker={symbol}
                companyName={companyName}
                form={form}
                tickerLocked={tickerLocked}
                onFormPatch={handleFormPatch}
                initialMessages={initialChatHistory}
                autoSendMessage={chatAutoSend}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
