/**
 * Verification — Task #225: partnerOptionsDeltaPicksV1 handler.
 *
 * Invokes the real handler locally with the auth seam stubbed to a
 * service-account identity and the DEFAULT `readCellYearDoc` — so the
 * Firestore doc read hits PROD `options-delta-picks` for real, exercising
 * the exact path the deployed endpoint takes (parse → gate → cellId →
 * `options-delta-picks/{cellId}/years/{YYYY}` → response envelope).
 *
 * Read-only — no writes. Checks:
 *   POST (non-GET)        → 405 METHOD_NOT_ALLOWED
 *   missing symbol        → 400 naming `symbol`
 *   bad type              → 400 naming `type`
 *   off-grid delta (17)   → 400 naming `delta`
 *   off-grid dte (63)     → 400 naming `dte`
 *   malformed year        → 400 naming `year`
 *   dotted symbol (BRK.B) → 400 naming `symbol` (codec can't encode → never 500)
 *   unknown symbol        → 404 OPTIONS_NOT_ENABLED (real optionsEnabled gate)
 *   missing year shard    → 404 NOT_FOUND (e.g. QQQ-put-20-45/years/2099)
 *   QQQ put 20Δ/45DTE 2026→ 200 ok + full cell-doc shape + ISO updatedAt
 *
 * Requires ADC with Firestore read on prod:
 *   $env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
 *   gcloud auth application-default login
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-225-pick-endpoint.ts [SYMBOL] [YEAR]
 *
 * The deployed-endpoint smoke (405/401/auth'd GETs over HTTPS) runs at QA —
 * this script verifies everything testable pre-deploy.
 */
import type { Request, Response } from 'express';

import type { PartnerDeltaPicksDependencies } from '../../src/v2/partner/options-delta-picks-partner';
import { partnerOptionsDeltaPicksHandler } from '../../src/v2/partner/options-delta-picks-partner';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

/** Minimal express Request/Response stand-ins. */
function makeReqRes(method: string, query: Record<string, string>): { req: Request; res: Response; out: Captured } {
  const out: Captured = {};
  const req = { method, headers: {}, query } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: Record<string, unknown>) { out.body = body; return this; },
    headersSent: false,
  } as unknown as Response;
  return { req, res, out };
}

const SA_AUTH: PartnerDeltaPicksDependencies = {
  authenticateRequest: async () => ({ serviceAccountEmail: 'verify@example.com' }),
  now: () => new Date(),
};

