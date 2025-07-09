import { ApiProvider, EndpointCategory, HttpMethod } from '../../common/enums';
import { FirestoreCollection } from '../../../common/firestore-collections';
import { CompanyDataEndpoint, MarketDataEndpoint } from '../../../common/common-benz';
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
export const COMPANY_DATA_ENDPOINTS: Record<CompanyDataEndpoint, EndpointConfig> = {
  [CompanyDataEndpoint.EARNINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.EARNINGS,
    name: 'Earnings',
    path: '/calendar/earnings',
    description: 'Returns earnings data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/earnings`,
  },
  [CompanyDataEndpoint.DIVIDENDS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.DIVIDENDS,
    name: 'Dividends',
    path: '/calendar/dividends',
    description: 'Returns dividend data for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/dividends`,
  },
  [CompanyDataEndpoint.CONFERENCE_CALLS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.CONFERENCE_CALLS,
    name: 'Conference Calls',
    path: '/calendar/conference-calls',
    description: 'Returns conference call information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/conference-calls`,
  },
  [CompanyDataEndpoint.RATINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.RATINGS,
    name: 'Analyst Ratings',
    path: '/calendar/ratings',
    description: 'Returns analyst ratings for companies',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/ratings`,
  },
  [CompanyDataEndpoint.GUIDANCE]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.GUIDANCE,
    name: 'Guidance',
    path: '/calendar/guidance',
    description: 'Returns company guidance',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/guidance`,
  },
  [CompanyDataEndpoint.SPLITS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.SPLITS,
    name: 'Stock Splits',
    path: '/calendar/splits',
    description: 'Returns stock split information',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/splits`,
  },
  [CompanyDataEndpoint.OFFERINGS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: CompanyDataEndpoint.OFFERINGS,
    name: 'Offerings',
    path: '/calendar/offerings',
    description: 'Returns company offerings',
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/offerings`,
  },
};

// Market Data Endpoints
export const MARKET_DATA_ENDPOINTS: Record<MarketDataEndpoint, EndpointConfig> = {
  [MarketDataEndpoint.ECONOMICS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: MarketDataEndpoint.ECONOMICS,
    name: 'Economics Calendar',
    path: '/calendar/economics',
    description: 'Returns economic calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/economics`,
  },
  [MarketDataEndpoint.IPOS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: MarketDataEndpoint.IPOS,
    name: 'IPOs',
    path: '/calendar/ipos',
    description: 'Returns IPO calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/ipos`,
  },
  [MarketDataEndpoint.FDA]: {
    ...BASE_ENDPOINT_CONFIG,
    id: MarketDataEndpoint.FDA,
    name: 'FDA Calendar',
    path: '/calendar/fda',
    description: 'Returns FDA calendar data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/fda`,
  },
  [MarketDataEndpoint.MERGERS_ACQUISITIONS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: MarketDataEndpoint.MERGERS_ACQUISITIONS,
    name: 'Mergers & Acquisitions',
    path: '/calendar/mergers-acquisitions',
    description: 'Returns M&A activity data',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/mergers-acquisitions`,
  },
  [MarketDataEndpoint.NEWS]: {
    ...BASE_ENDPOINT_CONFIG,
    id: MarketDataEndpoint.NEWS,
    name: 'News',
    path: '/news',
    description: 'Returns news articles',
    requiresSymbol: false,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/news`,
    documentationUrl: 'https://docs.benzinga.com/benzinga/newsfeed-v2.html',
  },
};

// Combined endpoint configurations
export const BENZINGA_ENDPOINT_CONFIGS = {
  ...COMPANY_DATA_ENDPOINTS,
  ...MARKET_DATA_ENDPOINTS,
} as const;
