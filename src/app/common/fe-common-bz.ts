// fe-common-bz.ts
// Renamed from common-bz.ts for frontend distinctness. See commit history for original authorship and history.

//////////////////// ENUMS ////////////////////
// === 1. Enums ===

export enum BenzingaEndpoint {
    EARNINGS = 'earnings',
    DIVIDENDS = 'dividends',
    ECONOMICS = 'economics',
    IPOS = 'ipos',
    CONFERENCE_CALLS = 'conference-calls',
    FDA = 'fda',
    MERGERS_ACQUISITIONS = 'mergers-acquisitions',
    RATINGS = 'ratings',
    GUIDANCE = 'guidance',
    SPLITS = 'splits',
    OFFERINGS = 'offerings'
}

//////////////////////////////////////////////////

//////////////////// TYPES & INTERFACES ////////////////////
// === 2. Shared Types & Interfaces ===

export interface CalendarColumnConfig {
    key: string;
    displayName: string;
    format?: 'text' | 'number' | 'percent' | 'currency' | 'date' | 'abbreviateCurrency' | 'boolean' | 'array';
    currencySymbol?: string;
    digitsInfo?: string;
}

export interface BenzingaEndpointParamMeta {
    formKey: string;
    apiKey: string;
}

export interface BenzingaEndpointMetadata {
    name: BenzingaEndpoint;
    url: string; // Only the leaf, e.g. 'earnings'
    displayName: string;
    title: string;
    columns: CalendarColumnConfig[];
    params: BenzingaCalendarParam[];
    /**
     * Ordered list of form fields (from BenzingaCalendarParamFormField) to render in the UI for this endpoint.
     */
    // formFields: BenzingaCalendarParamFormField[];
    /**
     * The key used in the API response to access the items array.
     * If not provided, defaults to the endpoint name in lowercase.
     * Example: For Economics endpoint, responseKey would be 'economic'.
     */
    responseKey?: string;
}

export interface BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint;
    tickers?: string | string[];
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
}

//////////////////// ENDPOINT RESPONSE INTERFACES ////////////////////


// === Earnings Endpoint Types ===
export interface EarningsItem {
    exchange: string;
    name: string;
    period: string;
    eps_est: number | null;
    eps_act: number | null;
    eps_surprise: number | null;
    eps_surprise_percent: number | null;
    revenue_est: number | null;
    revenue_act: number | null;
    revenue_surprise: number | null;
    revenue_surprise_percent: number | null;
    updated: string;
    currency: string;
    importance: number;
    notes: string | null;
}

export interface EarningsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.EARNINGS;
    // Add earnings-specific filters if needed
}

