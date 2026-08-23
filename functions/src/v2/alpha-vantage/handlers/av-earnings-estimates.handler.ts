import { AlphaVantageStandardHandlerBase } from './alpha-vantage-standard-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import { createLogger } from '../../utils/utils';
import type { AvEarningsEstimatesResponse, AvEarningsEstimate } from '@shared/alpha-vantage';

const log = createLogger('av.handler.earnings-estimates'); // Abbrev: aEE.H

/**
 * Handler for the Alpha Vantage EARNINGS_ESTIMATES endpoint.
 * Extends AlphaVantageStandardHandlerBase which handles the full fetch → transform → save pipeline.
 * @see https://www.alphavantage.co/documentation/#earnings-estimates
 */
export class AvEarningsEstimatesHandler extends AlphaVantageStandardHandlerBase<AvEarningsEstimatesResponse> {
  /**
   * Transforms the raw Alpha Vantage API response into a typed AvEarningsEstimatesResponse.
   * Extracts the estimates array, preserving null values on revision count fields.
   * @param data Raw API response data
   * @returns Transformed earnings estimates data
   */
  protected transformResponse(data: any): AvEarningsEstimatesResponse {
    validateAlphaVantageApiResponse(data);
    log.debug('transform.start', { requestId: this.requestId });

    const estimates: AvEarningsEstimate[] = Array.isArray(data?.estimates)
      ? data.estimates.map((entry: any) => ({
          date: entry?.date ?? '',
          horizon: entry?.horizon,
          eps_estimate_average: entry?.eps_estimate_average ?? '',
          eps_estimate_high: entry?.eps_estimate_high ?? '',
          eps_estimate_low: entry?.eps_estimate_low ?? '',
          eps_estimate_analyst_count: entry?.eps_estimate_analyst_count ?? '',
          eps_estimate_average_7_days_ago: entry?.eps_estimate_average_7_days_ago ?? '',
          eps_estimate_average_30_days_ago: entry?.eps_estimate_average_30_days_ago ?? '',
          eps_estimate_average_60_days_ago: entry?.eps_estimate_average_60_days_ago ?? '',
          eps_estimate_average_90_days_ago: entry?.eps_estimate_average_90_days_ago ?? '',
          eps_estimate_revision_up_trailing_7_days: entry?.eps_estimate_revision_up_trailing_7_days ?? null,
          eps_estimate_revision_down_trailing_7_days: entry?.eps_estimate_revision_down_trailing_7_days ?? null,
          eps_estimate_revision_up_trailing_30_days: entry?.eps_estimate_revision_up_trailing_30_days ?? null,
          eps_estimate_revision_down_trailing_30_days: entry?.eps_estimate_revision_down_trailing_30_days ?? null,
          revenue_estimate_average: entry?.revenue_estimate_average ?? '',
          revenue_estimate_high: entry?.revenue_estimate_high ?? '',
          revenue_estimate_low: entry?.revenue_estimate_low ?? '',
          revenue_estimate_analyst_count: entry?.revenue_estimate_analyst_count ?? '',
        }))
      : [];

    const result: AvEarningsEstimatesResponse = {
      symbol: data?.symbol ?? '',
      estimates,
    };

    log.info('transform.success', {
      requestId: this.requestId,
      symbol: result.symbol,
      estimateCount: estimates.length,
    });

    return result;
  }
}
