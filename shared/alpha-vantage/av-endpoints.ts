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
  
    // ===== Options Data =====
    HISTORICAL_OPTIONS = 'HISTORICAL_OPTIONS',
  
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
    // Add technical indicators here as needed
    // SMA = 'SMA',
    // EMA = 'EMA',
    // RSI = 'RSI'
}

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
 * Subset of endpoints that are currently implemented in the backend handler factory
 * Extend this set as additional handlers are implemented.
 */
export const AV_IMPLEMENTED_ENDPOINTS: Set<AlphaVantageEndpoint> = new Set<AlphaVantageEndpoint>([
    AlphaVantageEndpoint.OVERVIEW,
    AlphaVantageEndpoint.HISTORICAL_OPTIONS,
    // Prefer adjusted time series by default
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    AlphaVantageEndpoint.GLOBAL_QUOTE,
]);