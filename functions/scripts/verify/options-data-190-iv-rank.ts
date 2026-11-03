/**
 * Verification script for Task #190 — production verify for the IV-rank
 * pipeline end-to-end: computeRankForDate write → rank fields on the stored
 * day entry → iv-rank-latest doc → deployed partnerIvRankV2 screener table
 * (sort / dir / minN) + error paths.
 *
 * ⚠ MUTATING — steps 1–2 write `symbol-metrics/{SYM}/years/{YYYY}`
 * days.{date} rank fields and may rewrite `iv-rank-latest/{SYM}` when the
 * date is the newest observation (the feature's own output; idempotent,
 * latest-guarded — recomputing an old date never regresses asOfDate).
 * Endpoint reads are read-only. Not in run-all.
 *
 * Auth: the endpoint requires a Google OIDC ID token whose email is in
 * ALLOWED_SERVICE_ACCOUNT_EMAILS and whose aud is in EXPECTED_GOOGLE_AUDIENCE.
 * Supply via env IV_RANK_ID_TOKEN (see the companion .md for how to mint
 * one via service-account impersonation).
 *
 * Usage:
 *   $env:IV_RANK_ID_TOKEN = (gcloud auth print-identity-token --impersonate-service-account=<sa> --audiences=<aud> --include-email)
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-190-iv-rank.ts [SYMBOL] [YYYY-MM-DD]
 *
 * Env:
 *   IV_RANK_ENDPOINT    — rank endpoint URL (default: prod run.app URL)
 *   IV_METRICS_ENDPOINT — metrics endpoint URL (default: prod run.app URL)
 *   IV_RANK_ID_TOKEN    — Google OIDC id token (required for endpoint checks)
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
const { IvRankLatestRepository } = require('../../src/v2/symbol-metrics/services/iv-rank-latest.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MetricBuildService } = require('../../src/v2/symbol-metrics/build.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RankBuildService } = require('../../src/v2/symbol-metrics/rank-build.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { optionsCorpusBucket } = require('../../src/v2/historical-options-corpus/types');

const DEFAULT_ENDPOINT = 'https://partnerivrankv2-lsluydmucq-uc.a.run.app';
const DEFAULT_METRICS_ENDPOINT = 'https://partnerivmetricsv2-lsluydmucq-uc.a.run.app';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IV_RANK_WINDOWS: WINDOWS } = require('@shared/options');

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
  count?: number;
  rows?: Array<Record<string, unknown>>;
  status: number;
}

async function callEndpoint(
  endpoint: string,
  params: Record<string, string>,
  token?: string,
): Promise<EndpointResponse> {
  const url = `${endpoint}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, ...body } as EndpointResponse;
  } catch {
    return { ok: false, status: 0 }; // transport error → status 0, clean FAIL downstream
  }
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'QQQ').toUpperCase();
  const date = process.argv[3] ?? '2024-01-05';
  const endpoint = process.env.IV_RANK_ENDPOINT ?? DEFAULT_ENDPOINT;
  const token = process.env.IV_RANK_ID_TOKEN;

  console.log(`--- Verifying IV rank pipeline: ${symbol} ${date} → ${endpoint} ---\n`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `date arg is YYYY-MM-DD (got "${date}") — refusing to write days.${date}`);

  const db = admin.firestore();
  // Match prod writer fidelity (firebase-admin-init) — a future field
  // emitting `undefined` should drop silently here like it does there.
  db.settings({ ignoreUndefinedProperties: true });

  // Gate: computeRankForDate has no optionsEnabled check (that lives in
  // the seed worker, which this script bypasses) — running on a disabled
  // or untracked symbol would write iv-rank-latest/{SYM} and inject it
  // into the partner screener with no cleanup path.
  const tracked = await db.collection('tracked-symbols').doc(symbol).get();
  assert(
    tracked.exists && (tracked.data() as Record<string, unknown>)?.optionsEnabled === true,
    `${symbol} is tracked and optionsEnabled (refusing to pollute iv-rank-latest otherwise)`,
  );
  const repo = new SymbolMetricsRepository(db);
  const latest = new IvRankLatestRepository(db);
  const metricService = new MetricBuildService({
    gcs: new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket())),
    bars: new DailyAdjustedReader(db),
    repo,
  });
  const rankService = new RankBuildService({ repo, latest });

  // 1. Ensure a day entry with iv30 exists for the rank pass to read —
  //    compute when possible, but an already-materialized entry is fine
  //    (the daily pass may have written it; a skipped compute is only
  //    fatal when no usable entry exists).
  const m = await metricService.computeForDate(symbol, date);
  if (m.written === true) {
    console.log(`PASS: computeForDate wrote the day entry (fields: ${JSON.stringify(m.fields)})`);
  } else {
    const existing = await repo.readDay(symbol, date) as Record<string, unknown> | null;
    assert(existing != null && Number.isFinite(existing.iv30),
      `computeForDate skipped (corpus/close unavailable) but existing day entry has iv30=${existing?.iv30}`);
    console.log('NOTE: computeForDate did not write — verifying against the existing day entry');
  }

  // 2. Rank pass — merge-writes rank fields onto the same day entry and
  //    rewrites iv-rank-latest when the date is the newest observation.
  const r = await rankService.computeRankForDate(symbol, date);
  assert(r.written === true, `computeRankForDate wrote rank fields (fields: ${JSON.stringify(r.fields)})`);
  assert(WINDOWS.every((w: number) => r.fields.includes(`ivN${w}`)), 'rank result fields include all four ivN sample counts');

  // 3. Read back the day entry — rank contract invariants hold:
  //    ivN{W} always finite, ivRank{W} present iff ivN{W} >= 2,
  //    ivPct{W} present iff ivN{W} > 0.
  const entry = await repo.readDay(symbol, date) as Record<string, unknown> | null;
  assert(entry != null && Number.isFinite(entry.iv30), `day entry read-back (iv30=${entry?.iv30})`);
  for (const w of WINDOWS) {
    const n = entry![`ivN${w}`];
    assert(Number.isFinite(n), `day entry ivN${w} finite (${n})`);
    const rank = entry![`ivRank${w}`];
    const pct = entry![`ivPct${w}`];
    assert((n as number) >= 2 ? Number.isFinite(rank) : rank === undefined,
      `day entry ivRank${w} presence matches n=${n} (${rank})`);
    assert((n as number) > 0 ? Number.isFinite(pct) : pct === undefined,
      `day entry ivPct${w} presence matches n=${n} (${pct})`);
  }

  // 4. iv-rank-latest/{SYM} exists with rank fields; asOfDate moves only
  //    forward — strictly ahead when this pass didn't update (an existing
  //    doc proves a NEWER observation), equal when it did. TOCTOU note:
  //    a live seed pass can legitimately advance asOfDate between the
  //    compute and this read — a FAIL here on a busy date is a rerun,
  //    not a regression.
  const doc = await latest.read(symbol) as Record<string, unknown> | null;
  assert(
    doc != null && typeof doc.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.asOfDate),
    `iv-rank-latest doc exists with a valid asOfDate (${doc?.asOfDate})`,
  );
  if (r.latestUpdated) {
    assert(doc!.asOfDate === date, 'latest asOfDate equals the computed date (latestUpdated=true)');
  } else {
    assert(doc!.asOfDate > date, `latest asOfDate (${doc!.asOfDate}) is strictly newer than ${date} (latestUpdated=false)`);
  }
  assert(Number.isFinite(doc![`ivN360`]), `latest doc carries ivN360 (${doc![`ivN360`]})`);

  // 5. Unauthenticated → 401 (a 500 here means EXPECTED_GOOGLE_AUDIENCE
  //    isn't configured — the audience check precedes auth).
  const unauth = await callEndpoint(endpoint, {});
  if (unauth.status === 500) {
    console.error('FAIL: endpoint returned 500 — EXPECTED_GOOGLE_AUDIENCE secret likely unset');
    process.exit(1);
  }
  assert(unauth.status === 401, `no token → 401 (got ${unauth.status})`);

  if (!token) {
    console.log('SKIP: IV_RANK_ID_TOKEN not set — endpoint auth checks skipped');
    console.log('\n=== All verification checks passed (endpoint auth checks skipped) ===');
    process.exit(0);
  }

  // 6. Sorted table — ?sort=ivRank360&dir=desc: 200, non-increasing over
  //    present values (missing sink to the bottom), our symbol present.
  const table = await callEndpoint(endpoint, { sort: 'ivRank360', dir: 'desc' }, token);
  assert(table.status === 200 && table.ok === true, `sorted table 200 (got ${table.status})`);
  const rows = table.rows ?? [];
  assert(rows.length > 0 && table.count === rows.length, `table returned ${rows.length} rows (count=${table.count})`);
  const vals = rows.map((row) => Number(row.ivRank360));
  const firstMissing = vals.findIndex((v) => !Number.isFinite(v));
  const suffix = firstMissing === -1 ? [] : vals.slice(firstMissing);
  const present = firstMissing === -1 ? vals : vals.slice(0, firstMissing);
  assert(
    present.every((v, i) => i === 0 || present[i - 1] >= v) && suffix.every((v) => !Number.isFinite(v)),
    'rows = non-increasing ivRank360 prefix + missing suffix (missing sinks to bottom)',
  );
  const own = rows.find((row) => row.symbol === symbol);
  assert(own != null && String(own.asOfDate) === String(doc!.asOfDate),
    `${symbol} row present (asOfDate=${own?.asOfDate})`);
  // Field parity against the Firestore doc — proves the wire row actually
  // carries the rank payload, not just an asOfDate placeholder (a doc
  // with n>=2 must surface ivRank360; numbers or absent together).
  assert(
    own!.ivN360 === doc!.ivN360 && (Number.isFinite(doc!.ivRank360) ? own!.ivRank360 === doc!.ivRank360 : own!.ivRank360 === undefined),
    `${symbol} wire row matches the iv-rank-latest doc (ivN360=${own!.ivN360}, ivRank360=${own!.ivRank360})`,
  );
  assert(rows.every((row) => row.updatedAt === null || !Number.isNaN(Date.parse(String(row.updatedAt)))),
    'updatedAt serialized ISO-8601/null, not the raw Timestamp shape');

  // 6b. dir=asc — missing must still sink (the only comparator branch
  //     that distinguishes "sink" from "missing sorts as 0").
  const ascTable = await callEndpoint(endpoint, { sort: 'ivRank360', dir: 'asc' }, token);
  const ascVals = (ascTable.rows ?? []).map((row) => Number(row.ivRank360));
  const ascFirstMissing = ascVals.findIndex((v) => !Number.isFinite(v));
  const ascSuffix = ascFirstMissing === -1 ? [] : ascVals.slice(ascFirstMissing);
  const ascPresent = ascFirstMissing === -1 ? ascVals : ascVals.slice(0, ascFirstMissing);
  assert(
    ascTable.status === 200 && ascPresent.every((v, i) => i === 0 || ascPresent[i - 1] <= v) && ascSuffix.every((v) => !Number.isFinite(v)),
    'dir=asc → non-decreasing prefix + missing suffix',
  );

  // 7. minN — floor on the sort window's ivN. Ceiling case proves the
  //    filter is wired to a numeric field (a no-op impl returns rows);
  //    the discriminating case proves WHICH window it reads.
  const ceiling = await callEndpoint(endpoint, { minN: '999999' }, token);
  assert(ceiling.status === 200 && (ceiling.rows ?? []).length === 0 && ceiling.count === 0,
    `minN=999999 filters out every row (${ceiling.count} rows)`);
  const filtered = await callEndpoint(endpoint, { minN: '2' }, token);
  assert(filtered.status === 200 && (filtered.rows ?? []).length > 0
    && (filtered.rows ?? []).every((row) => Number(row.ivN360) >= 2),
    `minN=2 filters to ivN360>=2 rows, non-vacuous (${filtered.rows?.length} rows)`);
  const mapped = await callEndpoint(endpoint, { sort: 'ivRank30', minN: '2' }, token);
  assert(mapped.status === 200 && (mapped.rows ?? []).length > 0
    && (mapped.rows ?? []).every((row) => Number(row.ivN30) >= 2),
    `sort=ivRank30&minN=2 applies the floor to ivN30, non-vacuous (${mapped.rows?.length} rows)`);
  // Discriminating case: a row with ivN30 < ivN360 is kept by a WRONG
  // ivN360-mapped floor but dropped by the correct ivN30 one.
  const discriminator = rows.find((row) => Number.isFinite(row.ivN30) && Number.isFinite(row.ivN360) && Number(row.ivN30) < Number(row.ivN360));
  if (!discriminator) {
    console.log('SKIP: no row with ivN30 < ivN360 — sort-window mapping discrimination not provable on this dataset');
  } else {
    const dSym = String(discriminator.symbol);
    const dMinN = String(discriminator.ivN360);
    const mappedFloor = await callEndpoint(endpoint, { sort: 'ivRank30', minN: dMinN }, token);
    assert(
      mappedFloor.status === 200 && !(mappedFloor.rows ?? []).some((row) => row.symbol === dSym),
      `sort=ivRank30&minN=${dMinN} drops ${dSym} (ivN30=${discriminator.ivN30} < ivN360=${dMinN}) — floor reads ivN30`,
    );
    const fallbackFloor = await callEndpoint(endpoint, { minN: dMinN }, token);
    assert(
      fallbackFloor.status === 200 && (fallbackFloor.rows ?? []).some((row) => row.symbol === dSym),
      `minN=${dMinN} (no sort) keeps ${dSym} — fallback floor reads ivN360`,
    );
  }

  // 8. Rank fields flow through the metrics endpoint's metric whitelist —
  //    "rank fields on rows" per IMPL task 5 (same token: the audience
  //    check is list-membership, not function-scoped).
  const metricsEndpoint = process.env.IV_METRICS_ENDPOINT ?? DEFAULT_METRICS_ENDPOINT;
  const metricRows = await callEndpoint(metricsEndpoint, { symbol, from: date, to: date, metrics: 'ivRank360,ivN360' }, token);
  const metricRow = metricRows.rows?.[0] ?? {};
  const metricKeys = Object.keys(metricRow).filter((k) => k !== 'date');
  assert(
    metricRows.status === 200 && 'ivN360' in metricRow && metricKeys.every((k) => k === 'ivRank360' || k === 'ivN360'),
    `partnerIvMetricsV2 serves rank fields via metrics= (row keys: ${metricKeys.join(',')})`,
  );

  // 9. Error paths — strict sort whitelist, dir, minN validation, method.
  const badSort = await callEndpoint(endpoint, { sort: 'iv30' }, token);
  assert(badSort.status === 400 && badSort.code === 'BAD_REQUEST', `sort=iv30 → 400 BAD_REQUEST (got ${badSort.status}/${badSort.code})`);
  const badDir = await callEndpoint(endpoint, { dir: 'sideways' }, token);
  assert(badDir.status === 400 && badDir.code === 'BAD_REQUEST', `dir=sideways → 400 BAD_REQUEST (got ${badDir.status}/${badDir.code})`);
  const badMinN = await callEndpoint(endpoint, { minN: 'abc' }, token);
  assert(badMinN.status === 400 && badMinN.code === 'BAD_REQUEST', `minN=abc → 400 BAD_REQUEST (got ${badMinN.status}/${badMinN.code})`);
  const negMinN = await callEndpoint(endpoint, { minN: '-1' }, token);
  assert(negMinN.status === 400, `minN=-1 → 400 (got ${negMinN.status})`);
  const fracMinN = await callEndpoint(endpoint, { minN: '2.5' }, token);
  assert(fracMinN.status === 400, `minN=2.5 → 400 (got ${fracMinN.status})`);
  let postStatus = 0;
  try {
    const post = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-length': '0' } });
    postStatus = post.status;
  } catch { /* transport error → status 0 */ }
  assert(postStatus === 405, `POST → 405 (got ${postStatus})`);

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
