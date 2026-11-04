# options-data-229-ts-build-repair

Ops + verification script for Task #229 — re-run every ts-build task that
completed with dropped contract observations (`failedContracts > 0`) during
the 2026 backfill drain.

## What it does

1. **Enumerate (read-only, default)** — queries prod Cloud Logging via the
   `entries:list` REST API for `jsonPayload.component="time-series-builder"
   AND jsonPayload.event="builder.symbol.done"` in a bounded window. Each
   entry carries the full build report (symbol, range, `failedContracts`,
   per-contract `errors[]`). Failed `(symbol, startDate, endDate)` tasks
   are extracted, deduped across continuation/retry duplicates, and the
   unhealed `(symbol, contractID, error)` list is printed for triage.
2. **`--enqueue` (mutating)** — re-enqueues each failed range as a
   `TsBuildPayload` on `processHistoricalOptionsTsBuildTask`. The builder's
   `writeMerged` dedupes already-covered dates, so the repair is
   idempotent and does **no AV calls** — GCS reads/writes only.

## Run it

```powershell
cd functions
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'

# dry enumeration (default — read-only)
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-229-ts-build-repair.ts

# bound the window / symbols
... --since 2026-10-20T00:00:00Z --until 2026-11-01T00:00:00Z --symbols QQQ,SNDK

# perform the repair (mutating — needs FIREBASE_SERVICE_ACCOUNT_ID locally)
... --enqueue
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--since ISO` | `2026-10-01T00:00:00Z` | Log window start — bound to the drain window for tighter output |
| `--until ISO` | now | Log window end |
| `--symbols CSV` | all | Bound the repair to specific symbols |
| `--limit N` | `60000` | Max log entries read — whole drain ≈ 27k done events; a truncated read FAILs the enumeration check |
| `--enqueue` | off | Re-enqueue the failed tasks (mutating) |

## Expected output

Dry run, full drain window (2026-11-05): **733 failed (symbol,date) tasks /
25,172 unhealed contracts** — all transient GCS `socket hang up` / 500
write+read errors on the time-series bucket. Ends with
`=== All verification checks passed ===`. The console prints the first 20
unhealed rows; the **full triage list** is written to
`.devin/tmp/options-data-229-unhealed.json` (gitignored, regenerated each
run) and the path is printed. Shape:
`{generatedAt, since, until, symbols, logReadTruncated,
underReportedBuilds, unhealed[{symbol, contractID, error}]}` — provenance
fields record the run's scope and whether enumeration/completeness held.

`--enqueue` is gated on all checks passing — a truncated read or an
under-reported build refuses to dispatch rather than enqueue a
knowingly-incomplete repair set.

## Post-pass audit (AC3/AC4)

After the repair drain completes, re-run dry with `--since` covering the
repair window — bound `--since` to *after* the repair started, so original
failures outside the repair window don't merge into the deduped list:

- `failedContracts: 0` → healed
- `failedContracts > 0` → the unhealed list prints contract + error for
  triage (genuinely-corrupt inputs will persist; transient errors should
  clear on the second pass)

## Notes

- Cloud Logging `_Default` retention is ~30 days — run within that window
  of the drain (and of the repair pass for the audit) or enumeration
  silently returns nothing.
- Log reads use `google-auth-library` + the Logging REST API (ADC
  `logging.read` scope) — `gcloud` is not invoked (node refuses to spawn
  .cmd shims without a shell).
- The Logging read quota is 120 req/min/project; the script retries up to
  5× on 429/503 with escalating waits (65s + 15s/attempt).
- Each build's unioned `errors[]` must reach its max observed
  `failedContracts` — a per-build shortfall fails loudly when Cloud
  Logging has truncated an oversized `errors[]` jsonPayload (the triage
  list would silently under-report).
- Not in `run-all` — the dry mode is read-only but needs
  `GCLOUD_PROJECT` + ADC + logging access, and `--enqueue` mutates the
  prod task queue.
