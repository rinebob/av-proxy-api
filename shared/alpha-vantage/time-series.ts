// COPIED FROM functions/src/v2/common/common-av.ts and related files. Do not use directly until migration is complete.
// NOTE: This file references Firestore types.
// If using in backend, ensure you have:
// import { Timestamp, FieldValue } from 'firebase-admin/firestore';
// or reference as FirebaseFirestore.Timestamp, FirebaseFirestore.FieldValue

import { RefreshEvent } from "../../functions/src/v2/common/refresh.types";
import { EndpointConfig } from "../types";

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

export interface TimeSeriesMetaData {
    "1. Information": string;
    "2. Symbol": string;
    "3. Last Refreshed": string;
    "4. Output Size": string;
    "5. Time Zone": string;
    "6. Time Zone"?: string;
}

export interface TimeSeriesMetaDataTwo {
    information: string;
    symbol: string;
    lastRefreshed: string;
    outputSize: string;
    timeZone: string;
    timeZoneAlt?: string;
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

export interface AlphaVantageDailyTimeSeriesResponse {
    "Meta Data": TimeSeriesMetaData;
    "Time Series (Daily)"?: DailyTimeSeriesData;
    "Time Series (Daily - Adjusted)"?: DailyTimeSeriesData;
    "Information"?: string;
    "Note"?: string;
    "Error Message"?: string;
}

export interface AlphaVantageDailyTimeSeriesTwo {
    metaData: TimeSeriesMetaDataTwo;
    timeSeriesDaily: DailyTimeSeriesData[];
    timeSeriesDailyAdjusted?: DailyTimeSeriesData[];
    information?: string;
    note?: string;
    errorMessage?: string;
}

export interface QueryParams {
    symbol: string;
    outputSize: OutputSize;
}

export enum DocumentType {
  TIME_SERIES = 'TIME_SERIES',
  STANDARD = 'STANDARD'
}

/**
 * Metadata for a time series document in Firestore
 */
export interface TimeSeriesDocumentMetadata {
  /** First date in the historical data */
  histStartDate: Date | FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;

  /** Most recent date in the historical data */
  histEndDate: Date | FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;

  /** Number of historical data points */
  histDataPoints: number;

  /** Date of the first quote in the dataset */
  firstQuoteDate?: Date | FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;

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

export interface StandardMetadata extends BaseMetadata {
  endpoint: string;
  nextRefreshAt: any;
}

export interface BaseMetadata {
  symbol: string;
  lastUpdated: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  ttlSeconds: number;
}

export type DocumentMetadata = TimeSeriesDocumentMetadata | StandardMetadata;
