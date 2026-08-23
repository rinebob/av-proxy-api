/**
 * Verification script for Task #42 — AvEarningsEstimatesHandler.
 *
 * Verifies that AvEarningsEstimatesHandler.transformResponse correctly transforms
 * a realistic AV EARNINGS_ESTIMATES JSON response into the typed
 * AvEarningsEstimatesResponse. Uses a realistic mock because the AV API key
 * is only available in the Cloud Functions runtime (Secret Manager), not locally.
 *
 * Pipeline stages verified:
 * - Transform: AV JSON → typed AvEarningsEstimatesResponse
 * - Nullable field preservation (revision counts can be null)
 * - horizon field preservation (fiscal year / fiscal quarter)
 * - Empty response handling
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-42-earnings-estimates-handler.ts
 */
import { AvEarningsEstimatesHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings-estimates.handler';
import type { AvEarningsEstimatesResponse } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';

// Set dummy API key — we're only testing transformResponse, not making real API calls
process.env.ALPHAVANTAGE_API_KEY = 'verify-dummy-key';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

// Test wrapper to expose protected transformResponse
class TestableAvEarningsEstimatesHandler extends AvEarningsEstimatesHandler {
  public testTransformResponse(data: any): AvEarningsEstimatesResponse {
    return this.transformResponse(data);
  }
}

// Realistic AV EARNINGS_ESTIMATES response (matches the actual AV response shape)
const realisticAvEarningsEstimatesResponse = {
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

function main(): void {
  console.log('--- Verifying AvEarningsEstimatesHandler.transformResponse against realistic AV response ---\n');

  const mockConfig: EndpointConfig = {
    id: 'EARNINGS_ESTIMATES' as any,
    name: 'Earnings Estimates',
    ttl: 7 * 24 * 60 * 60,
    firestorePath: 'market-data/{symbol}/data-points/EARNINGS_ESTIMATES',
    symbolUsage: 'REQUIRED' as any,
    category: 'FUNDAMENTAL' as any,
  } as EndpointConfig;

  const handler = new TestableAvEarningsEstimatesHandler(mockConfig);
  const transformed = handler.testTransformResponse(realisticAvEarningsEstimatesResponse);

  // Transform stage: symbol extraction
  assert(transformed.symbol === 'AAPL', `Symbol extracted correctly (got "${transformed.symbol}")`);

  // Transform stage: estimates array
  assert(
    Array.isArray(transformed.estimates) && transformed.estimates.length === 2,
    `estimates has 2 entries (got ${transformed.estimates.length})`,
  );

  // First estimate: all string fields
  const e0 = transformed.estimates[0];
  assert(e0.date === '2025-12-31', `First estimate date correct (got "${e0.date}")`);
  assert(e0.horizon === 'fiscal year', `First estimate horizon correct (got "${e0.horizon}")`);
  assert(e0.eps_estimate_average === '7.05', `First estimate eps_average correct (got "${e0.eps_estimate_average}")`);
  assert(e0.eps_estimate_high === '7.35', `First estimate eps_high correct (got "${e0.eps_estimate_high}")`);
  assert(e0.eps_estimate_low === '6.75', `First estimate eps_low correct (got "${e0.eps_estimate_low}")`);
  assert(e0.eps_estimate_analyst_count === '28', `First estimate eps_analyst_count correct (got "${e0.eps_estimate_analyst_count}")`);
  assert(e0.revenue_estimate_average === '385000000000', `First estimate revenue_average correct (got "${e0.revenue_estimate_average}")`);
  assert(e0.revenue_estimate_analyst_count === '25', `First estimate revenue_analyst_count correct (got "${e0.revenue_estimate_analyst_count}")`);

  // First estimate: non-null revision fields
  assert(e0.eps_estimate_revision_up_trailing_7_days === '2', `First estimate revision_up_7d correct (got "${e0.eps_estimate_revision_up_trailing_7_days}")`);
  assert(e0.eps_estimate_revision_up_trailing_30_days === '5', `First estimate revision_up_30d correct (got "${e0.eps_estimate_revision_up_trailing_30_days}")`);
  assert(e0.eps_estimate_revision_down_trailing_30_days === '1', `First estimate revision_down_30d correct (got "${e0.eps_estimate_revision_down_trailing_30_days}")`);

  // First estimate: null revision field preserved
  assert(e0.eps_estimate_revision_down_trailing_7_days === null, `First estimate revision_down_7d is null (got ${e0.eps_estimate_revision_down_trailing_7_days})`);

  // Second estimate: horizon
  assert(transformed.estimates[1].horizon === 'fiscal quarter', `Second estimate horizon correct (got "${transformed.estimates[1].horizon}")`);

  // Second estimate: all null revision fields preserved as null
  const e1 = transformed.estimates[1];
  assert(e1.eps_estimate_revision_up_trailing_7_days === null, `Second estimate revision_up_7d is null (got ${e1.eps_estimate_revision_up_trailing_7_days})`);
  assert(e1.eps_estimate_revision_down_trailing_7_days === null, `Second estimate revision_down_7d is null (got ${e1.eps_estimate_revision_down_trailing_7_days})`);
  assert(e1.eps_estimate_revision_up_trailing_30_days === null, `Second estimate revision_up_30d is null (got ${e1.eps_estimate_revision_up_trailing_30_days})`);
  assert(e1.eps_estimate_revision_down_trailing_30_days === null, `Second estimate revision_down_30d is null (got ${e1.eps_estimate_revision_down_trailing_30_days})`);

  console.log('\n--- Verifying empty response handling ---\n');

  const emptyResult = handler.testTransformResponse({});
  assert(emptyResult.symbol === '', `Empty response symbol is empty string (got "${emptyResult.symbol}")`);
  assert(emptyResult.estimates.length === 0, `Empty response returns empty estimates (got ${emptyResult.estimates.length})`);

  console.log('\n--- Verifying response with empty estimates array ---\n');

  const emptyArraysResult = handler.testTransformResponse({
    symbol: 'TEST',
    estimates: [],
  });
  assert(emptyArraysResult.symbol === 'TEST', `Empty estimates response symbol preserved (got "${emptyArraysResult.symbol}")`);
  assert(emptyArraysResult.estimates.length === 0, `Empty estimates returns empty array`);

  console.log('\n=== All verification checks passed ===');
}

main();
