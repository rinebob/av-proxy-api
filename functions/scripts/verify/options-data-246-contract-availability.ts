/**
 * Verification — Task #246: partnerContractAvailabilityV1 deployed endpoint
 *
 * Read-only checks against the DEPLOYED partner endpoint — the real path a
 * consumer takes. Requires the #245 build to be deployed first (check for a
 * `partnercontractavailabilityv1-*.a.run.app` function).
 *
 * Checks:
 *   POST (no token)      → 405 METHOD_NOT_ALLOWED (method gate precedes auth)
 *   GET  (no token)      → 401 (auth precedes param validation)
 *   GET  ?symbol=<SYM>   → 200 envelope { ok, symbol, contracts, count,
 *                          truncated, corpusDates, corpusDateCount }
 *   contracts            → non-empty; entries carry contractId/expiration/
 *                          strike/type/firstObserved and never lastUpdated
 *   corpusDates          → strictly ascending YYYY-MM-DD
 *   type=put             → narrows results; every entry type==='put'
 *   firstObserved/strike → type-pinned narrow ranges exercise the
 *                          (type,firstObserved) and (type,strike) indexes
 *   31 expirations       → 400 (MAX_EXPIRATIONS_LIST cap)
 *   non-SA OIDC token    → 403 FORBIDDEN
 *   type=bogus           → 400 V2 error envelope
 *   unknown symbol       → 404 OPTIONS_NOT_ENABLED (never in tracked_symbols)
 *
 * Auth — pick ONE (SA must be in ALLOWED_SERVICE_ACCOUNT_EMAILS):
 *   $env:AVAILABILITY_ID_TOKEN=<pre-minted id token>
 *   $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\sa-key.json'
 *   $env:SMOKE_SERVICE_ACCOUNT='sa@project.iam.gserviceaccount.com'  (gcloud impersonation)
 *
 * Without credentials the script still verifies the unauthenticated 405/401
 * paths and skips the rest (exit 0 — keeps run-all green). The 403 check
 * uses the gcloud CLI's own user token (never an allowlisted SA) and skips
 * when no user identity is available.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-246-contract-availability.ts [SYMBOL]
 *
 * Env:
 *   AVAILABILITY_ENDPOINT — endpoint URL (default: prod run.app URL)
 *   AVAILABILITY_ID_TOKEN — pre-minted Google OIDC id token
 */
import { execSync } from 'node:child_process';

const DEFAULT_ENDPOINT = 'https://partnercontractavailabilityv1-lsluydmucq-uc.a.run.app';
/** A symbol that will never exist in tracked_symbols → optionsEnabled=false. */
const UNKNOWN_SYMBOL = 'ZZZNOSUCH1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function getOidcToken(audience: string): Promise<string> {
  if (process.env.AVAILABILITY_ID_TOKEN) {
    return process.env.AVAILABILITY_ID_TOKEN;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(audience);
    const { id_token: token } = await client.idTokenProvider.fetchIdToken(audience);
    return token;
  }
  const sa = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!sa) {
    throw new Error('Provide AVAILABILITY_ID_TOKEN, GOOGLE_APPLICATION_CREDENTIALS=<SA key>, or SMOKE_SERVICE_ACCOUNT=<email>.');
  }
  // Audience must match an EXPECTED_GOOGLE_AUDIENCE entry; --include-email is
  // required for the SA allowlist check.
  return execSync(
    `gcloud auth print-identity-token --impersonate-service-account=${sa} --audiences=${audience} --include-email`,
    { encoding: 'utf8' },
  ).trim();
}

interface EndpointResponse {
  ok?: boolean;
  symbol?: string;
  contracts?: Array<Record<string, unknown>>;
  count?: number;
  truncated?: boolean;
  corpusDates?: string[];
  corpusDateCount?: number;
  code?: string;
  error?: string;
  message?: string;
  timestamp?: string;
  status: number;
}

