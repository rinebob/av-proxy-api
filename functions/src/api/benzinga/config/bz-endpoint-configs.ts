import { ApiProvider, EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import { 
  BzCompanyDataCalendarType, 
  BzMarketDataCalendarType,
  BenzingaEndpoint
} from '../../../common/common-benz';
import { EndpointConfig } from '../../common/types';

// Base configuration that can be extended by specific endpoints
export const BASE_ENDPOINT_CONFIG: Omit<EndpointConfig, 'id' | 'name' | 'path' | 'description'> = {
  provider: ApiProvider.BENZINGA,
  category: EndpointCategory.BENZINGA_CALENDAR,
  method: HttpMethod.GET,
  ttl: 6 * 60 * 60, // 6 hours
  requiresSymbol: true,
  parameters: {
    symbols: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of ticker symbols',
    },
    date_from: {
      type: 'string',
      required: false,
      description: 'Start date (YYYY-MM-DD)',
    },
    date_to: {
      type: 'string',
      required: false,
      description: 'End date (YYYY-MM-DD)',
    },
    page: {
      type: 'number',
      required: false,
      description: 'Page number of results',
      default: 1,
    },
    pagesize: {
      type: 'number',
      required: false,
      description: 'Number of results per page',
      default: 50,
    },
  },
  firestorePath: '', // Will be set per endpoint
  documentationUrl: 'https://docs.benzinga.com/benzinga/calendar-v2.html',
};

// Company Data Endpoints
export const COMPANY_DATA_ENDPOINTS: Record<BzCompanyDataCalendarType, EndpointConfig> = {
  [BzCompanyDataCalendarType.EARNINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.EARNINGS,
    name: 'Earnings',
    path: '/calendar/earnings',
    description: 'Returns earnings data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/earnings`,
  },
  [BzCompanyDataCalendarType.DIVIDENDS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.DIVIDENDS,
    name: 'Dividends',
    path: '/calendar/dividends',
    description: 'Returns dividend data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/dividends`,
  },
  [BzCompanyDataCalendarType.CONFERENCE_CALLS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.CONFERENCE_CALLS,
    name: 'Conference Calls',
    path: '/calendar/conference-calls',
    description: 'Returns conference call information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/conference-calls`,
  },
  [BzCompanyDataCalendarType.RATINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.RATINGS,
    name: 'Analyst Ratings',
    path: '/calendar/ratings',
    description: 'Returns analyst ratings for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/ratings`,
  },
  [BzCompanyDataCalendarType.GUIDANCE]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.GUIDANCE,
    name: 'Guidance',
    path: '/calendar/guidance',
    description: 'Returns company guidance',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/guidance`,
  },
  [BzCompanyDataCalendarType.SPLITS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.SPLITS,
    name: 'Stock Splits',
    path: '/calendar/splits',
    description: 'Returns stock split information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/splits`,
  },
  [BzCompanyDataCalendarType.OFFERINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzCompanyDataCalendarType.OFFERINGS,
    name: 'Offerings',
    path: '/calendar/offerings',
    description: 'Returns company offerings',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/offerings`,
  },
};

// Market Data Endpoints
export const MARKET_DATA_ENDPOINTS: Record<BzMarketDataCalendarType, EndpointConfig> = {
  [BzMarketDataCalendarType.ECONOMICS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzMarketDataCalendarType.ECONOMICS,
    name: 'Economics Calendar',
    path: '/calendar/economics',
    description: 'Returns economic calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/economics`,
  },
  [BzMarketDataCalendarType.IPOS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzMarketDataCalendarType.IPOS,
    name: 'IPOs',
    path: '/calendar/ipos',
    description: 'Returns IPO calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/ipos`,
  },
  [BzMarketDataCalendarType.FDA]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzMarketDataCalendarType.FDA,
    name: 'FDA Calendar',
    path: '/calendar/fda',
    description: 'Returns FDA calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/fda`,
  },
  [BzMarketDataCalendarType.MERGERS_ACQUISITIONS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: BzMarketDataCalendarType.MERGERS_ACQUISITIONS,
    name: 'Mergers & Acquisitions',
    path: '/calendar/mergers-acquisitions',
    description: 'Returns M&A activity data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/mergers-acquisitions`,
  }
};

/**
 * Top-level Benzinga endpoints (not calendar-specific)
 */
export const BZ_NEWS_ENDPOINT: Record<BenzingaEndpoint.NEWS, EndpointConfig> = {
  [BenzingaEndpoint.NEWS]: {
      ...BASE_ENDPOINT_CONFIG,
    id: BenzingaEndpoint.NEWS,
    name: 'News',
    path: '/news',
    description: 'Returns news articles',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/news`,
  },};

// Combine all endpoint configurations
export const ALL_BENZINGA_ENDPOINT_CONFIGS: Record<string, EndpointConfig> = {
  ...COMPANY_DATA_ENDPOINTS,
  ...MARKET_DATA_ENDPOINTS,
  ...BZ_NEWS_ENDPOINT,
} as const;
