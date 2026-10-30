// Tests for the POST-A signoff call site in the realtime run-completion
// aggregator (Task #208). Mocks Firestore, the PDR enqueue, and the
// signoff helper — asserting the helper is invoked only after the
// partnerDataReady.messageSent write succeeds.

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

// Local PDR enqueue — the success/failure lever for the publish.
const mockEnqueueDataReadyInternal = jest.fn();
jest.mock('../../../../src/v2/partner/data-ready.handler', () => ({
  enqueueDataReadyInternal: mockEnqueueDataReadyInternal,
}));

// The signoff call site under test.
const mockEmitPostASignoff = jest.fn();
jest.mock('../../../../src/v2/alpha-vantage/jobs/post-ops-signoff', () => ({
  emitPostASignoff: mockEmitPostASignoff,
}));

// --- Import after mocks ------------------------------------------------

import { onRealtimeRunJobTerminal } from '../../../../src/v2/alpha-vantage/jobs/realtime-run-aggregator';
import { TimeSeriesJobTerminalStatus } from '../../../../src/v2/alpha-vantage/jobs/time-series-jobs.model';

// --- Helpers -----------------------------------------------------------

const MARKET_DATE = '2026-09-09';
const RUN_ID = `${MARKET_DATE}-WED-A-DAILY-LIVE-POST-1335`;

function ts(offsetMs = 0) {
  return { toMillis: () => Date.now() + offsetMs };
}

/** Run doc shaped so the fast path completes: created === finished. */
function fastPathRunDoc(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    interval: 'DAILY',
    runType: 'ts-post-all-intervals-initial',
    sequence: 'A',
    phase: 'POST',
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
  mockDocUpdate.mockResolvedValue(undefined);
  mockEnqueueDataReadyInternal.mockResolvedValue(undefined);
  mockEmitPostASignoff.mockResolvedValue(undefined);
  mockJobsGet.mockResolvedValue({ empty: true, size: 0, docs: [] });
}

let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #208: aggregator invokes POST-A signoff after messageSent write', () => {
  beforeEach(() => {
    resetMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('invokes the signoff once after the fast-path PDR + messageSent write', async () => {
    setupTxWithRunDoc(fastPathRunDoc());

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).toHaveBeenCalledTimes(1);
    expect(mockEmitPostASignoff).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        marketDate: MARKET_DATE,
        sequence: 'A',
        runType: 'ts-post-all-intervals-initial',
      }),
    );
  });

  it('invokes the signoff after the messageSent write — not before', async () => {
    setupTxWithRunDoc(fastPathRunDoc());

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    const messageSentWrite = mockDocUpdate.mock.calls.findIndex(
      (c) => c[0]?.partnerDataReady?.messageSent === true,
    );
    expect(messageSentWrite).toBeGreaterThanOrEqual(0);
    expect(mockDocUpdate.mock.invocationCallOrder[messageSentWrite]).toBeLessThan(
      mockEmitPostASignoff.mock.invocationCallOrder[0],
    );
  });

  it('passes B/C sequence docs through — the helper gates emission', async () => {
    setupTxWithRunDoc(
      fastPathRunDoc({ sequence: 'B', runType: 'ts-post-all-intervals-retry' }),
    );

    await onRealtimeRunJobTerminal({
      runId: `${MARKET_DATE}-WED-B-DAILY-LIVE-POST-1800`,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    // Call site is unconditional; the helper gates B/C to a no-op.
    expect(mockEmitPostASignoff).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 'B', runType: 'ts-post-all-intervals-retry' }),
    );
  });

  it('invokes no signoff when the PDR publish fails', async () => {
    setupTxWithRunDoc(fastPathRunDoc());
    mockEnqueueDataReadyInternal.mockRejectedValue(new Error('pubsub down'));

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
  });

  it('invokes no signoff when the messageSent write fails', async () => {
    setupTxWithRunDoc(fastPathRunDoc());
    mockDocUpdate.mockRejectedValue(new Error('firestore down'));

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
  });

  it('invokes no signoff when the run was already COMPLETE', async () => {
    setupTxWithRunDoc(fastPathRunDoc({ status: 'COMPLETE' }));

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('invokes no signoff while the run is still in flight', async () => {
    setupTxWithRunDoc(fastPathRunDoc({ finishedJobs: 2 }));

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('invokes no signoff when a completion race is lost (didComplete=false)', async () => {
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

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'MSFT',
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
    expect(mockEnqueueDataReadyInternal).not.toHaveBeenCalled();
  });

  it('invokes the signoff on the reconcile path with post-reconcile data', async () => {
    // finished < created and past the reconcile window → reconcile,
    // force-complete, publish, then signoff with reconciled fields.
    const preRecon = fastPathRunDoc({
      finishedJobs: 2,
      jobsCreationStartedAt: ts(-70 * 60_000),
    });
    const postRecon = { ...preRecon, finishedJobs: 3 };
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => preRecon })
      .mockResolvedValue({ exists: true, data: () => postRecon });
    mockTxGet.mockResolvedValue({ exists: true, data: () => preRecon });
    mockRunTransaction.mockImplementation(async (fn: any) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: jest.fn() }),
    );
    mockJobsGet.mockResolvedValue({
      empty: false,
      size: 3,
      docs: [
        { data: () => ({ symbol: 'AAPL', status: 'SUCCESS' }) },
        { data: () => ({ symbol: 'MSFT', status: 'SUCCESS' }) },
        { data: () => ({ symbol: 'TSLA', status: 'PERMANENT_FAILURE' }) },
      ],
    });

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'TSLA',
      status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
    });

    expect(mockEmitPostASignoff).toHaveBeenCalledTimes(1);
    expect(mockEmitPostASignoff).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        marketDate: MARKET_DATE,
        sequence: 'A',
        runType: 'ts-post-all-intervals-initial',
      }),
    );
    // The reconcile re-scan must record the permanent-failure symbol set on
    // the run doc — the signoff reads it from sibling docs for context.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ permanentFailureSymbols: expect.anything() }),
      expect.anything(),
    );
    // … and the signoff follows the reconcile path's messageSent write.
    const messageSentWrite = mockDocUpdate.mock.calls.findIndex(
      (c) => c[0]?.partnerDataReady?.messageSent === true,
    );
    expect(messageSentWrite).toBeGreaterThanOrEqual(0);
    expect(mockDocUpdate.mock.invocationCallOrder[messageSentWrite]).toBeLessThan(
      mockEmitPostASignoff.mock.invocationCallOrder[0],
    );
  });

  it('invokes no signoff when the reconcile-path PDR publish fails', async () => {
    const runDoc = fastPathRunDoc({
      finishedJobs: 2,
      jobsCreationStartedAt: ts(-70 * 60_000),
    });
    setupTxWithRunDoc(runDoc);
    mockEnqueueDataReadyInternal.mockRejectedValue(new Error('pubsub down'));

    await onRealtimeRunJobTerminal({
      runId: RUN_ID,
      symbol: 'TSLA',
      status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
    });

    expect(mockEmitPostASignoff).not.toHaveBeenCalled();
  });
});
