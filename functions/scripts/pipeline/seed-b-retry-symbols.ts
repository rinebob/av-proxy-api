import { db } from '../src/firebase-admin-init';

import { FirestoreCollection } from '@shared/firestore';

/**
 * One-off utility script to seed a specific realtime B run's retrySymbols
 * array with the full tracked-symbols universe.
 *
 * Usage (from functions/ directory):
 *
 *   $env:RUN_ID="2026-02-10-B-DAILY-2100-LIVE-POST"; \
 *   npx ts-node -r tsconfig-paths/register pipeline/seed-b-retry-symbols.ts
 *
 * Optionally, to seed a specific subset of symbols instead of the full
 * tracked universe, set SYMBOLS as a comma-separated list (case-insensitive):
 *
 *   $env:RUN_ID="2026-02-10-B-DAILY-2100-LIVE-POST"; \
 *   $env:SYMBOLS="AAPL,MSFT,NVDA"; \
 *   npx ts-node -r tsconfig-paths/register pipeline/seed-b-retry-symbols.ts
 */

async function main(): Promise<void> {
  const runId = String(process.env.RUN_ID || '').trim();
  if (!runId) {
    // eslint-disable-next-line no-console
    console.error('Missing required env var RUN_ID (target realtime runId).');
    process.exit(1);
  }

  // Load symbol list: explicit SYMBOLS env override if provided, otherwise
  // use the full tracked-symbols universe from Firestore.
  const symbolsEnv = String(process.env.SYMBOLS || '').trim();
  let symbols: string[];

  if (symbolsEnv) {
    symbols = symbolsEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase())
      .sort();
  } else {
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = symbolsSnap.docs.map((d) => d.id.toUpperCase()).sort();
  }

  if (symbols.length === 0) {
    // eslint-disable-next-line no-console
    console.error('No tracked symbols found under TRACKED_SYMBOLS; nothing to seed.');
    process.exit(1);
  }

  const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);
  const runSnap = await runRef.get();
  if (!runSnap.exists) {
    // eslint-disable-next-line no-console
    console.error(`Realtime run doc not found for runId=${runId} under REALTIME_RUNS.`);
    process.exit(1);
  }

  await runRef.set(
    {
      retrySymbols: symbols,
    },
    { merge: true },
  );

  // eslint-disable-next-line no-console
  console.log(`Seeded retrySymbols on runId=${runId} with ${symbols.length} tracked symbols.`);
}

// Execute when invoked as a script.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-b-retry-symbols.main.error', err);
  process.exit(1);
});
