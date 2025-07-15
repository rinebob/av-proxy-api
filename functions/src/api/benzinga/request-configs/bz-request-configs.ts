import { ApiProvider } from '../../../common/data-providers';
import { EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import { 
  BzCompanyDataCalendarType, 
  BzMarketDataCalendarType,
  BenzingaEndpoint,
  BenzingaRequestConfig,
  BenzingaNewsRequestConfig,
  BenzingaCalendarParameter,
  SvtBzNewsRequest,
  BenzingaNewsParameter,
} from '../../../common/common-benz';
import { EndpointConfig } from '../../common/types';
import { BzNewsChannel } from './bz-news-channels';

// Benzinga-specific endpoint config interface
import { EndpointSymbolUsage } from '../../../common/common-fn';

// NOTE: THIS FILE IS DEPRECATED - DO NOT USE ANY CODE IN THIS FILE

// INSTEAD USE BZ-CALENDAR-REQUEST-CONFIGS.TS OR BZ-NEWS-REQUEST-CONFIGS.TS


// Base configuration that can be extended by specific endpoints
export const BASE_REQUEST_CONFIG: Omit<EndpointConfig, 'id' | 'name' | 'apiEndpoint' | 'description'> & { apiKeyEnv: string } = {
  apiKeyEnv: 'BENZINGA_CALENDAR_API_KEY',
  provider: ApiProvider.BENZINGA,
  category: EndpointCategory.BENZINGA_CALENDAR,
  method: HttpMethod.GET,
  ttl: 2 * 60, // 2 minutes
  requiresSymbol: true,
  parameters: {
    [BenzingaCalendarParameter.DATE_FROM]: {
      type: 'string',
      required: false,
      description: 'Start date (YYYY-MM-DD)',
    },
    [BenzingaCalendarParameter.DATE_TO]: {
      type: 'string',
      required: false,
      description: 'End date (YYYY-MM-DD)',
    },
    [BenzingaCalendarParameter.PAGE]: {
      type: 'number',
      required: false,
      description: 'Page number of results',
      default: 1,
    },
    [BenzingaCalendarParameter.PAGESIZE]: {
      type: 'number',
      required: false,
      description: 'Number of results per page',
      default: 100,
    },
  },
  firestorePath: '', // Will be set per endpoint
  documentationUrl: 'https://docs.benzinga.com/benzinga/calendar-v2.html',
};

// Shared parameter definitions map
export const BZ_CALENDAR_PARAMETER_DEFS: Record<BenzingaCalendarParameter, any> = {
  [BenzingaCalendarParameter.PAGE]: {
    type: 'number',
    required: false,
    description: 'Page offset. For optimization, offsets are limited from 0 - 100000. Limit query results by other parameters such as date.',
    default: 0,
  },
  [BenzingaCalendarParameter.PAGESIZE]: {
    type: 'number',
    required: false,
    description: 'Number of results returned. Limit 1000',
    default: 100,
  },
  [BenzingaCalendarParameter.DATE]: {
    type: 'string',
    required: false,
    description: 'Date to query for calendar data. Shorthand for date_from and date_to if they are the same. Defaults for latest.',
    format: 'YYYY-MM-DD',
  },
  [BenzingaCalendarParameter.DATE_FROM]: {
    type: 'string',
    required: false,
    description: 'Date to query from point in time.',
    format: 'YYYY-MM-DD',
  },
  [BenzingaCalendarParameter.DATE_TO]: {
    type: 'string',
    required: false,
    description: 'Date to query to point in time.',
    format: 'YYYY-MM-DD',
  },
  [BenzingaCalendarParameter.DATE_SORT]: {
    type: 'string',
    required: false,
    description: 'Field sort option for earnings calendar. Apply :desc, :asc for sort order.',
    enum: ['date'],
  },
  [BenzingaCalendarParameter.TICKERS]: {
    type: 'string',
    required: false,
    description: 'One or more ticker symbols separated by a comma. All calendars accept this parameter (except FDA endpoint). Max 50 tickers.',
    format: 'csv',
  },
  [BenzingaCalendarParameter.IMPORTANCE]: {
    type: 'number',
    required: false,
    description: 'The importance level to filter by. Uses Greater Than or Equal To the importance indicated.',
    enum: [0, 1, 2, 3, 4, 5],
  },
  [BenzingaCalendarParameter.UPDATED]: {
    type: 'number',
    required: false,
    description: 'Records last Updated Unix timestamp (UTC). This will force the sort order to be Greater Than or Equal to the timestamp indicated.',
  },
  [BenzingaCalendarParameter.DIVIDEND_YIELD]: {
    type: 'number',
    required: false,
    description: 'Dividend yield filter. Value is a decimal (e.g., 0.05 for 5%).',
  },
  [BenzingaCalendarParameter.ACTION]: {
    type: 'string',
    required: false,
    description: 'Rating action filter (e.g., upgrade, downgrade, initiate, reiterate, maintain).',
    enum: ['upgrade', 'downgrade', 'initiate', 'reiterate', 'maintain'],
  },
};

// Utility to resolve full parameter object for an endpoint
export function getBzCalendarParams(keys: BenzingaCalendarParameter[]): Record<string, any> {
  const params: Record<string, any> = {};
  for (const key of keys) {
    params[key] = BZ_CALENDAR_PARAMETER_DEFS[key];
  }
  return params;
}

// Common parameters shared by all calendar endpoints
export const BZ_CALENDAR_COMMON_PARAMS: BenzingaCalendarParameter[] = [
  BenzingaCalendarParameter.PAGE,
  BenzingaCalendarParameter.PAGESIZE,
  BenzingaCalendarParameter.DATE,
  BenzingaCalendarParameter.DATE_FROM,
  BenzingaCalendarParameter.DATE_TO,
  BenzingaCalendarParameter.UPDATED,
];

// Company Data Endpoints
export const COMPANY_DATA_REQUESTS: Record<BzCompanyDataCalendarType, BenzingaRequestConfig> = {
  [BzCompanyDataCalendarType.EARNINGS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.EARNINGS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Earnings',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.EARNINGS}`,
    description: 'Returns earnings data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/bz-${FirestoreCollection.EARNINGS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.DATE_SORT,
      BenzingaCalendarParameter.TICKERS,
      BenzingaCalendarParameter.IMPORTANCE
    ],
  },
  [BzCompanyDataCalendarType.DIVIDENDS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.DIVIDENDS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Dividends',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.DIVIDENDS}`,
    description: 'Returns dividend data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.DIVIDENDS}/bz-${FirestoreCollection.DIVIDENDS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS,
      BenzingaCalendarParameter.DIVIDEND_YIELD
    ],
  },
  [BzCompanyDataCalendarType.CONFERENCE_CALLS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.CONFERENCE_CALLS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Conference Calls',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.CONFERENCE_CALLS}`,
    description: 'Returns conference call information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.CONFERENCE_CALLS}/bz-${FirestoreCollection.CONFERENCE_CALLS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS
    ],
  },
  [BzCompanyDataCalendarType.RATINGS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.RATINGS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Analyst Ratings',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.RATINGS}`,
    description: 'Returns analyst ratings for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.RATINGS}/bz-${FirestoreCollection.RATINGS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS,
      BenzingaCalendarParameter.ACTION
    ],
  },
  [BzCompanyDataCalendarType.GUIDANCE]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.GUIDANCE,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Guidance',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.GUIDANCE}`,
    description: 'Returns company guidance',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.GUIDANCE}/bz-${FirestoreCollection.GUIDANCE}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS
    ],
  },
  [BzCompanyDataCalendarType.SPLITS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.SPLITS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Stock Splits',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.SPLITS}`,
    description: 'Returns stock split information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.SPLITS}/bz-${FirestoreCollection.SPLITS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS
    ],
  },
  [BzCompanyDataCalendarType.OFFERINGS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzCompanyDataCalendarType.OFFERINGS,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    name: 'Offerings',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzCompanyDataCalendarType.OFFERINGS}`,
    description: 'Returns company offerings',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.OFFERINGS}/bz-${FirestoreCollection.OFFERINGS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS,
      BenzingaCalendarParameter.TICKERS
    ],
  },
};

// Market Data Endpoints
export const MARKET_DATA_REQUESTS: Record<BzMarketDataCalendarType, BenzingaRequestConfig> = {
  [BzMarketDataCalendarType.ECONOMICS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzMarketDataCalendarType.ECONOMICS,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'Economics Calendar',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzMarketDataCalendarType.ECONOMICS}`,
    description: 'Returns economic calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.ECONOMICS}/bz-${FirestoreCollection.ECONOMIC_CALENDAR}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS
    ],
  },
  [BzMarketDataCalendarType.IPOS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzMarketDataCalendarType.IPOS,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'IPOs',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzMarketDataCalendarType.IPOS}`,
    description: 'Returns IPO calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.IPOS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS
    ],
  },
  [BzMarketDataCalendarType.FDA]: {
    ...BASE_REQUEST_CONFIG,
    id: BzMarketDataCalendarType.FDA,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'FDA Calendar',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzMarketDataCalendarType.FDA}`,
    description: 'Returns FDA calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.FDA}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS
    ],
  },
  [BzMarketDataCalendarType.MERGERS_ACQUISITIONS]: {
    ...BASE_REQUEST_CONFIG,
    id: BzMarketDataCalendarType.MERGERS_ACQUISITIONS,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'Mergers & Acquisitions',
    apiEndpoint: `/${BenzingaEndpoint.CALENDAR}/${BzMarketDataCalendarType.MERGERS_ACQUISITIONS}`,
    description: 'Returns M&A activity data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/bz-${FirestoreCollection.MERGERS_ACQUISITIONS}`,
    parameterKeys: [
      ...BZ_CALENDAR_COMMON_PARAMS
    ],
  },
};

