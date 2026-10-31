// Unit tests for the intraday PDR delivery watchdog.
// Mocks Firestore; verifies alert logic and health doc writes.

// --- Mocks -------------------------------------------------------------

const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
const mockDbDoc = jest.fn();
const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockRunTransaction = jest.fn();

function makeDocRef(path: string) {
  return {
    path,
    get: mockDocGet,
    set: mockDocSet,
  };
}

mockDbDoc.mockImplementation((path: string) => makeDocRef(path));

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: mockDbDoc,
    runTransaction: mockRunTransaction,
  },
}));

// --- Import after mocks ------------------------------------------------

import { checkIntradayPdrDelivery } from '../../../../src/v2/alpha-vantage/intraday-watchdog/intraday-pdr-watchdog';
import { TimeSeriesRunStatus } from '../../../../src/v2/alpha-vantage/jobs/time-series-jobs.model';

// --- Helpers -----------------------------------------------------------

function resetMocks() {
  jest.clearAllMocks();
  mockDbDoc.mockImplementation((path: string) => makeDocRef(path));
  mockDocSet.mockResolvedValue(undefined);
  // Send-once guard: claims always win by default (claim doc absent, run
  // doc present); flip mockTxGet in tests that need 'already-claimed'.
  mockTxGet.mockImplementation(async (ref: { path: string }) =>
    ref.path.startsWith('ops-alert-claims/')
      ? { exists: false, data: () => undefined }
      : { exists: true, data: () => ({}) },
  );
  mockTxSet.mockImplementation(() => undefined);
  mockRunTransaction.mockImplementation(
    async (fn: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => unknown) =>
      fn({ get: mockTxGet, set: mockTxSet }),
  );
}

/** Returns the path of the Nth db.doc() call. */
function docPath(callIndex: number): string {
  return mockDbDoc.mock.calls[callIndex][0] as string;
}

/** Returns the data passed to the Nth set() call. */
function setData(callIndex: number): any {
  return mockDocSet.mock.calls[callIndex][0];
}

// --- Tests -------------------------------------------------------------