async function call(method: string, query: Record<string, string>): Promise<Captured> {
  const { req, res, out } = makeReqRes(method, query);
  await partnerOptionsDeltaPicksHandler(req, res, SA_AUTH);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'QQQ').toUpperCase();
  const year = process.argv[3] ?? '2026';

  console.log(`--- Verify: partnerOptionsDeltaPicksV1 handler (#225) → prod Firestore [${symbol}, ${year}] ---\n`);

  // 1. Method gate.
  const post = await call('POST', { symbol, type: 'put', delta: '20', dte: '45', year });
  assert(post.status === 405 && post.body?.code === 'METHOD_NOT_ALLOWED', `POST → 405 METHOD_NOT_ALLOWED (got ${post.status})`);

  // 2. Validation matrix — each failure names the component.
  const matrix: Array<[string, Record<string, string>, string]> = [
    ['missing symbol', { type: 'put', delta: '20', dte: '45', year }, 'symbol'],
    ['invalid type', { symbol, type: 'strangle', delta: '20', dte: '45', year }, 'type'],
    ['off-grid delta 17', { symbol, type: 'put', delta: '17', dte: '45', year }, 'delta'],
    ['off-grid dte 63', { symbol, type: 'put', delta: '20', dte: '63', year }, 'dte'],
    ['malformed year', { symbol, type: 'put', delta: '20', dte: '45', year: '20X6' }, 'year'],
    ['dotted symbol (codec-unencodable)', { symbol: 'BRK.B', type: 'put', delta: '20', dte: '45', year }, 'symbol'],
  ];
  for (const [label, query, component] of matrix) {
    const r = await call('GET', query);
    assert(
      r.status === 400 && r.body?.ok === false && r.body?.code === 'BAD_REQUEST' && String(r.body?.error).includes(component),
      `${label} → 400 BAD_REQUEST naming ${component} (got ${r.status}: ${r.body?.error})`,
    );
  }

  // 3. Unknown symbol → 404 OPTIONS_NOT_ENABLED via the real gate.
  const unknown = await call('GET', { symbol: 'ZZZNOSUCH1', type: 'put', delta: '20', dte: '45', year });
  assert(unknown.status === 404 && unknown.body?.code === 'OPTIONS_NOT_ENABLED', `ZZZNOSUCH1 → 404 OPTIONS_NOT_ENABLED (got ${unknown.status}/${unknown.body?.code})`);

  // 4. Missing year shard → 404 NOT_FOUND (real doc read; 2099 can't exist).
  const missing = await call('GET', { symbol, type: 'put', delta: '20', dte: '45', year: '2099' });
  assert(missing.status === 404 && missing.body?.code === 'NOT_FOUND', `${symbol}-put-20-45/years/2099 → 404 NOT_FOUND (got ${missing.status}/${missing.body?.code})`);

  // 5. Real cell doc → 200 with the stored doc's shape.
  const ok = await call('GET', { symbol, type: 'put', delta: '20', dte: '45', year });
  assert(ok.status === 200 && ok.body?.ok === true, `GET ${symbol} put 20Δ/45DTE ${year} → 200 (got ${ok.status}: ${ok.body?.error ?? ''})`);
  const b = ok.body!;
  assert(b.symbol === symbol && b.type === 'put' && b.targetDelta === -0.2, `envelope symbol/type/targetDelta (${b.symbol}/${b.type}/${b.targetDelta})`);
  assert((b.expiry as { mode?: string; dte?: number })?.mode === 'nearestDte' && (b.expiry as { dte?: number })?.dte === 45, 'envelope expiry {mode:nearestDte,dte:45}');
  assert(typeof b.gridVersion === 'number', `gridVersion numeric (${b.gridVersion})`);
  assert(typeof b.firstDate === 'string' && DATE_RE.test(b.firstDate as string), `firstDate YYYY-MM-DD (${b.firstDate})`);
  assert(typeof b.lastDate === 'string' && DATE_RE.test(b.lastDate as string), `lastDate YYYY-MM-DD (${b.lastDate})`);
  assert(typeof b.pickCount === 'number' && typeof b.missCount === 'number', `pickCount/missCount numeric (${b.pickCount}/${b.missCount})`);

  const days = b.days as Record<string, Record<string, unknown>>;
  const dayKeys = Object.keys(days ?? {});
  assert(dayKeys.length > 0 && dayKeys.every((d) => DATE_RE.test(d)), `days map: ${dayKeys.length} YYYY-MM-DD keys`);
  assert(dayKeys.every((d) => d.startsWith(`${year}-`)), `all day keys inside the ${year} shard`);

  const pickEntries = Object.values(days).filter((e) => typeof e.contractId === 'string');
  const missEntries = Object.values(days).filter((e) => typeof e.status === 'string');
  assert(pickEntries.length === b.pickCount && missEntries.length === b.missCount, `day entries split ${pickEntries.length} picks / ${missEntries.length} misses = header counts`);
  const firstPick = pickEntries[0];
  if (firstPick) {
    assert(typeof firstPick.expiration === 'string' && DATE_RE.test(firstPick.expiration as string), `pick expiration ISO (${firstPick.expiration})`);
    assert(typeof firstPick.delta === 'number' && (firstPick.delta as number) < 0, `pick observed delta negative for put (${firstPick.delta})`);
    assert(typeof firstPick.strike === 'number' && typeof firstPick.dte === 'number', `pick strike/dte numeric (${firstPick.strike}/${firstPick.dte})`);
  }
  assert(missEntries.every((e) => e.status === 'no_chain' || e.status === 'no_match'), 'every miss carries a known status');

  // 6. updatedAt serialized to ISO-8601 (never a {_seconds,_nanoseconds} leak).
  assert(typeof b.updatedAt === 'string' && !Number.isNaN(Date.parse(b.updatedAt as string)), `updatedAt ISO-8601 (${b.updatedAt})`);
  assert(!('_seconds' in (b as Record<string, unknown>)), 'no raw Firestore timestamp shape leaked');

  console.log(`\n=== All verification checks passed — ${symbol}-put-20-45/years/${year} served ${dayKeys.length} day entries ===`);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
