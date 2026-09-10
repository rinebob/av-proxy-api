// Integration tests for the intraday scheduler + self-healing path.
// Mocks Firestore and Cloud Tasks; verifies the decision (create vs. skip)
// and side effects (run doc state, PDR publication, stale run force-completion).

// --- Mocks -------------------------------------------------------------

// Firestore db mock
const mockDocSet = jest.fn();
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn();
const mockCollectionGet = jest.fn();
const mockCollectionWhere = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn();
const mockRunTransaction = jest.fn();

// Doc reference factory
function makeDocRef(_path: string) {
  return {
    set: mockDocSet,
    get: mockDocGet,
    update: mockDocUpdate,
    collection: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    })),
  };
}

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    collection: jest.fn((name: string) => ({
      where: mockCollectionWhere,
      get: mockCollectionGet,
    })),
    doc: jest.fn((path: string) => makeDocRef(path)),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
    runTransaction: mockRunTransaction,
  },
}));

// Cloud Tasks mock
const mockEnqueue = jest.fn();
const mockTaskQueue = jest.fn(() => ({ enqueue: mockEnqueue }));
jest.mock('firebase-admin/functions', () => ({
  getFunctions: jest.fn(() => ({ taskQueue: mockTaskQueue })),
}));

// PDR publish mock
const mockPublishIntradayPdr = jest.fn();
jest.mock('../../../../src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator', () => ({
  publishIntradayPdr: mockPublishIntradayPdr,
}));

// --- Import after mocks ------------------------------------------------

import { runIntradaySnapshotJobsForSymbols } from '../../../../src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager';

// --- Helpers -----------------------------------------------------------

function setupTrackedSymbols(symbols: string[]) {
  mockCollectionGet.mockResolvedValue({
    empty: symbols.length === 0,
    docs: symbols.map((s) => ({ id: s })),
  });
}

function setupNoStaleRuns() {
  mockCollectionWhere.mockReturnValue({
    where: mockCollectionWhere,
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  });
}

function setupStaleRun(runId: string, clockPt: string) {
  const staleDoc = {
    ref: { id: runId },
    data: () => ({
      runId,
      marketDate: '2026-09-09',
      clockPt,
      status: 'IN_PROGRESS',
      successJobs: 500,
      permanentFailureJobs: 10,
      trigger: 'SCHEDULER',
    }),
  };
  mockCollectionWhere.mockReturnValue({
    where: mockCollectionWhere,
    get: jest.fn().mockResolvedValue({ empty: false, docs: [staleDoc] }),
  });
  // Transaction: run is still IN_PROGRESS, so force-complete it
  mockRunTransaction.mockImplementation(async (fn: any) => {
    const txSnap = { exists: true, data: () => ({ status: 'IN_PROGRESS' }) };
    await fn({ get: jest.fn().mockResolvedValue(txSnap), update: mockDocUpdate });
  });
}

function resetMocks() {
  jest.clearAllMocks();
  mockDocSet.mockResolvedValue(undefined);
  mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
  mockBatchCommit.mockResolvedValue(undefined);
  mockEnqueue.mockResolvedValue(undefined);
  mockPublishIntradayPdr.mockResolvedValue(undefined);
}

// --- Tests -------------------------------------------------------------

