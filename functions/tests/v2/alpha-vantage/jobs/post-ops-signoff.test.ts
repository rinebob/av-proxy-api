// Unit tests for the POST-A last-interval signoff emission site (Task #208).
// Mocks Firestore sibling-doc reads, the send-once guard, and the canonical
// emitter; the composer runs for real so emitted smsText is asserted
// against real output.

// --- Mocks -------------------------------------------------------------

const mockDocGet = jest.fn();
const mockClaimOpsAlert = jest.fn();
const mockEmitOpsAlert = jest.fn();

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: jest.fn((path: string) => ({ path, get: mockDocGet })),
  },
}));

jest.mock('../../../../src/v2/common/ops-alerts/ops-alert.guard', () => ({
  claimOpsAlert: mockClaimOpsAlert,
}));

jest.mock('../../../../src/v2/common/ops-alerts/ops-alert.emitter', () => ({
  emitOpsAlert: mockEmitOpsAlert,
}));

// --- Import after mocks ------------------------------------------------

import { emitPostASignoff } from '../../../../src/v2/alpha-vantage/jobs/post-ops-signoff';

// --- Helpers -----------------------------------------------------------

const MARKET_DATE = '2026-09-09';
const RUN_ID = `${MARKET_DATE}-WED-A-DAILY-LIVE-POST-1335`;

const ARGS = {
  runId: RUN_ID,
  marketDate: MARKET_DATE,
  sequence: 'A',
  runType: 'ts-post-all-intervals-initial',
};

/** Run-doc data for a sibling interval run. */
function intervalDoc(overrides: Record<string, unknown> = {}) {
  return {
    marketDate: MARKET_DATE,
    sequence: 'A',
    runType: 'ts-post-all-intervals-initial',
    phase: 'POST',
    status: 'COMPLETE',
    createdJobs: 10,
    successJobs: 9,
    permanentFailureJobs: 1,
    partnerDataReady: { messageSent: true },
    ...overrides,
  };
}

/**
 * The helper reads the three sibling docs by runId — route get() calls to
 * per-interval fixtures keyed by the interval segment in the path.
 */
function routeSiblingDocs(byInterval: Record<string, Record<string, unknown> | undefined>) {
  mockDocGet.mockImplementation(async function (this: { path: string }) {
    const path = (this as any).path ?? '';
    const interval = /(DAILY|WEEKLY|MONTHLY)/.exec(path)?.[1] ?? 'DAILY';
    const doc = byInterval[interval];
    return { exists: doc !== undefined, data: () => doc };
  });
}

