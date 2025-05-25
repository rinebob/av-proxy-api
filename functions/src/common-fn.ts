

/////////// INTERFACES ///////////////////////



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

// Define type for the overall TIME_SERIES_DAILY response
export interface AlphaVantageDailyTimeSeriesResponse {
    "Meta Data": TimeSeriesMetaData;
    "Time Series (Daily)"?: DailyTimeSeries; // For TIME_SERIES_DAILY
    "Time Series (Daily - Adjusted)"?: DailyTimeSeries; // For TIME_SERIES_DAILY_ADJUSTED
    "Information"?: string; // For API-level errors/info
    "Note"?: string;       // For rate limit messages
    // Add other potential top-level keys if Alpha Vantage uses them
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
    // You might add other potential top-level keys if Alpha Vantage uses them
}








//////////////////////////////////////

///////////// ENUMS /////////////////////

// Define an enum for Alpha Vantage API functions
// This helps provide type safety when specifying which function to call
export enum AlphaVantageFunction {
    // Time Series
    TIME_SERIES_DAILY = 'TIME_SERIES_DAILY',
    TIME_SERIES_DAILY_ADJUSTED = 'TIME_SERIES_DAILY_ADJUSTED',
    TIME_SERIES_WEEKLY = 'TIME_SERIES_WEEKLY',
    TIME_SERIES_WEEKLY_ADJUSTED = 'TIME_SERIES_WEEKLY_ADJUSTED',
    TIME_SERIES_MONTHLY = 'TIME_SERIES_MONTHLY',
    TIME_SERIES_MONTHLY_ADJUSTED = 'TIME_SERIES_MONTHLY_ADJUSTED',
    TIME_SERIES_INTRADAY = 'TIME_SERIES_INTRADAY', // Requires interval parameter

    // Quotes
    GLOBAL_QUOTE = 'GLOBAL_QUOTE', // This is the one you're using now

    // Fundamental Data
    OVERVIEW = 'OVERVIEW',
    INCOME_STATEMENT = 'INCOME_STATEMENT',
    BALANCE_SHEET = 'BALANCE_SHEET',
    CASH_FLOW = 'CASH_FLOW',
    EARNINGS = 'EARNINGS',
    // ... add other Fundamental Data functions you might use

    // Technical Indicators (Examples - many more exist)
    SMA = 'SMA', // Simple Moving Average (requires interval, time_period, series_type)
    EMA = 'EMA', // Exponential Moving Average (requires interval, time_period, series_type)
    MACD = 'MACD', // Moving Average Convergence Divergence (requires interval, series_type)
    // ... add other Technical Indicators you might use

    // FX (Forex)
    CURRENCY_EXCHANGE_RATE = 'CURRENCY_EXCHANGE_RATE', // Requires from_currency, to_currency

    // Cryptocurrencies
    DIGITAL_CURRENCY_DAILY = 'DIGITAL_CURRENCY_DAILY', // Requires symbol, market
    // ... add other Crypto functions

    // Economic Indicators (Examples - many more exist)
    CPI = 'CPI', // Consumer Price Index (requires interval)
    INFLATION = 'INFLATION', // Inflation (requires interval)
    // ... add other Economic Indicators you might use

    // ... Add any other Alpha Vantage functions you plan to use
}

//////////////////////////////////////

////////////// CONSTANTS /////////////////////

export const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
export const CACHE_DURATION_MS = 1000 * 60 * 30; // Cache for 30 minutes

export const RATE_LIMIT_WINDOW_MS = 1000 * 60; // 1 minute
export const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute




////////////////////////////////////////////////