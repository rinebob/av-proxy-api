/**
 * Verification script for Task #251 — bounded primary-range reads.
 *
 * Exercises ContractAvailabilityQueryService against REAL prod data on a
 * large symbol (default QQQ, ~395k ts-contracts docs) to prove that wide
 * primary ranges no longer attempt a single unbounded `get()`:
 *
 * 1. `strikeGte=0` — a range matching ~the whole subcollection — completes
 *    inside the function time budget and reports `truncated` when the
 *    25k scanned-doc ceiling fires.
 * 2. `firstObservedLte=2999-12-31` — same for the firstObserved primary.
 * 3. A narrow `firstObserved` range completes under the ceiling with
 *    `truncated=false` — under-ceiling behavior unchanged.
 *
 * Read-only — Firestore reads only, no writes.
 * Credentials: ADC / GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-251-availability-read-ceiling.ts
 *   ... --symbol QQQ [--budget-ms 60000]
 */
import * as admin from 'firebase-admin';

import { ContractAvailabilityQueryService } from '../../src/v2/historical-options-corpus/services/contract-availability-query.service';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

function argOf(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  const val = idx >= 0 ? process.argv[idx + 1] : undefined;
  return val && !val.startsWith('--') ? val : undefined;
}
const SYMBOL = (argOf('--symbol') ?? 'QQQ').toUpperCase();
const BUDGET_MS = Number(argOf('--budget-ms') ?? 60_000);

async function timedQuery<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = Date.now();
  const result = await fn();
  return { ms: Date.now() - t0, result };
}

async function main(): Promise<void> {
  const db = admin.firestore();
  const query = new ContractAvailabilityQueryService(db);

  // ---- 1. Widest possible strike primary: completes within budget ----
  const strikes = await timedQuery(() =>
    query.queryAvailability({ symbol: SYMBOL, strikeGte: 0 }),
  );
  assert(
    strikes.ms < BUDGET_MS,
    `strikeGte=0 completes in ${(strikes.ms / 1000).toFixed(1)}s (< ${BUDGET_MS / 1000}s budget)`,
  );
  assert(
    strikes.result.contracts.length > 0 &&
      strikes.result.contracts.every((c) => c.strike >= 0),
    `strikeGte=0 → all ${strikes.result.contracts.length} entries in range`,
  );

  // ---- 2. Widest possible firstObserved primary: completes within budget ----
  const observed = await timedQuery(() =>
    query.queryAvailability({ symbol: SYMBOL, firstObservedLte: '2999-12-31' }),
  );
  assert(
    observed.ms < BUDGET_MS,
    `firstObservedLte=2999-12-31 completes in ${(observed.ms / 1000).toFixed(1)}s (< ${BUDGET_MS / 1000}s budget)`,
  );
  assert(
    observed.result.contracts.every((c) => c.firstObserved <= '2999-12-31'),
    `firstObserved wide range → all ${observed.result.contracts.length} entries in range`,
  );

  // ---- 3. Ceiling semantics on a large symbol ----
  // A range wider than the subcollection must report truncated when the
  // ceiling fires (more matches may exist beyond the scan). On a large
  // symbol both queries above should have hit it — assert at least one
  // did, so a too-small fixture doesn't silently skip the check.
  assert(
    strikes.result.truncated || observed.result.truncated,
    `ceiling fires on a large symbol (strike truncated=${strikes.result.truncated}, firstObserved truncated=${observed.result.truncated})`,
  );

  // ---- 4. Under-ceiling narrow range: full results, not truncated ----
  const day = await timedQuery(() =>
    query.queryAvailability({
      symbol: SYMBOL,
      firstObservedGte: '2020-01-02',
      firstObservedLte: '2020-01-02',
    }),
  );
  assert(
    !day.result.truncated,
    `narrow firstObserved range not truncated (${day.result.contracts.length} contracts in ${(day.ms / 1000).toFixed(1)}s)`,
  );

  console.log(`\nDONE: ${SYMBOL} — strike wide range ${(strikes.ms / 1000).toFixed(1)}s, firstObserved wide range ${(observed.ms / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
