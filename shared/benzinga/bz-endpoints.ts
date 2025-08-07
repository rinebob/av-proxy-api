// COPIED FROM src/app/common/fe-common-bz.ts and backend equivalents. Do not use directly until migration is complete.

export enum BenzingaEndpoint {
  CALENDAR = 'calendar',
  NEWS = 'news',
}

export enum BzEndpointCategory {
  STOCK_TIME_SERIES = 'stock-time-series',
  FUNDAMENTAL_DATA = 'fundamental-data',
  FOREX = 'forex',
  CRYPTO = 'cryptocurrency',
  TECHNICAL_INDICATORS = 'technical-indicators',
  BENZINGA_CALENDAR = 'benzinga-calendar',
  BENZINGA_NEWS = 'benzinga-news',
}

export enum SvtBzNewsRequest {
  BZ_NEWS = 'bz-news',
  BZ_NEWS_BY_ID = 'bz-news-by-id',
}

export enum BzCompanyDataCalendarType {
  EARNINGS = 'earnings',
  DIVIDENDS = 'dividends',
  SPLITS = 'splits',
  GUIDANCE = 'guidance',
  OFFERINGS = 'offerings',
  CONFERENCE_CALLS = 'conference-calls',
  FDA = 'fda',
  RATINGS = 'ratings',
}

export enum BzMarketDataCalendarType {
  ECONOMICS = 'economics',
  IPOS = 'ipos',
  MERGERS_ACQUISITIONS = 'ma',
}

/**
 * Company-specific calendar types (require a ticker/symbol)
 */
export enum BzCalendarRequestType {
    EARNINGS = 'earnings',
    DIVIDENDS = 'dividends',
    CONFERENCE_CALLS = 'conference-calls',
    RATINGS = 'ratings',
    GUIDANCE = 'guidance',
    SPLITS = 'splits',
    OFFERINGS = 'offerings',
    ECONOMICS = 'economics',
    IPOS = 'ipos',
    MERGERS_ACQUISITIONS = 'ma' // matches Benzinga API endpoint
}

export type BzCalendarType = BzCompanyDataCalendarType | BzMarketDataCalendarType;

export enum BenzingaFunctionName {
    GET_CALENDAR = 'getBenzingaCalendar',
    GET_COMPANY_LOGO = 'getCompanyLogo',
    GET_DYNAMIC_CALENDAR = 'getDynamicCalendar',
}
