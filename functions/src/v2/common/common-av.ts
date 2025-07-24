import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { DataMaintainerEndpoint, TrackedSymbol, TrackedSymbolMetadata } from './common-dm';
import { TimeSeriesInterval } from './common-fn';

/////////// ENUMS ///////////////////////
// Define output size options for API responses
export enum OutputSize {
  COMPACT = 'compact',
  FULL = 'full'
}

/////////// INTERFACES ///////////////////////

// Extended data point that includes calculated fields from Global Quote
export interface StockDataPoint {
    // Core data from Time Series
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
    "5. volume": string;
    // Calculated fields (same as Global Quote)
    "09. change"?: string;
    "10. change percent"?: string;
    "08. previous close"?: string;
}

// TIME_SERIES_DAILY / TIME_SERIES_DAILY_ADJUSTED
// Define types for the data of a single day in the time series
export interface DailyTimeSeriesData {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
    "5. volume": string;
    // These are specific to TIME_SERIES_DAILY_ADJUSTED
    "5. adjusted close"?: string;
    "6. volume"?: string; // Volume is repeated but documented with different keys sometimes
    "7. dividend amount"?: string;
    "8. split coefficient"?: string;
    // Calculated fields
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

// GLOBAL_QUOTE
// Define types for the expected Alpha Vantage GLOBAL_QUOTE response data
export interface GlobalQuoteData {
    "01. symbol": string;
    "02. open": string;
    "03. high": string;
    "04. low": string;
    "05. price": string;
    "06. volume": string;
    "07. latest trading day": string;
    "08. previous close": string;
    "09. change": string;
    "10. change percent": string;
    // Add other expected fields from the GLOBAL_QUOTE response if necessary
}

export interface AlphaVantageGlobalQuoteResponse {
    "Global Quote"?: GlobalQuoteData; // Optional because it might be an error response
    "Information"?: string; // For API-level errors/info
    "Note"?: string;       // For rate limit messages
    "Error Message"?: string; // For API-level errors
}

// Interface for the data structure stored in Firestore.
export interface StoredStockData {
  metaData: TimeSeriesMetaDataTwo;
  timeSeriesDaily?: DailyTimeSeriesDataTwo[];
  timeSeriesDailyAdjusted?: DailyTimeSeriesDataTwo[];
  information?: string;
  note?: string;
  errorMessage?: string; // For API-level errors
  lastUpdated: Timestamp | FieldValue;
}

// Define an enum for Alpha Vantage API endpoints
// This helps provide type safety when specifying which endpoint to call
export enum AlphaVantageEndpoint {
  // ===== Time Series Data =====
  TIME_SERIES_DAILY = 'TIME_SERIES_DAILY',
  TIME_SERIES_DAILY_ADJUSTED = 'TIME_SERIES_DAILY_ADJUSTED',
  TIME_SERIES_WEEKLY = 'TIME_SERIES_WEEKLY',
  TIME_SERIES_WEEKLY_ADJUSTED = 'TIME_SERIES_WEEKLY_ADJUSTED',
  TIME_SERIES_MONTHLY = 'TIME_SERIES_MONTHLY',
  TIME_SERIES_MONTHLY_ADJUSTED = 'TIME_SERIES_MONTHLY_ADJUSTED',
  TIME_SERIES_INTRADAY = 'TIME_SERIES_INTRADAY',
  TIME_SERIES_INTRADAY_ADJUSTED = 'TIME_SERIES_INTRADAY_ADJUSTED',
  
  // ===== Quotes =====
  GLOBAL_QUOTE = 'GLOBAL_QUOTE',
  REALTIME_BULK_QUOTES = 'REALTIME_BULK_QUOTES',

  // ===== Search =====
  SYMBOL_SEARCH = 'SYMBOL_SEARCH',

  // ===== Alpha Intelligence =====
  NEWS_SENTIMENTS = 'NEWS_SENTIMENTS',
  EARNINGS_CALL_TRANSCRIPT = 'EARNINGS_CALL_TRANSCRIPT',
  TOP_GAINERS_LOSERS = 'TOP_GAINERS_LOSERS',
  INSIDER_TRANSACTIONS = 'INSIDER_TRANSACTIONS',
  ALYTICS_FIXED_WINDOW = 'ALYTICS_FIXED_WINDOW',
  ALYTICS_SLIDING_WINDOW = 'ALYTICS_SLIDING_WINDOW',
  
