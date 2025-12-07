# Project Plan: Financial Data Proxy API Surface (Workbench)

This document outlines a detailed project plan for building your "Financial Data Proxy API Surface" workbench. It leverages Angular for the frontend, Firebase Cloud Functions for the proxy backend, Firebase Authentication for security, and Firebase App Hosting for deployment. The plan focuses on a streamlined initial build, with clear considerations for future enhancements.

## Goal

To build a simple, robust, and secure developer workbench (Proxy API Surface) for financial data APIs (initially Alpha Vantage and Benzinga), enabling direct interaction with their endpoints via a web UI and serving as a proxy for future end-user applications.

## Technology Stack

-   **Frontend**: Angular (TypeScript)
-   **Backend (Proxy)**: Firebase Cloud Functions (Node.js/TypeScript)
-   **Authentication**: Firebase Authentication
-   **Hosting**: Firebase App Hosting

## Scope (Phase 1 - Initial Build)

-   Securely proxy Alpha Vantage and Benzinga API requests through Firebase Cloud Functions.
-   Provide a frontend UI with dedicated forms for each accessible API endpoint.
-   Display raw JSON responses directly in the UI.
-   Implement Firebase Authentication for workbench access.
-   Host the application on Firebase App Hosting.

**Out of Scope for Phase 1**: Caching, Rate Limiting, Data Transformation, AI Integration. These will be handled by future end-user applications that consume this proxy.

---

## Development Plan Breakdown

### Phase 1: Core Proxy API Surface Development

#### Module 1: Firebase Project Setup & Core Infrastructure

**Task 1.1: Firebase Project Initialization**
-   Create a new Firebase project in the Google Cloud Console.
-   Enable Firebase Authentication (e.g., Email/Password, Google Sign-In for developers).
-   Enable Cloud Firestore (if future plans for storing API metadata or user preferences arise, otherwise can defer).
-   Enable Firebase Cloud Functions.
-   Enable Firebase App Hosting.

**Task 1.2: Firebase CLI Setup & Local Environment**
-   Install and configure Firebase CLI locally.
-   Login to Firebase CLI and select the project.
-   Initialize Firebase project for Hosting and Functions.

#### Module 2: Proxy Backend (Firebase Cloud Functions)

**Task 2.1: Secure API Key Management**
-   Store Alpha Vantage and Benzinga API keys securely as Firebase environment variables (e.g., using `firebase functions:config:set` or Google Cloud Secret Manager if needed for more advanced secret management, though env variables are sufficient for simple cases).

