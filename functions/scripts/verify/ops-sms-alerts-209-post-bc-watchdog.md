# Verify — Task #209: POST B/C watchdog coverage + POST calendar gate

**Script:** `ops-sms-alerts-209-post-bc-watchdog.ts`
**Type:** mutating (writes + deletes probe docs in prod) — **not** in `run-all.ts`, run manually.

## ⚠ Project targeting (read first)

Local ts-node scripts resolve the Firestore project from **ADC**, which
points at `rel-str` (a dev project with no real pipeline data) — **not**
the prod `alpha-vantage-proxy-api` project the deployed functions use.
Run with the project override or you will verify against the wrong
database:

```bash
cd functions
GCLOUD_PROJECT=alpha-vantage-proxy-api GOOGLE_CLOUD_PROJECT=alpha-vantage-proxy-api \
  npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/ops-sms-alerts-209-post-bc-watchdog.ts
```

## What it proves

End-to-end against real prod Firestore (`alpha-vantage-proxy-api`):

1. **B check, mixed health** — DAILY/WEEKLY PDR sent + MONTHLY
   `COMPLETE`/`createdJobs:0`/no PDR → health doc
   `realtime-health/{date}-B` with `tickStatus: ok`,
   `intervalStatuses.monthly: no_jobs`.
2. **B check, real alert** — a created-jobs interval without PDR →
   `pdr_missing` tickStatus + ERROR log.
3. **C check, real target resolution** — `checkPostCPdrDelivery` resolves
   the C target through the real `marketDate desc` retry-run query;
   probe retry docs (2026-12-30) outrank real ones → health doc
   `realtime-health/{date}-C` with `sequence: C`, `clockPt: '0400'`.
4. **Calendar gate** — Thanksgiving Thursday produces zero reads and no
   health doc (`post.watchdog.skip market closed (holiday)`).

## Data touched

| Doc | Written | Deleted |
|---|---|---|
| `realtime-runs/2026-12-30-WED-B-{D,W,M}-LIVE-POST-1800` | yes | yes |
| `realtime-runs/2026-12-30-WED-C-{D,W,M}-LIVE-POST-0400` | yes | yes |
| `realtime-health/2026-12-30-B` / `…-C` | yes | yes |

Probe marketDate is a **real future trading day** — required because
`MarketCalendarService` throws for years outside its holiday table
(2025–2026). All probes carry `probe: true, task: 209`.

## Side effects & rerun notes

- Probe docs are retry-type but **future-dated** — the retry-target
  resolver only accepts candidates ≤ real today, so the live 04:00
  orchestrator can never resolve them (no collision hazard by design).
  The C check is invoked with `todayEt = 2026-12-30` so it sees them.
- Probes carry `runCreatedAt`, so even a catastrophic leak is reclaimed
  by `cleanupOldRunDocs` within 96h. `assert` throws through the
  try/finally, so cleanup runs on any failure path.
- An interrupted run can still leave probes briefly; delete the six
  `realtime-runs` docs + two health docs for `2026-12-30` and rerun.
- Requires the `realtime-runs` composite index
  (`interval + runType + marketDate desc`) — declared in
  `firestore.indexes.json`, deployed to prod 2026-10-29.

**Pass:** every `PASS:` line prints and the run ends with `=== All verification checks passed ===`.
