import type { Request, Response } from 'express';
import type { GcsTimeSeriesAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-time-series-adapter.service';
import type { PartnerSpreadTimeSeriesBatchDependencies } from '../../../src/v2/partner/spread-time-series-batch-partner';
import { partnerSpreadTimeSeriesBatchHandler } from '../../../src/v2/partner/spread-time-series-batch-partner';

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

function buildDeps(overrides: Partial<PartnerSpreadTimeSeriesBatchDependencies> = {}): PartnerSpreadTimeSeriesBatchDependencies {
  const readLines = jest.fn()
    .mockResolvedValue([makeStorageLine('2024-05-01', '8.50')]);

  const baseDeps: PartnerSpreadTimeSeriesBatchDependencies = {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerSpreadTimeSeriesBatchDependencies['authenticateRequest'],
    getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    randomUUID: jest.fn().mockReturnValue(FIXED_UUID) as unknown as PartnerSpreadTimeSeriesBatchDependencies['randomUUID'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerSpreadTimeSeriesBatchDependencies['now'],
  };
  return { ...baseDeps, ...overrides };
}

const validSpread = {
  spreadType: 'vertical' as const,
  symbol: 'QQQ',
  legs: [
    { expiration: '2024-07-19', strike: 450, optionType: 'call' as const, direction: 'long' as const },
    { expiration: '2024-07-19', strike: 455, optionType: 'call' as const, direction: 'short' as const },
  ],
};

const validBatchBody = {
  spreads: [validSpread],
};

describe('partnerSpreadTimeSeriesBatchHandler', () => {
  it('returns 405 for non-POST methods', async () => {
    const req = createRequest({ method: 'GET' });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json.mock.calls[0][0].code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns 400 when body is missing spreads array', async () => {
    const req = createRequest({ body: { foo: 'bar' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when spreads array is empty', async () => {
    const req = createRequest({ body: { spreads: [] } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('must not be empty');
  });

  it('returns 400 when spreads exceed max batch size', async () => {
    const spreads = Array.from({ length: 201 }, () => validSpread);
    const req = createRequest({ body: { spreads } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('maximum batch size');
  });

  it('returns 400 when batch startDate > endDate', async () => {
    const req = createRequest({ body: { ...validBatchBody, startDate: '2024-07-20', endDate: '2024-07-19' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when batch startDate is not a valid ISO date', async () => {
    const req = createRequest({ body: { ...validBatchBody, startDate: 'not-a-date' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('startDate');
  });

  it('returns 400 when batch endDate is not a valid ISO date', async () => {
    const req = createRequest({ body: { ...validBatchBody, endDate: 'invalid' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('endDate');
  });

  it('returns 403 when auth fails (no service account)', async () => {
    const req = createRequest({ body: validBatchBody });
    const res = mockResponse();
    const deps = buildDeps({
      authenticateRequest: jest.fn().mockResolvedValue({ uid: 'firebase-uid' }) as unknown as PartnerSpreadTimeSeriesBatchDependencies['authenticateRequest'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  it('returns 200 with batch results for valid request', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20')]);

    const req = createRequest({ body: validBatchBody });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.total).toBe(1);
    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(0);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].ok).toBe(true);
    expect(response.results[0].index).toBe(0);
    expect(response.results[0].spreadType).toBe('vertical');
    expect(response.results[0].debitOrCredit).toBe('debit');
    expect(response.results[0].series).toHaveLength(2);
    expect(response.results[0].series[0].price).toBe(5.25);
    // No leg series in batch results
    expect(response.results[0].legs).toBeUndefined();
  });

  it('handles partial failures — one valid, one invalid spread', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20')]);

    const body = {
      spreads: [
        validSpread,
        { spreadType: 'vertical', symbol: 'QQQ', legs: [] },
      ],
    };

    const req = createRequest({ body });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.total).toBe(2);
    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(1);
    expect(response.results[0].ok).toBe(true);
    expect(response.results[1].ok).toBe(false);
    expect(response.results[1].index).toBe(1);
    expect(response.results[1].code).toBe('BAD_REQUEST');
  });

  it('handles leg not found as partial failure', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50')])
      .mockResolvedValueOnce(undefined);

    const req = createRequest({ body: validBatchBody });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.succeeded).toBe(0);
    expect(response.failed).toBe(1);
    expect(response.results[0].ok).toBe(false);
    expect(response.results[0].code).toBe('NOT_FOUND');
  });

  it('applies batch-level startDate/endDate to all spreads', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45'), makeStorageLine('2024-05-03', '8.40')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20'), makeStorageLine('2024-05-03', '3.15')]);

    const body = {
      spreads: [validSpread],
      startDate: '2024-05-02',
      endDate: '2024-05-02',
    };

    const req = createRequest({ body });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.results[0].series).toHaveLength(1);
    expect(response.results[0].series[0].date).toBe('2024-05-02');
  });

  it('returns 500 on internal error', async () => {
    const req = createRequest({ body: validBatchBody });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockImplementation(() => {
        throw new Error('GCS connection failed');
      }) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });

  it('preserves result ordering by index', async () => {
    const readLines = jest.fn()
      .mockResolvedValue([makeStorageLine('2024-05-01', '8.50')]);

    const body = {
      spreads: [
        { ...validSpread, symbol: 'QQQ' },
        { ...validSpread, symbol: 'QQQ' },
        { ...validSpread, symbol: 'QQQ' },
      ],
    };

    const req = createRequest({ body });
    const res = mockResponse();
    const deps = buildDeps({
      getGcs: jest.fn().mockReturnValue({ adapter: { readLines } as unknown as GcsTimeSeriesAdapter } as unknown as GcsAdapterPair) as unknown as PartnerSpreadTimeSeriesBatchDependencies['getGcs'],
    });

    await partnerSpreadTimeSeriesBatchHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.results.map((r: any) => r.index)).toEqual([0, 1, 2]);
  });
});
