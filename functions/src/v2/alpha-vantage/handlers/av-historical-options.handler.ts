// Type-only imports
import type { ApiResponse } from '@shared/core';
import type { AvHistoricalOptionsResponse } from '@shared/alpha-vantage';

// Value imports
import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider, DATA_PROVIDERS } from '@shared/core';
import { getAlphaVantageApiKey } from '../../utils/utils';
import { HistoricalOptionsRetrievalService } from '../../historical-options-corpus/services/historical-options-retrieval.service';

/**
 * Handler for the Alpha Vantage Historical Options endpoint
 * @see https://www.alphavantage.co/documentation/#historical-options
 */
export class AvHistoricalOptionsHandler extends AlphaVantageBaseHandler<AvHistoricalOptionsResponse> {
  protected readonly endpoint = AlphaVantageEndpoint.HISTORICAL_OPTIONS;

  private readonly retrievalService: HistoricalOptionsRetrievalService;

  constructor(config: any) {
    super(config);

    this.retrievalService = new HistoricalOptionsRetrievalService({
      axiosInstance: this.apiClient,
      throttle: { wait: async () => {} },
      apiKey: getAlphaVantageApiKey(),
      baseUrl: this.apiClient.defaults.baseURL ?? DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE].baseUrl,
    });
  }

  /**
   * Fetches historical options data from Alpha Vantage.
   *
   * Delegates to HistoricalOptionsRetrievalService so the handler is a thin
   * adapter and the partner/gateway/corpus paths share one normalization seam.
   */
  public async fetch(params: Record<string, any>): Promise<ApiResponse<AvHistoricalOptionsResponse>> {
    const startTime = Date.now();
    const { symbol, date } = params;
    const { response } = await this.retrievalService.fetch({ symbol, date });
    return this.createSuccessResponse(response, this.config.ttl, startTime);
  }

  // Satisfies the abstract base-class contract. This handler now delegates
  // transformation to HistoricalOptionsRetrievalService, so this method is not
  // called on the historical-options code path.
  protected transformResponse(_data: any): AvHistoricalOptionsResponse {
    throw new Error('AvHistoricalOptionsHandler.transformResponse is deprecated; use retrievalService.fetch()');
  }
}
