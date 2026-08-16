/**
 * @fileoverview Shared function names for the application.
 * This file is shared between the frontend and the backend.
 */

export enum AlphaVantageFunctionName {
  GET_DAILY_STOCK_DATA_SIMPLE = 'getDailyStockDataSimple',
  GET_GLOBAL_QUOTE = 'getGlobalQuote',
  SYMBOL_SEARCH = 'symbolSearch'
}

export enum BenzingaFunctionName {
  GET_CALENDAR = 'getBenzingaCalendar',
  GET_COMPANY_LOGO = 'getCompanyLogo',
  GET_DYNAMIC_CALENDAR = 'getDynamicCalendar',
}

// Health metrics HTTPS function names (V2 where applicable)
export enum HealthFunctionName {
  GET_HEALTH_SUMMARY = 'getHealthSummary',
  GET_REQUEST_LOGS = 'getRequestLogs',
  GET_HEALTH_METRICS = 'getHealthMetrics',
  GET_SYMBOL_STATUS_V2 = 'getSymbolStatusV2',
  GET_SYMBOL_METRICS_V2 = 'getSymbolMetricsV2',
}

export enum PartnerFunctionName {
  PARTNER_TECHNICAL_INDICATORS_V2 = 'partnerTechnicalIndicatorsV2',
}

/**
 * Gateway function path segments for 2nd Gen HTTPS gateways.
 * Use these to build URLs instead of hardcoding strings in call sites.
 */
export enum GatewayFunctionPath {
  ALPHA_VANTAGE = 'alphaVantageApiV2',
  BENZINGA = 'benzingaApiV2',
}
