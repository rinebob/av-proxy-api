/**
 * Task #154: scheduled corpus sweep — diffs each options-enabled symbol's
 * swing doc vs corpus coverage (via the reconcile/fanout seam), seeds gaps,
 * and prunes superseded interim snapshots. Per-symbol failures are isolated.
 */
import { runCorpusSweep } from '../../../src/v2/historical-options-corpus/services/corpus-sweep.core';

function makeDeps(symbols: string[] = ['AAPL', 'TSLA']) {
  const calls: string[] = [];
  const logs: { level: string; msg: string }[] = [];
  const deps = {
    listOptionsEnabledSymbols: jest.fn(async () => symbols),
    reconcile: jest.fn(async (s: string) => {
      calls.push(s);
      return { runId: `r-${s}`, planned: 3, enqueued: 2, deleted: 1 };
    }),
    logger: {
      info: (m: string) => logs.push({ level: 'info', msg: m }),
      warn: (m: string) => logs.push({ level: 'warn', msg: m }),
    },
    logs,
  };
  return { deps, calls, logs };
}

describe('runCorpusSweep', () => {
  it('reconciles every options-enabled symbol and aggregates the result', async () => {
    const { deps, calls } = makeDeps();
    const result = await runCorpusSweep(deps);
    expect(calls).toEqual(['AAPL', 'TSLA']);
    expect(result.checked).toEqual(['AAPL', 'TSLA']);
    expect(result.seeded).toBe(4);
    expect(result.deletedInterims).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it('isolates per-symbol failures', async () => {
    const { deps, logs } = makeDeps();
    deps.reconcile.mockImplementation(async (s) => {
      if (s === 'AAPL') throw new Error('gcs blew up');
      return { runId: 'r', planned: 1, enqueued: 1, deleted: 0 };
    });
    const result = await runCorpusSweep(deps);
    expect(result.failed).toEqual([{ symbol: 'AAPL', error: 'gcs blew up' }]);
    expect(result.seeded).toBe(1);
    expect(logs.some((l) => l.level === 'warn' && /AAPL/.test(l.msg))).toBe(true);
  });

  it('handles an empty enabled set', async () => {
    const { deps } = makeDeps([]);
    const result = await runCorpusSweep(deps);
    expect(result.checked).toEqual([]);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });
});
