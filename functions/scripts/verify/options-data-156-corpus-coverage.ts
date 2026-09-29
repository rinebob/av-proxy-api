/**
 * Verification script for Task #156 — corpus coverage report surface.
 *
 * Runs the real coverage core against prod: enumerates the live
 * options-enabled set, diffs each symbol's swing-doc pivot plan against real
 * GCS corpus objects, folds in the latest `options_corpus_runs` item status,
 * and reports per-symbol planned/seeded/missing/failed/in_flight + per-date
 * status. Read-only by construction — every dep is a read.
 *
 * Read-only. Not in run-all (scans the whole enabled set + every run's items).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-156-corpus-coverage.ts
 *   npx ts-node ... --symbols=AAPL,XOM          (subset)
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCorpusCoverageDeps, runCorpusCoverage } = require('../../src/v2/historical-options-corpus/services/corpus-coverage.service');

const VALID_STATUSES = new Set(['seeded', 'missing', 'failed', 'in_flight', 'superseded_interim', 'pre_floor', 'unplanned']);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--symbols='));
  const symbols = arg ? arg.slice('--symbols='.length).split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  console.log('--- Verifying live corpus coverage report against prod ---\n');
  const deps = createCorpusCoverageDeps();
  const report = await runCorpusCoverage(symbols, deps);

  assert(Array.isArray(report.symbols), 'symbols array present');
  assert(typeof report.generatedAt === 'string' && report.generatedAt.length > 0, 'generatedAt stamped');

  for (const s of report.symbols as any[]) {
    console.log(
      `  ${s.symbol}${s.optionsEnabled ? '' : ' (not enabled)'}: planned=${s.planned} seeded=${s.seeded} ` +
      `missing=${s.missing} failed=${s.failed} in_flight=${s.inFlight} unplanned=${s.unplanned} ` +
      `interim=${s.currentInterimDate ?? '—'}${s.error ? ` ERROR=${s.error}` : ''}`,
    );
  }

  assert(report.symbols.every((s: any) => s.seeded + s.missing + s.failed + s.inFlight === s.planned),
    'per symbol: seeded+missing+failed+in_flight = planned');
  assert(report.symbols.every((s: any) => s.dates.every((d: any) => VALID_STATUSES.has(d.status))),
    'every date row carries a known status');
  assert(report.symbols.every((s: any) => s.dates.every((d: any, i: number, arr: any[]) => i === 0 || arr[i - 1].date <= d.date)),
    'date rows sorted ascending');
  assert(report.symbols.every((s: any) => s.dates.filter((d: any) => d.status === 'failed').every((d: any) => d.runStatus !== undefined)),
    'failed rows carry the latest run-item status');

  const interims = report.symbols.filter((s: any) => s.currentInterimDate !== null);
  console.log(`\n${interims.length}/${report.symbols.length} symbol(s) have a current interim extreme`);
  for (const s of interims as any[]) {
    const row = s.dates.find((d: any) => d.date === s.currentInterimDate);
    assert(row !== undefined && row.plannedKind === 'interim',
      `${s.symbol}: currentInterimDate is a planned interim row`);
  }

  // Subset path: one enabled symbol + one bogus symbol when available.
  if (report.symbols.length > 0) {
    const one = (report.symbols as any[]).find((s) => s.optionsEnabled)?.symbol ?? report.symbols[0].symbol;
    const sub = await runCorpusCoverage([one, 'ZZTEST'], deps);
    assert(sub.symbols.length === 2, 'subset request reports exactly the requested symbols');
    assert(sub.symbols[0].symbol === one && sub.symbols[0].optionsEnabled === true, 'enabled symbol flagged');
    assert(sub.symbols[1].symbol === 'ZZTEST' && sub.symbols[1].optionsEnabled === false,
      'non-enabled symbol reported with optionsEnabled=false (not dropped)');
  }

  const failed = report.symbols.flatMap((s: any) => s.dates.filter((d: any) => d.status === 'failed').map((d: any) => `${s.symbol} ${d.date}`));
  if (failed.length > 0) {
    console.log(`\nfailed dates needing attention (${failed.length}):`);
    for (const f of failed.slice(0, 20)) console.log(`  ${f}`);
    if (failed.length > 20) console.log(`  …and ${failed.length - 20} more`);
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
