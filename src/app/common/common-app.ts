import { environment } from '../../environments/environment';
import { CloudFunctionName } from '../../../functions/src/common-fn';

// Base URL for the emulator or production
const getBaseUrl = (functionName: CloudFunctionName) => {
  if (environment.useEmulator) {
    return `http://localhost:5001/alpha-vantage-proxy-api/us-central1/${functionName}`;
  }
  // In production, use the deployed Cloud Functions URLs
  const baseUrl = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net';
  return `${baseUrl}/${functionName}`;
};

// Interface for function info
export interface StockDataFunction {
  url: string;
  displayName: string;
  buttonText: string;
}

// Function to create a function info object
const createFunctionInfo = (functionName: CloudFunctionName, displayName: string, buttonText?: string): StockDataFunction => ({
  url: getBaseUrl(functionName),
  displayName,
  buttonText: buttonText || `Get ${displayName}`
});

// Export function information
export const StockDataFunctions = {
  DAILY_STOCK_DATA: createFunctionInfo(
    CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE,
    'Daily Data',
    'Get Daily Data'
  ),
  GLOBAL_QUOTE: createFunctionInfo(
    CloudFunctionName.GET_GLOBAL_QUOTE,
    'Global Quote',
    'Get Quote'
  )
} as const;

// For backward compatibility
export const StockDataUrl = {
  DAILY_STOCK_DATA_SIMPLE: StockDataFunctions.DAILY_STOCK_DATA.url,
  GET_GLOBAL_QUOTE: StockDataFunctions.GLOBAL_QUOTE.url
} as const;