/**
 * Comprehensive data-quality scan for historical options time-series files.
 *
 * Downloads each JSONL file from GCS, parses all observations, and runs
 * a battery of detection checks:
 *
 *   ZERO_DROP_RECOVERY  — l drops to ~0 then recovers after N days
 *   TRAILING_ZEROS      — l drops to ~0 and stays zero to end of file
 *   STALE_DATA          — l and m unchanged for 10+ consecutive days
 *   DUPLICATE_DATE      — same date appears more than once
 *   OUT_OF_ORDER        — dates not chronologically sorted
 *   NEGATIVE_PRICE      — any price field < 0
 *   MISSING_LAST        — observation without l field
 *   POST_EXPIRATION     — observation after contract expiration
 *   OBSERVATION_GAP     — actual obs < 80% of expected weekdays
 *   EARLY_START_GAP     — file starts at/before dataset start (obs count unreliable)
 *   BS_ANOMALY          — Black-Scholes implied underlying deviates >30% from median
 *
 * Output: one CSV row per anomaly event, streamed incrementally.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts
 *
 * Required:
 *   OPTIONS_TIME_SERIES_BUCKET=...
 *
 * Optional:
 *   SYMBOLS=QQQ,TQQQ
 *   MAX_FILES=5000
 *   CONCURRENCY=30          // concurrent downloads (default 30)
 *   SAMPLE_EVERY=1          // scan every Nth file (10 = 10% sample)
 *   ENABLE_BS_CHECK=true    // enable Black-Scholes anomaly detection
 *   DATA_START_DATE=2023-01-01  // dataset start for early-start detection
 *   PREVIOUS_THRESHOLD=1.00 // min l before drop to flag zero drop
 *   ZERO_THRESHOLD=0.05     // max l after drop to flag zero drop
 *   STALE_THRESHOLD=10      // consecutive same l+m days to flag stale
 *   STALE_MIN_PRICE=0.10    // skip stale detection when l < this (penny options)
 *   OBS_DEFICIENCY_PCT=20   // min % missing to flag observation gap (informational)
 *   OBS_GAP_MIN_DAYS=5      // min absolute missing days to flag observation gap
 *
 * Flags:
 *   --resume-from=<contractId>  skip all contract IDs <= this value (lexicographic)
 *   --append-csv=<path>         append to existing CSV instead of creating new one
 *   --mark-only                 scan only for mark (m) zero-drop anomalies
 *                               (uses MARK_PREVIOUS_THRESHOLD and MARK_ZERO_THRESHOLD)
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { admin } from '../../src/firebase-admin-init';
import { parseContractIDMetadata } from '../../src/v2/historical-options-corpus/services/contract-metadata.utils';
import { TIME_SERIES_PREFIX } from '../../src/v2/historical-options-corpus/types';

import {
  type Anomaly,
  type DetectConfig,
  DEFAULT_CONFIG,
  parseObsLine,
  runAllDetections,
  detectMarkZeroDrops,
  detectStructuralIssues,
} from './data-quality-detect';
import {
  type UnderlyingCloses,
  fetchUnderlyingCloses,
} from './underlying-closes.service';

const DEFAULT_SYMBOLS = ['QQQ', 'TQQQ'];
const PAGE_SIZE = 1000;
const DEFAULT_CONCURRENCY = 30;
const OUTPUT_DIR = path.resolve(__dirname, 'output');

const CSV_HEADER = [
  'contractId',
  'expiration',
  'strike',
  'type',
  'anomalyType',
  'severity',
  'affectedDate',
  'affectedDateEnd',
  'detail',
  'valueBefore',
  'valueAfter',
  'zeroRunLength',
  'isTrailingZeros',
  'expectedObs',
  'actualObs',
  'obsDeficiencyPct',
  'daysToExpiration',
  'isEarlyStart',
  'totalObs',
  'firstTradedDate',
  'fileStartDate',
  'fileEndDate',
].join(',');

function anomalyToCsvLine(a: Anomaly): string {
  return [
    a.contractId,
    a.expiration,
    a.strike,
    a.type,
    a.anomalyType,
    a.severity,
    a.affectedDate,
    a.affectedDateEnd,
    `"${a.detail.replace(/"/g, '""')}"`,
    a.valueBefore,
    a.valueAfter,
    String(a.zeroRunLength),
    a.isTrailingZeros ? 'true' : 'false',
    String(a.expectedObs),
    String(a.actualObs),
    String(a.obsDeficiencyPct),
    a.daysToExpiration !== null ? String(a.daysToExpiration) : '',
    a.isEarlyStart ? 'true' : 'false',
    String(a.totalObs),
    a.firstTradedDate,
    a.fileStartDate,
    a.fileEndDate,
  ].join(',');
}

function createCsvStream(filepath: string, append: boolean): fs.WriteStream {
  const stream = fs.createWriteStream(filepath, {
    encoding: 'utf8',
    flags: append ? 'a' : 'w',
  });
  if (!append) {
    stream.write(CSV_HEADER + '\n');
  }
  return stream;
}

interface ScanStats {
  filesScanned: number;
  filesWithAnomaly: number;
  totalAnomalies: number;
  byType: Map<string, number>;
  bySeverity: Map<string, number>;
}

function initStats(): ScanStats {
  return {
    filesScanned: 0,
    filesWithAnomaly: 0,
    totalAnomalies: 0,
    byType: new Map(),
    bySeverity: new Map(),
  };
}

function bumpCounter(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Downloads a JSONL file from GCS and returns parsed observations.
 * Returns undefined when the object does not exist.
 */
