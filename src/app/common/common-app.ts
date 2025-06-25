import { environment } from '../../environments/environment';
import { AlphaVantageFunctionName, BenzingaFunctionName } from '../../../functions/src/common/common-fn';

// Hardcoded API endpoints
const API_URLS = {
  PROD: 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net',
  DEV: 'http://localhost:5001/alpha-vantage-proxy-api/us-central1'
} as const;

// Simple function to get the base URL
const getBaseUrl = () => environment.production ? API_URLS.PROD : API_URLS.DEV;

// Interface for function info
export interface StockDataFunction {
  url: string;
  displayName: string;
  buttonText: string;
  functionName: string;
}

// Function to create a function info object
const createFunctionInfo = (endpointPath: string, displayName: string, buttonText: string, functionName: string): StockDataFunction => ({
  url: `${getBaseUrl()}/${endpointPath}`,
  displayName,
  buttonText,
  functionName
});

// Alpha Vantage Functions
export const AlphaVantageFunctions = {
  DAILY_STOCK_DATA: createFunctionInfo(
    AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE,
    'Daily Data',
    'Get Daily Data',
    'GET_DAILY_STOCK_DATA_SIMPLE'
  ),
  GLOBAL_QUOTE: createFunctionInfo(
    AlphaVantageFunctionName.GET_GLOBAL_QUOTE,
    'Global Quote',
    'Get Quote',
    'GET_GLOBAL_QUOTE'
  )
} as const;

// Benzinga Functions
export const BenzingaFunctions = {
  GET_CALENDAR: createFunctionInfo(
    BenzingaFunctionName.GET_CALENDAR,
    'Benzinga Calendar',
    'Get Calendar',
    'GET_BENZINGA_CALENDAR'
  )
  // Add more Benzinga functions here as needed
} as const;

// Combine all functions
export const StockDataFunctions = {
  ...AlphaVantageFunctions,
  ...BenzingaFunctions
} as const;

export type StockDataFunctionType = keyof typeof StockDataFunctions;

// For backward compatibility
export const StockDataUrl = {
  // Alpha Vantage
  DAILY_STOCK_DATA_SIMPLE: AlphaVantageFunctions.DAILY_STOCK_DATA.url,
  GET_GLOBAL_QUOTE: AlphaVantageFunctions.GLOBAL_QUOTE.url,
  // Benzinga
  GET_BENZINGA_CALENDAR: BenzingaFunctions.GET_CALENDAR.url
} as const;