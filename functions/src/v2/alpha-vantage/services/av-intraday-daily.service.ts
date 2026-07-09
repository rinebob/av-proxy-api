import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS } from '@shared/alpha-vantage';

import { AvIntradayHandler } from '../handlers/av-intraday.handler';
import { aggregateIntradayRthBar, type IntradayRthBarAggregate } from '../utils';
import { upsertAvDailyIntradayBar } from '../firestore';

/**
 * Fetch 15-minute RTH intraday data for a symbol, aggregate it into a single
 * daily OHLCV bar anchored at 09:30 ET, and write the result (plus the legacy
 * `i*` snapshot fields) into the DAILY_ADJUSTED year-shard.
 *
 * This is the single canonical path for daily intraday updates, used by both
 * the scheduled intraday worker and the DAILY PRE-CLOSE handler. Directly
 * instantiating {@link AvIntradayHandler} avoids a circular dependency with
 * {@link AlphaVantageHandlerFactory}.
 *
 * @returns The aggregated bar, or `null` if no qualifying RTH bars were found.
 */
export async function fetchAndStoreDailyIntradayBar(options: {
  symbol: string;
  marketDate: string;
  clockPt?: string;
}): Promise<IntradayRthBarAggregate | null> {
  const { symbol, marketDate, clockPt } = options;

  const intradayConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[AlphaVantageEndpoint.TIME_SERIES_INTRADAY];
  if (!intradayConfig) {
    throw new Error('Missing configuration for TIME_SERIES_INTRADAY');
  }

  const intradayHandler = new AvIntradayHandler(intradayConfig);
  const resp = await intradayHandler.fetch({
    symbol,
    interval: '15min',
    outputsize: 'compact',
    extended_hours: false,
  });

  const bar = aggregateIntradayRthBar(resp?.data, marketDate);
  if (!bar) {
    return null;
  }

  await upsertAvDailyIntradayBar({
    symbol,
    date: marketDate,
    bar,
    clockPt,
  });

  return bar;
}
