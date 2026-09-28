/**
 * Task #152: task-handler tests for the Stage 2 (time-series build) Cloud Task.
 *
 * Tests the extracted `handleTsBuildTask` core — same seam convention as
 * generate-swing-sets.core.ts (side-effect-free, injected deps, no
 * firebase-admin init in jest).
 */
import { handleTsBuildTask } from '../../../src/v2/historical-options-corpus/handlers/ts-build.core';
import type { TimeSeriesBuildReport } from '../../../src/v2/historical-options-corpus/services/time-series-builder.service';

const report = (over: Partial<TimeSeriesBuildReport> = {}): TimeSeriesBuildReport => ({
  symbol: 'AAPL',
  startDate: '2026-03-02',
  endDate: '2026-03-02',
  totalTradingDays: 1,
  foundDates: 1,
  missingDates: 0,
  corruptDates: 0,
  processedContracts: 3,
  failedContracts: 0,
  errors: [],
  ...over,
});

function deps(over: any = {}) {
  const logger = jest.fn();
  return {
    logger,
    deps: {
      isOptionsEnabled: jest.fn().mockResolvedValue(true),
      buildSymbol: jest.fn().mockResolvedValue(report()),
      logger,
      warn: jest.fn(),
      error: jest.fn(),
      ...over,
    },
  };
}

describe('handleTsBuildTask (Task #152)', () => {
  it('builds any enabled symbol — not just QQQ/TQQQ', async () => {
    const { deps: d } = deps();
    await handleTsBuildTask({ symbol: 'MSFT', date: '2026-03-02' }, d);
    expect(d.buildSymbol).toHaveBeenCalledWith(
      'MSFT', '2026-03-02', '2026-03-02',
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
  });

  it('skips entirely when the payload is fully pre-floor (pre-2019)', async () => {
    const { deps: d } = deps();
    await handleTsBuildTask({ symbol: 'AMD', date: '1999-12-01' }, d);
    expect(d.buildSymbol).not.toHaveBeenCalled();
    expect(d.isOptionsEnabled).not.toHaveBeenCalled();
  });

  it('clamps a range start to the 2019 floor', async () => {
    const { deps: d } = deps();
    await handleTsBuildTask({ symbol: 'AMD', startDate: '1999-01-01', endDate: '2026-09-26' }, d);
    expect(d.buildSymbol).toHaveBeenCalledWith(
      'AMD', '2019-01-01', '2026-09-26',
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
  });

  it('defers and re-enqueues when the symbol lease is held', async () => {
    const enqueueTask = jest.fn().mockResolvedValue(undefined);
    const releaseLease = jest.fn().mockResolvedValue(undefined);
    const { deps: d } = deps({
      acquireLease: jest.fn().mockResolvedValue(false),
      releaseLease,
      enqueueTask,
    });
    await handleTsBuildTask({ symbol: 'AAPL', date: '2026-03-02' }, d);
    expect(d.buildSymbol).not.toHaveBeenCalled();
    expect(enqueueTask).toHaveBeenCalledWith({ symbol: 'AAPL', date: '2026-03-02' }, 300);
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('enqueues a continuation task when the build reports a resumeDate', async () => {
    const enqueueTask = jest.fn().mockResolvedValue(undefined);
    const releaseLease = jest.fn().mockResolvedValue(undefined);
    const { deps: d } = deps({
      buildSymbol: jest.fn().mockResolvedValue(report({ resumeDate: '2026-03-10' })),
      acquireLease: jest.fn().mockResolvedValue(true),
      releaseLease,
      enqueueTask,
    });
    await handleTsBuildTask({ symbol: 'AAPL', startDate: '2026-03-01', endDate: '2026-03-31' }, d);
    expect(enqueueTask).toHaveBeenCalledWith({ symbol: 'AAPL', startDate: '2026-03-10', endDate: '2026-03-31' });
    expect(releaseLease).toHaveBeenCalledWith('AAPL');
  });

  it('releases the lease when the build throws', async () => {
    const releaseLease = jest.fn().mockResolvedValue(undefined);
    const { deps: d } = deps({
      buildSymbol: jest.fn().mockRejectedValue(new Error('gcs unavailable')),
      acquireLease: jest.fn().mockResolvedValue(true),
      releaseLease,
    });
    await expect(handleTsBuildTask({ symbol: 'AAPL', date: '2026-03-02' }, d)).rejects.toThrow('gcs unavailable');
    expect(releaseLease).toHaveBeenCalledWith('AAPL');
  });

  it('skips the build entirely for a non-enabled symbol', async () => {
    const { deps: d } = deps({ isOptionsEnabled: jest.fn().mockResolvedValue(false) });
    await handleTsBuildTask({ symbol: 'BOGUS', date: '2026-03-02' }, d);
    expect(d.buildSymbol).not.toHaveBeenCalled();
  });

  it('warns when the corpus item is missing (report.missingDates > 0)', async () => {
    const { deps: d } = deps({ buildSymbol: jest.fn().mockResolvedValue(report({ missingDates: 1, foundDates: 0 })) });
    await handleTsBuildTask({ symbol: 'AAPL', date: '2026-03-02' }, d);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('missing'), expect.objectContaining({ missingDates: 1 }));
  });

  it('propagates builder errors so Cloud Tasks can retry', async () => {
    const { deps: d } = deps({ buildSymbol: jest.fn().mockRejectedValue(new Error('gcs unavailable')) });
    await expect(handleTsBuildTask({ symbol: 'AAPL', date: '2026-03-02' }, d)).rejects.toThrow('gcs unavailable');
    expect(d.error).toHaveBeenCalledWith('failed', expect.objectContaining({ symbol: 'AAPL' }));
  });
});
