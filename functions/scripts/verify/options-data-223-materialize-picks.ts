/**
 * Verification script for Task #223 — pick materialization fanout.
 *
 * Runs the real materializeSymbolPicks core against prod for one symbol
 * (default QQQ): lists stored corpus dates, loads each chain once, runs
 * pickCellsForDate, merges through mergeDayEntries — the same deps wiring
 * as processOptionsDeltaPickMaterializeTask (GCS reads only, zero AV
 * calls). Then asserts all 380 `{SYM}` cell-year docs exist with
 * `days` entries, and re-runs to prove the idempotent no-op.
 *
 * Mutating: writes the REAL options-delta-picks cell-year docs for the
 * target symbol — that materialization IS the task's deliverable, not a
 * probe, so nothing is cleaned up. Run manually — not part of run-all.ts.
 *
 * Requires ADC auth with GCS read + Firestore read/write on prod.
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-223-materialize-picks.ts
 *   ... options-data-223-materialize-picks.ts --symbol QQQ [--date 2026-04-01]
 */
import { admin, db } from '../../src/firebase-admin-init';
import { optionsCorpusBucket } from '../../src/v2/historical-options-corpus/types';
import { GcsCorpusAdapter } from '../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { materializeSymbolPicks } from '../../src/v2/historical-options-corpus/services/pick-materialize.service';
import { DailyAdjustedReader } from '../../src/v2/swing-set/services/daily-adjusted-reader.service';
import type { AvOptionContract } from '@shared/alpha-vantage';
import {
  PICK_GRID,
  PICK_GRID_VERSION,
  buildCellId,
  cellYearDocPath,
  isPickEntry,
  type CellYearDoc,
} from '@shared/options';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const args = process.argv.slice(2);
/** Flag value must exist and not be another flag — a missing value must
 *  never silently widen a --date-bound run into a full materialization. */
const argOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`FAIL: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
};
const SYMBOL = (argOf('--symbol') ?? 'QQQ').toUpperCase();
const ONLY_DATE = argOf('--date');

async function main(): Promise<void> {
  const gcs = new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket()));
  const bars = new DailyAdjustedReader(db);
  const closes = new Map((await bars.read(SYMBOL)).map((b) => [b.date, b.adjustedClose]));
  const deps = {
    db,
    listCorpusDates: async (s: string) => (await gcs.listItems(s)).map((r) => r.date),
    loadChain: async (s: string, d: string): Promise<AvOptionContract[] | undefined> => {
      const r = await gcs.readItem(s, d);
      if (r.status === 'NOT_FOUND') return undefined;
      if (r.status === 'CORRUPT') throw new Error(`corrupt ${s}/${d}: ${r.reason ?? 'unknown'}`);
      return r.response.data;
    },
    loadCloses: async () => closes,
    logger: {
      info: (m: string, meta?: Record<string, unknown>) => console.log(`INFO ${m}`, meta ?? ''),
      warn: (m: string, meta?: Record<string, unknown>) => console.warn(`WARN ${m}`, meta ?? ''),
    },
  };

  const report = await materializeSymbolPicks(
    { symbol: SYMBOL, dates: ONLY_DATE === undefined ? undefined : [ONLY_DATE] },
    deps,
  );
  console.log('materialization report:', JSON.stringify(report, null, 2));

  assert(report.datesSeen > 0, `${SYMBOL}: stored corpus dates were walked (datesSeen=${report.datesSeen})`);
  assert(report.loadFailures.length === 0, `${SYMBOL}: zero chain-load failures`);
  assert(report.datesPicked > 0, `${SYMBOL}: at least one chain picked (datesPicked=${report.datesPicked})`);
  assert(report.daysWritten + report.daysSkipped > 0,
    `${SYMBOL}: day entries were produced (written=${report.daysWritten}, skipped=${report.daysSkipped})`);

  // --- Read back every cell-year doc ------------------------------------
  // Days counted only for the dates this run walked, so --date mode still
  // asserts correctly on a doc that already holds other dates.
  const runDates = ONLY_DATE === undefined ? undefined : new Set([ONLY_DATE]);
  const year = Number((ONLY_DATE ?? '2026').slice(0, 4));
  const cellIds = PICK_GRID.map((c) => buildCellId(SYMBOL, c.type, c.deltaPct, c.dte));
  let docsFound = 0;
  let daysTotal = 0;
  let pickEntries = 0;
  let badVersion = 0;
  for (const cellId of cellIds) {
    const snap = await db.doc(cellYearDocPath(cellId, year)).get();
    if (!snap.exists) continue;
    docsFound += 1;
    const doc = snap.data() as CellYearDoc;
    if (doc.gridVersion !== PICK_GRID_VERSION) badVersion += 1;
    for (const [day, entry] of Object.entries(doc.days ?? {})) {
      if (runDates !== undefined && !runDates.has(day)) continue;
      daysTotal += 1;
      if (isPickEntry(entry)) pickEntries += 1;
    }
  }

  assert(docsFound === 380, `all 380 ${SYMBOL}-*/years/${year} cell docs materialized (found ${docsFound})`);
  assert(daysTotal > 0, `cell docs carry days entries (total ${daysTotal})`);
  assert(daysTotal === 380 * (report.datesPicked + report.datesNoChain),
    `day-entry total matches walked dates (${daysTotal} == 380×${report.datesPicked + report.datesNoChain})`);
  assert(pickEntries > 0, `at least one real pick entry materialized (${pickEntries} picks)`);
  assert(badVersion === 0, `every doc carries gridVersion=${PICK_GRID_VERSION}`);

  // --- Idempotent re-run --------------------------------------------------
  const rerun = await materializeSymbolPicks(
    { symbol: SYMBOL, dates: ONLY_DATE === undefined ? undefined : [ONLY_DATE] },
    deps,
  );
  assert(rerun.daysWritten === 0, `idempotent re-run wrote nothing (daysWritten=${rerun.daysWritten})`);
  assert(rerun.daysSkipped === 380 * (report.datesPicked + report.datesNoChain),
    `re-run skipped all ${daysTotal} existing entries`);

  console.log(`\nALL CHECKS PASSED — ${SYMBOL} materialized: ${docsFound} cell docs, ${daysTotal} day entries, ${pickEntries} picks`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
