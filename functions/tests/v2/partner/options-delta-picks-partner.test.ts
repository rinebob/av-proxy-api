/**
 * Tests for `partnerOptionsDeltaPicksV1` (Task #225).
 *
 * The doc read is exercised through the injected `readCellYearDoc` seam —
 * backed by an in-memory doc store so the full path
 * (cellId assembly → `options-delta-picks/{cellId}/years/{YYYY}` lookup →
 * response) runs through the real code path, same convention as the cell
 * writer tests (no live emulator needed).
 */
import type { Request, Response } from 'express';

import type { CellYearDoc } from '@shared/options';
import {
  OPTIONS_DELTA_PICKS_COLLECTION,
  OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION,
  PICK_GRID_VERSION,
} from '@shared/options';

import type { PartnerDeltaPicksDependencies } from '../../../src/v2/partner/options-delta-picks-partner';
import { partnerOptionsDeltaPicksHandler } from '../../../src/v2/partner/options-delta-picks-partner';

const FIXED_NOW = new Date('2026-10-30T00:00:00.000Z');
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
  headersSent: boolean;
}

function mockResponse(): MockResponse {
  const res: MockResponse = { status: jest.fn(), json: jest.fn(), headersSent: false };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

interface MockRequest {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
}

function createRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return { method: 'GET', headers: {}, query: {}, ...overrides };
}

const VALID_QUERY = { symbol: 'QQQ', type: 'put', delta: '20', dte: '45', year: '2026' };
const VALID_PATH = `${OPTIONS_DELTA_PICKS_COLLECTION}/QQQ-put-20-45/${OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION}/2026`;

function sampleDoc(overrides: Partial<CellYearDoc> = {}): CellYearDoc {
  return {
    symbol: 'QQQ',
    type: 'put',
    targetDelta: -0.2,
    expiry: { mode: 'nearestDte', dte: 45 },
    gridVersion: PICK_GRID_VERSION,
    firstDate: '2026-04-01',
    lastDate: '2026-04-14',
    pickCount: 1,
    missCount: 1,
    days: {
      '2026-04-01': {
        underlyingClose: 584.31,
        contractId: 'QQQ260515P00565000',
        expiration: '2026-05-15',
        dte: 44,
        strike: 565,
        delta: -0.204,
        iv: 0.198,
        mark: 8.42,
        bid: 8.3,
        ask: 8.54,
        volume: 412,
        openInterest: 5210,
      },
      '2026-04-14': { status: 'no_chain', underlyingClose: 617.8 },
    },
    updatedAt: { seconds: 1777420800, nanoseconds: 0 },
    ...overrides,
  };
}

/** In-memory doc store — the "emulator" seam behind readCellYearDoc. */
function createDocStore() {
  const store = new Map<string, CellYearDoc>();
  const readCellYearDoc = jest.fn(async (cellId: string, year: number) =>
    store.get(`${OPTIONS_DELTA_PICKS_COLLECTION}/${cellId}/${OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION}/${year}`));
  return { store, readCellYearDoc };
}

function buildDeps(overrides: Partial<PartnerDeltaPicksDependencies> = {}): PartnerDeltaPicksDependencies {
  return {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerDeltaPicksDependencies['authenticateRequest'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerDeltaPicksDependencies['now'],
    isOptionsEnabled: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('partnerOptionsDeltaPicksHandler — auth and method gates', () => {
  it('returns 405 for non-GET methods', async () => {
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ method: 'POST', query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json.mock.calls[0][0].code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns without writing when authentication fails', async () => {
    const authenticateRequest = jest.fn().mockResolvedValue(null);
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ authenticateRequest }),
    );
    expect(authenticateRequest).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 for non-service-account identities', async () => {
    const authenticateRequest = jest.fn().mockResolvedValue({ uid: 'firebase-user' });
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ authenticateRequest }),
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });
});

