import type { Request, Response } from 'express';

import type { PartnerContractCatalogDependencies } from '../../../src/v2/partner/partner-contract-catalog-partner';
import { partnerContractCatalogHandler } from '../../../src/v2/partner/partner-contract-catalog-partner';
import type { ContractCatalogQueryService } from '../../../src/v2/historical-options-corpus/services/contract-catalog-query.service';
import { FilterConflictError } from '../../../src/v2/historical-options-corpus/services/contract-catalog-query.service';

const FIXED_NOW = new Date('2026-07-22T00:00:00.000Z');

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

/** Creates a mock ContractCatalogQueryService with configurable return values. */
function createMockQueryService(
  queryCatalogImpl?: jest.Mock,
  getSummaryImpl?: jest.Mock,
): ContractCatalogQueryService {
  return {
    queryCatalog: queryCatalogImpl ?? jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    getSummary: getSummaryImpl ?? jest.fn().mockResolvedValue(null),
  } as unknown as ContractCatalogQueryService;
}

function buildDeps(overrides: Partial<PartnerContractCatalogDependencies> = {}): PartnerContractCatalogDependencies {
  const baseDeps: PartnerContractCatalogDependencies = {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerContractCatalogDependencies['authenticateRequest'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerContractCatalogDependencies['now'],
    queryServiceFactory: () => createMockQueryService(),
  };
  return { ...baseDeps, ...overrides };
}

describe('partnerContractCatalogHandler — expiration range filtering', () => {

  it('returns 400 for invalid expirationGte format', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: 'not-a-date' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('expirationGte');
  });

  it('returns 400 for invalid expirationLte format', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', expirationLte: '2026/07/15' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('expirationLte');
  });

  it('returns 400 when expiration (exact) is combined with expirationGte', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', expiration: '2026-01-16', expirationGte: '2024-07-15' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('cannot be combined');
  });

  it('returns 400 when expiration (exact) is combined with expirationLte', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', expiration: '2026-01-16', expirationLte: '2026-07-15' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('cannot be combined');
  });

  it('returns 400 when expirationGte is after expirationLte', async () => {
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: '2026-07-15', expirationLte: '2024-07-15' },
    });
    const res = mockResponse();
    const deps = buildDeps();

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('expirationGte must be less than or equal to expirationLte');
  });

  it('returns 400 when expiration range is combined with strike range (FilterConflictError)', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockRejectedValue(new FilterConflictError(
        'At most one range dimension is supported per query. Found: expiration, strike.',
      )),
    );
    const req = createRequest({
      query: {
        symbol: 'QQQ',
        expirationGte: '2024-07-15',
        expirationLte: '2026-07-15',
        strikeGte: '400',
        strikeLte: '500',
      },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('At most one range dimension');
  });

});

