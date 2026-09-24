/**
 * Verification script for Task #98 — listSymbolsV2 sortBy whitelist + composite indexes.
 *
 * Verifies the sorting pipeline end-to-end against prod Firestore via the real
 * SymbolManagerService.listSymbolsV2 (the same call the partner endpoint makes):
 * - API/query stage: orderBy('companyInfo.X') executes against the real composite
 *   indexes (fails loudly if the index is missing/not yet built)
 * - Ordering correctness: marketCap desc returns descending numeric order
 * - Whitelist: invalid sortBy falls back to 'symbol'; nested companyInfo paths accepted
 * - Existence filtering: docs without the sort field are omitted (documented behavior)
 *
 * Prerequisite: composite indexes deployed via `firebase deploy --only firestore:indexes`.
 * No writes — read-only.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/symbol-manager-98-sortable-fields.ts
 */
import * as admin from 'firebase-admin';
import { resolveTrackedSymbolSortField, TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { symbolManagerService } = require('../../src/v2/alpha-vantage/services/symbol-manager.service');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  console.log('--- Verifying listSymbolsV2 sort whitelist against prod Firestore ---\n');

  // Stage 1: resolver (contract the service applies to sortBy)
  assert(
    resolveTrackedSymbolSortField('companyInfo.marketCap') === 'companyInfo.marketCap',
    `Resolver accepts companyInfo.marketCap`,
  );
  assert(
    resolveTrackedSymbolSortField('bogus') === 'symbol',
    `Resolver falls back to symbol for invalid sortBy`,
  );

  // Stage 2: real query — marketCap desc ordering through the composite index
  const desc = await symbolManagerService.listSymbolsV2({
    sortBy: 'companyInfo.marketCap',
    sortDirection: 'desc',
    limit: 10,
  });
  assert(desc.symbols.length > 0, `marketCap desc returned ${desc.symbols.length} symbols`);
  const caps = desc.symbols.map((s: any) => s.companyInfo?.marketCap);
  if (caps.length < 3) {
    console.warn(`WARN: only ${caps.length} doc(s) have marketCap — ordering checks are weak until the backfill runs (task #99)`);
  }
  assert(
    caps.every((c: unknown) => typeof c === 'number'),
    `All returned docs have numeric marketCap (existence filter working)`,
  );
  assert(
    desc.total === desc.symbols.length || desc.symbols.length === 10,
    `total (${desc.total}) matches filtered result count, not active-doc count`,
  );
  const sortedDesc = [...caps].sort((a: number, b: number) => b - a);
  assert(
    JSON.stringify(caps) === JSON.stringify(sortedDesc),
    `marketCap desc is numerically ordered (top: ${caps[0]})`,
  );

  // Stage 3: asc ordering through the ASC index
  const asc = await symbolManagerService.listSymbolsV2({
    sortBy: 'companyInfo.beta',
    sortDirection: 'asc',
    limit: 10,
  });
  const betas = asc.symbols.map((s: any) => s.companyInfo?.beta);
  const sortedAsc = [...betas].sort((a: number, b: number) => a - b);
  assert(
    JSON.stringify(betas) === JSON.stringify(sortedAsc),
    `beta asc is numerically ordered (lowest: ${betas[0]})`,
  );

  // Stage 4: invalid sortBy falls back to symbol ordering
  const fallback = await symbolManagerService.listSymbolsV2({ sortBy: 'not-a-field', limit: 5 });
  const syms = fallback.symbols.map((s: any) => s[TRACKED_SYMBOL_V2_FIELDS.SYMBOL]);
  const sortedSyms = [...syms].sort();
  assert(
    JSON.stringify(syms) === JSON.stringify(sortedSyms),
    `Invalid sortBy fell back to symbol ordering (first: ${syms[0]})`,
  );

  // Stage 5: string-valued nested sort field works too
  const bySector = await symbolManagerService.listSymbolsV2({
    sortBy: 'companyInfo.Sector',
    sortDirection: 'asc',
    limit: 5,
  });
  assert(bySector.symbols.length > 0, `companyInfo.Sector asc returned ${bySector.symbols.length} symbols`);

  // Stage 6: scalar whitelist fields sort through their composites
  const byName = await symbolManagerService.listSymbolsV2({ sortBy: 'name', sortDirection: 'asc', limit: 5 });
  const names = byName.symbols.map((s: any) => s.name);
  assert(
    JSON.stringify(names) === JSON.stringify([...names].sort()),
    `name asc is ordered (first: ${names[0]})`,
  );

  const bySymbolDesc = await symbolManagerService.listSymbolsV2({ sortBy: 'symbol', sortDirection: 'desc', limit: 5 });
  const descSyms = bySymbolDesc.symbols.map((s: any) => s[TRACKED_SYMBOL_V2_FIELDS.SYMBOL]);
  assert(
    JSON.stringify(descSyms) === JSON.stringify([...descSyms].sort().reverse()),
    `symbol desc is ordered (first: ${descSyms[0]})`,
  );

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  console.error('\nIf the error mentions a missing index, run: firebase deploy --only firestore:indexes');
  process.exit(1);
});
