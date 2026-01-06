/**
 * Script: run-bulk-import.ts
 *
 * Purpose:
 *   Read a BulkImportItem[] JSON file from the repo root and call the
 *   production bulkImportSymbolsV2 callable function in batches.
 *
 * Inputs (CLI args):
 *   --file=<relative-or-absolute-path-to-json>
 *   --clientId=<CLIENT_ID_STRING>
 *   [--chunkSize=<N>]  // optional, default 200
 *
 * Environment variables:
 *   BULK_IMPORT_URL
 *     - Required. Full HTTPS URL of the bulkImportSymbolsV2 callable endpoint.
 *       Example (Gen1-style):
 *         https://us-central1-<project-id>.cloudfunctions.net/bulkImportSymbolsV2
 *       Or the Cloud Run URL for the Gen2 callable.
 *
 *   BULK_IMPORT_AUTH_BEARER
 *     - Optional. If set, used as a Bearer token for Authorization header.
 *       Example:
 *         BULK_IMPORT_AUTH_BEARER="ya29...."  # Firebase ID token or Google OIDC
 *
 * Usage (from functions/ directory, PRODUCTION):
 *
 *   # SPY/QQQ + XL sector universe
 *   BULK_IMPORT_URL="https://.../bulkImportSymbolsV2" \
 *   BULK_IMPORT_AUTH_BEARER="<token-if-required>" \
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/run-bulk-import.ts \
 *       --file ../bulk-import.enriched_spy-qqq.json \
 *       --clientId XL_UNIVERSE_SPY_QQQ
 *
 *   # XL-only universe (non-SPY/QQQ)
 *   BULK_IMPORT_URL="https://.../bulkImportSymbolsV2" \
 *   BULK_IMPORT_AUTH_BEARER="<token-if-required>" \
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/run-bulk-import.ts \
 *       --file ../bulk-import.enriched_XL-non-spy-qqq.json \
 *       --clientId XL_UNIVERSE_XL_ONLY
 */

import * as fs from 'fs';
import * as path from 'path';

import axios from 'axios';

import type { BulkImportItem, BulkImportResult } from '@shared/alpha-vantage';

interface CliArgs {
  file: string;
  clientId: string;
  chunkSize: number;
  maxItems?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};

  for (const arg of argv) {
    if (arg.startsWith('--file=')) {
      args.file = arg.substring('--file='.length);
    } else if (arg.startsWith('--clientId=')) {
      args.clientId = arg.substring('--clientId='.length);
    } else if (arg.startsWith('--chunkSize=')) {
      const raw = arg.substring('--chunkSize='.length);
      const n = Number(raw);
      if (!Number.isNaN(n) && n > 0) {
        args.chunkSize = n;
      }
    } else if (arg.startsWith('--maxItems=')) {
      const raw = arg.substring('--maxItems='.length);
      const n = Number(raw);
      if (!Number.isNaN(n) && n > 0) {
        args.maxItems = n;
      }
    }
  }

  if (!args.file || !args.clientId) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: ts-node scripts/run-bulk-import.ts --file <path> --clientId <CLIENT_ID> [--chunkSize <N>]',
    );
    process.exitCode = 1;
    throw new Error('Missing required arguments file/clientId');
  }

  if (!args.chunkSize) {
    args.chunkSize = 200;
  }

  return args as CliArgs;
}

function loadItems(jsonPath: string): BulkImportItem[] {
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw) as unknown;

  if (!Array.isArray(data)) {
    throw new Error('Bulk import JSON must be an array of BulkImportItem');
  }

  return data as BulkImportItem[];
}

async function runBulkImportForChunk(
  url: string,
  bearerToken: string | undefined,
  clientId: string,
  items: BulkImportItem[],
  batchIndex: number,
): Promise<BulkImportResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  // Firebase callable expects { data: { ... } }
  const body = {
    data: {
      clientId,
      items,
    },
  };

  // eslint-disable-next-line no-console
  console.log(
    `Calling bulkImportSymbolsV2 batch ${batchIndex} with ${items.length} items...`,
  );

  const resp = await axios.post(url, body, { headers, timeout: 5 * 60 * 1000 });
  const raw = resp.data as any;
  const result = (raw && (raw.result ?? raw)) as BulkImportResult;

  // eslint-disable-next-line no-console
  console.log('Batch result summary:', {
    batchIndex,
    ok: result.ok,
    alreadyTracked: result.alreadyTracked,
    autoAccepted: result.autoAccepted,
    queuedForReview: result.queuedForReview,
    failed: result.failed,
    errorCount: result.errors?.length ?? 0,
  });

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const bulkImportUrl = process.env.BULK_IMPORT_URL;
  if (!bulkImportUrl) {
    throw new Error('BULK_IMPORT_URL env var is required');
  }

  const bearer = process.env.BULK_IMPORT_AUTH_BEARER;

  const jsonPath = path.resolve(args.file);

  // eslint-disable-next-line no-console
  console.log(`Loading BulkImportItem array from ${jsonPath} ...`);
  let allItems = loadItems(jsonPath);

  if (args.maxItems && args.maxItems > 0 && args.maxItems < allItems.length) {
    allItems = allItems.slice(0, args.maxItems);
    // eslint-disable-next-line no-console
    console.log(`Limiting to first ${args.maxItems} items from JSON file.`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Loaded ${allItems.length} items. Using chunkSize=${args.chunkSize}. clientId=${args.clientId}`,
  );

  const chunks: BulkImportItem[][] = [];
  for (let i = 0; i < allItems.length; i += args.chunkSize) {
    chunks.push(allItems.slice(i, i + args.chunkSize));
  }

  let totalAlreadyTracked = 0;
  let totalAutoAccepted = 0;
  let totalQueued = 0;
  let totalFailed = 0;
  let totalErrors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const batchIndex = i + 1;
    const chunk = chunks[i];

    const result = await runBulkImportForChunk(
      bulkImportUrl,
      bearer,
      args.clientId,
      chunk,
      batchIndex,
    );

    totalAlreadyTracked += result.alreadyTracked ?? 0;
    totalAutoAccepted += result.autoAccepted ?? 0;
    totalQueued += result.queuedForReview ?? 0;
    totalFailed += result.failed ?? 0;
    totalErrors += result.errors?.length ?? 0;
  }

  // eslint-disable-next-line no-console
  console.log('Bulk import completed. Aggregate summary:', {
    totalBatches: chunks.length,
    totalItems: allItems.length,
    totalAlreadyTracked,
    totalAutoAccepted,
    totalQueued,
    totalFailed,
    totalErrors,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error in run-bulk-import:', err);
  process.exitCode = 1;
});
