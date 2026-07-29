import { SpreadPricingService } from '../../../src/v2/spread-pricing/services';
import type { GcsTimeSeriesAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-time-series-adapter.service';
import type { SpreadRequest } from '../../../src/v2/partner/spread-request.types';

function makeStorageLine(date: string, mark?: string, bid?: string, ask?: string, delta?: string, gamma?: string, theta?: string, vega?: string, rho?: string): string {
  const obj: Record<string, string> = { d: date };
  if (mark !== undefined) obj.m = mark;
  if (bid !== undefined) obj.b = bid;
  if (ask !== undefined) obj.a = ask;
  if (delta !== undefined) obj.de = delta;
  if (gamma !== undefined) obj.g = gamma;
  if (theta !== undefined) obj.t = theta;
  if (vega !== undefined) obj.ve = vega;
  if (rho !== undefined) obj.r = rho;
  return JSON.stringify(obj);
}

function makeAdapter(readLinesImpl: jest.Mock): GcsTimeSeriesAdapter {
  return { readLines: readLinesImpl } as unknown as GcsTimeSeriesAdapter;
}

function makeVerticalRequest(overrides: Partial<SpreadRequest> = {}): SpreadRequest {
  return {
    spreadType: 'vertical',
    symbol: 'QQQ',
    legs: [
      { expiration: '2024-07-19', strike: 450, optionType: 'call', direction: 'long' },
      { expiration: '2024-07-19', strike: 455, optionType: 'call', direction: 'short' },
    ],
    ...overrides,
  };
}

describe('SpreadPricingService', () => {
  it('computes spread prices for a 2-leg vertical with full overlap', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50', undefined, undefined, '0.50', '0.02', '-0.03', '0.10', '0.01'), makeStorageLine('2024-05-02', '8.45', undefined, undefined, '0.48', '0.02', '-0.03', '0.10', '0.01')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25', undefined, undefined, '0.30', '0.02', '-0.02', '0.08', '0.005'), makeStorageLine('2024-05-02', '3.20', undefined, undefined, '0.28', '0.02', '-0.02', '0.08', '0.005')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.series).toHaveLength(2);
    expect(result.series[0].date).toBe('2024-05-01');
    expect(result.series[0].price).toBe(5.25);
    expect(result.series[0].delta).toBe(0.20);
    expect(result.series[1].price).toBe(5.25);
    expect(result.debitOrCredit).toBe('debit');
    expect(result.gaps).toEqual([]);
  });

  it('uses intersection of leg date ranges', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-04-15', '8.50'), makeStorageLine('2024-05-01', '8.45'), makeStorageLine('2024-05-02', '8.40')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    if ('error' in result) return;
    expect(result.series).toHaveLength(2);
    expect(result.series[0].date).toBe('2024-05-01');
  });

  it('surfaces gap dates when a leg observation is missing', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45'), makeStorageLine('2024-05-03', '8.40')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-03', '3.20')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    if ('error' in result) return;
    expect(result.series).toHaveLength(2);
    expect(result.gaps).toContain('2024-05-02');
  });

  it('returns error when leg contract not found in GCS', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50')])
      .mockResolvedValueOnce(undefined);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.legIndex).toBe(1);
    expect(result.contractID).toBe('QQQ240719C00455000');
    expect(result.error).toContain('not found in GCS');
  });

  it('applies startDate/endDate filter', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45'), makeStorageLine('2024-05-03', '8.40')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20'), makeStorageLine('2024-05-03', '3.15')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest({ startDate: '2024-05-02', endDate: '2024-05-02' }));

    if ('error' in result) return;
    expect(result.series).toHaveLength(1);
    expect(result.series[0].date).toBe('2024-05-02');
  });

  it('includes leg series with date and mark', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '8.50'), makeStorageLine('2024-05-02', '8.45')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25'), makeStorageLine('2024-05-02', '3.20')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    if ('error' in result) return;
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0].contractID).toBe('QQQ240719C00450000');
    expect(result.legs[0].series).toHaveLength(2);
    expect(result.legs[0].series[0]).toEqual({ date: '2024-05-01', mark: 8.50 });
    expect(result.legs[1].contractID).toBe('QQQ240719C00455000');
  });

  it('falls back to bid/ask midpoint when mark is missing', async () => {
    const readLines = jest.fn()
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', undefined, '8.40', '8.60')])
      .mockResolvedValueOnce([makeStorageLine('2024-05-01', '3.25')]);

    const service = new SpreadPricingService(makeAdapter(readLines));
    const result = await service.computeSpread(makeVerticalRequest());

    if ('error' in result) return;
    expect(result.series[0].price).toBe(5.25);
  });
});
