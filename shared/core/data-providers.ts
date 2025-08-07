export enum ApiProvider {
    ALPHA_VANTAGE = 'alpha-vantage',
    BENZINGA = 'benzinga'
  }

export interface DataProviderMeta {
  key: ApiProvider;
  fullName: string;
  prefix: string;
  baseUrl: string;
  implementedEndpoints?: string[];
  responseType: string;
  defaultTimeoutMs: number;
  // Add more fields as needed (e.g., docsUrl, logo, etc.)
}

export const DATA_PROVIDERS: Record<ApiProvider, DataProviderMeta> = {
  [ApiProvider.ALPHA_VANTAGE]: {
    key: ApiProvider.ALPHA_VANTAGE,
    fullName: 'Alpha Vantage',
    prefix: 'av',
    baseUrl: 'https://www.alphavantage.co/query',
    responseType: 'json',
    defaultTimeoutMs: 15000 
  },
  [ApiProvider.BENZINGA]: {
    key: ApiProvider.BENZINGA,
    fullName: 'Benzinga',
    prefix: 'bz',
    baseUrl: 'https://api.benzinga.com/api/v2',
    responseType: 'json',
    defaultTimeoutMs: 15000 
  },
};


export const API_CONSTANTS = {
    ALPHA_VANTAGE: {
      BASE_URL: 'https://www.alphavantage.co/query',
      DEFAULT_TIMEOUT_MS: 15000, // 15 seconds
      RESPONSE_TYPE: 'json' as const
    }
  } as const;
