// COPIED FROM functions/src/v2/common/common-av.ts and related files. Do not use directly until migration is complete.

import { RefreshEvent } from '../firestore';
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

// Define type for the object where keys are dates and values are DailyTimeSeriesData
export interface DailyTimeSeries {
    [date: string]: DailyTimeSeriesData; // Keys are date strings (e.g., "2023-01-01")
}

// Define type for the metadata in time series responses
export interface TimeSeriesMetaData {
    "1. Information": string;
    "2. Symbol": string;
    "3. Last Refreshed": string;
    "4. Output Size": string;
    "5. Time Zone": string;
    // Adjusted might have slightly different metadata keys, verify with docs/response
    "6. Time Zone"?: string; // Sometimes key is 6
}

// Clean version of TimeSeriesMetaData without numbered keys
export interface TimeSeriesMetaDataTwo {
    information: string;      // "1. Information"
    symbol: string;           // "2. Symbol"
    lastRefreshed: string;    // "3. Last Refreshed"
    outputSize: string;       // "4. Output Size"
    timeZone: string;         // "5. Time Zone"
    timeZoneAlt?: string;     // "6. Time Zone" (alternative key)
}

// Define type for the overall TIME_SERIES_DAILY response
export interface AlphaVantageDailyTimeSeriesResponse {
    "Meta Data": TimeSeriesMetaData;
    "Time Series (Daily)"?: DailyTimeSeries; // For TIME_SERIES_DAILY
    "Time Series (Daily - Adjusted)"?: DailyTimeSeries; // For TIME_SERIES_DAILY_ADJUSTED
    "Information"?: string; // For API-level errors/info
    "Note"?: string;       // For rate limit messages
    "Error Message"?: string; // For API-level errors
}

// Clean version of AlphaVantageDailyTimeSeriesResponse with consistent naming
export interface AlphaVantageDailyTimeSeriesTwo {
    metaData: TimeSeriesMetaDataTwo;
    timeSeriesDaily: DailyTimeSeriesDataTwo[]; // Array of daily data points
    timeSeriesDailyAdjusted?: DailyTimeSeriesDataTwo[]; // Optional array of adjusted daily data points
    information?: string; // For API-level errors/info
    note?: string;       // For rate limit messages
    errorMessage?: string; // For API-level errors
}


/**
 * Metadata for a time series document in Firestore
 */
export interface TimeSeriesDocumentMetadata {
    /** First date in the historical data */
    histStartDate: Date | TimestampLike;
    
    /** Most recent date in the historical data */
    histEndDate: Date | TimestampLike;
    
    /** Number of historical data points */
    histDataPoints: number;
    
    /** Date of the first quote in the dataset */
    firstQuoteDate?: Date | TimestampLike;
    
    /** Number of quote data points */
    quoteDataPoints?: number;
    
    /** Time interval between data points */
    interval: TimeSeriesInterval;
    
    /** Stock symbol this data represents */
    symbol: string;
  }
  
  /**
   * Structure of a time series document in Firestore
   */
  export interface TimeSeriesDocument<T = any> {
    /** Array of time series data points */
    data: T[];
    
    /** Metadata about the time series data */
    metadata: TimeSeriesDocumentMetadata;
  
    /** Refresh history */
    refreshHistory: RefreshEvent[];
  }