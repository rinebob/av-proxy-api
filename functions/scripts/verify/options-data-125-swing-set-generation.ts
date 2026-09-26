/**
 * Verification script for Task #125 — SwingSetGenerationService.
 *
 * Runs the real generation pipeline end-to-end against prod:
 * DailyAdjustedReader → zigzag engine → SwingSetRepository.upsert for the
 * corpus config on a real symbol, then verifies the persisted doc
 * (paramsId, source='sa', pivotDates/currentExtreme), re-runs to
 * confirm idempotency, and DELETES the generated doc on exit.
 *
 * Mutating — writes then deletes options-swing-sets/{SYMBOL}_{paramsId}.
 * Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-125-swing-set-generation.ts [SYMBOL]
 *   Default SYMBOL: AAPL
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwingSetRepository } = require('../../src/v2/swing-set/services/swing-set.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwingSetGenerationService } = require('../../src/v2/swing-set/services/swing-set-generation.service');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  const repo = new SwingSetRepository(db);
  const service = new SwingSetGenerationService(new DailyAdjustedReader(db), repo, console);
  const paramsId = deriveParamsId(CORPUS_ZIGZAG_CONFIG);
  console.log(`--- Verifying SwingSetGenerationService against prod (${symbol}) ---\n`);

  const docId = `${symbol}_${paramsId}`;

  // Pre-flight: refuse to clobber existing docs — this script overwrites then
  // deletes, so running it against real generated data would destroy it.
  const existing = await repo.listBySymbol(symbol);
  if (existing.length > 0) {
    console.error(
      `FAIL: ${existing.length} options-swing-sets docs already exist for ${symbol} ` +
        `(${existing.map((d: SwingSetDoc) => d.paramsId).join(', ')}). ` +
        `This script overwrites then deletes them — use a symbol with no existing sets.`,
    );
    process.exit(1);
  }

  try {
    // Stage 1: generate the corpus doc
    const result = await service.generateForSymbol(symbol);
    assert(!result.skipped, `${symbol}: generation not skipped`);
    assert(result.generated.length === 1 && result.generated[0] === paramsId,
      `generated paramsId = ${result.generated.join(', ')}`);

    const doc = await repo.get(symbol, paramsId);
    assert(doc !== null, `${paramsId}: doc persisted`);
    assert(doc!.symbol === symbol && doc!.source === 'sa', `${paramsId}: symbol/source fields correct`);
    assert(doc!.pivotDates.length > 0, `${paramsId}: ${doc!.pivotDates.length} confirmed pivot dates`);
    assert(doc!.currentExtremeDate !== null, `${paramsId}: currentExtremeDate set`);
    assert(doc!.generatedAt.seconds > 0, `${paramsId}: generatedAt set`);
    console.log(`  → ${docId}: ${doc!.pivotDates.length} pivot dates, extreme=${doc!.currentExtremeDate}`);

    // Stage 2: idempotency — re-run produces identical doc except generatedAt
    const before = await repo.get(symbol, paramsId);
    await service.generateForSymbol(symbol);
    const after = await repo.get(symbol, paramsId);
    const strip = (d: SwingSetDoc | null) => {
      const { generatedAt: _g, ...rest } = d!;
      return rest;
    };
    assert(
      JSON.stringify(strip(before)) === JSON.stringify(strip(after)),
      're-generation produces identical doc payload (idempotent)',
    );
    const all = await repo.listBySymbol(symbol);
    assert(
      all.length === 1 && all[0].paramsId === paramsId,
      'listBySymbol returns exactly the corpus doc (no duplicates)',
    );
  } finally {
    await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${docId}`).delete();
    console.log(`cleanup: deleted ${docId}`);
  }

  const leftover = await repo.listBySymbol(symbol);
  assert(leftover.length === 0, 'generated doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
