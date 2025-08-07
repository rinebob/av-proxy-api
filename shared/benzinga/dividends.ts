// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

/**
 * Dividends data structure
 */
/**
 * Represents a single Benzinga Dividends API response item.
 * Matches the raw API response shape (all fields as returned by Benzinga).
 */
export interface BenzingaDividendApiItem {
    id: string;
    date: string; // YYYY-MM-DD
    notes: string;
    updated: number;
    ticker: string;
    name: string;
    exchange: string;
    currency: string;
    confirmed: boolean;
    period: string;
    year: number;
    frequency: number;
    dividend: string; // double, but as string in API
    dividend_prior: string; // double, but as string in API
    dividend_type: string;
    dividend_yield: string; // double, but as string in API
    ex_dividend_date: string;
    payable_date: string;
    record_date: string;
    importance: number;
}
