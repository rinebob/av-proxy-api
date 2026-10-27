/**
 * Verification script for Task #219 — delta-pick grid config + pick types.
 *
 * Verifies the compiled shared package exports and the cellId codec against
 * the REAL enabled-symbol universe in prod Firestore:
 * - PICK_GRID enumerates exactly 380 cells (19 deltas x 10 DTEs x 2 types),
 *   no duplicates.
 * - For every optionsEnabled symbol in prod tracked-symbols, all 380 cellIds
 *   build + parse round-trip losslessly (~49k ids across the full universe).
 * - cellYearDocPath yields a valid Firestore document path (even segments)
 *   under options-delta-picks/{cell}/years/{YYYY}.
 *
 * Read-only — no writes.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-219-pick-grid-types.ts
 */
import * as admin from 'firebase-admin';
import {
  OPTIONS_DELTA_PICKS_COLLECTION,
  OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION,
  PICK_GRID_VERSION,
  PICK_GRID,
  PICK_GRID_DELTA_PCTS,
  PICK_GRID_DTES,
  buildCellId,
  parseCellId,
  cellYearDocPath,
} from '@shared/options';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main() {
  // 1. Grid shape — the locked 19 x 10 x 2 = 380 cell universe.
  assert(PICK_GRID.length === 380, `PICK_GRID enumerates 380 cells (got ${PICK_GRID.length})`);
  assert(PICK_GRID_DELTA_PCTS.length === 19, '19 delta magnitudes');
  assert(PICK_GRID_DTES.length === 10, '10 DTE targets');
  const cellKeys = new Set(PICK_GRID.map((c) => `${c.type}-${c.deltaPct}-${c.dte}`));
  assert(cellKeys.size === 380, 'all 380 cells unique');
  assert(PICK_GRID_VERSION === 1, 'gridVersion is 1');

  // 2. Real enabled universe from prod.
  const snap = await db
    .collection(FirestoreCollection.TRACKED_SYMBOLS)
    .where(TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED, '==', true)
    .get();
  const symbols = snap.docs.map((d) => d.id).sort();
  assert(symbols.length > 0, `prod tracked-symbols optionsEnabled universe loaded (${symbols.length} symbols)`);
  console.log(`   symbols: ${symbols.slice(0, 5).join(', ')} ... (${symbols.length} total)`);

  // 3. Round-trip every cellId across the full universe.
  let roundTripped = 0;
  for (const symbol of symbols) {
    for (const cell of PICK_GRID) {
      const id = buildCellId(symbol, cell.type, cell.deltaPct, cell.dte);
      const parsed = parseCellId(id);
      if (!parsed) {
        console.error(`FAIL: parseCellId rejected a built id: ${id}`);
        process.exit(1);
      }
      if (
        parsed.symbol !== symbol.toUpperCase() ||
        parsed.type !== cell.type ||
        parsed.deltaPct !== cell.deltaPct ||
        parsed.dte !== cell.dte
      ) {
        console.error(`FAIL: round-trip mismatch on ${id} -> ${JSON.stringify(parsed)}`);
        process.exit(1);
      }
      roundTripped++;
    }
  }
  console.log(`PASS: ${roundTripped} cellIds round-tripped losslessly across ${symbols.length} symbols`);
  console.log(`   (full-universe year shard count would be ${symbols.length * PICK_GRID.length} cell docs/year)`);

  // 4. Doc path shape — even segment count, matches SPEC layout.
  const path = cellYearDocPath('QQQ-put-20-45', 2026);
  assert(
    path === `${OPTIONS_DELTA_PICKS_COLLECTION}/QQQ-put-20-45/${OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION}/2026`,
    `cellYearDocPath: ${path}`,
  );
  assert(path.split('/').length % 2 === 0, 'doc path has even segment count (valid doc reference)');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
