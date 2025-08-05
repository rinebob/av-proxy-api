
export enum FirestoreCollection {

    // Top-level Collections
    TRACKED_SYMBOLS = "tracked-symbols",
    SYMBOL_DATA = "symbol-data",
    MARKET_DATA = "market-data",
    ECONOMICS = 'economics',
    NEWS = 'news',
    SYSTEM_INFO = 'system-info',

    // For feature control
    CONFIG = 'config',

    // Deprecated
    TIME_SERIES = 'time-series',

    // LEGACY - refactor to use above core collections
    ECONOMIC_INDICATORS = "economic-indicators",
    // DATA_POINTS = "data-points",

    // Refresh Tracking - now deprecated
    REFRESH_EVENTS = "refresh-events",
    REFRESH_HISTORY = "refresh-history",

    //////// ALPHA VANTAGE APIS USED AS COLLECTION NAMES ///////////////////
    // Time series data
    INTRADAY = 'intraday',
    DAILY = 'daily',
    DAILY_ADJUSTED = 'daily-adjusted',
    WEEKLY = 'weekly',
    WEEKLY_ADJUSTED = 'weekly-adjusted',
    MONTHLY = 'monthly',
    MONTHLY_ADJUSTED = 'monthly-adjusted',

    // AlphaIntelligence Collections
    // Will be under company-data
    NEWS_SENTIMENTS = 'news-sentiments',
    EARNINGS_CALL_TRANSCRIPT = 'earnings-call-transcript',
    INSIDER_TRANSACTIONS = 'insider-transactions',
    ALYTICS_FIXED_WINDOW = 'analytics-fixed-window',
    ALYTICS_SLIDING_WINDOW = 'analytics-sliding-window',
    // Will be under market data
    TOP_GAINERS_LOSERS = 'top-gainers-losers',

    // Fundamental data
    // Will be under company-data
    COMPANY_OVERVIEW = 'company-overview',
    ETF_PROFILE_HOLDINGS = 'etf-profile-holdings',
    CORPORATE_ACTION_DIVIDENDS = 'corporate-action-dividends',
    CORPORATE_ACTION_SPLITS = 'corporate-action-splits',
    INCOME_STATEMENT = 'income-statement',
    BALANCE_SHEET = 'balance-sheet',
    CASH_FLOW = 'cash-flow',
    EARNINGS = 'earnings',
    LISTING_DELISTING_STATUS = 'listing-delisting-status',
    EARNINGS_CALENDAR = 'earnings-calendar',
    IPO_CALENDAR = 'ipo-calendar',

    // Economic Indicators
    // Will be under economic-indicators
    REAL_GDP = 'real-gdp',
    REAL_GDP_PER_CAPITA = 'real-gdp-per-capita',
    TREASURY_YIELD = 'treasury-yield',
    FEDERAL_FUNDS_RATE = 'federal-funds-rate',
    CPI = 'cpi',
    INFLATION = 'inflation',
    RETAIL_SALES = 'retail-sales',
    DURABLE_GOODS_ORDERS = 'durable-goods-orders',
    UNEMPLOYMENT_RATE = 'unemployment-rate',
    NONFARM_PAYROLL = 'nonfarm-payroll',

    ///////////// END ALPHA VANTAGE ///////////////

    /////////////////// BENZINGA ///////////////////

    BENZINGA = 'benzinga',

    DIVIDENDS = 'dividends',
    CONFERENCE_CALLS = 'conference-calls',
    RATINGS = 'ratings',
    GUIDANCE = 'guidance',
    SPLITS = 'splits',
    OFFERINGS = 'offerings',

    ECONOMIC_CALENDAR = 'economic-calendar',
    IPOS = 'ipos',
    FDA = 'fda',
    MERGERS_ACQUISITIONS = 'mergers-acquisitions',

    // Why Is It Moving?
    WIIM = 'wiim',
    METADATA = '_metadata',

    /////////////////// END BENZINGA ///////////////////

    // For disabling / not implementing an endpoint
    DISABLED = 'disabled',
    DO_NOT_IMPLEMENT = 'do-not-implement',

    /////////////// END COPY REGION ///////////////////////////
}