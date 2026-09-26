**Topic:** Swing-driven options corpus platform
**Thread:** #103 (swing-set platform) / #127 (sweep + backfill)
**Type:** RUNBOOK
**Created:** 2026-09-25

# backfillSwingSets — operator guide

Regenerates swing-set docs for options-enabled symbols on demand. Idempotent
and safe to re-run — use it for initial backfill, doc-shape migrations, and
repair after bad writes.

## Endpoint

```text
POST https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/backfillSwingSets
x-admin-secret: <SWING_SET_ADMIN_SECRET>
Content-Type: application/json
```

## Body (all optional)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `symbols` | `string[]` or comma string | **all `optionsEnabled=true` symbols** | Restrict to a subset |
| `force` | boolean | `false` | Regenerate even when docs are fresh (< 20 h TTL) |
| `dryRun` | boolean | `false` | Report what would generate; **no writes** |

An explicit `symbols: []` sweeps nothing.

## Common invocations

```powershell
# Regenerate every options-enabled symbol (e.g., after deleting the
# options-swing-sets collection or changing the doc shape)
curl -X POST "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/backfillSwingSets" `
  -H "x-admin-secret: $env:SWING_SET_ADMIN_SECRET" -H "Content-Type: application/json" -d '{}'

# Preview only
-d '{"dryRun": true}'

# A couple of symbols
-d '{"symbols": "QQQ,AMD"}'

# Force re-write fresh docs too
-d '{"force": true}'
```

## Response

`200` → `{ ok: true, dryRun, report }` — per-symbol `generated`/`skipped`
counts. `403` → bad/missing admin secret. `500` → internal error (check
function logs for `[backfillSwingSets]`).

## Notes and limits

- **Synchronous**: 540s timeout. For large enabled sets the request may time
  out mid-run; work already committed stays committed, and the nightly
  `sweepSwingSets` scheduler (`0 20 * * 1-5`, 7 PM ET weekdays) picks up
  stragglers automatically.
- **Freshness**: without `force`, symbols whose corpus doc is newer than
  the 20 h TTL are skipped.
- **Doc shape:** writes one slim `SwingSetDoc` per symbol
  (`pivotDates` + `currentExtremeDate`/`currentDirection` under the 2/2/2
  corpus config) with a full non-merge `set`. See
  `102-107-DECISION-swing-doc-slim-shape.md`.
- **Prerequisite:** the symbol must have daily-adjusted bars
  (`av-daily-adjusted`); otherwise it reports `skipped: no-daily-adjusted-data`.

## Other regeneration paths

| Path | When it fires |
|---|---|
| `setOptionsEnabledV2` false→true | Enqueues `generateSwingSetsTask` for that symbol |
| `sweepSwingSets` scheduler | Weekdays 7 PM ET — regenerates missing/stale docs for all enabled symbols |