describe('partnerContractCatalogHandler — acceptance and edge cases', () => {

  it('returns 200 with contracts for valid expirationGte/expirationLte range (expected use)', async () => {
    const mockContract = {
      contractId: 'QQQ260116C00450000',
      expiration: '2026-01-16',
      strike: 450,
      type: 'call',
      firstObserved: '2025-10-15',
      firstObservedDow: 'Wed',
      lastObserved: '2026-07-25',
      lastObservedDow: 'Fri',
      observationCount: 180,
      expectedObservationCount: 185,
      contractLengthDays: 93,
      contractLengthBucket: '3mo',
      lastUpdated: '2026-07-25T16:00:00Z',
    };
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [mockContract], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: '2024-07-15', expirationLte: '2026-07-15' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].ok).toBe(true);
    expect(res.json.mock.calls[0][0].contracts).toHaveLength(1);
    expect(res.json.mock.calls[0][0].contracts[0].contractId).toBe('QQQ260116C00450000');
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'QQQ',
        expirationGte: '2024-07-15',
        expirationLte: '2026-07-15',
      }),
    );
  });

  it('returns 200 when expirationGte equals expirationLte (single-day range edge case)', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: '2026-01-16', expirationLte: '2026-01-16' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        expirationGte: '2026-01-16',
        expirationLte: '2026-01-16',
      }),
    );
  });

  it('returns 200 with only expirationGte (open-ended range edge case)', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: '2024-07-15' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        expirationGte: '2024-07-15',
        expirationLte: undefined,
      }),
    );
  });

  it('parses comma-separated contractLengthBucket into array (expected use)', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', contractLengthBucket: '3mo,6mo,1yr' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        contractLengthBuckets: ['3mo', '6mo', '1yr'],
      }),
    );
  });

  it('parses single contractLengthBucket value into single-element array', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', contractLengthBucket: '3mo' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        contractLengthBuckets: ['3mo'],
      }),
    );
  });

  it('trims whitespace in comma-separated contractLengthBucket values', async () => {
    const mockService = createMockQueryService(
      jest.fn().mockResolvedValue({ contracts: [], nextPageToken: undefined }),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', contractLengthBucket: ' 3mo , 6mo ,1yr ' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.queryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        contractLengthBuckets: ['3mo', '6mo', '1yr'],
      }),
    );
  });

  it('returns 400 for invalid contractLengthBucket label', async () => {
    const mockService = createMockQueryService();
    const req = createRequest({
      query: { symbol: 'QQQ', contractLengthBucket: '3mo,invalid,1yr' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('invalid');
    expect(mockService.queryCatalog).not.toHaveBeenCalled();
  });

  it('returns 400 when all contractLengthBucket labels are invalid', async () => {
    const mockService = createMockQueryService();
    const req = createRequest({
      query: { symbol: 'QQQ', contractLengthBucket: 'foo,bar' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('foo');
    expect(res.json.mock.calls[0][0].error).toContain('bar');
  });
});

describe('partnerContractCatalogHandler — summary response with LengthBucketEntry[]', () => {

  it('returns 200 with lengthBuckets as array of LengthBucketEntry (expected use)', async () => {
    const mockSummary = {
      symbol: 'QQQ',
      totalContracts: 500,
      expirationCount: 12,
      lengthBuckets: [
        { label: '1d', count: 5, sortOrder: 0 },
        { label: '3mo', count: 200, sortOrder: 9 },
        { label: '1yr', count: 50, sortOrder: 13 },
      ],
      lastUpdated: '2026-07-25T16:00:00Z',
    };
    const mockService = createMockQueryService(
      undefined,
      jest.fn().mockResolvedValue(mockSummary),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', summary: 'true' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.lengthBuckets)).toBe(true);
    expect(body.lengthBuckets).toHaveLength(3);
    expect(body.lengthBuckets[0]).toEqual({ label: '1d', count: 5, sortOrder: 0 });
    expect(body.lengthBuckets[1]).toEqual({ label: '3mo', count: 200, sortOrder: 9 });
    expect(body.lengthBuckets[2]).toEqual({ label: '1yr', count: 50, sortOrder: 13 });
  });

  it('returns 200 with empty lengthBuckets array when no contracts exist (edge case)', async () => {
    const mockSummary = {
      symbol: 'QQQ',
      totalContracts: 0,
      expirationCount: 0,
      lengthBuckets: [],
      lastUpdated: '2026-07-25T16:00:00Z',
    };
    const mockService = createMockQueryService(
      undefined,
      jest.fn().mockResolvedValue(mockSummary),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', summary: 'true' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.lengthBuckets)).toBe(true);
    expect(body.lengthBuckets).toHaveLength(0);
  });

  it('returns 404 when summary does not exist (failure case)', async () => {
    const mockService = createMockQueryService(
      undefined,
      jest.fn().mockResolvedValue(null),
    );
    const req = createRequest({
      query: { symbol: 'QQQ', summary: 'true' },
    });
    const res = mockResponse();
    const deps = buildDeps({ queryServiceFactory: () => mockService });

    await partnerContractCatalogHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('NOT_FOUND');
  });
});
