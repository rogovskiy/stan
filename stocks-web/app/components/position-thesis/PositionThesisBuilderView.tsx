'use client';

import { useCallback, useState } from 'react';
import type { DriverRow, FailureRow, PositionThesisPayload } from '@/app/lib/types/positionThesis';
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
const badge = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border';

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

export interface PositionThesisBuilderViewProps {
  ticker: string;
  companyName?: string | null;
  userId: string | null;
  /** undefined = remote load in progress; null = no saved doc; object = hydrate */
  initialPayload: PositionThesisPayload | null | undefined;
  loadError?: string | null;
}

export default function PositionThesisBuilderView({
  ticker,
  companyName,
  userId,
  initialPayload,
  loadError,
}: PositionThesisBuilderViewProps) {
  const displayTicker = ticker.toUpperCase();
  const titleName = companyName ? `${companyName} (${displayTicker})` : displayTicker;

  const [form, setForm] = useState<PositionThesisPayload>(() =>
    initialPayload === null || initialPayload === undefined
      ? defaultPositionThesisPayload(displayTicker)
      : initialPayload
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const persist = useCallback(
    async (status: 'draft' | 'published') => {
      if (!userId) {
        setSaveState('error');
        setSaveMessage('Sign in to save your thesis.');
        return;
      }
      setSaveState('saving');
      setSaveMessage(null);
      try {
        await savePositionThesis(userId, displayTicker, form, status);
        setSaveState('saved');
        setSaveMessage(status === 'draft' ? 'Draft saved.' : 'Thesis published.');
        window.setTimeout(() => {
          setSaveState('idle');
          setSaveMessage(null);
        }, 3500);
      } catch (e) {
        setSaveState('error');
        setSaveMessage(e instanceof Error ? e.message : 'Save failed.');
      }
    },
    [userId, displayTicker, form]
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
              Create a structured investment thesis by defining role, expected return, downside,
              failure conditions, and decision rules. The system will later score this thesis against
              live market conditions.
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
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <div className={label}>Ticker</div>
                    <input
                      className={input}
                      value={form.ticker}
                      onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                    />
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
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">1. Thesis Statement</h2>
                  <span className={`${badge} bg-emerald-50 text-emerald-700 border-emerald-200`}>
                    Required
                  </span>
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
              </div>

              <div className={section}>
                <h2 className="text-lg font-semibold mb-4">2. Return Expectation</h2>
                <div className="grid md:grid-cols-4 gap-4">
                  <div>
                    <div className={label}>Entry Price</div>
                    <input
                      className={input}
                      value={form.entryPrice}
                      onChange={(e) => setForm((f) => ({ ...f, entryPrice: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Base Return / Year</div>
                    <input
                      className={input}
                      value={form.baseReturnYear}
                      onChange={(e) => setForm((f) => ({ ...f, baseReturnYear: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Dividend Yield Assumption</div>
                    <input
                      className={input}
                      value={form.dividendYieldAssumption}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, dividendYieldAssumption: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <div className={label}>Growth Assumption</div>
                    <input
                      className={input}
                      value={form.growthAssumption}
                      onChange={(e) => setForm((f) => ({ ...f, growthAssumption: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4 mt-4">
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
                <h2 className="text-lg font-semibold mb-4">3. Drivers and Dependencies</h2>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left p-3">Driver</th>
                        <th className="text-left p-3">Why it matters</th>
                        <th className="text-left p-3">Current state</th>
                        <th className="text-left p-3">Importance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.drivers.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200 bg-white">
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.driver}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'driver', e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.whyItMatters}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'whyItMatters', e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.currentState}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'currentState', e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.importance}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  drivers: updateDriver(f.drivers, i, 'importance', e.target.value),
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={section}>
                <h2 className="text-lg font-semibold mb-4">4. Downside and Failure Map</h2>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left p-3">Failure path</th>
                        <th className="text-left p-3">Trigger</th>
                        <th className="text-left p-3">Estimated impact</th>
                        <th className="text-left p-3">Timeframe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.failures.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200 bg-white">
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.failurePath}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'failurePath', e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.trigger}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'trigger', e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
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
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className={`${input} border-0 bg-transparent p-1`}
                              value={row.timeframe}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  failures: updateFailure(f.failures, i, 'timeframe', e.target.value),
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid md:grid-cols-3 gap-4 mt-4">
                  <div>
                    <div className={label}>Distance to failure</div>
                    <input
                      className={input}
                      value={form.distanceToFailure}
                      onChange={(e) => setForm((f) => ({ ...f, distanceToFailure: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Current volatility regime</div>
                    <input
                      className={input}
                      value={form.currentVolRegime}
                      onChange={(e) => setForm((f) => ({ ...f, currentVolRegime: e.target.value }))}
                    />
                  </div>
                  <div>
                    <div className={label}>Risk posture</div>
                    <input
                      className={input}
                      value={form.riskPosture}
                      onChange={(e) => setForm((f) => ({ ...f, riskPosture: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className={section}>
                <h2 className="text-lg font-semibold mb-4">5. Decision Rules</h2>
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

            <div className="space-y-6 xl:sticky xl:top-6 self-start">
              <ThesisBuilderChat ticker={displayTicker} companyName={companyName} form={form} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
