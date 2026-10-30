# options-data-223-materialize-picks.ts

Verifies Task #223 (materialization fanout) end-to-end on prod: runs the
real `materializeSymbolPicks` core for one symbol (default `QQQ`) with the
same dependency wiring as `processOptionsDeltaPickMaterializeTask` —
`GcsCorpusAdapter.listItems` → per-date `readItem` → `pickCellsForDate` →
`mergeDayEntries` — then reads every cell-year doc back and re-runs to
prove the idempotent no-op. GCS reads only; zero AV calls.

## Command

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-223-materialize-picks.ts --symbol QQQ
```

## Flags / arguments

| Flag | Required | Allowed values | Default |
|---|---|---|---|
| `--symbol` | no | Any options-enabled symbol with stored corpus objects | `QQQ` |
| `--date` | no | `YYYY-MM-DD` (a stored corpus date) | unset — walks all stored dates ≥ 2026-01-01 |

- No flags → full materialization for `QQQ` (every stored corpus date).
- `--date` bounds the run to a single date — the same payload shape the
  nightly append / single-date repair path will use.

## Setup / teardown

- **Auth:** ADC with GCS read on the corpus bucket + Firestore read/write on prod.
- **Setup:** none — the symbol must have stored corpus objects (the corpus
  backfill from the earlier Topic-#213 tasks provides them).
- **Teardown:** none. This script writes the REAL
  `options-delta-picks/{SYM}-{type}-{delta}-{dte}/years/{YYYY}` docs — the
  materialization output IS the task's deliverable, not a probe, so
  nothing is deleted. A re-run is a no-op by design.
- **Runtime note:** a full-symbol run downloads every stored chain
  (~207 objects for QQQ) sequentially — expect several minutes.

## Expected passing output

```
PASS: QQQ: stored corpus dates were walked (datesSeen=207)
PASS: QQQ: zero chain-load failures
PASS: QQQ: at least one chain picked (datesPicked=207)
PASS: QQQ: day entries were written
PASS: all 380 QQQ-*/years/2026 cell docs materialized (found 380)
PASS: cell docs carry days entries (total 78660)
PASS: day-entry total matches walked dates (78660 == 380×207)
PASS: at least one real pick entry materialized (77900 picks)
PASS: every doc carries gridVersion=1
PASS: idempotent re-run wrote nothing (daysWritten=0)
PASS: re-run skipped all 78660 existing entries

ALL CHECKS PASSED — QQQ materialized: 380 cell docs, 78660 day entries, 77900 picks
```

Counts vary with corpus growth — the invariants are `datesSeen > 0`,
`loadFailures` empty, 380 docs found, `daysTotal == 380 × (datesPicked +
datesNoChain)`, and `daysWritten === 0` on the re-run.

## Expected failure output

Any `FAIL:` line followed by exit code 1, e.g.:

```
FAIL: all 380 QQQ-*/years/2026 cell docs materialized (found 379)
```

means a cell doc did not materialize — check the preceding
`materialization report` block for `loadFailures` and re-run (the run is
idempotent; a transient GCS failure is repaired by re-running).

`FAIL: idempotent re-run wrote nothing (daysWritten=N)` means the merge
lost its skip semantics — a regression in `mergeDayEntries` or a corrupt
doc write.

## Status

Mutating — writes real prod docs. Run manually; NOT part of run-all.ts.
