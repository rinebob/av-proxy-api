/**
 * Verification script for Task #173 — production verify for the IV metrics
 * pipeline end-to-end: computeForDate write → year-doc read-back → deployed
 * partnerIvMetricsV2 range + point reads + error paths.
 *
 * ⚠ MUTATING — step 1 writes `symbol-metrics/{SYM}/years/{YYYY}` days.{date}
 * (the feature's own output; idempotent dedupe-by-key). Endpoint reads are
 * read-only. Not in run-all.
 *
 * Auth: the endpoint requires a Google OIDC ID token whose email is in
 * ALLOWED_SERVICE_ACCOUNT_EMAILS and whose aud is in EXPECTED_GOOGLE_AUDIENCE.
 * Supply via env IV_METRICS_ID_TOKEN (see the companion .md for how to mint
 * one via service-account impersonation).
 *
 * Usage:
 *   $env:IV_METRICS_ID_TOKEN = (gcloud auth print-identity-token --impersonate-service-account=<sa> --audiences=<aud> --include-email)
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-173-iv-metrics-endpoint.ts [SYMBOL] [YYYY-MM-DD]
 *
 * Env:
 *   IV_METRICS_ENDPOINT  — endpoint URL (default: prod function URL)
 *   IV_METRICS_ID_TOKEN  — Google OIDC id token (required for endpoint checks)
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GcsCorpusAdapter } = require('../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SymbolMetricsRepository } = require('../../src/v2/symbol-metrics/services/symbol-metrics.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MetricBuildService } = require('../../src/v2/symbol-metrics/build.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { optionsCorpusBucket } = require('../../src/v2/historical-options-corpus/types');

const DEFAULT_ENDPOINT = 'https://partnerivmetricsv2-lsluydmucq-uc.a.run.app';
/** Candidate symbols to probe for 404 — first absent from tracked-symbols wins. */
const UNTRACKED_CANDIDATES = ['ZZZXQ', 'ZZZXQQ', 'QZZZX', 'ZZZXQQ1'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

interface EndpointResponse {
  ok: boolean;
  code?: string;
  rows?: Array<Record<string, unknown>>;
  status: number;
}

async function callEndpoint(
  endpoint: string,
  params: Record<string, string>,
  token?: string,
): Promise<EndpointResponse> {
  const url = `${endpoint}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ...body } as EndpointResponse;
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'QQQ').toUpperCase();
  const date = process.argv[3] ?? '2024-01-05';
  const endpoint = process.env.IV_METRICS_ENDPOINT ?? DEFAULT_ENDPOINT;
  const token = process.env.IV_METRICS_ID_TOKEN;

  console.log(`--- Verifying IV metrics pipeline: ${symbol} ${date} → ${endpoint} ---\n`);

  const db = admin.firestore();
  const repo = new SymbolMetricsRepository(db);
  const service = new MetricBuildService({
    gcs: new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket())),
    bars: new DailyAdjustedReader(db),
    repo,
  });

  // 1. Ensure a real day entry exists for the endpoint to serve.
  const r = await service.computeForDate(symbol, date);
  assert(r.written === true, `computeForDate wrote the day entry (fields: ${JSON.stringify(r.fields)})`);

  // 2. Read back the stored entry.
  const entry = await repo.readDay(symbol, date);
  assert(entry != null && Number.isFinite(entry.iv30), `day entry read-back (iv30=${entry?.iv30})`);

  // 3. Unauthenticated → 401 (a 500 here means the endpoint's EXPECTED_GOOGLE_AUDIENCE
  // secret isn't configured — audience check precedes auth).
  const unauth = await callEndpoint(endpoint, { symbol, from: date, to: date });
  if (unauth.status === 500) {
    console.error('FAIL: endpoint returned 500 — EXPECTED_GOOGLE_AUDIENCE secret likely unset');
    process.exit(1);
  }
  assert(unauth.status === 401, `no token → 401 (got ${unauth.status})`);

  if (!token) {
    console.log('SKIP: IV_METRICS_ID_TOKEN not set — endpoint auth checks skipped');
    console.log('\n=== All verification checks passed (endpoint auth checks skipped) ===');
    process.exit(0);
  }

  // 4. Range read — ascending rows, target date present, fields match.
  const from = `${date.slice(0, 8)}01`;
  const to = `${date.slice(0, 8)}31`;
  const range = await callEndpoint(endpoint, { symbol, from, to }, token);
  assert(range.status === 200 && range.ok === true, `range read 200 (got ${range.status})`);
  const rows = range.rows ?? [];
  assert(rows.length > 0, `range returned ${rows.length} rows`);
  const dates = rows.map((row) => String(row.date));
  assert(dates.every((d, i) => i === 0 || dates[i - 1] < d), 'rows ascending by date');
  const target = rows.find((row) => row.date === date) as { iv30?: number } | undefined;
  assert(target != null, `target date ${date} present in range rows`);
  assert(target!.iv30 === entry!.iv30, `endpoint iv30 matches stored (${target!.iv30})`);

  // 5. Point read — single row for the same date.
  const point = await callEndpoint(endpoint, { symbol, from: date, to: date }, token);
  assert(point.status === 200 && (point.rows ?? []).length === 1, 'point read returns exactly one row');

  // 6. metrics= filter — every row key is `date` or `iv30` (catches filter
  // leaks regardless of which fields the stored entry happens to have).
  const filtered = await callEndpoint(endpoint, { symbol, from: date, to: date, metrics: 'iv30' }, token);
  const filteredRow = filtered.rows?.[0] ?? {};
  const leakedKeys = Object.keys(filteredRow).filter((k) => k !== 'date' && k !== 'iv30');
  assert(
    filtered.status === 200 && 'iv30' in filteredRow && leakedKeys.length === 0,
    `metrics=iv30 filters the row fields${leakedKeys.length ? ` — leaked: ${leakedKeys}` : ''}`,
  );

  // 7. Untracked symbol → 404 NOT_FOUND (pick a candidate that is actually absent).
  let untrackedSymbol: string | undefined;
  for (const candidate of UNTRACKED_CANDIDATES) {
    const snap = await db.collection('tracked-symbols').doc(candidate).get();
    if (!snap.exists) { untrackedSymbol = candidate; break; }
  }
  if (!untrackedSymbol) {
    console.log('SKIP: every untracked-candidate symbol exists — 404 check skipped');
  } else {
    const untracked = await callEndpoint(endpoint, { symbol: untrackedSymbol, from: date, to: date }, token);
    assert(untracked.status === 404 && untracked.code === 'NOT_FOUND', `untracked ${untrackedSymbol} → 404 NOT_FOUND (got ${untracked.status}/${untracked.code})`);
  }

  // 8. Disabled symbol → 403 OPTIONS_NOT_ENABLED (find one dynamically).
  const disabledSnap = await db
    .collection('tracked-symbols')
    .where('optionsEnabled', '==', false)
    .limit(1)
    .get();
  if (disabledSnap.empty) {
    console.log('SKIP: no optionsEnabled=false tracked symbol found — OPTIONS_NOT_ENABLED check skipped');
  } else {
    const disabledSymbol = disabledSnap.docs[0].id;
    const disabled = await callEndpoint(endpoint, { symbol: disabledSymbol, from: date, to: date }, token);
    assert(
      disabled.status === 403 && disabled.code === 'OPTIONS_NOT_ENABLED',
      `disabled symbol ${disabledSymbol} → 403 OPTIONS_NOT_ENABLED (got ${disabled.status}/${disabled.code})`,
    );
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
