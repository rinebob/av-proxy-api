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

const tests: Array<{ name: string; execute: () => Promise<void> }> = [];
let failures = 0;

function test(name: string, execute: () => Promise<void>): void {
  tests.push({ name, execute });
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
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
    fetchOptions: async () => testData,
    analyzeOptionsData: () => testAnalysis,
    hasExpectedGoogleAudience: () => true,
    now: () => testNow,
    ...overrides,
  };
}

function createRequest(method: HttpMethod, query: Record<string, unknown> = {}): Request {
  return { method, query } as Request;
}

test('rejects POST requests with the documented error envelope', async () => {
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

test('rejects OPTIONS requests with the documented error envelope', async () => {
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

test('fails closed when the expected OIDC audience is not configured', async () => {
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

test('stops when authentication rejects the request', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ authenticateRequest: async () => null }),
  );
  assertEqual(responseState.statusCode, undefined, 'status');
});

test('rejects a Firebase-authenticated caller', async () => {
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

test('rejects invalid request parameters after authentication', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(createRequest(HttpMethod.GET), responseState.response, createDependencies());
  assertEqual(responseState.statusCode, 400, 'status');
});

test('maps typed provider failures', async () => {
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

test('returns the no-persistence provider response and analysis', async () => {
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
  };
  assertEqual(body.data, testData, 'data');
  assertEqual(body.source, ApiProvider.ALPHA_VANTAGE, 'source');
});

test('rejects oversized serialized responses', async () => {
  const responseState = createResponse();
  await historicalOptionsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    responseState.response,
    createDependencies({
      fetchOptions: async () => ({ ...testData, message: 'x'.repeat(10 * 1024 * 1024) }),
    }),
  );
  assertEqual(responseState.statusCode, 413, 'status');
  assertEqual(
    (responseState.body as { code?: HistoricalOptionsErrorCode }).code,
    HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE,
    'code',
  );
});

async function runTests(): Promise<void> {
  for (const { name, execute } of tests) {
    try {
      await execute();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  process.exitCode = failures === 0 ? 0 : 1;
}

void runTests();
