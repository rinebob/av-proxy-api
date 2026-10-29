**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #202  
**Task:** #207  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #207: Intraday signoff emission (3 ticks)

## Scope

| File | Purpose |
|---|---|
| `functions/src/v2/alpha-vantage/jobs/intraday-ops-signoff.ts` | `emitIntradayTickSignoff` — tick gate → compose → claim → emit, never throws |
| `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts` | `publishPdrAndSignoff` closure; called from fast + reconcile paths only after `publishIntradayPdr` returns |
| `functions/src/v2/alpha-vantage/jobs/job-config.ts` | `INTRADAY_SIGNOFF_TICKS` = {0800,1000,1200}, co-located with `INTRADAY_FIRST_TICK` |
| `functions/tests/v2/alpha-vantage/jobs/intraday-ops-signoff.test.ts` | 16 tests — gating, ordering, dedupe, fail-safe, text/content |
| `functions/tests/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.test.ts` | 8 tests — emit-after-PDR ordering, PDR-failure, already-COMPLETE, completion race, reconcile |
| `functions/scripts/verify/ops-sms-alerts-207-intraday-signoff.ts` / `.md` | Mutating prod verify script + guide |
| `functions/scripts/verify/run-all.ts`, `README.md` | Manual-exclusion comment + index/exec-order rows |

## Axes

### Standards

No hard violations. File size, naming, fail-safe contract, verify-script registration all match the 204/206 sibling pattern.

- **Duplicated Code (real, remediated):** the fast path and reconcile path each carried an identical ~30-line `pdrSent` + try/catch + signoff block, differing only in `runData` vs `reconData`. → Extracted `publishPdrAndSignoff(data, totalDuration)` closure next to `completeRun`; both paths call it. Also shrinks the already-over-400-line aggregator (pre-existing size flagged, not worsened further).
- **Judgement calls noted:** `as any` logger casts consistent with the file's pervasive pattern (pre-existing `BetterLogPayload` debt); `IntradayTickSignoffArgs` overlaps the composer's `IntradaySignoffInput` but requires `marketDate`/`clockPt` where the composer allows omission — kept separate deliberately; `ops-alert.types.ts` marketDate JSDoc says "PT" while reality is ET — pre-existing drift, not this change.
- **Contract baseline clean:** `intraday-runs/{runId}`, `ops-alert-claims/{key}`, `ops-alerts/{key}` all valid even-segment doc paths; claim+stamp transactional inside the guard; real SDK paths exercised by the prod verify script.

### Spec

All five acceptance criteria met:

