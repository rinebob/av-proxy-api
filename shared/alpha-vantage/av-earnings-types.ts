/**
 * TypeScript types for the Alpha Vantage EARNINGS endpoint response.
 * @see https://www.alphavantage.co/documentation/#earnings
 */

export type AvReportTime = 'pre-market' | 'post-market';

export interface AvAnnualEarning {
  fiscalDateEnding: string;
  reportedEPS: string;
}

export interface AvQuarterlyEarning {
  fiscalDateEnding: string;
  reportedDate: string;
  reportedEPS: string;
  estimatedEPS: string;
  surprise: string;
  surprisePercentage: string;
  reportTime?: AvReportTime;
}

export interface AvEarningsResponse {
  symbol: string;
  annualEarnings: AvAnnualEarning[];
  quarterlyEarnings: AvQuarterlyEarning[];
}
