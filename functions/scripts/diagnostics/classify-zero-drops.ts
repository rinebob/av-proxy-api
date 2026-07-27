/**
 * Classification script for zero-drop anomalies.
 *
 * Reads an anomaly CSV (from scan-data-quality.ts) and classifies each row
 * as LEGITIMATE_EXPIRATION, SUSPICIOUS_PHANTOM, or AMBIGUOUS by:
 *
 *   1. Fetching QQQ (or TQQQ) daily close prices from Firestore for the
 *      affected dates.
 *   2. Determining moneyness (ITM vs OTM) using strike + underlying close.
 *   3. Applying heuristics based on daysToExpiration, valueAfter, and
 *      whether the anomaly is a trailing-zero or a recovery.
 *
 * Output: a new CSV with all original columns plus `classification`,
 * `underlyingClose`, and `moneyness`, plus a console summary.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/classify-zero-drops.ts
 *
 * Required:
 *   INPUT_CSV=path/to/data-quality-*.csv
 *
 * Optional:
 *   SYMBOLS=QQQ,TQQQ          // symbols to fetch underlying data for
 *   RISK_FREE_RATE=0.04       // not used here but kept for future BS pricing
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { fetchUnderlyingCloses, lookupUnderlyingClose } from './underlying-closes.service';
import { parseCsvLine } from './csv-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnomalyRow {
  contractId: string;
  expiration: string;
  strike: string;
  type: string;
  anomalyType: string;
  severity: string;
  affectedDate: string;
  affectedDateEnd: string;
  detail: string;
  valueBefore: string;
  valueAfter: string;
  zeroRunLength: number;
  isTrailingZeros: boolean;
  expectedObs: number;
  actualObs: number;
  obsDeficiencyPct: number;
  daysToExpiration: number | null;
  isEarlyStart: boolean;
  totalObs: number;
  firstTradedDate: string;
  fileStartDate: string;
  fileEndDate: string;
}

type Classification = 'LEGITIMATE_EXPIRATION' | 'SUSPICIOUS_PHANTOM' | 'AMBIGUOUS';
type Moneyness = 'ITM' | 'OTM' | 'UNKNOWN';

interface ClassifiedRow extends AnomalyRow {
  classification: Classification;
  underlyingClose: string;
  moneyness: Moneyness;
}

const CSV_COLUMNS = [
  'contractId', 'expiration', 'strike', 'type', 'anomalyType', 'severity',
  'affectedDate', 'affectedDateEnd', 'detail', 'valueBefore', 'valueAfter',
  'zeroRunLength', 'isTrailingZeros', 'expectedObs', 'actualObs',
  'obsDeficiencyPct', 'daysToExpiration', 'isEarlyStart', 'totalObs',
  'firstTradedDate', 'fileStartDate', 'fileEndDate',
] as const;

function parseAnomalyCsv(content: string): AnomalyRow[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const rows: AnomalyRow[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < CSV_COLUMNS.length) continue;

    rows.push({
      contractId: fields[0],
      expiration: fields[1],
      strike: fields[2],
      type: fields[3],
      anomalyType: fields[4],
      severity: fields[5],
      affectedDate: fields[6],
      affectedDateEnd: fields[7],
      detail: fields[8],
      valueBefore: fields[9],
      valueAfter: fields[10],
      zeroRunLength: Number(fields[11]),
      isTrailingZeros: fields[12] === 'true',
      expectedObs: Number(fields[13]),
      actualObs: Number(fields[14]),
      obsDeficiencyPct: Number(fields[15]),
      daysToExpiration: fields[16] ? Number(fields[16]) : null,
      isEarlyStart: fields[17] === 'true',
      totalObs: Number(fields[18]),
      firstTradedDate: fields[19],
      fileStartDate: fields[20],
      fileEndDate: fields[21],
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Determines moneyness: ITM if the option has intrinsic value, OTM otherwise.
 */
function determineMoneyness(
  type: string,
  strike: number,
  underlyingClose: number,
): Moneyness {
  if (type === 'call') {
    return underlyingClose > strike ? 'ITM' : 'OTM';
  } else if (type === 'put') {
    return underlyingClose < strike ? 'ITM' : 'OTM';
  }
  return 'UNKNOWN';
}

/**
 * Classifies an anomaly row based on moneyness, days to expiration,
 * value after drop, and whether it's a recovery or trailing zero.
 */
