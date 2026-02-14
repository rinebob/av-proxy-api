import * as dotenv from 'dotenv';
import * as path from 'path';
import { AlphaVantageEndpoint, type CompactBar } from '@shared/alpha-vantage';
import axios from 'axios';

// Load local env if present
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

// Parse CLI args
const argv = process.argv.slice(2);
const argMap = new Map<string, string | boolean>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.split('=');
    if (typeof v === 'string') argMap.set(k, v);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) argMap.set(k, argv[++i]);
    else argMap.set(k, true);
  }
}

const SYMBOL = String(argMap.get('--symbol') ?? '').toUpperCase();
const DATE = String(argMap.get('--date') ?? ''); // YYYY-MM-DD (UTC trading date)
if (!SYMBOL || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('Usage: node -r module-alias/register lib/scripts/finalize-one-daily-bar.js --symbol=SYM --date=YYYY-MM-DD [--emulator=false] [--dry-run]');
  process.exit(1);
}

const EMULATOR_RAW = argMap.get('--emulator');
const USE_EMULATOR = EMULATOR_RAW === undefined ? true : !(String(EMULATOR_RAW).toLowerCase() === 'false' || String(EMULATOR_RAW) === '0');
const DRY_RUN = Boolean(argMap.get('--dry-run'));

// Configure environment BEFORE admin init
if (USE_EMULATOR) {
  if (!process.env['FIRESTORE_EMULATOR_HOST']) process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080';
  if (!process.env['FIREBASE_AUTH_EMULATOR_HOST']) process.env['FIREBASE_AUTH_EMULATOR_HOST'] = '127.0.0.1:9099';
  if (!process.env['GOOGLE_CLOUD_PROJECT']) process.env['GOOGLE_CLOUD_PROJECT'] = 'alpha-vantage-proxy-api';
  if (!process.env['GCLOUD_PROJECT']) process.env['GCLOUD_PROJECT'] = 'alpha-vantage-proxy-api';
  console.log('finalize-one: Using Firebase Emulators');
} else {
  delete (process.env as any)['FIREBASE_AUTH_EMULATOR_HOST'];
  delete (process.env as any)['FIRESTORE_EMULATOR_HOST'];
  console.log('finalize-one: Using PROD Firestore');
}

// Late import admin + helper to respect env
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../src/firebase-admin-init');

// Import write helper after admin is ready
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { upsertAvDailyBar } = require('../src/v2/alpha-vantage/firestore/av-firestore-helper');

function toPatch(entry: any): Partial<CompactBar> {
  const o = Number(entry['1. open'] ?? entry.open);
  const h = Number(entry['2. high'] ?? entry.high);
  const l = Number(entry['3. low'] ?? entry.low);
  const c = Number(entry['4. close'] ?? entry.close);
  const v = Number(entry['6. volume'] ?? entry.volume);
  const ac = entry['5. adjusted close'] != null ? Number(entry['5. adjusted close']) : (entry.adjustedClose != null ? Number(entry.adjustedClose) : undefined);
  const dv = entry['7. dividend amount'] != null ? Number(entry['7. dividend amount']) : (entry.dividendAmount != null ? Number(entry.dividendAmount) : undefined);
  const sc = entry['8. split coefficient'] != null ? Number(entry['8. split coefficient']) : (entry.splitCoefficient != null ? Number(entry.splitCoefficient) : undefined);
  const patch: Partial<CompactBar> = { o, h, l, c, v, ac, dv, sc };
  return patch;
}

async function run(): Promise<void> {
  console.log(`=== Finalize one daily bar ===\nSymbol=${SYMBOL} Date=${DATE} Emulator=${USE_EMULATOR} DryRun=${DRY_RUN}`);
  const apiKey = process.env.ALPHAVANTAGE_API_KEY || process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing AV API key. Set ALPHAVANTAGE_API_KEY (or LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY for emulator).');
  }

  // Fetch TIME_SERIES_DAILY_ADJUSTED full and pick exact date
  const url = 'https://www.alphavantage.co/query';
  const params = {
    function: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED as any,
    symbol: SYMBOL,
    outputsize: 'compact',
    datatype: 'json',
    apikey: apiKey,
  };
  const { data } = await axios.get(url, { params, timeout: 30_000 });
  const ts = data?.['Time Series (Daily)'] || data?.['Time Series Daily'];
  if (!ts || !ts[DATE]) {
    throw new Error(`AV response missing daily entry for ${DATE}.`);
  }
  const entry = ts[DATE];
  const patch = toPatch(entry);

  if (DRY_RUN) {
    console.log('[DRY-RUN] Would upsertAvDailyBar with patch:', { symbol: SYMBOL, date: DATE, patch });
    return;
  }

  await upsertAvDailyBar({ symbol: SYMBOL, date: DATE, patch, endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, skipParentMetaBump: false });
  console.log(`[WRITE] Finalized ${SYMBOL} ${DATE} with OHLCV/AC/DV/SC; cp/ch recomputed vs prior ac`);
}

run().catch((e) => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});
