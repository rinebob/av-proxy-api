/**
 * One-time backfill (Task #99): populate companyInfo.marketCap/beta (and the
 * full companyInfo subset when absent) on tracked-symbols from the already
 * stored symbol-data/{SYM}/company-overview/av-company-overview docs.
 *
 * Zero Alpha Vantage API calls — parses data already in Firestore.
 *
 * Per symbol:
 * - Read the stored overview doc; skip symbols without one (ETFs etc.)
 * - buildTrackedSymbolCompanyInfo(data) → canonical companyInfo subset
 * - diffCompanyInfoForWrite(existing, built) → minimal dotted-path update,
 *   or null when identical (re-runs write nothing → idempotent)
 * - update() the delta + _companyInfoLastUpdated (only when fields changed)
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/backfill/backfill-companyinfo-numbers.ts [--dry-run] [--symbols A,MSFT]
 *
 * CLI flags:
 *   --dry-run        Report intended writes; touch nothing
 *   --symbols X,Y    Only process a subset of symbols (comma-separated)
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS, AvCompanyOverview } from '@shared/alpha-vantage';
import {
  buildTrackedSymbolCompanyInfo,
  diffCompanyInfoForWrite,
} from '../../src/v2/alpha-vantage/logic/company-info.builder';

// Initialize with the explicit project BEFORE importing db — firebase-admin-init
// self-initializes on import and picks up whatever project ambient env provides.
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../src/firebase-admin-init') as typeof import('../../src/firebase-admin-init');

function logInfo(...args: unknown[]): void {
  console.log('[backfill-companyinfo]', ...args);
}

interface CliArgs {
  dryRun: boolean;
  symbolsRaw?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let dryRun = false;
  let symbolsRaw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--symbols' && args[i + 1]) {
      symbolsRaw = args[++i];
    } else if (arg.startsWith('--symbols=')) {
      symbolsRaw = arg.split('=', 2)[1];
    }
  }
  return { dryRun, symbolsRaw };
}

async function getTrackedSymbols(symbolsRaw?: string): Promise<string[]> {
  if (symbolsRaw?.trim()) {
    return symbolsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map(d => d.id.toUpperCase());
}

function overviewDocPath(symbol: string): string {
  return [
    FirestoreCollection.SYMBOL_DATA,
    symbol,
    FirestoreCollection.COMPANY_OVERVIEW,
    `av-${FirestoreCollection.COMPANY_OVERVIEW}`,
  ].join('/');
}

async function main(): Promise<void> {
  const { dryRun, symbolsRaw } = parseCliArgs(process.argv);
  const symbols = await getTrackedSymbols(symbolsRaw);

  logInfo(`Backfilling companyInfo numbers for ${symbols.length} tracked symbols${dryRun ? ' [DRY_RUN]' : ''}...`);

  let written = 0;
  let unchanged = 0;
  let noOverview = 0;
  let noTrackedDoc = 0;
  let errors = 0;
  const skippedNoOverview: string[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      const overviewSnap = await db.doc(overviewDocPath(symbol)).get();
      if (!overviewSnap.exists) {
        noOverview++;
        skippedNoOverview.push(symbol);
        continue;
      }
      const data = overviewSnap.data()?.data as AvCompanyOverview | undefined;
      if (!data) {
        noOverview++;
        skippedNoOverview.push(symbol);
        continue;
      }

      const trackedRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
      const trackedSnap = await trackedRef.get();
      if (!trackedSnap.exists) {
        noTrackedDoc++;
        continue;
      }

      const built = buildTrackedSymbolCompanyInfo(data);
      const existing = trackedSnap.data()?.[TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO];
      const delta = diffCompanyInfoForWrite(existing, built);

      if (!delta) {
        unchanged++;
        continue;
      }

      if (dryRun) {
        written++;
        logInfo(`DRY_RUN ${symbol}: would write ${Object.keys(delta).join(', ')}`);
      } else {
        await trackedRef.update({
          ...delta,
          [TRACKED_SYMBOL_V2_FIELDS.COMPANY_INFO_LAST_UPDATED]: admin.firestore.FieldValue.serverTimestamp(),
        });
        written++;
      }
    } catch (e: any) {
      errors++;
      logInfo(`ERROR ${symbol}: ${e?.message || e}`);
    }

    if ((i + 1) % 100 === 0) {
      logInfo(`  processed ${i + 1}/${symbols.length}...`);
    }
  }

  logInfo('\n=== BACKFILL SUMMARY ===');
  logInfo(`Total tracked:     ${symbols.length}`);
  logInfo(`${dryRun ? 'Would write' : 'Written'}:        ${written}`);
  logInfo(`Already current:   ${unchanged}`);
  logInfo(`No overview doc:   ${noOverview}`);
  logInfo(`No tracked doc:    ${noTrackedDoc}`);
  logInfo(`Errors:            ${errors}`);
  if (skippedNoOverview.length > 0) {
    logInfo(`\nSkipped (no overview — ETFs/indexes):\n  ${skippedNoOverview.join(', ')}`);
  }
  logInfo('\nDone.');
  process.exitCode = errors > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('[backfill-companyinfo] fatal', e?.message || e);
  process.exitCode = 1;
});
