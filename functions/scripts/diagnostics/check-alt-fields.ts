/**
 * Sample checker: downloads JSONL files for a small set of suspicious contracts
 * and inspects whether `mark`, `bid`, and `ask` are non-zero on corrupted dates
 * where `last` dropped to zero.
 *
 * This tells us whether we can repair `last` from existing fields (mark, bid,
 * ask) without needing a third-party data source.
 *
 * Usage (from functions/):
 *   $env:INPUT_CSV="./scripts/diagnostics/output/classified-anomalies-*.csv"; `
 *   $env:FIRESTORE_EMULATOR_HOST=$null; `
 *   $env:GCLOUD_PROJECT="alpha-vantage-proxy-api"; `
 *   $env:SAMPLE_SIZE="20"; `
 *   npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-alt-fields.ts
 *
 * Required:
 *   INPUT_CSV=path/to/classified-anomalies-*.csv
 *   OPTIONS_TIME_SERIES_BUCKET=...
 *
 * Optional:
 *   SAMPLE_SIZE=20    // number of suspicious contracts to sample
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { admin } from '../../src/firebase-admin-init';
import { TIME_SERIES_PREFIX } from '../../src/v2/historical-options-corpus/types';
import { parseObsLine } from './data-quality-detect';
import { parseCsvLine } from './csv-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassifiedRow {
  contractId: string;
  expiration: string;
  strike: string;
  type: string;
  anomalyType: string;
  affectedDate: string;
  affectedDateEnd: string;
  valueBefore: string;
  valueAfter: string;
  isTrailingZeros: boolean;
  daysToExpiration: number | null;
  classification: string;
  underlyingClose: string;
  moneyness: string;
}

interface FieldCheck {
  date: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  hasMark: boolean;
  hasBid: boolean;
  hasAsk: boolean;
  hasMid: boolean;
  mid: number | null;
}

function parseClassifiedCsv(content: string): ClassifiedRow[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Find column indices from header
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);

  const iContractId = idx('contractId');
  const iExpiration = idx('expiration');
  const iStrike = idx('strike');
  const iType = idx('type');
  const iAnomalyType = idx('anomalyType');
  const iAffectedDate = idx('affectedDate');
  const iAffectedDateEnd = idx('affectedDateEnd');
  const iValueBefore = idx('valueBefore');
  const iValueAfter = idx('valueAfter');
  const iIsTrailing = idx('isTrailingZeros');
  const iDte = idx('daysToExpiration');
  const iClassification = idx('classification');
  const iUnderlyingClose = idx('underlyingClose');
  const iMoneyness = idx('moneyness');

  const rows: ClassifiedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    if (f.length < header.length) continue;
    rows.push({
      contractId: f[iContractId],
      expiration: f[iExpiration],
      strike: f[iStrike],
      type: f[iType],
      anomalyType: f[iAnomalyType],
      affectedDate: f[iAffectedDate],
      affectedDateEnd: f[iAffectedDateEnd],
      valueBefore: f[iValueBefore],
      valueAfter: f[iValueAfter],
      isTrailingZeros: f[iIsTrailing] === 'true',
      daysToExpiration: f[iDte] ? Number(f[iDte]) : null,
      classification: f[iClassification],
      underlyingClose: f[iUnderlyingClose],
      moneyness: f[iMoneyness],
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// GCS download and field inspection
// ---------------------------------------------------------------------------

/**
 * Downloads a JSONL file from GCS, parses observations, and checks
 * whether mark/bid/ask are non-zero on dates where last is ~0.
 */
