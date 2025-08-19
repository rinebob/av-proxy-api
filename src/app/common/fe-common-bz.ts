import { 
    BenzingaCalendarParameter,
    BenzingaRequestConfig,
    BZ_CALENDAR_REQUEST_CONFIGS,
    BzCalendarRequestType, 
    BzConferenceCallsData,
    BzDividendsData, 
    BzEarningsData, 
    BzEconomicsData,
    BzGuidanceData, 
    BzIposData, 
    BzMergersAcquisitionsData,
    BzNewsData, 
    BzRatingsData, 
    BzSplitsData, 
} from "@shared/benzinga";


export interface CalendarColumnConfig {
    key: string;
    displayName: string;
    format?: 'text' | 'number' | 'percent' | 'currency' | 'date' | 'abbreviateCurrency' | 'boolean' | 'array';
    currencySymbol?: string;
    digitsInfo?: string;
}

export interface BenzingaCalendarRequestMetadata {
    name: BzCalendarRequestType;
    config: BenzingaRequestConfig;
    displayName: string;
    title: string;
    columns: CalendarColumnConfig[];
}

//////////////////// ENDPOINT RESPONSE INTERFACES ////////////////////

// TODO: Update to match backend response shape - backend returns data in BenzingaApiResponse<T> wrapper
// with { ok, data, timestamp, error? } structure
export interface EarningsResponse {
    earnings: BzEarningsData[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

// TODO: Update to match backend response shape - backend returns data in BenzingaApiResponse<T> wrapper
// with { ok, data, timestamp, error? } structure
export interface DividendsApiResponse {
    dividends: BzDividendsData[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface BzIpoCalendarResponse {
    ipos: BzIposData[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface BzSplitsCalendarResponse {
    splits: BzSplitsData[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface BzGuidanceCalendarResponse {
    guidance: BzGuidanceData[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

/////////////// DISPLAYED COLUMNS METADATA ////////////////////

// === Column Metadata Arrays ===


export const bzEarningsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'period', displayName: 'Period', format: 'text' },
    { key: 'eps', displayName: 'EPS', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
    { key: 'eps_est', displayName: 'EPS Est', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
    { key: 'eps_prior', displayName: 'EPS Prior', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
    { key: 'eps_surprise', displayName: 'EPS Surprise', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
    { key: 'eps_surprise_percent', displayName: 'EPS Surprise %', format: 'percent', digitsInfo: '1.2-2' },
    { key: 'revenue', displayName: 'Revenue', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
    { key: 'revenue_est', displayName: 'Revenue Est', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
    { key: 'revenue_prior', displayName: 'Revenue Prior', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
    { key: 'revenue_surprise', displayName: 'Revenue Surprise', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
    { key: 'revenue_surprise_percent', displayName: 'Revenue Surprise %', format: 'percent', digitsInfo: '1.2-2' },
    { key: 'eps_type', displayName: 'EPS Type', format: 'text' },
    { key: 'notes', displayName: 'Notes', format: 'text' }
];


export const bzDividendsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'dividend', displayName: 'Dividend', format: 'currency', currencySymbol: '$', digitsInfo: '1.2-2' },
    { key: 'dividend_prior', displayName: 'Prior Dividend', format: 'currency', currencySymbol: '$', digitsInfo: '1.2-2' },
    { key: 'dividend_type', displayName: 'Type', format: 'text' },
    { key: 'dividend_yield', displayName: 'Yield', format: 'percent', digitsInfo: '1.2-2' },
    { key: 'ex_dividend_date', displayName: 'Ex Date', format: 'date' },
    { key: 'record_date', displayName: 'Record Date', format: 'date' },
    { key: 'payable_date', displayName: 'Payable Date', format: 'date' },
    { key: 'notes', displayName: 'Notes', format: 'text' }
];


export const bzEconomicsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'time', displayName: 'Time', format: 'text' },
    { key: 'event_name', displayName: 'Event', format: 'text' },
    { key: 'event_category', displayName: 'Category', format: 'text' },
    { key: 'prior', displayName: 'Prior', format: 'text' },
    // { key: 'prior_t', displayName: 'Prior Type', format: 'text' },
    { key: 'consensus', displayName: 'Consensus', format: 'text' },
    // { key: 'consensus_t', displayName: 'Consensus Type', format: 'text' },
    { key: 'actual', displayName: 'Actual', format: 'text' },
    // { key: 'actual_t', displayName: 'Actual Type', format: 'text' },
    { key: 'country', displayName: 'Country', format: 'text' },
    { key: 'description', displayName: 'Description', format: 'text' },
    { key: 'event_period', displayName: 'Period', format: 'text' },
    // { key: 'id', displayName: 'ID', format: 'text' },
    { key: 'importance', displayName: 'Importance', format: 'number' },
    // { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'period_year', displayName: 'Year', format: 'number' },
    // { key: 'updated', displayName: 'Updated', format: 'date' }
];


export const bzConferenceCallsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'id', displayName: 'ID', format: 'text' },
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'time', displayName: 'Time', format: 'text' },
    { key: 'start_time', displayName: 'Start Time', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'importance', displayName: 'Importance', format: 'number' },
    { key: 'webcast_url', displayName: 'Webcast', format: 'text' },
    { key: 'access_code', displayName: 'Access Code', format: 'text' },
    { key: 'reservation_num', displayName: 'Reservation #', format: 'text' },
    { key: 'phone_num', displayName: 'Phone #', format: 'text' },
    { key: 'international_num', displayName: 'International #', format: 'text' },
    { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'updated', displayName: 'Updated', format: 'number' }
    // All fields from the sample API response are now included. Add further fields if API adds more in the future
];


/**
 * Columns for Benzinga Ratings Calendar (API: /calendar/ratings)
 * Includes all relevant fields from the sample data object for completeness.
 */
export const bzRatingsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'id', displayName: 'ID', format: 'text' },
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'time', displayName: 'Time', format: 'text' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'analyst', displayName: 'Analyst', format: 'text' },
    { key: 'analyst_id', displayName: 'Analyst ID', format: 'text' },
    { key: 'analyst_name', displayName: 'Analyst Name', format: 'text' },
    { key: 'rating_current', displayName: 'Current Rating', format: 'text' },
    { key: 'rating_prior', displayName: 'Prior Rating', format: 'text' },
    { key: 'action_company', displayName: 'Action (Company)', format: 'text' },
    { key: 'action_pt', displayName: 'Action (PT)', format: 'text' },
    { key: 'pt_current', displayName: 'Current PT', format: 'number' },
    { key: 'pt_prior', displayName: 'Prior PT', format: 'number' },
    { key: 'pt_pct_change', displayName: 'PT % Change', format: 'percent', digitsInfo: '1.2-2' },
    { key: 'adjusted_pt_current', displayName: 'Adj. Current PT', format: 'number' },
    { key: 'adjusted_pt_prior', displayName: 'Adj. Prior PT', format: 'number' },
    { key: 'currency', displayName: 'Currency', format: 'text' },
    { key: 'importance', displayName: 'Importance', format: 'number' },
    { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'updated', displayName: 'Updated', format: 'number' },
    { key: 'url', displayName: 'URL', format: 'text' },
    { key: 'url_calendar', displayName: 'Calendar URL', format: 'text' },
    { key: 'url_news', displayName: 'News URL', format: 'text' }
];

export const bzIpoCalendarColumns: CalendarColumnConfig[] = [
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'time', displayName: 'Time', format: 'text' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'currency', displayName: 'Currency', format: 'text' },
    { key: 'price_min', displayName: 'Price Min', format: 'currency', currencySymbol: 'USD' },
    { key: 'price_max', displayName: 'Price Max', format: 'currency', currencySymbol: 'USD' },
    { key: 'price_public_offering', displayName: 'Offering Price', format: 'currency', currencySymbol: 'USD' },
    { key: 'price_open', displayName: 'Open Price', format: 'currency', currencySymbol: 'USD' },
    { key: 'offering_shares', displayName: 'Shares', format: 'number', digitsInfo: '1.0-0' },
    { key: 'offering_value', displayName: 'Offering Value', format: 'abbreviateCurrency', currencySymbol: 'USD' },
    { key: 'shares_outstanding', displayName: 'Outstanding Shares', format: 'number', digitsInfo: '1.0-0' },
    { key: 'deal_status', displayName: 'Status', format: 'text' },
    { key: 'ipo_type', displayName: 'Type', format: 'text' },
    { key: 'open_date_verified', displayName: 'Date Verified', format: 'boolean' },
    { key: 'pricing_date', displayName: 'Pricing Date', format: 'date' },
    { key: 'insider_lockup_date', displayName: 'Lockup Date', format: 'date' },
    { key: 'insider_lockup_days', displayName: 'Lockup Days', format: 'number' },
    { key: 'underwriter_quiet_expiration_date', displayName: 'Quiet Period End', format: 'date' },
    { key: 'underwriter_quiet_expiration_days', displayName: 'Quiet Days', format: 'number' },
    { key: 'lead_underwriters', displayName: 'Lead Underwriters', format: 'array' },
    { key: 'other_underwriters', displayName: 'Other Underwriters', format: 'array' },
    { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'updated', displayName: 'Last Updated', format: 'date' }
];

/**
 * Columns for Benzinga Guidance Calendar (API: /calendar/guidance)
 * Includes all relevant fields from the sample data object for completeness.
 */
export const bzGuidanceCalendarColumns: CalendarColumnConfig[] = [
    { key: 'id', displayName: 'ID', format: 'text' },
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'time', displayName: 'Time', format: 'text' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'period', displayName: 'Period', format: 'text' },
    { key: 'period_year', displayName: 'Year', format: 'number' },
    { key: 'importance', displayName: 'Importance', format: 'number' },
    { key: 'is_primary', displayName: 'Primary?', format: 'text' },
    { key: 'prelim', displayName: 'Prelim?', format: 'text' },
    { key: 'eps_type', displayName: 'EPS Type', format: 'text' },
    { key: 'currency', displayName: 'Currency', format: 'text' },
    { key: 'eps_guidance_est', displayName: 'EPS Est', format: 'number' },
    { key: 'eps_guidance_min', displayName: 'EPS Min', format: 'number' },
    { key: 'eps_guidance_max', displayName: 'EPS Max', format: 'number' },
    { key: 'eps_guidance_prior_min', displayName: 'EPS Prior Min', format: 'number' },
    { key: 'eps_guidance_prior_max', displayName: 'EPS Prior Max', format: 'number' },
    { key: 'revenue_guidance_est', displayName: 'Revenue Est', format: 'abbreviateCurrency' },
    { key: 'revenue_guidance_min', displayName: 'Revenue Min', format: 'abbreviateCurrency' },
    { key: 'revenue_guidance_max', displayName: 'Revenue Max', format: 'abbreviateCurrency' },
    { key: 'revenue_guidance_prior_min', displayName: 'Revenue Prior Min', format: 'abbreviateCurrency' },
    { key: 'revenue_guidance_prior_max', displayName: 'Revenue Prior Max', format: 'abbreviateCurrency' },
    { key: 'revenue_type', displayName: 'Revenue Type', format: 'text' },
    { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'updated', displayName: 'Updated', format: 'number' }
];

export const bzSplitsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'id', displayName: 'ID', format: 'text' },
    { key: 'date_announced', displayName: 'Announced', format: 'date' },
    { key: 'date_distribution', displayName: 'Distribution Date', format: 'date' },
    { key: 'date_ex', displayName: 'Ex Date', format: 'date' },
    { key: 'date_recorded', displayName: 'Record Date', format: 'date' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'split_type', displayName: 'Split Type', format: 'text' },
    { key: 'ratio', displayName: 'Ratio', format: 'text' },
    { key: 'optionable', displayName: 'Optionable', format: 'boolean' },
    { key: 'importance', displayName: 'Importance', format: 'number' },
    { key: 'notes', displayName: 'Notes', format: 'text' },
    { key: 'updated', displayName: 'Updated', format: 'number' }
];

/////////////// PARAMS METADATA //////////////////////

export enum BenzingaCalendarParam {
    RATINGS_ACTION = 'ratingsAction',
    START_DATE = 'startDate',
    END_DATE = 'endDate',
    TICKERS = 'tickers',
    PAGESIZE = 'pagesize',
    IMPORTANCE = 'importance',
    UPDATED = 'updated',
    DIVIDEND_YIELD_OPERATION = 'dividendYieldOperation',
    DIVIDEND_YIELD = 'dividendYield',
    DATE_SORT = 'dateSort',
    SORT = 'sort',
    COUNTRY = 'country',
    EVENT_CATEGORY = 'eventCategory',
    IPO_TYPE = 'ipoType',
    ACTION = 'action',
    ANALYST_ID = 'analystId',
    FIRM_ID = 'firmId',
    ANALYST = 'analyst',
    FIRM = 'firm',
    IS_PRIMARY = 'isPrimary',
    CHANNELS = 'channels',
    TOPICS = 'topics'
}

/////////////// ENDPOINT METADATA //////////// 

// === Endpoint Metadata Objects ===

const baseParams: BenzingaCalendarParameter[] = [
    BenzingaCalendarParameter.DATE_FROM,
    BenzingaCalendarParameter.DATE_TO,
    BenzingaCalendarParameter.PAGESIZE,
    BenzingaCalendarParameter.IMPORTANCE,
    BenzingaCalendarParameter.UPDATED,
];

const earningsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.EARNINGS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.EARNINGS],
    displayName: 'Earnings',
    title: 'Earnings Calendar',
    columns: bzEarningsCalendarColumns,
};

const dividendsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.DIVIDENDS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.DIVIDENDS],
    displayName: 'Dividends',
    title: 'Dividends Calendar',
    columns: bzDividendsCalendarColumns,
};

const economicsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.ECONOMICS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.ECONOMICS],
    displayName: 'Economics',
    title: 'Economics Calendar',
    columns: bzEconomicsCalendarColumns,
};

const iposMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.IPOS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.IPOS],
    displayName: 'IPOs',
    title: 'IPO Calendar',
    columns: bzIpoCalendarColumns,
};

/**
 * Columns for Benzinga Conference Calls Calendar (API: /calendar/conference-calls)
 * Includes all relevant fields from the sample data object for completeness.
 */

const conferenceCallsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.CONFERENCE_CALLS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.CONFERENCE_CALLS],
    displayName: 'Conference Calls',
    title: 'Conference Calls Calendar',
    columns: bzConferenceCallsCalendarColumns,
};

const ratingsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.RATINGS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.RATINGS],
    displayName: 'Ratings',
    title: 'Ratings Calendar',
    columns: bzRatingsCalendarColumns,
};

const guidanceMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.GUIDANCE,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.GUIDANCE],
    displayName: 'Guidance',
    title: 'Guidance Calendar',
    columns: bzGuidanceCalendarColumns,
};

const splitsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.SPLITS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.SPLITS],
    displayName: 'Splits',
    title: 'Splits Calendar',
    columns: bzSplitsCalendarColumns,
};

const mergersAcquisitionsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.MERGERS_ACQUISITIONS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.MERGERS_ACQUISITIONS],
    displayName: 'M&As',
    title: 'Mergers & Acquisitions Calendar',
    columns: []
};


const offeringsMeta: BenzingaCalendarRequestMetadata = {
    name: BzCalendarRequestType.OFFERINGS,
    config: BZ_CALENDAR_REQUEST_CONFIGS[BzCalendarRequestType.OFFERINGS],
    displayName: 'Offerings',
    title: 'Offerings Calendar',
    columns: []
};

//////////// ENDPOINT MAPS //////////// 

// === Master Endpoint Maps ===

export const BENZINGA_ENDPOINTS_META_MAP: Record<BzCalendarRequestType, BenzingaCalendarRequestMetadata> = {
    [BzCalendarRequestType.EARNINGS]: earningsMeta,
    [BzCalendarRequestType.DIVIDENDS]: dividendsMeta,
    [BzCalendarRequestType.ECONOMICS]: economicsMeta,
    [BzCalendarRequestType.IPOS]: iposMeta,
    [BzCalendarRequestType.CONFERENCE_CALLS]: conferenceCallsMeta,
    [BzCalendarRequestType.MERGERS_ACQUISITIONS]: mergersAcquisitionsMeta,
    [BzCalendarRequestType.RATINGS]: ratingsMeta,
    [BzCalendarRequestType.GUIDANCE]: guidanceMeta,
    [BzCalendarRequestType.SPLITS]: splitsMeta,
    [BzCalendarRequestType.OFFERINGS]: offeringsMeta
};

