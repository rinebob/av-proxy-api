**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Options corpus ingest  
**Thread Slug:** options-corpus-ingest  
**Issue:** #106  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** RUNBOOK  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Options data nightly maintenance — what should happen and how to confirm

Steady-state ops doc for the options corpus + time-series pipeline once the
2026-09-27 bulk drain completes. Project `alpha-vantage-proxy-api`,
region `us-central1`. All times America/Los_Angeles.

## The nightly sequence (weekdays only)

| PT | Job | What it does |
|---|---|---|
| 13:35 | `refreshAvDailyTimeSeriesPostAllIntervals` | Finalizes today's daily-adjusted bars for tracked symbols — the input the swing pipeline consumes |
| 18:00 | `refreshAvDailyTimeSeriesPostEveningRetry00` | Retry pass for symbols whose daily data failed or arrived late |
| 04:00 | `refreshAvDailyTimeSeriesPostMorning0700` | Early-morning catch-up for stragglers |
| 19:00 | `refreshHistoricalOptionsCorpusNightly` | Seeds **today's** chain for every options-enabled symbol (~129 AV calls) — the daily snapshot that exists independent of pivots |
| 20:00 | `sweepSwingSets` | Regenerates stale/missing corpus swing-set docs; each regeneration fires `fanoutPivotSeeds` → seed tasks for any newly-planned pivot dates |
| 21:00 | `sweepHistoricalOptionsCorpus` | First re-runs the nightly service (idempotent — covered items skip) so a failed 19:00 run self-heals same-day; then per enabled symbol: seed planned-but-missing dates, delete superseded interims, delete any `date < 2019-01-01` object |

Downstream of every successful seed: `seed.stored` → symbol-metrics compute →
`enqueue ts-build` → `buildSymbol` merges that date's contracts into per-contract
JSONL, updates `ts-contracts` catalog + `options-contract-index`, all under a
per-symbol lease.

**Intentional no-ops:** weekends/holidays → nightly exits `skippedMarketClosed`;
a symbol with all-fresh swing docs → `fresh`; a date already in GCS →
`skippedExistingItems`. Quiet nights are correct, not broken.

## Confirming each stage ran

### 1. Nightly corpus seed (19:00 PT)

```
resource.labels.service_name="refreshhistoricaloptionscorpusnightly"
```

Look for `[historical-options-nightly]` with `queuedItems` ≈ enabled-symbol
count (each enabled symbol queues one seed for today unless already stored).
`skippedMarketClosed: true` on holidays/weekends is the correct exit.

Then the seeds themselves (~1/s pace, ~2 min for a full set):

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.stored"
```

Failures land here — worth a glance each morning:

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.error"
```

### 2. Swing-set sweep (20:00 PT)

```
resource.labels.service_name="sweepswingsets"
```

Look for `swing-set sweep done — checked=N fresh=X generated=Y failed=Z`.
`generated` symbols each fired a pivot-seed fanout. `failed` entries name the
symbol + error — these don't abort the sweep, so they're easy to miss; check
the count, not just "did it run".

### 3. Corpus reconcile sweep (21:00 PT)

```
resource.labels.service_name="sweephistoricaloptionscorpus"
AND textPayload:"pivot-seed-fanout"
```

Per-symbol lines: `enqueued N seed task(s), deleted=D`. Steady state is
`enqueued 0` for most symbols — nonzero means a gap got seeded (good).
`deleted` entries are `deleted pre-floor <date>` or
`deleted superseded interim <date>`.

The sweep's own summary:

```
resource.labels.service_name="sweephistoricaloptionscorpus"
AND textPayload:"sweepHistoricalOptionsCorpus"
```

### 4. Ts-build following the seeds

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"done"
```

Each `done` for a seeded date should show `foundDates >= 1`,
`failedContracts: 0`. `resumeDate` set = the 15-min budget expired mid-symbol
and a continuation was queued — normal, self-resolving.

## End-to-end nightly proof

One query, one morning glance — count distinct symbols that produced a
`seed.stored` for yesterday's trading date:

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.stored"
AND timestamp>="YYYY-MM-DDT00:00:00Z"
```

