/**
 * TypeScript types for the Alpha Vantage EARNINGS_ESTIMATES endpoint response.
 * @see https://www.alphavantage.co/documentation/#earnings-estimates
 *
 * All numeric values are strings (as returned by AV).
 * Revision count fields can be null when no revisions have occurred.
 */

export type AvEstimateHorizon = 'fiscal year' | 'fiscal quarter';

export interface AvEarningsEstimate {
  date: string;
  horizon: AvEstimateHorizon;
  eps_estimate_average: string;
  eps_estimate_high: string;
  eps_estimate_low: string;
  eps_estimate_analyst_count: string;
  eps_estimate_average_7_days_ago: string;
  eps_estimate_average_30_days_ago: string;
  eps_estimate_average_60_days_ago: string;
  eps_estimate_average_90_days_ago: string;
  eps_estimate_revision_up_trailing_7_days: string | null;
  eps_estimate_revision_down_trailing_7_days: string | null;
  eps_estimate_revision_up_trailing_30_days: string | null;
  eps_estimate_revision_down_trailing_30_days: string | null;
  revenue_estimate_average: string;
  revenue_estimate_high: string;
  revenue_estimate_low: string;
  revenue_estimate_analyst_count: string;
}

export interface AvEarningsEstimatesResponse {
  symbol: string;
  estimates: AvEarningsEstimate[];
}
