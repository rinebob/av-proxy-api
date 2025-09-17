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
- Confirm CRON in `functions/src/v2/common/function-schedules.ts` (e.g., 12:45 PM ET daily) and trading-hours alignment.
- Ensure Cloud Scheduler job exists, targets the correct function, and has proper IAM.
- Verify rate limits and concurrency settings for Functions meet AV/Firestore constraints.

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
  - Daily time series: run twice each trading day — pre-close and post-close — calling the daily time-series endpoint with `outputsize=compact` and applying the most recent bar.
  - Weekly and monthly time series: run every trading day post-close (also with `outputsize=compact`). There is no special week/month-end rollup; we always request the same endpoints each trading day and use the most recent element.
  - There is no separate boundary-window logic.

- Adjusted vs non-adjusted series:
  - Continue to use adjusted endpoints as the canonical default for persisted series where appropriate (e.g., `av-daily-adjusted`, `av-weekly-adjusted`, `av-monthly-adjusted`).
  - we are not currently using raw time series, so we will not be using non-adjusted endpoints.

- Company Overview (OVERVIEW):
  - Unchanged: skip for non-company symbols (e.g., ETFs, crypto). The refresher reads `tracked-symbols/{symbol}.type` and only calls OVERVIEW for equities/companies.

This approach minimizes provider calls to the necessary cadence, preserves sharded storage, and keeps series current by reusing the time-series endpoints with compact output for updates.