/**
 * Task #224: tests for the extracted corpus-seed `onSeedSuccess` core —
 * nightly pick-append wiring alongside the existing ts-build enqueue.
 *
 * Same seam convention as ts-build.core.ts: injected deps, no
 * firebase-admin init in jest.
 */
import { handleCorpusSeedSuccess } from '../../../src/v2/historical-options-corpus/handlers/corpus-seed.core';

function deps(over: any = {}) {
  const logger = jest.fn();
  return {
    logger,
    deps: {
      enqueuePick: jest.fn().mockResolvedValue(undefined),
      enqueueTsBuild: jest.fn().mockResolvedValue(undefined),
      isTsBuildDateCovered: jest.fn().mockResolvedValue(false),
      logger,
      ...over,
    },
  };
}

describe('handleCorpusSeedSuccess (Task #224)', () => {
  it('enqueues the pick task and the ts-build task for the stored date', async () => {
    const { deps: d } = deps();
    await handleCorpusSeedSuccess('QQQ', '2026-03-02', d);
    expect(d.enqueuePick).toHaveBeenCalledWith({ symbol: 'QQQ', date: '2026-03-02' });
    expect(d.enqueueTsBuild).toHaveBeenCalledWith({ symbol: 'QQQ', date: '2026-03-02' });
  });

  it('still enqueues the pick task when the ts-build is lease-covered', async () => {
    const { deps: d } = deps({ isTsBuildDateCovered: jest.fn().mockResolvedValue(true) });
    await handleCorpusSeedSuccess('QQQ', '2026-03-02', d);
    // Picks depend only on the stored chain — a ts-build lease covering the
    // date has no bearing on whether its picks materialize.
    expect(d.enqueuePick).toHaveBeenCalledWith({ symbol: 'QQQ', date: '2026-03-02' });
    expect(d.enqueueTsBuild).not.toHaveBeenCalled();
  });

  it('lets a pick-enqueue failure pass through without blocking the ts-build enqueue', async () => {
    const { deps: d, logger } = deps({
      enqueuePick: jest.fn().mockRejectedValue(new Error('queue down')),
    });
    await handleCorpusSeedSuccess('QQQ', '2026-03-02', d);
    expect(d.enqueueTsBuild).toHaveBeenCalledWith({ symbol: 'QQQ', date: '2026-03-02' });
    expect(logger).toHaveBeenCalledWith(
      'pick-materialize enqueue failed',
      expect.objectContaining({ symbol: 'QQQ', date: '2026-03-02' }),
    );
  });

  it('propagates a ts-build enqueue failure for the caller to swallow (pick already enqueued)', async () => {
    const { deps: d } = deps({
      enqueueTsBuild: jest.fn().mockRejectedValue(new Error('queue down')),
    });
    await expect(handleCorpusSeedSuccess('QQQ', '2026-03-02', d)).rejects.toThrow('queue down');
    expect(d.enqueuePick).toHaveBeenCalledWith({ symbol: 'QQQ', date: '2026-03-02' });
  });
});
