import { environment } from '../../../../environments/environment';
import { BenzingaEndpoint } from '../../../common/fe-common-bz';

/**
 * Production URL for the Benzinga API Gateway
 */
const BZ_GATEWAY_PROD_URL = 'https://benzingaapi-lsluydmucq-uc.a.run.app';

/**
 * Development URL base for the Benzinga API Gateway
 */
const BZ_DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

/**
 * Returns the correct Benzinga gateway URL for the current environment
 */
function getBenzingaBaseUrl(): string {
  return environment.production ? BZ_GATEWAY_PROD_URL : BZ_DEV_URL_BASE;
}

/**
 * All possible backend URLs for Benzinga functions (for use in interceptors)
 */
export const BenzingaBackendUrls = [
  BZ_GATEWAY_PROD_URL,
  BZ_DEV_URL_BASE
];

/**
 * Converts a BenzingaEndpoint to a URL path segment
 */
function endpointToPath(endpoint: BenzingaEndpoint): string {
  // Convert enum value to kebab-case if needed
  return endpoint.toLowerCase().replace(/_/g, '-');
}

/**
 * Returns the full URL for a Benzinga endpoint
 * @param endpoint The Benzinga endpoint to call
 */
export function getBenzingaEndpointUrl(endpoint: BenzingaEndpoint): string {
  const baseUrl = getBenzingaBaseUrl();
  const gatewayPath = 'benzingaApi';
  const endpointPath = 'calendar'; // The path is always 'calendar' for these endpoints.

  return `${baseUrl}/${gatewayPath}/${endpointPath}`;
}

/////////////////////////////// TYPES /////////////////////////

/**
 * Union type of all possible response data shapes from Benzinga API
 */
export type BenzingaResponseData = 
  | EarningsCalendarData
  | NewsData
  | DividendsData
  | IposData
  | GuidanceData
  | SplitsData
  | Record<string, any>; // Fallback for unknown types

/////////////////////////////// INTERFACES /////////////////////////

/**
 * Base response structure for Benzinga API calls
 */
export interface BenzingaApiResponse<T = BenzingaResponseData> {
  ok: boolean;
  data: T;
  timestamp: string;
  error?: string;
  errorDetails?: {
    message: string;
    code?: string | number;
    stack?: string;
  };
}

/**
 * Earnings calendar data structure
 */
export interface EarningsCalendarData {
  date: string;
  time?: string;
  ticker: string;
  exchange: string;
  name: string;
  period: string;
  period_year: number;
  eps: number | null;
  eps_est: number | null;
  eps_surprise: number | null;
  eps_surprise_percent: number | null;
  revenue: number | null;
  revenue_est: number | null;
  revenue_surprise: number | null;
  revenue_surprise_percent: number | null;
  updated: number;
  importance?: number;
  notes?: string;
  updated_at?: string;
  fiscal_date_ending?: string;
  fiscal_quarter?: string;
  fiscal_year?: string;
  time_updated?: string;
  time_earliest?: string;
  time_latest?: string;
  time_confirmed?: string;
  time_confirmed_utc?: string;
  time_confirmed_unix?: number;
  time_earliest_utc?: string;
  time_earliest_unix?: number;
  time_latest_utc?: string;
  time_latest_unix?: number;
  time_updated_utc?: string;
  time_updated_unix?: number;
  timezone?: string;
}

/**
 * News data structure
 */
export interface NewsData {
  id: string;
  title: string;
  url: string;
  summary: string;
  content: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  tickers: string[];
  tags: string[];
  channels: string[];
  source: string;
  author: string;
  image_url: string;
  related_assets: string[];
}

/**
 * Dividends data structure
 */
export interface DividendsData {
  date: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  dividend: number;
  dividend_prior: number;
  dividend_yield: number;
  dividend_yield_annual: number;
  ex_dividend_date: string;
  pay_date: string;
  record_date: string;
  updated: number;
  frequency: string;
  status: string;
  importance?: number;
  notes?: string;
}

/**
 * IPOs data structure
 */
export interface IposData {
  id: string;
  date: string;
  time: string;
  ticker: string;
  exchange: string;
  name: string;
  open_date_verified: boolean;
  pricing_date: string;
  currency: string;
  price_min: string;
  price_max: string;
  price_public_offering: string;
  price_open: string;
  deal_status: string;
  ipo_type: string;
  insider_lockup_days: number;
  insider_lockup_date: string;
  offering_value: number;
  offering_shares: number;
  shares_outstanding: number;
  lead_underwriters: string[];
  other_underwriters: string[];
  underwriter_quiet_expiration_days: number;
  underwriter_quiet_expiration_date: string;
  notes: string;
  updated: number;
}

/**
 * Guidance data structure
 */
export interface GuidanceData {
  id: string;
  date: string;
  time: string;
  ticker: string;
  exchange: string;
  name: string;
  period: string;
  period_year: number;
  guidance_type: string;
  guidance_metric: string;
  guidance_value: number;
  guidance_currency: string;
  guidance_operator: string;
  guidance_prior: number;
  guidance_prior_currency: string;
  guidance_prior_operator: string;
  updated: number;
  importance?: number;
  notes?: string;
}

/**
 * Stock splits data structure
 */
export interface SplitsData {
  date: string;
  ticker: string;
  name: string;
  exchange: string;
  ratio: number;
  split_date: string;
  updated: number;
  importance?: number;
  notes?: string;
}