export interface EarningsResponse {
    earnings: EarningsItem[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface DividendItem {
    id: string;
    ticker: string;
    name: string;
    exchange: string;
    date: string; // ISO date string
    ex_dividend_date: string; // ISO date string
    record_date: string; // ISO date string
    payable_date: string; // ISO date string
    dividend: string;
    dividend_prior: string;
    dividend_type: string;
    dividend_yield: string;
    end_regular_dividend: boolean;
    frequency: number;
    importance: number;
    currency: string;
    notes: string;
    updated: number; // Unix timestamp
}

export interface DividendsApiResponse {
    dividends: DividendItem[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface DividendsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.DIVIDENDS;
    ticker?: string;
    pagesize?: number;
    importance?: number;
    updated?: number;
    dividend_yield_operation?: 'gt' | 'gte' | 'eq' | 'lt' | 'lte';
    dividend_yield?: number;
    date_sort?: 'announced' | 'ex' | 'payable' | 'record';
    sort?: string;
}

// === IPOs Endpoint Types ===

export interface BzIpoCalendarEntry {
    id: string;
    date: string;
    time: string;
    ticker: string;
    exchange: string;
    name: string;
    open_date_verified: boolean;
    pricing_date: string;
    currency: string;
    price_min: string;
    price_max: string;
    price_public_offering: string;
    price_open: string;
    deal_status: string;
    ipo_type: string;
    insider_lockup_days: number;
    insider_lockup_date: string;
    offering_value: number;
    offering_shares: number;
    shares_outstanding: number;
    lead_underwriters: string[];
    other_underwriters: string[];
    underwriter_quiet_expiration_days: number;
    underwriter_quiet_expiration_date: string;
    notes: string;
    updated: number;
}

export interface BzIpoCalendarResponse {
    ipos: BzIpoCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface IposCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.IPOS;
    // Add IPO-specific filters if needed
}

// === Splits Endpoint Types ===

export interface BzSplitCalendarEntry {
    symbol: string;
    company_name: string;
    split_date: string;
    split_ratio: string;
    announcement_date: string;
    ex_date: string;
    record_date: string;
    payment_date: string;
    notes: string;
    updated: number;
}

export interface BzSplitsCalendarResponse {
    splits: BzSplitCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface SplitsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.SPLITS;
    // Add splits-specific filters if needed
}

// === Guidance Endpoint Types ===

export interface BzGuidanceCalendarEntry {
    symbol: string;
    company_name: string;
    guidance_date: string;
    fiscal_period: string;
    guidance_type: string;
    guidance_value: string;
    guidance_range_min: string;
    guidance_range_max: string;
    currency: string;
    notes: string;
    updated: number;
}

export interface BzGuidanceCalendarResponse {
    guidance: BzGuidanceCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
}

export interface GuidanceCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.GUIDANCE;
    // Add guidance-specific filters if needed
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
    IS_PRIMARY = 'isPrimary'
}

export enum BenzingaCalendarParamApiKey {
    RATINGS_ACTION = 'ratings_action',
    START_DATE = 'start_date',
    END_DATE = 'end_date',
    TICKERS = 'tickers',
    PAGESIZE = 'pagesize',
    IMPORTANCE = 'importance',
    UPDATED = 'updated',
    DIVIDEND_YIELD_OPERATION = 'dividend_yield_operation',
    DIVIDEND_YIELD = 'dividend_yield',
    DATE_SORT = 'date_sort',
    SORT = 'sort',
    COUNTRY = 'country',
    EVENT_CATEGORY = 'event_category',
    IPO_TYPE = 'ipo_type',
    ACTION = 'action',
    ANALYST_ID = 'analyst_id',
    FIRM_ID = 'firm_id',
    ANALYST = 'analyst',
    FIRM = 'firm',
    IS_PRIMARY = 'is_primary'
}

export enum BenzingaCalendarParamFormField {
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
    IS_PRIMARY = 'isPrimary'
}

export interface BenzingaCalendarParamMetadata {
    apiKey: BenzingaCalendarParamApiKey;
    formControlName: BenzingaCalendarParamFormField;
    type: 'text' | 'number' | 'date' | 'select';
    label: string;
    placeholder?: string;
    min?: number;
    max?: number;
    options?: Array<{ value: string | number, label: string }>;
}

//////////// FORM FIELDS ENUM & METADATA //////////// 

// === Form Field Enum and Metadata ===



export const START_DATE_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.START_DATE,
    formControlName: BenzingaCalendarParamFormField.START_DATE,
    type: 'date',
    label: 'Start Date'
};

export const END_DATE_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.END_DATE,
    formControlName: BenzingaCalendarParamFormField.END_DATE,
    type: 'date',
    label: 'End Date'
};

export const TICKERS_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.TICKERS,
    formControlName: BenzingaCalendarParamFormField.TICKERS,
    type: 'text',
    label: 'Ticker Symbol',
    placeholder: 'e.g. NVDA'
};

export const DIVIDEND_YIELD_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.DIVIDEND_YIELD,
    formControlName: BenzingaCalendarParamFormField.DIVIDEND_YIELD,
    type: 'number',
    label: 'Yield',
    min: 0,
    placeholder: '%'
};

export const DATE_SORT_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.DATE_SORT,
    formControlName: BenzingaCalendarParamFormField.DATE_SORT,
    type: 'select',
    label: 'Date Sort',
    options: [
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' }
    ]
};

export const PAGESIZE_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.PAGESIZE,
    formControlName: BenzingaCalendarParamFormField.PAGESIZE,
    type: 'number',
    label: 'Page Size',
    min: 1,
    max: 1000,
    placeholder: 'e.g. 20'
};

export const IMPORTANCE_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.IMPORTANCE,
    formControlName: BenzingaCalendarParamFormField.IMPORTANCE,
    type: 'number',
    label: 'Importance',
    min: 0,
    max: 5,
    placeholder: '0-5'
};

export const UPDATED_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.UPDATED,
    formControlName: BenzingaCalendarParamFormField.UPDATED,
    type: 'number',
    label: 'Updated (Unix Timestamp)',
    placeholder: 'e.g. 1710000000'
};