let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #208: emitPostASignoff — POST-A last-interval signoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimOpsAlert.mockResolvedValue('claimed');
    mockEmitOpsAlert.mockResolvedValue(undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('all-intervals gate', () => {
    it('claims and emits once when all 3 interval PDRs are sent', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc({ createdJobs: 10, successJobs: 10, permanentFailureJobs: 0 }),
        WEEKLY: intervalDoc({ createdJobs: 10, successJobs: 9, permanentFailureJobs: 1 }),
        MONTHLY: intervalDoc({ createdJobs: 10, successJobs: 10, permanentFailureJobs: 0 }),
      });

      await emitPostASignoff(ARGS);

      const alertKey = `signoff:post:${MARKET_DATE}:A`;
      expect(mockClaimOpsAlert).toHaveBeenCalledTimes(1);
      expect(mockClaimOpsAlert).toHaveBeenCalledWith({
        alertKey,
        kind: 'signoff',
        runId: RUN_ID,
        marketDate: MARKET_DATE,
        runDocPath: `realtime-runs/${RUN_ID}`,
      });
      expect(mockEmitOpsAlert).toHaveBeenCalledTimes(1);
      expect(mockEmitOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({ alertKey, kind: 'signoff', runId: RUN_ID, marketDate: MARKET_DATE }),
      );
    });

    it('emits nothing when only 1-2 intervals have messageSent', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: intervalDoc({ partnerDataReady: { messageSent: false } }),
        MONTHLY: undefined,
      });

      await emitPostASignoff(ARGS);

      expect(mockClaimOpsAlert).not.toHaveBeenCalled();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('emits nothing when a sibling doc is missing entirely', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: undefined,
        MONTHLY: intervalDoc(),
      });

      await emitPostASignoff(ARGS);

      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });
  });

  describe('sequence/runType gating', () => {
    it.each([
      ['B', 'ts-post-all-intervals-retry'],
      ['C', 'ts-post-all-intervals-retry'],
    ])('emits nothing for sequence %s (%s)', async (sequence, runType) => {
      await emitPostASignoff({ ...ARGS, sequence, runType });

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockClaimOpsAlert).not.toHaveBeenCalled();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('emits nothing when runType is not the initial all-intervals run', async () => {
      await emitPostASignoff({ ...ARGS, runType: 'some-other-run' });

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('emits nothing for a MANUAL A-pass — distinct identity, cannot claim the scheduled key', async () => {
      // A manual re-run builds *-MANUAL-POST-1335 docs; the scheduled
      // signoff key must not be claimed (or suppressed) by it.
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: intervalDoc(),
        MONTHLY: intervalDoc(),
      });

      await emitPostASignoff({
        ...ARGS,
        runId: `${MARKET_DATE}-WED-A-DAILY-MANUAL-POST-1335`,
      });

      expect(mockClaimOpsAlert).not.toHaveBeenCalled();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('emits nothing when the runId identity contradicts the doc fields (spoofed args)', async () => {
      // A B-pass runId whose doc carries corrupted A-sequence fields must
      // not claim the A key — the runId is the authoritative identity.
      await emitPostASignoff({
        ...ARGS,
        runId: `${MARKET_DATE}-WED-B-DAILY-LIVE-POST-1800`,
      });

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('keys the claim on the runId-parsed marketDate, not the doc field', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: intervalDoc(),
        MONTHLY: intervalDoc(),
      });

      await emitPostASignoff({ ...ARGS, marketDate: '1999-12-31' });

      expect(mockClaimOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({ alertKey: `signoff:post:${MARKET_DATE}:A` }),
      );
    });
  });

  describe('send-once outcomes', () => {
    beforeEach(() => {
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: intervalDoc(),
        MONTHLY: intervalDoc(),
      });
    });

    it("does not emit when the key is 'already-claimed' (concurrent completion)", async () => {
      mockClaimOpsAlert.mockResolvedValue('already-claimed');
      await emitPostASignoff(ARGS);
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it("does not emit when the claim returns 'error' (fail-closed)", async () => {
      mockClaimOpsAlert.mockResolvedValue('error');
      await emitPostASignoff(ARGS);
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('claims before it emits (send-once precedes emission)', async () => {
      await emitPostASignoff(ARGS);
      expect(mockClaimOpsAlert.mock.invocationCallOrder[0]).toBeLessThan(
        mockEmitOpsAlert.mock.invocationCallOrder[0],
      );
    });
  });

  describe('fail-safe — never throws into the pipeline', () => {
    beforeEach(() => {
      routeSiblingDocs({
        DAILY: intervalDoc(),
        WEEKLY: intervalDoc(),
        MONTHLY: intervalDoc(),
      });
    });

    it('swallows a claim rejection', async () => {
      mockClaimOpsAlert.mockRejectedValue(new Error('firestore down'));
      await expect(emitPostASignoff(ARGS)).resolves.toBeUndefined();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('swallows an emit rejection', async () => {
      mockEmitOpsAlert.mockRejectedValue(new Error('audit write failed'));
      await expect(emitPostASignoff(ARGS)).resolves.toBeUndefined();
    });

    it('swallows a sibling-read failure', async () => {
      mockDocGet.mockRejectedValue(new Error('firestore down'));
      await expect(emitPostASignoff(ARGS)).resolves.toBeUndefined();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('emits nothing and does not throw on an unparseable runId', async () => {
      await expect(
        emitPostASignoff({ ...ARGS, runId: 'not-a-real-run-id' }),
      ).resolves.toBeUndefined();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });
  });

  describe('composed text content', () => {
    it('carries sequence, market date, per-interval counts, and PDR confirmation', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc({ createdJobs: 10, successJobs: 10, permanentFailureJobs: 0 }),
        WEEKLY: intervalDoc({ createdJobs: 10, successJobs: 9, permanentFailureJobs: 1 }),
        MONTHLY: intervalDoc({ createdJobs: 8, successJobs: 8, permanentFailureJobs: 0 }),
      });

      await emitPostASignoff(ARGS);
      const event = mockEmitOpsAlert.mock.calls[0][0];
      expect(event.smsText).toContain('POST A run finished');
      expect(event.smsText).toContain('2026-09-09');
      expect(event.smsText).toContain('daily 10/10');
      expect(event.smsText).toContain('weekly 9/10');
      expect(event.smsText).toContain('monthly 8/8');
      expect(event.smsText).toContain('All 3 partner data-ready messages sent');
    });

    it('aggregates failed symbols into context, never into smsText', async () => {
      routeSiblingDocs({
        DAILY: intervalDoc({ permanentFailureSymbols: ['TSLA'] }),
        WEEKLY: intervalDoc(),
        MONTHLY: intervalDoc({ permanentFailureSymbols: ['GME'] }),
      });

      await emitPostASignoff(ARGS);
      const event = mockEmitOpsAlert.mock.calls[0][0];
      expect(event.context.failedSymbols).toEqual(expect.arrayContaining(['TSLA', 'GME']));
      expect(event.smsText).not.toContain('TSLA');
      expect(event.smsText).not.toContain('GME');
    });
  });
});
