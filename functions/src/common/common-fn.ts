import { QueryParamsAv } from './common-av';

///////////// CONSTANTS //////////////////

export const CLOUD_FUNCTIONS_BASE_URL = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;

///////////// ENUMS /////////////////////

// Define enums for Cloud Function names by service
export enum AlphaVantageFunctionName {
  GET_DAILY_STOCK_DATA_SIMPLE = 'getDailyStockDataSimple',
  GET_GLOBAL_QUOTE = 'getGlobalQuote',
  FETCH_AND_STORE_DATA = 'fetchAndStoreData',
}

export enum BenzingaFunctionName {
  GET_CALENDAR = 'getBenzingaCalendar',
  GET_COMPANY_LOGO = 'getCompanyLogo',
  GET_DYNAMIC_CALENDAR = 'getDynamicCalendar',
}

// Union type for all cloud function names
export type CloudFunctionName = AlphaVantageFunctionName | BenzingaFunctionName;

// Define output size options for API responses
export enum OutputSize {
  COMPACT = 'compact',
  FULL = 'full'
}

// Interface for authentication and validation result
export interface AuthValidationResult {
  decodedToken: any; 
  params: QueryParamsAv;
  apiKey: string;
}

// Common error response interface
export interface ErrorResponse {
  error: string;
  details?: string;
}