async function downloadAndParse(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  objectPath: string,
): Promise<NonNullable<ReturnType<typeof parseObsLine>>[] | undefined> {
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return undefined;

  const [buffer] = await file.download();
  const lines = buffer.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean);

  const obs: NonNullable<ReturnType<typeof parseObsLine>>[] = [];
  for (const line of lines) {
    const parsed = parseObsLine(line);
    if (parsed) obs.push(parsed);
  }

  obs.sort((a, b) => a.d.localeCompare(b.d));
  return obs;
}

/**
 * Scans a single contract file for all anomaly types and writes findings
 * to the CSV stream.
 */
async function scanContract(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  symbol: string,
  contractId: string,
  config: DetectConfig,
  csvStream: fs.WriteStream,
  stats: ScanStats,
  flags: { markOnly?: boolean },
  underlyingCloses?: UnderlyingCloses,
): Promise<void> {
  const objectPath = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/${contractId}.jsonl`;
  const parsed = parseContractIDMetadata(symbol, contractId);

  // # Reason: Skip GCS metadata fetch in mark-only mode — detectMarkZeroDrops
  // doesn't use firstTradedDate, so the extra API call is wasted work at scale.
  let firstTradedDate = '';
  if (!flags.markOnly) {
    try {
      const file = bucket.file(objectPath);
      const [meta] = await file.getMetadata();
      const custom = (meta?.metadata as Record<string, string> | undefined) ?? {};
      firstTradedDate = custom.firstObserved ?? '';
    } catch {
      // Metadata unavailable — leave firstTradedDate empty.
    }
  }

  let obs: NonNullable<ReturnType<typeof parseObsLine>>[] | undefined;
  try {
    obs = await downloadAndParse(bucket, objectPath);
  } catch (err) {
    console.error(`  Error reading ${contractId}: ${String((err as Error)?.message ?? err)}`);
    return;
  }

  if (!obs || obs.length === 0) return;

  const expiration = parsed?.expiration ?? '';
  const strike = parsed?.strike ?? '';
  const type = parsed?.type ?? '';

  const base = {
    contractId,
    expiration,
    strike,
    type,
    totalObs: obs.length,
    firstTradedDate,
    fileStartDate: obs.length > 0 ? obs[0].d : '',
    fileEndDate: obs.length > 0 ? obs[obs.length - 1].d : '',
  };

  const anomalies = flags.markOnly
    ? [
        ...detectMarkZeroDrops(obs, base, config, underlyingCloses),
        ...detectStructuralIssues(obs, base).filter((a) => a.anomalyType === 'MISSING_MARK'),
      ]
    : runAllDetections(obs, contractId, expiration, strike, type, config, firstTradedDate);

  if (anomalies.length > 0) {
    stats.filesWithAnomaly += 1;
    for (const a of anomalies) {
      csvStream.write(anomalyToCsvLine(a) + '\n');
      stats.totalAnomalies += 1;
      bumpCounter(stats.byType, a.anomalyType);
      bumpCounter(stats.bySeverity, a.severity);
    }
  }
}

/**
 * Lists one page of contract IDs from the time-series bucket.
 */
async function listContractPage(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  prefix: string,
  pageToken: string | undefined,
  maxFiles: number | undefined,
  totalSoFar: number,
  startOffset?: string,
): Promise<{ contractIds: string[]; nextPageToken?: string; limitReached: boolean }> {
  const query: Record<string, unknown> = {
    prefix,
    maxResults: PAGE_SIZE,
  };
  if (pageToken) query.pageToken = pageToken;
  if (startOffset) query.startOffset = startOffset;

  const [files, , apiResponse] = await bucket.getFiles(query);

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

  const nextPageToken = (apiResponse as { nextPageToken?: string })?.nextPageToken;
  return { contractIds, nextPageToken: limitReached ? undefined : nextPageToken, limitReached };
}

/**
 * Processes a batch of contract IDs with bounded concurrency.
 */
async function processBatch(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  symbol: string,
  contractIds: string[],
  concurrency: number,
  config: DetectConfig,
  csvStream: fs.WriteStream,
  stats: ScanStats,
  flags: { markOnly?: boolean },
  underlyingCloses?: UnderlyingCloses,
): Promise<void> {
  for (let i = 0; i < contractIds.length; i += concurrency) {
    const batch = contractIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map((id) => scanContract(bucket, symbol, id, config, csvStream, stats, flags, underlyingCloses)),
    );
    stats.filesScanned += batch.length;
  }
}

function buildConfig(): DetectConfig {
  return {
    ...DEFAULT_CONFIG,
    previousThreshold: process.env.PREVIOUS_THRESHOLD
      ? Number(process.env.PREVIOUS_THRESHOLD) : DEFAULT_CONFIG.previousThreshold,
    zeroThreshold: process.env.ZERO_THRESHOLD
      ? Number(process.env.ZERO_THRESHOLD) : DEFAULT_CONFIG.zeroThreshold,
    staleThreshold: process.env.STALE_THRESHOLD
      ? Number(process.env.STALE_THRESHOLD) : DEFAULT_CONFIG.staleThreshold,
    staleMinPrice: process.env.STALE_MIN_PRICE
      ? Number(process.env.STALE_MIN_PRICE) : DEFAULT_CONFIG.staleMinPrice,
    obsDeficiencyPct: process.env.OBS_DEFICIENCY_PCT
      ? Number(process.env.OBS_DEFICIENCY_PCT) : DEFAULT_CONFIG.obsDeficiencyPct,
    obsGapMinDays: process.env.OBS_GAP_MIN_DAYS
      ? Number(process.env.OBS_GAP_MIN_DAYS) : DEFAULT_CONFIG.obsGapMinDays,
    dataStartDate: process.env.DATA_START_DATE ?? DEFAULT_CONFIG.dataStartDate,
    enableBsCheck: process.env.ENABLE_BS_CHECK === 'true',
    bsDeviationThreshold: process.env.BS_DEVIATION_THRESHOLD
      ? Number(process.env.BS_DEVIATION_THRESHOLD) : DEFAULT_CONFIG.bsDeviationThreshold,
    markPreviousThreshold: process.env.MARK_PREVIOUS_THRESHOLD
      ? Number(process.env.MARK_PREVIOUS_THRESHOLD) : DEFAULT_CONFIG.markPreviousThreshold,
    markZeroThreshold: process.env.MARK_ZERO_THRESHOLD
      ? Number(process.env.MARK_ZERO_THRESHOLD) : DEFAULT_CONFIG.markZeroThreshold,
  };
}

/**
 * Parses --flag=value arguments from process.argv.
 */
function parseFlags(): { resumeFrom?: string; appendCsv?: string; markOnly?: boolean } {
  const flags: { resumeFrom?: string; appendCsv?: string; markOnly?: boolean } = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--resume-from=')) {
      flags.resumeFrom = arg.slice('--resume-from='.length);
    } else if (arg.startsWith('--append-csv=')) {
      flags.appendCsv = arg.slice('--append-csv='.length);
    } else if (arg === '--mark-only') {
      flags.markOnly = true;
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const symbols = (process.env.SYMBOLS ?? DEFAULT_SYMBOLS.join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const maxFiles = process.env.MAX_FILES ? Number(process.env.MAX_FILES) : undefined;
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
  const concurrency = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : DEFAULT_CONCURRENCY;
  const sampleEvery = process.env.SAMPLE_EVERY ? Number(process.env.SAMPLE_EVERY) : 1;
  const config = buildConfig();

  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is required');
  }

  console.log(
    `Data quality scan: symbols=${symbols.join(',')}, bucket=${bucketName}, ` +
      `concurrency=${concurrency}, sampleEvery=${sampleEvery}, ` +
      `bsCheck=${config.enableBsCheck}, dataStart=${config.dataStartDate}`,
  );
  if (flags.resumeFrom) {
    console.log(`  Resuming from: ${flags.resumeFrom}`);
  }
  if (flags.appendCsv) {
    console.log(`  Appending to: ${flags.appendCsv}`);
  }

  const storage = admin.storage();
  const bucket = storage.bucket(bucketName);

  // Load underlying close prices for ITM filtering (mark-only mode)
  let underlyingCloses: UnderlyingCloses | undefined;
  if (flags.markOnly) {
    underlyingCloses = new Map();
    const currentYear = new Date().getUTCFullYear();
    const years = [];
    for (let y = 2018; y <= currentYear; y++) years.push(y);
    for (const sym of symbols) {
      console.log(`  Loading ${sym} underlying closes...`);
      const closes = await fetchUnderlyingCloses(sym, years);
      console.log(`    ${sym}: ${closes.size} daily bars loaded`);
      underlyingCloses.set(sym, closes);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `data-quality-${timestamp}.csv`;
  const defaultFilepath = path.join(OUTPUT_DIR, filename);
  const filepath = flags.appendCsv ?? defaultFilepath;
  const csvStream = createCsvStream(filepath, !!flags.appendCsv);

  const stats = initStats();

  for (const symbol of symbols) {
    console.log(`\n--- Scanning ${symbol} ---`);
    const prefix = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/`;

    let pageToken: string | undefined;
    let totalListed = 0;
    let sampleIndex = 0;

    // When resuming, use GCS startOffset to skip ahead in the listing
    // instead of listing from the beginning and filtering.
    const startOffset = flags.resumeFrom
      ? `${prefix}${flags.resumeFrom}.jsonl`
      : undefined;
    let firstPage = true;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { contractIds, nextPageToken, limitReached } = await listContractPage(
        bucket,
        prefix,
        pageToken,
        maxFiles,
        totalListed,
        firstPage ? startOffset : undefined,
      );
      firstPage = false;

      // On the first page with startOffset, filter out the resume-from file itself
      // (GCS startOffset is inclusive).
      let toScan = contractIds;
      if (flags.resumeFrom && pageToken === undefined) {
        toScan = toScan.filter((id) => id !== flags.resumeFrom);
      }
      if (sampleEvery > 1) {
        toScan = toScan.filter(() => {
          sampleIndex++;
          return sampleIndex % sampleEvery === 0;
        });
      }

      if (toScan.length > 0) {
        await processBatch(bucket, symbol, toScan, concurrency, config, csvStream, stats, flags, underlyingCloses);
      }

      totalListed += contractIds.length;
      console.log(
        `  Scanned ${stats.filesScanned} files, ` +
          `${stats.filesWithAnomaly} with anomalies, ` +
          `${stats.totalAnomalies} total anomalies...`,
      );

      if (limitReached) {
        console.log(`Reached MAX_FILES limit (${maxFiles}), stopping.`);
        break;
      }
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
    }
  }

  await new Promise<void>((resolve, reject) => {
    csvStream.end((err?: Error) => (err ? reject(err) : resolve()));
  });

  console.log(`\nCSV written: ${filepath}`);
  console.log(`\n=== Summary ===`);
  console.log(`  Files scanned:       ${stats.filesScanned}`);
  console.log(`  Files with anomaly:  ${stats.filesWithAnomaly}`);
  console.log(`  Total anomalies:     ${stats.totalAnomalies}`);

  console.log(`\n  By severity:`);
  for (const [sev, count] of stats.bySeverity) {
    console.log(`    ${sev.padEnd(8)} ${count}`);
  }

  console.log(`\n  By type:`);
  const sortedTypes = [...stats.byType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`    ${type.padEnd(22)} ${count}`);
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Scan failed:', error);
  process.exit(1);
});
