// COPIED FROM src/app/feat/bz-calendar-view/common/fe-common-bz-api.ts. Do not use directly until migration is complete.

/**
 * Dividends data structure
 */
export interface DividendsData {
  date: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  dividend: number;
  dividend_prior: number;
  dividend_yield: number;
  dividend_yield_annual: number;
  ex_dividend_date: string;
  pay_date: string;
  record_date: string;
  updated: number;
  frequency: string;
  status: string;
  importance?: number;
  notes?: string;
}
