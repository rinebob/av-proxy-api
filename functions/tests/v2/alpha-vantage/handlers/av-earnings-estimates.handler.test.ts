import { AvEarningsEstimatesHandler } from '../../../../src/v2/alpha-vantage/handlers/av-earnings-estimates.handler';
import type { AvEarningsEstimatesResponse, AvEarningsEstimate } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';

// Mock the API key so the base handler constructor doesn't throw
process.env.ALPHAVANTAGE_API_KEY = 'test-api-key';

/**
 * Test wrapper that exposes the protected transformResponse method for testing.
 */
class TestableAvEarningsEstimatesHandler extends AvEarningsEstimatesHandler {
  public testTransformResponse(data: any): AvEarningsEstimatesResponse {
    return this.transformResponse(data);
  }
}

function createHandler(): TestableAvEarningsEstimatesHandler {
  const mockConfig: EndpointConfig = {
    id: 'EARNINGS_ESTIMATES' as any,
    name: 'Earnings Estimates',
    ttl: 7 * 24 * 60 * 60,
    firestorePath: 'market-data/{symbol}/data-points/EARNINGS_ESTIMATES',
    symbolUsage: 'REQUIRED' as any,
    category: 'FUNDAMENTAL' as any,
  } as EndpointConfig;
  return new TestableAvEarningsEstimatesHandler(mockConfig);
}

const mockAvEarningsEstimatesResponse = {
  symbol: 'AAPL',
  estimates: [
    {
      date: '2025-12-31',
      horizon: 'fiscal year',
      eps_estimate_average: '7.05',
      eps_estimate_high: '7.35',
      eps_estimate_low: '6.75',
      eps_estimate_analyst_count: '28',
      eps_estimate_average_7_days_ago: '7.00',
      eps_estimate_average_30_days_ago: '6.95',
      eps_estimate_average_60_days_ago: '6.90',
      eps_estimate_average_90_days_ago: '6.85',
      eps_estimate_revision_up_trailing_7_days: '2',
      eps_estimate_revision_down_trailing_7_days: null,
      eps_estimate_revision_up_trailing_30_days: '5',
      eps_estimate_revision_down_trailing_30_days: '1',
      revenue_estimate_average: '385000000000',
      revenue_estimate_high: '395000000000',
      revenue_estimate_low: '375000000000',
      revenue_estimate_analyst_count: '25',
    },
    {
      date: '2025-09-30',
      horizon: 'fiscal quarter',
      eps_estimate_average: '1.80',
      eps_estimate_high: '2.00',
      eps_estimate_low: '1.60',
      eps_estimate_analyst_count: '30',
      eps_estimate_average_7_days_ago: '1.75',
      eps_estimate_average_30_days_ago: '1.70',
      eps_estimate_average_60_days_ago: '1.65',
      eps_estimate_average_90_days_ago: '1.60',
      eps_estimate_revision_up_trailing_7_days: null,
      eps_estimate_revision_down_trailing_7_days: null,
      eps_estimate_revision_up_trailing_30_days: null,
      eps_estimate_revision_down_trailing_30_days: null,
      revenue_estimate_average: '95000000000',
      revenue_estimate_high: '98000000000',
      revenue_estimate_low: '92000000000',
      revenue_estimate_analyst_count: '28',
    },
  ],
};

