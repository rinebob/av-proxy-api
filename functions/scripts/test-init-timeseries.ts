// Set env vars BEFORE any other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from './scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { initializeTimeSeriesIfMissing } from '../src/v2/alpha-vantage/firestore/av-firestore-helper';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

// Parse CLI args: npx ts-node test-init-timeseries.ts <SYMBOL> <INTERVAL>
const [symbolArg, intervalArg] = process.argv.slice(2);
if (!symbolArg || !intervalArg) {
  console.error('Usage: npx ts-node test-init-timeseries.ts <SYMBOL> <INTERVAL>');
  process.exit(1);
}
const symbol = symbolArg.toUpperCase();
const interval = intervalArg.toLowerCase() as TimeSeriesInterval;

// Map interval to endpoint (adjust as needed for your config)
const endpoint = (() => {
  switch (interval) {
    case 'daily': return AlphaVantageEndpoint.TIME_SERIES_DAILY;
    case 'weekly': return AlphaVantageEndpoint.TIME_SERIES_WEEKLY;
    case 'monthly': return AlphaVantageEndpoint.TIME_SERIES_MONTHLY;
    case 'intraday': return AlphaVantageEndpoint.TIME_SERIES_INTRADAY;
    default: throw new Error(`Unsupported interval: ${interval}`);
  }
})();

(async () => {
  try {
    const result = await initializeTimeSeriesIfMissing(symbol, interval, endpoint);
    console.log(`initializeTimeSeriesIfMissing result for ${symbol} [${interval}]:`, result);
    process.exit(result ? 0 : 2);
  } catch (err) {
    console.error('Error running initializeTimeSeriesIfMissing:', err);
    process.exit(1);
  }
})();