describe('Task #74/#76: Intraday PDR delivery watchdog', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('Calendar gate', () => {
    it('skips silently on a holiday (Labor Day 2026-09-07)', async () => {
      await checkIntradayPdrDelivery({
        marketDate: '2026-09-07',
        clockPt: '0800',
      });

      // No run doc query, no health doc
      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('skips silently on a weekend (Saturday 2026-01-03)', async () => {
      await checkIntradayPdrDelivery({
        marketDate: '2026-01-03',
        clockPt: '0800',
      });

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('skips silently on post-early-close tick (2026-11-27 at 1200 PT)', async () => {
      await checkIntradayPdrDelivery({
        marketDate: '2026-11-27',
        clockPt: '1200',
      });

      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('fails open when the calendar throws (year outside holiday table) — check proceeds with a warn', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2099-01-05-MON-LIVE-0800',
          status: TimeSeriesRunStatus.COMPLETE,
          createdJobs: 5,
          partnerDataReady: { messageSent: true },
        }),
      });

      // 2099 has no holiday data — getIntradaySkipReason throws; the
      // check must still run rather than crash the scheduled function.
      await checkIntradayPdrDelivery({ marketDate: '2099-01-05', clockPt: '0800' });

      expect(mockDbDoc).toHaveBeenCalled();
      const warnLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('intraday.watchdog.calendar_error'));
      expect(warnLogs.length).toBe(1);
      expect(setData(0).tickStatus).toBe('ok');
      logSpy.mockRestore();
    });

    it('skips a weekend in an uncovered year without logging a calendar error', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // 2099-01-03 is a Saturday. isTradingDay short-circuits weekends
      // before the holiday-table lookup, so no exception is thrown and
      // the fail-open catch never fires — the skip is silent.
      await checkIntradayPdrDelivery({ marketDate: '2099-01-03', clockPt: '0800' });

      const warnLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('intraday.watchdog.calendar_error'));
      expect(warnLogs.length).toBe(0);
      expect(mockDocGet).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  describe('PDR delivery checks on a normal trading day', () => {
    it('is silent when run doc exists and partnerDataReady.messageSent === true', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          status: TimeSeriesRunStatus.COMPLETE,
          partnerDataReady: {
            messageSent: true,
          },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      // Health doc written with OK status
      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const data = setData(0);
      expect(data.tickStatus).toBe('ok');
      expect(data.pdrState).toBe('sent');
      expect(data.alertState).toBe('none');
    });

    it('logs ERROR when run doc exists but partnerDataReady.messageSent !== true', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-1000',
          status: TimeSeriesRunStatus.COMPLETE,
          partnerDataReady: {
            messageSent: false,
          },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      // ERROR-level log emitted (betterLogger uses console.log with level=error)
      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('intraday.watchdog.pdr_missing'));
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);
      // Health doc + the exception audit doc (Task #210)
      expect(mockDocSet).toHaveBeenCalledTimes(2);
      const data = setData(0);
      expect(data.tickStatus).toBe('pdr_missing');
      expect(data.pdrState).toBe('not_sent');
      expect(data.alertState).toBe('pdr_missing');

      logSpy.mockRestore();
    });

    it('logs ERROR when run doc does not exist (scheduler did not fire)', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '1200',
      });

      // ERROR-level log emitted (betterLogger uses console.log with level=error)
      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('intraday.watchdog.run_missing'));
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);
      // Health doc + the exception audit doc (Task #210)
      expect(mockDocSet).toHaveBeenCalledTimes(2);
      const data = setData(0);
      expect(data.tickStatus).toBe('run_missing');
      expect(data.pdrState).toBe('n/a');
      expect(data.alertState).toBe('run_missing');

      logSpy.mockRestore();
    });
  });

  describe('Health doc structure', () => {
    it('writes health doc to intraday-health/{marketDate}-{clockPt}', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          partnerDataReady: { messageSent: true },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      // First db.doc call is the run doc, second is the health doc
      expect(docPath(0)).toBe('intraday-runs/2026-09-09-WED-LIVE-0800');
      expect(docPath(1)).toBe('intraday-health/2026-09-09-0800');
    });

    it('health doc contains tick status, PDR state, and alert state', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          partnerDataReady: { messageSent: true },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      const data = setData(0);
      expect(data).toHaveProperty('marketDate', '2026-09-09');
      expect(data).toHaveProperty('clockPt', '0800');
      expect(data).toHaveProperty('runId', '2026-09-09-WED-LIVE-0800');
      expect(data).toHaveProperty('tickStatus');
      expect(data).toHaveProperty('pdrState');
      expect(data).toHaveProperty('alertState');
      expect(data).toHaveProperty('checkedAt');
    });
  });

  describe('Exception alert events (Task #210)', () => {
    /** db.doc() paths written under ops-alerts/ — one per emitted event. */
    function alertDocPaths(): string[] {
      return mockDbDoc.mock.calls
        .map((c) => c[0] as string)
        .filter((p) => p.startsWith('ops-alerts/'));
    }

    /** Audit payloads written by the emitter (identified by smsText). */
    function auditDocs(): any[] {
      return mockDocSet.mock.calls
        .map((c) => c[0])
        .filter((d: any) => d && typeof d === 'object' && 'smsText' in d);
    }

    /** Writes recorded inside the send-once transaction. */
    function txSetPaths(): string[] {
      return mockTxSet.mock.calls.map((c) => (c[0] as { path: string }).path);
    }

    it('emits one exception event when the run doc is missing — no run doc fabricated or stamped', async () => {
      mockDocGet.mockResolvedValue({ exists: false, data: () => undefined });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      expect(alertDocPaths()).toEqual([
        'ops-alerts/exception:intraday:2026-09-09:0800:run_missing',
      ]);
      const audit = auditDocs()[0];
      expect(audit.kind).toBe('exception');
      expect(audit.smsText).toContain('intraday 0800 PT');
      expect(audit.smsText).toContain('never ran');
      // The claim exists, but no run doc was stamped — none exists.
      expect(txSetPaths()).toContain(
        'ops-alert-claims/exception:intraday:2026-09-09:0800:run_missing',
      );
      expect(txSetPaths().filter((p) => p.startsWith('intraday-runs/'))).toEqual([]);
    });

    it('emits pdr_missing exception and stamps the existing run doc', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-1000',
          status: TimeSeriesRunStatus.COMPLETE,
          createdJobs: 5,
          partnerDataReady: { messageSent: false },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '1000',
      });

      expect(alertDocPaths()).toEqual([
        'ops-alerts/exception:intraday:2026-09-09:1000:pdr_missing',
      ]);
      const audit = auditDocs()[0];
      expect(audit.smsText).toContain('intraday 1000 PT');
      expect(audit.smsText).toContain('data-ready message was never sent');
      expect(audit.smsText).toContain('2026-09-09-WED-LIVE-1000');
      expect(txSetPaths()).toContain('intraday-runs/2026-09-09-WED-LIVE-1000');
    });

    it('emits orchestrator_no_start when the run doc has zero created jobs', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          status: TimeSeriesRunStatus.IN_PROGRESS,
          createdJobs: 0,
          partnerDataReady: { messageSent: false },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      expect(alertDocPaths()).toEqual([
        'ops-alerts/exception:intraday:2026-09-09:0800:orchestrator_no_start',
      ]);
      const audit = auditDocs()[0];
      expect(audit.smsText).toContain('never started');
      expect(audit.smsText).toContain('no jobs were created');
    });

    it('emits nothing when the tick is healthy', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          status: TimeSeriesRunStatus.COMPLETE,
          createdJobs: 5,
          partnerDataReady: { messageSent: true },
        }),
      });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '0800',
      });

      expect(alertDocPaths()).toEqual([]);
      expect(auditDocs()).toEqual([]);
    });

    it('suppresses the event when the send-once claim was already taken — health doc + ERROR log still write', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockTxGet.mockImplementation(async () => ({ exists: true, data: () => ({}) }));
      mockDocGet.mockResolvedValue({ exists: false, data: () => undefined });

      await checkIntradayPdrDelivery({
        marketDate: '2026-09-09',
        clockPt: '1200',
      });

      expect(alertDocPaths()).toEqual([]);
      expect(auditDocs()).toEqual([]);
      // Diagnostics unaffected — health doc + ERROR log still written.
      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('intraday.watchdog.run_missing'));
      expect(errorLogs.length).toBe(1);
      expect(setData(0).tickStatus).toBe('run_missing');
      logSpy.mockRestore();
    });
  });
});
