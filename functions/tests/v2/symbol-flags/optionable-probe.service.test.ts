/**
 * Unit tests for OptionableProbeService (Task #138).
 *
 * The service is the single seam for "does this symbol have options" —
 * probe() is pure (retrieval only), probeAndPersist() also writes the flag
 * fields to the tracked-symbols doc. Quota/rate-limit errors propagate so
 * callers (backfill script, on-add trigger) can abort without stamping a
 * false flag on ambiguous failures.
 */
import { createFakeFirestore } from '../swing-set/fake-firestore';
import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../../../src/v2/alpha-vantage/utils/av-upstream-error.utils';
import { OptionableProbeService } from '../../../src/v2/symbol-flags/services/optionable-probe.service';

function makeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalContracts: 10,
      totalVolume: 100,
      totalOpenInterest: 200,
      uniqueStrikes: 5,
      ...overrides,
    },
    expirations: [{ expiration: '2026-10-16' }, { expiration: '2026-11-20' }],
  };
}

function makeRetrieval(overrides: {
  data?: unknown[];
  analysis?: any;
  throws?: unknown;
} = {}) {
  return {
    fetch: jest.fn(async (_p: { symbol: string }) => {
      if (overrides.throws) throw overrides.throws;
      return {
        response: { data: overrides.data ?? [{ contractID: 'X' }] },
        analysis: overrides.analysis ?? makeAnalysis(),
      };
    }),
  };
}

const seedDoc = (flags: Record<string, unknown> = {}) => ({
  'tracked-symbols/AAPL': { symbol: 'AAPL', ...flags },
});

describe('OptionableProbeService.probe', () => {
  it('returns optionable=true with finite-only summary incl. expirations count', async () => {
    const db = createFakeFirestore();
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    const result = await svc.probe('aapl');
    expect(result.optionable).toBe(true);
    expect(result.summary).toEqual({
      totalContracts: 10,
      totalVolume: 100,
      totalOpenInterest: 200,
      uniqueStrikes: 5,
      expirations: 2,
    });
  });

  it('returns optionable=false on an empty chain', async () => {
    const svc = new OptionableProbeService({ retrieval: makeRetrieval({ data: [] }) as any, db: createFakeFirestore() });
    const result = await svc.probe('FUND');
    expect(result.optionable).toBe(false);
  });

  it('omits non-finite summary values', async () => {
    const svc = new OptionableProbeService({
      retrieval: makeRetrieval({ analysis: makeAnalysis({ totalVolume: NaN }) }) as any,
      db: createFakeFirestore(),
    });
    const result = await svc.probe('AAPL');
    expect(result.summary?.totalVolume).toBeUndefined();
    expect(result.summary?.totalContracts).toBe(10);
  });

  it('uppercases + trims the symbol before fetching', async () => {
    const retrieval = makeRetrieval();
    const svc = new OptionableProbeService({ retrieval: retrieval as any, db: createFakeFirestore() });
    await svc.probe('  aapl ');
    expect(retrieval.fetch).toHaveBeenCalledWith({ symbol: 'AAPL' });
  });
});

