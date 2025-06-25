/**
 * @fileoverview Shared function names for the application.
 * This file is shared between the frontend and the backend.
 */

export enum AlphaVantageFunctionName {
  GET_DAILY_STOCK_DATA_SIMPLE = 'getDailyStockDataSimple',
  GET_GLOBAL_QUOTE = 'getGlobalQuote',
}

export enum BenzingaFunctionName {
  GET_CALENDAR = 'getBenzingaCalendar',
  GET_COMPANY_LOGO = 'getCompanyLogo',
}

export const ALL_FUNCTION_NAMES = [
  ...Object.values(AlphaVantageFunctionName),
  ...Object.values(BenzingaFunctionName),
] as const;
