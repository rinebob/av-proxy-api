/**
 * @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
 *
 * Error codes and typed error mapping for the technical indicators partner endpoint.
 * Follows the pattern established by historical-options-request.utils.ts.
 */
import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../alpha-vantage/utils';

export enum TechnicalIndicatorsErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  FORBIDDEN = 'FORBIDDEN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  RESPONSE_TOO_LARGE = 'RESPONSE_TOO_LARGE',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
}

export function mapTechnicalIndicatorsProviderError(
  error: AlphaVantageUpstreamError,
): { status: number; code: TechnicalIndicatorsErrorCode; message: string } {
  const responses: Record<AlphaVantageUpstreamErrorCategory, {
    status: number;
    code: TechnicalIndicatorsErrorCode;
    message: string;
  }> = {
    [AlphaVantageUpstreamErrorCategory.RATE_LIMITED]: {
      status: 429,
      code: TechnicalIndicatorsErrorCode.RATE_LIMITED,
      message: 'Technical indicators provider rate limit exceeded',
    },
    [AlphaVantageUpstreamErrorCategory.TIMEOUT]: {
      status: 504,
      code: TechnicalIndicatorsErrorCode.UPSTREAM_TIMEOUT,
      message: 'Technical indicators provider request timed out',
    },
    [AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR]: {
      status: 502,
      code: TechnicalIndicatorsErrorCode.UPSTREAM_ERROR,
      message: 'Technical indicators provider request failed',
    },
  };

  return responses[error.category];
}
