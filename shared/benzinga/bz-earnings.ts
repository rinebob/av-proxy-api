// COPIED FROM src/app/common/fe-common-bz.ts (no backend definition found). Do not use directly until migration is complete.

import { BenzingaEndpoint } from "./bz-endpoints";

/**
 * A single earnings calendar item from Benzinga.
 */
export interface BzEarningsData {
    id: string,
    date: string,
    date_confirmed: string,
    time: string,
    ticker: string,
    exchange: string,
    name: string,
    currency: string,
    period: string,
    period_year: number,
    eps_type: string,
    eps: number,
    eps_est: number,
    eps_prior: number,
    eps_surprise: number,
    eps_surprise_percent: number,
    revenue_type: string,
    revenue: number,
    revenue_est: number,
    revenue_prior: number,
    revenue_surprise: number,
    revenue_surprise_percent: number,
    importance: number,
    notes: string,
    updated: number
}

/**
 * Base query parameters for Benzinga calendar endpoints.
 */
export interface BenzingaCalendarParamsBase {
    /** The type of calendar to request (e.g., earnings, dividends) */
    type: BenzingaEndpoint;
    /** Optional: Comma-separated list of tickers */
    tickers?: string;
    /** Optional: YYYY-MM-DD */
    date_from?: string;
    /** Optional: YYYY-MM-DD */
    date_to?: string;
    page?: number;
    pageSize?: number;
}

/**
 * Response from the Benzinga earnings calendar endpoint.
 */
export interface EarningsResponse {
    earnings: BzEarningsData[];
}

