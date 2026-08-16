import { environment } from '../../environments/environment';
import { AlphaVantageFunctionName, BenzingaFunctionName, PartnerFunctionName } from './fe-common-fn';
import { DataMaintainerFunctionName } from '../feat/data-maintainer-view/common/fe-common-dm-api';

/**
 * @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15)
 */
// Define the production URLs for each 2nd Gen Cloud Function
const PROD_URLS = {
  // Alpha Vantage
  [AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE]: 'https://getdailystockdatasimple-lsluydmucq-uc.a.run.app',
  [AlphaVantageFunctionName.GET_GLOBAL_QUOTE]: 'https://getglobalquote-lsluydmucq-uc.a.run.app',
  [AlphaVantageFunctionName.SYMBOL_SEARCH]: 'https://symbolsearch-lsluydmucq-uc.a.run.app',
  
  // Benzinga
  [BenzingaFunctionName.GET_CALENDAR]: 'https://getbenzingacalendar-lsluydmucq-uc.a.run.app',
  [BenzingaFunctionName.GET_COMPANY_LOGO]: 'https://getcompanylogo-lsluydmucq-uc.a.run.app',
  [BenzingaFunctionName.GET_DYNAMIC_CALENDAR]: 'https://getdynamiccalendar-lsluydmucq-uc.a.run.app',
  
  // Data Maintainer
  [DataMaintainerFunctionName.FETCH_AND_STORE_DATA]: 'https://fetchandstoredata-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.CHECK_MOCK_DATA]: 'https://checkmockdata-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.LIST_SYMBOLS]: 'https://listsymbols-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.GET_SYMBOL_DETAILS]: 'https://getsymboldetails-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.SYNC_SYMBOLS]: 'https://syncsymbols-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.SAVE_TRACKED_SYMBOL]: 'https://savetrackedsymbol-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.LIST_SYMBOLS_V2]: 'https://listsymbolsv2-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.GET_SYMBOL_DETAILS_V2]: 'https://getsymboldetailsv2-lsluydmucq-uc.a.run.app',

  // Partner (cloudfunctions.net URL — partner endpoints use this canonical URL, not run.app)
  [PartnerFunctionName.PARTNER_TECHNICAL_INDICATORS_V2]: 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTechnicalIndicatorsV2',
} as const;

// Development URL base
const DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

// Function to get the correct URL based on environment and function name
const getFunctionUrl = (functionName: AlphaVantageFunctionName | BenzingaFunctionName | DataMaintainerFunctionName | PartnerFunctionName) => {
  if (environment.production) {
    return PROD_URLS[functionName];
  }
  return `${DEV_URL_BASE}/${functionName}`;
};

// Interface for function info
export interface StockDataFunction {
  url: string;
  displayName: string;
  buttonText: string;
  functionName: string;
}

// Function to create a function info object
const createFunctionInfo = (endpointPath: AlphaVantageFunctionName | BenzingaFunctionName, displayName: string, buttonText: string, functionName: string): StockDataFunction => ({
  url: getFunctionUrl(endpointPath),
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
  ),
  SYMBOL_SEARCH: createFunctionInfo(
    AlphaVantageFunctionName.SYMBOL_SEARCH,
    'Symbol Search',
    'Search Symbols',
    'SYMBOL_SEARCH'
  )
} as const;

// Benzinga Functions
export const BenzingaFunctions = {
  GET_CALENDAR: createFunctionInfo(
    BenzingaFunctionName.GET_CALENDAR,
    'Benzinga Calendar',
    'Get Calendar',
    'GET_BENZINGA_CALENDAR'
  ),
  GET_COMPANY_LOGO: createFunctionInfo(
    BenzingaFunctionName.GET_COMPANY_LOGO,
    'Company Logo',
    'Get Logo',
    'GET_COMPANY_LOGO'
  ),
  GET_DYNAMIC_CALENDAR: createFunctionInfo(
    BenzingaFunctionName.GET_DYNAMIC_CALENDAR,
    'Benzinga Dynamic Calendar',
    'Get Dynamic Calendar',
    'GET_DYNAMIC_CALENDAR'
  )
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
  GET_BENZINGA_CALENDAR: BenzingaFunctions.GET_CALENDAR.url,
  GET_COMPANY_LOGO: BenzingaFunctions.GET_COMPANY_LOGO.url,
  GET_DYNAMIC_CALENDAR: BenzingaFunctions.GET_DYNAMIC_CALENDAR.url
} as const;