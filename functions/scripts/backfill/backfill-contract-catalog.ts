/**
 * Backfill script: Populate `ts-contracts` Firestore subcollection for all
 * existing historical options time-series files.
 *
 * For each `.jsonl` file in the time-series bucket:
 *   1. Read GCS custom metadata (firstObserved, lastObserved, observationCount).
 *   2. If metadata is missing, download the file content, parse JSONL lines to
 *      derive the fields, and patch the GCS object's custom metadata.
 *   3. Write a `ts-contracts/{contractId}` doc via `ContractCatalogWriter`.
 *   4. After all contracts for a symbol are written, run the summary aggregator.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/backfill/backfill-contract-catalog.ts
 *
 * Optional environment variables:
 *   SYMBOLS=QQQ,TQQQ         // comma-separated list (default: QQQ,TQQQ)
 *   MAX_FILES=100            // limit GCS listing to N files (for testing)
 *   OPTIONS_TIME_SERIES_BUCKET=... // override bucket name
 *   CONCURRENCY=50           // concurrent operations (default: 50)
 *   DRY_RUN=true             // list and log but don't write to Firestore or patch GCS
 *   SKIP_EXISTING=true       // skip contracts that already have a ts-contracts doc (resume mode)
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import type { Bucket } from '@google-cloud/storage';

import { admin, db } from '../../src/firebase-admin-init';
import { OPTIONS_FILE_INDEX_COLLECTION, TS_CONTRACTS_SUBCOLLECTION } from '@shared/options';
import { TIME_SERIES_PREFIX } from '../../src/v2/historical-options-corpus/types';
import { parseContractIDMetadata } from '../../src/v2/historical-options-corpus/services/contract-metadata.utils';
import { parseStorageLine } from '../../src/v2/historical-options-corpus/services/time-series-contract.utils';
import { ContractCatalogWriter } from '../../src/v2/historical-options-corpus/services/contract-catalog.writer';
import { ContractSummaryAggregator } from '../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service';

const DEFAULT_SYMBOLS = ['QQQ', 'TQQQ'];
const PAGE_SIZE = 1000;
const DEFAULT_CONCURRENCY = 50;

// ---- Types ----

interface ContractMetadata {
  firstObserved: string;
  lastObserved: string;
  observationCount: number;
}

interface BackfillStats {
  total: number;
  written: number;
  skipped: number;
  alreadyExisted: number;
  repaired: number;
  errors: number;
  missingMetadata: number;
}

// ---- GCS listing ----

/**
 * Lists one page of contract IDs from the time-series bucket.
 */
