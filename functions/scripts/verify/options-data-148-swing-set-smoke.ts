/**
 * Post-deploy smoke script — Task #148.
 *
 * BLACK-BOX check: calls the DEPLOYED swing-set functions over HTTPS (unlike
 * the per-task verify scripts, which inject deps at the handler seam).
 *
 * 1. partnerSwingSetsV2 — GET with a real Google OIDC token
 * 2. backfillSwingSets  — POST {dryRun:true} with x-admin-secret (no writes)
 * 3. Confirms sweepSwingSets exists via `firebase functions:list`
 *
 * Auth for (1):
 *   a. `GOOGLE_APPLICATION_CREDENTIALS=<allowed SA key json>` — mints an
 *      OIDC token via google-auth-library, or
 *   b. `SMOKE_SERVICE_ACCOUNT=<email>` — uses `gcloud auth
 *      print-identity-token --impersonate-service-account` (needs the
 *      serviceAccountTokenCreator role on your gcloud user).
 *   The SA email must be in ALLOWED_SERVICE_ACCOUNT_EMAILS.
 *
 * Auth for (2): `SWING_SET_ADMIN_SECRET=<value>` env var (operator-held;
 * never in the repo).
 *
 * Required: --symbol <SYM> for an options-enabled symbol to read.
 * Optional: --also-disabled <SYM> to assert the OPTIONS_NOT_ENABLED path.
 *
 * Read-only — the backfill call is dryRun:true, no prod writes.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\sa-key.json'
 *   $env:SWING_SET_ADMIN_SECRET='...'
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-148-swing-set-smoke.ts --symbol AAPL
 */
import { execSync } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GoogleAuth } = require('google-auth-library');
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

async function getOidcToken(): Promise<{ token: string; source: string }> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(`${BASE}/`);
    const { id_token: token } = await client.idTokenProvider.fetchIdToken(`${BASE}/`);
    return { token, source: `SA key (${process.env.GOOGLE_APPLICATION_CREDENTIALS})` };
  }
  const sa = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!sa) {
    throw new Error(
      'Provide GOOGLE_APPLICATION_CREDENTIALS=<SA key path> or ' +
        'SMOKE_SERVICE_ACCOUNT=<email> (impersonated via gcloud). ' +
        'The SA must be in ALLOWED_SERVICE_ACCOUNT_EMAILS.',
    );
  }
  // Audience must match an entry in EXPECTED_GOOGLE_AUDIENCE — same pattern
  // as the ST partner docs (--audiences=<function url>). --include-email is
  // required: the middleware allowlists on the token's email claim.
  const token = execSync(
    `gcloud auth print-identity-token --impersonate-service-account=${sa} --audiences=${BASE}/partnerSwingSetsV2 --include-email`,
    { encoding: 'utf8' },
  ).trim();
  return { token, source: `gcloud impersonation of ${sa}` };
}

async function main(): Promise<void> {
  const symbol = arg('symbol')?.toUpperCase();
  const alsoDisabled = arg('also-disabled')?.toUpperCase();
  if (!symbol) {
    console.error('FAIL: --symbol <SYM> required (an options-enabled symbol)');
    process.exit(1);
  }

  console.log('--- Smoke: deployed swing-set functions ---\n');

  // ── 1. partnerSwingSetsV2 with a real OIDC token ──────────────────────────
  const { token, source } = await getOidcToken();
  console.log(`OIDC token acquired via ${source}`);

  const r1 = await axios.get(`${BASE}/partnerSwingSetsV2`, {
    params: { symbol },
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  assert(r1.status === 200, `partnerSwingSetsV2 GET ${symbol} → 200 (got ${r1.status}: ${JSON.stringify(r1.data)})`);
  assert(r1.data?.ok === true && r1.data?.source === 'sa', 'envelope: ok=true, source=sa');
  assert(typeof r1.data?.data === 'object' && Object.keys(r1.data.data).length > 0, `data keyed by paramsId (${Object.keys(r1.data?.data ?? {}).length} docs)`);
  assert(typeof r1.data?.processingTimeMs === 'number', 'processingTimeMs present');

  const paramsId = Object.keys(r1.data.data)[0];
  const r2 = await axios.get(`${BASE}/partnerSwingSetsV2`, {
    params: { symbol, paramsId },
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  assert(r2.status === 200 && r2.data?.data?.paramsId === paramsId, `single-doc read ${symbol}/${paramsId} → 200`);

  if (alsoDisabled) {
    const r3 = await axios.get(`${BASE}/partnerSwingSetsV2`, {
      params: { symbol: alsoDisabled },
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true,
    });
    assert(
      r3.status === 403 && r3.data?.code === 'OPTIONS_NOT_ENABLED',
      `--also-disabled ${alsoDisabled} → 403 OPTIONS_NOT_ENABLED (got ${r3.status} ${JSON.stringify(r3.data)})`,
    );
  }

  // ── 2. backfillSwingSets dryRun with x-admin-secret (no writes) ───────────
  const adminSecret = process.env.SWING_SET_ADMIN_SECRET;
  if (!adminSecret) {
    console.log('SKIP: SWING_SET_ADMIN_SECRET not set — backfill dryRun skipped');
  } else {
    const r4 = await axios.post(
      `${BASE}/backfillSwingSets`,
      { symbols: [symbol], dryRun: true },
      { headers: { 'x-admin-secret': adminSecret }, validateStatus: () => true },
    );
    assert(r4.status === 200, `backfillSwingSets dryRun → 200 (got ${r4.status}: ${JSON.stringify(r4.data)})`);
    const report = r4.data?.report;
    assert(report?.checked === 1, `dryRun report checked=1 for ${symbol}`);

    const r5 = await axios.post(
      `${BASE}/backfillSwingSets`,
      { dryRun: true },
      { headers: { 'x-admin-secret': 'definitely-wrong' }, validateStatus: () => true },
    );
    assert(r5.status === 403, 'backfillSwingSets wrong secret → 403');
  }

  // ── 3. sweepSwingSets registered ──────────────────────────────────────────
  try {
    const list = execSync('firebase functions:list --project ' + PROJECT, { encoding: 'utf8' });
    assert(/sweepSwingSets/.test(list), 'sweepSwingSets registered in functions:list');
  } catch {
    console.log('SKIP: firebase functions:list unavailable — verify sweepSwingSets in the console');
  }

  console.log('\n=== Smoke passed — deployed endpoints healthy ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
