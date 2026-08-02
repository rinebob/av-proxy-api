/**
 * One-off script: re-runs the contract summary aggregator for given symbols.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-summary.ts
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-summary.ts --symbols=QQQ,TQQQ
 *   npx ts-node -r tsconfig-paths/register scripts/refresh-summary.ts --dry-run
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
} from '@shared/options';
import { ContractSummaryAggregator } from '../src/v2/historical-options-corpus/services/contract-summary-aggregator.service';

const db = admin.firestore();

async function main(): Promise<void> {
  const symbolsArg = process.argv.find((a) => a.startsWith('--symbols='));
  const symbols = symbolsArg
    ? symbolsArg.slice('--symbols='.length).split(',').map((s) => s.trim().toUpperCase())
    : ['QQQ', 'TQQQ'];
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (will overwrite summary docs)'}`);
  console.log(`Symbols: ${symbols.join(', ')}`);

  if (dryRun) {
    for (const symbol of symbols) {
      console.log(`\n=== Checking ${symbol} (dry run) ===`);
      try {
        const colRef = db
          .collection(OPTIONS_FILE_INDEX_COLLECTION)
          .doc(symbol)
          .collection(TS_CONTRACTS_SUBCOLLECTION);

        const countSnap = await colRef.count().get();
        const docCount = countSnap.data().count;
        console.log(`  ts-contracts doc count: ${docCount}`);

        if (docCount === 0) {
          console.log('  [WARNING] No docs found — check project connection');
          continue;
        }

        const sampleSnap = await colRef.limit(1).get();
        const sample = sampleSnap.docs[0].data();
        console.log(`  Sample doc: ${sampleSnap.docs[0].id}`);
        console.log(`    contractLengthBucket: ${sample.contractLengthBucket}`);
        console.log(`    contractLengthDays: ${sample.contractLengthDays}`);
        console.log(`    expiration: ${sample.expiration}`);
        console.log(`  [OK] Connection verified. ${docCount} docs ready for aggregation.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [ERROR] ${message}`);
      }
    }
    console.log('\nDry run complete. No Firestore documents were written.');
  } else {
    const aggregator = new ContractSummaryAggregator(db);

    for (const symbol of symbols) {
      console.log(`\n=== Refreshing summary for ${symbol} ===`);
      try {
        const summary = await aggregator.aggregateAndWriteSummary(symbol);
        console.log(`  Total contracts:  ${summary.totalContracts}`);
        console.log(`  Expirations:      ${summary.expirationCount}`);
        console.log(`  Length buckets:   ${summary.lengthBuckets.length}`);
        for (const bucket of summary.lengthBuckets) {
          console.log(`    ${bucket.label.padEnd(6)} (sortOrder=${String(bucket.sortOrder).padStart(2)}) → ${bucket.count}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [ERROR] ${message}`);
      }
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
