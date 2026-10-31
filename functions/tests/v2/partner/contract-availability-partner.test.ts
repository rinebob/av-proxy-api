import type { Request, Response } from 'express';

import type { PartnerContractAvailabilityDependencies } from '../../../src/v2/partner/contract-availability-partner';
import { partnerContractAvailabilityHandler } from '../../../src/v2/partner/contract-availability-partner';
import type { ContractAvailabilityQueryService } from '../../../src/v2/historical-options-corpus/services/contract-availability-query.service';
import type { CorpusDatesService } from '../../../src/v2/historical-options-corpus/services/corpus-dates.service';
import type { ContractCatalogEntry } from '@shared/options';

const FIXED_NOW = new Date('2026-10-30T00:00:00.000Z');

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

function sampleEntry(overrides: Partial<ContractCatalogEntry> = {}): ContractCatalogEntry {
  return {
    contractId: 'QQQ260116C00450000',
    expiration: '2026-01-16',
    strike: 450,
    type: 'call',
    ...overrides,
  } as ContractCatalogEntry;
}

function createMockQueryService(
  queryAvailabilityImpl?: jest.Mock,
): ContractAvailabilityQueryService {
  return {
    queryAvailability: queryAvailabilityImpl ?? jest.fn().mockResolvedValue({ contracts: [], truncated: false }),
  } as unknown as ContractAvailabilityQueryService;
}

function createMockDatesService(listCorpusDatesImpl?: jest.Mock): CorpusDatesService {
  return {
    listCorpusDates: listCorpusDatesImpl ?? jest.fn().mockResolvedValue([]),
  } as unknown as CorpusDatesService;
}

function buildDeps(overrides: Partial<PartnerContractAvailabilityDependencies> = {}): PartnerContractAvailabilityDependencies {
  const baseDeps: PartnerContractAvailabilityDependencies = {
    authenticateRequest: jest.fn().mockResolvedValue({ serviceAccountEmail: 'svc@example.com' }) as unknown as PartnerContractAvailabilityDependencies['authenticateRequest'],
    now: jest.fn().mockReturnValue(FIXED_NOW) as unknown as PartnerContractAvailabilityDependencies['now'],
    queryServiceFactory: () => createMockQueryService(),
    datesServiceFactory: () => createMockDatesService(),
    isOptionsEnabled: jest.fn().mockResolvedValue(true),
  };
  return { ...baseDeps, ...overrides };
}

