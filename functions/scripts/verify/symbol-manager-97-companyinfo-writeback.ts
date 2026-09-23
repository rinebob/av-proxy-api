/**
 * Verification script for Task #97 — companyInfo marketCap/beta write-back.
 *
 * Verifies the write-back pipeline stage end-to-end against prod Firestore:
 * - Reads a real symbol-data overview doc (NVDA) from prod
 * - Runs the real buildTrackedSymbolCompanyInfo used by the overview handler
 * - Writes the result to tracked-symbols/NVDA via merge (same as handler write-back)
 * - Reads the doc back and asserts marketCap/beta are stored as Firestore numbers
 * - Asserts omission behavior for absent/non-numeric source values
 *
 * Side effect: writes companyInfo.marketCap/beta to tracked-symbols/NVDA —
 * this is the intended end-state of the feature, no cleanup required.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/symbol-manager-97-companyinfo-writeback.ts
 */
import * as admin from 'firebase-admin';
import { buildTrackedSymbolCompanyInfo } from '../../src/v2/alpha-vantage/logic/company-info.builder';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';
import type { AvCompanyOverview } from '@shared/alpha-vantage';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

const SYMBOL = 'NVDA';
const OVERVIEW_DOC = [
  FirestoreCollection.SYMBOL_DATA,
  SYMBOL,
  FirestoreCollection.COMPANY_OVERVIEW,
  `av-${FirestoreCollection.COMPANY_OVERVIEW}`,
].join('/');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  console.log(`--- Verifying companyInfo write-back for ${SYMBOL} against prod Firestore ---\n`);

  // Stage 1: read the real stored overview doc
  const overviewSnap = await db.doc(OVERVIEW_DOC).get();
  assert(overviewSnap.exists, `Overview doc exists at ${OVERVIEW_DOC}`);
  const overview = overviewSnap.data()?.data as AvCompanyOverview | undefined;
  assert(!!overview?.MarketCapitalization, `Overview doc has MarketCapitalization (got "${overview?.MarketCapitalization}")`);
  assert(!!overview?.Beta, `Overview doc has Beta (got "${overview?.Beta}")`);

  // Stage 2: build — real stored data → typed companyInfo
  const info = buildTrackedSymbolCompanyInfo(overview!);
  assert(typeof info.marketCap === 'number' && Number.isFinite(info.marketCap), `marketCap parsed to number (got ${info.marketCap})`);
  assert(typeof info.beta === 'number' && Number.isFinite(info.beta), `beta parsed to number (got ${info.beta})`);
  assert(info.Sector === overview!.Sector, `Sector preserved verbatim (got "${info.Sector}")`);

  // Stage 3: persistence — same update() write the handler performs (whole-map
  // replace so absent fields clear rather than linger stale)
  await db
    .collection(FirestoreCollection.TRACKED_SYMBOLS)
    .doc(SYMBOL)
    .update({
      [TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO]: info,
      [TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO_LAST_UPDATED]: admin.firestore.Timestamp.now(),
    });

  // Stage 4: read-back — confirm Firestore stored numbers, not strings, and merge wrote doc-root timestamp
  const trackedSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(SYMBOL).get();
  const doc = trackedSnap.data();
  const stored = doc?.[TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO];
  assert(typeof stored?.marketCap === 'number', `Stored companyInfo.marketCap is a Firestore number (got ${typeof stored?.marketCap}: ${stored?.marketCap})`);
  assert(typeof stored?.beta === 'number', `Stored companyInfo.beta is a Firestore number (got ${typeof stored?.beta}: ${stored?.beta})`);
  const lastUpdated = doc?.[TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO_LAST_UPDATED];
  assert(
    typeof lastUpdated?.toMillis === 'function' && lastUpdated.toMillis() > 0,
    `Doc-root ${TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO_LAST_UPDATED} is a Timestamp (got ${lastUpdated?.toDate?.()?.toISOString?.() ?? lastUpdated})`,
  );

  // Omission behavior on bad source values
  const sparse = buildTrackedSymbolCompanyInfo({
    Symbol: 'TEST',
    MarketCapitalization: 'None',
    Beta: undefined,
  });
  assert(!('marketCap' in sparse), `marketCap omitted when source is "None"`);
  assert(!('beta' in sparse), `beta omitted when source is undefined`);

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  process.exit(1);
});
