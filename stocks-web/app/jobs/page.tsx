'use client';

import { useState, useEffect, useMemo } from 'react';
import AppNavigation from '../components/AppNavigation';

const JOB_TYPES = [
  'price_refresh',
  'quarterly_timeseries',
  'macro',
  'ir_scan',
  'youtube',
  'youtube_transcript',
  'portfolio_channel_exposure',
  'portfolio_channel_exposure_publish',
] as const;
const DAYS_RANGE = 14;

interface JobRun {
  id: string;
  job_type: string;
  date: string;
  started_at: string;
  finished_at?: string;
  status: 'success' | 'error';
  execution_id: string;
  entity?: string;
  error_message?: string;
  payload?: Record<string, unknown>;
}

const LOGGING_SERVICE_BY_JOB_TYPE: Partial<Record<(typeof JOB_TYPES)[number], string>> = {
  macro: 'macro-refresh',
  // functions_yahoo deploys `yahoo_refresh` → Cloud Run service name is typically `yahoo-refresh`
  price_refresh: 'yahoo-refresh',
  quarterly_timeseries: 'yahoo-refresh',
  // functions_youtube deploys `youtube_refresh` → Cloud Run service name is typically `youtube-refresh`
  youtube: 'youtube-refresh',
  youtube_transcript: 'youtube-transcript-analysis',
  // functions_portfolio (Gen2 → Cloud Run); adjust if console shows different service_name
  portfolio_channel_exposure: 'portfolio-channel-exposure-refresh',
  portfolio_channel_exposure_publish: 'portfolio-weekly-publish',
};

function cloudLoggingUrl(projectId: string, query: string): string {
  return `https://console.cloud.google.com/logs/query?project=${encodeURIComponent(projectId)}&query=${encodeURIComponent(query)}`;
}

