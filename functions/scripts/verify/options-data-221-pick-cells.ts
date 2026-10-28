/**
 * Verification script for Task #221 — picker core (pickCellsForDate).
 *
 * Loads the REAL prod GCS corpus chains for every day in the golden asset
 * window (QQQ, April 2026) and cross-checks the picker two ways:
 *
 * 1. ORACLE: for each day, an independent brute-force recomputation of the
 *    SPEC selection rule (nearest-DTE expiration, tie -> longer DTE; then
 *    argmin |observedDelta - target|, tie -> larger |delta| -> lowest
 *    contractId) over the raw chain must agree with pickCellsForDate on
 *    every one of the 380 cells.
 * 2. GOLDEN-DIFF (report-only): the QQQ-put-20-45 cell is compared against
 *    the validated example asset. Diffs are WARNED, not failed — the asset
 *    predates corpus self-repair (e.g., the 2026-04-14 hole was seeded
 *    later) and interim-snapshot supersession, so real chains may now hold
 *    more contracts than the golden generator saw. Full golden
 *    reconciliation is Task #226.
 *
 * Read-only — GCS download only, no writes.
 * Credentials: ADC / GOOGLE_APPLICATION_CREDENTIALS (same as other verify
 * scripts); needs read access to the options corpus bucket.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-221-pick-cells.ts
 */
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { resolve } from 'path';
import { getStorage } from 'firebase-admin/storage';
import * as admin from 'firebase-admin';
import type { AvOptionContract } from '@shared/alpha-vantage/av-historical-options';
import { PICK_GRID, isPickEntry, type DayPickEntry } from '@shared/options';
import {
  noChainPickEntries,
  pickCellsForDate,
} from '../../src/v2/historical-options-corpus/services/options-delta-picker.service';
import { isValidIsoDate } from '../../src/v2/common/utils/date-time.utils';
import {
  HISTORICAL_OPTIONS_CORPUS_PREFIX,
  optionsCorpusBucket,
  type HistoricalOptionsCorpusEnvelope,
} from '../../src/v2/historical-options-corpus/types';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function loadChain(date: string): Promise<AvOptionContract[] | null> {
  const path = `${HISTORICAL_OPTIONS_CORPUS_PREFIX}/QQQ/${date}.json.gz`;
  const file = getStorage().bucket(optionsCorpusBucket()).file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const envelope = JSON.parse(
    gunzipSync(buf).toString('utf8'),
  ) as HistoricalOptionsCorpusEnvelope;
  return envelope.response.data;
}

/** Independent naive oracle — deliberately duplicates the SPEC rule with
 *  plain loops so an implementation bug in either side surfaces as a diff. */