  // ===== Fundamental Data =====
  OVERVIEW = 'OVERVIEW',
  ETF_PROFILE = 'ETF_PROFILE',
  CORPORATE_ACTION_DIVIDENDS = 'CORPORATE_ACTION_DIVIDENDS',
  CORPORATE_ACTION_SPLITS = 'CORPORATE_ACTION_SPLITS',
  INCOME_STATEMENT = 'INCOME_STATEMENT',
  BALANCE_SHEET = 'BALANCE_SHEET',
  CASH_FLOW = 'CASH_FLOW',
  EARNINGS = 'EARNINGS',
  LISTING_DELISTING_STATUS = 'LISTING_DELISTING_STATUS',
  EARNINGS_CALENDAR = 'EARNINGS_CALENDAR',
  IPO_CALENDAR = 'IPO_CALENDAR',
    
  // ===== Economic Indicators =====
  REAL_GDP = 'REAL_GDP',
  REAL_GDP_PER_CAPITA = 'REAL_GDP_PER_CAPITA',
  TREASURY_YIELD = 'TREASURY_YIELD',
  FEDERAL_FUNDS_RATE = 'FEDERAL_FUNDS_RATE',
  CPI = 'CPI',
  INFLATION = 'INFLATION',
  RETAIL_SALES = 'RETAIL_SALES',
  DURABLE_GOODS_ORDERS = 'DURABLE_GOODS_ORDERS',
  UNEMPLOYMENT_RATE = 'UNEMPLOYMENT_RATE',
  NONFARM_PAYROLL = 'NONFARM_PAYROLL',

  // ===== Technical Indicators =====
  // Note: Add technical indicators here as needed
  // SMA = 'SMA',
  // EMA = 'EMA',
  // RSI = 'RSI'
}

/**
 * Alpha Vantage specific endpoint categories
 * Used to categorize different types of Alpha Vantage API endpoints.
 * These are their own categories for their endpoints.  
 * Not all of their categories are represented here.
 * https://www.alphavantage.co/documentation/
 */
export enum AvEndpointCategory {
    /** Time series data (daily, weekly, monthly, etc.) */
    TIME_SERIES = 'time-series',
    
    /** Options data */
    OPTIONS_DATA = 'options-data',
    
    /** Alpha Intelligence data (news, sentiment, etc.) */
    ALPHA_INTELLIGENCE = 'alpha-intelligence',
    
    /** Fundamental company data (balance sheets, income statements, etc.) */
    FUNDAMENTAL_DATA = 'fundamental-data',
    
    /** Real-time and delayed quotes */
    QUOTES = 'quotes',
    
    /** Economic indicators and metrics */
    ECONOMIC_INDICATORS = 'economic-indicators',
    