describe('AvEarningsEstimatesHandler', () => {
  let handler: TestableAvEarningsEstimatesHandler;

  beforeEach(() => {
    handler = createHandler();
  });

  describe('transformResponse', () => {
    it('extracts symbol from AV response', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      expect(result.symbol).toBe('AAPL');
    });

    it('extracts estimates array with correct count', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      expect(result.estimates).toHaveLength(2);
    });

    it('extracts all string fields from first estimate entry', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      const e = result.estimates[0] as AvEarningsEstimate;
      expect(e.date).toBe('2025-12-31');
      expect(e.eps_estimate_average).toBe('7.05');
      expect(e.eps_estimate_high).toBe('7.35');
      expect(e.eps_estimate_low).toBe('6.75');
      expect(e.eps_estimate_analyst_count).toBe('28');
      expect(e.eps_estimate_average_7_days_ago).toBe('7.00');
      expect(e.eps_estimate_average_30_days_ago).toBe('6.95');
      expect(e.eps_estimate_average_60_days_ago).toBe('6.90');
      expect(e.eps_estimate_average_90_days_ago).toBe('6.85');
      expect(e.revenue_estimate_average).toBe('385000000000');
      expect(e.revenue_estimate_high).toBe('395000000000');
      expect(e.revenue_estimate_low).toBe('375000000000');
      expect(e.revenue_estimate_analyst_count).toBe('25');
    });

    it('preserves horizon field values (fiscal year and fiscal quarter)', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      expect(result.estimates[0].horizon).toBe('fiscal year');
      expect(result.estimates[1].horizon).toBe('fiscal quarter');
    });

    it('preserves non-null revision count fields', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      expect(result.estimates[0].eps_estimate_revision_up_trailing_7_days).toBe('2');
      expect(result.estimates[0].eps_estimate_revision_down_trailing_7_days).toBeNull();
      expect(result.estimates[0].eps_estimate_revision_up_trailing_30_days).toBe('5');
      expect(result.estimates[0].eps_estimate_revision_down_trailing_30_days).toBe('1');
    });

    it('preserves null revision count fields as null (not coerced to string or undefined)', () => {
      const result = handler.testTransformResponse(mockAvEarningsEstimatesResponse);
      const e = result.estimates[1] as AvEarningsEstimate;
      expect(e.eps_estimate_revision_up_trailing_7_days).toBeNull();
      expect(e.eps_estimate_revision_down_trailing_7_days).toBeNull();
      expect(e.eps_estimate_revision_up_trailing_30_days).toBeNull();
      expect(e.eps_estimate_revision_down_trailing_30_days).toBeNull();
    });

    it('returns empty array for empty estimates response', () => {
      const emptyResponse = {
        symbol: 'AAPL',
        estimates: [],
      };
      const result = handler.testTransformResponse(emptyResponse);
      expect(result.estimates).toEqual([]);
    });

    it('returns empty array when estimates field is missing', () => {
      const missingEstimatesResponse = {
        symbol: 'AAPL',
      };
      const result = handler.testTransformResponse(missingEstimatesResponse);
      expect(result.estimates).toEqual([]);
    });

    it('returns empty array and empty symbol when response is completely empty', () => {
      const result = handler.testTransformResponse({});
      expect(result.symbol).toBe('');
      expect(result.estimates).toEqual([]);
    });

    it('converts undefined revision fields to null', () => {
      const responseWithUndefined = {
        symbol: 'AAPL',
        estimates: [
          {
            date: '2025-12-31',
            horizon: 'fiscal year',
            eps_estimate_average: '7.05',
            eps_estimate_high: '7.35',
            eps_estimate_low: '6.75',
            eps_estimate_analyst_count: '28',
            eps_estimate_average_7_days_ago: '7.00',
            eps_estimate_average_30_days_ago: '6.95',
            eps_estimate_average_60_days_ago: '6.90',
            eps_estimate_average_90_days_ago: '6.85',
            // revision fields intentionally undefined
            revenue_estimate_average: '385000000000',
            revenue_estimate_high: '395000000000',
            revenue_estimate_low: '375000000000',
            revenue_estimate_analyst_count: '25',
          },
        ],
      };
      const result = handler.testTransformResponse(responseWithUndefined);
      expect(result.estimates[0].eps_estimate_revision_up_trailing_7_days).toBeNull();
      expect(result.estimates[0].eps_estimate_revision_down_trailing_7_days).toBeNull();
      expect(result.estimates[0].eps_estimate_revision_up_trailing_30_days).toBeNull();
      expect(result.estimates[0].eps_estimate_revision_down_trailing_30_days).toBeNull();
    });

    it('preserves "None" string values from AV for numeric fields', () => {
      const responseWithNoneValues = {
        symbol: 'AAPL',
        estimates: [
          {
            date: '2025-12-31',
            horizon: 'fiscal year',
            eps_estimate_average: 'None',
            eps_estimate_high: 'None',
            eps_estimate_low: 'None',
            eps_estimate_analyst_count: '0',
            eps_estimate_average_7_days_ago: 'None',
            eps_estimate_average_30_days_ago: 'None',
            eps_estimate_average_60_days_ago: 'None',
            eps_estimate_average_90_days_ago: 'None',
            eps_estimate_revision_up_trailing_7_days: null,
            eps_estimate_revision_down_trailing_7_days: null,
            eps_estimate_revision_up_trailing_30_days: null,
            eps_estimate_revision_down_trailing_30_days: null,
            revenue_estimate_average: 'None',
            revenue_estimate_high: 'None',
            revenue_estimate_low: 'None',
            revenue_estimate_analyst_count: '0',
          },
        ],
      };
      const result = handler.testTransformResponse(responseWithNoneValues);
      expect(result.estimates[0].eps_estimate_average).toBe('None');
      expect(result.estimates[0].revenue_estimate_average).toBe('None');
    });
  });
});
