import {
  AvHistoricalOptionsResponse,
  AvOptionContract,
  AvOptionType,
} from '@shared/alpha-vantage';

import {
  TimeSeriesBuilderService,
  TimeSeriesBuilderDependencies,
} from '../../../src/v2/historical-options-corpus/services/time-series-builder.service';

interface MockDeps {
  sourceReads: unknown[];
  targetWrites: Array<{
    symbol: string;
    contractID: string;
    lines: string[];
    metadata?: Record<string, string>;
  }>;
  deps: TimeSeriesBuilderDependencies;
}

function createMockDeps(): MockDeps {
  const reads: unknown[] = [];
  const writes: MockDeps['targetWrites'] = [];

  const deps: TimeSeriesBuilderDependencies = {
    sourceGcs: {
      readItem: jest.fn().mockImplementation(async () => reads.shift()),
    } as unknown as TimeSeriesBuilderDependencies['sourceGcs'],
    targetGcs: {
      readLines: jest.fn().mockResolvedValue(undefined),
      writeLines: jest.fn().mockImplementation(async (symbol, contractID, lines, metadata) => {
        writes.push({ symbol, contractID, lines, metadata });
        return { gcsPath: `time-series/v1/${symbol}/${contractID}.jsonl`, generation: '1', bytes: 0 };
      }),
    } as unknown as TimeSeriesBuilderDependencies['targetGcs'],
    calendar: {
      getTradingDates: jest.fn().mockImplementation((startDate: string, endDate: string) =>
        startDate === endDate ? [startDate] : ['2026-01-02', '2026-01-03'],
      ),
    } as unknown as TimeSeriesBuilderDependencies['calendar'],
    logger: jest.fn(),
    chunkDays: 10,
    writeConcurrency: 10,
  };

  return { sourceReads: reads, targetWrites: writes, deps };
}

function makeResponse(data: AvOptionContract[]): AvHistoricalOptionsResponse {
  return { endpoint: 'HISTORICAL_OPTIONS', message: 'success', data };
}

const contractA: AvOptionContract = {
  contractID: 'QQQ260116C00490000',
  symbol: 'QQQ',
  expiration: '2026-01-16',
  type: AvOptionType.CALL,
  strike: '490',
  date: '2026-01-02',
  last: '1.0',
  volume: '100',
};

const contractB: AvOptionContract = {
  contractID: 'QQQ260116C00500000',
  symbol: 'QQQ',
  expiration: '2026-01-16',
  type: AvOptionType.CALL,
  strike: '500',
  date: '2026-01-02',
  last: '2.0',
  volume: '200',
};

describe('TimeSeriesBuilderService', () => {
  it('builds per-contract JSONL files from raw corpus dates', async () => {
    const { deps } = createMockDeps();
    deps.sourceGcs.readItem = jest.fn()
      .mockResolvedValueOnce({ status: 'FOUND', response: makeResponse([contractA, contractB]) })
      .mockResolvedValueOnce({
        status: 'FOUND',
        response: makeResponse([
          { ...contractA, date: '2026-01-03', last: '1.1' },
          { ...contractB, date: '2026-01-03', last: '2.1' },
        ]),
      });

    const service = new TimeSeriesBuilderService(deps);
    const report = await service.buildSymbol('QQQ', '2026-01-02', '2026-01-03');

    expect(report.foundDates).toBe(2);
    expect(report.processedContracts).toBe(2);
    expect(report.failedContracts).toBe(0);

    const contractALines = deps.targetGcs.writeLines as jest.Mock;
    const calls = contractALines.mock.calls as [string, string, string[], Record<string, string>?][];
    const aCall = calls.find((call) => call[1] === 'QQQ260116C00490000');
    expect(aCall).toBeDefined();
    expect(aCall![2].length).toBe(2);
    expect(aCall![2][1]).toContain('2026-01-03');
  });

  it('merges with existing time-series lines without duplicates', async () => {
    const { deps } = createMockDeps();
    deps.sourceGcs.readItem = jest.fn().mockResolvedValue({
      status: 'FOUND',
      response: makeResponse([{ ...contractA, date: '2026-01-03', last: '1.1' }]),
    });
    deps.targetGcs.readLines = jest.fn().mockImplementation(async (_symbol: string, contractID: string) => {
      return contractID === 'QQQ260116C00490000'
        ? [JSON.stringify({ d: '2026-01-02', l: '1.0' })]
        : undefined;
    });

    const service = new TimeSeriesBuilderService(deps);
    const report = await service.buildSymbol('QQQ', '2026-01-03', '2026-01-03');

    expect(report.foundDates).toBe(1);
    expect(report.processedContracts).toBe(1);

    const writeCalls = (deps.targetGcs.writeLines as jest.Mock).mock.calls as [string, string, string[], Record<string, string>?][];
    const aCall = writeCalls.find((call) => call[1] === 'QQQ260116C00490000');
    expect(aCall![2].length).toBe(2);
    expect(deps.logger).not.toHaveBeenCalledWith('builder.line.corrupt', expect.anything());
  });

  it('logs and skips corrupt existing JSONL lines', async () => {
    const { deps } = createMockDeps();
    deps.sourceGcs.readItem = jest.fn().mockResolvedValue({
      status: 'FOUND',
      response: makeResponse([{ ...contractA, date: '2026-01-03', last: '1.1' }]),
    });
    deps.targetGcs.readLines = jest.fn().mockResolvedValue([
      JSON.stringify({ d: '2026-01-02', l: '1.0' }),
      'this-is-not-json',
    ]);

    const service = new TimeSeriesBuilderService(deps);
    const report = await service.buildSymbol('QQQ', '2026-01-03', '2026-01-03');

    expect(report.processedContracts).toBe(1);
    expect(deps.logger).toHaveBeenCalledWith(
      'builder.line.corrupt',
      expect.objectContaining({ contractID: 'QQQ260116C00490000' }),
    );
  });

  it('counts missing and corrupt raw dates in the report', async () => {
    const { deps } = createMockDeps();
    deps.sourceGcs.readItem = jest.fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'CORRUPT', reason: 'bad envelope' });

    const service = new TimeSeriesBuilderService(deps);
    const report = await service.buildSymbol('QQQ', '2026-01-02', '2026-01-03');

    expect(report.missingDates).toBe(1);
    expect(report.corruptDates).toBe(1);
    expect((deps.targetGcs.writeLines as jest.Mock).mock.calls.length).toBe(0);
  });

  it('reports failed contracts when a write fails', async () => {
    const { deps } = createMockDeps();
    deps.sourceGcs.readItem = jest.fn().mockResolvedValue({
      status: 'FOUND',
      response: makeResponse([contractA]),
    });
    deps.targetGcs.writeLines = jest.fn().mockRejectedValue(new Error('gcs down'));

    const service = new TimeSeriesBuilderService(deps);
    const report = await service.buildSymbol('QQQ', '2026-01-02', '2026-01-02');

    expect(report.failedContracts).toBe(1);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0].contractID).toBe('QQQ260116C00490000');
  });
});
