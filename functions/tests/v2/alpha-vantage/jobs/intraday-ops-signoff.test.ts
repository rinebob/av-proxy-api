// Unit tests for the intraday tick signoff emission site (Task #207).
// Mocks the send-once guard and canonical emitter; the composer runs for
// real so the emitted smsText is asserted against real output.

// --- Mocks -------------------------------------------------------------

const mockClaimOpsAlert = jest.fn();
const mockEmitOpsAlert = jest.fn();

jest.mock('../../../../src/v2/common/ops-alerts/ops-alert.guard', () => ({
  claimOpsAlert: mockClaimOpsAlert,
}));

jest.mock('../../../../src/v2/common/ops-alerts/ops-alert.emitter', () => ({
  emitOpsAlert: mockEmitOpsAlert,
}));

// --- Import after mocks ------------------------------------------------

import { emitIntradayTickSignoff } from '../../../../src/v2/alpha-vantage/jobs/intraday-ops-signoff';

// --- Helpers -----------------------------------------------------------

const ARGS = {
  runId: '2026-09-09-WED-LIVE-0800',
  marketDate: '2026-09-09',
  clockPt: '0800',
  createdJobs: 3,
  successJobs: 2,
  permanentFailureJobs: 1,
  durationMs: 75_000,
};

let logLines: string[] = [];
let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #207: emitIntradayTickSignoff — intraday signoff emission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimOpsAlert.mockResolvedValue('claimed');
    mockEmitOpsAlert.mockResolvedValue(undefined);
    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logLines.push(String(msg));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('claim + emit for each scheduled tick', () => {
    it.each(['0800', '1000', '1200'])(
      'claims and emits exactly one signoff for the %s PT tick',
      async (clockPt) => {
        const runId = `2026-09-09-WED-LIVE-${clockPt}`;
        await emitIntradayTickSignoff({ ...ARGS, clockPt, runId });

        const alertKey = `signoff:intraday:2026-09-09:${clockPt}`;
        expect(mockClaimOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockClaimOpsAlert).toHaveBeenCalledWith({
          alertKey,
          kind: 'signoff',
          runId,
          marketDate: '2026-09-09',
          runDocPath: `intraday-runs/${runId}`,
        });
        expect(mockEmitOpsAlert).toHaveBeenCalledTimes(1);
        expect(mockEmitOpsAlert).toHaveBeenCalledWith(
          expect.objectContaining({
            alertKey,
            kind: 'signoff',
            runId,
            marketDate: '2026-09-09',
          }),
        );
      },
    );

    it('claims before it emits (send-once precedes emission)', async () => {
      await emitIntradayTickSignoff(ARGS);
      expect(mockClaimOpsAlert.mock.invocationCallOrder[0]).toBeLessThan(
        mockEmitOpsAlert.mock.invocationCallOrder[0],
      );
    });
  });

  describe('tick gating — non-tick publishes emit nothing', () => {
    it.each(['0400', '0947', '1335', '1800'])(
      'emits nothing for clockPt %s (heartbeat/manual/other)',
      async (clockPt) => {
        await emitIntradayTickSignoff({ ...ARGS, clockPt });
        expect(mockClaimOpsAlert).not.toHaveBeenCalled();
        expect(mockEmitOpsAlert).not.toHaveBeenCalled();
      },
    );
  });

  describe('send-once outcomes', () => {
    it("does not emit when the key is 'already-claimed' (redelivery/concurrency)", async () => {
      mockClaimOpsAlert.mockResolvedValue('already-claimed');
      await emitIntradayTickSignoff(ARGS);
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it("does not emit when the claim returns 'error' (fail-closed)", async () => {
      mockClaimOpsAlert.mockResolvedValue('error');
      await emitIntradayTickSignoff(ARGS);
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });
  });

  describe('fail-safe — never throws into the pipeline', () => {
    it('swallows a claim rejection', async () => {
      mockClaimOpsAlert.mockRejectedValue(new Error('firestore down'));
      await expect(emitIntradayTickSignoff(ARGS)).resolves.toBeUndefined();
      expect(mockEmitOpsAlert).not.toHaveBeenCalled();
    });

    it('swallows an emit rejection', async () => {
      mockEmitOpsAlert.mockRejectedValue(new Error('audit write failed'));
      await expect(emitIntradayTickSignoff(ARGS)).resolves.toBeUndefined();
    });
  });

  describe('composed text content', () => {
    it('carries tick, market date, counts, duration, and PDR confirmation', async () => {
      await emitIntradayTickSignoff(ARGS);
      const event = mockEmitOpsAlert.mock.calls[0][0];
      expect(event.smsText).toContain('intraday 0800 PT run finished');
      expect(event.smsText).toContain('2026-09-09');
      expect(event.smsText).toContain('2 of 3');
      expect(event.smsText).toContain('1m 15s');
      expect(event.smsText).toContain('Partner data-ready message sent.');
    });

    it('reports failure count only — never failed-symbol lists', async () => {
      await emitIntradayTickSignoff(ARGS);
      const event = mockEmitOpsAlert.mock.calls[0][0];
      expect(event.smsText).toContain('1 failed permanently');
      // No symbol tokens in the text — lists live in the run doc + logs.
      // 'PT' is the only all-caps token the prose legitimately contains.
      expect(event.smsText).not.toMatch(/\b(?!PT\b)[A-Z]{1,5}\b/);
    });

    it('logs the failed-symbol list in context alongside the signoff', async () => {
      await emitIntradayTickSignoff({ ...ARGS, failedSymbols: ['TSLA'] });
      const event = mockEmitOpsAlert.mock.calls[0][0];
      // Symbols ride in ctx → ops.alert log line + audit doc …
      expect(event.context.failedSymbols).toEqual(['TSLA']);
      // … but never in the text itself.
      expect(event.smsText).not.toContain('TSLA');
    });
  });
});
