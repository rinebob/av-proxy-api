**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #217  
**Task:** #203  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# UAT — Task #203: Verify SMS delivery path + inventory existing alerts

## Scope

Research spike. Deliverables: (a) a written finding on whether GCP Cloud Monitoring's SMS notification path can carry composed message text; (b) a delivery-path recommendation; (c) a complete inventory of existing pipeline alert policies as the decommission list; (d) no code changes.

## Prerequisites

- `gcloud` CLI authenticated (`rinebob111185@gmail.com`)
- Access to GCP project `alpha-vantage-proxy-api`
- Read access to repo docs and GitHub issues

## Test scenarios

### 1. Alert-policy inventory is complete

- **Confirms:** AC3 — decommission list.
- **Steps:**
  ```bash
  gcloud alpha monitoring policies list --project=alpha-vantage-proxy-api \
    --format="value(displayName,enabled)"
  ```
- **Expected:** exactly 2 policies, both enabled: `sa-run-start`, `sa-monthly-run-end`.
- **Result:** **PASS** — output was exactly `sa-monthly-run-end  True` / `sa-run-start  True` (2026-10-17).
- **Supplementary:** `gcloud logging metrics list --project=alpha-vantage-proxy-api` → empty; `gcloud monitoring uptime list-configs` → empty; SMS-channel scan across all 12 account projects found `sms` channels only in `alpha-vantage-proxy-api` (`rinebob-cell-7078`) and `rel-str` (DLQ alert channel). No other API-visible text source exists.

### 2. Notification channel identity

- **Confirms:** AC3 — destination channel recorded for decommission.
- **Steps:**
  ```bash
  gcloud alpha monitoring channels list --project=alpha-vantage-proxy-api \
    --format="value(name,displayName,type)"
  ```
- **Expected:** one `sms` channel `rinebob-cell-7078`, resource `15876465193245838912`.
- **Result:** **PASS** — output was exactly `projects/alpha-vantage-proxy-api/notificationChannels/15876465193245838912  rinebob-cell-7078  sms`.

### 3. SMS channel cannot carry composed text

- **Confirms:** AC1 — the gating finding.
- **Steps:** fetch `https://docs.cloud.google.com/monitoring/alerts/doc-variables` and read the "Content" section listing notification types that render `documentation.content`.
- **Expected:** list contains Email, PagerDuty, Pub/Sub, Slack, Webhooks — SMS absent.
- **Result:** **PASS** — official doc lists "Email, in the Policy Documentation section / PagerDuty / Pub/Sub / Slack / Webhooks"; SMS appears in none of the three notification-type lists on the page (re-verified 2026-10-17). Corroborated by the user's own experience of fixed "ALRT Log match condition"-style texts.

### 4. Delivery recommendation recorded

- **Confirms:** AC2.
- **Steps:** read issue #203 findings comment and IMPL doc design decision #10.
- **Expected:** dedicated sender (Twilio — user-confirmed provider) behind the canonical alert event; no stale "pending spike" language.
- **Result:** **PASS** — decision recorded on issue #203 and IMPL doc decision #10; stale references fixed during code review.

### 5. No code changes

- **Confirms:** AC4.
- **Steps:** `git status --short` — confirm no source files were touched by this task.
- **Expected:** only docs under `docs/topics/198-ops/` relate to this task.
- **Result:** **PASS** — working tree contains only doc changes for this Topic; unrelated modifications belong to Topics #158/#213 (separate workstreams).

### 6. (Optional, observational) Real-text provenance

- **Confirms:** assumption that ~20/day volume is re-notification behavior from the 2 inventoried policies.
- **Steps:** when the next alert text arrives on the operator's phone, check whether it references `sa-run-start` or `sa-monthly-run-end`.
- **Expected:** text names one of the two policies.
- **Result:** **DEFERRED — optional.** Not required for gate: the API-visible inventory is complete (all projects scanned for SMS channels), so no additional policy source is possible within GCP Monitoring. The check would only confirm *why* volume exceeds theoretical count, which does not change the decommission list.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Written finding: can the GCP SMS path carry composed text | 3 |
| Delivery path recommendation recorded | 4 |
| Complete inventory of existing alert policies (decommission list) | 1, 2 |
| No code changes | 5 |

## Regression / smoke

None applicable — no code or config was modified by this task. Existing pipeline behavior untouched.
