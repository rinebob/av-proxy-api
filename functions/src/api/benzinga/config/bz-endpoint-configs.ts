import { ApiProvider } from '../../../common/data-providers';
import { EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import { 
  BzCompanyDataCalendarType, 
  BzMarketDataCalendarType,
  BenzingaEndpoint
} from '../../../common/common-benz';
import { EndpointConfig } from '../../common/types';

// Benzinga-specific endpoint config interface
import { EndpointSymbolUsage } from '../../../common/common-fn';

// Union type for all Benzinga endpoint IDs
export type BenzingaEndpointId =
  | BzCompanyDataCalendarType
  | BzMarketDataCalendarType
  | BenzingaEndpoint.NEWS;

export interface BenzingaEndpointConfig extends EndpointConfig {
  apiKeyEnv: string; // Name of the env var for the API key
  id: BenzingaEndpointId;
  parameterKeys: string[];
  symbolUsage: EndpointSymbolUsage;
}

// Define the shared BenzingaCalendarParameter enum
export enum BenzingaCalendarParameter {
  PAGE = 'page',
  PAGESIZE = 'pagesize',
  DATE = 'parameters[date]',
  DATE_FROM = 'parameters[date_from]',
  DATE_TO = 'parameters[date_to]',
  DATE_SORT = 'parameters[date_sort]',
  TICKERS = 'parameters[tickers]',
  IMPORTANCE = 'parameters[importance]',
  UPDATED = 'parameters[updated]',
  DIVIDEND_YIELD = 'parameters[dividend_yield]',
  ACTION = 'parameters[action]',
  SYMBOLS = 'symbols',
}

// Base configuration that can be extended by specific endpoints
export const BASE_ENDPOINT_CONFIG: Omit<EndpointConfig, 'id' | 'name' | 'apiEndpoint' | 'description'> & { apiKeyEnv: string } = {
  apiKeyEnv: 'BENZINGA_CALENDAR_API_KEY',
  provider: ApiProvider.BENZINGA,
  category: EndpointCategory.BENZINGA_CALENDAR,
  method: HttpMethod.GET,
  ttl: 2 * 60, // 2 minutes
  requiresSymbol: true,
  parameters: {
    [BenzingaCalendarParameter.SYMBOLS]: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of ticker symbols',
    },
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
      default: 50,
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
  [BenzingaCalendarParameter.SYMBOLS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of ticker symbols',
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
export const COMPANY_DATA_ENDPOINTS: Record<BzCompanyDataCalendarType, BenzingaEndpointConfig> = {
  [BzCompanyDataCalendarType.EARNINGS]: {
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
export const MARKET_DATA_ENDPOINTS: Record<BzMarketDataCalendarType, BenzingaEndpointConfig> = {
  [BzMarketDataCalendarType.ECONOMICS]: {
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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
    ...BASE_ENDPOINT_CONFIG,
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

// --- News Endpoint Parameter Enum and Definitions ---
export enum BenzingaNewsParameter {
  TICKERS = 'tickers',
  DATE = 'date',
  CHANNELS = 'channels',
  TOPICS = 'topics',
  UPDATED_SINCE = 'updatedSince',
  PAGE = 'page',
  PAGE_SIZE = 'pageSize',
  DISPLAY_OUTPUT = 'displayOutput',
  EXCLUDE_CONTENT = 'excludeContent',
}

export const BZ_NEWS_PARAMETER_DEFS: Record<BenzingaNewsParameter, any> = {
  [BenzingaNewsParameter.TICKERS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of ticker symbols (max 50)',
    format: 'csv',
  },
  [BenzingaNewsParameter.DATE]: {
    type: 'string',
    required: false,
    description: 'Filter by date (YYYY-MM-DD)',
    format: 'YYYY-MM-DD',
  },
  [BenzingaNewsParameter.CHANNELS]: {
    type: 'string',
    required: false,
    description: "Comma-separated list of news channels (e.g., 'wiim')",
    format: 'csv',
    enum: ['wiim'], // add more channels as needed
  },
  [BenzingaNewsParameter.TOPICS]: {
    type: 'string',
    required: false,
    description: 'Comma-separated list of news topics/entities',
    format: 'csv',
  },
  [BenzingaNewsParameter.UPDATED_SINCE]: {
    type: 'number',
    required: false,
    description: 'Return stories updated since this Unix timestamp (for polling/deltas)',
  },
  [BenzingaNewsParameter.PAGE]: {
    type: 'number',
    required: false,
    description: 'Pagination offset',
    default: 0,
  },
  [BenzingaNewsParameter.PAGE_SIZE]: {
    type: 'number',
    required: false,
    description: 'Results per page (max 100)',
    default: 100,
  },
  [BenzingaNewsParameter.DISPLAY_OUTPUT]: {
    type: 'string',
    required: false,
    description: "Controls verbosity. Use 'full' for all fields.",
    enum: ['full'],
  },
  [BenzingaNewsParameter.EXCLUDE_CONTENT]: {
    type: 'boolean',
    required: false,
    description: 'Exclude article content/body for lighter responses',
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
export const BZ_NEWS_ENDPOINT: Record<BenzingaEndpoint.NEWS, BenzingaEndpointConfig> = {
  [BenzingaEndpoint.NEWS]: {
    ...BASE_ENDPOINT_CONFIG,
    apiKeyEnv: 'BENZINGA_WIIM_API_KEY', // override for news
    id: BenzingaEndpoint.NEWS,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    name: 'News',
    apiEndpoint: `/${BenzingaEndpoint.NEWS}`,
    description: 'Returns news articles (including WIIM)',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.NEWS}/${ApiProvider.BENZINGA}/${FirestoreCollection.WIIM}/{newsId}`,
    parameterKeys: [
      BenzingaNewsParameter.TICKERS,
      BenzingaNewsParameter.DATE,
      BenzingaNewsParameter.CHANNELS, // for 'wiim'
      BenzingaNewsParameter.TOPICS,
      BenzingaNewsParameter.UPDATED_SINCE,
      BenzingaNewsParameter.PAGE,
      BenzingaNewsParameter.PAGE_SIZE,
      BenzingaNewsParameter.DISPLAY_OUTPUT,
      BenzingaNewsParameter.EXCLUDE_CONTENT,
    ],
  },
};

// Combine all endpoint configurations
export const ALL_BENZINGA_ENDPOINT_CONFIGS: Record<string, BenzingaEndpointConfig> = {
  ...COMPANY_DATA_ENDPOINTS,
  ...MARKET_DATA_ENDPOINTS,
  ...BZ_NEWS_ENDPOINT,
} as const;
