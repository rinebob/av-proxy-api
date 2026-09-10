// Mock Firestore db
const mockWhere = jest.fn();
const mockGet = jest.fn();
const mockRunTransaction = jest.fn();
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    collection: jest.fn(() => ({
      where: mockWhere,
    })),
    runTransaction: mockRunTransaction,
  },
}));

// Mock publishIntradayPdr
const mockPublishIntradayPdr = jest.fn();
jest.mock('../../../../src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator', () => ({
  publishIntradayPdr: mockPublishIntradayPdr,
}));

import { forceCompleteStaleIntradayRuns } from '../../../../src/v2/alpha-vantage/data-refresher/intraday-self-healing';

describe('forceCompleteStaleIntradayRuns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhere.mockReturnValue({ where: mockWhere, get: mockGet });
    mockPublishIntradayPdr.mockResolvedValue(undefined);
  });

  it('returns empty array when no stale runs exist', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    const result = await forceCompleteStaleIntradayRuns('2026-09-09');

    expect(result).toEqual([]);
    expect(mockPublishIntradayPdr).not.toHaveBeenCalled();
  });

  it('force-completes a single stale run and publishes FAILED PDR', async () => {
    const staleDoc = {
      ref: { id: '2026-09-09-WED-LIVE-0800' },
      data: () => ({
        runId: '2026-09-09-WED-LIVE-0800',
        marketDate: '2026-09-09',
        clockPt: '0800',
        status: 'IN_PROGRESS',
        successJobs: 500,
        permanentFailureJobs: 10,
        trigger: 'SCHEDULER',
      }),
    };
    mockGet.mockResolvedValue({ empty: false, docs: [staleDoc] });

    // Transaction: the run is still IN_PROGRESS, so force-complete it
    mockRunTransaction.mockImplementation(async (fn: any) => {
      const txSnap = {
        exists: true,
        data: () => ({ status: 'IN_PROGRESS' }),
      };
      mockTxGet.mockResolvedValue(txSnap);
      await fn({ get: mockTxGet, update: mockTxUpdate });
    });

    const result = await forceCompleteStaleIntradayRuns('2026-09-09');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ runId: '2026-09-09-WED-LIVE-0800', clockPt: '0800' });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      staleDoc.ref,
      expect.objectContaining({
        status: 'COMPLETE',
        staleRun: true,
      }),
    );
    expect(mockPublishIntradayPdr).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '2026-09-09-WED-LIVE-0800',
        runStatusOverride: 'failed',
      }),
    );
  });

  it('force-completes multiple stale runs on the same market date', async () => {
    const staleDocs = [
      {
        ref: { id: '2026-09-09-WED-LIVE-0800' },
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          marketDate: '2026-09-09',
          clockPt: '0800',
          status: 'IN_PROGRESS',
          successJobs: 500,
          permanentFailureJobs: 10,
          trigger: 'SCHEDULER',
        }),
      },
      {
        ref: { id: '2026-09-09-WED-LIVE-1000' },
        data: () => ({
          runId: '2026-09-09-WED-LIVE-1000',
          marketDate: '2026-09-09',
          clockPt: '1000',
          status: 'IN_PROGRESS',
          successJobs: 600,
          permanentFailureJobs: 5,
          trigger: 'SCHEDULER',
        }),
      },
    ];
    mockGet.mockResolvedValue({ empty: false, docs: staleDocs });

    mockRunTransaction.mockImplementation(async (fn: any) => {
      const txSnap = {
        exists: true,
        data: () => ({ status: 'IN_PROGRESS' }),
      };
      mockTxGet.mockResolvedValue(txSnap);
      await fn({ get: mockTxGet, update: mockTxUpdate });
    });

    const result = await forceCompleteStaleIntradayRuns('2026-09-09');

    expect(result).toHaveLength(2);
    expect(mockPublishIntradayPdr).toHaveBeenCalledTimes(2);
  });

  it('skips runs that are already COMPLETE (transaction guard)', async () => {
    const staleDoc = {
      ref: { id: '2026-09-09-WED-LIVE-0800' },
      data: () => ({
        runId: '2026-09-09-WED-LIVE-0800',
        marketDate: '2026-09-09',
        clockPt: '0800',
        status: 'IN_PROGRESS',
        successJobs: 500,
        permanentFailureJobs: 10,
        trigger: 'SCHEDULER',
      }),
    };
    mockGet.mockResolvedValue({ empty: false, docs: [staleDoc] });

    // Transaction: the run was already completed by a late callback
    mockRunTransaction.mockImplementation(async (fn: any) => {
      const txSnap = {
        exists: true,
        data: () => ({ status: 'COMPLETE' }),
      };
      mockTxGet.mockResolvedValue(txSnap);
      await fn({ get: mockTxGet, update: mockTxUpdate });
    });

    const result = await forceCompleteStaleIntradayRuns('2026-09-09');

    expect(result).toEqual([]);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockPublishIntradayPdr).not.toHaveBeenCalled();
  });
});
