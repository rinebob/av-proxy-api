// Unit tests for the ts-build repair helpers (Task #229 — repair pass for
// failed contract observations). The helpers are pure: they take parsed
// `builder.symbol.done` log-entry shapes and produce the failed build
// tasks, the re-enqueue payloads, and the explicit unhealed report.

import {
  extractFailedBuilds,
  flattenUnhealed,
  toRepairPayloads,
} from '../../../src/v2/historical-options-corpus/services/ts-build-repair';

const doneEntry = (
  symbol: string,
  startDate: string,
  endDate: string,
  failedContracts: number,
  errors: Array<{ contractID: string; error: string }> = [],
) => ({
  event: 'builder.symbol.done',
  component: 'time-series-builder',
  symbol,
  report: {
    symbol,
    startDate,
    endDate,
    totalTradingDays: 10,
    foundDates: 10,
    missingDates: 0,
    corruptDates: 0,
    processedContracts: 500,
    failedContracts,
    errors,
  },
});

describe('extractFailedBuilds', () => {
  it('returns only done events whose report has failedContracts > 0', () => {
    const entries = [
      doneEntry('QQQ', '2026-01-02', '2026-01-02', 3, [
        { contractID: 'QQQ260220C00500000', error: 'read: socket hang up' },
      ]),
      doneEntry('AAPL', '2026-01-05', '2026-01-05', 0),
      { event: 'builder.read.error', component: 'time-series-builder', symbol: 'QQQ', contractID: 'X', error: 'boom' },
      { event: 'builder.flush.done', component: 'time-series-builder', symbol: 'QQQ' },
    ];

    const failed = extractFailedBuilds(entries);

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      symbol: 'QQQ',
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      failedContracts: 3,
    });
  });

  it('dedupes the same (symbol, range) across retries, unioning errors by contract', () => {
    const entries = [
      doneEntry('QQQ', '2026-01-02', '2026-04-30', 5, [
        { contractID: 'C1', error: 'read: e1' },
        { contractID: 'C2', error: 'write: e2' },
      ]),
      // Same range observed again (continuation/duplicate) — newer error for C1
      doneEntry('QQQ', '2026-01-02', '2026-04-30', 4, [
        { contractID: 'C1', error: 'read: e1b' },
        { contractID: 'C3', error: 'read: e3' },
      ]),
    ];

    const failed = extractFailedBuilds(entries);

    expect(failed).toHaveLength(1);
    expect(failed[0].failedContracts).toBe(5); // max observed
    expect(failed[0].errors).toEqual([
      { contractID: 'C1', error: 'read: e1b' },
      { contractID: 'C2', error: 'write: e2' },
      { contractID: 'C3', error: 'read: e3' },
    ]);
  });

  it('skips malformed entries without a usable range', () => {
    const entries: unknown[] = [
      doneEntry('QQQ', '', '', 2, [{ contractID: 'C1', error: 'e' }]),
      { event: 'builder.symbol.done', component: 'time-series-builder', symbol: 'QQQ' },
      null,
      undefined,
      'not-an-object',
    ];

    expect(extractFailedBuilds(entries)).toHaveLength(0);
  });

  it('ignores non-numeric failedContracts and non-array errors', () => {
    const bad = doneEntry('QQQ', '2026-01-02', '2026-01-02', 0);
    (bad.report as { failedContracts: unknown }).failedContracts = 'three';
    (bad.report as { errors: unknown }).errors = 'not-an-array';

    expect(extractFailedBuilds([bad])).toHaveLength(0);
  });

  it('counts failedContracts>0 even when errors[] is absent (log-payload truncation)', () => {
    const truncated = doneEntry('QQQ', '2026-01-02', '2026-01-02', 7);
    delete (truncated.report as { errors?: unknown }).errors;

    const failed = extractFailedBuilds([truncated]);

    expect(failed).toHaveLength(1);
    expect(failed[0].failedContracts).toBe(7);
    expect(failed[0].errors).toHaveLength(0);
    expect(flattenUnhealed(failed)).toHaveLength(0);
  });

  it('drops error entries without a contractID', () => {
    const failed = extractFailedBuilds([
      doneEntry('QQQ', '2026-01-02', '2026-01-02', 2, [
        { contractID: 'C1', error: 'e' },
        { error: 'orphan' } as unknown as { contractID: string; error: string },
      ]),
    ]);

    expect(failed[0].errors).toEqual([{ contractID: 'C1', error: 'e' }]);
  });
});

describe('toRepairPayloads', () => {
  it('produces sorted, deduped TsBuildPayloads for the ts-build queue', () => {
    const builds = extractFailedBuilds([
      doneEntry('qqq', '2026-01-02', '2026-01-02', 1, [{ contractID: 'C1', error: 'e' }]),
      doneEntry('AAPL', '2026-01-05', '2026-01-09', 2, [{ contractID: 'C9', error: 'e' }]),
      doneEntry('QQQ', '2026-01-02', '2026-01-02', 1, [{ contractID: 'C1', error: 'e' }]),
    ]);

    expect(toRepairPayloads(builds)).toEqual([
      { symbol: 'AAPL', startDate: '2026-01-05', endDate: '2026-01-09' },
      { symbol: 'QQQ', startDate: '2026-01-02', endDate: '2026-01-02' },
    ]);
  });
});

describe('flattenUnhealed', () => {
  it('flattens per-contract errors into a sorted triage list', () => {
    const builds = extractFailedBuilds([
      doneEntry('QQQ', '2026-01-02', '2026-01-02', 2, [
        { contractID: 'QQQ-B', error: 'write: 500' },
        { contractID: 'QQQ-A', error: 'read: reset' },
      ]),
      doneEntry('AAPL', '2026-01-05', '2026-01-05', 1, [
        { contractID: 'AAPL-Z', error: 'read: eof' },
      ]),
    ]);

    expect(flattenUnhealed(builds)).toEqual([
      { symbol: 'AAPL', contractID: 'AAPL-Z', error: 'read: eof' },
      { symbol: 'QQQ', contractID: 'QQQ-A', error: 'read: reset' },
      { symbol: 'QQQ', contractID: 'QQQ-B', error: 'write: 500' },
    ]);
  });
});
