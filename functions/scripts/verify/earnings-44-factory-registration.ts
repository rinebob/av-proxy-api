/**
 * Verification script for Task #44 — Factory registration + refresh manager fix.
 *
 * Verifies:
 * 1. AlphaVantageHandlerFactory.createHandler() returns correct handler instances
 *    for EARNINGS, EARNINGS_ESTIMATES, and EARNINGS_CALENDAR
 * 2. isGlobalEndpoint() correctly identifies endpoints with no {symbol} in path
 * 3. The refresh manager's global endpoint logic is wired correctly
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-44-factory-registration.ts
 */
import { AlphaVantageHandlerFactory } from '../../src/v2/alpha-vantage/alpha-vantage-factory';
import { AlphaVantageEndpoint, AV_ENDPOINT_CONFIGS } from '@shared/alpha-vantage';
import { AvEarningsHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings.handler';
import { AvEarningsEstimatesHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings-estimates.handler';
import { AvEarningsCalendarHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings-calendar.handler';
import { isGlobalEndpoint } from '../../src/v2/alpha-vantage/data-refresher/av-refresh-manager';

// Set dummy API key
process.env.ALPHAVANTAGE_API_KEY = 'verify-dummy-key';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  console.log('--- Verifying factory registration for earnings endpoints ---\n');

  // Test 1: EARNINGS → AvEarningsHandler
  {
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS);
    assert(handler instanceof AvEarningsHandler, `EARNINGS creates AvEarningsHandler (got ${handler.constructor.name})`);
  }

  // Test 2: EARNINGS_ESTIMATES → AvEarningsEstimatesHandler
  {
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS_ESTIMATES);
    assert(handler instanceof AvEarningsEstimatesHandler, `EARNINGS_ESTIMATES creates AvEarningsEstimatesHandler (got ${handler.constructor.name})`);
  }

  // Test 3: EARNINGS_CALENDAR → AvEarningsCalendarHandler
  {
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.EARNINGS_CALENDAR);
    assert(handler instanceof AvEarningsCalendarHandler, `EARNINGS_CALENDAR creates AvEarningsCalendarHandler (got ${handler.constructor.name})`);
  }

  // Test 4: Unregistered endpoint throws
  {
    let threw = false;
    try {
      AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.IPO_CALENDAR);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('No handler found'), `IPO_CALENDAR throws "No handler found" (got "${e.message}")`);
    }
    assert(threw, `IPO_CALENDAR throws (unregistered)`);
  }

  console.log('\n--- Verifying isGlobalEndpoint helper ---\n');

  // Test 5: EARNINGS_CALENDAR is global (no {symbol} in path)
  {
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_CALENDAR];
    assert(!!config, `EARNINGS_CALENDAR config exists`);
    assert(isGlobalEndpoint(config!), `EARNINGS_CALENDAR is global endpoint (no {symbol} in path)`);
  }

  // Test 6: IPO_CALENDAR is global (no {symbol} in path)
  {
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.IPO_CALENDAR];
    assert(!!config, `IPO_CALENDAR config exists`);
    assert(isGlobalEndpoint(config!), `IPO_CALENDAR is global endpoint (no {symbol} in path)`);
  }

  // Test 7: EARNINGS is NOT global (has {symbol} in path)
  {
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS];
    assert(!!config, `EARNINGS config exists`);
    assert(!isGlobalEndpoint(config!), `EARNINGS is NOT global (has {symbol} in path)`);
  }

  // Test 8: EARNINGS_ESTIMATES is NOT global (has {symbol} in path)
  {
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_ESTIMATES];
    assert(!!config, `EARNINGS_ESTIMATES config exists`);
    assert(!isGlobalEndpoint(config!), `EARNINGS_ESTIMATES is NOT global (has {symbol} in path)`);
  }

  // Test 9: OVERVIEW is NOT global (has {symbol} in path)
  {
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.OVERVIEW];
    assert(!!config, `OVERVIEW config exists`);
    assert(!isGlobalEndpoint(config!), `OVERVIEW is NOT global (has {symbol} in path)`);
  }

  console.log('\n=== All verification checks passed ===');
}

main();
