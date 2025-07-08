import { ApiProvider, BenzingaEndpoint, EndpointCategory, HttpMethod } from '../common/enums';
import { EndpointConfig } from '../common/types';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';

// Import concrete handlers
import { BenzingaCalendarHandler } from './handlers/benzinga-calendar.handler';
// import { BenzingaNewsHandler } from './handlers/benzinga-news.handler'; // Uncomment when implemented

type EndpointConfigMap = {
  [key in BenzingaEndpoint]: EndpointConfig;
};

const ENDPOINT_CONFIGS: EndpointConfigMap = {
  [BenzingaEndpoint.CALENDAR]: {
    id: BenzingaEndpoint.CALENDAR,
    name: 'Benzinga Calendar',
    provider: ApiProvider.BENZINGA,
    category: EndpointCategory.BENZINGA_CALENDAR,
    path: '/calendar/earnings',
    method: HttpMethod.GET,
    description: 'Returns earnings calendar data from Benzinga',
    ttl: 6 * 60 * 60, // 6 hours
    requiresSymbol: false,
    parameters: {
      parameters: {
        type: 'string',
        required: false,
        description: 'Comma-separated list of fields to return'
      },
      page: {
        type: 'number',
        required: false,
        description: 'Page number of results',
        default: 0
      },
      page_size: {
        type: 'number',
        required: false,
        description: 'Number of results per page',
        default: 10,
        enum: ['10', '50', '100', '500', '1000']
      },
      date_from: {
        type: 'string',
        required: false,
        description: 'Start date for the calendar (YYYY-MM-DD)'
      },
      date_to: {
        type: 'string',
        required: false,
        description: 'End date for the calendar (YYYY-MM-DD)'
      },
      symbols: {
        type: 'string',
        required: false,
        description: 'Comma-separated list of ticker symbols to filter by'
      },
      token: {
        type: 'string',
        required: false,
        description: 'Pagination token for fetching the next page of results'
      }
    },
    firestorePath: 'market_data/{symbol}/data_points/calendar',
    documentationUrl: 'https://docs.benzinga.com/benzinga/calendar/v2/earnings'
  },
  [BenzingaEndpoint.NEWS]: {
    id: BenzingaEndpoint.NEWS,
    name: 'Benzinga News',
    provider: ApiProvider.BENZINGA,
    category: EndpointCategory.BENZINGA_CALENDAR, // Using BENZINGA_CALENDAR as a temporary category
    path: '/news',
    method: HttpMethod.GET,
    description: 'Returns news articles from Benzinga',
    ttl: 30 * 60, // 30 minutes
    requiresSymbol: false,
    parameters: {
      page: {
        type: 'number',
        required: false,
        description: 'Page number of results',
        default: 0
      },
      page_size: {
        type: 'number',
        required: false,
        description: 'Number of results per page',
        default: 10
      },
      display_output: {
        type: 'string',
        required: false,
        description: 'Output format',
        default: 'full',
        enum: ['full', 'headline', 'abstract']
      },
      date_from: {
        type: 'string',
        required: false,
        description: 'Start date for news (YYYY-MM-DD)'
      },
      date_to: {
        type: 'string',
        required: false,
        description: 'End date for news (YYYY-MM-DD)'
      },
      tickers: {
        type: 'string',
        required: false,
        description: 'Comma-separated list of ticker symbols to filter by'
      }
    },
    firestorePath: 'market_data/{symbol}/data_points/news',
    documentationUrl: 'https://docs.benzinga.com/benzinga/newsfeed/v2'
  }
} as const;

type HandlerConstructor = new (config: EndpointConfig) => BenzingaBaseHandler;

// Only include endpoints that have handlers implemented
const HANDLER_MAP: Partial<Record<BenzingaEndpoint, HandlerConstructor>> = {
  [BenzingaEndpoint.CALENDAR]: BenzingaCalendarHandler,
  // [BenzingaEndpoint.NEWS]: BenzingaNewsHandler, // Uncomment when implemented
} as const;

export class BenzingaHandlerFactory {
  static createHandler<T = any>(
    endpointId: BenzingaEndpoint,
  ): BenzingaBaseHandler<T> {
    if (!this.hasHandler(endpointId)) {
      throw new Error(`No handler registered for endpoint: ${endpointId}`);
    }
    const config = this.getEndpointConfig(endpointId);
    const Handler = this.getHandler(endpointId);
    
    return new Handler(config) as BenzingaBaseHandler<T>;
  }

  static getEndpointConfig(endpointId: BenzingaEndpoint): Readonly<EndpointConfig> {
    const config = ENDPOINT_CONFIGS[endpointId];
    if (!config) {
      throw new Error(`No configuration found for endpoint: ${endpointId}`);
    }
    return Object.freeze({ ...config });
  }

  static getAllEndpointConfigs(): Readonly<EndpointConfigMap> {
    return Object.freeze({ ...ENDPOINT_CONFIGS });
  }

  static getAvailableEndpoints(): BenzingaEndpoint[] {
    return Object.values(BenzingaEndpoint);
  }

  private static getHandler(endpointId: BenzingaEndpoint): HandlerConstructor {
    const Handler = HANDLER_MAP[endpointId];
    if (!Handler) {
      throw new Error(`No handler registered for endpoint: ${endpointId}`);
    }
    return Handler;
  }

  static hasHandler(endpointId: BenzingaEndpoint): boolean {
    return endpointId in HANDLER_MAP;
  }
}