async function checkContractFields(
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>,
  symbol: string,
  contractId: string,
  corruptedDates: Set<string>,
): Promise<FieldCheck[]> {
  const objectPath = `${TIME_SERIES_PREFIX}/${symbol.toUpperCase()}/${contractId}.jsonl`;
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return [];

  const [buffer] = await file.download();
  const lines = buffer.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean);

  const results: FieldCheck[] = [];
  for (const line of lines) {
    const obs = parseObsLine(line);
    if (!obs || !corruptedDates.has(obs.d)) continue;

    const last = obs.l;
    const mark = obs.m;
    const bid = obs.b;
    const ask = obs.a;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : null;

    results.push({
      date: obs.d,
      last,
      mark,
      bid,
      ask,
      hasMark: mark != null && mark > 0.05,
      hasBid: bid != null && bid > 0.05,
      hasAsk: ask != null && ask > 0.05,
      hasMid: mid != null && mid > 0.05,
      mid,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const inputCsv = process.env.INPUT_CSV;
  if (!inputCsv) {
    throw new Error('INPUT_CSV environment variable is required');
  }
  const bucketName = process.env.OPTIONS_TIME_SERIES_BUCKET;
  if (!bucketName) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is required');
  }
  const sampleSize = Number(process.env.SAMPLE_SIZE ?? '20');

  console.log(`Checking alt fields for ${sampleSize} suspicious contracts`);
  console.log(`Input CSV: ${inputCsv}`);
  console.log(`Bucket: ${bucketName}`);

  // 1. Parse classified CSV, filter to SUSPICIOUS_PHANTOM
  const content = fs.readFileSync(inputCsv, 'utf8');
  const rows = parseClassifiedCsv(content);
  const suspicious = rows.filter((r) => r.classification === 'SUSPICIOUS_PHANTOM');
  console.log(`Total suspicious rows: ${suspicious.length}`);

  // 2. Group by contractId, pick unique contracts
  const byContract = new Map<string, ClassifiedRow[]>();
  for (const r of suspicious) {
    const arr = byContract.get(r.contractId) ?? [];
    arr.push(r);
    byContract.set(r.contractId, arr);
  }
  console.log(`Unique suspicious contracts: ${byContract.size}`);

  // 3. Sample N contracts (spread across the dataset)
  const allContractIds = [...byContract.keys()];
  const step = Math.max(1, Math.floor(allContractIds.length / sampleSize));
  const sampledIds: string[] = [];
  for (let i = 0; i < allContractIds.length && sampledIds.length < sampleSize; i += step) {
    sampledIds.push(allContractIds[i]);
  }
  console.log(`Sampled ${sampledIds.length} contracts (every ${step}th)`);

  // 4. Download and inspect each
  const storage = admin.storage();
  const bucket = storage.bucket(bucketName);

  let totalCorruptedDates = 0;
  let datesWithMark = 0;
  let datesWithBid = 0;
  let datesWithAsk = 0;
  let datesWithMid = 0;
  let datesWithNothing = 0;

  console.log(`\n${'contractId'.padEnd(22)} ${'date'.padEnd(12)} ${'last'.padEnd(8)} ${'mark'.padEnd(8)} ${'bid'.padEnd(8)} ${'ask'.padEnd(8)} ${'mid'.padEnd(8)} ${'repairable'}`);
  console.log('-'.repeat(95));

  for (const contractId of sampledIds) {
    // # Reason: Extract symbol from contract ID prefix (e.g., QQQ190104C...).
    const symbol = contractId.match(/^[A-Z]+/)?.[0] ?? 'QQQ';
    const contractRows = byContract.get(contractId)!;
    const corruptedDates = new Set(contractRows.map((r) => r.affectedDate));

    const checks = await checkContractFields(bucket, symbol, contractId, corruptedDates);

    for (const c of checks) {
      totalCorruptedDates++;
      if (c.hasMark) datesWithMark++;
      if (c.hasBid) datesWithBid++;
      if (c.hasAsk) datesWithAsk++;
      if (c.hasMid) datesWithMid++;
      if (!c.hasMark && !c.hasMid) datesWithNothing++;

      const repairStr = c.hasMark ? 'MARK' : c.hasMid ? 'MID' : c.hasBid ? 'BID' : c.hasAsk ? 'ASK' : 'NONE';

      console.log(
        `${contractId.padEnd(22)} ${c.date.padEnd(12)} ${String(c.last ?? '').padEnd(8)} ${String(c.mark ?? '').padEnd(8)} ${String(c.bid ?? '').padEnd(8)} ${String(c.ask ?? '').padEnd(8)} ${String(c.mid ?? '').padEnd(8)} ${repairStr}`,
      );
    }
  }

  // 5. Summary
  console.log(`\n=== Field Availability Summary ===`);
  console.log(`  Total corrupted dates checked: ${totalCorruptedDates}`);
  console.log(`  Dates with non-zero mark:      ${datesWithMark} (${totalCorruptedDates ? ((datesWithMark / totalCorruptedDates) * 100).toFixed(1) : 0}%)`);
  console.log(`  Dates with non-zero bid:       ${datesWithBid} (${totalCorruptedDates ? ((datesWithBid / totalCorruptedDates) * 100).toFixed(1) : 0}%)`);
  console.log(`  Dates with non-zero ask:       ${datesWithAsk} (${totalCorruptedDates ? ((datesWithAsk / totalCorruptedDates) * 100).toFixed(1) : 0}%)`);
  console.log(`  Dates with non-zero mid:       ${datesWithMid} (${totalCorruptedDates ? ((datesWithMid / totalCorruptedDates) * 100).toFixed(1) : 0}%)`);
  console.log(`  Dates with NO alt field:       ${datesWithNothing} (${totalCorruptedDates ? ((datesWithNothing / totalCorruptedDates) * 100).toFixed(1) : 0}%)`);

  if (datesWithNothing === 0 && totalCorruptedDates > 0) {
    console.log(`\n  ✅ All corrupted dates have at least one non-zero alternative field.`);
    console.log(`     Repair from existing data is feasible without a third-party source.`);
  } else if (datesWithNothing > 0) {
    console.log(`\n  ⚠️  ${datesWithNothing} dates have no alternative field — would need external source.`);
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Check failed:', error);
  process.exit(1);
});
