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

// Export URL constants
export const StockDataUrl = {
    DAILY_STOCK_DATA_SIMPLE: getBaseUrl(CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE),
    GET_GLOBAL_QUOTE: getBaseUrl(CloudFunctionName.GET_GLOBAL_QUOTE)
} as const;