describe('partnerOptionsDeltaPicksHandler — validation', () => {
  it.each([
    ['missing symbol', { type: 'put', delta: '20', dte: '45', year: '2026' }, 'symbol'],
    ['invalid type', { symbol: 'QQQ', type: 'strangle', delta: '20', dte: '45', year: '2026' }, 'type'],
    ['off-grid delta', { symbol: 'QQQ', type: 'put', delta: '17', dte: '45', year: '2026' }, 'delta'],
    ['off-grid dte', { symbol: 'QQQ', type: 'put', delta: '20', dte: '63', year: '2026' }, 'dte'],
    ['malformed year', { symbol: 'QQQ', type: 'put', delta: '20', dte: '45', year: '20X6' }, 'year'],
  ])('returns 400 naming the failed component (%s)', async (_label, query, component) => {
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ ok: false, code: 'BAD_REQUEST', timestamp: FIXED_NOW_ISO });
    expect(body.error).toContain(component);
  });

  it('returns 404 OPTIONS_NOT_ENABLED when the symbol is not options-enabled', async () => {
    const isOptionsEnabled = jest.fn().mockResolvedValue(false);
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ isOptionsEnabled }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('OPTIONS_NOT_ENABLED');
  });
});

describe('partnerOptionsDeltaPicksHandler — doc read', () => {
  it('serves the year-sharded cell doc for valid in-grid params', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, sampleDoc());
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    expect(readCellYearDoc).toHaveBeenCalledWith('QQQ-put-20-45', 2026);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      ok: true,
      symbol: 'QQQ',
      type: 'put',
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
      gridVersion: PICK_GRID_VERSION,
      firstDate: '2026-04-01',
      lastDate: '2026-04-14',
      pickCount: 1,
      missCount: 1,
    });
    expect(body.days['2026-04-01'].contractId).toBe('QQQ260515P00565000');
    expect(body.days['2026-04-14'].status).toBe('no_chain');
  });

  it('serializes updatedAt as an ISO-8601 string', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, sampleDoc());
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    const body = res.json.mock.calls[0][0];
    expect(typeof body.updatedAt).toBe('string');
    expect(body.updatedAt).toBe(new Date(1777420800 * 1000).toISOString());
  });

  it('strips stored fields not in the wire contract', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, { ...sampleDoc(), internalRunId: 'run-xyz', debugMeta: { a: 1 } } as unknown as CellYearDoc);
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    const body = res.json.mock.calls[0][0];
    expect(body).not.toHaveProperty('internalRunId');
    expect(body).not.toHaveProperty('debugMeta');
  });

  it('serializes a real Firestore Timestamp via toDate()', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, {
      ...sampleDoc(),
      updatedAt: { toDate: () => new Date('2026-10-30T16:52:39.747Z') },
    } as unknown as CellYearDoc);
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    expect(res.json.mock.calls[0][0].updatedAt).toBe('2026-10-30T16:52:39.747Z');
  });

  it('returns updatedAt null when the stored doc is unstamped', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, { ...sampleDoc(), updatedAt: undefined } as unknown as CellYearDoc);
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    expect(res.json.mock.calls[0][0].updatedAt).toBeNull();
  });

  it('serves a hyphenated symbol under its round-trip cellId', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(`${OPTIONS_DELTA_PICKS_COLLECTION}/BRK-B-put-20-45/${OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION}/2026`, sampleDoc({ symbol: 'BRK-B' }));
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: { ...VALID_QUERY, symbol: 'BRK-B' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    expect(readCellYearDoc).toHaveBeenCalledWith('BRK-B-put-20-45', 2026);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uppercases a lowercase symbol before the doc lookup', async () => {
    const { store, readCellYearDoc } = createDocStore();
    store.set(VALID_PATH, sampleDoc());
    const res = mockResponse();

    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: { ...VALID_QUERY, symbol: 'qqq' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );

    expect(readCellYearDoc).toHaveBeenCalledWith('QQQ-put-20-45', 2026);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 NOT_FOUND when the year shard doc does not exist', async () => {
    const { readCellYearDoc } = createDocStore();
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: { ...VALID_QUERY, year: '2027' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('NOT_FOUND');
  });

  it('returns 500 INTERNAL_ERROR when the doc read throws', async () => {
    const readCellYearDoc = jest.fn().mockRejectedValue(new Error('firestore blew up'));
    const res = mockResponse();
    await partnerOptionsDeltaPicksHandler(
      createRequest({ query: VALID_QUERY }) as unknown as Request,
      res as unknown as Response,
      buildDeps({ readCellYearDoc }),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });
});
