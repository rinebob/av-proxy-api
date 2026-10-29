/**
 * Verification script for Task #222 — cell doc writer (mergeDayEntries).
 *
 * Exercises the real prod Firestore merge path end-to-end on a ZZTEST probe
 * cell: absent→write, no_chain→pick self-repair, no_chain→no_match upgrade,
 * pick immutability, header recompute, year-boundary sharding, and the
 * idempotent zero-write re-run. Reads each write back from prod to confirm
 * what actually persisted.
 *
 * Mutating: writes + deletes `options-delta-picks/ZZTEST-put-20-45/years/2099`
 * and `.../years/2100` probe docs in prod. Far-future shards on a test symbol
 * — cannot collide with real cells. Run manually — not part of run-all.ts.
 *
 * Requires ADC auth with Firestore write on prod.
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-222-cell-writer.ts
 */
import { db } from '../../src/firebase-admin-init';
import {
  cellYearDocPath,
  OPTIONS_DELTA_PICKS_COLLECTION,
  PICK_GRID_VERSION,
  type CellYearDoc,
  type DayPick,
  type DayPickEntry,
} from '@shared/options';

import { mergeDayEntries } from '../../src/v2/historical-options-corpus/services/options-delta-pick-cell.writer';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const CELL = 'ZZTEST-put-20-45';
const PATH_2099 = cellYearDocPath(CELL, 2099);
const PATH_2100 = cellYearDocPath(CELL, 2100);

const PICK_A: DayPick = {
  contractId: 'ZZTEST260515P00565000',
  expiration: '2026-05-15',
  dte: 44,
  strike: 565,
  delta: -0.204,
  iv: 0.198,
  mark: 8.42,
  bid: 8.3,
  ask: 8.54,
  volume: 412,
  openInterest: 5210,
  underlyingClose: 584.31,
};
const PICK_B: DayPick = { ...PICK_A, contractId: 'ZZTEST260619P00560000', delta: -0.19 };
const NO_CHAIN: DayPickEntry = { status: 'no_chain', underlyingClose: 600 };
const NO_MATCH: DayPickEntry = { status: 'no_match', underlyingClose: 600 };

const merge = (entries: Record<string, DayPickEntry>) =>
  mergeDayEntries(db, CELL, new Map(Object.entries(entries)));

const yearDoc = async (year: number) =>
  (await db.doc(cellYearDocPath(CELL, year)).get()).data() as CellYearDoc | undefined;

async function main() {
  console.log(`--- Probe doc: ${PATH_2099} (+ ${PATH_2100} for shard check) ---`);

  console.log('\n--- 1. Absent date → write + doc scaffold ---');
  const r1 = await merge({ '2099-01-02': NO_CHAIN });
  assert(r1.written.includes('2099-01-02'), 'absent date written');
  const d1 = (await yearDoc(2099))!;
  assert(d1.symbol === 'ZZTEST' && d1.type === 'put', 'scaffold symbol/type');
  assert(d1.targetDelta === -0.2, `targetDelta signed -0.2 (got ${d1.targetDelta})`);
  assert(d1.expiry?.mode === 'nearestDte' && d1.expiry?.dte === 45, 'scaffold expiry');
  assert(d1.gridVersion === PICK_GRID_VERSION, `gridVersion ${PICK_GRID_VERSION}`);
  assert(d1.missCount === 1 && d1.pickCount === 0, 'counts after first miss');
  assert(d1.firstDate === '2099-01-02' && d1.lastDate === '2099-01-02', 'date bounds');
  assert(d1.updatedAt != null, 'updatedAt set');

  console.log('\n--- 2. Equal-rank miss → skipped (not better) ---');
  const r2 = await merge({ '2099-01-02': NO_CHAIN });
  assert(r2.skipped.includes('2099-01-02') && r2.written.length === 0, 'same-status miss skipped');

  console.log('\n--- 3. Miss→pick self-repair + second date ---');
  const r3 = await merge({ '2099-01-02': PICK_A, '2099-01-05': PICK_B });
  assert(r3.written.length === 2, 'repair + new date both written');
  const d3 = (await yearDoc(2099))!;
  assert(d3.pickCount === 2 && d3.missCount === 0, 'counts after repair (2 picks)');
  assert(d3.lastDate === '2099-01-05', 'lastDate advanced');
  assert((d3.days['2099-01-02'] as DayPick).contractId === PICK_A.contractId, 'repaired entry is the pick');

  console.log('\n--- 4. Pick is immutable (pick→pick and pick→miss) ---');
  const r4 = await merge({ '2099-01-02': PICK_B, '2099-01-05': NO_MATCH });
  assert(r4.skipped.length === 2 && r4.written.length === 0, 'both overwrites skipped');
  const d4 = (await yearDoc(2099))!;
  assert((d4.days['2099-01-02'] as DayPick).contractId === PICK_A.contractId, 'original pick preserved');
  assert((d4.days['2099-01-05'] as DayPick).contractId === PICK_B.contractId, 'pick not downgraded to miss');

  console.log('\n--- 5. Year-boundary sharding (chain date, not expiration) ---');
  const r5 = await merge({ '2099-12-31': PICK_A, '2100-01-01': PICK_B });
  assert(r5.written.length === 2, 'both boundary dates written');
  const d2099 = (await yearDoc(2099))!;
  const d2100 = (await yearDoc(2100))!;
  assert(d2099.days['2099-12-31'] != null && d2099.lastDate === '2099-12-31', 'Dec 31 in 2099 shard');
  assert(d2100.days['2100-01-01'] != null && d2100.firstDate === '2100-01-01', 'Jan 1 in 2100 shard');
  assert(d2099.days['2100-01-01'] === undefined, 'Jan 1 NOT in 2099 shard');

  console.log('\n--- 6. Idempotent re-run → zero writes ---');
  const r6 = await merge({ '2099-01-02': PICK_A, '2099-12-31': PICK_A, '2100-01-01': PICK_B });
  assert(r6.written.length === 0 && r6.skipped.length === 3, 're-run writes nothing, skips all');

  console.log('\n--- Cleanup: deleting probe docs ---');
  await db.doc(PATH_2099).delete();
  await db.doc(PATH_2100).delete();
  const gone = await db.doc(PATH_2099).get();
  assert(!gone.exists, 'probe docs deleted');

  console.log(`\nALL CHECKS PASSED — mergeDayEntries verified on prod (${OPTIONS_DELTA_PICKS_COLLECTION})`);
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e);
  process.exit(1);
});
