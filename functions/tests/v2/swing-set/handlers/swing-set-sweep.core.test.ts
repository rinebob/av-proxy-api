/**
 * Unit tests for runSwingSetSweep — the shared core behind sweepSwingSets
 * (scheduler) and backfillSwingSets (operator HTTP) — Task #127.
 *
 * Seams: fake Firestore (tracked-symbols where-query + swing docs), mocked
 * generation service. The scheduler/HTTP wrappers are thin.
 */
import type { SwingSetDoc } from '@shared/zigzag';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import { createFakeFirestore } from '../fake-firestore';

const TTL_MS = 20 * 60 * 60 * 1000;

function makeDoc(symbol: string, ageMs: number): SwingSetDoc {
  return {
    symbol,
    paramsId: deriveParamsId(CORPUS_ZIGZAG_CONFIG),
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: [],
    currentExtremeDate: null,
    currentDirection: null,
    generatedAt: { seconds: Math.floor((Date.now() - ageMs) / 1000), nanoseconds: 0 },
    source: 'sa',
  };
}

/** Seed: tracked docs keyed 'tracked-symbols/{SYM}' + swing docs keyed 'options-swing-sets/{SYM}_{paramsId}'. */
function makeFakeDb(opts: {
  tracked?: Record<string, Record<string, unknown>>;
  swingAgeMs?: Record<string, number>;
}) {
  const seed: Record<string, unknown> = {};
  for (const [sym, data] of Object.entries(opts.tracked ?? {})) seed[`tracked-symbols/${sym}`] = data;
  for (const [sym, age] of Object.entries(opts.swingAgeMs ?? {})) {
    const d = makeDoc(sym, age);
    seed[`options-swing-sets/${sym}_${d.paramsId}`] = d;
  }
  return createFakeFirestore(seed);
}

function makeLogs() {
  const logs: { level: string; msg: string }[] = [];
  return {
    logs,
    logger: {
      info: (m: string) => logs.push({ level: 'info', msg: m }),
      warn: (m: string) => logs.push({ level: 'warn', msg: m }),
      error: (m: string) => logs.push({ level: 'error', msg: m }),
    },
  };
}

describe('runSwingSetSweep', () => {
  let runSwingSetSweep: Function;
  let SwingSetRepository: any;

  function makeDeps(fake: any, generateForSymbol?: jest.Mock) {
    const { logger, logs } = makeLogs();
    return {
      deps: {
        repository: new SwingSetRepository(fake),
        generation: { generateForSymbol: generateForSymbol ?? jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false })) },
        logger,
      },
      logs,
    };
  }

  beforeEach(() => {
    const mod = require('../../../../src/v2/swing-set/handlers/swing-set-sweep.core');
    runSwingSetSweep = mod.runSwingSetSweep;
    SwingSetRepository = require('../../../../src/v2/swing-set/services/swing-set.repository').SwingSetRepository;
  });

  it('enumerates only optionsEnabled=true tracked symbols', async () => {
    const fake = makeFakeDb({
      tracked: {
        AAPL: { optionsEnabled: true },
        MSFT: { optionsEnabled: false },
        GOOG: { symbol: 'GOOG' }, // flag absent
        TSLA: { optionsEnabled: true },
      },
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, deps);
    expect(gen.mock.calls.map((c) => c[0]).sort()).toEqual(['AAPL', 'TSLA']);
    expect(result.checked).toBe(2);
    expect(result.generated.sort()).toEqual(['AAPL', 'TSLA']);
  });

  it('skips generation for symbols whose corpus doc is fresh', async () => {
    const fake = makeFakeDb({
      tracked: { AAPL: { optionsEnabled: true }, TSLA: { optionsEnabled: true } },
      swingAgeMs: { AAPL: 60 * 60 * 1000 }, // 1h old → fresh
      // TSLA: no docs → stale
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, deps);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledWith('TSLA');
    expect(result.fresh).toEqual(['AAPL']);
    expect(result.generated).toEqual(['TSLA']);
  });

  it('treats stale docs as needing regeneration', async () => {
    const fake = makeFakeDb({
      tracked: { AAPL: { optionsEnabled: true } },
      swingAgeMs: { AAPL: TTL_MS + 60_000 },
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    await runSwingSetSweep(fake, deps);
    expect(gen).toHaveBeenCalledWith('AAPL');
  });

  it('force regenerates even fresh symbols', async () => {
    const fake = makeFakeDb({
      tracked: { AAPL: { optionsEnabled: true } },
      swingAgeMs: { AAPL: 60 * 1000 },
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, { ...deps, force: true });
    expect(gen).toHaveBeenCalledWith('AAPL');
    expect(result.fresh).toEqual([]);
    expect(result.generated).toEqual(['AAPL']);
  });

  it('logs per-symbol failures without aborting the sweep', async () => {
    const fake = makeFakeDb({
      tracked: { AAPL: { optionsEnabled: true }, TSLA: { optionsEnabled: true }, MSFT: { optionsEnabled: true } },
    });
    const gen = jest.fn(async (s: string) => {
      if (s === 'TSLA') throw new Error('firestore unavailable');
      return { symbol: s, generated: ['a'], skipped: false };
    });
    const { deps, logs } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, deps);
    expect(result.generated.sort()).toEqual(['AAPL', 'MSFT']);
    expect(result.failed).toEqual([{ symbol: 'TSLA', error: 'firestore unavailable' }]);
    expect(logs.some((l) => l.level === 'warn' && /TSLA/.test(l.msg))).toBe(true);
  });

  it('reports no-data skips distinctly', async () => {
    const fake = makeFakeDb({ tracked: { ZZTEST: { optionsEnabled: true } } });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: [], skipped: true }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, deps);
    expect(result.generated).toEqual([]);
    expect(result.skippedNoData).toEqual(['ZZTEST']);
  });

  it('restricts to an explicit symbols subset when provided (still gated on optionsEnabled)', async () => {
    const fake = makeFakeDb({
      tracked: {
        AAPL: { optionsEnabled: true },
        MSFT: { optionsEnabled: false },
        TSLA: { optionsEnabled: true },
      },
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, { ...deps, symbols: ['aapl', 'MSFT', 'UNKNOWN'] });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledWith('AAPL');
    expect(result.excludedNotEnabled?.sort()).toEqual(['MSFT', 'UNKNOWN']);
  });

  it('an explicit empty symbols list sweeps nothing', async () => {
    const fake = makeFakeDb({ tracked: { AAPL: { optionsEnabled: true } } });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: [], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, { ...deps, symbols: [] });
    expect(gen).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it('dryRun reports wouldGenerate without calling generation or writing', async () => {
    const fake = makeFakeDb({
      tracked: { AAPL: { optionsEnabled: true }, TSLA: { optionsEnabled: true } },
      swingAgeMs: { AAPL: 60 * 1000 }, // fresh
    });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: ['a'], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, { ...deps, dryRun: true });
    expect(gen).not.toHaveBeenCalled();
    expect(result.fresh).toEqual(['AAPL']);
    expect(result.wouldGenerate).toEqual(['TSLA']);
    expect(result.generated).toEqual([]);
  });

  it('is a no-op when no symbols are options-enabled', async () => {
    const fake = makeFakeDb({ tracked: { MSFT: { optionsEnabled: false } } });
    const gen = jest.fn(async (s: string) => ({ symbol: s, generated: [], skipped: false }));
    const { deps } = makeDeps(fake, gen);
    const result = await runSwingSetSweep(fake, deps);
    expect(gen).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });
});
