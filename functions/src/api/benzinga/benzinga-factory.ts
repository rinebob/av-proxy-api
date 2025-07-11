import { BzCompanyDataCalendarType, BzMarketDataCalendarType, BenzingaEndpoint } from '../../common/common-benz';
import { EndpointConfig } from '../common/types';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';

// Import endpoint configurations
import { ALL_BENZINGA_ENDPOINT_CONFIGS } from './config/bz-endpoint-configs';

// Import concrete handlers
import { BenzingaCalendarHandler } from './handlers/benzinga-calendar.handler';

// Define a mapped type that ensures all BenzingaEndpoints have a config
type BenzingaEndpointConfigs = {
  [K in BenzingaEndpoint]: EndpointConfig & { id: K };
};

// Define a union type of all possible handler keys
export type HandlerKey = BenzingaEndpoint | BzCompanyDataCalendarType | BzMarketDataCalendarType;

// Use the imported endpoint configurations
const ENDPOINT_CONFIGS: BenzingaEndpointConfigs = ALL_BENZINGA_ENDPOINT_CONFIGS as unknown as BenzingaEndpointConfigs;

// Handler map - maps endpoint IDs to their handler classes
const HANDLER_MAP: Record<HandlerKey, new (config: EndpointConfig) => BenzingaBaseHandler> = {
  // Company Data Endpoints
  [BzCompanyDataCalendarType.EARNINGS]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.DIVIDENDS]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.CONFERENCE_CALLS]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.RATINGS]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.GUIDANCE]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.SPLITS]: BenzingaCalendarHandler,
  [BzCompanyDataCalendarType.OFFERINGS]: BenzingaCalendarHandler,
  
  // Market Data Endpoints
  [BzMarketDataCalendarType.ECONOMICS]: BenzingaCalendarHandler,
  [BzMarketDataCalendarType.IPOS]: BenzingaCalendarHandler,
  [BzMarketDataCalendarType.FDA]: BenzingaCalendarHandler,
  [BzMarketDataCalendarType.MERGERS_ACQUISITIONS]: BenzingaCalendarHandler,

  // Top-level endpoints
  [BenzingaEndpoint.CALENDAR]: BenzingaCalendarHandler,
  [BenzingaEndpoint.NEWS]: BenzingaCalendarHandler,
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
  private static getHandler(endpoint: HandlerKey) {
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
    endpoint: HandlerKey,
  ): BenzingaBaseHandler<T> {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`bHF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpoint}`);
    
    try {
      const config = this.getEndpointConfig(endpoint as BenzingaEndpoint);
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
  static hasHandler(endpoint: HandlerKey): boolean {
    return endpoint in HANDLER_MAP;
  }
}
