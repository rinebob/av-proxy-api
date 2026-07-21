import {
  AvOptionType,
  type AvOptionContract,
} from '@shared/alpha-vantage';
import {
  AlphaVantageProviderResponseError,
  AlphaVantageProviderResponseErrorKind,
  analyzeOptions,
  toAlphaVantageUpstreamError,
} from '../../../../src/v2/alpha-vantage/utils';

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

const contracts: AvOptionContract[] = [
  { expiration: '2026-08-21', strike: '100', type: AvOptionType.CALL, volume: '10', open_interest: '100' },
  { expiration: '2026-08-21', strike: '105', type: AvOptionType.CALL, volume: undefined, open_interest: undefined },
  { expiration: '2026-08-21', strike: '100', type: AvOptionType.PUT, volume: '5', open_interest: '50' },
];

test('counts individual call and put contracts sharing an expiration', () => {
  const analysis = analyzeOptions(contracts);
  assertEqual(analysis.summary.totalContracts, 3, 'total contracts');
  assertEqual(analysis.summary.callContracts, 2, 'call contracts');
  assertEqual(analysis.summary.putContracts, 1, 'put contracts');
});

test('aggregates only available numeric values without excluding contracts', () => {
  const analysis = analyzeOptions(contracts);
  assertEqual(analysis.summary.totalVolume, 15, 'total volume');
  assertEqual(analysis.summary.totalOpenInterest, 150, 'total open interest');
  assertEqual(analysis.summary.avgVolumePerContract, 7.5, 'average volume');
  assertEqual(analysis.summary.avgOpenInterest, 75, 'average open interest');
});

test('counts every returned contract while limiting directional and grouped breakdowns to eligible contracts', () => {
  const analysis = analyzeOptions([
    { expiration: '2026-08-21', strike: '100', type: AvOptionType.CALL, volume: '10', open_interest: '100' },
    { expiration: '2026-08-21', strike: '105', volume: '20', open_interest: '200' },
    { type: AvOptionType.PUT, volume: '30', open_interest: '300' },
  ]);
  assertEqual(analysis.summary.totalContracts, 3, 'total contracts');
  assertEqual(analysis.summary.callContracts, 1, 'call contracts');
  assertEqual(analysis.summary.putContracts, 1, 'put contracts');
  assertEqual(analysis.summary.totalVolume, 60, 'total volume');
  assertEqual(analysis.summary.totalOpenInterest, 600, 'total open interest');
  assertEqual(analysis.summary.uniqueStrikes, 2, 'unique strikes');
  assertEqual(analysis.expirations[0]?.contractCount, 1, 'grouped contracts');
});

test('excludes whitespace-only metrics from aggregate averages', () => {
  const analysis = analyzeOptions([
    { expiration: '2026-08-21', strike: '100', type: AvOptionType.CALL, volume: ' ', open_interest: '' },
    { expiration: '2026-08-21', strike: '105', type: AvOptionType.PUT, volume: '10', open_interest: '20' },
  ]);
  assertEqual(analysis.summary.totalVolume, 10, 'total volume');
  assertEqual(analysis.summary.totalOpenInterest, 20, 'total open interest');
  assertEqual(analysis.summary.avgVolumePerContract, 10, 'average volume');
  assertEqual(analysis.summary.avgOpenInterest, 20, 'average open interest');
});

test('classifies a provider note as a typed rate-limit error', () => {
  const error = toAlphaVantageUpstreamError(new AlphaVantageProviderResponseError(AlphaVantageProviderResponseErrorKind.NOTE, 'rate limit reached'));
  assertEqual(error.category, 'RATE_LIMITED', 'error category');
  assertEqual(error.message, 'rate limit reached', 'provider diagnostic');
});

test('classifies a provider error message as an upstream failure', () => {
  const error = toAlphaVantageUpstreamError(new AlphaVantageProviderResponseError(AlphaVantageProviderResponseErrorKind.ERROR_MESSAGE, 'invalid symbol'));
  assertEqual(error.category, 'UPSTREAM_ERROR', 'error category');
});

process.exitCode = failures === 0 ? 0 : 1;
