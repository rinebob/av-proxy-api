/**
 * Unit tests for generateSwingSetsTask internals (Task #126).
 *
 * The onTaskDispatched wrapper (generate-swing-sets.task.ts) is thin; the
 * testable seam is generate-swing-sets.core.ts — side-effect-free, so no
 * firebase-admin init happens in jest.
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

/** Seed the fake store: swing docs + optional tracked-symbol flags. */
function makeFakeDb(swingDocs: SwingSetDoc[], trackedFlags: Record<string, unknown> = {}) {
  const seed: Record<string, unknown> = {};
  for (const d of swingDocs) seed[`options-swing-sets/${d.symbol}_${d.paramsId}`] = d;
  for (const [sym, flags] of Object.entries(trackedFlags)) seed[`tracked-symbols/${sym}`] = flags;
  return createFakeFirestore(seed);
}

function corpusDoc(symbol: string, ageMs: number): SwingSetDoc {
  return makeDoc(symbol, ageMs);
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

describe('handleGenerateSwingSets', () => {
  let handleGenerateSwingSets: Function;
  let SwingSetRepository: any;

  beforeEach(() => {
    const mod = require('../../../../src/v2/swing-set/handlers/generate-swing-sets.core');
    handleGenerateSwingSets = mod.handleGenerateSwingSets;
    SwingSetRepository = require('../../../../src/v2/swing-set/services/swing-set.repository').SwingSetRepository;
  });

  it('calls generateForSymbol for a valid payload', async () => {
    const fake = makeFakeDb([]);
    const generateForSymbol = jest.fn(async () => ({ symbol: 'AAPL', generated: ['x'], skipped: false }));
    const { logger } = makeLogs();
    await handleGenerateSwingSets({ symbol: 'aapl' }, {
      repository: new SwingSetRepository(fake),
      generation: { generateForSymbol },
      logger,
    });
    expect(generateForSymbol).toHaveBeenCalledWith('AAPL');
  });

  it.each([{}, { symbol: '' }, { symbol: '   ' }, { symbol: 42 }])(
    'rejects invalid payload %j without throwing (no Cloud Tasks retry)',
    async (payload) => {
      const fake = makeFakeDb([]);
      const generateForSymbol = jest.fn();
      const { logger, logs } = makeLogs();
      await handleGenerateSwingSets(payload, {
        repository: new SwingSetRepository(fake),
        generation: { generateForSymbol },
        logger,
      });
      expect(generateForSymbol).not.toHaveBeenCalled();
      expect(logs.some((l) => l.level === 'warn')).toBe(true);
    },
  );

  it('skips generation when the corpus doc is fresh', async () => {
    const fake = makeFakeDb([corpusDoc('AAPL', 60 * 60 * 1000)]); // 1h old
    const generateForSymbol = jest.fn();
    const { logger, logs } = makeLogs();
    await handleGenerateSwingSets({ symbol: 'AAPL' }, {
      repository: new SwingSetRepository(fake),
      generation: { generateForSymbol },
      logger,
    });
    expect(generateForSymbol).not.toHaveBeenCalled();
    expect(logs.some((l) => l.level === 'info' && /fresh|skip/i.test(l.msg))).toBe(true);
  });

  it('regenerates when the doc is stale', async () => {
    const fake = makeFakeDb([corpusDoc('AAPL', TTL_MS + 60_000)]); // older than TTL
    const generateForSymbol = jest.fn(async () => ({ symbol: 'AAPL', generated: [], skipped: false }));
    const { logger } = makeLogs();
    await handleGenerateSwingSets({ symbol: 'AAPL' }, {
      repository: new SwingSetRepository(fake),
      generation: { generateForSymbol },
      logger,
    });
    expect(generateForSymbol).toHaveBeenCalledWith('AAPL');
  });

  it('treats future-dated generatedAt (clock skew) as stale', async () => {
    const fake = makeFakeDb([corpusDoc('AAPL', -30 * 60 * 1000)]); // 30min in the future
    const generateForSymbol = jest.fn(async () => ({ symbol: 'AAPL', generated: [], skipped: false }));
    const { logger } = makeLogs();
    await handleGenerateSwingSets({ symbol: 'AAPL' }, {
      repository: new SwingSetRepository(fake),
      generation: { generateForSymbol },
      logger,
    });
    expect(generateForSymbol).toHaveBeenCalledWith('AAPL');
  });

  it('regenerates when no corpus doc exists', async () => {
    const fake = makeFakeDb([]);
    const generateForSymbol = jest.fn(async () => ({ symbol: 'AAPL', generated: [], skipped: false }));
    const { logger } = makeLogs();
    await handleGenerateSwingSets({ symbol: 'AAPL' }, {
      repository: new SwingSetRepository(fake),
      generation: { generateForSymbol },
      logger,
    });
    expect(generateForSymbol).toHaveBeenCalledWith('AAPL');
  });

  it('propagates service errors so Cloud Tasks retries transient failures', async () => {
    const fake = makeFakeDb([]);
    const generateForSymbol = jest.fn(async () => { throw new Error('firestore unavailable'); });
    const { logger } = makeLogs();
    await expect(
      handleGenerateSwingSets({ symbol: 'AAPL' }, {
        repository: new SwingSetRepository(fake),
        generation: { generateForSymbol },
        logger,
      }),
    ).rejects.toThrow('firestore unavailable');
  });
});

describe('enqueueSwingSetGeneration', () => {
  let enqueueSwingSetGeneration: Function;

  beforeEach(() => {
    enqueueSwingSetGeneration = require('../../../../src/v2/swing-set/handlers/generate-swing-sets.core').enqueueSwingSetGeneration;
  });

  it('enqueues { symbol } when the tracked doc has optionsEnabled=true', async () => {
    const fake = makeFakeDb([], { AAPL: { optionsEnabled: true } });
    const enqueue = jest.fn(async () => {});
    const { logger } = makeLogs();
    const enqueued = await enqueueSwingSetGeneration(fake, 'aapl', { enqueue, logger });
    expect(enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith({ symbol: 'AAPL' });
  });

  it.each([
    ['not tracked', {}],
    ['optionsEnabled=false', { AAPL: { optionsEnabled: false } }],
    ['optionsEnabled absent', { AAPL: { symbol: 'AAPL' } }],
  ])('does not enqueue when %s', async (_label, tracked) => {
    const fake = makeFakeDb([], tracked);
    const enqueue = jest.fn(async () => {});
    const { logger, logs } = makeLogs();
    const enqueued = await enqueueSwingSetGeneration(fake, 'AAPL', { enqueue, logger });
    expect(enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logs.some((l) => l.level === 'info' || l.level === 'warn')).toBe(true);
  });

  it('rejects an empty symbol before touching Firestore', async () => {
    const fake = makeFakeDb([]);
    const enqueue = jest.fn(async () => {});
    const { logger, logs } = makeLogs();
    const enqueued = await enqueueSwingSetGeneration(fake, '   ', { enqueue, logger });
    expect(enqueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
  });
});