**Task 2.2: Generic Proxy Function Structure**
-   Create a base Firebase Cloud Function that can receive generic requests (e.g., `apiProxy`).
-   This function will:
    -   Validate Firebase Authentication token from the incoming request (ensure only authenticated users can trigger it).
    -   Parse the incoming request to identify the target 3rd party API (e.g., Alpha Vantage, Benzinga) and its specific endpoint.
    -   Construct the appropriate HTTP request to the 3rd party API, including securely injecting the API key from environment variables.
    -   Make the request (using `axios` or Node's `fetch`).
    -   Handle potential errors from the 3rd party API.
    -   Return the raw JSON response received from the 3rd party API.
    -   Implement CORS headers on the Cloud Function response to allow the Angular frontend to consume it.

**Task 2.3: Endpoint-Specific Proxy Functions (Initial Batch)**
-   **For Alpha Vantage**:
    -   Identify 3-5 key Alpha Vantage endpoints (e.g., `TIME_SERIES_DAILY`, `GLOBAL_QUOTE`, `COMPANY_OVERVIEW`).
    -   Create specific logic within the generic proxy function (or separate functions if preferred for clarity, though a single, well-structured function is often simpler for a proxy) to handle these endpoints. This involves mapping frontend parameters to Alpha Vantage's required parameters.
-   **For Benzinga**:
    -   Identify 3-5 key Benzinga endpoints (e.g., `news`, `calendar`).
    -   Integrate similar logic for these endpoints.

**Task 2.4: Deployment of Cloud Functions**
-   Deploy the developed Firebase Cloud Functions.

#### Module 3: Frontend (Angular Workbench UI)

**Task 3.1: Angular Project Setup**
-   Create a new Angular project using Angular CLI.
-   Integrate `@angular/fire` for Firebase Authentication.

**Task 3.2: User Authentication UI**
-   Build simple login/logout components using Firebase Authentication (e.g., email/password or Google Sign-In).
-   Implement Angular Guards to protect workbench routes, ensuring only authenticated users can access the API forms.

**Task 3.3: API & Endpoint Navigation**
-   Create a simple navigation structure (e.g., sidebar or top menu) allowing users to select between "Alpha Vantage" and "Benzinga".
-   Under each API, list the available endpoints. Each list item will link to its specific data entry form.

**Task 3.4: Data Entry Forms**
-   For each selected endpoint:
    -   Create an Angular Reactive Form.
    -   Dynamically (or semi-dynamically, using a JSON configuration for each endpoint's parameters) generate input fields for all required and optional parameters based on the Alpha Vantage and Benzinga documentation.
    -   If an endpoint has multiple return types, include a dropdown to select the desired type, which might adjust the parameters shown or how the proxy constructs the request.
    -   Implement input validation for form fields (e.g., required fields, data types).
    -   Add a "Make Request" button.

**Task 3.5: API Interaction Service**
-   Create an Angular service to handle communication with the Firebase Cloud Function proxy.
-   This service will take the endpoint name and parameters, construct the request body, and send it to the Cloud Function.
-   It will also handle Firebase Authentication token injection into the request headers for the Cloud Function.

**Task 3.6: Raw JSON Response Display**
-   Upon receiving a response from the proxy, display the raw JSON in a pre-formatted text area (e.g., `<pre><code>`) below the form. No special formatting or syntax highlighting initially.

#### Module 4: Deployment & Testing

**Task 4.1: Firebase App Hosting Configuration**
-   Configure `firebase.json` for Angular application deployment to Firebase App Hosting.
-   Set up automatic deployments via GitHub integration with Firebase App Hosting.

**Task 4.2: End-to-End Testing**
-   Test user authentication flow.
-   Test each implemented API endpoint: submit parameters, verify correct request reaches 3rd party API via proxy, and raw JSON response is displayed.
-   Verify API key security (keys are not exposed client-side).
-   Verify CORS handling.

---

## Health Dashboard (New Module)

### Overview
A comprehensive dashboard to monitor the health and status of all automated Alpha Vantage data updates, TTLs, and system metrics. This will provide visibility into the data refresh pipeline and help identify any issues with data freshness or update failures.

### Key Features
1. **Endpoint Status Overview**
   - Current status of all Alpha Vantage endpoints
   - Last successful update timestamp per endpoint
   - Time until next scheduled refresh
   - TTL configuration for each endpoint
   - Success/failure rate metrics

2. **Data Freshness Monitoring**
   - Time since last successful update per symbol/endpoint
   - Visual indicators for stale data
   - Historical update patterns and trends

3. **System Health Metrics**
   - Alpha Vantage API rate limit usage and quotas
   - Error rates and common failure modes
   - Performance metrics (latency, processing time)
   - Resource utilization (Firestore reads/writes)

4. **Alerting and Notifications**
   - Configurable alerts for failed updates
   - Threshold-based notifications for performance degradation
   - Integration with monitoring systems (e.g., Cloud Monitoring)

### Implementation Approach
1. **Backend Components**
   - New Cloud Function to aggregate health metrics
   - Firestore collection for storing health check results
   - Scheduled jobs to update health metrics

2. **Frontend Components**
   - New Angular module for the health dashboard
   - Real-time updates using Firestore listeners
   - Interactive charts and visualizations
   - Filtering and search capabilities

#### Health View UI: Components and Current Behavior

- __Endpoint Detail__
  - Shows endpoint-centric request histories, grouped by endpoint.
  - UI-specific sorting is applied in `src/app/feat/health-view/comps/endpoint-detail/health-endpoint-detail.component.ts`.
  - Grouping, base sorting, and priority ordering are centralized in the store `src/app/feat/health-view/store/health-dashboard.store.ts` via computed selectors (`endpointGroupsRaw`, `sortedEndpointGroupsByPriority`).

- __Request Logs Table__
  - Paginated, filterable, and sortable feed of request events from Cloud Functions (`getRequestLogs`).
  - Used as the source for both endpoint and symbol–centric views.

- __Symbol Detail (Updated)__
  - Purpose: a symbol‑centric list of all requests for the chosen symbol, across endpoints; conceptually similar to Endpoint Detail but pivoted by symbol rather than endpoint.
  - Data: request history for the symbol (from `request-logs` via Cloud Functions), with optional status/metrics aggregated server‑side from `endpoint-symbols` and `health-metrics`.
  - Important: prior behavior that auto‑navigated to the Symbol tab based on external symbol selection is deprecated. The Symbol Detail view stands alone as a symbol‑centric view; there is no implicit cross‑feature navigation triggering it.
  - Key files: `src/app/feat/health-view/comps/symbol-detail/health-symbol-detail.component.ts`, `src/app/services/health-metrics-api.service.ts`, and `src/app/feat/health-view/store/health-dashboard.store.ts`.

- __Data flow and refresh__
  - Cloud Functions provide: `getHealthSummary`, `getRequestLogs`, `getSymbolStatus`, `getSymbolMetrics`.
  - `HealthDashboardComponent` listens to `health-metrics/{endpoint}/latest/status` for time‑series endpoints and triggers `refreshAll()` to reload summary and logs.

- __Store responsibilities__
  - Centralizes endpoint grouping, priority, and KPI derivations from the current logs window.
  - UI components keep only presentation sorting and rendering concerns.

3. **Data Collection**
   - Instrument existing refresh functions to log health metrics
   - Track success/failure of each update operation
   - Monitor TTLs and next refresh times

### Integration Points
- Leverages existing Firestore data structures
- Integrates with current authentication and authorization
- Complements the existing monitoring setup

### Future Enhancements
- Automated remediation for common issues
- Historical trend analysis
- Capacity planning insights
- SLA compliance reporting

---

## Future Enhancements (Post-Phase 1)

Once the core proxy workbench is functional and stable, the following can be considered:

### Enhanced AI Integration:

-   Leverage the "MCP server" for AI to assist in understanding API documentation and generating requests.
-   Integrate Gemini API (or other chosen AI model) for:
    -   **Request Construction Assistance**: AI suggests parameters or even entire requests based on natural language prompts.
    -   **Response Interpretation**: AI summarizes or extracts key insights from the raw JSON responses.
    -   **Data Analysis**: AI performs more complex analysis across multiple API calls, potentially storing results in Firestore for later retrieval.

### Dynamic Endpoint Discovery/Form Generation

-   If Alpha Vantage or Benzinga (or future APIs) provide OpenAPI/Swagger specifications, investigate tools (e.g., `ngx-form-generator`, `ng-openapi-gen`) to automate form generation from these specs.

### Backend Enhancements

-   **Backend Caching (Cloud Functions/Firestore)**: Implement caching of API responses in Firestore to reduce calls to external APIs and improve performance for frequently requested data.
-   **Backend Rate Limiting (Cloud Functions)**: Implement robust rate-limiting logic per API (Alpha Vantage, Benzinga) to adhere to their usage policies.
-   **Data Transformation/Filtering (Cloud Functions)**: Add capabilities within Cloud Functions to transform, filter, or combine data from 3rd party APIs before sending to the frontend.

### Enhanced UI/UX

-   JSON pretty-printing and syntax highlighting in the response display.
-   History of requests made.
-   Ability to save/load favorite requests.

### Operations

-   **Error Handling & Logging**: More sophisticated error handling and logging for both frontend and backend.
-   **Monitoring & Alerts**: Set up Firebase/Cloud Monitoring for function invocations, errors, and performance.
-   **Custom Domains**: Configure custom domains for the Firebase App Hosting.

---

## Monitoring and Scheduler Checklist (Prod Readiness)

### Structured Logging in Code
- Emit JSON logs with consistent fields from:
  - `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`
  - AV handlers (e.g., `av-company-overview.handler.ts`, time-series handlers)
- Suggested fields: `component`, `runId`, `endpointId`, `symbol`, `phase`, `status`, `durationMs`, `httpStatus`, `errorCode`.

### Cloud Logging Saved Queries (Stackdriver)
- AV refresh runs:
  - `jsonPayload.component="av.refresh" AND jsonPayload.runId:*`
- Errors only:
  - `severity>=ERROR AND jsonPayload.component="av.refresh"`
- Slow runs (>30s):
  - `jsonPayload.component="av.refresh" AND jsonPayload.durationMs>30000`

### Log-based Metrics and Dashboards
- Counters: `refresh_success_count`, `refresh_error_count` by endpoint.
- Distribution: `refresh_duration_ms` (P50/P95/P99).
- Pub/Sub publish failures (if using outbound announcements): count per 15m.
- Build a dashboard showing success/error rate and 95th percentile durations per endpoint.

### Alerting Policies
- Error rate > N in 15 minutes for AV refresh component.
- No successful refresh for critical endpoints during trading hours.
- Pub/Sub publish failures > 0 in last 15 minutes (if announcements enabled).
- Notify via email/Slack/PagerDuty.

### Scheduler Configuration (Prod)
— BEFORE DEPLOY: Export all new scheduled/HTTP functions from `functions/src/index.ts`.
  - This is mandatory. If a function is not exported in `functions/src/index.ts`, Firebase will NOT deploy it and Cloud Scheduler jobs will NOT be created.
  - Example:
    - `export { refreshAvDailyTimeSeriesPreClose, refreshAvDailyTimeSeriesPostClose } from './v2/alpha-vantage/data-refresher/av-refresh-manager.js';`
— Confirm CRON specs in `functions/src/v2/common/function-schedules.ts` (e.g., 3:30 PM and 4:15 PM ET) match trading-hours alignment.
— Ensure each `onSchedule({ ... })` includes `timeZone: 'America/New_York'` for ET wall‑clock execution.
— After deploy, verify Cloud Scheduler created the jobs and that they have the correct time zone and Next run:
  - In Console: Scheduler → find jobs named `firebase-schedule-*`, open detail, check `Schedule` shows `(America/New_York)` and `Next run` matches ET (convert from your local display if needed).
  - CLI: `gcloud scheduler jobs list --location=us-central1` and `gcloud scheduler jobs describe <job> --location=us-central1`.
— Verify rate limits and concurrency settings for Functions meet AV/Firestore constraints.

### Pre‑Deploy CI/Validation (Required for Functions)
- Grep for all `onSchedule(` and `onRequest(` declarations and ensure corresponding exports exist in `functions/src/index.ts`.
- Example script idea (CI): fail build if any function name is missing from `index.ts`.

### Runbook Quick Checks
- If a newly added scheduler is missing from Cloud Scheduler after deploy:
  1) Confirm it’s exported from `functions/src/index.ts`.
  2) Re‑deploy Functions and refresh the Scheduler page.
  3) Confirm `timeZone` is set in `onSchedule` options and that Next run aligns to ET.
  4) Use `gcloud scheduler jobs list --location=us-central1` for source of truth.

