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
