// Tests for the intraday signoff call site in the run-completion aggregator
// (Task #207). Mocks Firestore, the PDR plumbing (partner enqueue, PubSub,
// GoogleAuth, bar-status), and the signoff helper — asserting the helper is
// invoked only after a successful PDR publish.

// --- Mocks -------------------------------------------------------------

const mockDocSet = jest.fn();
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn();
const mockJobsGet = jest.fn();
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockRunTransaction = jest.fn();

function makeDocRef(path: string) {
  return {
    path,
    set: mockDocSet,
    get: mockDocGet,
    update: mockDocUpdate,
    collection: jest.fn(() => ({ get: mockJobsGet })),
  };
}

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: jest.fn((path: string) => makeDocRef(path)),
    runTransaction: mockRunTransaction,
  },
}));

// Local PDR enqueue — the success/failure lever for publishIntradayPdr.
const mockEnqueueDataReadyInternal = jest.fn();
jest.mock('../../../../src/v2/partner/data-ready.handler', () => ({
  enqueueDataReadyInternal: mockEnqueueDataReadyInternal,
}));

// Cross-project PubSub publish — always succeeds in these tests.
jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn(() => ({
    topic: jest.fn(() => ({
      publishMessage: jest.fn().mockResolvedValue('rs-msg-id'),
    })),
  })),
}));

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn(() => ({
    getClient: jest.fn().mockResolvedValue({ email: 'sa@test' }),
    getCredentials: jest.fn().mockResolvedValue({ client_email: 'sa@test' }),
    getProjectId: jest.fn().mockResolvedValue('av-proj'),
  })),
}));

// Bar-status helpers — deterministic stubs, calendar behavior is not under test.
jest.mock('../../../../src/v2/common/bar-status/bar-status.service', () => ({
  computeRunBarStatus: jest.fn(() => 0),
  prevTradingDay: jest.fn(() => '2026-09-08'),
  isoWeek: jest.fn(() => 37),
  monthOf: jest.fn(() => 9),
}));

// The signoff call site under test.
const mockEmitIntradayTickSignoff = jest.fn();
jest.mock('../../../../src/v2/alpha-vantage/jobs/intraday-ops-signoff', () => ({
  emitIntradayTickSignoff: mockEmitIntradayTickSignoff,
}));

// --- Import after mocks ------------------------------------------------

import { onIntradayRunJobTerminal } from '../../../../src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator';
import { TimeSeriesJobTerminalStatus } from '../../../../src/v2/alpha-vantage/jobs/time-series-jobs.model';

// --- Helpers -----------------------------------------------------------

const RUN_ID = '2026-09-09-WED-LIVE-0800';
const MARKET_DATE = '2026-09-09';

function ts(offsetMs = 0) {
  return { toMillis: () => Date.now() + offsetMs };
}

/** Run doc shaped so the fast path completes: created === finished, recent. */
function fastPathRunDoc(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    clockPt: '0800',
    status: 'IN_PROGRESS',
    createdJobs: 3,
    finishedJobs: 3,
    successJobs: 3,
    permanentFailureJobs: 0,
    jobsCreationStartedAt: ts(-60_000),
    runStartedAt: ts(-120_000),
    trigger: 'scheduler',
    ...overrides,
  };
}

function setupTxWithRunDoc(runDoc: Record<string, unknown>) {
  const snap = { exists: true, data: () => runDoc };
  mockTxGet.mockResolvedValue(snap);
  mockDocGet.mockResolvedValue(snap);
  mockRunTransaction.mockImplementation(async (fn: any) =>
    fn({ get: mockTxGet, update: mockTxUpdate, set: jest.fn() }),
  );
}

function resetMocks() {
  jest.clearAllMocks();
  mockDocSet.mockResolvedValue(undefined);
  mockEnqueueDataReadyInternal.mockResolvedValue(undefined);
  mockEmitIntradayTickSignoff.mockResolvedValue(undefined);
  mockJobsGet.mockResolvedValue({ empty: true, docs: [] });
}

