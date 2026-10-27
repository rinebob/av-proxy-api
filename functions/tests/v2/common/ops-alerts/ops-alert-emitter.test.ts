// Unit tests for the canonical ops-alert emitter (Task #204).
// Mocks Firestore; verifies the canonical log line, audit doc, and
// fail-safe behavior (emitter never throws into pipeline callers).

// --- Mocks -------------------------------------------------------------

const mockDocSet = jest.fn();
const mockDbDoc = jest.fn();

function makeDocRef(_path: string) {
  return {
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

import { emitOpsAlert } from '../../../../src/v2/common/ops-alerts/ops-alert.emitter';
import type { OpsAlertEvent } from '../../../../src/v2/common/ops-alerts/ops-alert.types';

// --- Helpers -----------------------------------------------------------

const smsText =
  'Savant POST-A signoff 2026-10-23: all 3 intervals complete — DAILY 412/415 ok, WEEKLY 412/415 ok, MONTHLY 412/415 ok. PDRs sent. 3 failures, see run docs.';

function makeEvent(overrides: Partial<OpsAlertEvent> = {}): OpsAlertEvent {
  return {
    alertKey: 'signoff:post-a:2026-10-23',
    kind: 'signoff',
    smsText,
    runId: 'rt-2026-10-23-A-DAILY',
    marketDate: '2026-10-23',
    context: { sequence: 'A', intervalsDone: 3 },
    ...overrides,
  };
}

function resetMocks() {
  jest.clearAllMocks();
  mockDbDoc.mockImplementation((path: string) => makeDocRef(path));
  mockDocSet.mockResolvedValue(undefined);
}

/** Captured console.log lines from betterLogger. */
let logLines: string[] = [];
let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #204: emitOpsAlert — canonical alert event + fail-safe emitter', () => {
  beforeEach(() => {
    resetMocks();
    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logLines.push(String(msg));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('Canonical log line', () => {
    it('emits an ops.alert log line containing the complete smsText', async () => {
      await emitOpsAlert(makeEvent());

      const alertLine = logLines.find((l) => l.includes('event=ops.alert '));
      expect(alertLine).toBeDefined();
      expect(alertLine).toContain(smsText);
      expect(alertLine).toContain('runId=rt-2026-10-23-A-DAILY');
      expect(alertLine).toContain('mktDate=2026-10-23');
      expect(alertLine).toContain('key=signoff:post-a:2026-10-23');
      expect(alertLine).toContain('ctx={"sequence":"A","intervalsDone":3}');
    });

    it('logs exceptions at error level — greppable apart from routine signoffs', async () => {
      await emitOpsAlert(
        makeEvent({ kind: 'exception', alertKey: 'exception:intraday:2026-10-23:0800:pdr_missing' }),
      );

      const alertLine = logLines.find((l) => l.includes('event=ops.alert '));
      expect(alertLine).toBeDefined();
      expect(alertLine).toContain('level=error');
    });
  });

  describe('Audit doc', () => {
    it('writes an audit doc to ops-alerts/{alertKey} carrying the alert payload', async () => {
      await emitOpsAlert(makeEvent());

      expect(mockDbDoc).toHaveBeenCalledWith('ops-alerts/signoff:post-a:2026-10-23');
      const written = mockDocSet.mock.calls[0][0];
      expect(written.alertKey).toBe('signoff:post-a:2026-10-23');
      expect(written.kind).toBe('signoff');
      expect(written.smsText).toBe(smsText);
      expect(written.runId).toBe('rt-2026-10-23-A-DAILY');
      expect(written.marketDate).toBe('2026-10-23');
      expect(written.context).toEqual({ sequence: 'A', intervalsDone: 3 });
      expect(written.emittedAt).toBeDefined();
    });

    it('uses the deterministic alertKey as doc id — re-emission overwrites, never duplicates', async () => {
      const event = makeEvent();
      await emitOpsAlert(event);
      await emitOpsAlert(event);

      expect(mockDbDoc).toHaveBeenCalledTimes(2);
      expect(mockDbDoc.mock.calls[0][0]).toBe(mockDbDoc.mock.calls[1][0]);
      expect(mockDocSet).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fail-safe behavior', () => {
    it('swallows an audit-write failure: logs error, resolves, never throws', async () => {
      mockDocSet.mockRejectedValue(new Error('firestore unavailable'));

      await expect(emitOpsAlert(makeEvent())).resolves.toBeUndefined();

      const errLine = logLines.find((l) => l.includes('event=ops.alert_emit_failed'));
      expect(errLine).toBeDefined();
      expect(errLine).toContain('firestore unavailable');
      // The canonical alert line still emitted before the failure
      expect(logLines.some((l) => l.includes('event=ops.alert '))).toBe(true);
    });

    it('still emits the canonical log when the alert has no optional fields', async () => {
      await emitOpsAlert({ alertKey: 'exception:test', kind: 'exception', smsText: 'x' });

      const alertLine = logLines.find((l) => l.includes('event=ops.alert '));
      expect(alertLine).toBeDefined();
      expect(alertLine).toContain('message=x');
      expect(alertLine).not.toContain('ctx=');
    });
  });

  describe('Input validation', () => {
    it('rejects an alertKey containing "/" — warns, no audit write, no canonical line', async () => {
      await emitOpsAlert(makeEvent({ alertKey: 'bad/key' }));

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(logLines.some((l) => l.includes('event=ops.alert_emit_failed'))).toBe(true);
      expect(logLines.some((l) => l.includes('event=ops.alert '))).toBe(false);
    });

    it('strips undefined values from context so the audit write cannot silently fail', async () => {
      await emitOpsAlert(makeEvent({ context: { keep: 'yes', drop: undefined } }));

      const written = mockDocSet.mock.calls[0][0];
      expect(written.context).toEqual({ keep: 'yes' });
    });

    it('a null/undefined event resolves without emitting', async () => {
      await expect(emitOpsAlert(null as any)).resolves.toBeUndefined();
      await expect(emitOpsAlert(undefined as any)).resolves.toBeUndefined();

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(logLines.some((l) => l.includes('event=ops.alert_emit_failed'))).toBe(true);
    });

    it('missing smsText or alertKey resolves without emitting', async () => {
      await emitOpsAlert(makeEvent({ smsText: '' }));
      await emitOpsAlert(makeEvent({ alertKey: '' }));

      expect(mockDbDoc).not.toHaveBeenCalled();
      expect(logLines.filter((l) => l.includes('event=ops.alert_emit_failed')).length).toBe(2);
      expect(logLines.some((l) => l.includes('event=ops.alert '))).toBe(false);
    });

    it('an unserializable (circular) context still emits the canonical line with smsText intact', async () => {
      const circular: Record<string, unknown> = { note: 'x' };
      circular.self = circular;

      await emitOpsAlert(makeEvent({ context: circular }));

      const alertLine = logLines.find((l) => l.includes('event=ops.alert '));
      expect(alertLine).toBeDefined();
      expect(alertLine).toContain(smsText);
      expect(alertLine).toContain('ctx=[unserializable context]');
    });

    it('collapses whitespace in the logged smsText so the canonical line stays single-line', async () => {
      await emitOpsAlert(makeEvent({ smsText: 'line one\nline two' }));

      const alertLine = logLines.find((l) => l.includes('event=ops.alert '));
      expect(alertLine).toBeDefined();
      expect(alertLine).toContain('message=line one line two');
      expect(alertLine).not.toContain('\n');
    });
  });
});
