// Unit tests for the ops-alert send-once guard (Task #206).
// Mocks Firestore with an in-memory doc store so claim/second-claim and
// concurrent-claim semantics are exercised for real.

// --- Mocks -------------------------------------------------------------

interface FakeDoc {
  exists: boolean;
  data: Record<string, unknown> | undefined;
}

const store = new Map<string, FakeDoc>();
const txSets: Array<{ path: string; data: Record<string, unknown>; options?: unknown }> = [];

function makeDocRef(path: string) {
  return { path };
}

/** Recursive merge for plain objects — models Firestore merge semantics
 *  (two opsSms.claimed keys on one doc must coexist). */
function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    const b = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)
        ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** tx.get resolves the store; tx.set records the write AND mutates the store
 *  so a retried/concurrent transaction sees claimed state. */
function makeTx() {
  return {
    get: jest.fn(async (ref: { path: string }) => {
      const d = store.get(ref.path);
      return { exists: d?.exists ?? false, data: () => d?.data };
    }),
    set: jest.fn(
      (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        txSets.push({ path: ref.path, data, options });
        const prev = store.get(ref.path);
        const merged =
          options?.merge && prev?.data
            ? deepMerge(prev.data, data)
            : data;
        store.set(ref.path, { exists: true, data: merged });
      },
    ),
  };
}

const mockDbDoc = jest.fn((path: string) => makeDocRef(path));

/** Serialize mock transactions through a queue — models Firestore's
 *  serializable isolation (concurrent txs conflict and retry, so only one
 *  claimant ever wins). */
let txQueue: Promise<void> = Promise.resolve();
const mockRunTransaction = jest.fn((fn: (tx: ReturnType<typeof makeTx>) => unknown) => {
  const run = txQueue.then(() => fn(makeTx()));
  txQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
});

jest.mock('../../../../src/firebase-admin-init', () => ({
  db: {
    doc: mockDbDoc,
    runTransaction: mockRunTransaction,
  },
}));

// --- Import after mocks ------------------------------------------------

import { claimOpsAlert } from '../../../../src/v2/common/ops-alerts/ops-alert.guard';

// --- Helpers -----------------------------------------------------------

const KEY = 'signoff:post-a:2026-10-23';
let logLines: string[] = [];
let logSpy: jest.SpyInstance;

// --- Tests -------------------------------------------------------------

