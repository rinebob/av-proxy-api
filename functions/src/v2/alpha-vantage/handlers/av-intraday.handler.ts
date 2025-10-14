import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import type { ApiResponse } from '@shared/core';
import { createLogger, hr } from '../../utils/utils';
import { AV_ENTITLEMENT_DELAYED } from '@shared/alpha-vantage';

const log = createLogger('av.handler.intraday'); // Abbrev: aV.Intra

export class AvIntradayHandler extends AlphaVantageBaseHandler<any> {
  protected transformResponse(data: any): any {
    // No transform for intraday in PRE; return raw provider payload
    return data;
  }

  public async fetch(params: any = {}): Promise<ApiResponse<any>> {
    const startTime = Date.now();
    const endpoint = this.config.id;
    const requestId = (this as any).requestId;

    // Enforce required params
    const symbol = params?.symbol;
    const interval = params?.interval ?? '1min';

    hr('aV.Intra', `fetch start ${endpoint} ${symbol ?? ''} [${requestId}]`);
    log.info('fetch.start', { endpointId: endpoint, symbol, interval, requestId });

    try {
      // Include AV entitlement (always delayed for intraday)
      const raw = await this.fetchSimple({ symbol, interval, entitlement: AV_ENTITLEMENT_DELAYED });
      const resp = this.createSuccessResponse(raw, this.config.ttl, startTime);
      hr('aV.Intra', `fetch ok [${requestId}] ${Date.now() - startTime}ms`);
      log.info('fetch.success', { endpointId: endpoint, symbol, interval, durationMs: Date.now() - startTime, requestId });
      return resp;
    } catch (e: any) {
      hr('aV.Intra', `fetch error [${requestId}] ${String(e?.message || e)}`);
      log.error('fetch.error', { endpointId: endpoint, symbol, interval, error: String(e?.message || e), requestId });
      throw this.handleError(e);
    }
  }
}