- One signoff per tick, only after PDR publish succeeds — **met** (`pdrSent` gates emission; `claimOpsAlert` dedupes across fast/reconcile/redelivery).
- Tick, counts, duration in text — **met** (composer + test assertions).
- Non-tick publishes emit nothing — **met** (`INTRADAY_SIGNOFF_TICKS` strict-equality gate; heartbeats use a separate publisher; self-healing's FAILED republish correctly bypasses the call site — a force-completed stale run is exception territory, not a signoff).
- Emission failure cannot fail the job or PDR — **met** (helper is fully self-guarded; called after publish + `status=COMPLETE`).
- Failed-symbol list logged alongside, text counts-only — **met** (added during implementation pass 2: `permanentFailureSymbols` → `context.failedSymbols` → `ops.alert` ctx + audit doc; smsText asserts no symbol tokens).

**Accepted design notes (documented in code, not blockers):**

- *Manual/dev impersonation:* a dev-triggered run at an exact tick clockPt reuses the same `…-LIVE-{clockPt}` runId and run doc — indistinguishable from the scheduled run BY DESIGN, so it may claim that tick's signoff. `trigger` is hardcoded `SCHEDULER` on intraday run docs, so no distinguishing field exists. Dev-only edge; the dedupe key per tick is still correct.
- *Scheduler-jitter/off-label clockPt:* `clockPt` is `clockPtNow()` sampled at invocation; a fire landing past the minute produces e.g. `0801` — no signoff AND no matching watchdog runId, so the tick reports `run_missing` instead. Consistent with the watchdog model (exact-tick runIds are canonical); pre-existing pipeline assumption, not introduced here.

### Thermo-nuclear

Three majors, all remediated or dispositioned:

- **Tick gate silently dropped runs with zero log evidence** — a late-fired `0801` clockPt returned bare. → Gate skip now logs `intraday.signoff_skipped {reason:'not-a-tick'}`; code comment documents the deliberate strict-equality semantics vs the watchdog model.
- **Manual/dev runs collide on the tick alertKey** — dispositioned as accepted-by-design (see Spec notes); documented in code.
- **Reconcile test couldn't catch stale-data regression** — static `docGet` meant `reconData` returned pre-reconcile fixtures. → Second `docGet` now returns post-reconcile counts; assertions require `permanentFailureJobs:1` + `failedSymbols:['TSLA']` — values only `reconData` can carry.

Minors remediated: destructure moved inside try (never-throws contract vs `null` args); `signoff_emitted` renamed `signoff_emit_invoked` (claim won, emit attempted — the canonical `ops.alert` line is the real signal); added PDR-failure test on the reconcile path; added `didComplete=false` completion-race test; added `failedSymbols` pass-through assertions.

Judgement kept: `pdrSent` flag retained over `catch{return}` — it makes "signoff iff publish returned" explicit and survives future code inserted between the blocks. Awaiting the helper (not fire-and-forget) is correct — unawaited promises die with the function.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| Major | Non-tick gate returned bare — late-fired clockPt vanished with no log evidence | Fixed — `signoff_skipped {reason}` log + design comment |
| Major | Reconcile test static `docGet` masked runData/reconData mix-ups | Fixed — differentiated pre/post-reconcile reads + recon-only assertions |
| Major | Dev run at tick clockPt impersonates the scheduled signoff | Accepted — same runId/run doc by design; documented; dev-only |
| Minor | Destructure before try could throw on null args | Fixed — moved inside try, catch uses `args?.` |
| Minor | `signoff_emitted` overstated (audit write could still fail) | Fixed — `signoff_emit_invoked` |
| Minor | No reconcile-path PDR-failure test | Fixed — added |
| Minor | No `didComplete=false` race coverage | Fixed — added |
| Minor | ~30-line duplicated PDR+signoff block across both paths | Fixed — `publishPdrAndSignoff` closure |
| Nit | Aggregator already >400 lines (pre-existing) | Noted — dedup reduced the add |
| Nit | `IntradayTickSignoffArgs` vs `IntradaySignoffInput` overlap | Noted — stricter required fields justify the separate arg type |

## Test results

- Focused: `tests/v2/alpha-vantage/jobs/` — **24/24** (16 helper + 8 aggregator)
- Full suite: **925/925**, 90 suites
- `npx tsc --noEmit` — clean
- Live verify vs prod — **18/18 PASS**: real claim tx, audit doc text/stamp, dedupe on re-invoke (`emittedAt` unchanged), non-tick clockPt writes nothing, cleanup

## Verdict

**PASS** — all three majors remediated or dispositioned with design rationale recorded in code; minors fixed and re-verified (unit + live prod). Ready for `/proj qa 198 207`.

---

## Second pass — final-state review (2026-10-28)

All three axes re-ran against the remediated final code (protocol: final diff, not patch history).

| Axis | Result |
|---|---|
| Standards | **PASS** — no hard violations; `publishPdrAndSignoff` confirmed the right dedup; 2 soft nits (`data`→`runDoc` naming, `data: any`) |
| Spec | **PASS** — all 5 ACs met; caveat: `pdrSent` = "publish returned," consistent with `partnerDataReady.messageSent` semantics (RS cross-project hop excluded, watchdog-covered); nit on `createdJobs ?? 0` |
| Thermo-nuclear | **REQUEST CHANGES → resolved** — 1 major (pre-existing latent), 4 minors, 1 nit |

### Pass-2 findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Major | **Premature-completion race (pre-existing, now SMS-visible):** `createdJobs` increments per-batch mid-creation; `finished === created` can hold transiently → premature COMPLETE → PDR + signoff with partial counts. `jobsCreationCompletedAt` stamped but never read. Same gap in `realtime-run-aggregator.ts` | **Filed as Bug #235** — pipeline-correctness issue predating this task (already corrupts partner `finalizedCountTotal`); out of #207 scope; fix direction documented there |
| Minor | Reconcile path under-reported `failedSymbols` (re-scan recomputed counts but not symbols) | Fixed — `reconcileIntradayRunJobs` now collects PERMANENT_FAILURE symbols into the run doc's `permanentFailureSymbols` (arrayUnion, capped, guarded against empty-arg throw) — run doc stays the canonical list; **note:** TN's suggested `nonSuccessJobs` derivation was wrong (failures aren't stored there) |
| Minor | `signoff_skipped` fired with two payload shapes (`reason` vs `claim`) | Fixed — unified `reason: not-a-tick \| already-claimed \| claim-error` |
| Minor | `partnerDataReady.messageSent` stamped last — write failure after a real send suppresses signoff + false `pdr_missing` | Pre-existing ordering; fail-closed direction is correct; noted |
| Minor | Verify script emits a real `ops.alert` in prod — post-#211 a rerun texts the ops phone | Documented in the script's `.md` side-effect note |
| Nit | `data: any` + `data` naming in the closure | Fixed — `runDoc` param with explicit structural type |

### Verified non-issues (pass 2)

- Closure capture is sound — `runId/marketDate/clockPt` immutable args; `totalDuration` a param; `runData` vs `reconData` differentiation asserted by the upgraded test.
- Race-test faithfulness — completion status read inside the tx via `tx.get`; a regression to `runData.status` would fail the test.
- `totalDuration: undefined` in `tx.update` — safe (`ignoreUndefinedProperties: true` globally).
- Worker redelivery can't double-increment; `didComplete` tx + claim doc cover concurrent completion.
- Dev-run impersonation + off-label clockPt dispositions verified accurate against the watchdog's exact-runId checks.

Suite after remediation: **944/944** (23 focused), `tsc --noEmit` clean.
