**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #201  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-25  

# Test Plan: Pipeline SMS Refresh (BE)

## E2E User Journeys

- **Clean trading day:** drive the emulator through intraday ticks + POST A run → exactly 4 canonical alert events emitted with correct composed text (intraday ×3, POST ×1), none for B/C.
- **Exception day:** simulate a missing run doc / missing PDR / orchestrator no-start → exactly one exception alert event per condition, naming the affected run.
- **Market-closed day:** run schedulers on a holiday/weekend date → zero alert events.
- **Redelivery:** deliver the same scheduled invocation twice → exactly one signoff text (send-once marker).

## Integration Tests

- Intraday aggregator → PDR published → signoff alert event emitted with that tick's stats.
- Realtime-run aggregator → third interval PDR → sibling-doc check → single all-intervals signoff emitted; partial completion (1 or 2 intervals) emits nothing.
- Reconcile path (run exceeds 60-min window) → signoff still emitted exactly once.
- Post watchdog with `sequence: 'B'` and `'C'` → run_missing/pdr_missing produce exception events; market-closed date produces none.
- Emitter failure (e.g. audit-doc write throws) → pipeline call site unaffected, error logged only.

## Unit Tests

- **Composer (pure functions):** each message type — intraday signoff, POST signoff, each exception variant. Assert exact output strings for clean, partial-failure, and edge inputs; assert ≤ ~300 chars; assert no raw runIds/log jargon in prose text.
- **Composer edge inputs:** zero jobs, 0% failures, large failure counts, missing duration, missing PDR time.
- **Send-once guard:** transaction claims marker once; second call returns "already sent" without emitting.
- **Calendar gate:** weekday vs weekend vs known holiday dates.

## Test Seams

- **Highest seam:** Jest integration tests at the aggregator/watchdog level with mocked Firestore — asserts the alert event emitted for a given run state (existing pattern: `functions/tests/v2/alpha-vantage/data-refresher/post-all-intervals-orchestrator.test.ts`).
- **Lower seam:** pure composer functions — direct unit tests, highest value-per-effort.

## Existing Test Coverage

- `functions/tests/` Jest suite covers orchestrator and worker behavior with mocked Firestore — reuse its harness/mocks for run docs.
- Watchdog tests, if present, cover `checkPostPdrDelivery`/`checkIntradayPdrDelivery` — extend for new sequences and the calendar gate.

## Edge Cases

- Pass with zero created jobs (nothing to retry) — signoff still composes a valid "all clean" text.
- Run doc missing fields (`successJobs` undefined, missing `runStartedAt`) — composer degrades gracefully.
- Two intervals completing in the same instant — only one signoff emitted.
- Scheduler fires on a holiday — calendar gate suppresses; no alert.
- Delivery path down (sender throws / alert not forwarded) — run unaffected; audit doc records the attempt.
- B/C pass missing entirely — new watchdog catches; text says which pass and its expected window.
