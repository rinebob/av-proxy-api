/**
 * This file contains shared interfaces for Benzinga API parameters and responses.
 */

/**
 * Parameters for the getEarningsCalendar Cloud Function.
 */
export interface EarningsParams {
  tickers: string | string[];
  date_from?: string;
  date_to?: string;
  page?: number;
  pagesize?: number;
  type?: string;
}

/**
 * Represents the structure of a single earnings event from Benzinga.
 */
export interface EarningsItem {
  id?: string;
  date: string;
  time: string;
  ticker: string;
  exchange: string;
  name: string;
  period: string;
  eps_est: number | null;
  eps_act: number | null;
  eps_surprise: number | null;
  eps_surprise_percent: number | null;
  revenue_est: number | null;
  revenue_act: number | null;
  revenue_surprise: number | null;
  revenue_surprise_percent: number | null;
  updated: string;
  currency: string;
  importance: number;
  notes: string | null;
}

/**
 * Represents the overall API response for an earnings calendar request from Benzinga.
 */
export interface EarningsResponse {
  earnings: EarningsItem[];
  next_url?: string;
  previous_url?: string | null;
  count: number;
  status: string;
  message?: string;
}