// === Master Response and Item Maps ===

// TODO: Update to use BenzingaApiResponse<T> from fe-common-bz-api.ts
// Backend returns data in format: { ok: boolean, data: T[], timestamp: string, error?: string }
export interface BZCalendarResponseMap {
    [BzCalendarRequestType.EARNINGS]: EarningsResponse;
    [BzCalendarRequestType.DIVIDENDS]: DividendsApiResponse;
    [BzCalendarRequestType.ECONOMICS]: any;
    [BzCalendarRequestType.IPOS]: BzIpoCalendarResponse;
    [BzCalendarRequestType.CONFERENCE_CALLS]: any;
    [BzCalendarRequestType.MERGERS_ACQUISITIONS]: any;
    [BzCalendarRequestType.RATINGS]: any;
    [BzCalendarRequestType.GUIDANCE]: BzGuidanceCalendarResponse;
    [BzCalendarRequestType.SPLITS]: BzSplitsCalendarResponse;
    [BzCalendarRequestType.OFFERINGS]: any;
}

// TODO: Update to match actual backend response structure where items are directly in the array
// without being wrapped in an object with a key matching the endpoint name
export interface BenzingaEndpointItemMap {
    [BzCalendarRequestType.EARNINGS]: BzEarningsData[];
    [BzCalendarRequestType.DIVIDENDS]: BzDividendsData[];
    [BzCalendarRequestType.ECONOMICS]: BzEconomicsData[];
    [BzCalendarRequestType.IPOS]: BzIposData[];
    [BzCalendarRequestType.CONFERENCE_CALLS]: BzConferenceCallsData[];
    [BzCalendarRequestType.MERGERS_ACQUISITIONS]: BzMergersAcquisitionsData[];
    [BzCalendarRequestType.RATINGS]: BzRatingsData[];
    [BzCalendarRequestType.GUIDANCE]: BzGuidanceData[];
    [BzCalendarRequestType.SPLITS]: BzSplitsData[];
    [BzCalendarRequestType.OFFERINGS]: any[];
}

