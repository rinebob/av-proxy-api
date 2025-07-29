import { BzCalendarRequestType, BenzingaEndpoint, SvtBzNewsRequest, BenzingaRequestConfig } from '../common/common-benz';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';

// Import endpoint configurations
import { BZ_NEWS_REQUEST_CONFIGS } from './request-configs/bz-news-request-configs';
import { BZ_CALENDAR_REQUEST_CONFIGS } from './request-configs/bz-calendar-request-configs';

// Import concrete handlers
import { BenzingaCalendarHandler } from './handlers/benzinga-calendar.handler';
import { BenzingaNewsHandler } from './handlers/benzinga-news.handler';

// Define a mapped type that ensures all BenzingaEndpoints have a config
type BenzingaRequestConfigs = {
  [K in BzCalendarRequestType | SvtBzNewsRequest | BenzingaEndpoint]: BenzingaRequestConfig & { id: K };
};

// Define a union type of all possible handler keys
export type HandlerKey = BenzingaEndpoint | BzCalendarRequestType | SvtBzNewsRequest;

// Combine all endpoint configurations
const ENDPOINT_CONFIGS: BenzingaRequestConfigs = {
  ...BZ_NEWS_REQUEST_CONFIGS,
  ...BZ_CALENDAR_REQUEST_CONFIGS,
} as unknown as BenzingaRequestConfigs;

// Handler map - maps endpoint IDs to their handler classes
const HANDLER_MAP: Record<HandlerKey, new (config: BenzingaRequestConfig) => BenzingaBaseHandler> = {
  // Top-level endpoints
  [BenzingaEndpoint.NEWS]: BenzingaNewsHandler,
  [BenzingaEndpoint.CALENDAR]: BenzingaCalendarHandler,
  
  // Calendar endpoints
  [BzCalendarRequestType.EARNINGS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.DIVIDENDS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.CONFERENCE_CALLS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.RATINGS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.GUIDANCE]: BenzingaCalendarHandler,
  [BzCalendarRequestType.SPLITS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.OFFERINGS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.ECONOMICS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.IPOS]: BenzingaCalendarHandler,
  [BzCalendarRequestType.MERGERS_ACQUISITIONS]: BenzingaCalendarHandler,
  
  // News endpoints
  [SvtBzNewsRequest.BZ_NEWS]: BenzingaNewsHandler,
  [SvtBzNewsRequest.BZ_NEWS_BY_ID]: BenzingaNewsHandler,
};

export class BenzingaHandlerFactory {
  /**
   * Gets the configuration for a specific endpoint
   */
  static getEndpointConfig(endpoint: HandlerKey): Readonly<BenzingaRequestConfig> {
    const endpointConfig = ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig) {
      throw new Error(`No configuration found for endpoint: ${endpoint}`);
    }
    return Object.freeze({ ...endpointConfig });
  }

  /**
   * Gets all available endpoint configurations
   */
  static getAllEndpointConfigs(): Readonly<Record<string, BenzingaRequestConfig>> {
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
  static getAvailableEndpoints(): HandlerKey[] {
    return Object.keys(ENDPOINT_CONFIGS) as BenzingaEndpoint[];
  }

  /**
   * Checks if a handler exists for the specified endpoint
   */
  static hasHandler(endpoint: HandlerKey): boolean {
    return endpoint in HANDLER_MAP;
  }
}
