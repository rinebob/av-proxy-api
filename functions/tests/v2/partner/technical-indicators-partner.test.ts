/**
 * @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
 */
import type { Request, Response } from 'express';

import { HttpMethod } from '@shared/core';

import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../../../src/v2/alpha-vantage/utils';
import {
  technicalIndicatorsPartnerHandler,
  type TechnicalIndicatorsPartnerDependencies,
} from '../../../src/v2/partner/technical-indicators-partner';
import { TechnicalIndicatorsErrorCode } from '../../../src/v2/partner/technical-indicators-request.utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    send(_body: unknown) {
      return this;
    },
  } as unknown as Response;
  return state;
}

function createRequest(
  method: HttpMethod,
  query: Record<string, unknown> = {},
): Request {
  return { method, query } as Request;
}

const testNow = new Date('2026-08-15T00:00:00.000Z');
const testAvResponse = {
  'Meta Data': { '1: Symbol': 'IBM', '2: Indicator': 'Trendline' },
  'Technical Analysis: Trendline': { '2026-08-14': { 'Trendline': '150.0' } },
};

function createDependencies(
  overrides: Partial<TechnicalIndicatorsPartnerDependencies> = {},
): TechnicalIndicatorsPartnerDependencies {
  return {
    authenticateRequest: async () => ({ serviceAccountEmail: 'rs@example.com' }),
    symbolExists: async () => true,
    fetchIndicator: async () => testAvResponse,
    hasExpectedGoogleAudience: () => true,
    now: () => testNow,
    ...overrides,
  };
}

// ── Method / auth gates ──────────────────────────────────────────────────────

it('rejects POST requests with 405', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.POST),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(405);
  expect((responseState.body as { ok?: boolean }).ok).toBe(false);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.METHOD_NOT_ALLOWED);
});

it('returns 204 for OPTIONS preflight', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.OPTIONS),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(204);
});

it('fails closed when expected OIDC audience is not configured', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ hasExpectedGoogleAudience: () => false }),
  );
  expect(responseState.statusCode).toBe(500);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.INTERNAL_ERROR);
});

it('stops when authentication rejects the request', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ authenticateRequest: async () => null }),
  );
  expect(responseState.statusCode).toBeUndefined();
});

it('rejects a Firebase-authenticated caller (service-account only)', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET),
    responseState.response,
    createDependencies({ authenticateRequest: async () => ({ uid: 'firebase-user' }) }),
  );
  expect(responseState.statusCode).toBe(403);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.FORBIDDEN);
});

// ── Param validation ─────────────────────────────────────────────────────────

it('returns 400 when symbol is missing', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(400);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.BAD_REQUEST);
});

it('returns 400 when indicator is missing', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM' }),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(400);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.BAD_REQUEST);
});

it('returns 400 when indicator is invalid and lists valid values', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_bogus' }),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(400);
  const body = responseState.body as { code?: string; validIndicators?: string[] };
  expect(body.code).toBe(TechnicalIndicatorsErrorCode.BAD_REQUEST);
  expect(body.validIndicators).toBeDefined();
  expect(body.validIndicators).toContain('ht_trendline');
});

it('returns 400 when interval is invalid', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline', interval: '2min' }),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(400);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.BAD_REQUEST);
});

it('returns 400 when series_type is invalid', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline', series_type: 'median' }),
    responseState.response,
    createDependencies(),
  );
  expect(responseState.statusCode).toBe(400);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.BAD_REQUEST);
});

// ── Symbol enforcement ───────────────────────────────────────────────────────

it('returns 404 when symbol is not in tracked_symbols', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'BOGUS', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({ symbolExists: async () => false }),
  );
  expect(responseState.statusCode).toBe(404);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.NOT_FOUND);
});

// ── Happy path ───────────────────────────────────────────────────────────────

