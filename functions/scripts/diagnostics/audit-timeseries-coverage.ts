/**
 * Audit script: Generate a CSV coverage report for all historical options
 * time-series files in the GCS bucket.
 *
 * For each .jsonl file, reads GCS custom metadata only (no content download)
 * and emits a CSV row with contract ID, expiration, strike, type, first/last
 * observed dates, observation count, coverage days, and data span days.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/audit-timeseries-coverage.ts
 *
 * Optional environment variables:
 *   SYMBOLS=QQQ,TQQQ         // comma-separated list (default: QQQ,TQQQ)
 *   MAX_FILES=100            // limit GCS listing to N files (for testing)
 *   OPTIONS_TIME_SERIES_BUCKET=... // override bucket name
 *   CONCURRENCY=50           // concurrent getMetadata() calls (default: 50)
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { admin } from '../../src/firebase-admin-init';
import { parseContractIDMetadata } from '../../src/v2/historical-options-corpus/services/contract-metadata.utils';
import { TIME_SERIES_PREFIX } from '../../src/v2/historical-options-corpus/types';

const DEFAULT_SYMBOLS = ['QQQ', 'TQQQ'];
const PAGE_SIZE = 1000;
const DEFAULT_CONCURRENCY = 50;
const OUTPUT_DIR = path.resolve(__dirname, 'output');

interface ContractRow {
  contractId: string;
  expiration: string;
  strike: string;
  type: string;
  firstObserved: string;
  lastObserved: string;
  observationCount: string;
  coverageDays: string;
  dataSpanDays: string;
}

interface SummaryStats {
  total: number;
  withMetadata: number;
  missingMetadata: number;
  lowObs: number;
  minObs: number;
  maxObs: number;
  sumObs: number;
}

const CSV_HEADER = [
  'contractId',
  'expiration',
  'strike',
  'type',
  'firstObserved',
  'lastObserved',
  'observationCount',
  'coverageDays',
  'dataSpanDays',
].join(',');

function rowToCsvLine(row: ContractRow): string {
  return [
    row.contractId,
    row.expiration,
    row.strike,
    row.type,
    row.firstObserved,
    row.lastObserved,
    row.observationCount,
    row.coverageDays,
    row.dataSpanDays,
  ].join(',');
}

function createCsvStream(filepath: string): fs.WriteStream {
  const stream = fs.createWriteStream(filepath, { encoding: 'utf8' });
  stream.write(CSV_HEADER + '\n');
  return stream;
}

/**
 * Lists one page of contract IDs from the time-series bucket.
 * Returns the contract IDs, the next page token, and whether the
 * maxFiles limit was reached.
 */
async function listContractPage(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  prefix: string,
  pageToken: string | undefined,
  maxFiles: number | undefined,
  totalSoFar: number,
): Promise<{ contractIds: string[]; nextPageToken?: string; limitReached: boolean }> {
  const [files, , apiResponse] = await bucket.getFiles({
    prefix,
    maxResults: PAGE_SIZE,
    pageToken,
  });

  const contractIds: string[] = [];
  let limitReached = false;

  for (const file of files) {
    const relativePath = file.name.slice(prefix.length);
    if (!relativePath.endsWith('.jsonl')) continue;

    const contractId = relativePath.replace(/\.jsonl$/, '');
    if (contractId) {
      contractIds.push(contractId);

      if (maxFiles && totalSoFar + contractIds.length >= maxFiles) {
        limitReached = true;
        break;
      }
    }
  }

  const nextPageToken = (apiResponse as any)?.nextPageToken;
  return {
    contractIds,
    nextPageToken: limitReached ? undefined : nextPageToken,
    limitReached,
  };
}

/**
 * Computes calendar days between two ISO dates (inclusive).
 * Returns empty string if either date is empty/invalid.
 */
function calendarDaysInclusive(start: string, end: string): string {
  if (!start || !end) return '';
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '';
  return String(Math.round((endMs - startMs) / 86_400_000) + 1);
}

/**
 * Fetches GCS metadata for a single contract file and returns a CSV row.
 * Falls back to parsing the contract ID when metadata fields are missing.
 */
