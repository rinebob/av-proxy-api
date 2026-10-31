# options-data-251-availability-read-ceiling

Prod verification for Task #251 — bounded primary-range reads in
`ContractAvailabilityQueryService`.

## What it proves

Wide primary-range filters (`strikeGte=0`, full-history `firstObserved`)
are legitimate partner queries, but before #251 they ran a single
unbounded `get()` over a `ts-contracts` subcollection — ~395k docs on
QQQ, enough to blow the function's 60s/512MiB budget. The service now
streams primary-range scans (`orderBy(primary, __name__)` +
`Query.stream()`) and stops consuming at a 25k scanned-doc ceiling,
reporting `truncated` — honest "more matches may exist". (Early
`for await` exit destroys the consumer-side stream; the SDK's pipe
chain doesn't forward the destroy to the gRPC RPC, which pauses on
flow-control backpressure — billed reads stay bounded — and closes on
server idle timeout.) Streaming was chosen over `limit`+`startAfter`
paging after prod measurement: page round-trips cap at ~360-700 docs/s
(~3-6s per 500-2000 doc page), while a pushed stream sustains ~830
docs/s — 25k in ~35s, comfortably inside the 60s function budget.

## Run

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-251-availability-read-ceiling.ts
```

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--symbol` | `QQQ` | Options-enabled symbol to scan (use a large one — the ceiling assertions assume >25k docs scanned per wide query) |
| `--budget-ms` | `60000` | Per-query time budget mirroring the function's 60s timeout |

Credentials: ADC / `GOOGLE_APPLICATION_CREDENTIALS`. Read-only —
Firestore reads only, no writes.

## Expected

Every line `PASS`, ending `DONE: QQQ — …`:

- `strikeGte=0` and `firstObservedLte=2999-12-31` each complete under the
  budget (previously these would scan the full subcollection and time
  out / OOM inside the function).
- At least one wide query reports `truncated=true` — the ceiling fired
  (requires the symbol to have >25k scanned docs; true on QQQ).
- A single-day `firstObserved` range returns under the ceiling with
  `truncated=false`.

## Failure modes

- `FAIL: ... completes in Xs (< 60s)` → the scan regressed to an
  unbounded read; check `fetchByPrimaryRange`'s streamed scan + ceiling.
- `FAIL: ceiling fires on a large symbol` → ceiling not wired into
  `truncated`, or the symbol genuinely has <25k docs (use `--symbol`
  with a larger one).
- `FAILED_PRECONDITION` on a `type`-filtered variant → composite index
  `(type, firstObserved)` / `(type, strike)` missing; this script runs
  unfiltered single-field queries which need no composite index.