### Secrets and Config
- Store API keys in Secret Manager; grant access to Functions runtime service account.
- Avoid local env flags in prod; rely on secrets and parameterized config.

### Firestore and Rules
- Confirm canonical paths for time-series writes (`symbol-data/{SYMBOL}/time-series/av-<interval>`), and sharded storage where applicable.
- Rules: clients read-only to `symbol-data`/`market-data`; writes restricted to backend service account.

### Rollout and Runbook
- Dry-run in emulator, then deploy to staging, then prod.
- Create a runbook with:
  - How to temporarily pause scheduler.
  - Where to check logs and metrics.
  - How to roll back a function version.

## Alpha Vantage Time Series Refresh Strategy (Updated)

This project uses a Time Series endpoint–driven update flow for Alpha Vantage time series. GLOBAL_QUOTE is not used to update time series.

- Initial backfill happens once per symbol/interval (daily, weekly, monthly; adjusted and/or raw) when a symbol is added to `tracked-symbols`.
  - Call the corresponding time-series endpoint with `outputsize=full`.
  - Handlers perform sharded writes under `symbol-data/{symbol}/time-series/{provider-interval}/years/{year}` and set a minimal top-level doc containing `metadata` and `latestBarTimestamp`.

- Ongoing updates use the same time-series endpoints (not GLOBAL_QUOTE):
  - On each scheduled refresh, call the endpoint with `outputsize=compact` (returns up to the most recent ~100 elements).
  - Use the most recent element in the response as the newest bar to append/patch via the normalized sharded writers.
  - Do not make frequent full backfill calls; reserve `outputsize=full` for initialization or explicit re-backfill operations.

