import {
  AvEarningsEstimatesResponse,
  AvEarningsEstimate,
} from '@shared/alpha-vantage/av-earnings-estimates-types';

describe('AvEarningsEstimatesResponse types', () => {
  it('AvEarningsEstimate accepts all fields with string values', () => {
    const estimate: AvEarningsEstimate = {
      date: '2025-03-31',
      horizon: 'fiscal quarter',
      eps_estimate_average: '1.50',
      eps_estimate_high: '1.60',
      eps_estimate_low: '1.40',
      eps_estimate_analyst_count: '5',
      eps_estimate_average_7_days_ago: '1.48',
      eps_estimate_average_30_days_ago: '1.45',
      eps_estimate_average_60_days_ago: '1.43',
      eps_estimate_average_90_days_ago: '1.42',
      eps_estimate_revision_up_trailing_7_days: '2',
      eps_estimate_revision_down_trailing_7_days: '1',
      eps_estimate_revision_up_trailing_30_days: '3',
      eps_estimate_revision_down_trailing_30_days: '0',
      revenue_estimate_average: '5000000000',
      revenue_estimate_high: '5200000000',
      revenue_estimate_low: '4800000000',
      revenue_estimate_analyst_count: '4',
    };
    expect(estimate.horizon).toBe('fiscal quarter');
    expect(estimate.eps_estimate_average).toBe('1.50');
  });

  it('AvEarningsEstimate accepts null for nullable revision fields', () => {
    const estimate: AvEarningsEstimate = {
      date: '2025-03-31',
      horizon: 'fiscal year',
      eps_estimate_average: '6.00',
      eps_estimate_high: '6.20',
      eps_estimate_low: '5.80',
      eps_estimate_analyst_count: '5',
      eps_estimate_average_7_days_ago: '5.98',
      eps_estimate_average_30_days_ago: '5.95',
      eps_estimate_average_60_days_ago: '5.93',
      eps_estimate_average_90_days_ago: '5.92',
      eps_estimate_revision_up_trailing_7_days: null,
      eps_estimate_revision_down_trailing_7_days: null,
      eps_estimate_revision_up_trailing_30_days: null,
      eps_estimate_revision_down_trailing_30_days: null,
      revenue_estimate_average: '24000000000',
      revenue_estimate_high: '24500000000',
      revenue_estimate_low: '23500000000',
      revenue_estimate_analyst_count: '4',
    };
    expect(estimate.eps_estimate_revision_up_trailing_7_days).toBeNull();
    expect(estimate.eps_estimate_revision_down_trailing_7_days).toBeNull();
  });

  it('AvEarningsEstimate horizon accepts fiscal year', () => {
    const estimate: AvEarningsEstimate = {
      date: '2025-12-31',
      horizon: 'fiscal year',
      eps_estimate_average: '6.00',
      eps_estimate_high: '6.20',
      eps_estimate_low: '5.80',
      eps_estimate_analyst_count: '5',
      eps_estimate_average_7_days_ago: '5.98',
      eps_estimate_average_30_days_ago: '5.95',
      eps_estimate_average_60_days_ago: '5.93',
      eps_estimate_average_90_days_ago: '5.92',
      eps_estimate_revision_up_trailing_7_days: '2',
      eps_estimate_revision_down_trailing_7_days: '0',
      eps_estimate_revision_up_trailing_30_days: '3',
      eps_estimate_revision_down_trailing_30_days: '1',
      revenue_estimate_average: '24000000000',
      revenue_estimate_high: '24500000000',
      revenue_estimate_low: '23500000000',
      revenue_estimate_analyst_count: '4',
    };
    expect(estimate.horizon).toBe('fiscal year');
  });

  it('AvEarningsEstimatesResponse accepts symbol and estimates array', () => {
    const response: AvEarningsEstimatesResponse = {
      symbol: 'IBM',
      estimates: [],
    };
    expect(response.symbol).toBe('IBM');
    expect(response.estimates).toHaveLength(0);
  });
});
