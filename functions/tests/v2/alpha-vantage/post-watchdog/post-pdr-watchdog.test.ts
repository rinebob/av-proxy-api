// Unit tests for the POST PDR delivery watchdog.
// Mocks Firestore; verifies alert logic and health doc writes.

// --- Mocks -------------------------------------------------------------

const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
const mockDbDoc = jest.fn();
const mockCollectionGet = jest.fn();

function makeDocRef(_path: string) {
  return {
    get: mockDocGet,
    set: mockDocSet,
  };
}

mockDbDoc.mockImplementation((path: string) => makeDocRef(path));

const queryChain = {
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: mockCollectionGet,
};
const mockDbCollection = jest.fn(() => queryChain);

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: mockDbDoc,
    collection: mockDbCollection,
  },
}));

// --- Import after mocks ------------------------------------------------

import {
  checkPostPdrDelivery,
  checkPostCPdrDelivery,
} from '../../../../src/v2/alpha-vantage/post-watchdog/post-pdr-watchdog';

// --- Helpers -----------------------------------------------------------

function resetMocks() {
  jest.clearAllMocks();
  mockDbDoc.mockImplementation((path: string) => makeDocRef(path));
  mockDocSet.mockResolvedValue(undefined);
}

/** Returns the path of the Nth db.doc() call. */
function docPath(callIndex: number): string {
  return mockDbDoc.mock.calls[callIndex][0] as string;
}

/** Returns the data passed to the Nth set() call. */
function setData(callIndex: number): any {
  return mockDocSet.mock.calls[callIndex][0];
}

/** Makes a run doc snapshot with the given exists/messageSent values. */
function runSnap(exists: boolean, messageSent?: boolean, extra: Record<string, unknown> = {}) {
  return {
    exists,
    data: () => exists
      ? { partnerDataReady: { messageSent: messageSent ?? false }, ...extra }
      : undefined,
  };
}

/** Query snapshot for the C-run retry-target lookup. */
function targetSnap(marketDate: string | null | string[]) {
  const dates = marketDate === null ? [] : Array.isArray(marketDate) ? marketDate : [marketDate];
  return {
    empty: dates.length === 0,
    docs: dates.map((d) => ({ data: () => ({ marketDate: d }) })),
  };
}

/** Error-level log lines matching the post-watchdog prefix. */
function errorLogs(logSpy: jest.SpyInstance, event: string): string[] {
  return logSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.includes('level=error') && s.includes(event));
}

// --- Tests -------------------------------------------------------------

