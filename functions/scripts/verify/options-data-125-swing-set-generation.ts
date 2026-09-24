/**
 * Verification script for Task #125 — SwingSetGenerationService.
 *
 * Runs the real generation pipeline end-to-end against prod:
 * DailyAdjustedReader → zigzag engine → SwingSetRepository.upsert for all
 * four canonical configs on a real symbol, then verifies each persisted
 * doc (paramsId, source='sa', pivots/swings/stats consistency), re-runs to
 * confirm idempotency, and DELETES the generated docs on exit.
 *
 * Mutating — writes then deletes options-swing-sets/{SYMBOL}_{paramsId} ×4.
 * Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-125-swing-set-generation.ts [SYMBOL]
 *   Default SYMBOL: AAPL
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
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
  const paramsIds = CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId);
  console.log(`--- Verifying SwingSetGenerationService against prod (${symbol}) ---\n`);

  const writtenIds = paramsIds.map((p) => `${symbol}_${p}`);

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
    // Stage 1: generate all four canonical docs
    const result = await service.generateForSymbol(symbol);
    assert(!result.skipped, `${symbol}: generation not skipped`);
    assert(JSON.stringify(result.generated) === JSON.stringify(paramsIds),
      `generated paramsIds = ${result.generated.join(', ')}`);

    for (const paramsId of paramsIds) {
      const doc = await repo.get(symbol, paramsId);
      assert(doc !== null, `${paramsId}: doc persisted`);
      assert(doc!.symbol === symbol && doc!.source === 'sa', `${paramsId}: symbol/source fields correct`);
      assert(doc!.pivots.length > 0, `${paramsId}: ${doc!.pivots.length} confirmed pivots`);
      assert(
        doc!.swings.length === doc!.pivots.length - 1 + (doc!.projection ? 1 : 0),
        `${paramsId}: swings count consistent`,
      );
      assert(
        doc!.stats.up.count + doc!.stats.down.count === doc!.swings.filter((s: { confirmed: boolean }) => s.confirmed).length,
        `${paramsId}: stats counts match confirmed swings`,
      );
      assert(doc!.generatedAt.seconds > 0, `${paramsId}: generatedAt set`);
      console.log(`  → ${symbol}_${paramsId}: ${doc!.pivots.length} pivots, ${doc!.swings.length} swings`);
    }

    // Stage 2: idempotency — re-run produces identical docs except generatedAt
    const before = await repo.get(symbol, paramsIds[1]);
    await service.generateForSymbol(symbol);
    const after = await repo.get(symbol, paramsIds[1]);
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
      all.length === 4 && paramsIds.every((p) => all.some((d: SwingSetDoc) => d.paramsId === p)),
      'listBySymbol returns exactly the four canonical docs (no duplicates)',
    );
  } finally {
    for (const id of writtenIds) {
      await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${id}`).delete();
    }
    console.log(`cleanup: deleted ${writtenIds.length} ${symbol} docs`);
  }

  const leftover = await repo.listBySymbol(symbol);
  assert(leftover.length === 0, 'all generated docs deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
