import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import { createLogger } from '../../utils/utils';
import { AvCompanyOverview, TrackedSymbolCompanyInfo, TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../firebase-admin-init';
import type { ApiResponse } from '@shared/core';

const log = createLogger('av.handler.company-overview'); // Abbrev: aCO.H

/** Fields copied from AvCompanyOverview into the tracked-symbols doc for sorting/filtering. */
const COMPANY_INFO_FIELDS: ReadonlyArray<keyof TrackedSymbolCompanyInfo> = [
  'Symbol', 'AssetType', 'Name', 'Description', 'CIK',
  'Exchange', 'Currency', 'Country', 'Sector', 'Industry',
  'Address', 'OfficialSite', 'FiscalYearEnd',
];

/**
 * Handler for the Alpha Vantage Company Overview endpoint.
 * Extends AlphaVantageBaseHandler which handles the full fetch → transform → save pipeline.
 * After a successful fetch, denormalizes the stable company identity fields into the
 * tracked-symbols doc so consumers can sort/filter by Sector and Industry without a join.
 * @see https://www.alphavantage.co/documentation/#company-overview
 */
export class AvCompanyOverviewHandler extends AlphaVantageBaseHandler<AvCompanyOverview> {
  /**
   * Fetches company overview data, saves to symbol-data, then writes the stable
   * TrackedSymbolCompanyInfo subset back to the tracked-symbols doc.
   */
  public override async fetch(params: Record<string, any>): Promise<ApiResponse<AvCompanyOverview>> {
    const response = await super.fetch(params);

    // Write-back: only proceed if we got non-empty data and have a symbol
    const symbol: string | undefined = params.symbol;
    const data = response?.data;
    if (symbol && data && Object.keys(data).length > 0) {
      try {
        const typedData = data as AvCompanyOverview;
        const companyInfo = COMPANY_INFO_FIELDS.reduce((acc, key) => {
          const val = typedData[key as keyof AvCompanyOverview];
          if (val !== undefined) acc[key] = val;
          return acc;
        }, {} as Partial<TrackedSymbolCompanyInfo>);

        await db
          .collection(FirestoreCollection.TRACKED_SYMBOLS)
          .doc(symbol.toUpperCase())
          .set(
            {
              [TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO]: companyInfo,
              [TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO_LAST_UPDATED]: Timestamp.now(),
            },
            { merge: true }
          );

        log.info('tracked_symbols.company_info_updated', { symbol, requestId: this.requestId });
      } catch (writeErr: any) {
        // # Reason: Don't fail the primary fetch if the write-back fails — the symbol-data doc
        // was already saved successfully. Log and continue.
        log.error('tracked_symbols.company_info_update_failed', {
          symbol,
          requestId: this.requestId,
          error: String(writeErr?.message || writeErr),
        });
      }
    }

    return response;
  }

  /**
   * Transforms the raw Alpha Vantage API response into a typed AvCompanyOverview object.
   * @param data Raw API response data
   * @returns Transformed company overview data
   */
  protected transformResponse(data: any): AvCompanyOverview {
    validateAlphaVantageApiResponse(data);
    console.log(` aCO.H tR [${this.requestId}] start`);
    log.debug('transform.start', { requestId: this.requestId });
    
    console.log(` aCO.H tR [${this.requestId}] symbol=${data?.Symbol || 'unknown'}`);

    try {
      // Map the response fields to our interface
      const result: Partial<AvCompanyOverview> = {};
      const fieldMappings: Record<keyof AvCompanyOverview, string | string[]> = {
        Symbol: 'Symbol',
        AssetType: 'AssetType',
        Name: 'Name',
        Description: 'Description',
        CIK: 'CIK',
        Exchange: 'Exchange',
        Currency: 'Currency',
        Country: 'Country',
        Sector: 'Sector',
        Industry: 'Industry',
        Address: 'Address',
        FiscalYearEnd: 'FiscalYearEnd',
        LatestQuarter: 'LatestQuarter',
        MarketCapitalization: 'MarketCapitalization',
        EBITDA: 'EBITDA',
        PERatio: 'PERatio',
        PEGRatio: 'PEGRatio',
        BookValue: 'BookValue',
        DividendPerShare: 'DividendPerShare',
        DividendYield: 'DividendYield',
        EPS: 'EPS',
        RevenuePerShareTTM: 'RevenuePerShareTTM',
        ProfitMargin: 'ProfitMargin',
        OperatingMarginTTM: 'OperatingMarginTTM',
        ReturnOnAssetsTTM: 'ReturnOnAssetsTTM',
        ReturnOnEquityTTM: 'ReturnOnEquityTTM',
        RevenueTTM: 'RevenueTTM',
        GrossProfitTTM: 'GrossProfitTTM',
        DilutedEPSTTM: 'DilutedEPSTTM',
        QuarterlyEarningsGrowthYOY: 'QuarterlyEarningsGrowthYOY',
        QuarterlyRevenueGrowthYOY: 'QuarterlyRevenueGrowthYOY',
        AnalystTargetPrice: 'AnalystTargetPrice',
        TrailingPE: 'TrailingPE',
        ForwardPE: 'ForwardPE',
        PriceToSalesRatioTTM: 'PriceToSalesRatioTTM',
        PriceToBookRatio: 'PriceToBookRatio',
        EVToRevenue: 'EVToRevenue',
        EVToEBITDA: 'EVToEBITDA',
        Beta: 'Beta',
        '52WeekHigh': '52WeekHigh',
        '52WeekLow': '52WeekLow',
        '50DayMovingAverage': '50DayMovingAverage',
        '200DayMovingAverage': '200DayMovingAverage',
        SharesOutstanding: 'SharesOutstanding',
        DividendDate: 'DividendDate',
        ExDividendDate: 'ExDividendDate',
        OfficialSite: 'OfficialSite',
        SharesFloat: 'SharesFloat',
        PercentInsiders: 'PercentInsiders',
        PercentInstitutions: 'PercentInstitutions',
        AnalystRatingStrongBuy: 'AnalystRatingStrongBuy',
        AnalystRatingBuy: 'AnalystRatingBuy',
        AnalystRatingHold: 'AnalystRatingHold',
        AnalystRatingSell: 'AnalystRatingSell',
        AnalystRatingStrongSell: 'AnalystRatingStrongSell',
      };

      let mappedFields = 0;
      // Map each field from the API response to our result object
      (Object.entries(fieldMappings) as [keyof AvCompanyOverview, string | string[]][]).forEach(([key, apiKey]) => {
        if (Array.isArray(apiKey)) {
          // Handle multiple possible field names (not needed here but kept for future use)
          for (const k of apiKey) {
            if (data[k] !== undefined) {
              result[key] = data[k];
              mappedFields++;
              break;
            }
          }
        } else if (data[apiKey] !== undefined) {
          // Handle single field name
          result[key] = data[apiKey];
          mappedFields++;
        }
      });

      if (mappedFields === 0) {
        // Provider returned no data; return empty result so caller can skip save
        console.warn(` aCO.H tR [${this.requestId}] empty; skip save`);
        log.info('transform.empty', { requestId: this.requestId });
        return {} as AvCompanyOverview;
      }

      log.info('transform.success', { requestId: this.requestId, symbol: (result as any).Symbol, mappedFields });

      return result as AvCompanyOverview;
      
    } catch (error) {
      console.error(`! aCO.H tR [${this.requestId}] error:`, error instanceof Error ? error.message : error);
      log.error('transform.error', { requestId: this.requestId, error: String((error as any)?.message || error) });
      throw error;
    }
  }
  
}
