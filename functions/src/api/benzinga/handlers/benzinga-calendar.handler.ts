import { EndpointConfig, ApiResponse } from '../../common/types';
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
  constructor(config: EndpointConfig) {
    super(config);
  }

  protected validateParams(params: Record<string, any>): void {
    const requiredParams = ['parameters'];
    
    for (const param of requiredParams) {
      if (!params[param]) {
        throw new Error(`Missing required parameter: ${param}`);
      }
    }
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    const preparedParams = { ...params };
    
    // Convert array parameters to comma-separated strings if needed
    if (preparedParams.parameters && Array.isArray(preparedParams.parameters)) {
      preparedParams.parameters = preparedParams.parameters.join(',');
    }
    
    if (preparedParams.symbols && Array.isArray(preparedParams.symbols)) {
      preparedParams.symbols = preparedParams.symbols.join(',');
    }

    return preparedParams;
  }

  protected transformResponse(data: any): CalendarEvent[] {
    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.map((event: any) => ({
      date: event.date || '',
      time: event.time,
      ticker: event.ticker || '',
      name: event.name || '',
      exchange: event.exchange || '',
      eps: event.eps || null,
      eps_estimated: event.eps_estimated || null,
      time_updated: event.time_updated || '',
      date_updated: event.date_updated || ''
    }));
  }

  public async fetch(params: Record<string, any> = {}): Promise<ApiResponse<CalendarEvent[]>> {
    try {
      this.validateParams(params);
      const preparedParams = this.prepareRequestParams(params);
      const response = await super.fetch(preparedParams);
      const transformedResponse = this.transformResponse(response.data);
      return { ...response, data: transformedResponse };
    } catch (error) {
      // Add specific error handling for calendar endpoint if needed
      throw error;
    }
  }
}
