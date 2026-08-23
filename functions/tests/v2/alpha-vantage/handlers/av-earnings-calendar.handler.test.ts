import { AvEarningsCalendarHandler } from '../../../../src/v2/alpha-vantage/handlers/av-earnings-calendar.handler';
import type { AvEarningsCalendarEntry } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';

// Mock the API key so the base handler constructor doesn't throw
process.env.ALPHAVANTAGE_API_KEY = 'test-api-key';

// Mock saveAvData
jest.mock('../../../../src/v2/alpha-vantage/firestore/av-standard-data.writer', () => ({
  saveAvData: jest.fn(),
}));

// Mock Firestore db
const mockListDocuments = jest.fn();
jest.mock('../../../../src/firebase-admin-init', () => ({
  admin: { firestore: () => ({ collection: () => ({ listDocuments: mockListDocuments }) }) },
  db: { collection: () => ({ listDocuments: mockListDocuments }) },
}));

import { saveAvData } from '../../../../src/v2/alpha-vantage/firestore/av-standard-data.writer';

// Realistic AV EARNINGS_CALENDAR CSV response (matches actual AV CSV shape — uses 'exchange' not 'currency')
const realisticCsvResponse = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding
AAPL,Apple Inc,2025-11-01,1.80,after close,US,2025-09-30
MSFT,Microsoft Corp,2025-10-29,1.50,before open,US,2025-09-30
NVDA,NVIDIA Corp,2025-11-19,1.30,post-market,US,2025-10-31
GOOGL,Alphabet Inc,2025-10-29,1.20,after close,US,2025-09-30
TSLA,Tesla Inc,2025-10-22,0.75,after close,US,2025-09-30
`;

function createHandler(): AvEarningsCalendarHandler {
  const mockConfig: EndpointConfig = {
    id: 'EARNINGS_CALENDAR' as any,
    name: 'Earnings Calendar',
    ttl: 24 * 60 * 60,
    firestorePath: 'market-data/av-earnings-calendar',
    symbolUsage: 'OPTIONAL' as any,
    category: 'FUNDAMENTAL' as any,
    parameters: {
      horizon: { type: 'string', required: false, default: '12month', enum: ['3month', '6month', '12month'] },
    },
  } as any;
  return new AvEarningsCalendarHandler(mockConfig);
}

function mockTrackedSymbols(symbols: string[]): void {
  mockListDocuments.mockResolvedValue(symbols.map(s => ({ id: s })));
}

describe('AvEarningsCalendarHandler', () => {
  let handler: AvEarningsCalendarHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = createHandler();
  });

  describe('fetch', () => {
    it('parses CSV response and filters to tracked symbols', async () => {
      mockTrackedSymbols(['AAPL', 'NVDA']);
      // Mock the axios get to return CSV
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: realisticCsvResponse });

      const result = await handler.fetch({});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].symbol).toBe('AAPL');
      expect(result.data[1].symbol).toBe('NVDA');
    });

    it('maps all fields from CSV rows correctly', async () => {
      mockTrackedSymbols(['AAPL']);
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: realisticCsvResponse });

      const result = await handler.fetch({});

      const entry = result.data[0] as AvEarningsCalendarEntry;
      expect(entry.symbol).toBe('AAPL');
      expect(entry.name).toBe('Apple Inc');
      expect(entry.reportDate).toBe('2025-11-01');
      expect(entry.fiscalDateEnding).toBe('2025-09-30');
      expect(entry.estimate).toBe('1.80');
      expect(entry.currency).toBe('US'); // AV returns 'exchange' field, handler maps to 'currency'
      expect(entry.timeOfTheDay).toBe('after close');
    });

    it('calls saveAvData with filtered entries (not full response)', async () => {
      mockTrackedSymbols(['AAPL', 'NVDA']);
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: realisticCsvResponse });

      await handler.fetch({});

      expect(saveAvData).toHaveBeenCalledTimes(1);
      const savedData = (saveAvData as jest.Mock).mock.calls[0][0];
      expect(savedData).toHaveLength(2);
      expect(savedData[0].symbol).toBe('AAPL');
      expect(savedData[1].symbol).toBe('NVDA');
    });

    it('calls saveAvData with no symbol (global doc)', async () => {
      mockTrackedSymbols(['AAPL']);
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: realisticCsvResponse });

      await handler.fetch({});

      const savedSymbol = (saveAvData as jest.Mock).mock.calls[0][1];
      expect(savedSymbol).toBe('');
    });

    it('empty CSV (headers only) results in empty array stored — does not skip write', async () => {
      mockTrackedSymbols(['AAPL']);
      const headersOnlyCsv = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\n';
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: headersOnlyCsv });

      const result = await handler.fetch({});

      expect(result.data).toEqual([]);
      expect(saveAvData).toHaveBeenCalledTimes(1);
      const savedData = (saveAvData as jest.Mock).mock.calls[0][0];
      expect(savedData).toEqual([]);
    });

    it('all entries filtered out (no tracked symbols match) results in empty array stored — does not skip write', async () => {
      mockTrackedSymbols(['UNKNOWN']);
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: realisticCsvResponse });

      const result = await handler.fetch({});

      expect(result.data).toEqual([]);
      expect(saveAvData).toHaveBeenCalledTimes(1);
      const savedData = (saveAvData as jest.Mock).mock.calls[0][0];
      expect(savedData).toEqual([]);
    });

    it('calls AV with function=EARNINGS_CALENDAR and horizon=12month, no symbol', async () => {
      mockTrackedSymbols(['AAPL']);
      const mockGet = jest.fn().mockResolvedValue({ data: realisticCsvResponse });
      (handler as any).apiClient.get = mockGet;

      await handler.fetch({});

      const callParams = mockGet.mock.calls[0][1].params;
      expect(callParams.function).toBe('EARNINGS_CALENDAR');
      expect(callParams.horizon).toBe('12month');
      expect(callParams.symbol).toBeUndefined();
    });

    it('handles entries with empty estimate and timeOfTheDay fields', async () => {
      mockTrackedSymbols(['PLTR']);
      const csvWithEmptyFields = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding
PLTR,Palantir Technologies,2025-11-03,,,US,2025-09-30
`;
      (handler as any).apiClient.get = jest.fn().mockResolvedValue({ data: csvWithEmptyFields });

      const result = await handler.fetch({});

      expect(result.data).toHaveLength(1);
      const entry = result.data[0] as AvEarningsCalendarEntry;
      expect(entry.estimate).toBe('');
      expect(entry.timeOfTheDay).toBe('');
    });

    it('respects horizon parameter override', async () => {
      mockTrackedSymbols(['AAPL']);
      const mockGet = jest.fn().mockResolvedValue({ data: realisticCsvResponse });
      (handler as any).apiClient.get = mockGet;

      await handler.fetch({ horizon: '3month' });

      const callParams = mockGet.mock.calls[0][1].params;
      expect(callParams.horizon).toBe('3month');
    });
  });

  describe('transformResponse', () => {
    it('throws (deprecated method)', () => {
      expect(() => (handler as any).transformResponse({})).toThrow(/deprecated/);
    });
  });
});
