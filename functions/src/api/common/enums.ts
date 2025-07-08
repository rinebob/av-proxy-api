export enum ApiProvider {
  ALPHA_VANTAGE = 'alpha_vantage',
  BENZINGA = 'benzinga'
}

export enum EndpointCategory {
  STOCK_TIME_SERIES = 'stock_time_series',
  FUNDAMENTAL_DATA = 'fundamental_data',
  FOREX = 'forex',
  CRYPTO = 'cryptocurrency',
  TECHNICAL_INDICATORS = 'technical_indicators',
  BENZINGA_CALENDAR = 'benzinga_calendar'
}

export enum BenzingaEndpoint {
  CALENDAR = 'calendar',
  NEWS = 'news',
  // Add other BZ endpoints as needed
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE'
}
