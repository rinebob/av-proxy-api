/**
 * Verification script for Task #43 — AvEarningsCalendarHandler.
 *
 * Verifies that AvEarningsCalendarHandler.fetch correctly:
 * - Calls AV with function=EARNINGS_CALENDAR, horizon=12month, no symbol
 * - Parses the CSV response using parseCsv()
 * - Filters entries to tracked symbols
 * - Calls saveAvData with the filtered result (not the full response)
 * - Handles empty CSV (headers only) — stores empty array, does not skip write
 * - Handles all entries filtered out — stores empty array, does not skip write
 * - transformResponse throws (deprecated)
 *
 * Uses mocked axios, saveAvData, and Firestore via module patching since we
 * can't call the real AV API or Firestore locally.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-43-earnings-calendar-handler.ts
 */
import { AvEarningsCalendarHandler } from '../../src/v2/alpha-vantage/handlers/av-earnings-calendar.handler';
import type { AvEarningsCalendarEntry } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';

// Set dummy API key — we're mocking the API call, not making real ones
process.env.ALPHAVANTAGE_API_KEY = 'verify-dummy-key';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

// Patch saveAvData before importing the handler
let savedData: any = null;
let savedSymbol: string = '';
let savedEndpoint: any = null;

const writerModule = require('../../src/v2/alpha-vantage/firestore/av-standard-data.writer');
writerModule.saveAvData = async (data: any, symbol: string, endpoint: any) => {
  savedData = data;
  savedSymbol = symbol;
  savedEndpoint = endpoint;
};

// Patch Firestore db
let mockTrackedSymbols: string[] = [];
const dbModule = require('../../src/firebase-admin-init');
dbModule.db = {
  collection: () => ({
    listDocuments: async () => mockTrackedSymbols.map(s => ({ id: s })),
  }),
};

// Realistic AV EARNINGS_CALENDAR CSV response (matches actual AV CSV shape — uses 'exchange' not 'currency')
const realisticCsvResponse = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding
AAPL,Apple Inc,2025-11-01,1.80,after close,US,2025-09-30
MSFT,Microsoft Corp,2025-10-29,1.50,before open,US,2025-09-30
NVDA,NVIDIA Corp,2025-11-19,1.30,post-market,US,2025-10-31
GOOGL,Alphabet Inc,2025-10-29,1.20,after close,US,2025-09-30
TSLA,Tesla Inc,2025-10-22,0.75,after close,US,2025-09-30
`;

function createHandler(): AvEarningsCalendarHandler {
  const mockConfig: EndpointConfig = {
    id: 'EARNINGS_CALENDAR' as any,
    name: 'Earnings Calendar',
    ttl: 24 * 60 * 60,
    firestorePath: 'market-data/av-earnings-calendar',
    symbolUsage: 'OPTIONAL' as any,
    category: 'FUNDAMENTAL' as any,
    parameters: {
      horizon: { type: 'string', required: false, default: '12month', enum: ['3month', '6month', '12month'] },
    },
  } as any;
  return new AvEarningsCalendarHandler(mockConfig);
}

async function main(): Promise<void> {
  console.log('--- Verifying AvEarningsCalendarHandler.fetch against realistic CSV response ---\n');

  // Test 1: Parse and filter
  console.log('--- Test 1: Parse CSV and filter to tracked symbols ---\n');
  {
    savedData = null; savedSymbol = ''; savedEndpoint = null;
    mockTrackedSymbols = ['AAPL', 'NVDA'];
    const handler = createHandler();
    let capturedParams: any = null;
    (handler as any).apiClient.get = async (_url: string, config: any) => {
      capturedParams = config.params;
      return { data: realisticCsvResponse };
    };

    const result = await handler.fetch({});

    assert(result.data.length === 2, `Filtered to 2 entries (got ${result.data.length})`);
    assert(result.data[0].symbol === 'AAPL', `First entry is AAPL (got "${result.data[0].symbol}")`);
    assert(result.data[1].symbol === 'NVDA', `Second entry is NVDA (got "${result.data[1].symbol}")`);

    // All fields mapped correctly
    const entry = result.data[0] as AvEarningsCalendarEntry;
    assert(entry.name === 'Apple Inc', `Name correct (got "${entry.name}")`);
    assert(entry.reportDate === '2025-11-01', `reportDate correct (got "${entry.reportDate}")`);
    assert(entry.fiscalDateEnding === '2025-09-30', `fiscalDateEnding correct (got "${entry.fiscalDateEnding}")`);
    assert(entry.estimate === '1.80', `estimate correct (got "${entry.estimate}")`);
    assert(entry.currency === 'US', `currency correct (got "${entry.currency}")`); // AV returns 'exchange' field, handler maps to 'currency'
    assert(entry.timeOfTheDay === 'after close', `timeOfTheDay correct (got "${entry.timeOfTheDay}")`);

    // saveAvData called with filtered entries
    assert(Array.isArray(savedData) && savedData.length === 2, `saveAvData called with 2 entries (got ${savedData?.length})`);
    assert(savedSymbol === '', `saveAvData called with empty symbol (got "${savedSymbol}")`);
    assert(savedEndpoint === 'EARNINGS_CALENDAR', `saveAvData called with correct endpoint (got "${savedEndpoint}")`);

    // AV called with correct params
    assert(capturedParams.function === 'EARNINGS_CALENDAR', `AV called with function=EARNINGS_CALENDAR (got "${capturedParams.function}")`);
    assert(capturedParams.horizon === '12month', `AV called with horizon=12month (got "${capturedParams.horizon}")`);
    assert(capturedParams.symbol === undefined, `AV called with no symbol (got "${capturedParams.symbol}")`);
  }

  console.log('\n--- Test 2: Empty CSV (headers only) ---\n');
  {
    savedData = null; savedSymbol = ''; savedEndpoint = null;
    mockTrackedSymbols = ['AAPL'];
    const handler = createHandler();
    const headersOnly = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\n';
    (handler as any).apiClient.get = async () => ({ data: headersOnly });

    const result = await handler.fetch({});

    assert(result.data.length === 0, `Empty CSV returns 0 entries (got ${result.data.length})`);
    assert(Array.isArray(savedData) && savedData.length === 0, `saveAvData called with empty array (got ${savedData?.length})`);
  }

  console.log('\n--- Test 3: All entries filtered out (no tracked symbols match) ---\n');
  {
    savedData = null; savedSymbol = ''; savedEndpoint = null;
    mockTrackedSymbols = ['UNKNOWN'];
    const handler = createHandler();
    (handler as any).apiClient.get = async () => ({ data: realisticCsvResponse });

    const result = await handler.fetch({});

    assert(result.data.length === 0, `No matches returns 0 entries (got ${result.data.length})`);
    assert(Array.isArray(savedData) && savedData.length === 0, `saveAvData called with empty array (got ${savedData?.length})`);
  }

  console.log('\n--- Test 4: transformResponse throws (deprecated) ---\n');
  {
    const handler = createHandler();
    let threw = false;
    try {
      (handler as any).transformResponse({});
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('deprecated'), `Error message includes "deprecated" (got "${e.message}")`);
    }
    assert(threw, `transformResponse throws`);
  }

  console.log('\n=== All verification checks passed ===');
}

main();
