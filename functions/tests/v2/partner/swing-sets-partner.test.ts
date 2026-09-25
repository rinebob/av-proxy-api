import type { Request, Response } from 'express';

import type { SwingSetDoc, SwingStats } from '@shared/zigzag';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import { HttpMethod } from '@shared/core';

import {
  swingSetsPartnerHandler,
  SwingSetsErrorCode,
  type SwingSetsPartnerDependencies,
} from '../../../src/v2/partner/swing-sets-partner';

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

const testNow = new Date('2026-09-24T00:00:00.000Z');

const ZERO_DIST = { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
const ZERO_DIR: SwingStats['up'] = {
  count: 0, magnitudePercent: ZERO_DIST, magnitudeAbsolute: ZERO_DIST, duration: ZERO_DIST,
  magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] },
};

function makeDoc(symbol: string, paramsId: string): SwingSetDoc {
  return {
    symbol,
    paramsId,
    config: CANONICAL_ZIGZAG_CONFIGS[0],
    pivots: [],
    projection: null,
    swings: [],
    stats: { up: ZERO_DIR, down: ZERO_DIR },
    generatedAt: { seconds: 1_760_000_000, nanoseconds: 0 },
    source: 'sa',
  };
}

const PARAMS_ID = deriveParamsId(CANONICAL_ZIGZAG_CONFIGS[0]);
const testDoc = makeDoc('AAPL', PARAMS_ID);
const testDocs = CANONICAL_ZIGZAG_CONFIGS.map((c) => makeDoc('AAPL', deriveParamsId(c)));

function createDependencies(
  overrides: Partial<SwingSetsPartnerDependencies> = {},
): SwingSetsPartnerDependencies {
  return {
    authenticateRequest: async () => ({ serviceAccountEmail: 'st@example.com' }),
    hasExpectedGoogleAudience: () => true,
    getTrackedFlags: async () => ({ tracked: true, optionsEnabled: true }),
    getSwingSet: async () => testDoc,
    listSwingSets: async () => testDocs,
    now: () => testNow,
    ...overrides,
  };
}

function createRequest(method: HttpMethod, query: Record<string, unknown> = {}): Request {
  return { method, query } as Request;
}

it('rejects non-GET methods', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(createRequest(HttpMethod.POST), state.response, createDependencies());
  expect(state.statusCode).toBe(405);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.METHOD_NOT_ALLOWED);
});

it('fails closed when the expected OIDC audience is not configured', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET),
    state.response,
    createDependencies({ hasExpectedGoogleAudience: () => false }),
  );
  expect(state.statusCode).toBe(500);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.INTERNAL_ERROR);
});

it('stops when authentication rejects the request', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET),
    state.response,
    createDependencies({ authenticateRequest: async () => null }),
  );
  expect(state.statusCode).toBeUndefined();
});

it('rejects a Firebase-authenticated caller (service account required)', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET),
    state.response,
    createDependencies({ authenticateRequest: async () => ({ uid: 'firebase-user' }) }),
  );
  expect(state.statusCode).toBe(403);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.FORBIDDEN);
});

it('rejects a missing symbol with 400', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(createRequest(HttpMethod.GET), state.response, createDependencies());
  expect(state.statusCode).toBe(400);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.BAD_REQUEST);
});

it('rejects a malformed symbol with 400', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'foo!' }),
    state.response,
    createDependencies(),
  );
  expect(state.statusCode).toBe(400);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.BAD_REQUEST);
});

it('rejects a malformed paramsId with 400', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL', paramsId: 'a/b' }),
    state.response,
    createDependencies(),
  );
  expect(state.statusCode).toBe(400);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.BAD_REQUEST);
});

it('rejects untracked symbols with 404 NOT_FOUND', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'ZZNOPE' }),
    state.response,
    createDependencies({ getTrackedFlags: async () => ({ tracked: false, optionsEnabled: false }) }),
  );
  expect(state.statusCode).toBe(404);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.NOT_FOUND);
});

it('rejects tracked-but-not-options-enabled symbols', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'MSFT' }),
    state.response,
    createDependencies({ getTrackedFlags: async () => ({ tracked: true, optionsEnabled: false }) }),
  );
  expect(state.statusCode).toBe(403);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.OPTIONS_NOT_ENABLED);
});

it('returns 404 NOT_FOUND for a missing paramsId doc', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL', paramsId: 'nope' }),
    state.response,
    createDependencies({ getSwingSet: async () => null }),
  );
  expect(state.statusCode).toBe(404);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.NOT_FOUND);
});

it('returns a single swing file when paramsId is provided', async () => {
  const listSwingSets = jest.fn(async () => testDocs);
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'aapl', paramsId: PARAMS_ID }),
    state.response,
    createDependencies({ listSwingSets }),
  );
  expect(state.statusCode).toBe(200);
  const body = state.body as {
    ok?: boolean; symbol?: string; paramsId?: string; source?: string;
    data?: SwingSetDoc; timestamp?: string; processingTimeMs?: number;
  };
  expect(body.ok).toBe(true);
  expect(body.symbol).toBe('AAPL');
  expect(body.paramsId).toBe(PARAMS_ID);
  expect(body.source).toBe('sa');
  expect(body.data).toBe(testDoc);
  expect(body.timestamp).toBe(testNow.toISOString());
  expect(typeof body.processingTimeMs).toBe('number');
  expect(listSwingSets).not.toHaveBeenCalled();
});

it('returns all canonical swing files keyed by paramsId when paramsId is omitted', async () => {
  const getSwingSet = jest.fn(async () => testDoc);
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: ' AAPL ' }),
    state.response,
    createDependencies({ getSwingSet }),
  );
  expect(state.statusCode).toBe(200);
  const body = state.body as { ok?: boolean; data?: Record<string, SwingSetDoc>; paramsId?: string };
  expect(body.ok).toBe(true);
  expect(body.paramsId).toBeUndefined();
  expect(Object.keys(body.data ?? {}).sort()).toEqual(
    CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId).sort(),
  );
  expect(body.data?.[PARAMS_ID].symbol).toBe('AAPL');
  expect(getSwingSet).not.toHaveBeenCalled();
});

it('excludes non-canonical docs from the all-docs response', async () => {
  const stray = makeDoc('AAPL', 'experimental-9');
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    state.response,
    createDependencies({ listSwingSets: async () => [...testDocs, stray] }),
  );
  expect(state.statusCode).toBe(200);
  const body = state.body as { data?: Record<string, SwingSetDoc> };
  expect(Object.keys(body.data ?? {})).not.toContain('experimental-9');
});

it('returns a partial map when only some canonical docs exist', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    state.response,
    createDependencies({ listSwingSets: async () => [testDoc] }),
  );
  expect(state.statusCode).toBe(200);
  const body = state.body as { data?: Record<string, SwingSetDoc> };
  expect(Object.keys(body.data ?? {})).toEqual([PARAMS_ID]);
});

it('returns 404 when a valid symbol has no swing docs at all', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    state.response,
    createDependencies({ listSwingSets: async () => [] }),
  );
  expect(state.statusCode).toBe(404);
});

it('maps repository failures to 500 INTERNAL_ERROR', async () => {
  const state = createResponse();
  await swingSetsPartnerHandler(
    createRequest(HttpMethod.GET, { symbol: 'AAPL' }),
    state.response,
    createDependencies({
      listSwingSets: async () => { throw new Error('firestore down'); },
    }),
  );
  expect(state.statusCode).toBe(500);
  expect((state.body as { code?: string }).code).toBe(SwingSetsErrorCode.INTERNAL_ERROR);
});