describe('Task #206: claimOpsAlert — send-once guard', () => {
  beforeEach(() => {
    store.clear();
    txSets.length = 0;
    jest.clearAllMocks();
    mockDbDoc.mockImplementation((path: string) => makeDocRef(path));
    logLines = [];
    logSpy = jest.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logLines.push(String(msg));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('first claim succeeds and writes the claim doc', async () => {
    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      marketDate: '2026-10-23',
    });

    expect(result).toBe('claimed');
    const claimWrite = txSets.find((w) => w.path === `ops-alert-claims/${KEY}`);
    expect(claimWrite).toBeDefined();
    expect(claimWrite!.data.alertKey).toBe(KEY);
    expect(claimWrite!.data.claimedAt).toBeDefined();
  });

  it('second claim of the same alertKey returns already-claimed and writes nothing', async () => {
    await claimOpsAlert({ alertKey: KEY, kind: 'signoff' });
    txSets.length = 0;

    const result = await claimOpsAlert({ alertKey: KEY, kind: 'signoff' });

    expect(result).toBe('already-claimed');
    expect(txSets.length).toBe(0);
  });

  it('already-claimed returns before stamping — run doc untouched on redelivery', async () => {
    store.set('realtime-runs/rt-2026-10-23-a-daily', {
      exists: true,
      data: { marketDate: '2026-10-23' },
    });
    await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'realtime-runs/rt-2026-10-23-a-daily',
    });
    txSets.length = 0;

    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'realtime-runs/rt-2026-10-23-a-daily',
    });

    expect(result).toBe('already-claimed');
    expect(txSets.length).toBe(0);
  });

  it('different alertKeys claim independently', async () => {
    expect(await claimOpsAlert({ alertKey: 'signoff:intraday:2026-10-23:0800', kind: 'signoff' })).toBe('claimed');
    expect(await claimOpsAlert({ alertKey: 'signoff:intraday:2026-10-23:1000', kind: 'signoff' })).toBe('claimed');
    expect(await claimOpsAlert({ alertKey: 'signoff:intraday:2026-10-23:0800', kind: 'signoff' })).toBe('already-claimed');
  });

  it('stamps opsSms.claimed[alertKey] on an existing run doc inside the same transaction', async () => {
    store.set('realtime-runs/rt-2026-10-23-a-daily', {
      exists: true,
      data: { marketDate: '2026-10-23', createdJobs: 10 },
    });

    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'realtime-runs/rt-2026-10-23-a-daily',
    });

    expect(result).toBe('claimed');
    const stamp = txSets.find((w) => w.path === 'realtime-runs/rt-2026-10-23-a-daily');
    expect(stamp).toBeDefined();
    expect(stamp!.options).toEqual({ merge: true });
    const opsSms = stamp!.data.opsSms as Record<string, Record<string, unknown>>;
    expect(opsSms.claimed[KEY]).toBeDefined();
    // merge-write preserves the doc's existing fields
    expect(store.get('realtime-runs/rt-2026-10-23-a-daily')!.data!.createdJobs).toBe(10);
  });

  it('two alertKeys stamping one run doc both persist (nested merge)', async () => {
    store.set('realtime-runs/rt-2026-10-23-a-daily', { exists: true, data: { marketDate: '2026-10-23' } });
    const key2 = 'exception:post-a:2026-10-23:pdr_missing';

    await claimOpsAlert({ alertKey: KEY, kind: 'signoff', runDocPath: 'realtime-runs/rt-2026-10-23-a-daily' });
    await claimOpsAlert({ alertKey: key2, kind: 'exception', runDocPath: 'realtime-runs/rt-2026-10-23-a-daily' });

    const claimed = (store.get('realtime-runs/rt-2026-10-23-a-daily')!.data!.opsSms as Record<string, Record<string, unknown>>).claimed;
    expect(claimed[KEY]).toBeDefined();
    expect(claimed[key2]).toBeDefined();
  });

  it('does not fabricate a run doc — no stamp write when the run doc is absent', async () => {
    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'realtime-runs/rt-2026-10-23-missing',
    });

    expect(result).toBe('claimed');
    expect(txSets.every((w) => w.path !== 'realtime-runs/rt-2026-10-23-missing')).toBe(true);
    expect(store.has('realtime-runs/rt-2026-10-23-missing')).toBe(false);
  });

  it('malformed runDocPath cannot veto the claim — warn logged, claim still wins', async () => {
    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'collection-only',
    });

    expect(result).toBe('claimed');
    expect(txSets.every((w) => w.path !== 'collection-only')).toBe(true);
    expect(logLines.some((l) => l.includes('event=ops.alert_stamp_skipped'))).toBe(true);
  });

  it('an SDK-rejected runDocPath (db.doc throws) also cannot veto the claim', async () => {
    mockDbDoc.mockImplementationOnce((path: string) => {
      if (path.includes('reserved')) throw new Error('invalid document path');
      return makeDocRef(path);
    });

    const result = await claimOpsAlert({
      alertKey: KEY,
      kind: 'signoff',
      runDocPath: 'realtime-runs/__reserved__',
    });

    expect(result).toBe('claimed');
    expect(logLines.some((l) => l.includes('event=ops.alert_stamp_skipped'))).toBe(true);
  });

  it('does not stamp a run doc when runDocPath is omitted (exception path — doc may not exist)', async () => {
    await claimOpsAlert({ alertKey: 'exception:intraday:2026-10-23:0800:run_missing', kind: 'exception' });

    expect(txSets.length).toBe(1);
    expect(txSets[0].path).toBe('ops-alert-claims/exception:intraday:2026-10-23:0800:run_missing');
  });

  it('concurrent claims of the same alertKey yield exactly one claimed', async () => {
    const [a, b] = await Promise.all([
      claimOpsAlert({ alertKey: KEY, kind: 'signoff' }),
      claimOpsAlert({ alertKey: KEY, kind: 'signoff' }),
    ]);
    const results = [a, b].sort();
    expect(results).toEqual(['already-claimed', 'claimed']);
  });

  it('rejects an alertKey containing "/" — returns error, no transaction attempted', async () => {
    const result = await claimOpsAlert({ alertKey: 'bad/key', kind: 'signoff' });

    expect(result).toBe('error');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(logLines.some((l) => l.includes('event=ops.alert_claim_failed'))).toBe(true);
  });

  it('rejects an empty alertKey', async () => {
    const result = await claimOpsAlert({ alertKey: '', kind: 'signoff' });
    expect(result).toBe('error');
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('fails closed on transaction error — returns error, logs, does not throw', async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error('tx aborted'));

    const result = await claimOpsAlert({ alertKey: KEY, kind: 'signoff' });

    expect(result).toBe('error');
    const errLine = logLines.find((l) => l.includes('event=ops.alert_claim_failed'));
    expect(errLine).toBeDefined();
    expect(errLine).toContain('tx aborted');
  });
});