describe('partnerContractAvailabilityHandler — auth and method gates', () => {
  it('returns 405 for non-GET methods', async () => {
    const req = createRequest({ method: 'POST', query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json.mock.calls[0][0].code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns without writing when authentication fails', async () => {
    const authenticateRequest = jest.fn().mockResolvedValue(null);
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(
      req as unknown as Request, res as unknown as Response, buildDeps({ authenticateRequest }),
    );

    expect(authenticateRequest).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 403 for non-service-account identities', async () => {
    const authenticateRequest = jest.fn().mockResolvedValue({ uid: 'firebase-user' });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(
      req as unknown as Request, res as unknown as Response, buildDeps({ authenticateRequest }),
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });
});

describe('partnerContractAvailabilityHandler — validation', () => {
  it('returns 400 for a missing symbol', async () => {
    const req = createRequest({ query: {} });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it('returns 400 for an invalid symbol', async () => {
    const req = createRequest({ query: { symbol: 'bad symbol!' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
  });

  it('returns 400 with the parser error for a malformed date', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', expirationGte: 'not-a-date' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('BAD_REQUEST');
    expect(res.json.mock.calls[0][0].error).toContain('expirationGte');
  });

  it('returns 400 for an inverted range pair', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', expirationGte: '2026-07-15', expirationLte: '2025-07-15' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('expirationGte must be <= expirationLte');
  });

  it('returns 400 for non-positive strikeStep', async () => {
    const req = createRequest({ query: { symbol: 'QQQ', strikeStep: '-5' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when the symbol is not options-enabled', async () => {
    const isOptionsEnabled = jest.fn().mockResolvedValue(false);
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(
      req as unknown as Request, res as unknown as Response, buildDeps({ isOptionsEnabled }),
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('OPTIONS_NOT_ENABLED');
  });

  it('returns 400 when the expirations list exceeds the cap', async () => {
    const expirations = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`).join(',');
    const req = createRequest({ query: { symbol: 'QQQ', expirations } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toContain('at most 30');
  });
});

describe('partnerContractAvailabilityHandler — happy path', () => {
  it('returns 200 with contracts + corpusDates in the availability envelope', async () => {
    const contracts = [sampleEntry(), sampleEntry({ contractId: 'QQQ260116P00450000', type: 'put' })];
    const queryAvailability = jest.fn().mockResolvedValue({ contracts, truncated: false });
    const listCorpusDates = jest.fn().mockResolvedValue(['2026-01-02', '2026-01-05']);
    const deps = buildDeps({
      queryServiceFactory: () => createMockQueryService(queryAvailability),
      datesServiceFactory: () => createMockDatesService(listCorpusDates),
    });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      ok: true,
      symbol: 'QQQ',
      count: 2,
      truncated: false,
      corpusDates: ['2026-01-02', '2026-01-05'],
      corpusDateCount: 2,
    });
    expect(body.contracts).toHaveLength(2);
    expect(body.contracts[0].contractId).toBe('QQQ260116C00450000');
    expect(listCorpusDates).toHaveBeenCalledWith('QQQ');
  });

  it('uppercases a lowercase symbol before querying', async () => {
    const queryAvailability = jest.fn().mockResolvedValue({ contracts: [], truncated: false });
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({ query: { symbol: 'qqq' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(queryAvailability).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'QQQ' }));
    expect(res.json.mock.calls[0][0].symbol).toBe('QQQ');
  });

  it('forwards parsed filters (range, type, strikeStep) to the query service', async () => {
    const queryAvailability = jest.fn().mockResolvedValue({ contracts: [], truncated: false });
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({
      query: { symbol: 'QQQ', expirationGte: '2026-01-01', type: 'C', strikeStep: '5' },
    });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(queryAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ expirationGte: '2026-01-01', type: 'call', strikeStep: 5 }),
    );
  });

  it('forwards an explicit expirations list and drops the range', async () => {
    const queryAvailability = jest.fn().mockResolvedValue({ contracts: [], truncated: false });
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({
      query: { symbol: 'QQQ', expirations: '2026-05-15,2026-06-19', expirationGte: '2020-01-01' },
    });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    const filters = queryAvailability.mock.calls[0][0];
    expect(filters.expirations).toEqual(['2026-05-15', '2026-06-19']);
    expect(filters.expirationGte).toBeUndefined();
  });

  it('strips lastUpdated from returned entries even if the service includes it', async () => {
    const entry = { ...sampleEntry(), lastUpdated: '2026-10-30T00:00:00Z' };
    const queryAvailability = jest.fn().mockResolvedValue({ contracts: [entry], truncated: false });
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].contracts[0]).not.toHaveProperty('lastUpdated');
  });

  it('propagates truncated=true from the query service', async () => {
    const queryAvailability = jest.fn().mockResolvedValue({ contracts: [sampleEntry()], truncated: true });
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.json.mock.calls[0][0].truncated).toBe(true);
  });

  it('returns empty contracts + empty corpusDates cleanly for a fresh symbol', async () => {
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, buildDeps());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      ok: true, contracts: [], count: 0, truncated: false, corpusDates: [], corpusDateCount: 0,
    });
  });
});

describe('partnerContractAvailabilityHandler — failure paths', () => {
  it('returns 500 INTERNAL_ERROR when the query service throws', async () => {
    const queryAvailability = jest.fn().mockRejectedValue(new Error('firestore blew up'));
    const deps = buildDeps({ queryServiceFactory: () => createMockQueryService(queryAvailability) });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 INTERNAL_ERROR when the dates service throws', async () => {
    const listCorpusDates = jest.fn().mockRejectedValue(new Error('gcs blew up'));
    const deps = buildDeps({ datesServiceFactory: () => createMockDatesService(listCorpusDates) });
    const req = createRequest({ query: { symbol: 'QQQ' } });
    const res = mockResponse();

    await partnerContractAvailabilityHandler(req as unknown as Request, res as unknown as Response, deps);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
  });
});
