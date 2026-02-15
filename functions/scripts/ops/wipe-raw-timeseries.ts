// Set env vars / emulator BEFORE other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from '../scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[wipe-raw-timeseries]', ...args);
}

function isDryRun(): boolean {
  return process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
}

function parseSymbolsFromArgs(): string[] | null {
  const args = process.argv.slice(2);

  let raw: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--symbols=')) {
      raw = arg.slice('--symbols='.length);
      break;
    }
    if (arg === '--symbols' || arg === '--symbol') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        raw = next;
        break;
      }
    }
  }

  if (!raw) return null;

  const parts = raw.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .sort();

  return parts.length ? parts : null;
}

async function getSymbols(): Promise<string[]> {
  // Prefer explicit CLI flags over any environment variables for safety.
  const fromArgs = parseSymbolsFromArgs();
  if (fromArgs && fromArgs.length > 0) {
    return fromArgs;
  }

  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map((d) => d.id.toUpperCase()).sort();
}

async function deleteCollection(path: string, batchSize = 400): Promise<number> {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

/**
 * Delete a raw `time-series` doc and all of its subcollections.
 *
 * This will NOT touch `sa-time-series`; callers are responsible for only
 * passing in document refs under `/symbol-data/{symbol}/time-series`.
 */
async function deleteTimeSeriesDocWithSubcollections(docRef: FirebaseFirestore.DocumentReference, dryRun: boolean): Promise<number> {
  let deleted = 0;

  const subcollections = await docRef.listCollections();
  for (const col of subcollections) {
    const count = await deleteCollection(col.path);
    deleted += count;
  }

  if (!dryRun) {
    await docRef.delete();
  }
  deleted += 1;

  return deleted;
}

async function wipeRawTimeSeriesForSymbol(symbol: string, dryRun: boolean): Promise<void> {
  const symbolDocRef = db.collection('symbol-data').doc(symbol);
  const tsColRef = symbolDocRef.collection('time-series');
  const tsSnap = await tsColRef.get();

  if (tsSnap.empty) {
    log(symbol, 'no raw time-series docs found');
    return;
  }

  log(symbol, `found ${tsSnap.size} raw time-series doc(s)`);

  let totalDeleted = 0;
  for (const tsDoc of tsSnap.docs) {
    log(symbol, 'deleting raw time-series doc', tsDoc.ref.path, dryRun ? '(dry run)' : '');
    const deletedCount = await deleteTimeSeriesDocWithSubcollections(tsDoc.ref, dryRun);
    totalDeleted += deletedCount;
  }

  log(symbol, `deleted ${totalDeleted} raw time-series document(s)/subdocument(s)`);
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const symbols = await getSymbols();

  log(`starting wipe-raw-timeseries for ${symbols.length} symbol(s) :: dryRun=${dryRun}`);

  for (const symbol of symbols) {
    try {
      await wipeRawTimeSeriesForSymbol(symbol, dryRun);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[wipe-raw-timeseries]', symbol, 'error', err);
    }
  }

  log('completed wipe-raw-timeseries');
}

// eslint-disable-next-line no-floating-promises
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[wipe-raw-timeseries] fatal error', err);
  process.exit(1);
});