export const BZ_NEWS_PARAMETER_DEFS: Record<BenzingaNewsParameter, any> = {
  [BenzingaNewsParameter.API_KEY]: {
    type: 'string',
    required: true,
    description: 'API key for authentication',
  },
  [BenzingaNewsParameter.PAGE]: {
    type: 'number',
    required: false,
    description: 'Page offset (0-100000)',
  },
  [BenzingaNewsParameter.PAGE_SIZE]: {
    type: 'number',
    required: false,
    description: 'Number of results returned (max 100)',
  },
  [BenzingaNewsParameter.DISPLAY_OUTPUT]: {
    type: 'string',
    required: false,
    description: 'Specify headline only (headline), headline + teaser (abstract), or headline + full body (full) text',
    enum: ['full', 'abstract', 'headline'],
  },
  [BenzingaNewsParameter.DATE]: {
    type: 'string',
    required: false,
    description: 'Shorthand for date_from and date_to if they are the same (YYYY-MM-DD)',
    format: 'YYYY-MM-DD',
  },
  [BenzingaNewsParameter.DATE_FROM]: {
    type: 'string',
    required: false,
    description: 'Date to query from point in time (YYYY-MM-DD)',
    format: 'YYYY-MM-DD',
  },
  [BenzingaNewsParameter.DATE_TO]: {
    type: 'string',
    required: false,
    description: 'Date to query to point in time (YYYY-MM-DD)',
    format: 'YYYY-MM-DD',
  },
  [BenzingaNewsParameter.UPDATED_SINCE]: {
    type: 'number',
    required: false,
    description: 'Last updated Unix timestamp (UTC)',
  },
  [BenzingaNewsParameter.PUBLISHED_SINCE]: {
    type: 'number',
    required: false,
    description: 'Last published Unix timestamp (UTC)',
  },
  [BenzingaNewsParameter.SORT]: {
    type: 'string',
    required: false,
    description: 'Allows control of results sorting (e.g., created:desc)',
    format: 'field:direction',
  },
  [BenzingaNewsParameter.ISIN]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of ISINs (max 50)',
    format: 'csv',
  },
  [BenzingaNewsParameter.CUSIP]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of CUSIPs (max 50)',
    format: 'csv',
  },
  [BenzingaNewsParameter.TICKERS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of ticker symbols (max 50)',
    format: 'csv',
  },
  [BenzingaNewsParameter.CHANNELS]: {
    type: 'string',
    required: false,
    description: "Comma-separated list of news channels (e.g., 'wiim')",
    format: 'csv',
  },
  [BenzingaNewsParameter.TOPICS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of news topics/entities',
    format: 'csv',
  },
  [BenzingaNewsParameter.AUTHORS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of authors',
    format: 'csv',
  },
  [BenzingaNewsParameter.CONTENT_TYPES]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of content types',
    format: 'csv',
  },
  [BenzingaNewsParameter.EXCLUDE_CONTENT]: {
    type: 'boolean',
    required: false,
    description: 'Exclude article content/body for lighter responses',
  },
  [BenzingaNewsParameter.NEWS_ID]: {
    type: 'string',
    required: true,
    description: 'The unique NodeID of the news article to fetch',
  },
};