let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #207: aggregator emits intraday signoff after PDR publish', () => {
  beforeEach(() => {
    resetMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits the signoff once after the fast-path PDR publish succeeds', async () => {
    setupTxWithRunDoc(
      fastPathRunDoc({
        successJobs: 2,
        permanentFailureJobs: 1,
        permanentFailureSymbols: ['TSLA'],
      }),
    );

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitIntradayTickSignoff).toHaveBeenCalledTimes(1);
    expect(mockEmitIntradayTickSignoff).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        marketDate: MARKET_DATE,
        clockPt: '0800',
        createdJobs: 3,
        successJobs: 2,
        permanentFailureJobs: 1,
        failedSymbols: ['TSLA'],
        durationMs: expect.any(Number),
      }),
    );
  });

  it('emits after the PDR publish — not before', async () => {
    setupTxWithRunDoc(fastPathRunDoc());

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEnqueueDataReadyInternal.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmitIntradayTickSignoff.mock.invocationCallOrder[0],
    );
  });

  it('emits no signoff when the PDR publish fails', async () => {
    setupTxWithRunDoc(fastPathRunDoc());
    mockEnqueueDataReadyInternal.mockRejectedValue(new Error('pubsub down'));

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitIntradayTickSignoff).not.toHaveBeenCalled();
  });

  it('emits no signoff when the run was already COMPLETE', async () => {
    setupTxWithRunDoc(fastPathRunDoc({ status: 'COMPLETE' }));

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitIntradayTickSignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('emits no signoff while the run is still in flight', async () => {
    // finished < created and within the reconcile window → no completion.
    setupTxWithRunDoc(fastPathRunDoc({ finishedJobs: 2 }));

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitIntradayTickSignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('emits no signoff when a completion race is lost (didComplete=false)', async () => {
    // docGet says still-running, but the completion tx sees COMPLETE —
    // another worker won; this caller must not publish or sign off.
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => fastPathRunDoc(),
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => fastPathRunDoc({ status: 'COMPLETE' }),
    });
    mockRunTransaction.mockImplementation(async (fn: any) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: jest.fn() }),
    );

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitIntradayTickSignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('emits the signoff on the reconcile path with post-reconcile counts', async () => {
    // finished < created but past the reconcile window; re-scan finds all
    // jobs terminal. docGet returns the post-reconcile doc on the second
    // read so reconData-only values must surface in the signoff args.
    const preRecon = fastPathRunDoc({
      finishedJobs: 2,
      permanentFailureJobs: 0,
      jobsCreationStartedAt: ts(-30 * 60_000),
    });
    const postRecon = {
      ...preRecon,
      finishedJobs: 3,
      permanentFailureJobs: 1,
      permanentFailureSymbols: ['TSLA'],
    };
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => preRecon })
      .mockResolvedValue({ exists: true, data: () => postRecon });
    mockTxGet.mockResolvedValue({ exists: true, data: () => preRecon });
    mockRunTransaction.mockImplementation(async (fn: any) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: jest.fn() }),
    );
    mockJobsGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ symbol: 'AAPL', status: 'SUCCESS' }) },
        { data: () => ({ symbol: 'MSFT', status: 'SUCCESS' }) },
        { data: () => ({ symbol: 'TSLA', status: 'PERMANENT_FAILURE' }) },
      ],
    });

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'TSLA',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
    });

    expect(mockEmitIntradayTickSignoff).toHaveBeenCalledTimes(1);
    expect(mockEmitIntradayTickSignoff).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        clockPt: '0800',
        permanentFailureJobs: 1,
        failedSymbols: ['TSLA'],
      }),
    );
  });

  it('emits no signoff when the reconcile-path PDR publish fails', async () => {
    const runDoc = fastPathRunDoc({
      finishedJobs: 2,
      jobsCreationStartedAt: ts(-30 * 60_000),
    });
    setupTxWithRunDoc(runDoc);
    mockEnqueueDataReadyInternal.mockRejectedValue(new Error('pubsub down'));

    await onIntradayRunJobTerminal({
      runId: RUN_ID,
      symbol: 'TSLA',
      marketDate: MARKET_DATE,
      clockPt: '0800',
      status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
    });

    expect(mockEmitIntradayTickSignoff).not.toHaveBeenCalled();
  });
});
