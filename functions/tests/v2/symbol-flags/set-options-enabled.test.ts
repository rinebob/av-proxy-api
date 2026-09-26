/**
 * Unit tests for the setOptionsEnabledV2 curation core (Task #140).
 *
 * The core is the guarded toggle: authenticated UID + optionable gate + audit
 * history + swing-set enqueue on false→true. Callable failures map to
 * Firebase HttpsError codes with the stable domain errorCode in details.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { createFakeFirestore } from '../swing-set/fake-firestore';
import {
  handleSetOptionsEnabled,
  SetOptionsEnabledErrorCode,
} from '../../../src/v2/symbol-flags/functions/set-options-enabled.core';
import { toSetOptionsEnabledHttpsError } from '../../../src/v2/symbol-flags/functions/set-options-enabled.errors';

const UID = 'admin-uid-123';
const seed = (flags: Record<string, unknown> = {}) => ({
  'tracked-symbols/AAPL': { symbol: 'AAPL', ...flags },
});

function makeDeps(db: any, overrides: Record<string, unknown> = {}) {
  const enqueue = jest.fn(async () => true);
  const seedCorpus = jest.fn(async () => ({}));
  const logs: { level: string; msg: string }[] = [];
  return {
    db,
    enqueue,
    seedCorpus,
    logger: {
      info: (m: string) => logs.push({ level: 'info', msg: m }),
      warn: (m: string) => logs.push({ level: 'warn', msg: m }),
    },
    logs,
    ...overrides,
  };
}

describe('handleSetOptionsEnabled', () => {
  it('enables an optionable symbol: writes flag, history entry, _lastUpdated, enqueues on false→true', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: false, optionsEnabledHistory: [] }));
    const deps = makeDeps(db);
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, reason: 'curate', uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect(out.transitioned).toBe(true);

    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionsEnabled).toBe(true);
    expect(doc.optionsEnabledHistory).toHaveLength(1);
    expect(doc.optionsEnabledHistory[0]).toMatchObject({ enabled: true, changedBy: UID, reason: 'curate' });
    expect(doc.optionsEnabledHistory[0].changedAt).toBeDefined();
    expect(doc._lastUpdated).toBeDefined();
    expect(deps.enqueue).toHaveBeenCalledWith('AAPL');
  });

  it('rejects enabling a non-optionable symbol', async () => {
    const db = createFakeFirestore(seed({ optionable: false, optionsEnabled: false }));
    const deps = makeDeps(db);
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps);
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe(SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE);
    expect((db.store.get('tracked-symbols/AAPL') as any).optionsEnabled).toBe(false);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('rejects enabling when optionable was never probed (absent)', async () => {
    const db = createFakeFirestore(seed({ optionsEnabled: false }));
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, makeDeps(db));
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe(SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE);
  });

  it('is an idempotent no-op when re-enabling an already-enabled symbol', async () => {
    const history = [{ enabled: true, changedBy: 'prev', changedAt: new Date() }];
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: true, optionsEnabledHistory: history }));
    const deps = makeDeps(db);
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect(out.transitioned).toBe(false);
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionsEnabledHistory).toHaveLength(1); // unchanged
    expect(deps.enqueue).not.toHaveBeenCalled(); // only on false→true
  });

  it('disables an enabled symbol without enqueueing', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: true, optionsEnabledHistory: [] }));
    const deps = makeDeps(db);
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: false, uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect(out.transitioned).toBe(true);
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionsEnabled).toBe(false);
    expect(doc.optionsEnabledHistory).toHaveLength(1);
    expect(doc.optionsEnabledHistory[0].enabled).toBe(false);
    expect(deps.enqueue).not.toHaveBeenCalled(); // true→false does not enqueue
  });

  it('returns not-found for an untracked symbol', async () => {
    const db = createFakeFirestore();
    const out = await handleSetOptionsEnabled({ symbol: 'NOPE', enabled: true, uid: UID }, makeDeps(db));
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe(SetOptionsEnabledErrorCode.SYMBOL_NOT_FOUND);
  });

  it('warns-but-succeeds when the enqueue fails', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: false }));
    const deps = makeDeps(db);
    deps.enqueue.mockRejectedValue(new Error('queue down'));
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect((db.store.get('tracked-symbols/AAPL') as any).optionsEnabled).toBe(true);
    expect(deps.logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('false→true fires the corpus seed fanout (Task #153)', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: false }));
    const deps = makeDeps(db);
    deps.seedCorpus.mockResolvedValue({ runId: 'r', enqueued: 5 });
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect(deps.seedCorpus).toHaveBeenCalledWith('AAPL');
  });

  it('warns-but-succeeds when the corpus seed fanout fails', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: false }));
    const deps = makeDeps(db);
    deps.seedCorpus.mockRejectedValue(new Error('planner blew up'));
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps);
    expect(out.ok).toBe(true);
    expect((db.store.get('tracked-symbols/AAPL') as any).optionsEnabled).toBe(true);
    expect(deps.logs.some((l) => l.level === 'warn' && /corpus seed fanout/.test(l.msg))).toBe(true);
  });

  it('does not fire the seed fanout on same-value no-op or true→false', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: true }));
    const deps = makeDeps(db);
    await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: true, uid: UID }, deps); // no-op
    await handleSetOptionsEnabled({ symbol: 'AAPL', enabled: false, uid: UID }, deps); // disable
    expect(deps.seedCorpus).not.toHaveBeenCalled();
  });

  it('normalizes the symbol (trim + uppercase)', async () => {
    const db = createFakeFirestore(seed({ optionable: true, optionsEnabled: false }));
    const deps = makeDeps(db);
    await handleSetOptionsEnabled({ symbol: ' aapl ', enabled: true, uid: UID }, deps);
    expect(deps.enqueue).toHaveBeenCalledWith('AAPL');
  });

  it('rejects malformed symbol paths before accessing Firestore', async () => {
    const db = createFakeFirestore();
    const out = await handleSetOptionsEnabled({ symbol: 'AAPL/OTHER', enabled: true, uid: UID }, makeDeps(db));
    expect(out.errorCode).toBe(SetOptionsEnabledErrorCode.INVALID_ARGUMENT);
    expect(db.calls).toHaveLength(0);
  });
});

describe('Firestore fake transform contract', () => {
  it('rejects serverTimestamp nested inside an arrayUnion element', async () => {
    const db = createFakeFirestore(seed({ optionsEnabledHistory: [] }));
    await expect(
      db.collection('tracked-symbols').doc('AAPL').set({
        optionsEnabledHistory: FieldValue.arrayUnion({ changedAt: FieldValue.serverTimestamp() }),
      }, { merge: true }),
    ).rejects.toThrow('serverTimestamp() cannot be used inside an arrayUnion element');
  });
});

describe('toSetOptionsEnabledHttpsError', () => {
  it('maps the optionable gate to failed-precondition with the domain error code', () => {
    const error = toSetOptionsEnabledHttpsError({
      ok: false,
      symbol: 'AAPL',
      transitioned: false,
      errorCode: SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE,
      error: 'Symbol AAPL is not optionable.',
    });
    expect(error.code).toBe('failed-precondition');
    expect(error.details).toMatchObject({ errorCode: SetOptionsEnabledErrorCode.OPTIONS_NOT_OPTIONABLE, symbol: 'AAPL' });
  });

  it('maps missing symbols to not-found', () => {
    const error = toSetOptionsEnabledHttpsError({
      ok: false,
      symbol: 'NOPE',
      transitioned: false,
      errorCode: SetOptionsEnabledErrorCode.SYMBOL_NOT_FOUND,
      error: 'Symbol NOPE is not tracked.',
    });
    expect(error.code).toBe('not-found');
  });
});
