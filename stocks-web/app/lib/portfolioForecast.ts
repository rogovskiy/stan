/**
 * Simple foundation math for 2-year portfolio forecast cone.
 * Replace with real estimates (volatility, returns) later.
 */

/**
 * Generate monthly date strings after lastDate (exclusive). numMonths points.
 * Dates are on the same day of month when possible.
 */
export function getForecastDates(lastDate: string, numMonths: number): string[] {
  const dates: string[] = [];
  const d = new Date(lastDate);
  for (let i = 1; i <= numMonths; i++) {
    const next = new Date(d);
    next.setMonth(next.getMonth() + i);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Generate daily date strings after lastDate (exclusive). numDays points.
 * Use so forecast has same point density as history and lines render as one segment.
 */
export function getForecastDatesDaily(lastDate: string, numDays: number): string[] {
  const dates: string[] = [];
  const d = new Date(lastDate);
  for (let i = 1; i <= numDays; i++) {
    const next = new Date(d);
    next.setDate(next.getDate() + i);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

export interface ConeParams {
  /** Annual growth for optimistic (top) path: value at t = lastValue * (1 + g)^t. */
  annualGrowthOpt: number;
  /** Annual growth for pessimistic (bottom) path: value at t = lastValue * (1 + g)^t. Negative = line slopes down. Same idea as top, different slope. */
  annualGrowthPessimistic: number;
}

/** Portfolio cone: higher volatility. Top +10%/y, bottom -10%/y from same start. */
export const PORTFOLIO_CONE_PARAMS: ConeParams = {
  annualGrowthOpt: 0.1,
  annualGrowthPessimistic: -0.1,
};

/** Benchmark cone: lower volatility (tighter band). Top +8%/y, bottom -5%/y. */
export const BENCHMARK_CONE_PARAMS: ConeParams = {
  annualGrowthOpt: 0.08,
  annualGrowthPessimistic: -0.05,
};

export interface ConePoint {
  top: number;
  bottom: number;
}

/**
 * Project optimistic (top) and pessimistic (bottom) paths from lastValue.
 * Same idea for both: start at lastValue, apply annual growth.
 * Top: lastValue * (1 + g_opt)^t  (positive slope).
 * Bottom: lastValue * (1 + g_pessimistic)^t  (negative slope when g_pessimistic < 0).
 * Point i is at t = (i+1)/stepsPerYear (e.g. day 1, 2, ... so cone attaches at t=0 in the chart).
 */
export function projectCone(
  lastValue: number,
  params: ConeParams,
  numPoints: number,
  stepsPerYear: number = 12
): ConePoint[] {
  const { annualGrowthOpt, annualGrowthPessimistic } = params;
  const points: ConePoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const tYears = (i + 1) / stepsPerYear;
    const top = lastValue * Math.pow(1 + annualGrowthOpt, tYears);
    const bottom = lastValue * Math.pow(1 + annualGrowthPessimistic, tYears);
    points.push({ top, bottom });
  }
  return points;
}