    /** Symbol search */
    SEARCH = 'search'
  }

/**
 * Set of endpoints that have been implemented and are ready for automatic refresh.
 * Add endpoints to this set as they are implemented.
 */
export const AV_IMPLEMENTED_ENDPOINTS: Set<AlphaVantageEndpoint> = new Set([
  // AlphaVantageEndpoint.TIME_SERIES_DAILY,
  // AlphaVantageEndpoint.GLOBAL_QUOTE,
  AlphaVantageEndpoint.OVERVIEW,
  // Add other endpoints here as they are implemented
]);

// Generic parameter interface for Alpha Vantage API calls
export interface AlphaVantageParams {
  endpoint: AlphaVantageEndpoint;
  symbol: string;
  outputsize: OutputSize;
}

/**
 * Alpha Vantage Company Overview types
 */

export interface AvCompanyOverview {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  OfficialSite: string;
  FiscalYearEnd: string;
  LatestQuarter: string;
  MarketCapitalization: string;
  EBITDA: string;
  PERatio: string;
  PEGRatio: string;
  BookValue: string;
  DividendPerShare: string;
  DividendYield: string;
  EPS: string;
  RevenuePerShareTTM: string;
  ProfitMargin: string;
  OperatingMarginTTM: string;
  ReturnOnAssetsTTM: string;
  ReturnOnEquityTTM: string;
  RevenueTTM: string;
  GrossProfitTTM: string;
  DilutedEPSTTM: string;
  QuarterlyEarningsGrowthYOY: string;
  QuarterlyRevenueGrowthYOY: string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
  TrailingPE: string;
  ForwardPE: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToRevenue: string;
  EVToEBITDA: string;
  Beta: string;
  '52WeekHigh': string;
  '52WeekLow': string;
  '50DayMovingAverage': string;
  '200DayMovingAverage': string;
  SharesOutstanding: string;
  SharesFloat: string;
  PercentInsiders: string;
  PercentInstitutions: string;
  DividendDate: string;
  ExDividendDate: string;
}

export interface AvCompanyOverviewResponse {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: AvCompanyOverview;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

export interface CheckMockDataRequest {
  symbol: string;
  endpoint: DataMaintainerEndpoint;
}

export interface CheckMockDataResponse {
  hasMockData: boolean;
  endpoint: DataMaintainerEndpoint;
  symbol: string;
  availableEndpoints?: string[];
  availableSymbols?: string[];
  error?: string;
}

export const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
export const CACHE_DURATION_MS = 1000 * 60 * 30; // Cache for 30 minutes

export const RATE_LIMIT_WINDOW_MS = 1000 * 60; // 1 minute
export const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute

// Interface for authentication and validation result
export interface AuthValidationResult {
    decodedToken: any; // Consider using a more specific type if available
    params: QueryParams;
    apiKey: string;
}

// Interface for query parameters
export interface QueryParams {
    symbol: string;
    outputSize: OutputSize;
}

/**
 * Represents a single symbol match from Alpha Vantage SYMBOL_SEARCH endpoint
 */
export interface AlphaVantageSymbolMatch {
    '1. symbol': string;
    '2. name': string;
    '3. type': string;
    '4. region': string;
    '5. marketOpen': string;
    '6. marketClose': string;
    '7. timezone': string;
    '8. currency': string;
    '9. matchScore': string;
}

/**
 * Response format for Alpha Vantage SYMBOL_SEARCH endpoint
 */
export interface AlphaVantageSymbolSearchResponse {
    bestMatches: AlphaVantageSymbolMatch[];
}

/**
 * Represents a single symbol match from Alpha Vantage SYMBOL_SEARCH endpoint
 */
export interface SvtAvSymbolMatch {
    symbol: string;
    name: string;
    type: string;
    region: string;
    marketOpen: string;
    marketClose: string;
    timezone: string;
    currency: string;
    matchScore: string;
}

/**
 * Transformed symbol data that's saved to Firestore
 * This is a cleaned-up version of AlphaVantageSymbolMatch without numbered prefixes
 */
export interface SymbolData {
    symbol: string;
    name: string;
    type: string;
    region: string;
    marketOpen: string;
    marketClose: string;
    timezone: string;
    currency: string;
    matchScore: string;
    isActive: boolean;
    refreshEnabled: boolean;
    createdAt: Date;
    lastUpdated: Date;
}

/**
 * Document shape for a AV non-time series document in Firestore
 */
export interface StoredAvData {
  data: any;
  metadata: {
    symbol: string;
    endpoint: AlphaVantageEndpoint;
    lastUpdated: FirebaseFirestore.FieldValue;
    nextRefreshAt: FirebaseFirestore.Timestamp;
    ttlSeconds: number;
  };
}

export interface SymbolMetadata {
  symbol: string;
  endpoints: AlphaVantageEndpoint[]; // List of endpoints that have data for this symbol
  lastUpdatedBy: AlphaVantageEndpoint; // Track which endpoint last updated this symbol
  lastUpdatedAt: FirebaseFirestore.FieldValue; // When this symbol was last updated
  nextRefreshAt: FirebaseFirestore.Timestamp; // When this symbol should be refreshed
  nextRefreshedBy: AlphaVantageEndpoint; // Which endpoint will handle the next refresh
  ttlSeconds: number;
}

/**
 * Metadata for a time series document in Firestore
 */
export interface TimeSeriesDocumentMetadata {
  /** First date in the historical data */
  histStartDate: Date | Timestamp | FieldValue;
  
  /** Most recent date in the historical data */
  histEndDate: Date | Timestamp | FieldValue;
  
  /** Number of historical data points */
  histDataPoints: number;
  
  /** Date of the first quote in the dataset */
  firstQuoteDate: Date | Timestamp | FieldValue;
  
  /** When this document was last updated */
  lastUpdate: Date | Timestamp | FieldValue;
  
  /** When this document should be refreshed */
  nextRefreshAt: Date | Timestamp | FieldValue;
  
  /** Number of quote data points */
  quoteDataPoints: number;
  
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
}

/** Document type discriminator */
export enum DocumentType {
  TIME_SERIES = 'TIME_SERIES',
  STANDARD = 'STANDARD'
}

/** Base metadata interface */
interface BaseMetadata {
  symbol: string;
  lastUpdated: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  ttlSeconds: number;
}

/** Standard metadata for non-time series documents */
export interface StandardMetadata extends BaseMetadata {
  endpoint: AlphaVantageEndpoint;
  nextRefreshAt: FirebaseFirestore.Timestamp;
}

/** Union type for all possible metadata */
export type DocumentMetadata = TimeSeriesDocumentMetadata | StandardMetadata;

/** Configuration for saving data */
export interface SaveConfig {
  firestorePath?: string;
  documentType?: DocumentType;
  ttlSeconds?: number;
  interval?: TimeSeriesInterval;
}

export interface SaveTrackedSymbolResponse {
  success: boolean;
  symbol: string;
  message?: string;
  error?: string;
}

export interface TrackedSymbolDocument {
  data: TrackedSymbol;
  metadata: TrackedSymbolMetadata;
}