function classifyAnomaly(
  row: AnomalyRow,
  underlyingClose: number | null,
): { classification: Classification; moneyness: Moneyness } {
  const strikeNum = Number(row.strike);
  const valueAfter = Number(row.valueAfter);
  const dte = row.daysToExpiration;

  // Can't classify without underlying close
  if (underlyingClose == null || !Number.isFinite(strikeNum)) {
    // # Reason: If we can't determine moneyness, use heuristics based on
    // the anomaly type and valueAfter alone.
    if (row.anomalyType === 'ZERO_DROP_RECOVERY') {
      return { classification: 'SUSPICIOUS_PHANTOM', moneyness: 'UNKNOWN' };
    }
    if (row.isTrailingZeros && dte === 0 && valueAfter > 0 && valueAfter <= 0.05) {
      return { classification: 'LEGITIMATE_EXPIRATION', moneyness: 'UNKNOWN' };
    }
    return { classification: 'AMBIGUOUS', moneyness: 'UNKNOWN' };
  }

  const moneyness = determineMoneyness(row.type, strikeNum, underlyingClose);

  // ZERO_DROP_RECOVERY is always suspicious — the price went to zero
  // then recovered, which is never a real market event.
  if (row.anomalyType === 'ZERO_DROP_RECOVERY') {
    return { classification: 'SUSPICIOUS_PHANTOM', moneyness };
  }

  // TRAILING_ZEROS classification
  if (row.isTrailingZeros) {
    // Expiration day, OTM, small residual value → legitimate
    if (dte === 0 && moneyness === 'OTM' && valueAfter > 0 && valueAfter <= 0.05) {
      return { classification: 'LEGITIMATE_EXPIRATION', moneyness };
    }

    // Expiration day, OTM, exactly zero → likely legitimate (no bid)
    if (dte === 0 && moneyness === 'OTM' && valueAfter === 0) {
      return { classification: 'LEGITIMATE_EXPIRATION', moneyness };
    }

    // ITM at any point with zero price → suspicious (has intrinsic value)
    if (moneyness === 'ITM') {
      return { classification: 'SUSPICIOUS_PHANTOM', moneyness };
    }

    // OTM with days to expiration > 0 and price = 0.00 → suspicious
    // (OTM options near expiration may be worth 0.01, but exactly 0.00
    // with time remaining suggests data corruption)
    if (moneyness === 'OTM' && dte != null && dte > 0 && valueAfter === 0) {
      return { classification: 'SUSPICIOUS_PHANTOM', moneyness };
    }

    // OTM with days to expiration > 5 and any zero drop → suspicious
    // (even cheap OTM options shouldn't suddenly drop to zero mid-life)
    if (moneyness === 'OTM' && dte != null && dte > 5) {
      return { classification: 'SUSPICIOUS_PHANTOM', moneyness };
    }

    // OTM, near expiration (1-5 days), small residual value → ambiguous
    return { classification: 'AMBIGUOUS', moneyness };
  }

  // Non-trailing, non-recovery (shouldn't happen in practice)
  return { classification: 'AMBIGUOUS', moneyness };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

function classifiedRowToCsv(row: ClassifiedRow): string {
  const fields = [
    row.contractId,
    row.expiration,
    row.strike,
    row.type,
    row.anomalyType,
    row.severity,
    row.affectedDate,
    row.affectedDateEnd,
    `"${row.detail.replace(/"/g, '""')}"`,
    row.valueBefore,
    row.valueAfter,
    String(row.zeroRunLength),
    row.isTrailingZeros ? 'true' : 'false',
    String(row.expectedObs),
    String(row.actualObs),
    String(row.obsDeficiencyPct),
    row.daysToExpiration !== null ? String(row.daysToExpiration) : '',
    row.isEarlyStart ? 'true' : 'false',
    String(row.totalObs),
    row.firstTradedDate,
    row.fileStartDate,
    row.fileEndDate,
    row.classification,
    row.underlyingClose,
    row.moneyness,
  ];
  return fields.join(',');
}

const OUTPUT_HEADER = [...CSV_COLUMNS, 'classification', 'underlyingClose', 'moneyness'].join(',');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const inputCsv = process.env.INPUT_CSV;
  if (!inputCsv) {
    throw new Error('INPUT_CSV environment variable is required');
  }

  const symbols = (process.env.SYMBOLS ?? 'QQQ,TQQQ')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  console.log(`Classifying anomalies from: ${inputCsv}`);
  console.log(`Underlying symbols: ${symbols.join(', ')}`);

  // 1. Parse the anomaly CSV
  const csvContent = fs.readFileSync(inputCsv, 'utf8');
  const anomalies = parseAnomalyCsv(csvContent);
  console.log(`Parsed ${anomalies.length} anomaly rows`);

  if (anomalies.length === 0) {
    console.log('No anomalies to classify. Exiting.');
    return;
  }

  // 2. Determine which years we need underlying data for
  const allDates = anomalies.flatMap((a) => [a.affectedDate, a.fileStartDate, a.fileEndDate]);
  const yearsNeeded = new Set<number>();
  for (const d of allDates) {
    if (d && d.length >= 4) {
      const y = Number(d.slice(0, 4));
      if (Number.isFinite(y)) yearsNeeded.add(y);
    }
  }
  const sortedYears = [...yearsNeeded].sort((a, b) => a - b);
  console.log(`Fetching underlying data for years: ${sortedYears.join(', ')}`);

  // 3. Fetch underlying closes for each symbol
  const closeMaps = new Map<string, Map<string, number>>();
  for (const sym of symbols) {
    console.log(`  Fetching ${sym} daily closes...`);
    const closes = await fetchUnderlyingCloses(sym, sortedYears);
    console.log(`    ${sym}: ${closes.size} daily bars loaded`);
    closeMaps.set(sym, closes);
  }

  // 4. Classify each anomaly
  const classified: ClassifiedRow[] = [];
  const stats = {
    LEGITIMATE_EXPIRATION: 0,
    SUSPICIOUS_PHANTOM: 0,
    AMBIGUOUS: 0,
  };
  const suspiciousBySymbol = new Map<string, number>();
  const suspiciousContracts = new Set<string>();

  for (const row of anomalies) {
    // Determine which symbol's underlying to use
    // # Reason: Contract IDs start with the symbol (QQQ or TQQQ).
    // Try each configured symbol to find a match.
    let underlyingClose: number | null = null;
    for (const sym of symbols) {
      if (row.contractId.startsWith(sym)) {
        const closeMap = closeMaps.get(sym);
        if (closeMap) {
          underlyingClose = lookupUnderlyingClose(closeMap, row.affectedDate);
        }
        break;
      }
    }

    const { classification, moneyness } = classifyAnomaly(row, underlyingClose);

    stats[classification]++;
    if (classification === 'SUSPICIOUS_PHANTOM') {
      // Extract symbol from contract ID for per-symbol stats
      for (const sym of symbols) {
        if (row.contractId.startsWith(sym)) {
          suspiciousBySymbol.set(sym, (suspiciousBySymbol.get(sym) ?? 0) + 1);
          break;
        }
      }
      suspiciousContracts.add(row.contractId);
    }

    classified.push({
      ...row,
      classification,
      underlyingClose: underlyingClose != null ? underlyingClose.toFixed(2) : '',
      moneyness,
    });
  }

  // 5. Write classified CSV
  const outputDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `classified-anomalies-${timestamp}.csv`);
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  stream.write(OUTPUT_HEADER + '\n');
  for (const row of classified) {
    stream.write(classifiedRowToCsv(row) + '\n');
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error) => (err ? reject(err) : resolve()));
  });

  // 6. Print summary
  console.log(`\nClassified CSV written: ${outputPath}`);
  console.log(`\n=== Classification Summary ===`);
  console.log(`  Total anomalies:        ${classified.length}`);
  console.log(`  LEGITIMATE_EXPIRATION:  ${stats.LEGITIMATE_EXPIRATION}`);
  console.log(`  SUSPICIOUS_PHANTOM:     ${stats.SUSPICIOUS_PHANTOM}`);
  console.log(`  AMBIGUOUS:              ${stats.AMBIGUOUS}`);

  console.log(`\n  Suspicious by symbol:`);
  for (const [sym, count] of suspiciousBySymbol) {
    console.log(`    ${sym.padEnd(6)} ${count} anomalies`);
  }

  console.log(`\n  Unique suspicious contracts: ${suspiciousContracts.size}`);

  // Print a sample of suspicious anomalies
  const suspiciousSample = classified
    .filter((r) => r.classification === 'SUSPICIOUS_PHANTOM')
    .slice(0, 20);
  if (suspiciousSample.length > 0) {
    console.log(`\n  Sample suspicious anomalies (first 20):`);
    console.log(`    ${'contractId'.padEnd(22)} ${'date'.padEnd(12)} ${'type'.padEnd(5)} ${'strike'.padEnd(8)} ${'close'.padEnd(8)} ${'money'.padEnd(5)} ${'dte'.padEnd(5)} ${'before'.padEnd(8)} ${'after'.padEnd(8)} ${'anomalyType'}`);
    for (const r of suspiciousSample) {
      console.log(
        `    ${r.contractId.padEnd(22)} ${r.affectedDate.padEnd(12)} ${r.type.padEnd(5)} ${r.strike.padEnd(8)} ${r.underlyingClose.padEnd(8)} ${r.moneyness.padEnd(5)} ${String(r.daysToExpiration ?? '').padEnd(5)} ${r.valueBefore.padEnd(8)} ${r.valueAfter.padEnd(8)} ${r.anomalyType}`,
      );
    }
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Classification failed:', error);
  process.exit(1);
});
