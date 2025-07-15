import { ApiProvider } from '../../../common/data-providers';
import { EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import { 
  BenzingaEndpoint,
  BenzingaNewsRequestConfig,
  SvtBzNewsRequest,
} from '../../../common/common-benz';
import { RequestConfig } from '../../common/types';
import { BzNewsChannel } from './bz-news-channels';

// Benzinga-specific endpoint config interface
import { EndpointSymbolUsage } from '../../../common/common-fn';

/**
 * Benzing News Endpoint docs:
 * https://docs.benzinga.com/benzinga-apis/newsfeed-v2/newsService-get
 */

/**
 * Benzinga News API parameters (camelCase, matches Benzinga news endoint docs (calendar endpoint uses lower_snake_case))
 */
export enum BenzingaNewsParameter {
    PAGE = 'page',
    PAGE_SIZE = 'pageSize',
    DISPLAY_OUTPUT = 'displayOutput',
    DATE = 'date',
    DATE_FROM = 'dateFrom',
    DATE_TO = 'dateTo',
    UPDATED_SINCE = 'updatedSince',
    PUBLISHED_SINCE = 'publishedSince',
    SORT = 'sort',
    ISIN = 'isin',
    CUSIP = 'cusip',
    TICKERS = 'tickers',
    CHANNELS = 'channels',
    TOPICS = 'topics',
    AUTHORS = 'authors',
    CONTENT_TYPES = 'contentTypes',
    NEWS_ID = 'newsId',
  }

export const BZ_NEWS_PARAMETER_DEFS: Record<BenzingaNewsParameter, any> = {
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

// Base configuration that can be extended by specific requests
const BASE_NEWS_REQUEST_CONFIG: Omit<RequestConfig, 'id' | 'name' | 'apiEndpoint' | 'description'> = {
    provider: ApiProvider.BENZINGA,
    category: EndpointCategory.BENZINGA_NEWS,
    method: HttpMethod.GET,
    ttl: 2 * 60, // 2 minutes
    requiresSymbol: false,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    parameters: {},
    documentationUrl: 'https://docs.benzinga.com/benzinga/newsfeed-v2/newsService-get.html',
};

// --- News Endpoint Config ---
export const BZ_NEWS_REQUESTS: Record<SvtBzNewsRequest, BenzingaNewsRequestConfig> = {
  [SvtBzNewsRequest.BZ_NEWS]: {
    ...BASE_NEWS_REQUEST_CONFIG,
    apiKeyEnv: 'BENZINGA_WIIM_API_KEY',
    id: SvtBzNewsRequest.BZ_NEWS,
    name: 'News',
    apiEndpoint: `/${BenzingaEndpoint.NEWS}`,
    description: 'Returns news articles',
    firestorePath: `${FirestoreCollection.NEWS}/${ApiProvider.BENZINGA}/{channel}/{newsId}`,
    parameterKeys: [
      BenzingaNewsParameter.PAGE,
      BenzingaNewsParameter.PAGE_SIZE,
      BenzingaNewsParameter.DISPLAY_OUTPUT,
      BenzingaNewsParameter.DATE,
      BenzingaNewsParameter.DATE_FROM,
      BenzingaNewsParameter.DATE_TO,
      BenzingaNewsParameter.UPDATED_SINCE, // Maintained as per API docs, but not currently used in requests
      BenzingaNewsParameter.PUBLISHED_SINCE,
      BenzingaNewsParameter.SORT,
      BenzingaNewsParameter.ISIN,
      BenzingaNewsParameter.CUSIP,
      BenzingaNewsParameter.TICKERS,
      BenzingaNewsParameter.CHANNELS,
      BenzingaNewsParameter.TOPICS,
      BenzingaNewsParameter.AUTHORS,
      BenzingaNewsParameter.CONTENT_TYPES,
    ],
    parameters: {
      ...Object.fromEntries(Object.entries(BASE_NEWS_REQUEST_CONFIG.parameters)),
      [BenzingaNewsParameter.PAGE_SIZE]: {
        type: 'number',
        required: false,
        description: 'Results per page (max 100)',
        default: 100,
      },
      [BenzingaNewsParameter.UPDATED_SINCE]: {
        type: 'number',
        required: false,
        description: 'Unix timestamp (UTC) for filtering news updated after this time. Currently temporarily disabled due to API issues.',
      },
    },
    channels: [BzNewsChannel.MARKET_MOVING_EXCLUSIVES, BzNewsChannel.MOVERS_SHAKERS],
  },
  [SvtBzNewsRequest.BZ_NEWS_BY_ID]: {
    ...BASE_NEWS_REQUEST_CONFIG,
    apiKeyEnv: 'BENZINGA_WIIM_API_KEY',
    id: SvtBzNewsRequest.BZ_NEWS_BY_ID,
    name: 'News By ID',
    apiEndpoint: `/${BenzingaEndpoint.NEWS}/{newsId}`,
    description: 'Fetch a single news article by NodeID',
    firestorePath: `${FirestoreCollection.NEWS}/${ApiProvider.BENZINGA}/{channel}/{newsId}`,
    parameterKeys: [
      BenzingaNewsParameter.NEWS_ID,
      BenzingaNewsParameter.DISPLAY_OUTPUT,
    ],
  },
}