async function fetchContractRow(
  bucketName: string,
  symbol: string,
  contractId: string,
): Promise<ContractRow> {
  const storage = admin.storage();
  const bucket = storage.bucket(bucketName);
  const objectPath = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/${contractId}.jsonl`;
  const file = bucket.file(objectPath);

  let firstObserved = '';
  let lastObserved = '';
  let observationCount = '';

  try {
    const [meta] = await file.getMetadata();
    const custom = (meta?.metadata as Record<string, string> | undefined) ?? {};
    firstObserved = custom.firstObserved ?? '';
    lastObserved = custom.lastObserved ?? '';
    observationCount = custom.observationCount ?? '';
  } catch {
    // Object may not exist or metadata unavailable — leave fields empty.
  }

  const parsed = parseContractIDMetadata(symbol, contractId);
  const expiration = parsed?.expiration ?? '';
  const strike = parsed?.strike ?? '';
  const type = parsed?.type ?? '';

  const coverageDays = calendarDaysInclusive(firstObserved, expiration);
  const dataSpanDays = calendarDaysInclusive(firstObserved, lastObserved);

  return {
    contractId,
    expiration,
    strike,
    type,
    firstObserved,
    lastObserved,
    observationCount,
    coverageDays,
    dataSpanDays,
  };
}

/**
 * Processes a batch of contract IDs: fetches metadata, writes rows to the
 * CSV stream immediately, and updates running summary stats.
 */
async function processBatch(
  bucketName: string,
  symbol: string,
  contractIds: string[],
  concurrency: number,
  csvStream: fs.WriteStream,
  stats: SummaryStats,
): Promise<void> {
  for (let i = 0; i < contractIds.length; i += concurrency) {
    const batch = contractIds.slice(i, i + concurrency);
    const rows = await Promise.all(
      batch.map((id) => fetchContractRow(bucketName, symbol, id)),
    );

    for (const row of rows) {
      csvStream.write(rowToCsvLine(row) + '\n');

      stats.total += 1;
      if (row.firstObserved && row.lastObserved) {
        stats.withMetadata += 1;
        const n = Number(row.observationCount);
        if (Number.isFinite(n)) {
          if (stats.minObs === 0 || n < stats.minObs) stats.minObs = n;
          if (n > stats.maxObs) stats.maxObs = n;
          stats.sumObs += n;
          if (n > 0 && n < 10) stats.lowObs += 1;
        }
      } else {
        stats.missingMetadata += 1;
      }
    }
  }
}

async function main(): Promise<void> {
  const symbolsArg = process.env.SYMBOLS;
  const symbols = symbolsArg
    ? symbolsArg.split(',').map((s) => s.trim().toUpperCase())
    : DEFAULT_SYMBOLS;
  const maxFiles = process.env.MAX_FILES ? Number(process.env.MAX_FILES) : undefined;
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
  const concurrency = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : DEFAULT_CONCURRENCY;

  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is required');
  }

  console.log(`Audit timeseries coverage: symbols=${symbols.join(',')}, bucket=${bucketName}, concurrency=${concurrency}`);

  const storage = admin.storage();
  const bucket = storage.bucket(bucketName);

  for (const symbol of symbols) {
    console.log(`\n--- Processing ${symbol} ---`);

    const prefix = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/`;
    console.log(`Listing files with prefix: ${prefix}${maxFiles ? ` (max ${maxFiles})` : ''}`);

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `timeseries-coverage-${symbol}-${timestamp}.csv`;
    const filepath = path.join(OUTPUT_DIR, filename);
    const csvStream = createCsvStream(filepath);

    const stats: SummaryStats = {
      total: 0,
      withMetadata: 0,
      missingMetadata: 0,
      lowObs: 0,
      minObs: 0,
      maxObs: 0,
      sumObs: 0,
    };

    let pageToken: string | undefined;
    let totalListed = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { contractIds, nextPageToken, limitReached } = await listContractPage(
        bucket,
        prefix,
        pageToken,
        maxFiles,
        totalListed,
      );

      if (contractIds.length > 0) {
        await processBatch(bucketName, symbol, contractIds, concurrency, csvStream, stats);
        totalListed += contractIds.length;
        console.log(`  Processed ${stats.total} contracts total...`);
      }

      if (limitReached) {
        console.log(`Reached MAX_FILES limit (${maxFiles}), stopping.`);
        break;
      }

      if (!nextPageToken || nextPageToken === pageToken) {
        break;
      }
      pageToken = nextPageToken;
    }

    await new Promise<void>((resolve, reject) => {
      csvStream.end((err?: Error) => (err ? reject(err) : resolve()));
    });

    console.log(`CSV written: ${filepath} (${stats.total} rows)`);

    console.log(`  Summary for ${symbol}:`);
    console.log(`    Total contracts:     ${stats.total}`);
    console.log(`    With metadata:       ${stats.withMetadata}`);
    console.log(`    Missing metadata:    ${stats.missingMetadata}`);
    console.log(`    Low obs (<10):       ${stats.lowObs}`);
    if (stats.withMetadata > 0) {
      const avg = (stats.sumObs / stats.withMetadata).toFixed(1);
      console.log(`    Observation count:   min=${stats.minObs}, max=${stats.maxObs}, avg=${avg}`);
    }
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Audit failed:', error);
  process.exit(1);
});
