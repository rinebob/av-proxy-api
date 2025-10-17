import { 
    BzConferenceCallsData,
    BzDividendsData,
    BzEarningsData, 
    BzEconomicsData,
    BzGuidanceData, 
    BzIposData, 
    BzMergersAcquisitionsData,
    BzNewsData, 
    BzRatingsData,
    BzSplitsData, 
} from '@shared/benzinga';

import { environment } from '../../../../environments/environment';
import { inject } from '@angular/core';
import { API_BASES } from '../../../core/api/api.tokens';
import { GatewayFunctionPath } from '../../../common/fe-common-fn';

/**
 * Production URL for the Benzinga API Gateway
 */
const BZ_GATEWAY_PROD_URL = 'https://benzingaapiv2-lsluydmucq-uc.a.run.app';

/**
 * Development URL base for the Benzinga API Gateway
 */
const BZ_DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

/**
 * Returns the correct Benzinga gateway URL for the current environment
 */
function getBenzingaBaseUrl(): string {
  try {
    const bases = inject(API_BASES);
    if (bases?.benzinga) return bases.benzinga;
  } catch {}
  // In production, refuse localhost fallback to avoid cross-wiring
  if (environment.production) {
    throw new Error('[fe-common-bz-api] API_BASES.benzinga unavailable in production; refusing to fallback to localhost. Ensure API_BASES is provided.');
  }
  // Dev-only fallback
  return BZ_DEV_URL_BASE;
}

/**
 * All possible backend URLs for Benzinga functions (for use in interceptors)
 */
export const BenzingaBackendUrls = [
  BZ_GATEWAY_PROD_URL,
  BZ_DEV_URL_BASE
];

/**
 * Returns the base URL for Benzinga API endpoints
 */
export function getBenzingaEndpointUrl(): string {
  const baseUrl = getBenzingaBaseUrl();
  const gatewayPath = GatewayFunctionPath.BENZINGA;
  return `${baseUrl}/${gatewayPath}`;
}

/////////////////////////////// TYPES /////////////////////////

/**
 * Union type of all possible response data shapes from Benzinga API
 */
export type BenzingaResponseData = 
  | BzConferenceCallsData
  | BzDividendsData
  | BzEarningsData
  | BzEconomicsData
  | BzGuidanceData
  | BzIposData
  | BzMergersAcquisitionsData
  | BzNewsData
  | BzRatingsData
  | BzSplitsData
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