async function callEndpoint(
  endpoint: string,
  params: Record<string, string>,
  token?: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<EndpointResponse> {
  const url = `${endpoint}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    // Bound the client past the function's 60s timeout — a stalled
    // connection must not hang the script (and through it, run-all).
    signal: AbortSignal.timeout(70_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ...body } as EndpointResponse;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'COST').toUpperCase();
  const endpoint = process.env.AVAILABILITY_ENDPOINT ?? DEFAULT_ENDPOINT;

  console.log(`--- Verify: partnerContractAvailabilityV1 (#246) → ${endpoint} [symbol=${symbol}] ---\n`);

  // 1. Unauthenticated GET → 401 (a 404 here means the function isn't deployed
  // yet; a 500 means EXPECTED_GOOGLE_AUDIENCE isn't configured).
  const unauth = await callEndpoint(endpoint, { symbol });
  if (unauth.status === 404) {
    console.error('FAIL: endpoint returned 404 — partnerContractAvailabilityV1 is not deployed yet');
    process.exit(1);
  }
  if (unauth.status === 500) {
    console.error('FAIL: endpoint returned 500 — EXPECTED_GOOGLE_AUDIENCE secret likely unset');
    process.exit(1);
  }
  if (unauth.status === 403 && unauth.code === undefined) {
    console.error('FAIL: Cloud Run denied the unauthenticated request — function likely lacks allUsers invoker (app-level auth untested at the edge)');
    process.exit(1);
  }
  assert(unauth.status === 401, `no token → 401 (got ${unauth.status})`);

  // 2. POST → 405 (method gate runs before auth — no token needed).
  const post = await callEndpoint(endpoint, { symbol }, undefined, 'POST');
  assert(post.status === 405 && post.code === 'METHOD_NOT_ALLOWED', `POST → 405 METHOD_NOT_ALLOWED (got ${post.status}/${post.code})`);

  let token: string;
  try {
    token = await getOidcToken(endpoint);
  } catch (e) {
    console.log(`SKIP: no credentials (${(e as Error)?.message}) — authed checks skipped`);
    console.log('\n=== Verification passed (authed checks skipped) ===');
    await settleAndExit(0);
    return;
  }

  // 3. Unfiltered read — full envelope contract.
  const all = await callEndpoint(endpoint, { symbol }, token);
  if (all.status === 403) {
    // Auth layer rejects with {error:'Forbidden', message} — report the real
    // reason (audience mismatch = token's aud not in EXPECTED_GOOGLE_AUDIENCE;
    // unauthorized = SA email not in ALLOWED_SERVICE_ACCOUNT_EMAILS). A bare
    // 403 with no app shape is Cloud-Run IAM (no run.invoker).
    if (all.error === 'Forbidden') {
      console.error(`FAIL: app rejected the SA token — ${all.message ?? 'Forbidden'}`);
    } else {
      console.error('FAIL: Cloud Run denied the SA token (no run.invoker on the function) — not the app envelope');
    }
    process.exit(1);
  }
  assert(all.status === 200 && all.ok === true, `unfiltered GET → 200 ok (got ${all.status}: ${all.error ?? ''})`);
  for (const field of ['symbol', 'contracts', 'count', 'truncated', 'corpusDates', 'corpusDateCount'] as const) {
    assert(field in all, `envelope carries ${field}`);
  }
  assert(all.symbol === symbol, `envelope symbol echoed (${all.symbol})`);
  assert(typeof all.truncated === 'boolean', `truncated is boolean (${all.truncated})`);
  const contracts = all.contracts ?? [];
  assert(contracts.length > 0 && all.count === contracts.length, `contracts non-empty, count=${all.count} matches`);

  // 4. Entry fields — catalog shape, lastUpdated stripped.
  const badEntry = contracts.find((c) =>
    typeof c.contractId !== 'string'
    || !DATE_RE.test(String(c.expiration))
    || typeof c.strike !== 'number'
    || (c.type !== 'call' && c.type !== 'put')
    || !DATE_RE.test(String(c.firstObserved)),
  );
  assert(!badEntry, `every entry has contractId/expiration/strike/type/firstObserved${badEntry ? ` — first bad: ${JSON.stringify(badEntry).slice(0, 200)}` : ''}`);
  assert(
    contracts.every((c) => !('lastUpdated' in c)),
    'lastUpdated stripped from all entries',
  );

  // 5. corpusDates — ascending YYYY-MM-DD, count consistent.
  const dates = all.corpusDates ?? [];
  assert(dates.every((d) => DATE_RE.test(d)), `corpusDates all YYYY-MM-DD (${dates.length} dates)`);
  assert(dates.every((d, i) => i === 0 || dates[i - 1] < d), 'corpusDates strictly ascending');
  assert(all.corpusDateCount === dates.length, `corpusDateCount=${all.corpusDateCount} matches`);

  // 6. Filter narrows — filter on the type of the first catalog entry so the
  //    subset is guaranteed non-empty and provably type-filtered.
  const t0 = contracts[0]?.type;
  if (t0 !== 'call' && t0 !== 'put') {
    console.error('FAIL: contracts[0] has no usable type for the narrowing check');
    process.exit(1);
  }
  const typed = await callEndpoint(endpoint, { symbol, type: t0 }, token);
  assert(typed.status === 200 && typed.ok === true, `type=${t0} → 200 (got ${typed.status})`);
  const typedContracts = typed.contracts ?? [];
  assert(typedContracts.length > 0 && typedContracts.every((c) => c.type === t0), `type=${t0}: all ${typedContracts.length} entries are ${t0}s`);
  if (typedContracts.length < contracts.length) {
    console.log(`PASS: type=${t0} narrows ${contracts.length} → ${typedContracts.length}`);
  } else {
    // Single-type catalog edge case: an explicit expirations list of just the
    // last expiration is a strict subset whenever the catalog spans >1 expiration.
    const lastExp = String(contracts[contracts.length - 1].expiration);
    const bounded = await callEndpoint(endpoint, { symbol, expirations: lastExp }, token);
    assert(
      (bounded.contracts?.length ?? 0) < contracts.length,
      `expirations=${lastExp} narrows ${contracts.length} → ${bounded.contracts?.length}`,
    );
  }

  // 7. firstObserved-primary — exercises the (type,firstObserved) composite
  //    index through the real endpoint. Pin type + firstObserved to the first
  //    catalog entry so a hit is guaranteed and the read stays bounded.
  const d0 = String(contracts[0].firstObserved);
  const fo = await callEndpoint(endpoint, { symbol, type: t0, firstObservedGte: d0, firstObservedLte: d0 }, token);
  assert(fo.status === 200 && fo.ok === true, `firstObserved=${d0} primary → 200 (got ${fo.status}: ${fo.error ?? ''})`);
  const foContracts = fo.contracts ?? [];
  assert(foContracts.length > 0, `firstObserved=${d0} returned ${foContracts.length} contracts`);
  assert(foContracts.every((c) => c.firstObserved === d0 && c.type === t0), `firstObserved=${d0}: all ${foContracts.length} entries are in-range ${t0}s`);

  // 8. strike-primary — same for the (type,strike) composite index. Pin an
  //    exact strike from the unfiltered page (with the same t0) so a hit is certain.
  const s0 = contracts[0]?.strike;
  if (typeof s0 !== 'number') {
    console.log('SKIP: contracts[0] has no numeric strike — strike-primary check skipped');
  } else {
    const st = await callEndpoint(endpoint, { symbol, type: t0, strikeGte: String(s0), strikeLte: String(s0) }, token);
    assert(st.status === 200 && st.ok === true, `strike=${s0} primary → 200 (got ${st.status}: ${st.error ?? ''})`);
    const stContracts = st.contracts ?? [];
    assert(stContracts.length > 0, `strike=${s0} returned ${stContracts.length} contracts`);
    assert(stContracts.every((c) => c.strike === s0 && c.type === t0), `strike=${s0}: all ${stContracts.length} entries are exact-strike ${t0}s`);
  }

  // 9. expirations cap — 31 dates → 400 BAD_REQUEST (MAX_EXPIRATIONS_LIST).
  const tooMany = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`).join(',');
  const capped = await callEndpoint(endpoint, { symbol, expirations: tooMany }, token);
  assert(capped.status === 400 && capped.ok === false && capped.code === 'BAD_REQUEST', `31 expirations → 400 BAD_REQUEST (got ${capped.status}/${capped.code})`);

  // 10. Non-SA identity → 403 FORBIDDEN — mint the gcloud caller's own ID
  //     token, which is never an allowlisted service account.
  let userToken: string | undefined;
  try {
    userToken = execSync(
      `gcloud auth print-identity-token --audiences=${endpoint}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch { /* gcloud missing or no user login */ }
  if (!userToken) {
    console.log('SKIP: no gcloud user identity token — 403 check skipped');
  } else {
    const forbidden = await callEndpoint(endpoint, { symbol }, userToken);
    if (forbidden.status === 403 && forbidden.code === undefined && forbidden.error === undefined) {
      console.log('SKIP: Cloud Run denied the user token (no run.invoker) — app-level 403 untested');
    } else {
      // The app denies a non-allowlisted identity either as a handler-envelope
      // 403 (code: FORBIDDEN, Firebase-token path) or as the auth layer's
      // {error:'Forbidden'} shape (Google-OIDC path).
      assert(
        forbidden.status === 403 && (forbidden.code === 'FORBIDDEN' || forbidden.error === 'Forbidden'),
        `non-SA token → 403 FORBIDDEN (got ${forbidden.status}/${forbidden.code ?? forbidden.error})`,
      );
    }
  }

  // 11. Malformed param → 400 V2 error envelope (ok:false + code + timestamp).
  const bad = await callEndpoint(endpoint, { symbol, type: 'bogus' }, token);
  assert(bad.status === 400 && bad.ok === false && bad.code === 'BAD_REQUEST' && typeof bad.timestamp === 'string', `type=bogus → 400 BAD_REQUEST envelope (got ${bad.status}/${bad.code})`);

  // 12. Unknown symbol → 404 OPTIONS_NOT_ENABLED (the #150 gate).
  const unknown = await callEndpoint(endpoint, { symbol: UNKNOWN_SYMBOL }, token);
  assert(unknown.status === 404 && unknown.code === 'OPTIONS_NOT_ENABLED', `${UNKNOWN_SYMBOL} → 404 OPTIONS_NOT_ENABLED (got ${unknown.status}/${unknown.code})`);

  console.log('\n=== All verification checks passed ===');
  await settleAndExit(0);
}

/**
 * Exits after letting undici's keep-alive sockets close. Fetch leaves the
 * global agent's sockets open ~4s past the last response; exiting while
 * they're closing hits a Node-on-Windows UV_HANDLE_CLOSING assertion that
 * turns a green run into exit 1 (which run-all would report as FAIL).
 */
async function settleAndExit(code: number): Promise<never> {
  await new Promise((r) => setTimeout(r, 4500));
  process.exit(code);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