// Utility to resolve news parameter definitions (like getBzCalendarParams)
export function getBzNewsParams(keys: BenzingaNewsParameter[]): Record<string, any> {
  const params: Record<string, any> = {};
  for (const key of keys) {
    params[key] = BZ_NEWS_PARAMETER_DEFS[key];
  }
  return params;
}

// --- News Endpoint Config ---
export const BZ_NEWS_REQUESTS: Record<SvtBzNewsRequest, BenzingaNewsRequestConfig> = {
  [SvtBzNewsRequest.BZ_NEWS]: {
    ...BASE_REQUEST_CONFIG,
    apiKeyEnv: 'BENZINGA_WIIM_API_KEY', // override for news
    id: SvtBzNewsRequest.BZ_NEWS,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'News',
    apiEndpoint: `/${BenzingaEndpoint.NEWS}`,
    description: 'Returns news articles (including WIIM)',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.NEWS}/${ApiProvider.BENZINGA}/{channel}/{newsId}`,
    parameterKeys: [
      BenzingaNewsParameter.PAGE,
      BenzingaNewsParameter.PAGE_SIZE,
      BenzingaNewsParameter.DISPLAY_OUTPUT,
      BenzingaNewsParameter.CHANNELS,
    ],
    // Set default pageSize to 100
    parameters: {
      ...Object.fromEntries(Object.entries(BASE_REQUEST_CONFIG.parameters).filter(([key]) => key !== BenzingaCalendarParameter.PAGESIZE)),
      [BenzingaNewsParameter.PAGE_SIZE]: {
        type: 'number',
        required: false,
        description: 'Results per page (max 100)',
        default: 100,
      },
    },
    channels: [BzNewsChannel.MARKET_MOVING_EXCLUSIVES, BzNewsChannel.MOVERS_SHAKERS],
  },
  [SvtBzNewsRequest.BZ_NEWS_BY_ID]: {
    ...BASE_REQUEST_CONFIG,
    apiKeyEnv: 'BENZINGA_WIIM_API_KEY',
    id: SvtBzNewsRequest.BZ_NEWS_BY_ID,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'News By ID',
    apiEndpoint: `/${BenzingaEndpoint.NEWS}/{newsId}`,
    description: 'Fetch a single news article by NodeID',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.NEWS}/${ApiProvider.BENZINGA}/{channel}/{newsId}`,
    parameterKeys: [
      BenzingaNewsParameter.NEWS_ID,
      BenzingaNewsParameter.DISPLAY_OUTPUT,
    ],
  },
}

// Combine all endpoint configurations
export const ALL_BENZINGA_REQUEST_CONFIGS: Record<string, BenzingaRequestConfig> = {
  ...COMPANY_DATA_REQUESTS,
  ...MARKET_DATA_REQUESTS,
  ...BZ_NEWS_REQUESTS,
} as const;
