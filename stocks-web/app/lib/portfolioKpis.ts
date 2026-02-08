/**
 * Portfolio KPIs computed from historical index series (normalized to 100).
 * Input: dates, portfolio[], benchmark[] from performance API.
 */

const TRADING_DAYS_PER_YEAR = 252;

/** Daily returns from index series: r[i] = (value[i] / value[i-1]) - 1. Length = n - 1. */
function dailyReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev > 0) out.push(values[i] / prev - 1);
  }
  return out;
}

function mean(x: number[]): number {
  if (x.length === 0) return 0;
  return x.reduce((a, b) => a + b, 0) / x.length;
}

function variance(x: number[]): number {
  if (x.length < 2) return 0;
  const m = mean(x);
  return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1);
}

function covariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (x.length - 1);
}

export interface PortfolioKpis {
  averageReturn: number | null;
  beta: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  expectedReturn: number | null;
  stressDrawdown: number | null;
}

/** Expected return placeholder: same as cone optimistic growth (%). */
const EXPECTED_RETURN_PLACEHOLDER = 10;

/** Stress drawdown placeholder until scenario is defined. */
const STRESS_DRAWDOWN_PLACEHOLDER = 0;

/**
 * Compute portfolio KPIs from historical index series (normalized to 100 at start).
 */
export function computePortfolioKpis(
  dates: string[],
  portfolio: number[],
  benchmark: number[]
): PortfolioKpis {
  const n = dates.length;
  if (n < 2 || portfolio.length !== n || benchmark.length !== n) {
    return {
      averageReturn: null,
      beta: null,
      sharpe: null,
      maxDrawdown: null,
      expectedReturn: EXPECTED_RETURN_PLACEHOLDER,
      stressDrawdown: STRESS_DRAWDOWN_PLACEHOLDER,
    };
  }

  const lastP = portfolio[n - 1];
  const periodReturn = lastP / 100 - 1;
  const years = (n - 1) / TRADING_DAYS_PER_YEAR;
  const averageReturn = years > 0 ? (Math.pow(1 + periodReturn, 1 / years) - 1) * 100 : null;

  const rp = dailyReturns(portfolio);
  const rb = dailyReturns(benchmark);
  if (rp.length !== rb.length || rp.length < 2) {
    return {
      averageReturn: averageReturn ?? null,
      beta: null,
      sharpe: null,
      maxDrawdown: null,
      expectedReturn: EXPECTED_RETURN_PLACEHOLDER,
      stressDrawdown: STRESS_DRAWDOWN_PLACEHOLDER,
    };
  }

  const varB = variance(rb);
  const beta = varB > 0 ? covariance(rp, rb) / varB : null;

  const meanRp = mean(rp);
  const stdRp = Math.sqrt(variance(rp));
  const sharpe = stdRp > 0 ? (meanRp / stdRp) * Math.sqrt(TRADING_DAYS_PER_YEAR) : null;

  let runningMax = portfolio[0];
  let minDrawdown = 0;
  for (let i = 1; i < portfolio.length; i++) {
    if (portfolio[i] > runningMax) runningMax = portfolio[i];
    const dd = runningMax > 0 ? (portfolio[i] - runningMax) / runningMax : 0;
    if (dd < minDrawdown) minDrawdown = dd;
  }
  const maxDrawdown = minDrawdown <= 0 ? Math.abs(minDrawdown) * 100 : 0;

  return {
    averageReturn: averageReturn ?? null,
    beta: beta ?? null,
    sharpe: sharpe ?? null,
    maxDrawdown,
    expectedReturn: EXPECTED_RETURN_PLACEHOLDER,
    stressDrawdown: STRESS_DRAWDOWN_PLACEHOLDER,
  };
}