describe('OptionableProbeService.probeAndPersist', () => {
  it('writes optionable + checkedAt + probeSummary to the tracked doc', async () => {
    const db = createFakeFirestore(seedDoc());
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    await svc.probeAndPersist('AAPL');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionable).toBe(true);
    expect(doc.optionableCheckedAt).toBeDefined();
    expect(doc.optionableProbeSummary?.totalContracts).toBe(10);
    expect(doc.optionableProbeError).toBeUndefined();
  });

  it('patches optionsEnabled/history defaults only when absent', async () => {
    const db = createFakeFirestore(seedDoc());
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    await svc.probeAndPersist('AAPL');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionsEnabled).toBe(false);
    expect(doc.optionsEnabledHistory).toEqual([]);
  });

  it('never clobbers an existing optionsEnabled=true', async () => {
    const db = createFakeFirestore(seedDoc({ optionsEnabled: true, optionsEnabledHistory: [{ enabled: true }] }));
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    await svc.probeAndPersist('AAPL');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionsEnabled).toBe(true);
    expect(doc.optionsEnabledHistory).toEqual([{ enabled: true }]);
  });

  it('does not create a doc for an untracked symbol', async () => {
    const db = createFakeFirestore();
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    const result = await svc.probeAndPersist('NOPE');
    expect(result.optionable).toBe(true);
    expect(db.store.has('tracked-symbols/NOPE')).toBe(false);
  });

  it('writes optionable=false + optionableProbeError on a non-quota failure', async () => {
    const db = createFakeFirestore(seedDoc());
    const svc = new OptionableProbeService({
      retrieval: makeRetrieval({ throws: new Error('boom') }) as any,
      db,
    });
    const result = await svc.probeAndPersist('AAPL');
    expect(result.optionable).toBe(false);
    expect(result.error).toBe('boom');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionable).toBe(false);
    expect(doc.optionableProbeError).toBe('boom');
    expect(doc.optionableProbeSummary).toBeUndefined();
  });

  it('rethrows RATE_LIMITED errors without writing', async () => {
    const db = createFakeFirestore(seedDoc());
    const svc = new OptionableProbeService({
      retrieval: makeRetrieval({ throws: new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED) }) as any,
      db,
    });
    await expect(svc.probeAndPersist('AAPL')).rejects.toBeInstanceOf(AlphaVantageUpstreamError);
    expect((db.store.get('tracked-symbols/AAPL') as any).optionable).toBeUndefined();
  });

  it('clears a stale optionableProbeError when a later probe succeeds', async () => {
    const db = createFakeFirestore(seedDoc({ optionable: false, optionableProbeError: 'old failure' }));
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    await svc.probeAndPersist('AAPL');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionable).toBe(true);
    expect(doc.optionableProbeError).toBeUndefined();
    expect(doc.optionableProbeSummary?.totalContracts).toBe(10);
  });

  it('clears a stale optionableProbeSummary when a later probe fails', async () => {
    const db = createFakeFirestore(seedDoc({ optionable: true, optionableProbeSummary: { totalContracts: 99 } }));
    const svc = new OptionableProbeService({
      retrieval: makeRetrieval({ throws: new Error('gone') }) as any,
      db,
    });
    await svc.probeAndPersist('AAPL');
    const doc = db.store.get('tracked-symbols/AAPL') as any;
    expect(doc.optionable).toBe(false);
    expect(doc.optionableProbeError).toBe('gone');
    expect(doc.optionableProbeSummary).toBeUndefined();
  });

  it('propagates persist failures without stamping optionable=false', async () => {
    const db = createFakeFirestore(seedDoc());
    // Force the persist() write to fail after probe succeeds.
    (db as any).collection = (path: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: true, data: () => db.store.get(`${path}/${id}`), id }),
        set: async () => { throw new Error('firestore down'); },
        delete: async () => {},
      }),
      where: () => ({ get: async () => ({ docs: [], empty: true, size: 0 }) }),
      get: async () => ({ docs: [], empty: true, size: 0 }),
    });
    const svc = new OptionableProbeService({ retrieval: makeRetrieval() as any, db });
    await expect(svc.probeAndPersist('AAPL')).rejects.toThrow('firestore down');
    // The doc must not be stamped optionable=false — db errors are not probe failures.
    expect((db.store.get('tracked-symbols/AAPL') as any).optionable).toBeUndefined();
  });

  it('rethrows quota-worded Information/UPSTREAM_ERROR without writing', async () => {
    const db = createFakeFirestore(seedDoc());
    const svc = new OptionableProbeService({
      retrieval: makeRetrieval({
        throws: new AlphaVantageUpstreamError(
          AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR,
          undefined,
          'This is a premium endpoint',
        ),
      }) as any,
      db,
    });
    await expect(svc.probeAndPersist('AAPL')).rejects.toBeInstanceOf(AlphaVantageUpstreamError);
    expect((db.store.get('tracked-symbols/AAPL') as any).optionable).toBeUndefined();
  });
});