export const DIVIDEND_YIELD_OPERATION_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.DIVIDEND_YIELD_OPERATION,
    formControlName: BenzingaCalendarParamFormField.DIVIDEND_YIELD_OPERATION,
    type: 'select',
    label: 'Yield Operation',
    options: [
        { value: 'gt', label: '>' },
        { value: 'gte', label: '\u2265' },
        { value: 'eq', label: '=' },
        { value: 'lt', label: '<' },
        { value: 'lte', label: '\u2264' }
    ]
};



export const RATINGS_ACTION_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.RATINGS_ACTION,
    formControlName: BenzingaCalendarParamFormField.RATINGS_ACTION,
    type: 'select',
    label: 'Action',
    options: [
        { value: 'Downgrades', label: 'Downgrades' },
        { value: 'Maintains', label: 'Maintains' },
        { value: 'Reinstates', label: 'Reinstates' },
        { value: 'Reiterates', label: 'Reiterates' },
        { value: 'Upgrades', label: 'Upgrades' },
        { value: 'Assumes', label: 'Assumes' },
        { value: 'Initiates Coverage On', label: 'Initiates Coverage On' },
        { value: 'Terminates Coverage On', label: 'Terminates Coverage On' },
        { value: 'Removes', label: 'Removes' },
        { value: 'Suspends', label: 'Suspends' },
        { value: 'Firm Dissolved', label: 'Firm Dissolved' }
    ]
};

export const COUNTRY_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.COUNTRY,
    formControlName: BenzingaCalendarParamFormField.COUNTRY,
    type: 'text',
    label: 'Country',
    placeholder: 'e.g. US'
};

export const EVENT_CATEGORY_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.EVENT_CATEGORY,
    formControlName: BenzingaCalendarParamFormField.EVENT_CATEGORY,
    type: 'text',
    label: 'Event Category',
    placeholder: 'e.g. Employment'
};

export const IPO_TYPE_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.IPO_TYPE,
    formControlName: BenzingaCalendarParamFormField.IPO_TYPE,
    type: 'text',
    label: 'IPO Type',
    placeholder: 'e.g. Traditional'
};

export const ACTION_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.ACTION,
    formControlName: BenzingaCalendarParamFormField.ACTION,
    type: 'text',
    label: 'Action',
    placeholder: ''
};

export const ANALYST_ID_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.ANALYST_ID,
    formControlName: BenzingaCalendarParamFormField.ANALYST_ID,
    type: 'text',
    label: 'Analyst ID',
    placeholder: ''
};

export const FIRM_ID_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.FIRM_ID,
    formControlName: BenzingaCalendarParamFormField.FIRM_ID,
    type: 'text',
    label: 'Firm ID',
    placeholder: ''
};

export const ANALYST_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.ANALYST,
    formControlName: BenzingaCalendarParamFormField.ANALYST,
    type: 'text',
    label: 'Analyst',
    placeholder: ''
};

export const FIRM_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.FIRM,
    formControlName: BenzingaCalendarParamFormField.FIRM,
    type: 'text',
    label: 'Firm',
    placeholder: ''
};

export const IS_PRIMARY_PARAM_META: BenzingaCalendarParamMetadata = {
    apiKey: BenzingaCalendarParamApiKey.IS_PRIMARY,
    formControlName: BenzingaCalendarParamFormField.IS_PRIMARY,
    type: 'select',
    label: 'Is Primary',
    options: [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' }
    ]
};