describe('POST PDR delivery watchdog', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('PDR delivery checks on a normal trading day', () => {
    it('is silent when all 3 interval run docs exist and PDR sent', async () => {
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))   // DAILY
        .mockResolvedValueOnce(runSnap(true, true))   // WEEKLY
        .mockResolvedValueOnce(runSnap(true, true));  // MONTHLY

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      // Health doc written with OK status
      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const data = setData(0);
      expect(data.tickStatus).toBe('ok');
      expect(data.alertState).toBe('none');
      expect(data.intervalStatuses.daily).toBe('ok');
      expect(data.intervalStatuses.weekly).toBe('ok');
      expect(data.intervalStatuses.monthly).toBe('ok');
    });

    it('logs ERROR when one interval has PDR not sent', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))    // DAILY - ok
        .mockResolvedValueOnce(runSnap(true, false))    // WEEKLY - pdr_missing
        .mockResolvedValueOnce(runSnap(true, true));   // MONTHLY - ok

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('post.watchdog.pdr_missing'));
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);

      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const data = setData(0);
      expect(data.tickStatus).toBe('pdr_missing');
      expect(data.alertState).toBe('pdr_missing');
      expect(data.intervalStatuses.daily).toBe('ok');
      expect(data.intervalStatuses.weekly).toBe('pdr_missing');
      expect(data.intervalStatuses.monthly).toBe('ok');

      logSpy.mockRestore();
    });

    it('logs ERROR when one interval run doc does not exist', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))    // DAILY - ok
        .mockResolvedValueOnce(runSnap(false))         // WEEKLY - run_missing
        .mockResolvedValueOnce(runSnap(true, true));   // MONTHLY - ok

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('post.watchdog.run_missing'));
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);

      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const data = setData(0);
      expect(data.tickStatus).toBe('run_missing');
      expect(data.alertState).toBe('run_missing');
      expect(data.intervalStatuses.daily).toBe('ok');
      expect(data.intervalStatuses.weekly).toBe('run_missing');
      expect(data.intervalStatuses.monthly).toBe('ok');

      logSpy.mockRestore();
    });

    it('logs ERROR for all 3 intervals when all run docs missing', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(false))  // DAILY
        .mockResolvedValueOnce(runSnap(false))  // WEEKLY
        .mockResolvedValueOnce(runSnap(false)); // MONTHLY

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      const errorLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('level=error') && s.includes('post.watchdog.run_missing'));
      expect(errorLogs.length).toBeGreaterThanOrEqual(3);

      const data = setData(0);
      expect(data.tickStatus).toBe('run_missing');
      expect(data.intervalStatuses.daily).toBe('run_missing');
      expect(data.intervalStatuses.weekly).toBe('run_missing');
      expect(data.intervalStatuses.monthly).toBe('run_missing');

      logSpy.mockRestore();
    });
  });

  describe('Health doc structure', () => {
    it('writes health doc to realtime-health/{marketDate}', async () => {
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      // First 3 db.doc calls are run docs, 4th is the health doc
      expect(docPath(0)).toBe('realtime-runs/2026-09-11-FRI-A-DAILY-LIVE-POST-1335');
      expect(docPath(1)).toBe('realtime-runs/2026-09-11-FRI-A-WEEKLY-LIVE-POST-1335');
      expect(docPath(2)).toBe('realtime-runs/2026-09-11-FRI-A-MONTHLY-LIVE-POST-1335');
      expect(docPath(3)).toBe('realtime-health/2026-09-11');
    });

    it('health doc contains marketDate, sequence, clockPt, intervalStatuses, tickStatus, alertState, checkedAt', async () => {
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      const data = setData(0);
      expect(data).toHaveProperty('marketDate', '2026-09-11');
      expect(data).toHaveProperty('sequence', 'A');
      expect(data).toHaveProperty('clockPt', '1335');
      expect(data).toHaveProperty('intervalStatuses');
      expect(data).toHaveProperty('tickStatus');
      expect(data).toHaveProperty('alertState');
      expect(data).toHaveProperty('checkedAt');
    });
  });

  describe('Calendar gate (Task #209)', () => {
    it('skips silently on a weekend — no run reads, no health doc, no alerts', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await checkPostPdrDelivery({ marketDate: '2026-09-12' }); // Saturday

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      const skipLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('post.watchdog.skip') && s.includes('weekend'));
      expect(skipLogs.length).toBe(1);
      logSpy.mockRestore();
    });

    it('skips silently on a holiday weekday — no false run_missing', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await checkPostPdrDelivery({ marketDate: '2026-11-26' }); // Thanksgiving (Thursday, closed)

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      const skipLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('post.watchdog.skip') && s.includes('holiday'));
      expect(skipLogs.length).toBe(1);
      logSpy.mockRestore();
    });

    it('fails open when the calendar throws (year outside holiday table) — check proceeds with a warn', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      // 2099 has no holiday data — getPostSkipReason throws; the check
      // must still run rather than crash the scheduled function.
      await checkPostPdrDelivery({ marketDate: '2099-01-05' }); // Monday

      expect(mockDbDoc).toHaveBeenCalled();
      const warnLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes('post.watchdog.calendar_error'));
      expect(warnLogs.length).toBe(1);
      const data = setData(0);
      expect(data.tickStatus).toBe('ok');
      logSpy.mockRestore();
    });
  });

  describe('B/C sequence checks (Task #209)', () => {
    it('B check uses sequence-B runIds with clockPt 1800 and writes {marketDate}-B health doc', async () => {
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11', sequence: 'B', clockPt: '1800' });

      expect(docPath(0)).toBe('realtime-runs/2026-09-11-FRI-B-DAILY-LIVE-POST-1800');
      expect(docPath(1)).toBe('realtime-runs/2026-09-11-FRI-B-WEEKLY-LIVE-POST-1800');
      expect(docPath(2)).toBe('realtime-runs/2026-09-11-FRI-B-MONTHLY-LIVE-POST-1800');
      expect(docPath(3)).toBe('realtime-health/2026-09-11-B');
      const data = setData(0);
      expect(data.sequence).toBe('B');
      expect(data.clockPt).toBe('1800');
    });

    it('A health doc stays at {marketDate} (unchanged id)', async () => {
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      expect(docPath(3)).toBe('realtime-health/2026-09-11');
    });

    it('zero-job COMPLETE interval is no_jobs (healthy) on a B pass', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))                                    // DAILY retried + sent
        .mockResolvedValueOnce(runSnap(true, false, { status: 'COMPLETE', createdJobs: 0 })) // WEEKLY empty retry
        .mockResolvedValueOnce(runSnap(true, true));                                   // MONTHLY sent

      await checkPostPdrDelivery({ marketDate: '2026-09-11', sequence: 'B', clockPt: '1800' });

      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      const data = setData(0);
      expect(data.tickStatus).toBe('ok');
      expect(data.alertState).toBe('none');
      expect(data.intervalStatuses.daily).toBe('ok');
      expect(data.intervalStatuses.weekly).toBe('no_jobs');
      expect(data.intervalStatuses.monthly).toBe('ok');
      logSpy.mockRestore();
    });

    it('zero-job COMPLETE on the A pass still flags pdr_missing (anomaly preserved)', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, false, { status: 'COMPLETE', createdJobs: 0 }))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11' });

      expect(errorLogs(logSpy, 'post.watchdog.pdr_missing')).toHaveLength(1);
      const data = setData(0);
      expect(data.intervalStatuses.weekly).toBe('pdr_missing');
      logSpy.mockRestore();
    });

    it('B interval with real jobs and no PDR still alerts pdr_missing', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, false, { status: 'COMPLETE', createdJobs: 5 }))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostPdrDelivery({ marketDate: '2026-09-11', sequence: 'B', clockPt: '1800' });

      expect(errorLogs(logSpy, 'post.watchdog.pdr_missing')).toHaveLength(1);
      const data = setData(0);
      expect(data.intervalStatuses.daily).toBe('pdr_missing');
      expect(data.tickStatus).toBe('pdr_missing');
      logSpy.mockRestore();
    });
  });

  describe('C pass targeting (Task #209)', () => {
    it('checks C docs (clockPt 0400) for the latest retry-run market date', async () => {
      mockCollectionGet.mockResolvedValueOnce(targetSnap('2026-09-10')); // Thursday
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostCPdrDelivery({ todayEt: '2026-09-11' }); // Friday, trading day

      // The retry-target lookup must hit realtime-runs with the same
      // filter/order the 04:00 orchestrator uses.
      expect(mockDbCollection).toHaveBeenCalledWith('realtime-runs');
      expect(queryChain.where).toHaveBeenCalledWith('interval', '==', 'daily');
      expect(queryChain.where).toHaveBeenCalledWith('runType', '==', 'ts-post-all-intervals-retry');
      expect(queryChain.orderBy).toHaveBeenCalledWith('marketDate', 'desc');

      expect(docPath(0)).toBe('realtime-runs/2026-09-10-THU-C-DAILY-LIVE-POST-0400');
      expect(docPath(1)).toBe('realtime-runs/2026-09-10-THU-C-WEEKLY-LIVE-POST-0400');
      expect(docPath(2)).toBe('realtime-runs/2026-09-10-THU-C-MONTHLY-LIVE-POST-0400');
      expect(docPath(3)).toBe('realtime-health/2026-09-10-C');
      const data = setData(0);
      expect(data.sequence).toBe('C');
      expect(data.clockPt).toBe('0400');
      expect(data.tickStatus).toBe('ok');
    });

    it('skips when no retry runs exist — the C pass was not expected', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockCollectionGet.mockResolvedValueOnce(targetSnap(null));

      await checkPostCPdrDelivery({ todayEt: '2026-09-11' });

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      logSpy.mockRestore();
    });

    it('target resolution walks past a market-closed retry doc to the next trading day', async () => {
      mockCollectionGet.mockResolvedValueOnce(
        targetSnap(['2026-11-26', '2026-11-25']), // Thanksgiving (closed), then Wednesday
      );
      mockDocGet
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true))
        .mockResolvedValueOnce(runSnap(true, true));

      await checkPostCPdrDelivery({ todayEt: '2026-11-27' }); // trading day (early close)

      // The closed date is filtered out — the check runs against the
      // next valid trading-day target instead of skipping.
      expect(docPath(0)).toBe('realtime-runs/2026-11-25-WED-C-DAILY-LIVE-POST-0400');
      const data = setData(0);
      expect(data.tickStatus).toBe('ok');
    });

    it('target resolution ignores future-dated retry docs', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockCollectionGet.mockResolvedValueOnce(targetSnap('2099-01-05'));

      await checkPostCPdrDelivery({ todayEt: '2026-09-11' });

      // Future-dated docs can't hijack the C pass — resolves null → skip.
      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      logSpy.mockRestore();
    });

    it('skips on a market-closed today — the C orchestrator defers, so no run was expected', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Holiday Monday: orchestrator defers to Tuesday; the watchdog must
      // skip BEFORE resolving the retry target — a stale retry doc must
      // not surface as run_missing for a deliberately deferred pass.
      await checkPostCPdrDelivery({ todayEt: '2026-11-26' });

      expect(mockDbCollection).not.toHaveBeenCalled();
      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(mockDocSet).not.toHaveBeenCalled();
      expect(errorLogs(logSpy, 'post.watchdog.')).toHaveLength(0);
      logSpy.mockRestore();
    });
  });
});
