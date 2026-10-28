**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #201  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** Implementation Plan  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-25  

# Implementation Plan — BE: Pipeline SMS Refresh

## Architecture

One new module houses all operator-notification logic — composition, emission, idempotency — under `functions/src/v2/common/` (e.g. `ops-alerts/`). It is the **single composition seam**: pipeline code emits a canonical *alert event* carrying the final human-readable `smsText`; delivery is downstream and interchangeable.

```mermaid
flowchart TD
    AGG[Intraday aggregator<br/>PDR sent] --> EMIT
    RTA[Realtime-run aggregator<br/>last interval PDR sent] --> EMIT
    WD[Watchdogs: intraday + post A/B/C<br/>run_missing / pdr_missing] --> EMIT

    subgraph ops-alerts module
        CMP[Composer — pure fns<br/>run state → smsText]
        EMIT[emitOpsAlert — fail-safe wrapper]
        GUARD[Send-once guard — tx marker on run doc]
    end

    EMIT --> LOG[Canonical log event ops.alert<br/>carries smsText + context]
    EMIT --> AUD[ops-alerts audit doc<br/>dedupe + observability]
    LOG --> DL{{Delivery — decided (#203): dedicated sender}}
    DL --> SND[Minimal sender fn → SMS provider API]
    GCM[Cloud Monitoring → SMS<br/>fixed-format, cannot carry composed text] -.->|rejected| DL
```

## Design decisions

1. **Emission at aggregator call sites, not inside `enqueueDataReadyInternal`.** The PDR chokepoint is shared by heartbeats, manual, and non-time-series runTypes; signoffs must only fire for the 4 real run completions. The aggregators already know runType/sequence/interval — emit there.

2. **POST-A "last interval" detection.** In `realtime-run-aggregator.ts` — both the fast path (after `partnerDataReady.messageSent` write) and the reconcile path — when `sequence === 'A'` and `runType === 'ts-post-all-intervals-initial'`: read the two sibling `realtime-runs` docs for the same `marketDate` + `sequence`; if all three have `messageSent === true`, transactionally claim a send-once marker and emit the signoff with all-intervals stats. The transaction prevents double-emission when intervals finish concurrently.

3. **Intraday signoff.** In `intraday-snapshot-jobs.aggregator.ts` after the PDR publish + `messageSent` write, emit the tick signoff. The runId/clockPt identifies which tick (0800/1000/1200).

4. **Fail-safe emission.** `emitOpsAlert` never throws into pipeline code — all failures are caught and logged. An SMS failure must never fail a Cloud Task, break a PDR publish, or mark a run incomplete.

5. **Send-once marker.** New optional field on run docs (e.g. `opsSms.sentAt`), set inside a Firestore transaction — additive, no schema migration. Mirrors the existing `partnerDataReady.messageSent` pattern.

   **Implemented deviation (Task #206):** the send-once *authority* is a dedicated `ops-alert-claims/{alertKey}` doc claimed transactionally, not a single field on the run doc — one run doc carries 4+ distinct alert keys (3 intraday signoffs + POST signoff + exceptions) that a single `opsSms.sentAt` could not distinguish, and `run_missing` exceptions have no run doc at all. When `runDocPath` is passed, the same transaction stamps `opsSms.claimed[alertKey]` on the existing run doc for observability (records claim intent, not confirmed SMS delivery; never fabricates a run doc). Signoff call sites MUST pass `runDocPath`; exception call sites pass it only when the run doc is expected to exist.

6. **Composer is pure.** Input: run-doc-shaped data (marketDate, interval stats, counts, durations, PDR status). Output: the exact SMS string (verbose readable, ≤ ~300 chars / 2 segments). Fully unit-testable, no Firestore, no clock — clock/dates injected.

7. **Hard-down exceptions ride the same seam.** Watchdogs emit canonical alert events for `run_missing` / `pdr_missing` / orchestrator-no-start. Exception texts name what was expected, what happened, the runId, and where to look next.

8. **B/C watchdog coverage.** `checkPostPdrDelivery` already accepts `{ sequence, clockPt }` — add scheduled invocations for B (~19:15–19:45 PT, after B's 60-min window) and C (~05:15 PT, after C's). Two additional `onSchedule` entries calling the existing core with `sequence: 'B'/'C'` and matching `clockPt`.

9. **POST calendar gate.** The post watchdog currently lacks the intraday watchdog's market-closed skip. Add an equivalent gate (holiday/weekend → skip silently, no false alarms). Reuse the existing market-calendar helpers used by `intraday-calendar-gate`.

10. **Delivery — DECIDED (Task #203 spike): dedicated sender.** GCP `documentation.content` only reaches Email/PagerDuty/PubSub/Slack/Webhook channels — SMS notifications are fixed-format and cannot carry composed text. `emitOpsAlert` therefore calls a minimal sender that posts to the Twilio Messages API (provider confirmed by user; account SID/auth token as secrets, sending number required). The canonical alert event remains the seam; the sender is the last hop. The two existing `sa-*` log-match policies are retired at cutover.

11. **Decommission.** Phase 1 inventories every existing pipeline alert policy; Phase 5 disables them in GCP and documents the console steps in a runbook section of this plan's task.

## Components

| Component | Responsibility |
|---|---|
| `ops-alert.types` | `OpsAlertEvent` — kind (signoff/exception), smsText, runId, marketDate, context |
| `ops-alert.composer` | Pure formatters: `composeIntradaySignoff`, `composePostSignoff`, `composeException` |
| `ops-alert.emitter` | `emitOpsAlert` — canonical log + audit doc; never throws |
| `ops-alert.guard` | Transactional send-once marker |
| Aggregator hooks | Emission points in intraday + realtime-run aggregators |
| Watchdog changes | B/C invocations, POST calendar gate, alert-event emission |
| `ops-alert.sender` | Minimal sender — posts `smsText` to the Twilio Messages API; credentials via secrets |

## Phases & task outline

1. **Delivery verification + inventory** — GCP spike (can the SMS path carry composed text?) + inventory all existing pipeline alert policies for retirement. No code changes.
2. **Alert core** — types, composer, emitter, send-once guard. Pure + testable.
3. **Signoff triggers** — intraday tick emission; POST-A last-interval detection (both completion paths).
4. **Hard-down exceptions** — B/C watchdog checks, POST calendar gate, watchdog → alert events.
5. **Cutover** — wire delivery end-to-end, retire old policies, runbook + live-day verification.

## Risks

- **SMS provider not yet provisioned** — delivery decision made (dedicated sender, #203); remaining risk is account/number/secrets setup, required before Phase 5 cutover.
- **Concurrent interval completion** — mitigated by transactional send-once marker.
- **Emission failure masking pipeline health** — emitter is fail-safe; watchdogs still detect missing PDRs independently.
- **Old + new alerts double-firing during rollout** — mitigated by explicit decommission task ordered after end-to-end verification.
