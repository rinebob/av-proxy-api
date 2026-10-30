/**
 * Verification script for Task #244 — availability data services.
 *
 * Exercises both services against REAL prod data:
 *
 * 1. ContractAvailabilityQueryService on the live
 *    options-file-index/{symbol}/ts-contracts collection:
 *    - unfiltered query returns entries in deterministic order
 *      (expiration asc → strike asc → contractId asc) with lastUpdated
 *      stripped and `truncated` consistent with the cap
 *    - expiration range + type filter → all results inside the range
 *    - expirations list → only listed expirations returned
 *    - strikeStep → every returned strike on the integer-cent grid
 *    - unmatched symbol → empty result
 * 2. CorpusDatesService on the real corpus bucket:
 *    - sorted YYYY-MM-DD dates only (the corpus legitimately reaches back
 *      to 2019 — no lower bound is asserted)
 *    - unknown symbol → empty list
 *
 * Read-only — Firestore + GCS reads only, no writes.
 * Credentials: ADC / GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-244-availability-services.ts
 *   ... --symbol QQQ
 */
import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';

import { CONTRACT_AVAILABILITY_MAX_CONTRACTS } from '@shared/options';
import { ContractAvailabilityQueryService } from '../../src/v2/historical-options-corpus/services/contract-availability-query.service';
import { CorpusDatesService } from '../../src/v2/historical-options-corpus/services/corpus-dates.service';
import { optionsCorpusBucket } from '../../src/v2/historical-options-corpus/types';

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

function isSorted(a: { expiration: string; strike: number; contractId: string }[]): boolean {
  for (let i = 1; i < a.length; i++) {
    const [p, c] = [a[i - 1], a[i]];
    const cmp =
      p.expiration.localeCompare(c.expiration) ||
      p.strike - c.strike ||
      p.contractId.localeCompare(c.contractId);
    if (cmp > 0) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const db = admin.firestore();
  const bucket = getStorage().bucket(optionsCorpusBucket());
  const query = new ContractAvailabilityQueryService(db);
  const dates = new CorpusDatesService(bucket);

  // ---- 1. Unfiltered query: shape, ordering, strip ----
  const all = await query.queryAvailability({ symbol: SYMBOL });
  assert(all.contracts.length > 0, `${SYMBOL} returns contracts (${all.contracts.length})`);
  assert(
    all.contracts.every((c) => c.contractId && c.expiration && typeof c.strike === 'number'),
    'every entry has contractId + expiration + strike',
  );
  assert(all.contracts.every((c) => !('lastUpdated' in c)), 'lastUpdated stripped from entries');
  assert(isSorted(all.contracts), 'entries in deterministic order (expiration → strike → contractId)');
  assert(
    !all.truncated || all.contracts.length === CONTRACT_AVAILABILITY_MAX_CONTRACTS,
    `truncated implies exactly ${CONTRACT_AVAILABILITY_MAX_CONTRACTS} returned`,
  );

  // ---- 2. Expiration range + type: every result inside bounds ----
  const expirations = [...new Set(all.contracts.map((c) => c.expiration))].sort();
  const range = await query.queryAvailability({
    symbol: SYMBOL,
    expirationGte: expirations[0],
    expirationLte: expirations[0],
    type: 'put',
  });
  assert(
    range.contracts.every(
      (c) => c.expiration === expirations[0] && c.type === 'put',
    ),
    `expiration=${expirations[0]} + type=put → only matching contracts (${range.contracts.length})`,
  );

  // ---- 2b. type + firstObserved / type + strike primaries ----
  // These two shapes require the composite indexes added for this task:
  // (type, firstObserved) and (type, strike). They FAILED_PRECONDITION
  // until `firebase deploy --only firestore:indexes` has run.
  const byFirstObserved = await query.queryAvailability({
    symbol: SYMBOL,
    type: 'call',
    firstObservedGte: '2000-01-01',
  });
  assert(
    byFirstObserved.contracts.every((c) => c.type === 'call' && c.firstObserved >= '2000-01-01'),
    `type=call + firstObservedGte → composite index path works (${byFirstObserved.contracts.length})`,
  );
  const byStrike = await query.queryAvailability({
    symbol: SYMBOL,
    type: 'call',
    strikeGte: 0,
  });
  assert(
    byStrike.contracts.every((c) => c.type === 'call' && c.strike >= 0),
    `type=call + strikeGte → composite index path works (${byStrike.contracts.length})`,
  );

  // ---- 3. expirations list: only listed expirations ----
  const two = expirations.slice(0, 2);
  const byList = await query.queryAvailability({ symbol: SYMBOL, expirations: two });
  assert(
    byList.contracts.every((c) => two.includes(c.expiration)),
    `expirations=[${two.join(',')}] → only listed expirations (${byList.contracts.length})`,
  );

  // ---- 4. strikeStep: integer-cent grid ----
  const stepped = await query.queryAvailability({ symbol: SYMBOL, strikeStep: 10 });
  assert(
    stepped.contracts.every((c) => Math.round(c.strike * 100) % 1000 === 0),
    `strikeStep=10 → all strikes on $10 grid (${stepped.contracts.length})`,
  );

  // ---- 5. Unmatched symbol → empty ----
  const none = await query.queryAvailability({ symbol: 'ZZTEST-NOSUCH' });
  assert(none.contracts.length === 0 && none.truncated === false, 'unmatched symbol → empty, not truncated');

  // ---- 6. Corpus dates: sorted dates only ----
  const corpusDates = await dates.listCorpusDates(SYMBOL);
  assert(corpusDates.length > 0, `${SYMBOL} corpus dates present (${corpusDates.length})`);
  // The corpus predates the 2026-01-01 materialization floor (backfill
  // reaches 2019+) — the service lists every stored date; only the shape
  // and sort order are endpoint guarantees.
  assert(
    corpusDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    'all corpus dates are YYYY-MM-DD',
  );
  assert(
    corpusDates.every((d, i) => i === 0 || d > corpusDates[i - 1]),
    'corpus dates strictly ascending',
  );

  // ---- 7. Unknown symbol → empty dates ----
  const noDates = await dates.listCorpusDates('ZZTEST-NOSUCH');
  assert(noDates.length === 0, 'unknown symbol → empty corpus dates');

  console.log(`\nDONE: ${SYMBOL} — ${all.contracts.length} contracts (truncated=${all.truncated}), ${corpusDates.length} corpus dates`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
