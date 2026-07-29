import type { Request, Response } from 'express';
import type { GcsTimeSeriesAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-time-series-adapter.service';
import type { PartnerSpreadTimeSeriesDependencies } from '../../../src/v2/partner/spread-time-series-partner';
import { partnerSpreadTimeSeriesHandler } from '../../../src/v2/partner/spread-time-series-partner';

const FIXED_NOW = new Date('2026-07-28T00:00:00.000Z');
const FIXED_UUID = 'test-uuid';

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
  body?: unknown;
}

function createRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return { method: 'POST', headers: {}, body: {}, ...overrides };
}

interface GcsAdapterPair {
  adapter: GcsTimeSeriesAdapter;
}

function makeStorageLine(date: string, mark?: string): string {
  const obj: Record<string, string> = { d: date };
  if (mark !== undefined) obj.m = mark;
  return JSON.stringify(obj);
}

function buildDeps(overrides: Partial<PartnerSpreadTimeSeriesDependencies> = {}): PartnerSpreadTimeSeriesDependencies {
  const readLines = jest.fn()
    .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50')])
    .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25')]);

  const baseDeps: PartnerSpreadTimeSeriesDependencies = {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerSpreadTimeSeriesDependencies['authenticateRequest'],
    getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesDependencies['getGcs'],
    randomUUID: jest.fn().mockReturnValue(FIXED_UUID) as unknown as PartnerSpreadTimeSeriesDependencies['randomUUID'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerSpreadTimeSeriesDependencies['now'],
  };
  return { ...baseDeps, ...overrides };
}

const validBody = {
  spreadType: 'vertical',
  symbol: 'QQQ',
  legs: [
    { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
    { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
  ],
};

describe('partnerSpreadTimeSeriesHandler', () => {
  it('returns 405 for non-POST methods', async () => {
    const req = createRequest({ method: 'GET' });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json.mock.calls[0][0].code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns 400 when body is missing', async () => {
    const req = createRequest({ body: undefined });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when symbol is missing', async () => {
    const req = createRequest({ body: { spreadType: 'vertical', legs: [] } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid spreadType', async () => {
    const req = createRequest({ body: { spreadType: 'butterfly', symbol: 'QQQ', legs: [] } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 for unsupported symbol', async () => {
    const req = createRequest({ body: { ...validBody, symbol: 'AAPL' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 403 when auth fails (no service account)', async () => {
    const req = createRequest({ body: validBody });
    const res = mockResponse();
    const deps = buildDeps({
      authenticateRequest: jest.fn().mockResolvedValue({ uid: 'firebase-uid' }) as unknown as PartnerSpreadTimeSeriesDependencies['authenticateRequest'],
    });

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  it('returns 200 with spread series for valid request', async () => {
    const req = createRequest({ body: validBody });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.spreadType).toBe('vertical');
    expect(response.symbol).toBe('QQQ');
    expect(response.debitOrCredit).toBe('debit');
    expect(response.series).toHaveLength(1);
    expect(response.series[0].price).toBe(5.25);
    expect(response.legs).toHaveLength(2);
  });

  it('returns 400 when leg contract not found in GCS', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50')])
      .mockResolvedValueOnce(undefined);

    const req = createRequest({ body: validBody });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('NOT_FOUND');
    expect(res.json.mock.calls[0][0].error).toContain('QQQ240719C00455000');
  });

  it('returns 500 on internal error', async () => {
    const req = createRequest({ body: validBody });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockImplementation(() => {
        throw new Error('GCS connection failed');
      }) as unknown as PartnerSpreadTimeSeriesDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });
});
