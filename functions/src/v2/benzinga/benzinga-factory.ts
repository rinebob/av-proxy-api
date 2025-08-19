import { 
  BzCalendarRequestType, 
  BenzingaEndpoint, 
  SvtBzNewsRequest, 
  BenzingaRequestConfig,
  BZ_NEWS_REQUEST_CONFIGS,
  BZ_CALENDAR_REQUEST_CONFIGS
} from '@shared/benzinga';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';

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

// Define handler map type that preserves the specific config type for each handler
type BenzingaHandlerMap = {
  // News endpoints require BenzingaNewsRequestConfig
  [BenzingaEndpoint.NEWS]: typeof BenzingaNewsHandler;
  [SvtBzNewsRequest.BZ_NEWS]: typeof BenzingaNewsHandler;
  [SvtBzNewsRequest.BZ_NEWS_BY_ID]: typeof BenzingaNewsHandler;
  
  // Calendar endpoints use BenzingaRequestConfig
  [BenzingaEndpoint.CALENDAR]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.EARNINGS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.DIVIDENDS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.CONFERENCE_CALLS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.RATINGS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.GUIDANCE]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.SPLITS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.OFFERINGS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.ECONOMICS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.IPOS]: typeof BenzingaCalendarHandler;
  [BzCalendarRequestType.MERGERS_ACQUISITIONS]: typeof BenzingaCalendarHandler;
};

// Handler map - maps endpoint IDs to their handler classes
const HANDLER_MAP: BenzingaHandlerMap = {
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

// Define a mapped type that maps each endpoint to its corresponding return type
type BenzingaHandlerReturnType<T extends HandlerKey> =
  T extends BenzingaEndpoint.NEWS | SvtBzNewsRequest.BZ_NEWS | SvtBzNewsRequest.BZ_NEWS_BY_ID
    ? any  // News handler returns any
    : T extends BenzingaEndpoint.CALENDAR | BzCalendarRequestType
    ? any[] // Calendar handlers return arrays
    : never;

export class BenzingaHandlerFactory {
  /**
   * Gets the configuration for a specific endpoint
   * @template T - The expected config type (defaults to BenzingaRequestConfig)
   * @param endpoint - The endpoint identifier
   * @returns A frozen copy of the endpoint configuration
   */
  static getEndpointConfig<T extends BenzingaRequestConfig = BenzingaRequestConfig>(
    endpoint: HandlerKey
  ): Readonly<T> {
    const endpointConfig = ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig) {
      throw new Error(`No configuration found for endpoint: ${endpoint}`);
    }
    return Object.freeze({ ...endpointConfig }) as Readonly<T>;
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
   * Creates a handler instance for the specified endpoint with proper return type inference
   * @param endpoint The endpoint to create a handler for
   * @returns A handler instance with the correct return type for the endpoint
   */
  static createHandler<T extends HandlerKey>(
    endpoint: T
  ): BenzingaBaseHandler<BenzingaHandlerReturnType<T>> {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`bHF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpoint}`);
    
    try {
      const config = this.getEndpointConfig(endpoint as BenzingaEndpoint);
      const Handler = this.getHandler(endpoint);
      
      console.log(`bHF cH [${requestId}] [FACTORY] Handler created:`, {
        endpointId: endpoint,
        handlerName: Handler.name
      });
      
      // We need to cast here because TypeScript can't infer the exact handler type
      // from the endpoint string, but we know it's correct from our mapping
      return new Handler(config) as unknown as BenzingaBaseHandler<BenzingaHandlerReturnType<T>>;
      
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