function oracle(
  chain: AvOptionContract[] | null,
  type: 'put' | 'call',
  deltaPct: number,
  dteTarget: number,
  date: string,
): { kind: 'no_chain' } | { kind: 'no_match' } | { kind: 'pick'; contractId: string } {
  if (chain === null) return { kind: 'no_chain' };
  const target = type === 'put' ? -deltaPct / 100 : deltaPct / 100;
  const strict = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? NaN : Number(v);
  const rows = chain
    .filter((r) => r.type === type)
    .map((r) => ({
      r,
      delta: strict(r.delta),
      strike: strict(r.strike),
      dte:
        r.expiration !== undefined && isValidIsoDate(r.expiration)
          ? Math.round(
              (Date.parse(`${r.expiration}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000,
            )
          : NaN,
    }))
    .filter(
      (x) =>
        x.r.contractID !== undefined &&
        x.r.contractID.trim() !== '' &&
        Number.isFinite(x.delta) &&
        Number.isFinite(x.strike) &&
        Number.isFinite(x.dte) &&
        x.dte >= 0,
    );
  if (rows.length === 0) return { kind: 'no_match' };
  const exps = [...new Set(rows.map((x) => x.r.expiration as string))];
  let bestExp = '';
  let bestExpDte = -1;
  for (const e of exps) {
    const d = Math.abs(rows.find((x) => x.r.expiration === e)!.dte - dteTarget);
    const dte = rows.find((x) => x.r.expiration === e)!.dte;
    if (
      bestExp === '' ||
      d < Math.abs(bestExpDte - dteTarget) ||
      (d === Math.abs(bestExpDte - dteTarget) && dte > bestExpDte)
    ) {
      bestExp = e;
      bestExpDte = dte;
    }
  }
  const cands = rows.filter((x) => x.r.expiration === bestExp);
  let best = cands[0];
  for (const c of cands) {
    const d = Math.abs(c.delta - target);
    const dB = Math.abs(best.delta - target);
    if (
      d < dB ||
      (d === dB &&
        (Math.abs(c.delta) > Math.abs(best.delta) ||
          (Math.abs(c.delta) === Math.abs(best.delta) &&
            (c.r.contractID ?? '') < (best.r.contractID ?? ''))))
    ) {
      best = c;
    }
  }
  return { kind: 'pick', contractId: best.r.contractID ?? '' };
}

async function main() {
  const assetPath = resolve(
    __dirname,
    '../../../src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json',
  );
  const example = JSON.parse(readFileSync(assetPath, 'utf8'));
  const days = example.days as Record<string, Record<string, unknown>>;
  const dates = Object.keys(days).sort();
  assert(dates.length > 0, `example asset has ${dates.length} day entries`);

  let totalCells = 0;
  let pickCells = 0;
  let missCells = 0;
  const oracleDiffs: string[] = [];
  const goldenDiffs: string[] = [];

  for (const date of dates) {
    const chain = await loadChain(date);
    const underlyingClose = days[date].underlyingClose as number | undefined;
    const out =
      chain === null
        ? noChainPickEntries('QQQ', underlyingClose)
        : pickCellsForDate(chain, underlyingClose, date, 'QQQ');
    assert(out.size === 380, `${date}: picker emits 380 entries (got ${out.size})`);

    for (const cell of PICK_GRID) {
      totalCells++;
      const key = `QQQ-${cell.type}-${cell.deltaPct}-${cell.dte}`;
      const entry = out.get(key) as DayPickEntry;
      const expected = oracle(chain, cell.type, cell.deltaPct, cell.dte, date);
      const actualKind = isPickEntry(entry)
        ? { kind: 'pick', contractId: entry.contractId }
        : { kind: entry.status };
      if (JSON.stringify(actualKind) !== JSON.stringify(expected)) {
        oracleDiffs.push(`${date} ${key}: picker ${JSON.stringify(actualKind)} vs oracle ${JSON.stringify(expected)}`);
      }
      if (isPickEntry(entry)) {
        pickCells++;
        // Structural invariants on the emitted pick.
        if (!(entry.dte >= 0) || entry.contractId === '') {
          oracleDiffs.push(`${date} ${key}: malformed pick entry ${JSON.stringify(entry)}`);
        }
      } else {
        missCells++;
      }
    }

    // Golden-diff, report-only (see header note).
    const golden = days[date];
    const actual = out.get('QQQ-put-20-45')!;
    if (isPickEntry(actual) && 'contractId' in golden) {
      for (const [k, v] of Object.entries(golden)) {
        const a = (actual as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(a) !== JSON.stringify(v)) {
          goldenDiffs.push(`${date} field ${k}: golden ${JSON.stringify(v)} vs picker ${JSON.stringify(a)}`);
        }
      }
    } else if (!isPickEntry(actual) && golden.status === actual.status) {
      // same miss status — agreement
    } else {
      goldenDiffs.push(
        `${date}: golden ${'contractId' in golden ? `pick ${golden.contractId}` : `miss ${golden.status}`} vs picker ${isPickEntry(actual) ? `pick ${actual.contractId}` : `miss ${actual.status}`}`,
      );
    }
  }

  oracleDiffs.slice(0, 20).forEach((m) => console.error('ORACLE-DIFF: ' + m));
  assert(oracleDiffs.length === 0, `oracle agrees with picker on all ${totalCells} cells across ${dates.length} days (${oracleDiffs.length} diffs)`);
  console.log(`PICKS: ${pickCells} | MISSES: ${missCells} across ${totalCells} cells / ${dates.length} real prod chains`);
  goldenDiffs.forEach((m) => console.warn('GOLDEN-DIFF (info): ' + m));
  console.log(`GOLDEN: ${goldenDiffs.length} field diffs vs example asset — report-only, reconciliation is Task #226`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
