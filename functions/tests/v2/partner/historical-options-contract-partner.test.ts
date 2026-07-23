import type { Request, Response } from 'express';
import type { Bucket } from '@google-cloud/storage';
import type { GcsTimeSeriesAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-time-series-adapter.service';
import type { PartnerHistoricalOptionsContractDependencies } from '../../../src/v2/partner/historical-options-contract-partner';
import { partnerHistoricalOptionsContractHandler } from '../../../src/v2/partner/historical-options-contract-partner';

const FIXED_NOW = new Date('2026-07-22T00:00:00.000Z');
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
  query?: Record<string, string | string[] | undefined>;
}

function createRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return { method: 'GET', headers: {}, query: {}, ...overrides };
}

interface GcsAdapterPair {
  adapter: GcsTimeSeriesAdapter;
  bucket: Bucket;
}

function buildDeps(overrides: Partial<PartnerHistoricalOptionsContractDependencies> = {}): PartnerHistoricalOptionsContractDependencies {
  const readLines = jest.fn().mockResolvedValue(undefined);
  const bucket = {
    file: jest.fn().mockReturnValue({
      getMetadata: jest.fn().mockResolvedValue([{}]),
    }),
  };
  const baseDeps: PartnerHistoricalOptionsContractDependencies = {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerHistoricalOptionsContractDependencies['authenticateRequest'],
    getGcs: jest.fn().mockReturnValue({ adapter: { readLines }, bucket } as unknown as GcsAdapterPair) as unknown as PartnerHistoricalOptionsContractDependencies['getGcs'],
    randomUUID: jest.fn().mockReturnValue(FIXED_UUID) as unknown as PartnerHistoricalOptionsContractDependencies['randomUUID'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerHistoricalOptionsContractDependencies['now'],
  };
  return { ...baseDeps, ...overrides };
}

describe('partnerHistoricalOptionsContractHandler', () => {
  it('returns 405 for non-GET methods', async () => {
    const req = createRequest({ method: 'POST' });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Method Not Allowed',
      code: 'METHOD_NOT_ALLOWED',
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it('returns 400 when symbol is missing', async () => {
    const req = createRequest({ query: { contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when contractID is missing', async () => {
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when contractID does not start with symbol', async () => {
    const req = createRequest({ query: { symbol: 'AAPL', contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 for an invalid startDate', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000', startDate: 'not-a-date' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 when startDate is after endDate', async () => {
    const req = createRequest({
      query: {
        symbol: 'QQQ',
        contractID: 'QQQ240719C00450000',
        startDate: '2024-07-20',
        endDate: '2024-07-19',
      },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns the auth result when authentication fails', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const auth = jest.fn().mockImplementation(async (_req: Request, r: Response) => {
      r.status(401).json({ ok: false, error: 'Unauthorized', code: 'FORBIDDEN' });
      return null;
    });
    const deps = buildDeps({ authenticateRequest: auth as unknown as PartnerHistoricalOptionsContractDependencies['authenticateRequest'] });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(auth).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when metadata cannot be resolved', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQBADCONTRACT' } });
    const res = mockResponse();
    const bucket = {
      file: jest.fn().mockReturnValue({
        getMetadata: jest.fn().mockRejectedValue(new Error('not found')),
      }),
    };
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines: jest.fn() }, bucket }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 404 when the time series object does not exist', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const readLines = jest.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket: { file: jest.fn() } }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(readLines).toHaveBeenCalledWith('QQQ', 'QQQ240719C00450000');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('NOT_FOUND');
  });

  it('returns 200 with the full series when no date filter is provided', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const lines = [
      '{"d":"2024-07-15","o":"1.00","h":"1.10","l":"0.90","c":"1.05","v":"100"}',
      '{"d":"2024-07-16","o":"1.05","h":"1.15","l":"0.95","c":"1.10","v":"200"}',
      '{"d":"2024-07-17","o":"1.10","h":"1.20","l":"1.00","c":"1.15","v":"150"}',
    ];
    const readLines = jest.fn().mockResolvedValue(lines);
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket: { file: jest.fn() } }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.symbol).toBe('QQQ');
    expect(body.contractID).toBe('QQQ240719C00450000');
    expect(body.expiration).toBe('2024-07-19');
    expect(body.type).toBe('call');
    expect(body.strike).toBe('450');
    expect(body.startDate).toBe('2024-07-15');
    expect(body.endDate).toBe('2024-07-17');
    expect(body.series).toHaveLength(3);
    expect(body.series[0].date).toBe('2024-07-15');
    expect(body.series[2].date).toBe('2024-07-17');
  });

  it('returns 200 with a filtered series', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000', startDate: '2024-07-16', endDate: '2024-07-16' },
    });
    const res = mockResponse();
    const lines = [
      '{"d":"2024-07-15","o":"1.00","h":"1.10","l":"0.90","c":"1.05","v":"100"}',
      '{"d":"2024-07-16","o":"1.05","h":"1.15","l":"0.95","c":"1.10","v":"200"}',
      '{"d":"2024-07-17","o":"1.10","h":"1.20","l":"1.00","c":"1.15","v":"150"}',
    ];
    const readLines = jest.fn().mockResolvedValue(lines);
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket: { file: jest.fn() } }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.series).toHaveLength(1);
    expect(body.series[0].date).toBe('2024-07-16');
    expect(body.startDate).toBe('2024-07-16');
    expect(body.endDate).toBe('2024-07-16');
  });

  it('returns 200 with an empty series and requested dates when the filter excludes all data', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000', startDate: '2024-07-20', endDate: '2024-07-25' },
    });
    const res = mockResponse();
    const lines = [
      '{"d":"2024-07-15","o":"1.00","h":"1.10","l":"0.90","c":"1.05","v":"100"}',
    ];
    const readLines = jest.fn().mockResolvedValue(lines);
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket: { file: jest.fn() } }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.series).toHaveLength(0);
    expect(body.startDate).toBe('2024-07-20');
    expect(body.endDate).toBe('2024-07-25');
  });

  it('falls back to GCS custom metadata when the contractID cannot be parsed', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQUNKNOWNCONTRACT' } });
    const res = mockResponse();
    const lines = ['{"d":"2024-07-15","o":"1.00","h":"1.10","l":"0.90","c":"1.05","v":"100"}'];
    const readLines = jest.fn().mockResolvedValue(lines);
    const bucket = {
      file: jest.fn().mockReturnValue({
        getMetadata: jest.fn().mockResolvedValue([
          { metadata: { expiration: '2024-07-19', type: 'call', strike: '450' } },
        ]),
      }),
    };
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.expiration).toBe('2024-07-19');
    expect(body.type).toBe('call');
    expect(body.strike).toBe('450');
    expect(body.series).toHaveLength(1);
  });

  it('returns 500 when GCS dependency throws unexpectedly', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', contractID: 'QQQ240719C00450000' } });
    const res = mockResponse();
    const deps = buildDeps({ getGcs: () => { throw new Error('GCS misconfigured'); } });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });

  it('returns 400 for a disallowed symbol', async () => {
    const req = createRequest({ query: { symbol: 'MSFT', contractID: 'MSFT240719C00450000' } });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('allows TQQQ as an allowed symbol', async () => {
    const req = createRequest({ query: { symbol: 'TQQQ', contractID: 'TQQQ240719C00450000' } });
    const res = mockResponse();
    const lines = ['{"d":"2024-07-15","o":"1.00"}'];
    const readLines = jest.fn().mockResolvedValue(lines);
    const deps = buildDeps({ getGcs: () => ({ adapter: { readLines }, bucket: { file: jest.fn() } }) as unknown as GcsAdapterPair });

    await partnerHistoricalOptionsContractHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.symbol).toBe('TQQQ');
    expect(body.series).toHaveLength(1);
  });
});