it('returns 200 with standard envelope for valid request', async () => {
  const fetchCalls: Array<Record<string, string>> = [];
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline', interval: 'daily', series_type: 'close' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async (params: Record<string, string>) => {
        fetchCalls.push(params);
        return testAvResponse;
      },
    }),
  );
  expect(responseState.statusCode).toBe(200);
  const body = responseState.body as {
    ok?: boolean;
    symbol?: string;
    indicator?: string;
    interval?: string;
    series_type?: string;
    data?: unknown;
    timestamp?: string;
    processingTimeMs?: number;
  };
  expect(body.ok).toBe(true);
  expect(body.symbol).toBe('IBM');
  expect(body.indicator).toBe('ht_trendline');
  expect(body.interval).toBe('daily');
  expect(body.series_type).toBe('close');
  expect(body.data).toEqual(testAvResponse);
  expect(body.timestamp).toBe(testNow.toISOString());
  // Verify the AV call was constructed correctly
  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0].function).toBe('HT_TRENDLINE');
  expect(fetchCalls[0].symbol).toBe('IBM');
  expect(fetchCalls[0].interval).toBe('daily');
  expect(fetchCalls[0].series_type).toBe('close');
});

it('applies default interval=daily and series_type=close when omitted', async () => {
  const fetchCalls: Array<Record<string, string>> = [];
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_sine' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async (params: Record<string, string>) => {
        fetchCalls.push(params);
        return testAvResponse;
      },
    }),
  );
  expect(responseState.statusCode).toBe(200);
  expect(fetchCalls[0].interval).toBe('daily');
  expect(fetchCalls[0].series_type).toBe('close');
  expect(fetchCalls[0].function).toBe('HT_SINE');
});

it('uppercases the symbol before AV call', async () => {
  const fetchCalls: Array<Record<string, string>> = [];
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'ibm', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async (params: Record<string, string>) => {
        fetchCalls.push(params);
        return testAvResponse;
      },
    }),
  );
  expect(responseState.statusCode).toBe(200);
  expect(fetchCalls[0].symbol).toBe('IBM');
});

it('works with all 6 Hilbert indicators', async () => {
  const indicators = ['ht_trendline', 'ht_sine', 'ht_trendmode', 'ht_dcperiod', 'ht_dcphase', 'ht_phasor'];
  for (const indicator of indicators) {
    const responseState = createResponse();
    await technicalIndicatorsPartnerHandler(
      createRequest(HttpMethod.GET, { symbol: 'IBM', indicator }),
      responseState.response,
      createDependencies(),
    );
    expect(responseState.statusCode).toBe(200);
    expect((responseState.body as { indicator?: string }).indicator).toBe(indicator);
  }
});

// ── Typed upstream error mapping ─────────────────────────────────────────────

it('maps timeout errors to 504', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async () => {
        throw new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT);
      },
    }),
  );
  expect(responseState.statusCode).toBe(504);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.UPSTREAM_TIMEOUT);
});

it('maps rate limit errors to 429', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async () => {
        throw new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED);
      },
    }),
  );
  expect(responseState.statusCode).toBe(429);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.RATE_LIMITED);
});

it('maps generic upstream errors to 502', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async () => {
        throw new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR);
      },
    }),
  );
  expect(responseState.statusCode).toBe(502);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.UPSTREAM_ERROR);
});

it('maps non-AlphaVantageUpstreamError errors to 502 via toAlphaVantageUpstreamError', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async () => { throw new Error('AV API timeout'); },
    }),
  );
  expect(responseState.statusCode).toBe(502);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.UPSTREAM_ERROR);
});

// ── Response size validation ─────────────────────────────────────────────────

it('rejects oversized serialized responses', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      fetchIndicator: async () => ({ data: 'x'.repeat(10 * 1024 * 1024) }),
    }),
  );
  expect(responseState.statusCode).toBe(413);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.RESPONSE_TOO_LARGE);
});

// ── Internal error ───────────────────────────────────────────────────────────

it('returns 500 on unexpected internal error', async () => {
  const responseState = createResponse();
  await technicalIndicatorsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'IBM', indicator: 'ht_trendline' }),
    responseState.response,
    createDependencies({
      symbolExists: async () => { throw new Error('Firestore connection failed'); },
    }),
  );
  expect(responseState.statusCode).toBe(500);
  expect((responseState.body as { code?: string }).code).toBe(TechnicalIndicatorsErrorCode.INTERNAL_ERROR);
});
