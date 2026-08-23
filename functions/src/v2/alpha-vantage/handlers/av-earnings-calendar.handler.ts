// Type-only imports
import type { ApiResponse } from '@shared/core';
import type { AvEarningsCalendarEntry } from '@shared/alpha-vantage';

// Value imports
import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { saveAvData } from '../firestore/av-standard-data.writer';
import { parseCsv } from '../utils/av-csv-parser.utils';
import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { createLogger } from '../../utils/utils';

const log = createLogger('av.handler.earnings-calendar'); // Abbrev: aEC.H

/**
 * Handler for the Alpha Vantage EARNINGS_CALENDAR endpoint.
 *
 * This endpoint returns CSV (not JSON), so it cannot use the standard base
 * handler's transformResponse flow. Instead, it overrides fetch() to:
 * 1. Call AV with function=EARNINGS_CALENDAR, horizon=12month (no symbol)
 * 2. Parse the CSV response using parseCsv()
 * 3. Read tracked_symbols from Firestore
 * 4. Filter entries to tracked symbols only
 * 5. Save the filtered result via saveAvData (global doc, no symbol)
 *
 * @see https://www.alphavantage.co/documentation/#earnings-calendar
 */
export class AvEarningsCalendarHandler extends AlphaVantageBaseHandler<AvEarningsCalendarEntry[]> {
  protected readonly endpoint = AlphaVantageEndpoint.EARNINGS_CALENDAR;

  /**
   * Fetches the global earnings calendar from AV, parses the CSV response,
   * filters to tracked symbols, and saves the filtered result.
   */
  public override async fetch(params: Record<string, any> = {}): Promise<ApiResponse<AvEarningsCalendarEntry[]>> {
    const startTime = Date.now();
    const endpoint = this.config.id;

    log.info('fetch.start', { endpointId: endpoint, requestId: this.requestId });

    try {
      // 1. Prepare request params — no symbol, horizon defaults to 12month
      const requestParams = this.prepareRequestParams({
        ...params,
        horizon: params.horizon ?? '12month',
      });

      // 2. Call AV API
      const response = await this.apiClient.get('', { params: requestParams });
      const csvText: string = response.data;

      // 3. Parse CSV
      const rows = parseCsv(csvText);
      if (rows.length < 2) {
        // Headers only or empty — no data rows
        log.info('fetch.empty_csv', { endpointId: endpoint, requestId: this.requestId, rowCount: rows.length });
        await this.saveAndReturn([], startTime);
        return this.createSuccessResponse([], this.config.ttl, startTime);
      }

      // 4. Map rows to AvEarningsCalendarEntry[]
      const headers = rows[0];
      const entries: AvEarningsCalendarEntry[] = rows.slice(1).map(row => {
        const get = (header: string): string => {
          const idx = headers.indexOf(header);
          return idx >= 0 ? (row[idx] ?? '') : '';
        };
        return {
          symbol: get('symbol'),
          name: get('name'),
          reportDate: get('reportDate'),
          fiscalDateEnding: get('fiscalDateEnding'),
          estimate: get('estimate'),
          currency: get('currency') || get('exchange'),
          timeOfTheDay: get('timeOfTheDay'),
        };
      });

      // 5. Read tracked symbols from Firestore
      const trackedDocs = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).listDocuments();
      const trackedSymbols = new Set(trackedDocs.map(doc => doc.id));

      // 6. Filter entries to tracked symbols only
      const filtered = entries.filter(entry => trackedSymbols.has(entry.symbol));

      log.info('fetch.filter', {
        endpointId: endpoint,
        requestId: this.requestId,
        totalEntries: entries.length,
        trackedCount: trackedSymbols.size,
        filteredCount: filtered.length,
      });

      // 7. Save and return
      await this.saveAndReturn(filtered, startTime);
      return this.createSuccessResponse(filtered, this.config.ttl, startTime);

    } catch (error) {
      log.error('fetch.error', { endpointId: endpoint, requestId: this.requestId, error: String((error as any)?.message || error) });
      throw this.handleError(error);
    }
  }

  /**
   * Saves the filtered entries to Firestore via saveAvData.
   * Uses empty string as symbol (global doc) since this is a global calendar.
   */
  private async saveAndReturn(entries: AvEarningsCalendarEntry[], startTime: number): Promise<void> {
    const endpoint = this.config.id;
    log.info('firestore.save', { endpointId: endpoint, requestId: this.requestId, entryCount: entries.length });

    await saveAvData(
      entries,
      '', // global doc — no symbol
      endpoint as AlphaVantageEndpoint,
      this.config,
    );
  }

  // Satisfies the abstract base-class contract. This handler overrides fetch()
  // and does CSV parsing inline, so transformResponse is not used.
  protected transformResponse(_data: any): AvEarningsCalendarEntry[] {
    throw new Error('AvEarningsCalendarHandler.transformResponse is deprecated; CSV parsing is inline in fetch()');
  }
}