- Field usage and persistence constraints:
  - Only use fields that are present in the time-series payload (open, high, low, close, adjusted close, volume, dividend amount, split coefficient, etc.).
  - Do not calculate or persist synthetic fields derived from GLOBAL_QUOTE such as previous close, change, or change percent for time-series documents.

- Scheduling:
  - Daily time series: run twice each trading day — pre-close and post-close — calling the daily time-series endpoint with `outputsize=compact` and applying the most recent element.
  - Weekly and monthly time series: run every trading day post-close (also with `outputsize=compact`). There is no special week/month-end rollup; we always request the same endpoints each trading day and use the most recent element.
  - There is no separate boundary-window logic.

- Adjusted vs non-adjusted series:
  - Continue to use adjusted endpoints as the canonical default for persisted series where appropriate (e.g., `av-daily-adjusted`, `av-weekly-adjusted`, `av-monthly-adjusted`).
  - we are not currently using raw time series, so we will not be using non-adjusted endpoints.

- Company Overview (OVERVIEW):
  - Unchanged: skip for non-company symbols (e.g., ETFs, crypto). The refresher reads `tracked-symbols/{symbol}.type` and only calls OVERVIEW for equities/companies.

### Pre-close vs Post-close Behavior (Daily)

- Pre-close (purpose): capture the official RTH close using intraday data, then persist to the daily bar.
- Pre-close implementation (updated):
  - Schedule: 16:15 ET (delayed) to ensure the 16:00:00 ET 1-min bar is available.
  - Endpoint: TIME_SERIES_INTRADAY with `interval=1min`.
  - For each symbol, select the `16:00:00` ET bar from the current market date.
  - Persist to the year-sharded DAILY doc using `upsertAvDailyBar` with fields:
    - `o/h/l/c/v`: from the 16:00:00 ET 1-minute bar
    - `io`: observed-at timestamp (ms) for audit
  - Skip parent meta bump on this write; finalization will bump.

