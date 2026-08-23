/**
 * Verification script for Task #38 — SavantApiEndpoint enum + TypeScript response types.
 *
 * Confirms that the shared/alpha-vantage package exports the new enum, mapping,
 * and types correctly at runtime. This is a SHARED-area task (types + config),
 * so verification is import + shape checks, not a BE pipeline stage.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-38-sa-endpoint-types.ts
 */
import {
  SavantApiEndpoint,
  SA_ENDPOINT_TO_AV_FUNCTION,
  AlphaVantageEndpoint,
} from '@shared/alpha-vantage';
import type {
  AvEarningsResponse,
  AvEarningsEstimatesResponse,
  AvEarningsCalendarEntry,
} from '@shared/alpha-vantage';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

console.log('--- Verifying SavantApiEndpoint enum ---');

assert(SavantApiEndpoint.SA_EARNINGS === 'SA_EARNINGS', 'SA_EARNINGS enum value');
assert(SavantApiEndpoint.SA_EARNINGS_ESTIMATES === 'SA_EARNINGS_ESTIMATES', 'SA_EARNINGS_ESTIMATES enum value');
assert(SavantApiEndpoint.SA_EARNINGS_CALENDAR === 'SA_EARNINGS_CALENDAR', 'SA_EARNINGS_CALENDAR enum value');
assert(SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL === 'SA_EARNINGS_CALENDAR_GLOBAL', 'SA_EARNINGS_CALENDAR_GLOBAL enum value');

const saValues = Object.values(SavantApiEndpoint);
assert(saValues.length === 4, `exactly 4 SA enum values (got ${saValues.length})`);

console.log('\n--- Verifying SA_ENDPOINT_TO_AV_FUNCTION mapping ---');

assert(
  SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS] === AlphaVantageEndpoint.EARNINGS,
  'SA_EARNINGS maps to EARNINGS',
);
assert(
  SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_ESTIMATES] === AlphaVantageEndpoint.EARNINGS_ESTIMATES,
  'SA_EARNINGS_ESTIMATES maps to EARNINGS_ESTIMATES',
);
assert(
  SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_CALENDAR] === AlphaVantageEndpoint.EARNINGS_CALENDAR,
  'SA_EARNINGS_CALENDAR maps to EARNINGS_CALENDAR',
);
assert(
  SA_ENDPOINT_TO_AV_FUNCTION[SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL] === AlphaVantageEndpoint.EARNINGS_CALENDAR,
  'SA_EARNINGS_CALENDAR_GLOBAL maps to EARNINGS_CALENDAR (same AV function)',
);

console.log('\n--- Verifying TypeScript types compile and accept correct shapes ---');

const earningsResponse: AvEarningsResponse = {
  symbol: 'IBM',
  annualEarnings: [{ fiscalDateEnding: '2024-12-31', reportedEPS: '1.50' }],
  quarterlyEarnings: [{
    fiscalDateEnding: '2024-12-31',
    reportedDate: '2025-01-15',
    reportedEPS: '1.50',
    estimatedEPS: '1.45',
    surprise: '0.05',
    surprisePercentage: '3.45',
    reportTime: 'post-market',
  }],
};
assert(earningsResponse.symbol === 'IBM', 'AvEarningsResponse.symbol');
assert(earningsResponse.annualEarnings.length === 1, 'AvEarningsResponse.annualEarnings length');
assert(earningsResponse.quarterlyEarnings[0].reportTime === 'post-market', 'AvQuarterlyEarning.reportTime');

const estimatesResponse: AvEarningsEstimatesResponse = {
  symbol: 'IBM',
  estimates: [{
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
    eps_estimate_revision_up_trailing_7_days: null,
    eps_estimate_revision_down_trailing_7_days: null,
    eps_estimate_revision_up_trailing_30_days: null,
    eps_estimate_revision_down_trailing_30_days: null,
    revenue_estimate_average: '5000000000',
    revenue_estimate_high: '5200000000',
    revenue_estimate_low: '4800000000',
    revenue_estimate_analyst_count: '4',
  }],
};
assert(estimatesResponse.estimates[0].horizon === 'fiscal quarter', 'AvEarningsEstimate.horizon');
assert(estimatesResponse.estimates[0].eps_estimate_revision_up_trailing_7_days === null, 'AvEarningsEstimate nullable field is null');

const calendarEntry: AvEarningsCalendarEntry = {
  symbol: 'IBM',
  name: 'International Business Machines',
  reportDate: '2025-01-15',
  fiscalDateEnding: '2024-12-31',
  estimate: '',
  currency: 'USD',
  timeOfTheDay: '',
};
assert(calendarEntry.symbol === 'IBM', 'AvEarningsCalendarEntry.symbol');
assert(calendarEntry.estimate === '', 'AvEarningsCalendarEntry.estimate empty string');
assert(calendarEntry.timeOfTheDay === '', 'AvEarningsCalendarEntry.timeOfTheDay empty string');

console.log('\n=== All verification checks passed ===');
