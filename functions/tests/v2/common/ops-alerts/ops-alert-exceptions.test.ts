// Unit tests for the watchdog→canonical-alert seam (Task #210):
// emitWatchdogException + exceptionConditionForRunDoc.
// In-memory doc store exercises claim/emit/stamp for real.

// --- Mocks -------------------------------------------------------------

interface FakeDoc {
  exists: boolean;
  data: Record<string, unknown> | undefined;
}

const store = new Map<string, FakeDoc>();
const txSets: Array<{ path: string; data: Record<string, unknown> }> = [];
const docSets: Array<{ path: string; data: Record<string, unknown> }> = [];

function makeTx() {
  return {
    get: jest.fn(async (ref: { path: string }) => {
      const d = store.get(ref.path);
      return { exists: d?.exists ?? false, data: () => d?.data };
    }),
    set: jest.fn((ref: { path: string }, data: Record<string, unknown>) => {
      txSets.push({ path: ref.path, data });
      store.set(ref.path, { exists: true, data });
    }),
  };
}

const mockDbDoc = jest.fn((path: string) => ({
  path,
  set: jest.fn(async (data: Record<string, unknown>) => {
    docSets.push({ path, data });
    store.set(path, { exists: true, data });
  }),
}));

const mockRunTransaction = jest.fn((fn: (tx: ReturnType<typeof makeTx>) => unknown) =>
  fn(makeTx()),
);

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: mockDbDoc,
    runTransaction: mockRunTransaction,
  },
}));

// --- Import after mocks ------------------------------------------------

import {
  emitWatchdogException,
  exceptionConditionForRunDoc,
} from '../../../../src/v2/common/ops-alerts/ops-alert.exceptions';
import { opsAlertKey } from '../../../../src/v2/common/ops-alerts/ops-alert.types';

const MARKET_DATE = '2026-09-11';
const KEY = opsAlertKey.exceptionPost(MARKET_DATE, 'A', 'weekly', 'pdr_missing');
const RUN_PATH = 'realtime-runs/2026-09-11-FRI-A-WEEKLY-LIVE-POST-1335';

const input = {
  alertKey: KEY,
  condition: 'pdr_missing' as const,
  marketDate: MARKET_DATE,
  sequence: 'A',
  interval: 'WEEKLY',
  clockPt: '1335',
  runId: '2026-09-11-FRI-A-WEEKLY-LIVE-POST-1335',
};

function auditWrites() {
  return docSets.filter((s) => s.path.startsWith('ops-alerts/'));
}

describe('exceptionConditionForRunDoc', () => {
  it('maps zero jobs to orchestrator_no_start', () => {
    expect(exceptionConditionForRunDoc(0)).toBe('orchestrator_no_start');
  });
  it('maps positive jobs to pdr_missing', () => {
    expect(exceptionConditionForRunDoc(5)).toBe('pdr_missing');
  });
  it('maps a missing field to orchestrator_no_start (malformed doc — no jobs observed)', () => {
    expect(exceptionConditionForRunDoc(undefined)).toBe('orchestrator_no_start');
  });
});

describe('emitWatchdogException', () => {
  beforeEach(() => {
    store.clear();
    txSets.length = 0;
    docSets.length = 0;
    jest.clearAllMocks();
    mockDbDoc.mockImplementation((path: string) => ({
      path,
      set: jest.fn(async (data: Record<string, unknown>) => {
        docSets.push({ path, data });
        store.set(path, { exists: true, data });
      }),
    }));
    mockRunTransaction.mockImplementation((fn) => fn(makeTx()));
  });

  it('claims and emits — audit doc carries kind, composed text, and condition context', async () => {
    store.set(RUN_PATH, { exists: true, data: { runId: input.runId } });

    await emitWatchdogException({ ...input, runDocPath: RUN_PATH });

    const audits = auditWrites();
    expect(audits).toHaveLength(1);
    expect(audits[0].path).toBe(`ops-alerts/${KEY}`);
    expect(audits[0].data.kind).toBe('exception');
    expect(String(audits[0].data.smsText)).toContain('POST A WEEKLY');
    expect(String(audits[0].data.smsText)).toContain('data-ready message was never sent');
    expect(audits[0].data.context).toMatchObject({ condition: 'pdr_missing' });
    // Claim doc + run-doc stamp landed inside the transaction.
    expect(txSets.map((s) => s.path)).toContain(`ops-alert-claims/${KEY}`);
    expect(txSets.map((s) => s.path)).toContain(RUN_PATH);
  });

  it('does not emit when the claim was already taken — and does not throw', async () => {
    store.set(`ops-alert-claims/${KEY}`, { exists: true, data: { alertKey: KEY } });

    await expect(emitWatchdogException(input)).resolves.toBeUndefined();
    expect(auditWrites()).toHaveLength(0);
  });

  it('does not emit when the claim transaction fails — fail-closed, no throw', async () => {
    mockRunTransaction.mockImplementationOnce(() => Promise.reject(new Error('tx down')));

    await expect(emitWatchdogException(input)).resolves.toBeUndefined();
    expect(auditWrites()).toHaveLength(0);
  });

  it('pins context.condition — caller context cannot clobber the classified condition', async () => {
    await emitWatchdogException({
      ...input,
      context: { condition: 'run_missing', clockPt: '1335' },
    });

    expect(auditWrites()[0].data.context).toMatchObject({
      condition: 'pdr_missing',
      clockPt: '1335',
    });
  });

  it('never throws even when the audit write itself rejects', async () => {
    mockDbDoc.mockImplementation((path: string) => ({
      path,
      set: jest.fn(async (data: Record<string, unknown>) => {
        void data;
        throw new Error('firestore down');
      }),
    }));

    await expect(emitWatchdogException(input)).resolves.toBeUndefined();
  });
});
