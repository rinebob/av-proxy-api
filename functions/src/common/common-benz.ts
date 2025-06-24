/**
 * Benzinga API Types and Enums
 */

export enum BenzingaCalendarType {
  EARNINGS = 'earnings',
  DIVIDENDS = 'dividends',
  RATINGS = 'ratings',
  ECONOMIC = 'economic',
  IPOS = 'ipos',
  CONFERENCE_CALLS = 'conference_calls',
  FDA = 'fda',
  GUIDANCE = 'guidance',
  MERGERS_ACQUISITIONS = 'ma',
  SPLITS = 'splits',
  OFFERINGS = 'offerings'
}

export enum BenzingaOutputFormat {
  JSON = 'json',
  XML = 'xml'
}

export interface BenzingaCalendarParams {
  type: BenzingaCalendarType;
  tickers?: string[];
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  format?: BenzingaOutputFormat;
  updatedSince?: string;
}

export interface BenzingaCalendarResponse {
  [key: string]: any; // Adjust based on actual response structure
}

// Add more Benzinga-specific types and interfaces as needed
