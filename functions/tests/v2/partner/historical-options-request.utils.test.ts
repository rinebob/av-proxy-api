import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../../../src/v2/alpha-vantage/utils';
import {
  HistoricalOptionsErrorCode,
  mapHistoricalOptionsProviderError,
  parseHistoricalOptionsRequest,
} from '../../../src/v2/partner/historical-options-request.utils';

let failures = 0;

function test(name: string, execute: () => void): void {
  try {
    execute();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

test('normalizes a valid symbol and date', () => {
  const result = parseHistoricalOptionsRequest(' aapl ', '2026-07-17');
  assertEqual(result?.symbol, 'AAPL', 'symbol');
  assertEqual(result?.date, '2026-07-17', 'date');
});

test('accepts a valid symbol with no date', () => {
  const result = parseHistoricalOptionsRequest('BRK.B', undefined);
  assertEqual(result?.symbol, 'BRK.B', 'symbol');
  assertEqual(result?.date, undefined, 'date');
});

test('rejects malformed dates and symbols', () => {
  assertEqual(parseHistoricalOptionsRequest('AAPL', '2026-02-30'), null, 'invalid calendar date');
  assertEqual(parseHistoricalOptionsRequest('AAPL?', undefined), null, 'invalid symbol');
});

test('maps typed provider rate-limit failures', () => {
  const result = mapHistoricalOptionsProviderError(new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED));
  assertEqual(result.status, 429, 'status');
  assertEqual(result.code, HistoricalOptionsErrorCode.RATE_LIMITED, 'code');
});

test('maps typed provider timeout failures', () => {
  const result = mapHistoricalOptionsProviderError(new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT));
  assertEqual(result.status, 504, 'status');
  assertEqual(result.code, HistoricalOptionsErrorCode.UPSTREAM_TIMEOUT, 'code');
});

process.exitCode = failures === 0 ? 0 : 1;
