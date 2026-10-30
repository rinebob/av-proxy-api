/**
 * Run-all verification script.
 * Runs every verification script in the documented order and reports pass/fail.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/run-all.ts
 */
import { execSync } from 'child_process';
import * as path from 'path';

const scripts = [
  'earnings-38-sa-endpoint-types.ts',
  'earnings-39-config-changes.ts',
  'earnings-40-csv-parser.ts',
  'earnings-41-earnings-handler.ts',
  'earnings-42-earnings-estimates-handler.ts',
  'earnings-43-earnings-calendar-handler.ts',
  'earnings-44-factory-registration.ts',
  'symbol-manager-97-companyinfo-writeback.ts',
  'symbol-manager-98-sortable-fields.ts',
  'options-data-122-zigzag-engine.ts',
  'options-data-123-swing-set-types.ts',
  'options-data-168-symbol-metric-types.ts',
  'options-data-219-pick-grid-types.ts',
  'options-data-221-pick-cells.ts',
  'ops-119-firestore-indexes.ts',
  'ops-sms-alerts-205-compose-texts.ts',
  // ops-sms-alerts-204-emit-alert.ts — mutating (writes + deletes an
  // ops-alerts/verify:* doc in prod), run manually
  // ops-sms-alerts-206-send-once-guard.ts — mutating (writes + deletes
  // ops-alert-claims/verify:* docs + scratch run doc in prod), run manually
  // ops-sms-alerts-207-intraday-signoff.ts — mutating (writes + deletes
  // intraday-runs/verify-* + ops-alert-claims + ops-alerts docs in prod),
  // run manually
  // ops-sms-alerts-208-post-a-signoff.ts — mutating (writes + deletes
  // realtime-runs/verify-* siblings + ops-alert-claims + ops-alerts docs in
  // prod), run manually
  // options-data-124-swing-set-data-layer.ts — mutating (writes + deletes a
  // ZZTEST probe doc in prod), run manually
  // options-data-125-swing-set-generation.ts — mutating (writes + deletes
  // four options-swing-sets docs in prod), run manually
  // options-data-126-swing-set-task.ts — mutating (writes + deletes
  // tracked-symbols/ZZTEST + ZZTEST_* docs in prod), run manually
  // options-data-127-swing-set-sweep.ts — mutating (same ZZTEST pattern +
  // baseline sweep can regenerate real enabled symbols), run manually
  // options-data-128-partner-swing-sets.ts — mutating (writes + deletes
  // tracked-symbols/ZZTEST + ZZTEST_* docs in prod), run manually
  // options-data-222-cell-writer.ts — mutating (writes + deletes
  // options-delta-picks/ZZTEST-put-20-45/years/{2099,2100} docs), run manually
  // options-data-223-materialize-picks.ts — mutating (writes the REAL
  // {SYM}-*/years/* cell docs — the materialization artifact itself), run manually
];

let passed = 0;
let failed = 0;

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n========== Running ${script} ==========`);
  try {
    execSync(`npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json "${scriptPath}"`, {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '../..'),
    });
    passed++;
    console.log(`PASS: ${script}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${script}`);
  }
}

console.log(`\n========== Summary ==========`);
console.log(`Passed: ${passed}/${scripts.length}`);
console.log(`Failed: ${failed}/${scripts.length}`);

if (failed > 0) {
  process.exit(1);
}
