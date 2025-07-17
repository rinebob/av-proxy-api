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
  // Add more fields as needed (e.g., docsUrl, logo, etc.)
}

export const DATA_PROVIDERS: Record<ApiProvider, DataProviderMeta> = {
  [ApiProvider.ALPHA_VANTAGE]: {
    key: ApiProvider.ALPHA_VANTAGE,
    fullName: 'Alpha Vantage',
    prefix: 'av',
    baseUrl: 'https://www.alphavantage.co/query',
  },
  [ApiProvider.BENZINGA]: {
    key: ApiProvider.BENZINGA,
    fullName: 'Benzinga',
    prefix: 'bz',
    baseUrl: 'https://api.benzinga.com/api/v2',
  },
};
