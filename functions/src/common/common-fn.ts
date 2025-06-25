import { QueryParamsAv } from './common-av';

///////////// ENUMS /////////////////////

// Define enums for Cloud Function names by service
export enum AlphaVantageFunctionName {
  GET_DAILY_STOCK_DATA_SIMPLE = 'getDailyStockDataSimple',
  GET_GLOBAL_QUOTE = 'getGlobalQuote',
}

export enum BenzingaFunctionName {
  GET_CALENDAR = 'getBenzingaCalendar',
  GET_COMPANY_LOGO = 'getCompanyLogo',
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
