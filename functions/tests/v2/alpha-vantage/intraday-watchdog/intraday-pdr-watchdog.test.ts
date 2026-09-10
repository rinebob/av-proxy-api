// Unit tests for the intraday PDR delivery watchdog.
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

import { checkIntradayPdrDelivery } from '../../../../src/v2/alpha-vantage/intraday-watchdog/intraday-pdr-watchdog';

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
  });

  describe('PDR delivery checks on a normal trading day', () => {
    it('is silent when run doc exists and partnerDataReady.messageSent === true', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
          runId: '2026-09-09-WED-LIVE-0800',
          status: 'COMPLETE',
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
          status: 'COMPLETE',
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
      // Health doc written with pdr_missing alert
      expect(mockDocSet).toHaveBeenCalledTimes(1);
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
      // Health doc written with run_missing alert
      expect(mockDocSet).toHaveBeenCalledTimes(1);
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
});