describe('Task #75: Intraday scheduler + self-healing integration', () => {
  beforeEach(() => {
    resetMocks();
    setupNoStaleRuns();
  });

  describe('Calendar gate: skip decisions', () => {
    it('skips job creation on a holiday (Labor Day 2026-09-07)', async () => {
      setupTrackedSymbols(['AAPL']);
      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-07',
        clockPt: '0800',
      });

      // No run doc, no jobs, no tasks
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('skips job creation on a weekend (Saturday 2026-01-03)', async () => {
      setupTrackedSymbols(['AAPL']);
      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-01-03',
        clockPt: '0800',
      });

      expect(mockDocSet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('skips job creation on a weekend (Sunday 2026-01-04)', async () => {
      setupTrackedSymbols(['AAPL']);
      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-01-04',
        clockPt: '0800',
      });

      expect(mockDocSet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('skips job creation on post-early-close tick (2026-11-27 at 1200 PT)', async () => {
      setupTrackedSymbols(['AAPL']);
      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-11-27',
        clockPt: '1200',
      });

      expect(mockDocSet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('does not write a run doc when skipping', async () => {
      setupTrackedSymbols(['AAPL']);
      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-07', // Labor Day
        clockPt: '0800',
      });

      // Verify no doc().set() was called for the run doc
      expect(mockDocSet).not.toHaveBeenCalled();
    });
  });

  describe('Calendar gate: create decisions', () => {
    it('creates jobs on a normal trading day at 0800 PT', async () => {
      const symbols = ['AAPL', 'MSFT'];
      setupTrackedSymbols(symbols);

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      // Run doc was written
      expect(mockDocSet).toHaveBeenCalled();
      // Jobs were created (batch.commit called once per symbol)
      expect(mockBatchCommit).toHaveBeenCalledTimes(symbols.length);
      // Tasks were enqueued (one per symbol)
      expect(mockEnqueue).toHaveBeenCalledTimes(symbols.length);
    });

    it('creates jobs on a normal trading day at 1000 PT', async () => {
      const symbols = ['AAPL'];
      setupTrackedSymbols(symbols);

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      expect(mockDocSet).toHaveBeenCalled();
      expect(mockBatchCommit).toHaveBeenCalledTimes(symbols.length);
      expect(mockEnqueue).toHaveBeenCalledTimes(symbols.length);
    });

    it('creates jobs on a normal trading day at 1200 PT', async () => {
      const symbols = ['AAPL'];
      setupTrackedSymbols(symbols);

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1200',
      });

      expect(mockDocSet).toHaveBeenCalled();
      expect(mockBatchCommit).toHaveBeenCalledTimes(symbols.length);
      expect(mockEnqueue).toHaveBeenCalledTimes(symbols.length);
    });
  });

  describe('Self-healing: stale run force-completion', () => {
    it('force-completes a stale IN_PROGRESS run before creating new jobs', async () => {
      const symbols = ['AAPL'];
      setupTrackedSymbols(symbols);
      setupStaleRun('2026-09-09-WED-LIVE-0800', '0800');

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      // Transaction was called (force-completion)
      expect(mockRunTransaction).toHaveBeenCalled();
      // The stale run was updated with staleRun: true
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'COMPLETE',
          staleRun: true,
        }),
      );
      // PDR was published with runStatus: FAILED
      expect(mockPublishIntradayPdr).toHaveBeenCalledWith(
        expect.objectContaining({
          runStatusOverride: 'failed',
        }),
      );
      // New jobs were still created (scheduler proceeds after self-healing)
      expect(mockBatchCommit).toHaveBeenCalledTimes(symbols.length);
      expect(mockEnqueue).toHaveBeenCalledTimes(symbols.length);
    });

    it('force-completed run gets staleRun: true flag', async () => {
      setupTrackedSymbols(['AAPL']);
      setupStaleRun('2026-09-09-WED-LIVE-0800', '0800');

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          staleRun: true,
          status: 'COMPLETE',
        }),
      );
    });

    it('force-completed run publishes PDR with runStatus: FAILED', async () => {
      setupTrackedSymbols(['AAPL']);
      setupStaleRun('2026-09-09-WED-LIVE-0800', '0800');

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      expect(mockPublishIntradayPdr).toHaveBeenCalledWith(
        expect.objectContaining({
          runStatusOverride: 'failed',
          runId: '2026-09-09-WED-LIVE-0800',
        }),
      );
    });

    it('does not force-complete when no stale run exists', async () => {
      setupTrackedSymbols(['AAPL']);
      setupNoStaleRuns();

      await runIntradaySnapshotJobsForSymbols({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      // No transaction, no PDR, no update
      expect(mockRunTransaction).not.toHaveBeenCalled();
      expect(mockPublishIntradayPdr).not.toHaveBeenCalled();
      expect(mockDocUpdate).not.toHaveBeenCalled();
      // Jobs were still created
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });
});
