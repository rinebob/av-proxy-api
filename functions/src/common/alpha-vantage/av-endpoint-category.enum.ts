/**
 * Alpha Vantage specific endpoint categories
 * Used to categorize different types of Alpha Vantage API endpoints.
 * These are their own categories for their endpoints.  
 * Not all of their categories are represented here.
 * https://www.alphavantage.co/documentation/
 */
export enum AvEndpointCategory {
  /** Time series data (daily, weekly, monthly, etc.) */
  TIME_SERIES = 'time-series',
  
  /** Options data */
  OPTIONS_DATA = 'options-data',
  
  /** Alpha Intelligence data (news, sentiment, etc.) */
  ALPHA_INTELLIGENCE = 'alpha-intelligence',
  
  /** Fundamental company data (balance sheets, income statements, etc.) */
  FUNDAMENTAL_DATA = 'fundamental-data',
  
  /** Economic indicators and metrics */
  ECONOMIC_INDICATORS = 'economic-indicators'
}
