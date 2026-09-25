/**
 * Verification — Task #142: flag filtering on partnerListTrackedSymbolsV2
 *
 * Read-only checks against the DEPLOYED partner endpoint — the real path a
 * consumer takes. Requires the #142 build to be deployed first.
 *
 * Checks:
 *   ?optionsEnabled=true  → every returned row has optionsEnabled===true
 *   ?optionsEnabled=false → no returned row has optionsEnabled===true
 *   ?optionable=true      → every returned row has optionable===true
 *   ?optionsEnabled=bogus → filter ignored (unfiltered count unchanged)
 *   params compose with activeOnly/limit
 *
 * Auth — pick ONE (SA must be in ALLOWED_SERVICE_ACCOUNT_EMAILS):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\sa-key.json'
 *   $env:SMOKE_SERVICE_ACCOUNT='sa@project.iam.gserviceaccount.com'  (gcloud impersonation)
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-142-list-flag-filtering.ts [--enabled-symbol AAPL]
 */
import { execSync } from 'node:child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GoogleAuth } = require('google-auth-library');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios');

const BASE = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function getOidcToken(): Promise<string> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(`${BASE}`);
    const { id_token: token } = await client.idTokenProvider.fetchIdToken(`${BASE}`);
    return token;
  }
  const sa = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!sa) {
    throw new Error('Provide GOOGLE_APPLICATION_CREDENTIALS=<SA key> or SMOKE_SERVICE_ACCOUNT=<email>.');
  }
  // Audience must match an EXPECTED_GOOGLE_AUDIENCE entry; --include-email is
  // required for the SA allowlist check.
  return execSync(
    `gcloud auth print-identity-token --impersonate-service-account=${sa} --audiences=${BASE} --include-email`,
    { encoding: 'utf8' },
  ).trim();
}

async function list(token: string, params: Record<string, string>): Promise<any> {
  const r = await axios.get(BASE, {
    params,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  assert(r.status === 200, `GET ${JSON.stringify(params)} → 200 (got ${r.status}: ${JSON.stringify(r.data)?.slice(0, 200)})`);
  return r.data;
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--enabled-symbol');
  const enabledSymbol = i >= 0 ? process.argv[i + 1]?.toUpperCase() : 'AAPL';

  console.log('--- Verify: partnerListTrackedSymbolsV2 flag filtering (#142) ---\n');

  const token = await getOidcToken();

  // Baseline: unfiltered
  const all = await list(token, { limit: '5000' });
  const allCount = all.symbols.length;
  assert(allCount > 0, `unfiltered list returns rows (${allCount})`);

  // optionsEnabled=true — every row enabled
  const enabled = await list(token, { optionsEnabled: 'true', limit: '5000' });
  assert(enabled.symbols.length > 0, `optionsEnabled=true returns rows (${enabled.symbols.length})`);
  assert(
    enabled.symbols.every((s: any) => s.optionsEnabled === true),
    `optionsEnabled=true: all ${enabled.symbols.length} rows have optionsEnabled===true`,
  );
  assert(
    enabled.symbols.some((s: any) => s.symbol === enabledSymbol),
    `optionsEnabled=true includes ${enabledSymbol} (enabled during #148 smoke)`,
  );

  // optionsEnabled=false — excludes enabled symbols
  const disabled = await list(token, { optionsEnabled: 'false', limit: '5000' });
  assert(
    disabled.symbols.every((s: any) => s.optionsEnabled === false),
    `optionsEnabled=false: all ${disabled.symbols.length} rows have optionsEnabled===false`,
  );
  assert(
    !disabled.symbols.some((s: any) => s.symbol === enabledSymbol),
    `optionsEnabled=false excludes ${enabledSymbol}`,
  );
  if (enabled.symbols.length + disabled.symbols.length === allCount) {
    console.log(`PASS: true(${enabled.symbols.length}) + false(${disabled.symbols.length}) = total(${allCount})`);
  } else {
    // Warn not fail: docs written before #139 defaults lack optionsEnabled
    // until their next write, so the partition can be incomplete on real prod.
    console.warn(`WARN: true(${enabled.symbols.length}) + false(${disabled.symbols.length}) != total(${allCount}) — docs without optionsEnabled field still exist`);
  }

  // optionable=true — every row optionable (count depends on #143 backfill progress)
  const optionable = await list(token, { optionable: 'true', limit: '5000' });
  assert(
    optionable.symbols.every((s: any) => s.optionable === true),
    `optionable=true: all ${optionable.symbols.length} rows have optionable===true`,
  );

  // Malformed value → filter ignored, not an error
  const bogus = await list(token, { optionsEnabled: 'bogus', limit: '5000' });
  assert(bogus.symbols.length === allCount, `optionsEnabled=bogus ignored → same count as unfiltered (${bogus.symbols.length})`);

  // Composes with other params
  const composed = await list(token, { optionsEnabled: 'true', activeOnly: 'true', limit: '1' });
  assert(composed.symbols.length === 1, `composes with limit=1 (${composed.symbols.length} row)`);

  console.log('\n=== Verify passed — flag filtering live on partnerListTrackedSymbolsV2 ===');
}

main().catch((e) => {
  console.error('FAIL:', e?.message || e);
  process.exit(1);
});