- Post-close (finalization):
  - Endpoint: TIME_SERIES_DAILY_ADJUSTED with `outputsize=compact` on scheduled post-close runs and retries.
  - When all symbols are finalized (no pending) run dataset validation; only on pass write the finalization doc at:
    - `/system/time-series-finalization/daily-adjusted/{YYYY-MM-DD}`
    - Full document shape (as written by the refresher):
      ```json
      {
        "marketDate": "YYYY-MM-DD",
        "finalizedAtUTC": "2025-11-15T21:35:12.345Z",
        "finalizedAtET": "2025-11-15 16:35:12",
        "totalSymbols": 1234,
        "finalizedCountTotal": 1234,
        "phase": "post",
        "source": "av-refresh-manager",
        "timing": {
          "createdAt": "<serverTimestamp>",
          "updatedAt": "<serverTimestamp>"
        }
      }
      ```
  - POST partner publish occurs exclusively via Firestore onCreate trigger of the finalization doc.

- Freshness signaling:
  - The top-level provider/interval doc (`symbol-data/{symbol}/time-series/av-daily-adjusted`) reflects finalized freshness after post-close.
  - Pre-close writes are persisted to the daily bar but do not imply finalization.

### Validation-before-finalization and Publishing Model (Daily)

- Validation runs before writing the finalization doc:
  - Completeness: every tracked symbol has a bar at `targetTs`.
  - Sanity: finite `o/h/l/c/v`, `l<=h`, `o,c ∈ [l,h]`, `v>=0`.
  - Status summary is written under `/system/time-series-status/daily-adjusted/{YYYY-MM-DD}.validation`.
