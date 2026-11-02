/**
 * Verification script for Task #226 — golden-file pick verification.
 *
 * Regenerates the `QQQ-put-20-45` April-2026 window through the PRODUCTION
 * materialization path — `materializeSymbolPicks` → `pickCellsForDate` →
 * `mergeDayEntries` — with real prod inputs (GCS corpus chains via
 * GcsCorpusAdapter, adjusted closes via DailyAdjustedReader) and only the
 * destination Firestore swapped for an in-memory doc store, so the real
 * writer merge/assemble code runs but nothing is written.
 *
 * The gate is STRICT day-for-day equality vs the golden asset: the stored
 * corpus objects are write-once (GCS metageneration verified) and live AV
 * returns byte-identical values, so regenerated output must match the
 * baseline exactly. Any diff fails — and is root-cause classified against
 * the stored chain (`reconcileDay`) to make the diagnosis immediate.
 *
 * History note: the original `.example.json` was proven NOT to be pipeline
 * output (placeholder `updatedAt`, values absent from both stored objects
 * and live AV responses) — it was regenerated via `--write-asset` on
 * 2026-11-01. See options-data-226-golden-picks.md for the full
 * investigation.
 *
 * Also cross-checks the regenerated doc against the LIVE Firestore shard
 * (informational — divergence there means data changed since the shard
 * was materialized, since live picks are immutable first-writes).
 *
 * `--write-asset`: instead of diffing, serializes the regenerated doc
 * back over the golden asset file (`updatedAt` stays the placeholder
 * string the asset convention uses) PLUS a `provenance` block recording
 * every input the run consumed — per-date corpus object path, envelope
 * `generatedAt`, and payload sha256 — so a future diff can be traced to
 * exact inputs instead of requiring a forensic re-investigation. Use to
 * bless a fresh baseline after a legitimate corpus change — never run it
 * to silence a failing diff.
 *
 * Read-only vs prod: GCS download + Firestore reads only.
 * Credentials: ADC / GOOGLE_APPLICATION_CREDENTIALS; needs read access to
 * the options corpus bucket and the symbol-data collection.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-226-golden-picks.ts [--write-asset]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { AvOptionContract } from '@shared/alpha-vantage/av-historical-options';
import {
  cellYearDocPath,
  isPickEntry,
  type CellYearDoc,
  type DayPickEntry,
} from '@shared/options';

import {
  materializeSymbolPicks,
  type PickMaterializeLogger,
} from '../../src/v2/historical-options-corpus/services/pick-materialize.service';
import { GcsCorpusAdapter } from '../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { DailyAdjustedReader } from '../../src/v2/swing-set/services/daily-adjusted-reader.service';
import { optionsCorpusBucket } from '../../src/v2/historical-options-corpus/types';
import {
  diffEntries,
  reconcileDay,
  specWinner,
  type DayReconciliation,
  type PickCellSpec,
} from './options-data-226-golden-picks.core';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

const SYMBOL = 'QQQ';
const CELL_ID = 'QQQ-put-20-45';
const CELL: PickCellSpec = { type: 'put', deltaPct: 20, dte: 45 };
const YEAR = 2026;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

// --- In-memory Firestore (same pattern as the writer/materialize tests) --
// The REAL mergeDayEntries runs against it: tx.get reads, tx.set mutates.
const store = new Map<string, Record<string, unknown>>();
const fakeDb = {
  doc: (path: string) => ({ path }),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: async (ref: { path: string }) => {
        const d = store.get(ref.path);
        return { exists: d !== undefined, data: () => d };
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        store.set(ref.path, data);
      },
    }),
} as unknown as Firestore;

const logger: PickMaterializeLogger = {
  info: () => {},
  warn: (m, meta) => console.warn(`[pick-materialize] ${m}`, meta ?? {}),
};

async function main() {
  const assetPath = resolve(
    __dirname,
    '../../../src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json',
  );
  const example = JSON.parse(readFileSync(assetPath, 'utf8')) as {
    days: Record<string, DayPickEntry>;
    provenance?: {
      corpusInputs?: Record<string, { object?: string; generatedAt?: string; sha256?: string }>;
    };
  };
  const goldenDays = example.days;
  const dates = Object.keys(goldenDays).sort();
  assert(dates.length === 21, `golden asset has 21 April day entries (got ${dates.length})`);

  const db = admin.firestore();
  const gcs = new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket()));
  const bars = new DailyAdjustedReader(db);

  // Chains the regeneration saw — kept per date so each diff can be
  // classified against the exact input that produced it.
  const chains = new Map<string, AvOptionContract[] | null>();

  // Input fingerprints for the provenance block (--write-asset): the exact
  // object, envelope timestamp, and payload checksum the picker consumed.
  const inputs = new Map<string, { object: string; generatedAt: string; sha256: string }>();

  const report = await materializeSymbolPicks(
    { symbol: SYMBOL, dates },
    {
      db: fakeDb,
      listCorpusDates: async () => {
        throw new Error('listCorpusDates must not be called — explicit dates were supplied');
      },
      loadChain: async (symbol, date): Promise<AvOptionContract[] | undefined> => {
        const result = await gcs.readItem(symbol, date);
        if (result.status === 'NOT_FOUND') {
          chains.set(date, null);
          return undefined;
        }
        if (result.status === 'CORRUPT') {
          throw new Error(`corrupt corpus object ${symbol}/${date}: ${result.reason}`);
        }
        chains.set(date, result.response.data);
        inputs.set(date, {
          object: gcs.getObjectPath(symbol, date),
          generatedAt: result.envelope.generatedAt,
          sha256: result.envelope.checksum.value,
        });
        return result.response.data;
      },
      loadCloses: async (s) => {
        const list = await bars.read(s);
        return new Map(list.map((b) => [b.date, b.adjustedClose]));
      },
      logger,
    },
  );

  console.log(
    `MATERIALIZE: datesSeen=${report.datesSeen} picked=${report.datesPicked} noChain=${report.datesNoChain} ` +
      `loadFailures=[${report.loadFailures.join(',')}] daysWritten=${report.daysWritten} daysSkipped=${report.daysSkipped}`,
  );
  assert(report.loadFailures.length === 0, 'no corpus chain load failures');
  assert(report.datesSeen === dates.length, `materialization visited all ${dates.length} golden dates`);

  const docPath = cellYearDocPath(CELL_ID, YEAR);
  const regen = store.get(docPath) as CellYearDoc | undefined;
  assert(regen !== undefined, `regenerated doc materialized at ${docPath}`);

  // --write-asset: bless the regenerated doc as the new golden baseline.
  // `updatedAt` is a serverTimestamp sentinel in the in-memory store — the
  // asset convention writes the literal placeholder string instead. The
  // `provenance` block records what produced it and the exact inputs, so
  // the baseline is self-describing (the original asset had none, which is
  // what made its validity impossible to check).
  if (process.argv.includes('--write-asset')) {
    // Refuse to bless a degenerate baseline: every golden date must have a
    // FOUND chain, or an empty/wrong bucket would write an all-miss asset.
    assert(
      inputs.size === dates.length,
      `every golden date has a stored chain (${inputs.size}/${dates.length}) — refusing to write a baseline built on absent inputs`,
    );
    const { updatedAt: _sentinel, days: regenDays, ...header } = regen!;

    // Oracle check: existence isn't correctness — a buggy picker would
    // produce a self-consistent baseline. Every blessed pick must be the
    // SPEC winner on its own chain; every blessed miss must have none.
    for (const date of dates) {
      const entry = regenDays[date];
      assert(entry !== undefined, `oracle check ${date}: regenerated doc has a day entry`);
      const winner = specWinner(chains.get(date)!, date, CELL);
      if (isPickEntry(entry)) {
        assert(
          entry.contractId === winner?.contractId,
          `oracle check ${date}: blessed pick ${entry.contractId} is the SPEC winner (got ${winner?.contractId ?? 'none'})`,
        );
      } else {
        assert(
          winner === null,
          `oracle check ${date}: blessed miss has no SPEC winner` +
            (winner !== null ? ` (oracle would pick ${winner.contractId})` : ''),
        );
      }
    }

    // Refuse to bless over a baseline that classifies as a real defect:
    // stale-baseline categories are blessable; regression/unexplained means
    // investigate the pipeline, don't rewrite the golden.
    const defects = dates.filter(
      (d) =>
        regenDays[d] !== undefined &&
        !reconcileDay(d, goldenDays[d], regenDays[d], chains.get(d) ?? null, CELL).explained,
    );
    assert(
      defects.length === 0,
      `no regression/unexplained days vs the current baseline (${defects.join(', ')}) — investigate the pipeline instead of re-blessing`,
    );

    const corpusInputs: Record<string, unknown> = {};
    for (const date of dates) {
      corpusInputs[date] = inputs.get(date)!;
    }
    const asset = {
      ...header,
      provenance: {
        generatedBy: 'functions/scripts/verify/options-data-226-golden-picks.ts --write-asset',
        generatedAt: new Date().toISOString(),
        pipeline: 'materializeSymbolPicks -> pickCellsForDate -> mergeDayEntries',
        corpusBucket: optionsCorpusBucket(),
        adjustedCloseSource: 'symbol-data bars via DailyAdjustedReader (ac ?? c)',
        corpusInputs,
      },
      days: regenDays,
      updatedAt: '<serverTimestamp>',
    };
    writeFileSync(assetPath, JSON.stringify(asset, null, 2) + '\n');
    console.log(`WROTE: regenerated doc + provenance → ${assetPath}`);
    console.log('Re-run without --write-asset to verify the new baseline.');
    return;
  }

  // --- Provenance drift check ------------------------------------------
  // If the baseline was blessed with input fingerprints, compare them to
  // the envelopes just loaded — "did the input objects change" becomes a
  // checksum compare, not a forensic re-investigation.
  const recorded = example.provenance?.corpusInputs;
  if (recorded !== undefined) {
    let drift = 0;
    for (const date of dates) {
      const prev = recorded[date];
      const now = inputs.get(date);
      if (prev === undefined || now === undefined || prev.sha256 !== now.sha256) {
        drift++;
        console.warn(
          `INPUT-DRIFT ${date}: recorded ${prev?.sha256?.slice(0, 12) ?? 'none'} → current ${now?.sha256?.slice(0, 12) ?? 'missing'} ` +
            `(object ${prev?.object ?? '?'})`,
        );
      }
    }
    console.log(`INPUTS: ${drift} of ${dates.length} recorded corpus fingerprints drifted`);
  }

  // --- Golden reconciliation -------------------------------------------
  const recs: DayReconciliation[] = [];
  const missing: string[] = [];
  for (const date of dates) {
    const actual = regen!.days[date];
    if (actual === undefined) {
      missing.push(date);
      continue;
    }
    recs.push(reconcileDay(date, goldenDays[date], actual, chains.get(date) ?? null, CELL));
  }
  assert(missing.length === 0, `regenerated doc covers every golden date (missing: ${missing.join(', ')})`);

  for (const r of recs) {
    const tag = r.category === 'identical' ? 'OK  ' : 'DIFF';
    console.log(`${tag} ${r.date} ${r.category}: ${r.detail}`);
    for (const d of r.fieldDiffs) {
      console.log(`      ${d.field}: golden ${JSON.stringify(d.golden)} → regen ${JSON.stringify(d.actual)}`);
    }
  }

  const byCategory = new Map<string, number>();
  for (const r of recs) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  console.log(
    'CATEGORIES: ' +
      [...byCategory.entries()].map(([c, n]) => `${c}=${n}`).join(' '),
  );

  // Contract-roll check (AC): consecutive-day contract changes in the
  // regenerated doc vs the golden asset.
  const rollDates = (days: Record<string, DayPickEntry>): string[] => {
    const out: string[] = [];
    let prev: string | null = null;
    for (const d of Object.keys(days).sort()) {
      const e = days[d];
      if (isPickEntry(e)) {
        if (prev !== null && prev !== e.contractId) out.push(`${d} → ${e.contractId}`);
        prev = e.contractId;
      } else {
        prev = null;
      }
    }
    return out;
  };
  console.log(`GOLDEN-ROLLS: ${rollDates(goldenDays).join('; ') || '(none)'}`);
  console.log(`REGEN-ROLLS:  ${rollDates(regen!.days).join('; ') || '(none)'}`);

  const nonIdentical = recs.filter((r) => r.category !== 'identical');
  assert(
    nonIdentical.length === 0,
    `regenerated doc matches the golden day-for-day (${nonIdentical.length} days differ — see classifications above; ` +
      `if the corpus legitimately changed, re-bless the baseline with --write-asset)`,
  );

  // --- Regenerated vs live Firestore shard (informational) -------------
  const liveSnap = await db.doc(docPath).get();
  if (!liveSnap.exists) {
    console.warn(`LIVE-DOC: ${docPath} does not exist — materialization not yet run for this cell`);
  } else {
    const live = liveSnap.data() as CellYearDoc;
    let liveMissing = 0;
    let liveFieldDiffs = 0;
    for (const date of dates) {
      const actual = regen!.days[date];
      const liveEntry = live.days?.[date];
      if (liveEntry === undefined) {
        console.warn(`LIVE-DIFF ${date}: absent in live doc`);
        liveMissing++;
        continue;
      }
      const diffs = diffEntries(liveEntry, actual);
      if (diffs.length > 0) {
        liveFieldDiffs += diffs.length;
        console.warn(
          `LIVE-DIFF ${date}: ${diffs.map((d) => `${d.field} live=${JSON.stringify(d.golden)} regen=${JSON.stringify(d.actual)}`).join('; ')}`,
        );
      }
    }
    console.log(
      `LIVE-DOC: ${liveMissing} missing days, ${liveFieldDiffs} field diffs vs regenerated — informational ` +
        `(live picks are immutable first-writes; superseded snapshots legitimately diverge)`,
    );
  }

  console.log(`RECONCILED: ${recs.filter((r) => r.category === 'identical').length}/${recs.length} days identical to golden`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
