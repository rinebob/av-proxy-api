import type { Request, Response } from 'express';
import type { IvRankPartnerDependencies } from '../../../src/v2/partner/iv-rank-partner';
import { partnerIvRankHandler } from '../../../src/v2/partner/iv-rank-partner';
import type { IvRankLatestDoc } from '@shared/options';
import type { TimestampLike } from '@shared/firestore/timestamp';

const STUB_TS: TimestampLike = { seconds: 0, nanoseconds: 0 };
const FIXED_NOW = new Date('2026-09-30T00:00:00.000Z');

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

function createRequest(overrides: { method?: string; query?: Record<string, string | undefined> } = {}) {
  return { method: 'GET', headers: {}, query: {}, ...overrides };
}

const DOCS: IvRankLatestDoc[] = [
  { symbol: 'AAA', asOfDate: '2026-09-29', ivRank360: 10, ivPct360: 20, ivN360: 200, ivRank30: 5, ivN30: 20, updatedAt: STUB_TS },
  { symbol: 'BBB', asOfDate: '2026-09-29', ivRank360: 90, ivPct360: 95, ivN360: 200, ivRank30: 80, ivN30: 5, updatedAt: STUB_TS },
  { symbol: 'CCC', asOfDate: '2026-09-29', ivRank360: 50, ivPct360: 55, ivN360: 30, updatedAt: STUB_TS },
  { symbol: 'DDD', asOfDate: '2026-09-29', ivPct360: 40, ivN360: 200, updatedAt: STUB_TS }, // no ivRank360 — sinks on sort
];

function buildDeps(overrides: Partial<IvRankPartnerDependencies> = {}): IvRankPartnerDependencies {
  return {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as IvRankPartnerDependencies['authenticateRequest'],
    hasExpectedGoogleAudience: jest.fn().mockReturnValue(true),
    listLatest: jest.fn().mockResolvedValue(DOCS),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

const rows = (res: MockResponse) => res.json.mock.calls[0][0].rows as IvRankLatestDoc[];

describe('partnerIvRankHandler', () => {
  it('returns 405 for non-GET', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(createRequest({ method: 'POST' }) as unknown as Request, res as unknown as Response, buildDeps());
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 403 for non-service-account auth', async () => {
    const res = mockResponse();
    const deps = buildDeps({ authenticateRequest: jest.fn().mockResolvedValue({ uid: 'user' }) as never });
    await partnerIvRankHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns all rows sorted by symbol when no params', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(createRequest() as unknown as Request, res as unknown as Response, buildDeps());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(rows(res).map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(res.json.mock.calls[0][0].count).toBe(4);
  });

  it('serializes updatedAt as ISO-8601, not the Firestore {_seconds} shape', async () => {
    const res = mockResponse();
    const doc = { ...DOCS[0], updatedAt: { seconds: 1770000000, nanoseconds: 0 } };
    const deps = buildDeps({ listLatest: jest.fn().mockResolvedValue([doc]) });
    await partnerIvRankHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect((rows(res)[0] as any).updatedAt).toBe('2026-02-02T02:40:00.000Z');
    const nullDoc = { ...DOCS[0], updatedAt: null as any };
    const deps2 = buildDeps({ listLatest: jest.fn().mockResolvedValue([nullDoc]) });
    const res2 = mockResponse();
    await partnerIvRankHandler(createRequest() as unknown as Request, res2 as unknown as Response, deps2);
    expect((rows(res2)[0] as any).updatedAt).toBeNull();
  });

  it('sorts by a rank field desc with missing values sinking to the bottom', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(
      createRequest({ query: { sort: 'ivRank360', dir: 'desc' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    expect(rows(res).map((r) => r.symbol)).toEqual(['BBB', 'CCC', 'AAA', 'DDD']);
  });

  it('honors dir=asc', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(
      createRequest({ query: { sort: 'ivPct360', dir: 'asc' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    expect(rows(res).map((r) => r.symbol)).toEqual(['AAA', 'DDD', 'CCC', 'BBB']);
  });

  it('minN filters on the sort window n (ivRank30 → ivN30)', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(
      createRequest({ query: { sort: 'ivRank30', minN: '10' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    // BBB has ivN30=5 < 10 → excluded; AAA n=20, CCC/DDD lack ivN30→ 0 → excluded
    expect(rows(res).map((r) => r.symbol)).toEqual(['AAA']);
  });

  it('minN falls back to ivN360 when sort is unset', async () => {
    const res = mockResponse();
    await partnerIvRankHandler(
      createRequest({ query: { minN: '100' } }) as unknown as Request,
      res as unknown as Response,
      buildDeps(),
    );
    expect(rows(res).map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'DDD']); // CCC n=30 excluded
  });

  it('rejects unknown sort fields and bad dir/minN', async () => {
    for (const query of [{ sort: 'ivRank7' }, { sort: 'iv30' }, { dir: 'sideways' }, { minN: 'x' }, { minN: '-1' }]) {
      const res = mockResponse();
      await partnerIvRankHandler(createRequest({ query }) as unknown as Request, res as unknown as Response, buildDeps());
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('returns an empty table when no docs exist', async () => {
    const res = mockResponse();
    const deps = buildDeps({ listLatest: jest.fn().mockResolvedValue([]) });
    await partnerIvRankHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: true, count: 0, rows: [] });
  });
});
