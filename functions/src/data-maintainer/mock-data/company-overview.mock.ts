import { AvCompanyOverview, AvCompanyOverviewResponse } from '../../common/common-av';

/**
 * Mock company overview data for development/testing
 * Matches the structure of Alpha Vantage's COMPANY_OVERVIEW response
 */
const MOCK_COMPANY_OVERVIEW_DATA: Record<string, AvCompanyOverview> = {
  'NVDA': {
    Symbol: 'NVDA',
    AssetType: 'Common Stock',
    Name: 'NVIDIA Corporation',
    Description: 'Nvidia Corporation is an American multinational technology company incorporated in Delaware and based in Santa Clara, California. It designs graphics processing units (GPUs) for the gaming and professional markets, as well as system on a chip units (SoCs) for the mobile computing and automotive market.',
    CIK: '1045810',
    Exchange: 'NASDAQ',
    Currency: 'USD',
    Country: 'USA',
    Sector: 'MANUFACTURING',
    Industry: 'SEMICONDUCTORS & RELATED DEVICES',
    Address: '2701 SAN TOMAS EXPRESSWAY, SANTA CLARA, CA, US',
    OfficialSite: 'https://www.nvidia.com',
    FiscalYearEnd: 'January',
    LatestQuarter: '2025-04-30',
    MarketCapitalization: '3852997231000',
    EBITDA: '88247001000',
    PERatio: '50.8',
    PEGRatio: '1.959',
    BookValue: '3.438',
    DividendPerShare: '0.04',
    DividendYield: '0.0003',
    EPS: '3.11',
    RevenuePerShareTTM: '6.06',
    ProfitMargin: '0.517',
    OperatingMarginTTM: '0.491',
    ReturnOnAssetsTTM: '0.532',
    ReturnOnEquityTTM: '1.155',
    RevenueTTM: '148514996000',
    GrossProfitTTM: '104120001000',
    DilutedEPSTTM: '3.11',
    QuarterlyEarningsGrowthYOY: '0.267',
    QuarterlyRevenueGrowthYOY: '0.692',
    AnalystTargetPrice: '173.92',
    AnalystRatingStrongBuy: '12',
    AnalystRatingBuy: '45',
    AnalystRatingHold: '6',
    AnalystRatingSell: '1',
    AnalystRatingStrongSell: '0',
    TrailingPE: '50.8',
    ForwardPE: '36.76',
    PriceToSalesRatioTTM: '25.94',
    PriceToBookRatio: '45.95',
    EVToRevenue: '25.66',
    EVToEBITDA: '41.89',
    Beta: '2.122',
    '52WeekHigh': '158.71',
    '52WeekLow': '86.61',
    '50DayMovingAverage': '130.63',
    '200DayMovingAverage': '129.45',
    SharesOutstanding: '24387600000',
    SharesFloat: '23418876000',
    PercentInsiders: '4.330',
    PercentInstitutions: '67.543',
    DividendDate: '2025-07-03',
    ExDividendDate: '2025-06-11'
  },
  'AAPL': {
    Symbol: 'AAPL',
    AssetType: 'Common Stock',
    Name: 'Apple Inc.',
    Description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, a line of smartphones; Mac, a line of personal computers; iPad, a line of multi-purpose tablets; and wearables, home, and accessories comprising AirPods, Apple TV, Apple Watch, Beats products, and HomePod.',
    CIK: '0000320193',
    Exchange: 'NASDAQ',
    Currency: 'USD',
    Country: 'USA',
    Sector: 'TECHNOLOGY',
    Industry: 'CONSUMER ELECTRONICS',
    Address: 'ONE APPLE PARK WAY, CUPERTINO, CA, US',
    OfficialSite: 'https://www.apple.com',
    FiscalYearEnd: 'September',
    LatestQuarter: '2025-03-31',
    MarketCapitalization: '2850000000000',
    EBITDA: '125000000000',
    PERatio: '32.18',
    PEGRatio: '2.76',
    BookValue: '4.18',
    DividendPerShare: '0.96',
    DividendYield: '0.0053',
    EPS: '6.11',
    RevenuePerShareTTM: '23.53',
    ProfitMargin: '0.259',
    OperatingMarginTTM: '0.302',
    ReturnOnAssetsTTM: '0.287',
    ReturnOnEquityTTM: '1.479',
    RevenueTTM: '383285000000',
    GrossProfitTTM: '170782000000',
    DilutedEPSTTM: '6.11',
    QuarterlyEarningsGrowthYOY: '0.042',
    QuarterlyRevenueGrowthYOY: '-0.044',
    AnalystTargetPrice: '205.00',
    AnalystRatingStrongBuy: '15',
    AnalystRatingBuy: '25',
    AnalystRatingHold: '10',
    AnalystRatingSell: '2',
    AnalystRatingStrongSell: '1',
    TrailingPE: '32.18',
    ForwardPE: '28.45',
    PriceToSalesRatioTTM: '7.43',
    PriceToBookRatio: '47.08',
    EVToRevenue: '7.12',
    EVToEBITDA: '22.12',
    Beta: '1.29',
    '52WeekHigh': '220.00',
    '52WeekLow': '165.00',
    '50DayMovingAverage': '195.45',
    '200DayMovingAverage': '185.67',
    SharesOutstanding: '15400000000',
    SharesFloat: '15350000000',
    PercentInsiders: '0.07',
    PercentInstitutions: '60.45',
    DividendDate: '2025-05-16',
    ExDividendDate: '2025-05-09'
  }
} as const;

/**
 * Get mock company overview data for a symbol
 * @param symbol Stock symbol (e.g., 'NVDA', 'AAPL')
 * @returns Mock company overview data or undefined if not found
 */
export function getMockCompanyOverview(symbol: string): AvCompanyOverviewResponse | undefined {
  const symbolUpper = symbol.toUpperCase();
  const overview = MOCK_COMPANY_OVERVIEW_DATA[symbolUpper as keyof typeof MOCK_COMPANY_OVERVIEW_DATA];
  if (!overview) return undefined;
  
  return {
    ok: true,
    symbol: symbolUpper,
    endpoint: 'company-overview',
    data: overview
  };
}
