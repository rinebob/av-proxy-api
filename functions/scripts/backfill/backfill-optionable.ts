/**
 * backfill-optionable.ts — probe HISTORICAL_OPTIONS per tracked symbol and
 * stamp the `optionable` flag (Topic #102 / Thread #105).
 *
 * Unlike the other backfills this DOES make provider calls — one AV
 * HISTORICAL_OPTIONS request per symbol — so it is throttled, resumable
 * (skips already-probed symbols unless --force), and aborts the whole run on
 * RATE_LIMITED rather than burning quota.
 *
 * Writes to tracked-symbols/{SYM} (field names per Thread #105 PRD §75/§80):
 *   optionable: boolean             — response.data.length > 0
 *   optionableCheckedAt: Timestamp  — probe time
 *   optionableProbeSummary: object  — liquidity metrics from analyzeOptions
 *   optionsEnabled / optionsEnabledHistory — default false / [] when absent
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/backfill/backfill-optionable.ts [--dry-run] [--symbols A,MSFT] [--delay 850] [--limit 50] [--force]
 *
 * Requires ALPHAVANTAGE_API_KEY in the environment for the probe calls.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHistoricalOptionsRetrievalService } = require('../../src/v2/historical-options-corpus/services/historical-options-retrieval.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AlphaVantageUpstreamError, AlphaVantageUpstreamErrorCategory } = require('../../src/v2/alpha-vantage/utils/av-upstream-error.utils');

const COLLECTION = 'tracked-symbols';

interface Args { dryRun: boolean; symbols?: string[]; delayMs: number; limit?: number; force: boolean; }

function parseArgs(): Args {
  const args: Args = { dryRun: false, delayMs: 850, force: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--symbols') args.symbols = argv[++i]?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--symbols=')) args.symbols = a.slice('--symbols='.length).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--delay') { const v = Number(argv[++i]); if (Number.isFinite(v) && v >= 0) args.delayMs = v; }
    else if (a.startsWith('--delay=')) { const v = Number(a.slice('--delay='.length)); if (Number.isFinite(v) && v >= 0) args.delayMs = v; }
    else if (a === '--limit') args.limit = Number(argv[++i]) || undefined;
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length)) || undefined;
  }
  return args;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (m: string) => console.log(`[backfill-optionable] ${m}`);

function toSummaryFields(analysis: any): Record<string, number> {
  const out: Record<string, number> = {};
  const s = analysis?.summary;
  for (const k of ['totalContracts', 'totalVolume', 'totalOpenInterest', 'uniqueStrikes'] as const) {
    const v = s?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  if (Array.isArray(analysis?.expirations)) out.expirations = analysis.expirations.length;
  return out;
}

/** AV returns 'Information' (not 'Note') for premium-gating and some quota messages. */
const QUOTA_MESSAGE = /rate limit|call frequency|premium|quota|daily/i;

function isAbortable(e: any): boolean {
  if (!(e instanceof AlphaVantageUpstreamError)) return false;
  return e.category === AlphaVantageUpstreamErrorCategory.RATE_LIMITED ||
    (e.category === AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR && QUOTA_MESSAGE.test(e.providerMessage ?? ''));
}

async function main(): Promise<void> {
  const args = parseArgs();
  log(`start — dryRun=${args.dryRun} delayMs=${args.delayMs} force=${args.force} limit=${args.limit ?? 'all'}`);

  // Lazily constructed — a fully-skipped run (all symbols already probed)
  // should not require ALPHAVANTAGE_API_KEY at all.
  let service: any;
  const getService = () => (service ??= createHistoricalOptionsRetrievalService());

  let ids: string[];
  if (args.symbols?.length) {
    ids = args.symbols;
  } else {
    const snap = await db.collection(COLLECTION).get();
    ids = snap.docs.map((d: any) => d.id).sort();
  }
  if (args.limit) ids = ids.slice(0, args.limit);
  log(`probing ${ids.length} symbols`);

  let optionable = 0, notOptionable = 0, alreadyProbed = 0, missingDoc = 0, errors = 0, aborted = false;

  for (let i = 0; i < ids.length; i++) {
    const symbol = ids[i];
    try {
      const ref = db.collection(COLLECTION).doc(symbol);
      const snap = await ref.get();
      if (!snap.exists) { missingDoc++; continue; }

      // §76 default: every tracked symbol carries optionsEnabled=false until curated.
      const defaults: Record<string, unknown> = {};
      if (snap.get('optionsEnabled') === undefined || snap.get('optionsEnabled') === null) defaults.optionsEnabled = false;
      if (snap.get('optionsEnabledHistory') === undefined || snap.get('optionsEnabledHistory') === null) defaults.optionsEnabledHistory = [];
      if (!args.dryRun && Object.keys(defaults).length) await ref.update(defaults);

      const existing = snap.get('optionable');
      if (!args.force && existing !== undefined && existing !== null) {
        alreadyProbed++;
        continue;
      }

      const { response, analysis } = await getService().fetch({ symbol });
      const hasOptions = Array.isArray(response.data) && response.data.length > 0;
      const summaryFields = toSummaryFields(analysis);

      if (args.dryRun) {
        log(`${symbol}: would write optionable=${hasOptions} contracts=${summaryFields.totalContracts ?? '?'}`);
      } else {
        await ref.update({
          optionable: hasOptions,
          optionableCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
          optionableProbeSummary: summaryFields,
        });
        log(`${symbol}: optionable=${hasOptions} contracts=${summaryFields.totalContracts ?? 0}`);
      }
      hasOptions ? optionable++ : notOptionable++;
    } catch (e: any) {
      if (isAbortable(e)) {
        log(`Quota/rate-limit abort at ${symbol} — re-run later (already-probed symbols are skipped). ${e.providerMessage ?? ''}`);
        aborted = true;
        break;
      }
      errors++;
      console.error(`${symbol}: ERROR`, e?.message || e);
    }
    // Throttle after every probed symbol — including ones that errored, so a
    // run of failures doesn't hammer AV with zero delay.
    if (i < ids.length - 1) await sleep(args.delayMs);
  }

  log(`\n=== Summary ===`);
  log(`Processed:        ${ids.length}`);
  log(`Optionable:       ${optionable}`);
  log(`Not optionable:   ${notOptionable}`);
  log(`Already probed:   ${alreadyProbed}`);
  log(`No tracked doc:   ${missingDoc}`);
  log(`Errors:           ${errors}`);
  if (aborted) log('Aborted early on RATE_LIMITED — resume later.');
  process.exitCode = errors > 0 || aborted ? 1 : 0;
}

main().catch((e) => {
  console.error('[backfill-optionable] fatal', e?.message || e);
  process.exitCode = 1;
});
