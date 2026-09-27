import type { Request, Response } from 'express';
import type { IvMetricsPartnerDependencies } from '../../../src/v2/partner/iv-metrics-partner';
import { partnerIvMetricsHandler } from '../../../src/v2/partner/iv-metrics-partner';
import type { SymbolMetricsYearDoc } from '@shared/options';
import type { TimestampLike } from '@shared/firestore/timestamp';

const STUB_TS: TimestampLike = { seconds: 0, nanoseconds: 0 };

const FIXED_NOW = new Date('2026-09-27T00:00:00.000Z');

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
  return { method: 'GET', headers: {}, query: { symbol: 'QQQ', from: '2024-01-02', to: '2024-01-08' }, ...overrides };
}

const TRACKED_ENABLED = { optionsEnabled: true };

function buildDeps(overrides: Partial<IvMetricsPartnerDependencies> = {}): IvMetricsPartnerDependencies {
  return {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as IvMetricsPartnerDependencies['authenticateRequest'],
    hasExpectedGoogleAudience: jest.fn().mockReturnValue(true),
    readTrackedSymbolDoc: jest.fn().mockResolvedValue(TRACKED_ENABLED),
    readYear: jest.fn().mockResolvedValue(null),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

const YEAR_2023: SymbolMetricsYearDoc = {
  symbol: 'QQQ', year: 2023,
  days: { '2023-12-29': { iv30: 0.2, iv30Method: 'interpolated', iv30Contracts: 100 } },
  updatedAt: STUB_TS,
};
const YEAR_2024: SymbolMetricsYearDoc = {
  symbol: 'QQQ', year: 2024,
  days: {
    '2024-01-05': { iv30: 0.1612, iv30Method: 'interpolated', iv30Contracts: 498 },
    '2024-01-04': { iv30: 0.17, iv30Method: 'nearest', iv30Contracts: 400 },
    '2024-01-03': { iv30: 0.18, iv30Method: 'interpolated', iv30Contracts: 410 },
    '2024-01-02': null as unknown as SymbolMetricsYearDoc['days'][string], // corrupt-entry guard
  },
  updatedAt: STUB_TS,
};

describe('partnerIvMetricsHandler', () => {
  it('returns 405 for non-GET', async () => {
    const res = mockResponse();
    await partnerIvMetricsHandler(createRequest({ method: 'POST' }) as unknown as Request, res as unknown as Response, buildDeps());
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 for a missing/malformed symbol or range', async () => {
    for (const query of [
      { from: '2024-01-02', to: '2024-01-08' },
      { symbol: 'QQQ' },
      { symbol: 'QQQ', from: 'bad', to: '2024-01-08' },
      { symbol: 'QQQ', from: '2024-01-08', to: '2024-01-02' },
    ]) {
      const res = mockResponse();
      await partnerIvMetricsHandler(createRequest({ query }) as unknown as Request, res as unknown as Response, buildDeps());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    }
  });

  it('returns 404 for an untracked symbol', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readTrackedSymbolDoc: jest.fn().mockResolvedValue(undefined) });
    await partnerIvMetricsHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('NOT_FOUND');
  });

  it('returns OPTIONS_NOT_ENABLED when the tracked symbol is not options-enabled', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readTrackedSymbolDoc: jest.fn().mockResolvedValue({ optionsEnabled: false }) });
    await partnerIvMetricsHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('OPTIONS_NOT_ENABLED');
  });

  it('returns ascending rows across a year boundary', async () => {
    const res = mockResponse();
    const readYear = jest.fn().mockImplementation(async (_s: string, y: string | number) =>
      Number(y) === 2023 ? YEAR_2023 : YEAR_2024);
    const deps = buildDeps({ readYear });
    const req = createRequest({ query: { symbol: 'QQQ', from: '2023-12-29', to: '2024-01-05' } });
    await partnerIvMetricsHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(readYear).toHaveBeenCalledWith('QQQ', 2023);
    expect(readYear).toHaveBeenCalledWith('QQQ', 2024);
    expect(res.status).toHaveBeenCalledWith(200);
    const rows = res.json.mock.calls[0][0].rows;
    expect(rows.map((r: { date: string }) => r.date)).toEqual([
      '2023-12-29', '2024-01-03', '2024-01-04', '2024-01-05',
    ]);
  });

  it('filters to the requested metrics fields', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readYear: jest.fn().mockResolvedValue(YEAR_2024) });
    const req = createRequest({ query: { symbol: 'QQQ', from: '2024-01-04', to: '2024-01-05', metrics: 'iv30' } });
    await partnerIvMetricsHandler(req as unknown as Request, res as unknown as Response, deps);

    const rows = res.json.mock.calls[0][0].rows;
    expect(rows).toEqual([
      { date: '2024-01-04', iv30: 0.17 },
      { date: '2024-01-05', iv30: 0.1612 },
    ]);
  });

  it('ignores unknown metrics fields (lenient whitelist)', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readYear: jest.fn().mockResolvedValue(YEAR_2024) });
    const req = createRequest({ query: { symbol: 'QQQ', from: '2024-01-05', to: '2024-01-05', metrics: 'iv30,notAField' } });
    await partnerIvMetricsHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const rows = res.json.mock.calls[0][0].rows;
    expect(rows[0]).toEqual({ date: '2024-01-05', iv30: 0.1612 });
    expect('notAField' in rows[0]).toBe(false);
  });

  it('returns an empty rows array when the range has no data', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readYear: jest.fn().mockResolvedValue(null) });
    await partnerIvMetricsHandler(createRequest() as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it('returns 500 when the reader throws', async () => {
    const res = mockResponse();
    const deps = buildDeps({ readYear: jest.fn().mockRejectedValue(new Error('firestore down')) });
    await partnerIvMetricsHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });

  it('passes the auth result through when authentication rejects', async () => {
    const res = mockResponse();
    const auth = jest.fn().mockImplementation(async (_r: Request, resp: Response) => {
      resp.status(401).json({ ok: false });
      return null;
    });
    const deps = buildDeps({ authenticateRequest: auth as unknown as IvMetricsPartnerDependencies['authenticateRequest'] });
    await partnerIvMetricsHandler(createRequest() as unknown as Request, res as unknown as Response, deps);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
