// Unit tests for the POST PDR delivery watchdog.
// Mocks Firestore; verifies alert logic and health doc writes.

// --- Mocks -------------------------------------------------------------

const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
const mockDbDoc = jest.fn();

function makeDocRef(_path: string) {
  return {
    get: mockDocGet,
    set: mockDocSet,
  };
}

mockDbDoc.mockImplementation((path: string) => makeDocRef(path));

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: mockDbDoc,
  },
}));

// --- Import after mocks ------------------------------------------------

import { checkPostPdrDelivery } from '../../../../src/v2/alpha-vantage/post-watchdog/post-pdr-watchdog';

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
function runSnap(exists: boolean, messageSent?: boolean) {
  return {
    exists,
    data: () => exists
      ? { partnerDataReady: { messageSent: messageSent ?? false } }
      : undefined,
  };
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
});