async function listContractPage(
  bucket: Bucket,
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

// ---- GCS metadata reading ----

/**
 * Reads GCS custom metadata for a single contract file.
 * Returns undefined when the object doesn't exist.
 */
async function readGcsMetadata(
  bucket: Bucket,
  symbol: string,
  contractId: string,
): Promise<Record<string, string> | undefined> {
  const objectPath = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/${contractId}.jsonl`;
  const file = bucket.file(objectPath);

  try {
    const [meta] = await file.getMetadata();
    return (meta?.metadata ?? {}) as Record<string, string>;
  } catch (error: any) {
    if (error?.code === 404) return undefined;
    throw error;
  }
}

/**
 * Checks whether GCS metadata has the required fields.
 */
function hasRequiredMetadata(meta: Record<string, string> | undefined): boolean {
  if (!meta) return false;
  return !!(meta.firstObserved && meta.lastObserved && meta.observationCount);
}

// ---- GCS metadata repair ----

/**
 * Downloads the JSONL file content, parses lines to derive metadata,
 * and patches the GCS object's custom metadata.
 *
 * Returns the derived metadata fields.
 */
async function repairGcsMetadata(
  bucket: Bucket,
  symbol: string,
  contractId: string,
): Promise<ContractMetadata> {
  const objectPath = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/${contractId}.jsonl`;
  const file = bucket.file(objectPath);

  const [content] = await file.download();
  const text = content.toString('utf8');
  const lines = text.trim().split('\n').filter(Boolean);

  if (lines.length === 0) {
    return { firstObserved: '', lastObserved: '', observationCount: 0 };
  }

  const records = lines
    .map((line) => parseStorageLine(line))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  if (records.length === 0) {
    return { firstObserved: '', lastObserved: '', observationCount: 0 };
  }

  // Records are assumed to be sorted by date (builder writes them sorted).
  // Sort defensively in case of any ordering issues.
  records.sort((a, b) => a.d.localeCompare(b.d));

  const derived: ContractMetadata = {
    firstObserved: records[0].d,
    lastObserved: records[records.length - 1].d,
    observationCount: records.length,
  };

  // Patch the GCS object's custom metadata without re-uploading content.
  const parsed = parseContractIDMetadata(symbol, contractId);
  const customMetadata: Record<string, string> = {
    symbol: symbol.toUpperCase(),
    contractID: contractId.toUpperCase(),
    expiration: parsed?.expiration ?? '',
    type: parsed?.type ?? '',
    strike: parsed?.strike ?? '',
    firstObserved: derived.firstObserved,
    lastObserved: derived.lastObserved,
    observationCount: String(derived.observationCount),
    schemaVersion: 'v1',
  };

  await file.setMetadata({
    metadata: customMetadata,
  });

  return derived;
}

// ---- Per-contract processing ----

/**
 * Processes a single contract: read metadata, repair if missing, write catalog doc.
 */
async function processContract(
  bucket: Bucket,
  catalogWriter: ContractCatalogWriter,
  symbol: string,
  contractId: string,
  dryRun: boolean,
  existingIds: Set<string> | null,
): Promise<{ status: 'written' | 'skipped' | 'alreadyExisted' | 'repaired' | 'error'; error?: string }> {
  try {
    const parsed = parseContractIDMetadata(symbol, contractId);
    if (!parsed) {
      return { status: 'skipped', error: 'unparseable contract ID' };
    }

    // Resume mode: skip if doc already exists (bulk-loaded Set lookup)
    if (existingIds && existingIds.has(contractId.toUpperCase())) {
      return { status: 'alreadyExisted' };
    }

    let meta = await readGcsMetadata(bucket, symbol, contractId);
    let repaired = false;

    if (!hasRequiredMetadata(meta)) {
      // # Reason: Old files predate the metadata-writing code. We download the
      // file content, derive the fields, and patch GCS metadata so future
      // operations don't need to re-download.
      console.log(`  [REPAIR] ${contractId} — missing GCS metadata, downloading content...`);
      const derived = dryRun
        ? { firstObserved: '', lastObserved: '', observationCount: 0 }
        : await repairGcsMetadata(bucket, symbol, contractId);
      repaired = !dryRun;
      meta = {
        ...(meta ?? {}),
        firstObserved: derived.firstObserved,
        lastObserved: derived.lastObserved,
        observationCount: String(derived.observationCount),
      };
    }

    const firstObserved = meta?.firstObserved ?? '';
    const lastObserved = meta?.lastObserved ?? '';
    const observationCount = Number(meta?.observationCount ?? 0);

    if (!dryRun) {
      await catalogWriter.upsertContractCatalog({
        symbol,
        contractId,
        firstObserved,
        lastObserved,
        observationCount,
        // No latestRecord during backfill — per PRD §8.2.
      });
    }

    return { status: repaired ? 'repaired' : 'written' };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', error: message };
  }
}

// ---- Batch processing ----

/**
 * Processes a batch of contract IDs at the given concurrency.
 */
async function processBatch(
  bucket: Bucket,
  catalogWriter: ContractCatalogWriter,
  symbol: string,
  contractIds: string[],
  concurrency: number,
  dryRun: boolean,
  existingIds: Set<string> | null,
  stats: BackfillStats,
): Promise<void> {
  for (let i = 0; i < contractIds.length; i += concurrency) {
    const batch = contractIds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((id) => processContract(bucket, catalogWriter, symbol, id, dryRun, existingIds)),
    );

    for (const result of results) {
      stats.total++;
      switch (result.status) {
        case 'written':
          stats.written++;
          break;
        case 'repaired':
          stats.written++;
          stats.repaired++;
          stats.missingMetadata++;
          break;
        case 'alreadyExisted':
          stats.alreadyExisted++;
          break;
        case 'skipped':
          stats.skipped++;
          break;
        case 'error':
          stats.errors++;
          console.error(`  [ERROR] ${result.error}`);
          break;
      }
    }

    console.log(`  Progress: ${stats.total} processed, ${stats.written} written, ${stats.alreadyExisted} already existed, ${stats.repaired} repaired, ${stats.errors} errors`);
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const symbolsArg = process.env.SYMBOLS;
  const symbols = symbolsArg
    ? symbolsArg.split(',').map((s) => s.trim().toUpperCase())
    : DEFAULT_SYMBOLS;
  const maxFiles = process.env.MAX_FILES ? Number(process.env.MAX_FILES) : undefined;
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
  const concurrency = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : DEFAULT_CONCURRENCY;
  const dryRun = process.env.DRY_RUN === 'true';
  const skipExisting = process.env.SKIP_EXISTING === 'true';

  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is required');
  }

  // Pre-load existing doc IDs for resume mode
  let existingIds: Set<string> | null = null;

  console.log(`Backfill contract catalog: symbols=${symbols.join(',')}, bucket=${bucketName}, concurrency=${concurrency}, dryRun=${dryRun}, skipExisting=${skipExisting}`);

  const storage = admin.storage();
  const bucket = storage.bucket(bucketName);
  const catalogWriter = new ContractCatalogWriter(db);
  const aggregator = new ContractSummaryAggregator(db);

  for (const symbol of symbols) {
    console.log(`\n=== Processing ${symbol} ===`);

    const prefix = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/`;
    console.log(`Listing files with prefix: ${prefix}${maxFiles ? ` (max ${maxFiles})` : ''}`);

    // Bulk-load existing ts-contracts doc IDs for this symbol (resume mode)
    if (skipExisting && !dryRun) {
      console.log(`  Pre-loading existing ts-contracts doc IDs for ${symbol}...`);
      const colRef = db
        .collection(OPTIONS_FILE_INDEX_COLLECTION)
        .doc(symbol.toUpperCase())
        .collection(TS_CONTRACTS_SUBCOLLECTION);
      const snap = await colRef.select().get();
      existingIds = new Set(snap.docs.map((d) => d.id));
      console.log(`  Found ${existingIds.size} existing docs to skip.`);
    } else {
      existingIds = null;
    }

    const stats: BackfillStats = {
      total: 0,
      written: 0,
      skipped: 0,
      alreadyExisted: 0,
      repaired: 0,
      errors: 0,
      missingMetadata: 0,
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
        await processBatch(bucket, catalogWriter, symbol, contractIds, concurrency, dryRun, existingIds, stats);
        totalListed += contractIds.length;
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

    console.log(`\n  Summary for ${symbol}:`);
    console.log(`    Total contracts:       ${stats.total}`);
    console.log(`    Catalog docs written:  ${stats.written}`);
    console.log(`    Already existed:       ${stats.alreadyExisted}`);
    console.log(`    Skipped (unparseable): ${stats.skipped}`);
    console.log(`    GCS metadata repaired: ${stats.repaired}`);
    console.log(`    Missing metadata found: ${stats.missingMetadata}`);
    console.log(`    Errors:                ${stats.errors}`);

    // Run summary aggregator after all contracts are written.
    if (!dryRun && stats.written > 0) {
      console.log(`\n  Running summary aggregator for ${symbol}...`);
      try {
        const summary = await aggregator.aggregateAndWriteSummary(symbol);
        console.log(`  Summary written: ${summary.totalContracts} contracts, ${summary.expirationCount} expirations, ${summary.lengthBuckets.length} length buckets`);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [ERROR] Summary aggregation failed: ${message}`);
      }
    } else if (dryRun) {
      console.log(`  [DRY RUN] Skipping summary aggregation.`);
    }
  }

  console.log('\nBackfill complete.');
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
