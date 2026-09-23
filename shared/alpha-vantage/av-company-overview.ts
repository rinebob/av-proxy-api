// COPIED FROM functions/src/v2/common/common-av.ts. Do not use directly until migration is complete.

/**
 * Alpha Vantage company overview interface.
 */
export interface AvCompanyOverview {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  OfficialSite: string;
  FiscalYearEnd: string;
  LatestQuarter: string;
  MarketCapitalization: string;
  EBITDA: string;
  PERatio: string;
  PEGRatio: string;
  BookValue: string;
  DividendPerShare: string;
  DividendYield: string;
  EPS: string;
  RevenuePerShareTTM: string;
  ProfitMargin: string;
  OperatingMarginTTM: string;
  ReturnOnAssetsTTM: string;
  ReturnOnEquityTTM: string;
  RevenueTTM: string;
  GrossProfitTTM: string;
  DilutedEPSTTM: string;
  QuarterlyEarningsGrowthYOY: string;
  QuarterlyRevenueGrowthYOY: string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
  TrailingPE: string;
  ForwardPE: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToRevenue: string;
  EVToEBITDA: string;
  Beta: string;
  '52WeekHigh': string;
  '52WeekLow': string;
  '50DayMovingAverage': string;
  '200DayMovingAverage': string;
  SharesOutstanding: string;
  SharesFloat: string;
  PercentInsiders: string;
  PercentInstitutions: string;
  DividendDate: string;
  ExDividendDate: string;
}

/**
 * Subset of AvCompanyOverview fields denormalized into the tracked-symbols
 * collection for display and sorting/filtering without joining symbol-data.
 * Mostly slowly-changing identity and classification fields; marketCap and
 * beta are the exception — volatile numeric fields parsed from AV strings so
 * they sort numerically (see ADR 0001, Topic #88). They are only as fresh as
 * the symbol's last OVERVIEW refresh. The write-back replaces this map
 * wholesale each refresh, so fields AV stops returning are cleared rather
 * than left stale.
 */
export interface TrackedSymbolCompanyInfo {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  OfficialSite: string;
  FiscalYearEnd: string;
  marketCap?: number;
  beta?: number;
}

/**
 * Alpha Vantage company overview API response interface.
 */
export interface AvCompanyOverviewResponse {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: AvCompanyOverview;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

export interface CompanyOverviewResponse {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  // ... other fields from Alpha Vantage
}
