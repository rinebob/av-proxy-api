import axios from 'axios';

import {
  AlphaVantageProviderResponseError,
  AlphaVantageProviderResponseErrorKind,
} from './av-response-utils';

export enum AlphaVantageUpstreamErrorCategory {
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
}

export class AlphaVantageUpstreamError extends Error {
  public constructor(
    public readonly category: AlphaVantageUpstreamErrorCategory,
    public readonly upstreamStatus?: number,
    public readonly providerMessage?: string,
  ) {
    super(providerMessage ?? category);
    this.name = 'AlphaVantageUpstreamError';
  }
}

export function toAlphaVantageUpstreamError(error: unknown): AlphaVantageUpstreamError {
  if (error instanceof AlphaVantageUpstreamError) {
    return error;
  }

  if (error instanceof AlphaVantageProviderResponseError) {
    return new AlphaVantageUpstreamError(
      error.kind === AlphaVantageProviderResponseErrorKind.NOTE
        ? AlphaVantageUpstreamErrorCategory.RATE_LIMITED
        : AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR,
      undefined,
      error.providerMessage,
    );
  }

  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT);
    }

    if (error.response?.status === 429) {
      return new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED, error.response.status);
    }

    return new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR, error.response?.status);
  }

  return new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR);
}
