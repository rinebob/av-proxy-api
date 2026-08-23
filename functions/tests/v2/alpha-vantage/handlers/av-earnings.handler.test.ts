import { AvEarningsHandler } from '../../../../src/v2/alpha-vantage/handlers/av-earnings.handler';
import type { AvEarningsResponse, AvAnnualEarning } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';

// Mock the API key so the base handler constructor doesn't throw
process.env.ALPHAVANTAGE_API_KEY = 'test-api-key';

/**
 * Test wrapper that exposes the protected transformResponse method for testing.
 */
class TestableAvEarningsHandler extends AvEarningsHandler {
  public testTransformResponse(data: any): AvEarningsResponse {
    return this.transformResponse(data);
  }
}

function createHandler(): TestableAvEarningsHandler {
  const mockConfig: EndpointConfig = {
    id: 'EARNINGS' as any,
    name: 'Earnings',
    ttl: 7 * 24 * 60 * 60,
    firestorePath: 'market-data/{symbol}/data-points/EARNINGS',
    symbolUsage: 'REQUIRED' as any,
    category: 'FUNDAMENTAL' as any,
  } as EndpointConfig;
  return new TestableAvEarningsHandler(mockConfig);
}

const mockAvEarningsResponse = {
  symbol: 'NVDA',
  annualEarnings: [
    { fiscalDateEnding: '2026-07-31', reportedEPS: '1.87' },
    { fiscalDateEnding: '2026-01-31', reportedEPS: '4.78' },
    { fiscalDateEnding: '2025-01-31', reportedEPS: '2.992' },
  ],
  quarterlyEarnings: [
    {
      fiscalDateEnding: '2026-04-30',
      reportedDate: '2026-05-20',
      reportedEPS: '1.87',
      estimatedEPS: '1.77',
      surprise: '0.1',
      surprisePercentage: '5.6497',
      reportTime: 'post-market',
    },
    {
      fiscalDateEnding: '2026-01-31',
      reportedDate: '2026-02-25',
      reportedEPS: '1.62',
      estimatedEPS: '1.54',
      surprise: '0.08',
      surprisePercentage: '5.1948',
      reportTime: 'post-market',
    },
    {
      fiscalDateEnding: '2014-07-31',
      reportedDate: '2014-08-07',
      reportedEPS: '0.006',
      estimatedEPS: '0.005',
      surprise: '0.001',
      surprisePercentage: '20',
      reportTime: 'pre-market',
    },
  ],
};