function dateRange(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < DAYS_RANGE; i++) {
    const x = new Date(d);
    x.setDate(x.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

/** Compact label for date column: "M/D" e.g. "3/1". Full date in title. */
function formatDateCompact(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${m}/${d}`;
}

/** Human-readable duration from started/finished ISO strings, e.g. "2m 15s", "45s". */
function formatDuration(startedAt: string, finishedAt?: string): string {
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function useJobRuns(from: string, to: string) {
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/runs?from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setRuns(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [from, to]);

  return { runs, loading, error };
}

/** Daily cell: green = all success, yellow = some failed, red = all failed. Computed on read from run statuses. */
type CellState = 'success' | 'partial' | 'error' | 'none';

function gridState(runs: JobRun[], dates: string[]): Map<string, Map<string, { state: CellState; runs: JobRun[] }>> {
  const byJob = new Map<string, Map<string, { state: CellState; runs: JobRun[] }>>();
  for (const jt of JOB_TYPES) {
    const byDate = new Map<string, { state: CellState; runs: JobRun[] }>();
    for (const date of dates) {
      const dayRuns = runs.filter((r) => r.job_type === jt && r.date === date);
      const errorCount = dayRuns.filter((r) => r.status === 'error').length;
      const state: CellState =
        dayRuns.length === 0
          ? 'none'
          : errorCount === 0
            ? 'success'
            : errorCount === dayRuns.length
              ? 'error'
              : 'partial';
      byDate.set(date, { state, runs: dayRuns });
    }
    byJob.set(jt, byDate);
  }
  return byJob;
}

export default function JobsPage() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const dates = useMemo(() => dateRange(), []);
  const to = dates[0];
  const from = dates[dates.length - 1];
  const { runs, loading, error } = useJobRuns(from, to);
  const grid = useMemo(() => gridState(runs, dates), [runs, dates]);

  const [selectedCell, setSelectedCell] = useState<{ jobType: string; date: string } | null>(null);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<JobRun | null>(null);

  const cellRuns = selectedCell
    ? (grid.get(selectedCell.jobType)?.get(selectedCell.date)?.runs ?? [])
    : [];

  useEffect(() => {
    if (!detailRunId) {
      setDetailRun(null);
      return;
    }
    const fromList = runs.find((r) => r.id === detailRunId || r.execution_id === detailRunId);
    if (fromList) {
      setDetailRun(fromList);
      return;
    }
    let cancelled = false;
    fetch(`/api/jobs/runs/${detailRunId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setDetailRun(data);
      })
      .catch(() => {
        if (!cancelled) setDetailRun(null);
      });
    return () => { cancelled = true; };
  }, [detailRunId, runs]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Data refresh jobs</h1>
          <p className="text-sm text-gray-600 mt-2">
            Last {DAYS_RANGE} days. Click a cell to see executions; click an execution for details.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500">Loading runs…</div>
        ) : (
          <div className="flex gap-6 flex-wrap">
            <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white shadow-sm">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-2 border-b border-gray-200 font-medium text-gray-700 w-32 sticky left-0 bg-white">
                      Job type
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        title={d}
                        className="px-1 py-2 border-b border-gray-200 font-medium text-gray-600 text-xs w-9 text-center"
                      >
                        {formatDateCompact(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {JOB_TYPES.map((jt) => (
                    <tr key={jt} className="border-b border-gray-100 last:border-0">
                      <td className="p-2 sticky left-0 bg-white font-medium text-gray-800">{jt}</td>
                      {dates.map((date) => {
                        const cell = grid.get(jt)?.get(date);
                        const state = cell?.state ?? 'none';
                        const isSelected =
                          selectedCell?.jobType === jt && selectedCell?.date === date;
                        return (
                          <td key={date} className="p-1">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ jobType: jt, date })}
                              className={`
                                w-8 h-8 rounded border flex items-center justify-center text-xs font-medium
                                ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
                                ${state === 'success' ? 'bg-green-100 border-green-300 text-green-800' : ''}
                                ${state === 'partial' ? 'bg-amber-100 border-amber-300 text-amber-800' : ''}
                                ${state === 'error' ? 'bg-red-100 border-red-300 text-red-800' : ''}
                                ${state === 'none' ? 'bg-gray-100 border-gray-200 text-gray-400' : ''}
                              `}
                              title={`${jt} @ ${date}${cell?.runs.length ? ` (${cell.runs.length})` : ''}`}
                            >
                              {cell?.runs.length ? cell.runs.length : '—'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="min-w-[280px] max-w-md border border-gray-200 rounded-lg bg-white shadow-sm p-4">
              {selectedCell ? (
                <>
                  <h3 className="font-semibold text-gray-900 mb-2">
                    {selectedCell.jobType} — {selectedCell.date}
                  </h3>
                  {cellRuns.length === 0 ? (
                    <p className="text-sm text-gray-500">No runs</p>
                  ) : (
                    <ul className="space-y-1">
                      {cellRuns.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setDetailRunId(r.id)}
                            className={`text-left w-full text-sm px-2 py-1.5 rounded border truncate block flex items-center gap-2 ${
                              detailRunId === r.id
                                ? 'bg-blue-50 border-blue-300'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <span
                              className={`shrink-0 w-2 h-2 rounded-full ${r.status === 'error' ? 'bg-red-500' : 'bg-green-500'}`}
                              title={r.status}
                            />
                            {r.entity && ` ${r.entity}`}
                            <span className="text-gray-500 ml-1 text-xs">{r.started_at.slice(0, 19)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">Click a cell to see executions</p>
              )}
            </div>

            <div className="min-w-[280px] max-w-md border border-gray-200 rounded-lg bg-white shadow-sm p-4">
              {detailRun ? (
                <>
                  <h3 className="font-semibold text-gray-900 mb-2">Execution detail</h3>
                  <dl className="text-sm space-y-1.5">
                    <div>
                      <dt className="text-gray-500">Execution ID</dt>
                      <dd className="font-mono text-gray-900 break-all flex items-center gap-2 flex-wrap">
                        {detailRun.execution_id}
                        {typeof process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'string' &&
                          LOGGING_SERVICE_BY_JOB_TYPE[detailRun.job_type as (typeof JOB_TYPES)[number]] && (
                            <a
                              href={cloudLoggingUrl(
                                process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                                `resource.labels.service_name="${LOGGING_SERVICE_BY_JOB_TYPE[detailRun.job_type as (typeof JOB_TYPES)[number]]}" AND labels.execution_id="${detailRun.execution_id}"`,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-xs"
                            >
                              View in Cloud Logging
                            </a>
                          )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Job type</dt>
                      <dd>{detailRun.job_type}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Date</dt>
                      <dd>{detailRun.date}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Status</dt>
                      <dd className={detailRun.status === 'error' ? 'text-red-600' : 'text-green-700'}>
                        {detailRun.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Duration</dt>
                      <dd>{formatDuration(detailRun.started_at, detailRun.finished_at)}</dd>
                    </div>
                    {detailRun.entity && (
                      <div>
                        <dt className="text-gray-500">Entity</dt>
                        <dd>{detailRun.entity}</dd>
                      </div>
                    )}
                    {detailRun.error_message && (
                      <div>
                        <dt className="text-gray-500">Error</dt>
                        <dd className="text-red-700 break-words">{detailRun.error_message}</dd>
                      </div>
                    )}
                    {detailRun.payload && Object.keys(detailRun.payload).length > 0 && (
                      <div>
                        <dt className="text-gray-500">Payload</dt>
                        <dd className="font-mono text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                          <pre>{JSON.stringify(detailRun.payload, null, 2)}</pre>
                        </dd>
                      </div>
                    )}
                  </dl>
                </>
              ) : (
                <p className="text-sm text-gray-500">Click an execution for details</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
