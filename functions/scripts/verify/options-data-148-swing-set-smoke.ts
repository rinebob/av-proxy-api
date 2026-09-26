/**
 * Post-deploy smoke script — Task #148.
 *
 * BLACK-BOX check: calls the DEPLOYED swing-set functions over HTTPS (unlike
 * the per-task verify scripts, which inject deps at the handler seam).
 *
 * 1. backfillSwingSets — POST {dryRun:true} with x-admin-secret (no writes)
 * 2. Confirms sweepSwingSets + generateSwingSetsTask exist via
 *    `firebase functions:list`
 *
 * Auth: `SWING_SET_ADMIN_SECRET=<value>` env var (operator-held; never in
 * the repo).
 *
 * Optional: --symbol <SYM> narrows the dryRun report to one symbol
 * (defaults to all enabled symbols).
 *
 * Read-only — the backfill call is dryRun:true, no prod writes.
 *
 * Usage:
 *   $env:SWING_SET_ADMIN_SECRET='...'
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-148-swing-set-smoke.ts --symbol AAPL
 */
import { execSync } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios');

const REGION = 'us-central1';
const PROJECT = 'alpha-vantage-proxy-api';
const BASE = `https://${REGION}-${PROJECT}.cloudfunctions.net`;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const symbol = arg('symbol')?.toUpperCase();

  console.log('--- Smoke: deployed swing-set functions ---\n');

  // ── 1. backfillSwingSets dryRun with x-admin-secret (no writes) ───────────
  const adminSecret = process.env.SWING_SET_ADMIN_SECRET;
  if (!adminSecret) {
    console.error('FAIL: SWING_SET_ADMIN_SECRET env var required');
    process.exit(1);
  }
  const r4 = await axios.post(
    `${BASE}/backfillSwingSets`,
    symbol ? { symbols: [symbol], dryRun: true } : { dryRun: true },
    { headers: { 'x-admin-secret': adminSecret }, validateStatus: () => true },
  );
  assert(r4.status === 200, `backfillSwingSets dryRun → 200 (got ${r4.status}: ${JSON.stringify(r4.data)})`);
  const report = r4.data?.report;
  assert(typeof report?.checked === 'number', `dryRun report checked=${report?.checked}`);

  const r5 = await axios.post(
    `${BASE}/backfillSwingSets`,
    { dryRun: true },
    { headers: { 'x-admin-secret': 'definitely-wrong' }, validateStatus: () => true },
  );
  assert(r5.status === 403, 'backfillSwingSets wrong secret → 403');

  // ── 2. sweep + task registered ───────────────────────────────────────────
  try {
    const list = execSync('firebase functions:list --project ' + PROJECT, { encoding: 'utf8' });
    assert(/sweepSwingSets/.test(list), 'sweepSwingSets registered in functions:list');
    assert(/generateSwingSetsTask/.test(list), 'generateSwingSetsTask registered in functions:list');
  } catch {
    console.log('SKIP: firebase functions:list unavailable — verify functions in the console');
  }

  console.log('\n=== Smoke passed — deployed endpoints healthy ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