should approach the enabled-symbol count (less any legitimately non-optionable
tickers). Pair with a `ts-build done` count — every stored date should
eventually produce built contracts.

## Failure shapes worth acting on

| Signal | Meaning | Action |
|---|---|---|
| No `[historical-options-nightly]` log at all | Scheduler or function down — partially self-healing: the 21:00 sweep re-runs the nightly service (`nightly-heal` log line) | Check Cloud Scheduler job `firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1` last-attempt status; run it manually via `gcloud scheduler jobs run` |
| `queuedItems: 0` on a trading day | Enabled set empty or all items already stored | Verify a symbol count in `tracked_symbols` where `optionsEnabled == true` |
| Persistent `seed.error` for one symbol | AV rejecting the ticker (delisted / non-optionable) | `setOptionsEnabledV2` off for that symbol, or investigate the specific date |
| Repeated `builder.read.error` on the same contractID | Corrupt GCS object — read fails every pass | Inspect/delete that object directly; the build heals on next run |
| Sweep `failed` list non-empty | Per-symbol generation error | Symbol-named error is in the log line; sweep continues so the blast radius is one symbol |
| Growing `options-ts-build-leases` docs past ~25h TTL | Crashed tasks left stale leases | Leases self-expire; a lease older than ~20 min means the holder task died — its retry will re-acquire |

## Operator actions

Manually run any scheduled job:

```powershell
gcloud scheduler jobs run firebase-schedule-sweepHistoricalOptionsCorpus-us-central1 `
  --location us-central1 --project alpha-vantage-proxy-api
```

(same pattern for `sweepSwingSets`, `refreshHistoricalOptionsCorpusNightly`)

Ad-hoc seed a specific symbol/date:

```powershell
# POST to triggerHistoricalOptionsPilot — or just setOptionsEnabledV2 off→on
# to re-fanout the symbol's full planned set.
```

Backfill a range (post-floor, self-continuing, leased):

```powershell
# POST https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app
# headers: x-admin-secret
# body: {"enqueue": true, "symbol": "AAPL", "startDate": "2024-01-01", "endDate": "2024-12-31"}
```

## Partner onboarding (consuming apps — ST and future domains)

Partners call the `partner*` endpoints from **their** backend with a Google
OIDC token for a service account. The browser app never calls our functions
directly. Onboarding a new partner is pure IAM, no code:

1. Create/mint their service account (e.g. `<partner>-caller-prod@<their-project>.iam.gserviceaccount.com`) — they self-host it, or we provision one in `alpha-vantage-proxy-api` and hand over impersonation rights.
2. Add the SA email to the `ALLOWED_SERVICE_ACCOUNT_EMAILS` secret (comma-separated). Currently: `maintenance-bot@…`, `rel-str-partner-caller-prod@rel-str.iam…` (ST).
3. **Endpoint URL registration**: when a *new* `partner*` endpoint ships, its URL(s) must be added to `EXPECTED_GOOGLE_AUDIENCE` — both the `us-central1-alpha-vantage-proxy-api.cloudfunctions.net/<Name>` and `<name>-<hash>-uc.a.run.app` forms. Callers mint tokens with `aud` = any listed URL; a missing URL means that endpoint can't be reached even by allowlisted SAs.
4. Verify with a minted token:

   ```powershell
   gcloud auth print-identity-token `
     --impersonate-service-account=<sa> `
     --audiences=<any listed aud> --include-email
   ```

   `--include-email` is required — without it the token has no `email` claim
   and auth fails 401/403 even for allowlisted SAs.

Revoking a partner = remove the SA email from `ALLOWED_SERVICE_ACCOUNT_EMAILS`
(takes effect on each caller's next token mint; cached tokens live ≤1h).
