# Documentation Index

Last updated: 2026-02-14

This is the master table of contents for the `docs/` directory. Documents are grouped by domain and listed in recommended reading order within each group.

---

## Time-Series Job Pipeline (A/B/C)

The core data refresh system. These four docs form a tightly linked set — each references the others.

| Doc | Purpose | Audience |
|-----|---------|----------|
| `time-series-job-pipeline-plan.md` | Design rationale, architecture decisions, migration plan, and future work. The "why + what". | Internal SA engineers |
| `time-series-job-pipeline-deep-dive.md` | Technical appendix: TypeScript types, Firestore schemas, step-by-step algorithms. The "how". | Internal + RS engineering |
| `rs-partner-integration.md` | Consumer-facing contract: Pub/Sub payloads, subscription filters, `includeSymbols`/`excludeSymbols`, HTTPS endpoints, quick start. | RS backend engineers |
| `abc-run-pipeline-flowchart.md` | Mermaid flowcharts documenting the A/B/C pipeline visually with filenames and function names. | Internal + RS engineering |

Supporting references:

| Doc | Purpose |
|-----|---------|
| `time-series-scheduler-cheatsheet.md` | Operational cheat sheet: manual scheduler triggers (A/B/C), env vars, Logs Explorer filters, Cloud Run service names. |
| `av-call-sites-audit.md` | Audit of all Alpha Vantage API call sites, rate-limiting status, and risk assessment. |

---

## Partner Documentation

Read in this order for partner onboarding:

| # | Doc | Purpose |
|---|-----|---------|
| 1 | `partner-discovery.md` | Conceptual overview: surface area, data shapes, auth model, Pub/Sub discovery, operational expectations. Start here. |
| 2 | `partner-integration.md` | Step-by-step server-to-server integration: IAM lockdown, token minting, request examples, troubleshooting. |
| 3 | `partner-auth-and-audience.md` | Deep dive on Gen2 Cloud Functions auth: per-function audience, multi-audience support, failure modes, ops checklist. |
| 4 | `partner-dataset-announcement.md` | Phase 1 dataset baseline: symbol universe, time-series coverage guarantees, data quality process, near-term roadmap. |
| 5 | `partner-market-holidays.md` | `partnerMarketHolidays` endpoint: request/response schema, 2025/2026 holiday data, RS usage patterns. |
| 6 | `partner-data-ready-test-runs.md` | How to publish test/manual PDR messages from AV using the direct publisher script. Trigger semantics, recipes, troubleshooting. |
| 7 | `cross-project-pubsub-eventarc.md` | Infrastructure reference: cross-project Pub/Sub + Eventarc trigger setup between AV and RS projects. |

---

## Firestore & Data Model

| Doc | Purpose |
|-----|---------|
| `firestore-document-paths.md` | Canonical Firestore data structure: top-level collections (`tracked-symbols`, `symbol-data`, `realtime-runs`, `backfill-runs`, `jobs`), subcollections, year-sharded bar schema. |
| `split-adjustment-design.md` | Split-adjusted data architecture: dual-write model (legacy `time-series` removed), real-time split detection, manual backfill, partner API access. |
| `split-adjustment-math.md` | Mathematical reference: why splits must be processed newest-to-oldest, AAPL worked example, idempotency analysis. |

---

## Backfill & Data Maintenance

| Doc | Purpose |
|-----|---------|
| `backfill-and-split-toolkit.md` | Comprehensive guide to local maintenance scripts: `backfill-data.ts`, `sync-splits.ts`, `verify-data.ts`, `diagnose-timeseries.ts`, `repair-timeseries-metadata.ts`. |
| `backfill-timeseries-window.md` | `backfill-timeseries-window.ts` script: bounded date-range backfill with durable Firestore progress tracking. |
| `manual-full-backfill-process-as-built.md` | As-built doc for the Cloud Tasks-based full backfill system: HTTP trigger, job creation, worker, aggregator. |
| `bulk-symbol-upload.md` | Bulk symbol onboarding plan: scraper JSON → `bulkImportSymbolsV2` → AV SYMBOL_SEARCH → tracked-symbols. |

---

## Internal Operations

| Doc | Purpose |
|-----|---------|
| `internal-gateway-admin.md` | Browser-facing gateway admin: Origin allowlist, IAM guidance (keep `allUsers`), health metrics endpoints, change management runbook. |
| `local-emulator-workflow.md` | Local development: Firebase emulator setup, HTTP triggers, env config, maintenance scripts on emulator. |
| `backend-functions-overview.md` | Mid-high level overview of all backend Cloud Functions: directory structure, invocation types, scheduled jobs, data flow. |

---

## Project Management

| Doc | Purpose |
|-----|---------|
| `project-plan.md` | Original project plan: phases, modules, tasks for the Financial Data Proxy API Surface workbench. |
| `project-tasks.md` | Active task tracker: completion status, discovered-during-work items, future enhancements. |

---

## Notes

- Partner endpoints are server-to-server only and use dual-auth with allowlisted service accounts.
- Internal browser-facing endpoints are SavantApi.com-only and protected by an Origin allowlist in application code.
- All OHLCV time-series storage uses `sa-time-series` (split-adjusted). The legacy `time-series` collection has been wiped in production.
- The time-series refresh pipeline uses the A/B/C model with `realtime-runs`, `backfill-runs`, and `jobs` collections.
- Lockdown invokers script: `functions/scripts/README.lockdown-invokers.md` — manages Cloud Run `roles/run.invoker` for partner HTTP endpoints.
