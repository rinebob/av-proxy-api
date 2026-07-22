import type { Request, Response } from 'express';

import {
  AlphaVantageEndpoint,
  type AvHistoricalOptionsResponse,
  type SvtOptionsAnalysis,
} from '@shared/alpha-vantage';
import { ApiProvider, HttpMethod } from '@shared/core';

import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../../../src/v2/alpha-vantage/utils';
import {
  historicalOptionsPartnerHandler,
  type HistoricalOptionsPartnerDependencies,
} from '../../../src/v2/partner/historical-options-partner';
import { HistoricalOptionsErrorCode } from '../../../src/v2/partner/historical-options-request.utils';

function assertEqual<T>(actual: T, expected: T, _message: string): void {
  expect(actual).toBe(expected);
}

interface ResponseState {
  response: Response;
  statusCode?: number;
  body?: unknown;
}

function createResponse(): ResponseState {
  const state = {} as ResponseState;
  state.response = {
    status(statusCode: number) {
      state.statusCode = statusCode;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;

  return state;
}

const testNow = new Date('2026-07-20T00:00:00.000Z');
const testData: AvHistoricalOptionsResponse = {
  endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
  message: 'success',
  data: [],
};
const testAnalysis: SvtOptionsAnalysis = {
  summary: {
    totalContracts: 0,
    totalVolume: 0,
    totalOpenInterest: 0,
    callContracts: 0,
    putContracts: 0,
    uniqueStrikes: 0,
    avgVolumePerContract: 0,
    avgOpenInterest: 0,
  },
  expirations: [],
  strikes: [],
};

function createDependencies(
  overrides: Partial<HistoricalOptionsPartnerDependencies> = {},
): HistoricalOptionsPartnerDependencies {
  return {
    authenticateRequest: async () => ({ serviceAccountEmail: 'rs@example.com' }),
    fetchOptions: async () => ({ response: testData, analysis: testAnalysis }),
    hasExpectedGoogleAudience: () => true,
    now: () => testNow,
    ...overrides,
  };
}

function createRequest(method: HttpMethod, query: Record<string, unknown> = {}): Request {
  return { method, query } as Request;
}

it('rejects POST requests with the documented error envelope', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.POST),
    responseState.response,
    createDependencies(),
  );
  assertEqual(responseState.statusCode, 405, 'status');
  const body = responseState.body as { ok?: boolean; code?: string; timestamp?: string };
  assertEqual(body.ok, false, 'ok');
  assertEqual(body.code, HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED, 'code');
  assertEqual(body.timestamp, testNow.toISOString(), 'timestamp');
});

it('rejects OPTIONS requests with the documented error envelope', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.OPTIONS),
    responseState.response,
    createDependencies(),
  );
  assertEqual(responseState.statusCode, 405, 'status');
  const body = responseState.body as { code?: string; timestamp?: string };
  assertEqual(body.code, HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED, 'code');
  assertEqual(body.timestamp, testNow.toISOString(), 'timestamp');
});

it('fails closed when the expected OIDC audience is not configured', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ hasExpectedGoogleAudience: () => false }),
  );
  assertEqual(responseState.statusCode, 500, 'status');
  assertEqual(
    (responseState.body as { code?: HistoricalOptionsErrorCode }).code,
    HistoricalOptionsErrorCode.INTERNAL_ERROR,
    'code',
  );
});

it('stops when authentication rejects the request', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ authenticateRequest: async () => null }),
  );
  assertEqual(responseState.statusCode, undefined, 'status');
});

it('rejects a Firebase-authenticated caller', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ authenticateRequest: async () => ({ uid: 'firebase-user' }) }),
  );
  assertEqual(responseState.statusCode, 403, 'status');
  assertEqual(
    (responseState.body as { code?: HistoricalOptionsErrorCode }).code,
    HistoricalOptionsErrorCode.FORBIDDEN,
    'code',
  );
});

it('rejects invalid request parameters after authentication', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(createRequest(HttpMethod.GET), responseState.response, createDependencies());
  assertEqual(responseState.statusCode, 400, 'status');
});

it('maps typed provider failures', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    responseState.response,
    createDependencies({
      fetchOptions: async () => {
        throw new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT);
      },
    }),
  );
  assertEqual(responseState.statusCode, 504, 'status');
  assertEqual(
    (responseState.body as { code?: HistoricalOptionsErrorCode }).code,
    HistoricalOptionsErrorCode.UPSTREAM_TIMEOUT,
    'code',
  );
});

it('returns the no-persistence provider response and analysis', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    responseState.response,
    createDependencies(),
  );
  assertEqual(responseState.statusCode, 200, 'status');
  const body = responseState.body as {
    data?: AvHistoricalOptionsResponse;
    source?: ApiProvider;
    analysis?: typeof testAnalysis;
  };
  assertEqual(body.data, testData, 'data');
  assertEqual(body.source, ApiProvider.ALPHA_VANTAGE, 'source');
  assertEqual(body.analysis, testAnalysis, 'analysis');
});

it('rejects oversized serialized responses', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    responseState.response,
    createDependencies({
      fetchOptions: async () => ({
        response: { ...testData, message: 'x'.repeat(10 * 1024 * 1024) },
        analysis: testAnalysis,
      }),
    }),
  );
  assertEqual(responseState.statusCode, 413, 'status');
  assertEqual(
    (responseState.body as { code?: HistoricalOptionsErrorCode }).code,
    HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE,
    'code',
  );
});
