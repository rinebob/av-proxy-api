/**
 * Math and date utilities for the data-quality scan script.
 *
 * Black-Scholes implied-underlying estimation uses the delta, IV, strike,
 * and time-to-expiration from each observation to back out the underlying
 * price.  When data is corrupted (e.g. zero prices with delta=1.0), the
 * implied underlying diverges wildly from the file median, flagging the
 * anomaly.
 */

/** Standard normal CDF (Abramowitz & Stegun approximation). */
export function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  let p =
    d *
    t *
    (0.319381530762054 +
      t * (-0.35656378177718 + t * (1.781477937707957 + t * (-1.821255978049844 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

/** Inverse standard normal CDF (Beasley-Springer-Moro approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p <= pHigh) {
    q = p - 0.5;
    const r = q * q;
    return (
      (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Estimates the underlying price from option delta using the Black-Scholes
 * relationship: d1 = N^{-1}(delta) for calls, N^{-1}(delta + 1) for puts.
 * Then S = K * exp(d1 * sigma * sqrt(T) - (r + sigma^2/2) * T).
 *
 * Returns null when inputs are degenerate (extreme delta, zero IV, etc).
 */
export function estimateUnderlying(
  type: 'call' | 'put',
  strike: number,
  T: number,
  r: number,
  sigma: number,
  delta: number,
): number | null {
  if (T <= 0 || sigma <= 0 || strike <= 0) return null;

  // # Reason: For puts, delta is negative (N(d1) - 1), so we add 1 to get
  // the probability N(d1).  For calls, delta IS N(d1).
  const prob = type === 'call' ? delta : delta + 1;
  if (prob <= 0.001 || prob >= 0.999) return null;

  const d1 = normInv(prob);
  const sqrtT = Math.sqrt(T);
  const S = strike * Math.exp(d1 * sigma * sqrtT - (r + (sigma * sigma) / 2) * T);

  if (!Number.isFinite(S) || S <= 0) return null;
  return S;
}

/**
 * US stock market holidays (NYSE/NASDAQ) for 2019-2026, as ISO date strings.
 * Includes: New Year's, MLK, Presidents' Day, Good Friday, Memorial Day,
 * Juneteenth (2022+), Independence Day, Labor Day, Thanksgiving, Christmas.
 * When a holiday falls on a weekend, the observed closure date is used.
 */
const US_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2019
  '2019-01-01', '2019-01-21', '2019-02-18', '2019-04-19', '2019-05-27',
  '2019-07-04', '2019-09-02', '2019-11-28', '2019-12-25',
  // 2020
  '2020-01-01', '2020-01-20', '2020-02-17', '2020-04-10', '2020-05-25',
  '2020-07-03', '2020-09-07', '2020-11-26', '2020-12-25',
  // 2021
  '2021-01-01', '2021-01-18', '2021-02-15', '2021-04-02', '2021-05-31',
  '2021-07-05', '2021-09-06', '2021-11-25', '2021-12-24',
  // 2022
  '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20',
  '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
  // 2023
  '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29',
  '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
  // 2024
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
  '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

/**
 * Counts trading days (weekdays minus US market holidays) between two ISO
 * date strings, inclusive.
 */
export function countWeekdays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;

  let count = 0;
  const current = new Date(startMs);
  const endTime = new Date(endMs);

  while (current <= endTime) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      const iso = current.toISOString().slice(0, 10);
      if (!US_MARKET_HOLIDAYS.has(iso)) count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}
