import { DataMaintainerEndpoint } from '../common/common-dm';
import { ENDPOINT_TTLS } from '../common/common-dm';

/**
 * Base interface for all data handlers
 */
export interface IDataHandler {
  /**
   * The endpoint this handler is responsible for
   */
  readonly endpoint: DataMaintainerEndpoint;

  /**
   * Fetches and transforms data for the given symbol
   * @param symbol The symbol to fetch data for
   * @returns The transformed data
   */
  fetchAndTransform(symbol: string): Promise<any>;

  /**
   * Gets the TTL (in seconds) for the data returned by this handler
   */
  getTtl(): number;

  /**
   * Determines if the data should be cached
   * Override in child classes if needed
   */
  shouldCache(): boolean;
}

/**
 * Base class for all data handlers with common functionality
 */
export abstract class BaseDataHandler implements IDataHandler {
  /**
   * Creates a new BaseDataHandler
   * @param endpoint The endpoint this handler is responsible for
   */
  constructor(public readonly endpoint: DataMaintainerEndpoint) {}

  /**
   * Fetches and transforms data for the given symbol
   * Must be implemented by child classes
   * @param symbol The symbol to fetch data for
   */
  abstract fetchAndTransform(symbol: string): Promise<any>;

  /**
   * Gets the TTL (in seconds) for the data returned by this handler
   * Defaults to the value from ENDPOINT_TTLS
   */
  getTtl(): number {
    return ENDPOINT_TTLS[this.endpoint] || 3600; // Default to 1 hour if not specified
  }

  /**
   * Determines if the data should be cached
   * Can be overridden by child classes if needed
   */
  shouldCache(): boolean {
    return true; // Default to caching enabled
  }

  /**
   * Helper method to handle API errors consistently
   * @param error The error that occurred
   * @param context Additional context about the error
   */
  protected handleError(error: any, context: { symbol: string; [key: string]: any }): never {
    const errorMessage = `Error in ${this.endpoint} handler for ${context.symbol}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    console.error(errorMessage, { ...context, error });
    throw new Error(errorMessage);
  }

  /**
   * Validates the symbol before processing
   * @param symbol The symbol to validate
   * @throws Error if the symbol is invalid
   */
  protected validateSymbol(symbol: string): void {
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      throw new Error('Symbol is required and must be a non-empty string');
    }
  }
}

/**
 * Factory function to create the appropriate handler for an endpoint
 * @param endpoint The endpoint to create a handler for
 * @returns An instance of the appropriate handler
 */
export function createHandler(endpoint: DataMaintainerEndpoint): IDataHandler {
  // Lazy load handlers to avoid circular dependencies
  switch (endpoint) {
    case DataMaintainerEndpoint.COMPANY_OVERVIEW:
      return new (require('./api-handlers/av-company-overview').AvCompanyOverviewHandler)();
    // Add other handlers here as they're implemented
    default:
      throw new Error(`No handler implemented for endpoint: ${endpoint}`);
  }
}
