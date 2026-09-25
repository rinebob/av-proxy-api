/**
 * Unit tests for Thread #105 Task #139:
 * - withOptionsFlagDefaults (ingestion defaults in saveTrackedSymbol)
 * - handleSymbolReadyTransition (on-add optionable probe trigger core)
 */
import { TRACKED_SYMBOL_V2_FIELDS as F, TrackedSymbolOnboardingStatus } from '@shared/alpha-vantage';
import { withOptionsFlagDefaults } from '../../../src/v2/symbol-flags/utils/options-flag-defaults';
import { handleSymbolReadyTransition } from '../../../src/v2/symbol-flags/triggers/symbol-ready.core';

describe('withOptionsFlagDefaults', () => {
  const base = { symbol: 'AAPL', name: 'Apple', type: 'Equity' } as any;

  it('adds optionsEnabled=false + empty history for a brand-new doc', () => {
    const out = withOptionsFlagDefaults({ ...base }, undefined);
    expect(out.optionsEnabled).toBe(false);
    expect(out.optionsEnabledHistory).toEqual([]);
  });

  it('adds defaults when the existing doc lacks the fields', () => {
    const out = withOptionsFlagDefaults({ ...base }, { symbol: 'AAPL' });
    expect(out.optionsEnabled).toBe(false);
    expect(out.optionsEnabledHistory).toEqual([]);
  });

  it('does not touch an existing optionsEnabled=true', () => {
    const out = withOptionsFlagDefaults(
      { ...base },
      { optionsEnabled: true, optionsEnabledHistory: [{ enabled: true, changedAt: new Date() }] },
    );
    expect(out.optionsEnabled).toBeUndefined(); // absent → merge preserves true
    expect(out.optionsEnabledHistory).toBeUndefined();
  });

  it('preserves an existing optionsEnabled=false', () => {
    const out = withOptionsFlagDefaults({ ...base }, { optionsEnabled: false, optionsEnabledHistory: [] });
    expect(out.optionsEnabled).toBeUndefined();
  });

  it('honors a caller-provided optionsEnabled=true (enable at ingestion)', () => {
    const out = withOptionsFlagDefaults({ ...base, optionsEnabled: true }, undefined);
    expect(out.optionsEnabled).toBe(true);
    expect(out.optionsEnabledHistory).toEqual([]);
  });
});

describe('handleSymbolReadyTransition', () => {
  const beforeNotReady = { [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.PRICE_DATA_READY };
  const afterReady = { [F.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.READY };

  function makeDeps() {
    const probeAndPersist = jest.fn(async (_s: string) => ({ optionable: true }));
    const logs: string[] = [];
    return { probeAndPersist, logs, logger: { warn: (m: string) => logs.push(m), info: (_m: string) => {} } };
  }

  it('probes on a →READY transition when optionable is absent', async () => {
    const { probeAndPersist, logger } = makeDeps();
    const out = await handleSymbolReadyTransition('AAPL', beforeNotReady, afterReady, { probeAndPersist, logger });
    expect(out).toBe('probed');
    expect(probeAndPersist).toHaveBeenCalledWith('AAPL');
  });

  it('skips when there is no →READY transition', async () => {
    const { probeAndPersist, logger } = makeDeps();
    const out = await handleSymbolReadyTransition('AAPL', afterReady, afterReady, { probeAndPersist, logger });
    expect(out).toBe('skipped-no-transition');
    expect(probeAndPersist).not.toHaveBeenCalled();
  });

  it('skips when after-doc is already probed', async () => {
    const { probeAndPersist, logger } = makeDeps();
    const out = await handleSymbolReadyTransition(
      'AAPL',
      beforeNotReady,
      { ...afterReady, [F.OPTIONABLE]: true },
      { probeAndPersist, logger },
    );
    expect(out).toBe('skipped-already-probed');
    expect(probeAndPersist).not.toHaveBeenCalled();
  });

  it('skips when optionable is present-but-false (probe already failed once)', async () => {
    const { probeAndPersist, logger } = makeDeps();
    const out = await handleSymbolReadyTransition(
      'AAPL',
      beforeNotReady,
      { ...afterReady, [F.OPTIONABLE]: false },
      { probeAndPersist, logger },
    );
    expect(out).toBe('skipped-already-probed');
  });

  it('returns probe-failed and warns instead of throwing (no retry flap)', async () => {
    const { probeAndPersist, logger, logs } = makeDeps();
    probeAndPersist.mockRejectedValue(new Error('quota'));
    const out = await handleSymbolReadyTransition('AAPL', beforeNotReady, afterReady, { probeAndPersist, logger });
    expect(out).toBe('probe-failed');
    expect(logs.some((l) => l.includes('quota'))).toBe(true);
  });

  it('skips missing/empty docs without probing', async () => {
    const { probeAndPersist, logger } = makeDeps();
    expect(await handleSymbolReadyTransition('AAPL', undefined, undefined, { probeAndPersist, logger }))
      .toBe('skipped-no-transition');
    expect(probeAndPersist).not.toHaveBeenCalled();
  });
});