- If validation fails:
  - Set `runStatus=completed_with_errors` for the run.
  - Write `/system/time-series-status/daily-adjusted/{YYYY-MM-DD}.remediation` with `needsRemediation: true` and a failed symbols sample.
  - Inline remediation re-fetches DAILY_ADJUSTED for failed symbols, then validation is re-run.
  - Only if validation passes after remediation is the finalization doc written.
- Publishing:
  - PRE messages continue to be published by the pre schedules.
  - DAILY POST publish is no longer emitted by the refresher; it is emitted only by the finalization onCreate trigger.

### Manual Overrides and Analysis Aids (New)

#### Manual run overrides for time-series schedulers
- The internal helper `refreshForEndpoints()` supports manual overrides when invoked programmatically (e.g., local node run, admin function):
  - `force: boolean` — when true, bypasses the weekend/holiday market-closure guard to allow off-hours runs (e.g., Saturdays).
  - `marketDate?: string` — optional target market date in `YYYY-MM-DD`. When provided, the run computes context (DOW/phase strings) using that date (ET) and writes status docs under that date.
  - `phase?: TradingPhase` — explicitly set `PRE` or `POST` (defaults to `POST` for manual runs if unspecified).
  - `trigger?: RefreshTrigger` — tagging for downstream logs/metrics (e.g., `MANUAL`).

Example (local to prod):
```
await refreshForEndpoints(
  [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
  { force: true, phase: TradingPhase.POST, trigger: RefreshTrigger.MANUAL, marketDate: '2025-11-14' }
);
```

PowerShell one-shot (local → prod) to populate `updateLog` (without API key):

````powershell
$env:GOOGLE_CLOUD_PROJECT='alpha-vantage-proxy-api'; `
$env:ALPHAVANTAGE_API_KEY='<YOUR_PROD_AV_KEY_HERE>'
$env:TS_STATUS_UPDATELOG='on'; `
node -e "
(async () => {
  const { refreshForEndpoints } = require('./functions/lib/src/v2/alpha-vantage/data-refresher/av-refresh-manager.js');
  const { AlphaVantageEndpoint } = require('./functions/lib/shared/alpha-vantage/index.js');
  const { TradingPhase } = require('./functions/lib/shared/health-metrics/index.js');
  const { RefreshTrigger } = require('./functions/lib/shared/firestore/index.js');
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    { force: true, phase: TradingPhase.POST, trigger: RefreshTrigger.MANUAL, marketDate: 'YYYY-MM-DD' }
  );
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
````

Notes:
- Requires Application Default Credentials for Firestore access (`gcloud auth application-default login`).
- `TS_STATUS_UPDATELOG=on` enables per-symbol logging under `system/time-series-status/daily-adjusted/{YYYY-MM-DD}`.
- Replace `YYYY-MM-DD` with the target market date.

#### Per-symbol update log for post-close runs
- Location: `system/time-series-status/daily-adjusted/{YYYY-MM-DD}`
- Field: `updateLog: Array<{ s: string; at: number }>`
  - `s`: symbol
  - `at`: epoch milliseconds when that symbol’s finalized daily write occurred
- Scope: appended only during `POST` runs of `TIME_SERIES_DAILY_ADJUSTED`.
- Toggle: enabled when env var `TS_STATUS_UPDATELOG=on` is present in the Functions runtime.
- Cap: the array is capped at 3000 entries per day; once reached, further appends are skipped for the remainder of that run.
- Purpose: short-term analysis of provider update timings; can be disabled later by removing the env flag.

### Future Improvement (TODO)

- TODO: When real-time subscription is enabled, migrate pre-close snapshots to use Alpha Vantage BULK_QUOTE (or equivalent real-time quote stream) for higher fidelity and lower latency. Until then, pre-close uses `TIME_SERIES_INTRADAY` (compact) per above.

## Split Adjustment Strategy

A comprehensive dual-write and backfill strategy has been implemented to handle stock splits and dividend adjustments. This ensures both real-time continuity and historical accuracy.

For detailed design, real-time behavior, and manual backfill instructions, please refer to **[Split Adjustment & Data Consistency Design](./split-adjustment-design.md)**.