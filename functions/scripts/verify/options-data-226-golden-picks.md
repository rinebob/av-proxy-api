# Task #226 verify guide — golden-file pick verification

## Script: `options-data-226-golden-picks.ts` (read-only)

Regenerates the `QQQ-put-20-45` April-2026 window through the **production
materialization path** and asserts **strict day-for-day equality** against
the golden asset
`src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`.

**How it works**

1. Runs `materializeSymbolPicks` for the 21 golden dates with **real prod
   deps** — GCS corpus chains via `GcsCorpusAdapter.readItem`, adjusted
   closes via `DailyAdjustedReader` — and only the destination Firestore
   swapped for an in-memory doc store. The real `mergeDayEntries`
   merge/header code runs; nothing is written.
2. For each day, `reconcileDay` (pure, unit-tested in
   `tests/scripts-verify/options-data-226-golden-picks.core.test.ts`)
   diffs the golden and regenerated entries field-by-field and assigns a
   root-cause category proven from the stored chain the regeneration saw:

   | Category | Meaning | Verdict |
   |---|---|---|
   | `identical` | entries match | pass |
   | `repaired-gap` | golden miss → pick, or `no_chain` → `no_match` — chain/contracts now stored | fail (stale baseline) |
   | `contract-superseded` | golden's contract absent from the stored chain; regen pick is the SPEC winner | fail (stale baseline) |
   | `outranked` | golden's contract still exists but loses the SPEC selection rule | fail (stale baseline) |
   | `fields-refreshed` | same contract; regen fields equal the stored row exactly | fail (stale baseline) |
   | `close-only` | only `underlyingClose` differs | fail (stale baseline) |
   | `miss-detail` | same miss status, only `reason`/`underlyingClose` differs | fail (stale baseline) |
   | `regression` | golden pick → miss, miss-kind worsened, or regen pick is not the SPEC winner | **fail (real defect)** |
   | `unexplained` | divergence the classifier cannot prove from the stored chain | **fail (real defect)** |

   The gate is strict equality — corpus objects are write-once, so on a
   correct baseline every day must be `identical`. Any non-identical day
   fails; the category tells you whether the baseline went stale
   (re-bless with `--write-asset`) or the pipeline regressed
   (`regression`/`unexplained` — investigate, never re-bless).

3. Cross-checks the regenerated doc against the **live** Firestore shard
   `options-delta-picks/QQQ-put-20-45/years/2026` (informational — live
   picks are immutable first-writes, so divergence there means stored data
   changed after the shard was materialized).

**Usage**

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-226-golden-picks.ts
# bless a fresh baseline after a LEGITIMATE corpus change:
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-226-golden-picks.ts --write-asset
```

`--write-asset` writes the regenerated doc plus a `provenance` block —
generator script/pipeline, generation timestamp, corpus bucket, the
adjusted-close source, and per-date input fingerprints (object path,
envelope `generatedAt`, payload sha256). The gate only diffs `days`, so
provenance is informational; its absence was what made the original asset
impossible to audit.

`--write-asset` refuses to bless an invalid baseline — it exits 1 without
writing unless **all three** guards pass:

1. every golden date resolves to a FOUND chain (an empty/wrong bucket
   can't produce an all-miss asset);
2. every blessed pick is the independent `specWinner` oracle's winner on
   its own chain, and every blessed miss has no winner (a buggy picker
   can't produce a self-consistent baseline); and
3. no day classifies `regression`/`unexplained` vs the current baseline —
   investigate the pipeline instead of re-blessing over a real defect.

**Pass:** `PASS: regenerated doc matches the golden day-for-day`, exit 0.
**Fail:** load failure, missing regenerated day, or any non-`identical`
classification — exits 1.

**Setup/teardown:** no writes. Requires ADC with read access to the corpus
bucket and the `symbol-data` bars collection
(`gcloud auth application-default login`, project
`alpha-vantage-proxy-api`). ~21 object downloads + one bars read; safe to
re-run. Transient GCS read failures surface as `loadFailures=[dates]` —
re-run.

## Reconciliation result (2026-11-01)

**The original `.example.json` was proven not to be pipeline output, and
the baseline was regenerated.** Evidence:

- GCS `stat` on the April corpus objects: creation time = update time =
  2026-07-22, `Metageneration: 1` — each object written **once**, never
  modified. The corpus did not drift after the golden was made.
- Live Alpha Vantage `HISTORICAL_OPTIONS` spot-checks (2026-11-01):
  - `2026-04-01` — 9,842 rows, byte-identical values to the stored object.
    Golden's pick `QQQ260515P00565000` exists at delta **−0.32487** /
    mark **12.14** — the golden recorded **−0.204** / **8.42** for it.
    Regen's pick `QQQ260515P00541000` matches stored/live exactly
    (−0.20074 / 7.25).
  - `2026-04-23` — 9,732 rows, identical; the golden's roll contract
    `QQQ260619P00555000` is **absent from AV's data entirely**.
- The golden's `updatedAt` was the literal string `"<serverTimestamp>"` —
  a placeholder, not a writer-produced value — and its `underlyingClose`
  (612.4) matches neither the stored bar's `c` (584.31) nor `ac` (583.67).

Conclusion: the golden was generated from an unknown different input
(prototype-era fetch or fixture) that cannot be traced to AV data as
stored or served. All 21 of its days therefore differed from regenerated
output — correctly diagnosed by the classifier, but as symptoms of an
**invalid baseline**, not pipeline or corpus drift.

**Pipeline correctness is independently established:** regenerated output
is **byte-identical to the live Firestore shard** (0 field diffs) — the
materialization path is deterministic and idempotent on stable inputs.

**Resolution:** the golden asset was regenerated via `--write-asset` on
2026-11-01 from the production path itself, now carrying a `provenance`
block that fingerprints every input object (path, envelope `generatedAt`,
sha256); the SPEC doc's inline example was updated to the same real
values. The gate is now strict day-for-day equality — any future diff
means a real event (corpus re-seed → `repaired-gap`/`contract-superseded`/
`outranked`/`fields-refreshed`/`close-only`/`miss-detail`, or a genuine
defect → `regression`/`unexplained`) and the classification output names
which; the recorded checksums make "did this input object change?" a
one-command check.

Contract rolls (AC#2): the new golden carries 17 winner-changes across the
window (e.g. 04-23 → `QQQ260605P00640000`, 04-28 → `QQQ260618P00615000`);
`GOLDEN-ROLLS`/`REGEN-ROLLS` log lines diff them explicitly.
