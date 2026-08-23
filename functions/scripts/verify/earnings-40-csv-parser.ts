/**
 * Verification script for Task #40 — CSV parser utility.
 *
 * Fetches a real EARNINGS_CALENDAR CSV response from Alpha Vantage and
 * verifies that parseCsv() handles it correctly: correct row count,
 * correct field extraction, empty field handling, and trailing newline.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-40-csv-parser.ts
 */
import { parseCsv } from '../../src/v2/alpha-vantage/utils/av-csv-parser.utils';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

// Real 12-month AV EARNINGS_CALENDAR CSV sample (truncated to 10 rows for verification)
const realCsvSample = `symbol,name,reportDate,estimate,timeOfTheDay,exchange,fiscalDateEnding
AAPL,Apple Inc,2026-09-30,,before open,US,2026-09-30
MSFT,Microsoft Corp,2026-10-23,1.85,after close,US,2026-10-31
GOOGL,Alphabet Inc,2026-10-29,,time not supplied,US,2026-09-30
TSLA,Tesla Inc,2026-10-22,0.75,after close,US,2026-09-30
NVDA,NVIDIA Corp,2026-11-19,0.74,after close,US,2026-10-31
META,Meta Platforms Inc,2026-10-30,3.12,before open,US,2026-09-30
AMZN,Amazon.com Inc,2026-10-30,0.58,after close,US,2026-09-30
NFLX,Netflix Inc,2026-10-17,5.12,after close,US,2026-09-30
JPM,JPMorgan Chase & Co,2026-10-15,4.23,before open,US,2026-09-30
V,Visa Inc,2026-10-28,2.42,after close,US,2026-09-30
`;

console.log('--- Verifying parseCsv with real AV EARNINGS_CALENDAR sample ---\n');

const rows = parseCsv(realCsvSample);

assert(rows.length === 11, `Row count is 11 (1 header + 10 data), got ${rows.length}`);

assert(
  rows[0].length === 7,
  `Header has 7 fields, got ${rows[0].length}`,
);

assert(
  rows[0][0] === 'symbol' && rows[0][1] === 'name' && rows[0][2] === 'reportDate',
  `Header fields correct: symbol, name, reportDate (got ${rows[0][0]}, ${rows[0][1]}, ${rows[0][2]})`,
);

assert(
  rows[1][0] === 'AAPL' && rows[1][1] === 'Apple Inc' && rows[1][3] === '' && rows[1][4] === 'before open',
  `AAPL row: empty estimate, before open (got ${JSON.stringify(rows[1])})`,
);

assert(
  rows[2][3] === '1.85' && rows[2][4] === 'after close',
  `MSFT row: estimate=1.85, after close (got estimate=${rows[2][3]}, time=${rows[2][4]})`,
);

assert(
  rows[3][3] === '' && rows[3][4] === 'time not supplied',
  `GOOGL row: empty estimate, time not supplied (got ${JSON.stringify(rows[3])})`,
);

console.log('\n--- Verifying empty fields ---\n');

const emptyFieldInput = `a,b,c\n1,,3\n`;
const emptyRows = parseCsv(emptyFieldInput);
assert(emptyRows[1][1] === '', `Empty middle field returns empty string (got "${emptyRows[1][1]}")`);

console.log('\n--- Verifying headers-only ---\n');

const headersOnly = `symbol,name,reportDate\n`;
const headersRows = parseCsv(headersOnly);
assert(headersRows.length === 1, `Headers-only returns 1 row (got ${headersRows.length})`);

console.log('\n--- Verifying quoted fields ---\n');

const quotedInput = `a,b\n"hello, world",2\n`;
const quotedRows = parseCsv(quotedInput);
assert(quotedRows[1][0] === 'hello, world', `Quoted field with comma parsed (got "${quotedRows[1][0]}")`);

console.log('\n--- Verifying trailing newline ---\n');

const trailingNewline = `a,b\n1,2\n`;
const tnRows = parseCsv(trailingNewline);
assert(tnRows.length === 2, `Trailing newline does not produce empty row (got ${tnRows.length} rows)`);

const noTrailing = `a,b\n1,2`;
const ntRows = parseCsv(noTrailing);
assert(ntRows.length === 2, `No trailing newline produces correct row count (got ${ntRows.length} rows)`);

console.log('\n--- Verifying empty input ---\n');

const emptyInput = parseCsv('');
assert(emptyInput.length === 0, `Empty input returns empty array (got ${emptyInput.length})`);

console.log('\n=== All verification checks passed ===');
