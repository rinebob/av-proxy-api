import { DataMaintainerEndpoint } from '../../common/common-dm';

type MockDataRegistry = Map<DataMaintainerEndpoint, Map<string, any>>;

/**
 * Service for managing mock data for various endpoints and symbols
 * Provides type-safe access to mock data for testing and development
 */
export class MockDataService {
  private registry: MockDataRegistry = new Map();

  /**
   * Register mock data for a specific endpoint and symbol
   * @param endpoint The endpoint to register data for
   * @param symbol The symbol to register data for (case-insensitive)
   * @param data The mock data to store
   */
  public register<T = any>(endpoint: DataMaintainerEndpoint, symbol: string, data: T): void {
    const endpointMap = this.getEndpointMap(endpoint);
    endpointMap.set(symbol.toUpperCase(), data);
  }

  /**
   * Register multiple mock data entries for an endpoint
   * @param endpoint The endpoint to register data for
   * @param data Object mapping symbols to their mock data
   */
  public registerBulk<T = any>(endpoint: DataMaintainerEndpoint, data: Record<string, T>): void {
    const endpointMap = this.getEndpointMap(endpoint);
    Object.entries(data).forEach(([symbol, symbolData]) => {
      endpointMap.set(symbol.toUpperCase(), symbolData);
    });
  }

  /**
   * Get mock data for a specific endpoint and symbol
   * @param endpoint The endpoint to get data for
   * @param symbol The symbol to get data for (case-insensitive)
   * @returns The mock data or undefined if not found
   */
  public get<T = any>(endpoint: DataMaintainerEndpoint, symbol: string): T | undefined {
    const symbolUpper = symbol.toUpperCase();
    const endpointData = this.registry.get(endpoint);
    
    if (!endpointData || !endpointData.has(symbolUpper)) {
      return undefined;
    }

    return endpointData.get(symbolUpper) as T;
  }

  /**
   * Check if mock data exists for a specific endpoint and symbol
   * @param endpoint The endpoint to check
   * @param symbol The symbol to check (case-insensitive)
   * @returns True if mock data exists, false otherwise
   */
  public has(endpoint: DataMaintainerEndpoint, symbol: string): boolean {
    const symbolUpper = symbol.toUpperCase();
    
    // Debug log the incoming parameters
    console.log(`mDSvc has: Checking for endpoint=${endpoint}, symbol=${symbolUpper}`);
    
    // Check if endpoint exists
    const hasEndpoint = this.registry.has(endpoint);
    console.log(`mDSvc has: Endpoint '${endpoint}' exists: ${hasEndpoint}`);
    
    let hasSymbol = false;
    if (hasEndpoint) {
      const endpointData = this.registry.get(endpoint)!;
      hasSymbol = endpointData.has(symbolUpper);
      console.log(`mDSvc has: Symbol '${symbolUpper}' exists in endpoint '${endpoint}': ${hasSymbol}`);
      
      // Debug: Check for case sensitivity issues
      if (!hasSymbol) {
        const allSymbols = Array.from(endpointData.keys());
        const matchingSymbols = allSymbols.filter(s => s.toUpperCase() === symbolUpper);
        if (matchingSymbols.length > 0) {
          console.log(`mDSvc has: Found case-insensitive match for '${symbolUpper}': ${matchingSymbols.join(', ')}`);
        }
      }
    } else {
      console.log(`mDSvc has: Available endpoints: ${Array.from(this.registry.keys()).join(', ')}`);
    }
    
    const hasData = hasEndpoint && hasSymbol;
    
    if (!hasData) {
      console.log(`mDSvc has: No mock data found for endpoint=${endpoint}, symbol=${symbolUpper}`);
      if (this.registry.has(endpoint)) {
        const symbols = Array.from(this.registry.get(endpoint)!.keys());
        console.log(`mDSvc has: Available symbols for ${endpoint} (${symbols.length}): ${symbols.join(', ')}`);
      }
    }
    
    return hasData;
  }

  /**
   * Get all registered endpoints
   * @returns Set of all registered endpoints
   */
  public getEndpoints(): Set<DataMaintainerEndpoint> {
    return new Set(this.registry.keys());
  }

  /**
   * Get all registered symbols for an endpoint
   * @param endpoint The endpoint to get symbols for
   * @returns Array of symbols (empty array if endpoint not found)
   */
  public getSymbols(endpoint: DataMaintainerEndpoint): string[] {
    const endpointData = this.registry.get(endpoint);
    return endpointData ? Array.from(endpointData.keys()) : [];
  }

  /**
   * Get the internal map for an endpoint, creating it if it doesn't exist
   * @param endpoint The endpoint to get the map for
   * @returns The Map of symbol to mock data for the endpoint
   * @private
   */
  private getEndpointMap(endpoint: DataMaintainerEndpoint): Map<string, any> {
    if (!this.registry.has(endpoint)) {
      this.registry.set(endpoint, new Map());
    }
    return this.registry.get(endpoint)!;
  }
}

export const mockDataService = new MockDataService();
