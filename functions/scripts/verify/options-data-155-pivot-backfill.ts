/**
 * Verification script for Task #155 — pivot-driven backfill (dateSource: 'pivots').
 *
 * Runs the real pilot service against prod in dryRun mode: enumerates the
 * live options-enabled set, plans each symbol's corpus dates via the swing-doc
 * pivot planner, diffs against real GCS coverage, and reports per-symbol
 * counts. dryRun persists nothing — zero writes, zero task dispatch, zero AV
 * calls.
 *
 * Read-only. Not in run-all.
 *
 * Usage:
 *   $env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-155-pivot-backfill.ts
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHistoricalOptionsPilotService } = require('../../src/v2/historical-options-corpus/services/pilot.service');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  if (!process.env.OPTIONS_CORPUS_BUCKET) {
    console.error('FAIL: OPTIONS_CORPUS_BUCKET env var not set (e.g. av-hist-options-corpus-bucket)');
    process.exit(1);
  }

  console.log('--- Verifying pivot-driven backfill dry-run against prod ---\n');
  const service = createHistoricalOptionsPilotService();

  const report = await service.run({ dateSource: 'pivots', dryRun: true });

  assert(report.dateSource === 'pivots', 'dateSource is pivots');
  assert(Array.isArray(report.perSymbol), 'per-symbol report present');

  const { symbols, skippedSymbols, perSymbol, totalItems, presentItems, missingItems } = report as any;
  console.log(`enabled set: ${symbols.length} symbol(s); skipped (non-enabled): ${skippedSymbols.length}`);
  for (const s of perSymbol as any[]) {
    console.log(`  ${s.symbol}: planned=${s.planned} present=${s.present} missing=${s.missing}${s.error ? ` ERROR=${s.error}` : ''}`);
  }

  assert(perSymbol.length === symbols.length, 'one report row per enabled symbol');
  assert(totalItems === perSymbol.reduce((n: number, s: any) => n + s.planned, 0), 'totalItems = Σ planned');
  assert(missingItems === perSymbol.reduce((n: number, s: any) => n + s.missing, 0), 'missingItems = Σ missing');
  assert(presentItems === perSymbol.reduce((n: number, s: any) => n + s.present, 0), 'presentItems = Σ present');
  assert(report.executed === false && report.dryRun === true, 'dryRun: nothing dispatched');
  assert(report.manifest.every((m: any) => symbols.includes(m.symbol)),
    'manifest items only reference enabled symbols');
  for (const s of perSymbol as any[]) {
    assert(s.present + s.missing === s.planned, `${s.symbol}: present+missing=planned`);
  }
  const empty = perSymbol.filter((s: any) => s.planned === 0 && !s.error);
  if (empty.length > 0) {
    console.log(`  (symbols with no corpus pivot plan yet: ${empty.map((s: any) => s.symbol).join(', ')})`);
  }

  // Symbols-subset path: explicitly name one enabled symbol if any exist.
  if (symbols.length > 0) {
    const one = symbols[0];
    const sub = await service.run({ dateSource: 'pivots', dryRun: true, symbols: [one, 'ZZTEST'] });
    assert(sub.symbols.length === 1 && sub.skippedSymbols.includes('ZZTEST'),
      'symbols subset honored; non-enabled symbol dropped');
  }

  console.log(`\ntotals: planned=${totalItems} present=${presentItems} missing=${missingItems} (est. AV calls)`);
  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
