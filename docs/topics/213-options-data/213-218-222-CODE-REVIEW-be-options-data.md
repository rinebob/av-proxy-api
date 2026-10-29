**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #222  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #222: Cell doc writer (`mergeDayEntries`)

Scope: `options-delta-pick-cell.writer.ts` (new), its test suite (new),
services barrel export, `options-data-222-cell-writer.ts` prod verify script
+ guide, `run-all.ts` / `README.md` registration.

## Standards — PASS

- Writer follows the repo's db-injected function convention
  (`ts-build-lease.service.ts`), not the class style — appropriate: one
  operation, no retained state. ~150 lines, single concern.
- Merge decision + header recompute inside `db.runTransaction` — the only
  correct place for read-modify-write on these docs.
- In-memory tx fake in tests mirrors the established #206
  (`ops-alert-guard`) pattern — repo has no emulator infra.
- Verify script mirrors the #206/#207 mutating-script convention:
  ZZTEST-scoped probe, self-cleaning, manual-run registration, guide doc.
- Barrel export placed alphabetically; no dead code, no duplication of the
  #219 guards — writer *consumes* `isRepairableEntry`/`isPickEntry`/
  `isMissEntry`/`parseCellId`/`cellYearDocPath` rather than reimplementing.
- SDK contract checked against real usage: `db.doc(even-segment path)`,
  `tx.get`/`tx.set`, `FieldValue.serverTimestamp()` — matches
  `corpus-metadata.service.ts` precedent.

## Spec — PASS (all 4 ACs, 2 documented deviations)

| AC | Status |
|---|---|
| Merge semantics: absent→write, miss→upgrade-allowed, pick→immutable | Met — full decision table, rank-ordered (`pick > no_match > no_chain`) |
| Header fields consistent after merges | Met — `firstDate`/`lastDate`/`pickCount`/`missCount` recomputed from merged map; can't drift |
| Batched writes (multi-date + single-date) | Met — one transaction per year doc regardless of entry count |
| Unit tests covering merge decision table | Met with deviation (below) — 20 tests, every branch of the table |

**Deviation 1 — signature:** IMPL sketched `mergeDayEntries(cellId, year,
entries)`; implemented as `mergeDayEntries(db, cellId, entries)` — year is
derived per-date from each day key (required for the Dec 31/Jan 1 shard
edge case), `db` injected per repo convention.

**Deviation 2 — emulator:** AC says "unit tests against Firestore
emulator"; the repo has no emulator test infra (no suite uses
`FIRESTORE_EMULATOR`). Decision table is covered by the in-memory tx fake,
and persistence semantics are verified for real by the prod verify script
(read-back assertions on actual Firestore docs) — stronger than emulator
coverage. Flagged for awareness, not a defect.

## Thermo-nuclear — PASS (3 findings fixed in-review, residual risks noted)

| Severity | Finding | Disposition |
|---|---|---|
| Minor (real bug) | `written`/`skipped` accumulated inside the retryable tx callback — contention retry duplicates them; a retried attempt may legitimately decide differently | Fixed — per-attempt locals returned from the tx, appended after resolve |
| Minor (real bug) | Malformed incoming entry (neither pick nor miss) written to an absent date becomes permanently un-repairable (`isRepairableEntry` rejects it forever) | Fixed — input validation throws pre-tx |
| Minor | Hybrid `contractId + status` entry passes `isPickEntry` but also satisfies `isMissEntry` → double-counts as pick AND miss | Fixed — validation requires exactly one shape |

**Residual / accepted risks:**
- Cross-year merges are sequential transactions — not atomic across shards.
  A failure mid-span leaves one year committed; harmless because re-running
  the same merge is idempotent and heals it.
- Writer owns the whole doc (full `tx.set`, not merge) — sole-writer-per-doc
  by design (per-symbol fanout serializes cells); documented in the header.
- Existing entries of unrecognized shape are left untouched (conservative —
  don't clobber data the guards don't understand). Counted as neither pick
  nor miss in headers; a `#226`-class reconciliation concern if it ever
  occurs in practice.

## Test results

- Focused: **20/20** pass (`options-delta-pick-cell.writer.test.ts`)
- Full suite: **91 suites / 945 tests**, all green
- `tsc --noEmit`: clean
- Prod verify (`options-data-222-cell-writer.ts`): all checks PASS against
  real Firestore — probe docs written, read back per scenario, deleted.
  Covers: scaffold fields, equal-rank skip, miss→pick repair, pick
  immutability (pick→pick + pick→miss), year-boundary sharding, idempotent
  zero-write re-run.

## Verdict

**PASS** — all axes clean; three minors fixed in-review and pinned by
regression tests. Two documented deviations (signature, emulator) are
improvements or neutral substitutions, both noted. Ready for QA.

---

## Second pass — final-state review (2026-10-28)

Re-read the post-fix file fresh. One finding, fixed:

| Severity | Finding | Disposition |
|---|---|---|
| Minor | **`in` operator on primitives throws TypeError** — two spots: (a) a primitive incoming entry (null/string — runtime garbage despite the type) crashed the guards *before* the friendly validation error; (b) a corrupt primitive day value in an existing doc (`days.{date} = "x"`) crashed `isRepairableEntry` **inside the transaction**, violating the documented "unrecognized shape → untouched" rule | Fixed — `typeof === 'object' && !== null` pre-checks at both spots; primitives now get the friendly throw (incoming) or the skip-not-clobber treatment (existing); 2 regression tests |

**Nits noted, not worth churn:**
- `entryRank`'s `-1` branch is unreachable post-validation (defensive dead code).
- `written`/`skipped` interleave by ascending year for multi-year inputs — documented behavior, not a contract.
- `firstDate`/`lastDate` would include garbage keys from a corrupt doc — same #226-class reconciliation concern as unrecognized shapes.

**Verified non-issues:** null day values (Firestore stores null) hit the same unrecognized-skip path; equal-rank miss on absent doc can't occur (absent→write dominates); sequential cross-year txs are deterministic ascending.

Suite after pass 2: **22/22 focused**, `tsc` clean. Verdict stays **PASS** — converged; a third pass would hunt hypothetical corrupt-doc shapes already covered by the uniform unrecognized-skip rule.
