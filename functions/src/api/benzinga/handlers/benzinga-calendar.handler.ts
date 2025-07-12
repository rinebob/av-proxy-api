import { BenzingaEndpointConfig } from '../config/bz-endpoint-configs';
import { BenzingaBaseHandler } from './benzinga-base.handler';

export interface CalendarEvent {
  date: string;
  time?: string;
  ticker: string;
  name: string;
  exchange: string;
  eps: string | null;
  eps_estimated: string | null;
  time_updated: string;
  date_updated: string;
  // Add other fields as needed from the Benzinga API response
}

export class BenzingaCalendarHandler extends BenzingaBaseHandler<CalendarEvent[]> {
  constructor(config: BenzingaEndpointConfig) {
    super(config);
  }

  protected validateParams(params: Record<string, any>): void {
    // No specific validation needed for calendar handler as prepareRequestParams handles defaults.
  }


  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    const preparedParams = { ...params };
    
    // Ensure required parameters have proper defaults
    if (!preparedParams.page) preparedParams.page = '0';
    if (!preparedParams.pagesize) preparedParams.pagesize = '20';
    if (!preparedParams.type) preparedParams.type = 'earnings';
    
    // Convert array parameters to comma-separated strings if needed
    if (preparedParams.tickers && Array.isArray(preparedParams.tickers)) {
      preparedParams.tickers = preparedParams.tickers.join(',');
    }
    
    // Ensure date format is correct
    if (!preparedParams.date_from) {
      const today = new Date();
      preparedParams.date_from = today.toISOString().split('T')[0];
    }
    
    if (!preparedParams.date_to) {
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      preparedParams.date_to = oneYearFromNow.toISOString().split('T')[0];
    }

    return preparedParams;
  }

  /**
   * Process the request by calling the base handler's fetch method.
   * @param params The request parameters.
   * @returns A promise that resolves with the API response.
   */
  protected async processRequest(params: Record<string, any>): Promise<any> {
    return this.fetch(params);
  }

  // Override transformResponse to pass through raw data
  protected transformResponse(data: any): any {
    return data;
  }

}
