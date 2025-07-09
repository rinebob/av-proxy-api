import { CompanyDataEndpoint, MarketDataEndpoint, BenzingaEndpoint } from '../../common/common-benz';
import { EndpointConfig } from '../common/types';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';

// Import endpoint configurations
import { BENZINGA_ENDPOINT_CONFIGS } from './config/bz-endpoint-configs';

// Import concrete handlers
import { BenzingaCalendarHandler } from './handlers/benzinga-calendar.handler';
// Import other handlers as they are implemented
// import { BenzingaNewsHandler } from './handlers/benzinga-news.handler';

// Define a mapped type that ensures all BenzingaEndpoints have a config
type BenzingaEndpointConfigs = {
  [K in BenzingaEndpoint]: EndpointConfig & { id: K };
};

// Use the imported endpoint configurations
const ENDPOINT_CONFIGS: BenzingaEndpointConfigs = BENZINGA_ENDPOINT_CONFIGS as BenzingaEndpointConfigs;

// Handler map - maps endpoint IDs to their handler classes
const HANDLER_MAP: Record<BenzingaEndpoint, new (config: EndpointConfig) => BenzingaBaseHandler> = {
  // Company Data Endpoints
  [CompanyDataEndpoint.EARNINGS]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.DIVIDENDS]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.CONFERENCE_CALLS]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.RATINGS]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.GUIDANCE]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.SPLITS]: BenzingaCalendarHandler,
  [CompanyDataEndpoint.OFFERINGS]: BenzingaCalendarHandler,
  
  // Market Data Endpoints
  [MarketDataEndpoint.ECONOMICS]: BenzingaCalendarHandler,
  [MarketDataEndpoint.IPOS]: BenzingaCalendarHandler,
  [MarketDataEndpoint.FDA]: BenzingaCalendarHandler,
  [MarketDataEndpoint.MERGERS_ACQUISITIONS]: BenzingaCalendarHandler,
  [MarketDataEndpoint.NEWS]: BenzingaCalendarHandler,
};

export class BenzingaHandlerFactory {
  /**
   * Gets the configuration for a specific endpoint
   */
  static getEndpointConfig(endpoint: BenzingaEndpoint): Readonly<EndpointConfig> {
    const config = ENDPOINT_CONFIGS[endpoint];
    if (!config) {
      throw new Error(`No configuration found for endpoint: ${endpoint}`);
    }
    return Object.freeze({ ...config });
  }

  /**
   * Gets all available endpoint configurations
   */
  static getAllEndpointConfigs(): Readonly<Record<BenzingaEndpoint, EndpointConfig>> {
    return Object.freeze({ ...ENDPOINT_CONFIGS });
  }

  /**
   * Gets the handler constructor for a specific endpoint
   */
  private static getHandler(endpoint: BenzingaEndpoint) {
    const Handler = HANDLER_MAP[endpoint];
    if (!Handler) {
      throw new Error(`No handler registered for endpoint: ${endpoint}`);
    }
    return Handler;
  }

  /**
   * Creates a handler instance for the specified endpoint
   */
  static createHandler<T = any>(
    endpoint: BenzingaEndpoint,
  ): BenzingaBaseHandler<T> {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`bHF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpoint}`);
    
    try {
      const config = this.getEndpointConfig(endpoint);
      const Handler = this.getHandler(endpoint);
      
      console.log(`bHF cH [${requestId}] [FACTORY] Handler created:`, {
        endpointId: endpoint,
        handlerName: Handler.name
      });
      
      const handler = new Handler(config);
      
      console.log(`bHF cH [${requestId}] [FACTORY] Successfully created handler for endpoint: ${endpoint}`);
      return handler;
      
    } catch (error) {
      console.error(`bHF cH [${requestId}] [FACTORY] Error creating handler for endpoint ${endpoint}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Gets all available endpoint IDs
   */
  static getAvailableEndpoints(): BenzingaEndpoint[] {
    return Object.keys(ENDPOINT_CONFIGS) as BenzingaEndpoint[];
  }

  /**
   * Checks if a handler exists for the specified endpoint
   */
  static hasHandler(endpoint: BenzingaEndpoint): boolean {
    return endpoint in HANDLER_MAP;
  }
}
