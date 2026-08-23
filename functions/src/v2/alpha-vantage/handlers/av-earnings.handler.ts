import { AlphaVantageStandardHandlerBase } from './alpha-vantage-standard-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import { createLogger } from '../../utils/utils';
import type { AvEarningsResponse, AvAnnualEarning, AvQuarterlyEarning } from '@shared/alpha-vantage';

const log = createLogger('av.handler.earnings'); // Abbrev: aE.H

/**
 * Handler for the Alpha Vantage EARNINGS endpoint.
 * Extends AlphaVantageStandardHandlerBase which handles the full fetch → transform → save pipeline.
 * @see https://www.alphavantage.co/documentation/#earnings
 */
export class AvEarningsHandler extends AlphaVantageStandardHandlerBase<AvEarningsResponse> {
  /**
   * Transforms the raw Alpha Vantage API response into a typed AvEarningsResponse object.
   * Extracts annualEarnings and quarterlyEarnings arrays, preserving reportTime on quarterly entries.
   * @param data Raw API response data
   * @returns Transformed earnings data
   */
  protected transformResponse(data: any): AvEarningsResponse {
    validateAlphaVantageApiResponse(data);
    log.debug('transform.start', { requestId: this.requestId });

    const annualEarnings: AvAnnualEarning[] = Array.isArray(data?.annualEarnings)
      ? data.annualEarnings.map((entry: any) => ({
          fiscalDateEnding: entry?.fiscalDateEnding ?? '',
          reportedEPS: entry?.reportedEPS ?? '',
        }))
      : [];

    const quarterlyEarnings: AvQuarterlyEarning[] = Array.isArray(data?.quarterlyEarnings)
      ? data.quarterlyEarnings.map((entry: any) => ({
          fiscalDateEnding: entry?.fiscalDateEnding ?? '',
          reportedDate: entry?.reportedDate ?? '',
          reportedEPS: entry?.reportedEPS ?? '',
          estimatedEPS: entry?.estimatedEPS ?? '',
          surprise: entry?.surprise ?? '',
          surprisePercentage: entry?.surprisePercentage ?? '',
          reportTime: entry?.reportTime,
        }))
      : [];

    const result: AvEarningsResponse = {
      symbol: data?.symbol ?? '',
      annualEarnings,
      quarterlyEarnings,
    };

    log.info('transform.success', {
      requestId: this.requestId,
      symbol: result.symbol,
      annualCount: annualEarnings.length,
      quarterlyCount: quarterlyEarnings.length,
    });

    return result;
  }
}
