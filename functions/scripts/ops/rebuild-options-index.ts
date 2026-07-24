/**
 * Rebuild script: Regenerate the Firestore options file index from GCS.
 *
 * Lists all JSONL files in the time-series bucket for each symbol,
 * parses OCC tickers, and writes the `options-file-index` collection.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/ops/rebuild-options-index.ts
 *
 * Optional environment variables:
 *   SYMBOLS=QQQ,TQQQ         // comma-separated list (default: QQQ,TQQQ)
 *   DRY_RUN=1                // list files and parse without writing to Firestore
 *   MAX_FILES=100            // limit GCS listing to N files (for testing)
 *   OPTIONS_TIME_SERIES_BUCKET=... // override bucket name
 */

import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';

import { db } from '../../src/firebase-admin-init';
import { CloudTask } from '../../src/v2/common/constants';
import { OptionsIndexWriter } from '../../src/v2/historical-options-corpus/services/options-index.writer';
import { TIME_SERIES_PREFIX } from '../../src/v2/historical-options-corpus/types';

const DEFAULT_SYMBOLS = ['QQQ', 'TQQQ'];
const PAGE_SIZE = 1000;

async function listContractIds(bucketName: string, symbol: string, maxFiles?: number): Promise<string[]> {
  const storage = getStorage();
  const bucket = storage.bucket(bucketName);
  const prefix = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/`;

  const contractIds: string[] = [];
  let pageToken: string | undefined;

  console.log(`Listing files with prefix: ${prefix}${maxFiles ? ` (max ${maxFiles})` : ''}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [files, , apiResponse] = await bucket.getFiles({
      prefix,
      maxResults: PAGE_SIZE,
      pageToken,
    });

    for (const file of files) {
      // Extract contract ID from filename: {prefix}/{SYMBOL}/{CONTRACT_ID}.jsonl
      const filename = file.name;
      const relativePath = filename.slice(prefix.length);
      if (!relativePath.endsWith('.jsonl')) continue;

      const contractId = relativePath.replace(/\.jsonl$/, '');
      if (contractId) {
        contractIds.push(contractId);
      }

      if (maxFiles && contractIds.length >= maxFiles) {
        console.log(`Reached MAX_FILES limit (${maxFiles}), stopping listing.`);
        return contractIds;
      }
    }

    console.log(`Listed ${contractIds.length} files so far...`);

    const nextPageToken = (apiResponse as any)?.nextPageToken;
    if (!nextPageToken || nextPageToken === pageToken) {
      break;
    }
    pageToken = nextPageToken;
  }

  return contractIds;
}

async function main(): Promise<void> {
  const symbolsArg = process.env.SYMBOLS;
  const symbols = (symbolsArg ? symbolsArg.split(',').map((s) => s.trim().toUpperCase()) : DEFAULT_SYMBOLS);
  const dryRun = process.env.DRY_RUN === '1';
  const maxFiles = process.env.MAX_FILES ? Number(process.env.MAX_FILES) : undefined;
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;

  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is required');
  }

  console.log(`Rebuild options index: symbols=${symbols.join(',')}, dryRun=${dryRun}, bucket=${bucketName}`);

  const writer = new OptionsIndexWriter(db, (msg, meta) => {
    if (meta) {
      console.log(`${msg}`, JSON.stringify(meta));
    } else {
      console.log(msg);
    }
  });

  for (const symbol of symbols) {
    console.log(`\n--- Processing ${symbol} ---`);

    const contractIds = await listContractIds(bucketName, symbol, maxFiles);
    console.log(`Found ${contractIds.length} files for ${symbol}`);

    if (contractIds.length === 0) {
      console.log(`No files found for ${symbol}, skipping.`);
      continue;
    }

    if (dryRun) {
      // Sample a few contract IDs for verification
      const sample = contractIds.slice(0, 5);
      console.log(`Sample contract IDs: ${sample.join(', ')}`);
      console.log(`DRY_RUN=1 — skipping Firestore writes.`);
      continue;
    }

    console.log(`Preparing rebuild payloads for ${symbol}...`);
    const payloads = writer.prepareRebuildPayloads(symbol, contractIds);
    const runId = payloads[0]?.runId ?? 'unknown';
    console.log(`Prepared ${payloads.length} tasks for ${symbol} (runId: ${runId})`);

    console.log(`Enqueuing tasks to Cloud Tasks queue: ${CloudTask.OPTIONS_INDEX_WRITE}...`);
    const queue = getFunctions().taskQueue(CloudTask.OPTIONS_INDEX_WRITE);

    let enqueued = 0;
    for (const payload of payloads) {
      await queue.enqueue(payload);
      enqueued++;
      if (enqueued % 10 === 0) {
        console.log(`Enqueued ${enqueued}/${payloads.length} tasks...`);
      }
    }

    console.log(`Enqueued all ${enqueued} tasks for ${symbol}.`);
  }

  console.log('\nDone. Tasks will process asynchronously via Cloud Tasks.');
}

main().catch((error) => {
  console.error('Rebuild failed:', error);
  process.exit(1);
});
