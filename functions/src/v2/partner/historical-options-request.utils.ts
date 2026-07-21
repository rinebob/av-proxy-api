import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../alpha-vantage/utils';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;

export enum HistoricalOptionsErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  FORBIDDEN = 'FORBIDDEN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  RATE_LIMITED = 'RATE_LIMITED',
  RESPONSE_TOO_LARGE = 'RESPONSE_TOO_LARGE',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
}

export interface HistoricalOptionsRequest {
  symbol: string;
  date?: string;
}

export function parseHistoricalOptionsRequest(
  symbolValue: unknown,
  dateValue: unknown,
): HistoricalOptionsRequest | null {
  const rawSymbol = typeof symbolValue === 'string' ? symbolValue.trim() : '';
  const symbol = rawSymbol.toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return null;
  }

  if (dateValue === undefined) {
    return { symbol };
  }

  if (typeof dateValue !== 'string' || !DATE_PATTERN.test(dateValue)) {
    return null;
  }

  const parsedDate = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateValue) {
    return null;
  }

  return { symbol, date: dateValue };
}

export function mapHistoricalOptionsProviderError(
  error: AlphaVantageUpstreamError,
): { status: number; code: HistoricalOptionsErrorCode; message: string } {
  const responses: Record<AlphaVantageUpstreamErrorCategory, {
    status: number;
    code: HistoricalOptionsErrorCode;
    message: string;
  }> = {
    [AlphaVantageUpstreamErrorCategory.RATE_LIMITED]: {
      status: 429,
      code: HistoricalOptionsErrorCode.RATE_LIMITED,
      message: 'Historical options provider rate limit exceeded',
    },
    [AlphaVantageUpstreamErrorCategory.TIMEOUT]: {
      status: 504,
      code: HistoricalOptionsErrorCode.UPSTREAM_TIMEOUT,
      message: 'Historical options provider request timed out',
    },
    [AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR]: {
      status: 502,
      code: HistoricalOptionsErrorCode.UPSTREAM_ERROR,
      message: 'Historical options provider request failed',
    },
  };

  return responses[error.category];
}