export const BENZINGA_PARAM_META_MAP: Record<BenzingaCalendarParam, BenzingaCalendarParamMetadata> = {
    [BenzingaCalendarParam.RATINGS_ACTION]: RATINGS_ACTION_PARAM_META,
    [BenzingaCalendarParam.START_DATE]: START_DATE_PARAM_META,
    [BenzingaCalendarParam.END_DATE]: END_DATE_PARAM_META,
    [BenzingaCalendarParam.TICKERS]: TICKERS_PARAM_META,
    [BenzingaCalendarParam.PAGESIZE]: PAGESIZE_PARAM_META,
    [BenzingaCalendarParam.IMPORTANCE]: IMPORTANCE_PARAM_META,
    [BenzingaCalendarParam.UPDATED]: UPDATED_PARAM_META,
    [BenzingaCalendarParam.DIVIDEND_YIELD_OPERATION]: DIVIDEND_YIELD_OPERATION_PARAM_META,
    [BenzingaCalendarParam.DIVIDEND_YIELD]: DIVIDEND_YIELD_PARAM_META,
    [BenzingaCalendarParam.DATE_SORT]: DATE_SORT_PARAM_META,
    [BenzingaCalendarParam.SORT]: DATE_SORT_PARAM_META,
    [BenzingaCalendarParam.COUNTRY]: COUNTRY_PARAM_META,
    [BenzingaCalendarParam.EVENT_CATEGORY]: EVENT_CATEGORY_PARAM_META,
    [BenzingaCalendarParam.IPO_TYPE]: IPO_TYPE_PARAM_META,
    [BenzingaCalendarParam.ACTION]: ACTION_PARAM_META,
    [BenzingaCalendarParam.ANALYST_ID]: ANALYST_ID_PARAM_META,
    [BenzingaCalendarParam.FIRM_ID]: FIRM_ID_PARAM_META,
    [BenzingaCalendarParam.ANALYST]: ANALYST_PARAM_META,
    [BenzingaCalendarParam.FIRM]: FIRM_PARAM_META,
    [BenzingaCalendarParam.IS_PRIMARY]: IS_PRIMARY_PARAM_META
};

//////////// ENDPOINT METADATA //////////// 

// === Endpoint Metadata Objects ===

const baseParams: BenzingaCalendarParam[] = [
    BenzingaCalendarParam.START_DATE,
    BenzingaCalendarParam.END_DATE,
    BenzingaCalendarParam.PAGESIZE,
    BenzingaCalendarParam.IMPORTANCE,
    BenzingaCalendarParam.UPDATED,
];

const earningsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.EARNINGS,
    url: 'earnings',
    displayName: 'Earnings',
    title: 'Earnings Calendar',
    columns: bzEarningsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.DATE_SORT,
        BenzingaCalendarParam.UPDATED
    ],
    responseKey: 'earnings'  // Actual response key from API
};

const dividendsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.DIVIDENDS,
    url: 'dividends',
    displayName: 'Dividends',
    title: 'Dividends Calendar',
    columns: bzDividendsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.DIVIDEND_YIELD_OPERATION,
        BenzingaCalendarParam.DIVIDEND_YIELD,
        BenzingaCalendarParam.DATE_SORT,
        BenzingaCalendarParam.UPDATED,
        BenzingaCalendarParam.SORT
    ],
    responseKey: 'dividends'  // Actual response key from API
};

const economicsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.ECONOMICS,
    url: 'economics',
    displayName: 'Economics',
    title: 'Economics Calendar',
    columns: bzEconomicsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.UPDATED,
        BenzingaCalendarParam.COUNTRY,
        BenzingaCalendarParam.EVENT_CATEGORY
    ],
    responseKey: 'economics'
};

const iposMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.IPOS,
    url: 'ipos',
    displayName: 'IPOs',
    title: 'IPO Calendar',
    columns: bzIpoCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.UPDATED,
        BenzingaCalendarParam.IPO_TYPE
    ],
    responseKey: 'ipos'  // Actual response key from API
};

/**
 * Columns for Benzinga Conference Calls Calendar (API: /calendar/conference-calls)
 * Includes all relevant fields from the sample data object for completeness.
 */

const conferenceCallsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.CONFERENCE_CALLS,
    url: 'conference-calls',
    displayName: 'Conference Calls',
    title: 'Conference Calls Calendar',
    columns: bzConferenceCallsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.UPDATED,
        BenzingaCalendarParam.ACTION,
        BenzingaCalendarParam.ANALYST_ID,
        BenzingaCalendarParam.FIRM_ID,
        BenzingaCalendarParam.ANALYST,
        BenzingaCalendarParam.FIRM,
        BenzingaCalendarParam.IS_PRIMARY
    ],
    responseKey: 'conference'  // Actual response key from API
};

const ratingsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.RATINGS,
    url: 'ratings',
    displayName: 'Ratings',
    title: 'Ratings Calendar',
    columns: bzRatingsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.UPDATED,
        BenzingaCalendarParam.RATINGS_ACTION
    ],
    responseKey: 'ratings'  // Actual response key from API
};

const guidanceMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.GUIDANCE,
    url: 'guidance',
    displayName: 'Guidance',
    title: 'Guidance Calendar',
    columns: bzGuidanceCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.UPDATED
    ],
    responseKey: 'guidance'  // Actual response key from API
};

const splitsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.SPLITS,
    url: 'splits',
    displayName: 'Splits',
    title: 'Splits Calendar',
    columns: bzSplitsCalendarColumns,
    params: [
        ...baseParams,
        BenzingaCalendarParam.TICKERS,
        BenzingaCalendarParam.IMPORTANCE,
        BenzingaCalendarParam.UPDATED
    ],
    responseKey: 'splits'  // Actual response key from API
};

const fdaMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.FDA,
    url: 'fda',
    displayName: 'FDA',
    title: 'FDA Calendar',
    columns: [],
    params: [...baseParams],
    responseKey: 'fda'  // Same as endpoint name (already singular/acronym)
};

const mergersAcquisitionsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.MERGERS_ACQUISITIONS,
    url: 'ma',
    displayName: 'M&As',
    title: 'Mergers & Acquisitions Calendar',
    columns: [],
    params: [...baseParams],
    responseKey: 'ma'  // Using the API's short form for 'mergers & acquisitions'
};


const offeringsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.OFFERINGS,
    url: 'offerings',
    displayName: 'Offerings',
    title: 'Offerings Calendar',
    columns: [],
    params: [...baseParams],
    responseKey: 'offering'  // Singular form of 'offerings'
};

//////////// ENDPOINT MAPS //////////// 

// === Master Endpoint Maps ===

export const BENZINGA_ENDPOINTS_META_MAP: Record<BenzingaEndpoint, BenzingaEndpointMetadata> = {
    [BenzingaEndpoint.EARNINGS]: earningsMeta,
    [BenzingaEndpoint.DIVIDENDS]: dividendsMeta,
    [BenzingaEndpoint.ECONOMICS]: economicsMeta,
    [BenzingaEndpoint.IPOS]: iposMeta,
    [BenzingaEndpoint.CONFERENCE_CALLS]: conferenceCallsMeta,
    [BenzingaEndpoint.FDA]: fdaMeta,
    [BenzingaEndpoint.MERGERS_ACQUISITIONS]: mergersAcquisitionsMeta,
    [BenzingaEndpoint.RATINGS]: ratingsMeta,
    [BenzingaEndpoint.GUIDANCE]: guidanceMeta,
    [BenzingaEndpoint.SPLITS]: splitsMeta,
    [BenzingaEndpoint.OFFERINGS]: offeringsMeta
};

export type BenzingaCalendarParams =
    | DividendsCalendarParams
    | IposCalendarParams
    | SplitsCalendarParams
    | GuidanceCalendarParams;

// === Master Response and Item Maps ===

export interface BenzingaEndpointResponseMap {
    [BenzingaEndpoint.EARNINGS]: EarningsResponse;
    [BenzingaEndpoint.DIVIDENDS]: DividendsApiResponse;
    [BenzingaEndpoint.ECONOMICS]: any;
    [BenzingaEndpoint.IPOS]: BzIpoCalendarResponse;
    [BenzingaEndpoint.CONFERENCE_CALLS]: any;
    [BenzingaEndpoint.FDA]: any;
    [BenzingaEndpoint.MERGERS_ACQUISITIONS]: any;
    [BenzingaEndpoint.RATINGS]: any;
    [BenzingaEndpoint.GUIDANCE]: BzGuidanceCalendarResponse;
    [BenzingaEndpoint.SPLITS]: BzSplitsCalendarResponse;
    [BenzingaEndpoint.OFFERINGS]: any;
}

export interface BenzingaEndpointItemMap {
    [BenzingaEndpoint.EARNINGS]: EarningsItem[];
    [BenzingaEndpoint.DIVIDENDS]: DividendItem[];
    [BenzingaEndpoint.ECONOMICS]: any[];
    [BenzingaEndpoint.IPOS]: BzIpoCalendarEntry[];
    [BenzingaEndpoint.CONFERENCE_CALLS]: any[];
    [BenzingaEndpoint.FDA]: any[];
    [BenzingaEndpoint.MERGERS_ACQUISITIONS]: any[];
    [BenzingaEndpoint.RATINGS]: any[];
    [BenzingaEndpoint.GUIDANCE]: BzGuidanceCalendarEntry[];
    [BenzingaEndpoint.SPLITS]: BzSplitCalendarEntry[];
    [BenzingaEndpoint.OFFERINGS]: any[];
}

// Add any additional shared utilities/constants as needed

