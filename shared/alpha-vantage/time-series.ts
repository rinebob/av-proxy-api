// COPIED FROM functions/src/v2/common/common-av.ts and related files. Do not use directly until migration is complete.

import type { TimestampLike } from '../firestore/timestamp';

export enum TimeSeriesInterval {
  INTRADAY = 'intraday',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly'
}

export enum OutputSize {
  COMPACT = 'compact',
  FULL = 'full'
}

export interface DailyTimeSeriesData {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
    "5. volume": string;
    "5. adjusted close"?: string;
    "6. volume"?: string;
    "7. dividend amount"?: string;
    "8. split coefficient"?: string;
    "9. previous close"?: string;
    "10. change"?: string;
    "11. change percent"?: string;
}


// Clean version of DailyTimeSeriesData without numbered keys
export interface DailyTimeSeriesDataTwo {
    date: string; // Date string in YYYY-MM-DD format
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    // These are specific to TIME_SERIES_DAILY_ADJUSTED
    adjustedClose?: string;
    volumeAdjusted?: string;
    dividendAmount?: string;
    splitCoefficient?: string;
    // Calculated fields
    previousClose?: string;
    change?: string;
    changePercent?: string;
}

export interface QueryParams {
    symbol: string;
    outputSize: OutputSize;
}

export enum DocumentType {
  TIME_SERIES = 'TIME_SERIES',
  STANDARD = 'STANDARD'
}
export interface StandardMetadata extends BaseMetadata {
  endpoint: string;
  nextRefreshAt: any;
}

export interface BaseMetadata {
  symbol: string;
  lastUpdated: TimestampLike;
  ttlSeconds: number;
}

