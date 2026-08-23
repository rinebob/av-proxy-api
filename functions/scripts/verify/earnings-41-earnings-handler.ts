/**
 * Verification script for Task #41 — AvEarningsHandler.
 *
 * Verifies that AvEarningsHandler.transformResponse correctly transforms a
 * real Alpha Vantage EARNINGS JSON response (NVDA) into the typed
 * AvEarningsResponse. The response was captured from a live AV API call.
 *
 * Pipeline stages verified:
 * - Transform: real AV JSON → typed AvEarningsResponse
 * - reportTime preservation (pre-market / post-market)
 * - "None" string value handling (estimatedEPS, surprisePercentage)
 * - Empty response handling
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-41-earnings-handler.ts
 */
import { AvEarningsHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings.handler';
import type { AvEarningsResponse } from '@shared/alpha-vantage';
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
class TestableAvEarningsHandler extends AvEarningsHandler {
  public testTransformResponse(data: any): AvEarningsResponse {
    return this.transformResponse(data);
  }
}

// Real AV EARNINGS response for NVDA (captured from live API call, truncated to first 5 annual + 5 quarterly + 1 with "None" values)
const realAvEarningsResponse = {
  symbol: 'NVDA',
  annualEarnings: [
    { fiscalDateEnding: '2026-07-31', reportedEPS: '1.87' },
    { fiscalDateEnding: '2026-01-31', reportedEPS: '4.78' },
    { fiscalDateEnding: '2025-01-31', reportedEPS: '2.992' },
    { fiscalDateEnding: '2024-01-31', reportedEPS: '1.297' },
    { fiscalDateEnding: '2023-01-31', reportedEPS: '0.333' },
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

function main(): void {
  console.log('--- Verifying AvEarningsHandler.transformResponse against real AV NVDA response ---\n');

  const mockConfig: EndpointConfig = {
    id: 'EARNINGS' as any,
    name: 'Earnings',
    ttl: 7 * 24 * 60 * 60,
    firestorePath: 'market-data/{symbol}/data-points/EARNINGS',
    symbolUsage: 'REQUIRED' as any,
    category: 'FUNDAMENTAL' as any,
  } as EndpointConfig;

  const handler = new TestableAvEarningsHandler(mockConfig);
  const transformed = handler.testTransformResponse(realAvEarningsResponse);

  // Transform stage: symbol extraction
  assert(transformed.symbol === 'NVDA', `Symbol extracted correctly (got "${transformed.symbol}")`);

  // Transform stage: annualEarnings
  assert(
    Array.isArray(transformed.annualEarnings) && transformed.annualEarnings.length === 5,
    `annualEarnings has 5 entries (got ${transformed.annualEarnings.length})`,
  );

  const firstAnnual = transformed.annualEarnings[0];
  assert(firstAnnual.fiscalDateEnding === '2026-07-31', `First annual fiscalDateEnding correct (got "${firstAnnual.fiscalDateEnding}")`);
  assert(firstAnnual.reportedEPS === '1.87', `First annual reportedEPS correct (got "${firstAnnual.reportedEPS}")`);

  // Transform stage: quarterlyEarnings
  assert(
    Array.isArray(transformed.quarterlyEarnings) && transformed.quarterlyEarnings.length === 4,
    `quarterlyEarnings has 4 entries (got ${transformed.quarterlyEarnings.length})`,
  );

  const firstQ = transformed.quarterlyEarnings[0];
  assert(firstQ.fiscalDateEnding === '2026-04-30', `First quarterly fiscalDateEnding correct (got "${firstQ.fiscalDateEnding}")`);
  assert(firstQ.reportedDate === '2026-05-20', `First quarterly reportedDate correct (got "${firstQ.reportedDate}")`);
  assert(firstQ.reportedEPS === '1.87', `First quarterly reportedEPS correct (got "${firstQ.reportedEPS}")`);
  assert(firstQ.estimatedEPS === '1.77', `First quarterly estimatedEPS correct (got "${firstQ.estimatedEPS}")`);
  assert(firstQ.surprise === '0.1', `First quarterly surprise correct (got "${firstQ.surprise}")`);
  assert(firstQ.surprisePercentage === '5.6497', `First quarterly surprisePercentage correct (got "${firstQ.surprisePercentage}")`);

  // reportTime preservation
  assert(firstQ.reportTime === 'post-market', `First quarterly reportTime preserved (got "${firstQ.reportTime}")`);
  assert(
    transformed.quarterlyEarnings[2].reportTime === 'pre-market',
    `Third quarterly reportTime preserved (got "${transformed.quarterlyEarnings[2].reportTime}")`,
  );

  // "None" string value handling (real AV edge case)
  const noneQ = transformed.quarterlyEarnings[3];
  assert(noneQ.estimatedEPS === 'None', `Quarterly with "None" estimatedEPS preserved (got "${noneQ.estimatedEPS}")`);
  assert(noneQ.surprisePercentage === 'None', `Quarterly with "None" surprisePercentage preserved (got "${noneQ.surprisePercentage}")`);

  console.log('\n--- Verifying empty response handling ---\n');

  const emptyResult = handler.testTransformResponse({});
  assert(emptyResult.symbol === '', `Empty response symbol is empty string (got "${emptyResult.symbol}")`);
  assert(emptyResult.annualEarnings.length === 0, `Empty response returns empty annualEarnings (got ${emptyResult.annualEarnings.length})`);
  assert(emptyResult.quarterlyEarnings.length === 0, `Empty response returns empty quarterlyEarnings (got ${emptyResult.quarterlyEarnings.length})`);

  console.log('\n--- Verifying response with empty arrays ---\n');

  const emptyArraysResult = handler.testTransformResponse({
    symbol: 'TEST',
    annualEarnings: [],
    quarterlyEarnings: [],
  });
  assert(emptyArraysResult.symbol === 'TEST', `Empty arrays response symbol preserved (got "${emptyArraysResult.symbol}")`);
  assert(emptyArraysResult.annualEarnings.length === 0, `Empty arrays returns empty annualEarnings`);
  assert(emptyArraysResult.quarterlyEarnings.length === 0, `Empty arrays returns empty quarterlyEarnings`);

  console.log('\n=== All verification checks passed ===');
}

main();
