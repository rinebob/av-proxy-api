import { environment } from '../../environments/environment';

// Base URL for the emulator or production
const getBaseUrl = (functionName: string) => {
  if (environment.useEmulator) {
    return `http://localhost:5001/alpha-vantage-proxy-api/us-central1/${functionName}`;
  }
  // In production, use the deployed Cloud Functions URLs
  switch(functionName) {
    case 'getDailyStockDataRobust':
      return 'https://getdailystockdatarobust-lsluydmucq-uc.a.run.app';
    case 'getDailyStockDataSimple':
      return 'https://getdailystockdatasimple-lsluydmucq-uc.a.run.app';
    case 'getGlobalQuote':
      return 'https://getglobalquote-lsluydmucq-uc.a.run.app';
    default:
      throw new Error(`Unknown function name: ${functionName}`);
  }
};

// Export URL constants
export const StockDataUrl = {
    DAILY_STOCK_DATA_ROBUST: getBaseUrl('getDailyStockDataRobust'),
    DAILY_STOCK_DATA_SIMPLE: getBaseUrl('getDailyStockDataSimple'),
    GET_GLOBAL_QUOTE: getBaseUrl('getGlobalQuote')
} as const;