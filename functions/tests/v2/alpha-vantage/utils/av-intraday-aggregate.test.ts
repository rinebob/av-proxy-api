import { aggregateIntradayRthBar, extractIntradaySeries, IntradayRthBarAggregate } from '../../../../src/v2/alpha-vantage/utils/av-intraday-aggregate.utils';

let passCount = 0;
let failCount = 0;

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, epsilon = 0.0001, message?: string): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message ?? 'close mismatch'}: expected ${expected}, got ${actual}`);
  }
}

function assertBar(
  bar: IntradayRthBarAggregate,
  expected: { o: number; h: number; l: number; c: number; v: number },
  message: string,
): void {
  assertClose(bar.o, expected.o, 0.0001, `${message}: o`);
  assertClose(bar.h, expected.h, 0.0001, `${message}: h`);
  assertClose(bar.l, expected.l, 0.0001, `${message}: l`);
  assertClose(bar.c, expected.c, 0.0001, `${message}: c`);
  assertClose(bar.v, expected.v, 0.0001, `${message}: v`);
}

function buildAvResponse(
  interval: string,
  bars: Array<[string, number, number, number, number, number]>,
): Record<string, unknown> {
  const series: Record<string, unknown> = {};
  for (const [ts, o, h, l, c, v] of bars) {
    series[ts] = {
      '1. open': String(o),
      '2. high': String(h),
      '3. low': String(l),
      '4. close': String(c),
      '5. volume': String(v),
    };
  }
  return {
    'Meta Data': {
      '4. Interval': interval,
    },
    [`Time Series (${interval})`]: series,
  };
}

function buildAvResponseWithRawKeys(
  interval: string,
  bars: Array<[string, number, number, number, number, number]>,
): Record<string, unknown> {
  const series: Record<string, unknown> = {};
  for (const [ts, o, h, l, c, v] of bars) {
    series[ts] = { open: o, high: h, low: l, close: c, volume: v };
  }
  return {
    'Meta Data': {
      '4. Interval': interval,
    },
    [`Time Series (${interval})`]: series,
  };
}

function runCase(name: string, fn: () => void): void {
  try {
    fn();
    passCount++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failCount++;
    console.error(`FAIL ${name}: ${(e as Error).message}`);
  }
}

runCase('aggregates 15-minute RTH bars from 09:30 ET', () => {
  const marketDate = '2025-11-10';
  const raw = buildAvResponse('15min', [
    ['2025-11-10 09:45:00', 100.0, 102.0, 99.5, 101.0, 1000],
    ['2025-11-10 10:00:00', 101.0, 103.5, 100.5, 102.5, 1500],
    ['2025-11-10 10:15:00', 102.5, 104.0, 101.0, 103.0, 2000],
  ]);
  const bar = aggregateIntradayRthBar(raw, marketDate);
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 100.0, h: 104.0, l: 99.5, c: 103.0, v: 4500 }, 'RTH aggregation');
  assertEqual(bar.it, '10:15', 'latest ET time');
});

runCase('returns null for an empty series', () => {
  const raw = buildAvResponse('15min', []);
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  assertEqual(bar, null as any, 'empty series');
});

runCase('ignores bars from a different ET date', () => {
  const raw = buildAvResponse('15min', [
    ['2025-11-09 10:00:00', 100, 101, 99, 100.5, 1000],
    ['2025-11-10 09:45:00', 110, 111, 109, 110.5, 2000],
  ]);
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 110, h: 111, l: 109, c: 110.5, v: 2000 }, 'different-date filter');
});

runCase('ignores bars before the 09:30 ET anchor', () => {
  const raw = buildAvResponse('15min', [
    ['2025-11-10 09:15:00', 90, 95, 89, 94, 1000],
    ['2025-11-10 09:30:00', 100, 101, 99, 100.5, 2000],
  ]);
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 100, h: 101, l: 99, c: 100.5, v: 2000 }, 'pre-anchor filter');
});

runCase('supports raw numeric keys without AV prefixes', () => {
  const raw = buildAvResponseWithRawKeys('15min', [
    ['2025-11-10 09:45:00', 50, 55, 48, 52, 3000],
  ]);
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 50, h: 55, l: 48, c: 52, v: 3000 }, 'raw keys');
});

runCase('skips bars with missing OHLCV fields', () => {
  const raw = buildAvResponse('15min', [
    ['2025-11-10 09:45:00', 100, 101, 99, 100.5, 1000],
  ]);
  // Remove a required field from the only bar
  (raw['Time Series (15min)'] as Record<string, unknown>)['2025-11-10 09:45:00'] = { '1. open': '100' };
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  assertEqual(bar, null as any, 'incomplete bar');
});

runCase('extracts series from metadata interval key', () => {
  const raw = buildAvResponse('5min', [['2025-11-10 09:30:00', 100, 101, 99, 100, 1000]]);
  const series = extractIntradaySeries(raw);
  assertEqual(Object.keys(series ?? {}).length, 1, 'series extraction');
});

runCase('falls back to a generic time-series key when metadata is absent', () => {
  const raw = {
    'Time Series (15min)': {
      '2025-11-10 09:45:00': { '1. open': '10', '2. high': '11', '3. low': '9', '4. close': '10.5', '5. volume': '100' },
    },
  };
  const series = extractIntradaySeries(raw);
  assertEqual(Object.keys(series ?? {}).length, 1, 'fallback series extraction');
  const bar = aggregateIntradayRthBar(raw, '2025-11-10');
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 10, h: 11, l: 9, c: 10.5, v: 100 }, 'fallback aggregation');
});

runCase('custom anchor time filters to the specified open', () => {
  const raw = buildAvResponse('15min', [
    ['2025-11-10 10:00:00', 100, 101, 99, 100.5, 1000],
  ]);
  const bar = aggregateIntradayRthBar(raw, '2025-11-10', '10:00:00');
  if (!bar) throw new Error('expected bar');
  assertBar(bar, { o: 100, h: 101, l: 99, c: 100.5, v: 1000 }, 'custom anchor');
});

console.log(`\nResults: ${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
