# Verify: Task #222 — Cell doc writer (`mergeDayEntries`)

**Task:** #222 · **Area:** BE · **Mutating:** yes — writes + deletes prod
probe docs · **Run:** manually (NOT part of `run-all.ts`)

Exercises the Firestore persistence path this task owns — the merge
transaction against a real `options-delta-picks/{cellId}/years/{YYYY}` doc —
end-to-end on prod. Merge semantics themselves are also covered by unit
tests; this script confirms what actually persists (scaffold fields,
recomputed header, immutable picks, shard routing, idempotency).

## Scope of mutation

Writes then deletes two probe docs on a fake symbol/year so real cells are
untouched:

- `options-delta-picks/ZZTEST-put-20-45/years/2099`
- `options-delta-picks/ZZTEST-put-20-45/years/2100`

`ZZTEST` is not in the optionsEnabled universe; 2099/2100 are far-future
shards. The parent cell doc is never materialized (Firestore doesn't create
explicit parents for subcollection writes) — nothing remains after cleanup.

## Prereqs

- ADC auth (`gcloud auth application-default login`) with Firestore
  read/write on prod.
- Run from `functions/` so `scripts/tsconfig.json` resolves.

## Command

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-222-cell-writer.ts
```

No flags or args — the probe cell and dates are fixed constants.

## What it checks (all must PASS)

| Step | Scenario | Confirms |
|---|---|---|
| 1 | Absent date → write | Full doc scaffold: `symbol`/`type`/`targetDelta` (signed −0.2)/`expiry`/`gridVersion`/`firstDate`/`lastDate`/counts/`updatedAt` |
| 2 | Same-status miss re-merge | Equal-rank miss skipped (not "better") |
| 3 | `no_chain`→pick + new date | Self-repair rewrites the miss; header recomputed (`pickCount` 2, `lastDate` advanced) |
| 4 | pick→pick and pick→miss | Both skipped; original `contractId` preserved — picks are immutable |
| 5 | `2099-12-31` + `2100-01-01` | Year-boundary sharding by **chain date** — Dec 31 lands in `years/2099`, Jan 1 in `years/2100` |
| 6 | Identical re-run | `written: []`, all skipped — idempotent zero-write pass |
| — | Cleanup | Both probe docs deleted and verified gone |

## Pass / fail

- **Pass:** every `PASS:` line prints, ending with
  `ALL CHECKS PASSED — mergeDayEntries verified on prod (options-delta-picks)`,
  exit 0.
- **Fail:** first failing check prints `FAIL: <what>` and exits 1 —
  investigate the named scenario against the doc in the Firestore console.

## Setup / teardown

None required. If the script is interrupted mid-run, the two probe docs may
linger — delete them via the console or re-run (the script overwrites and
cleans them up).

## Verified

2026-10-28 — all checks PASS on prod (ADC, Firestore write), probe docs
cleaned up.