describe('AvEarningsHandler', () => {
  let handler: TestableAvEarningsHandler;

  beforeEach(() => {
    handler = createHandler();
  });

  describe('transformResponse', () => {
    it('extracts symbol from AV response', () => {
      const result = handler.testTransformResponse(mockAvEarningsResponse);
      expect(result.symbol).toBe('NVDA');
    });

    it('extracts annualEarnings array with correct fields', () => {
      const result = handler.testTransformResponse(mockAvEarningsResponse);
      expect(result.annualEarnings).toHaveLength(3);
      expect(result.annualEarnings[0]).toEqual({
        fiscalDateEnding: '2026-07-31',
        reportedEPS: '1.87',
      } as AvAnnualEarning);
      expect(result.annualEarnings[1]).toEqual({
        fiscalDateEnding: '2026-01-31',
        reportedEPS: '4.78',
      } as AvAnnualEarning);
    });

    it('extracts quarterlyEarnings array with all fields', () => {
      const result = handler.testTransformResponse(mockAvEarningsResponse);
      expect(result.quarterlyEarnings).toHaveLength(3);
      const q1 = result.quarterlyEarnings[0];
      expect(q1.fiscalDateEnding).toBe('2026-04-30');
      expect(q1.reportedDate).toBe('2026-05-20');
      expect(q1.reportedEPS).toBe('1.87');
      expect(q1.estimatedEPS).toBe('1.77');
      expect(q1.surprise).toBe('0.1');
      expect(q1.surprisePercentage).toBe('5.6497');
      expect(q1.reportTime).toBe('post-market');
    });

    it('preserves reportTime field on quarterly entries', () => {
      const result = handler.testTransformResponse(mockAvEarningsResponse);
      expect(result.quarterlyEarnings[0].reportTime).toBe('post-market');
      expect(result.quarterlyEarnings[2].reportTime).toBe('pre-market');
    });

    it('returns empty arrays for empty earnings response (no data)', () => {
      const emptyResponse = {
        symbol: 'AAPL',
        annualEarnings: [],
        quarterlyEarnings: [],
      };
      const result = handler.testTransformResponse(emptyResponse);
      expect(result.annualEarnings).toEqual([]);
      expect(result.quarterlyEarnings).toEqual([]);
    });

    it('returns empty arrays when annualEarnings and quarterlyEarnings are missing', () => {
      const missingArraysResponse = {
        symbol: 'AAPL',
      };
      const result = handler.testTransformResponse(missingArraysResponse);
      expect(result.annualEarnings).toEqual([]);
      expect(result.quarterlyEarnings).toEqual([]);
    });

    it('returns empty arrays when response is completely empty', () => {
      const result = handler.testTransformResponse({});
      expect(result.annualEarnings).toEqual([]);
      expect(result.quarterlyEarnings).toEqual([]);
    });

    it('handles quarterly entry with missing reportTime gracefully', () => {
      const responseWithMissingReportTime = {
        symbol: 'AAPL',
        annualEarnings: [],
        quarterlyEarnings: [
          {
            fiscalDateEnding: '2025-06-30',
            reportedDate: '2025-07-31',
            reportedEPS: '1.85',
            estimatedEPS: '1.83',
            surprise: '0.02',
            surprisePercentage: '1.09',
            // reportTime intentionally missing
          },
        ],
      };
      const result = handler.testTransformResponse(responseWithMissingReportTime);
      expect(result.quarterlyEarnings).toHaveLength(1);
      expect(result.quarterlyEarnings[0].reportTime).toBeUndefined();
    });

    it('preserves all AvReportTime values correctly', () => {
      const responseWithAllReportTimes = {
        symbol: 'TEST',
        annualEarnings: [],
        quarterlyEarnings: [
          { fiscalDateEnding: '2025-01-01', reportedDate: '2025-01-02', reportedEPS: '1', estimatedEPS: '1', surprise: '0', surprisePercentage: '0', reportTime: 'pre-market' },
          { fiscalDateEnding: '2025-02-01', reportedDate: '2025-02-02', reportedEPS: '2', estimatedEPS: '2', surprise: '0', surprisePercentage: '0', reportTime: 'post-market' },
        ],
      };
      const result = handler.testTransformResponse(responseWithAllReportTimes);
      expect(result.quarterlyEarnings).toHaveLength(2);
      expect(result.quarterlyEarnings[0].reportTime).toBe('pre-market');
      expect(result.quarterlyEarnings[1].reportTime).toBe('post-market');
    });

    it('handles "None" string values from AV (estimatedEPS, surprisePercentage)', () => {
      const responseWithNoneValues = {
        symbol: 'NVDA',
        annualEarnings: [],
        quarterlyEarnings: [
          {
            fiscalDateEnding: '2006-07-31',
            reportedDate: '2006-08-10',
            reportedEPS: '0.0038',
            estimatedEPS: 'None',
            surprise: '0',
            surprisePercentage: 'None',
            reportTime: 'pre-market',
          },
        ],
      };
      const result = handler.testTransformResponse(responseWithNoneValues);
      expect(result.quarterlyEarnings).toHaveLength(1);
      expect(result.quarterlyEarnings[0].estimatedEPS).toBe('None');
      expect(result.quarterlyEarnings[0].surprisePercentage).toBe('None');
    });
  });
});
