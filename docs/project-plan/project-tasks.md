# Project Tasks: Financial Data Proxy API Surface (Workbench)

This document tracks the completion status of tasks outlined in the `project-plan.md`. 

---

## Phase 1: Core Proxy API Surface Development

### Module 1: Firebase Project Setup & Core Infrastructure

- [x] **Task 1.1: Firebase Project Initialization**
- [x] **Task 1.2: Firebase CLI Setup & Local Environment**

### Module 2: Proxy Backend (Firebase Cloud Functions)

- [x] **Task 2.1: Secure API Key Management**
- [x] **Task 2.2: Generic Proxy Function Structure**
- [x] **Task 2.3: Endpoint-Specific Proxy Functions (Initial Batch)**
- [x] **Task 2.4: Deployment of Cloud Functions**

### Module 3: Frontend (Angular Workbench UI)

- [x] **Task 3.1: Angular Project Setup**
- [x] **Task 3.2: User Authentication UI**
- [x] **Task 3.3: API & Endpoint Navigation**
- [x] **Task 3.4: Data Entry Forms**
- [x] **Task 3.5: API Interaction Service**
- [x] **Task 3.6: Raw JSON Response Display**

### Module 4: Deployment & Testing

- [x] **Task 4.1: Firebase App Hosting Configuration**
- [ ] **Task 4.2: End-to-End Testing**
- [ ] **Task 4.3: Deploy Partner Historical Options Endpoint**
  - [x] Deploy `partnerHistoricalOptionsV2`.
  - [x] Configure `ALPHAVANTAGE_API_KEY` and `ALLOWED_SERVICE_ACCOUNT_EMAILS` secrets.
  - [x] Confirm RS mints OIDC tokens for the deployed endpoint URL, or another audience validated for that target, and that this value is in the shared comma-separated `EXPECTED_GOOGLE_AUDIENCE` allowlist.
  - [x] Restrict Cloud Run invoker IAM to the approved partner service account; do not permit public invocation.
  - [x] Validate one approved symbol/date request in production with the allowlisted service account; no non-production environment is configured.
  - [ ] Create deployment-managed log-based metrics for endpoint request volume, failures, latency, upstream latency, provider rate limits, invalid requests, and response-size rejections.
  - [ ] Roll out production access gradually while monitoring `429`, `413`, `502`, and `504` responses.

---

## Phase 2: API Surface Expansion

### Module 1: Benzinga Calendar API

- [ ] **Task 1.1: Create Cloud Functions for Benzinga Calendar Endpoints**
  - [ ] `getBzDividends`
  - [ ] `getBzEconomics`
  - [ ] `getBzFda`
  - [ ] `getBzGuidance`
  - [ ] `getBzIpos`
  - [ ] `getBzRatings`
  - [ ] `getBzSplits`
- [ ] **Task 1.2: Extend Benzinga Frontend**
  - [x] Update UI to select new calendar endpoints.
  - [ ] Create dynamic forms for each new endpoint.
  - [ ] Update `benzinga.service.ts` to call the new cloud functions.
  - [x] Refactor all frontend usages of BenzingaCalendarType/BENZINGA_CALENDAR_TYPE_LABELS to use BenzingaEndpoint and BENZINGA_ENDPOINTS_META_MAP; fix all related compiler errors

---

## Phase 3: Health Dashboard

### Module 1: Backend Health Monitoring

- [ ] **Task 10.1: Implement health metrics collection**
  - [ ] Create Firestore schema for health metrics
  - [ ] Instrument refresh functions to log health data
  - [ ] Implement scheduled aggregation of metrics

- [ ] **Task 10.2: Create health check endpoints**
  - [ ] Endpoint for current system status
  - [ ] Endpoint for historical metrics
  - [ ] Endpoint for TTL configurations

- [ ] **Task 10.3: Implement alerting system**
  - [ ] Configure alert thresholds
  - [ ] Set up notification channels
  - [ ] Implement alert suppression rules

### Module 2: Frontend Dashboard

- [ ] **Task 10.4: Create dashboard layout**
  - [ ] Design main dashboard view
  - [ ] Implement navigation and routing
  - [ ] Create responsive grid layout

- [ ] **Task 10.5: Implement data visualization**
  - [ ] Status overview cards
  - [ ] Time-series charts for metrics
  - [ ] Data freshness indicators

- [ ] **Task 10.6: Add filtering and search**
  - [ ] Filter by endpoint/status
  - [ ] Search functionality
  - [ ] Time range selection

### Module 3: Integration and Testing

- [ ] **Task 10.7: Integrate with existing systems**
  - [ ] Connect to Firestore real-time updates
  - [ ] Implement authentication/authorization
  - [ ] Set up production monitoring

- [ ] **Task 10.8: Testing and validation**
  - [ ] Unit tests for health metrics collection
  - [ ] Integration tests for dashboard components
  - [ ] End-to-end testing of monitoring flow

---

### Discovered During Work
- As of 2025-06-25: Frontend endpoint selection, canonical metadata, and type consolidation are complete and in sync with backend expectations.
- As of 2025-09-15: Inbound partner notifications fully removed (webhook, subscriber, partnerEvents). System is outbound-only; announcements publish to Pub/Sub with `runs/{runId}` tracking. Emulator workflow and env cleaned up.
- As of 2025-11-12: Cleaned up `runs/{runId}` schema to a lean document. Removed persisted `payload` and `pubsubAttributes`; added grouped `timing` and `runMeta`; normalized `counts` with numeric defaults and legacy mirrors; corrected `header.runStatus` to use `payload.runStatus`. Backfill script recommended to coerce historical null counts to 0.
- As of 2025-12-08: Fixed production build failure by securing Syncfusion license key in Google Secret Manager and configuring Firebase App Hosting to inject it during build. Simplified build command to ensure App Hosting adapter compatibility. Charts view is now accessible in production.
- As of 2025-12-08: Implemented interval toggle (Daily, Weekly, Monthly) for Chart View. Updated ChartDataService to support sharded and non-sharded (monthly) data reads. Adjusted initial chart zoom based on interval.
- TODO: Scan the codebase for any remaining `__checkWriteToggle` / `manualWriteToggle*` flags and remove or inline them. These are deprecated and should not be used in new flows (see `planning/backfill-and-split-toolkit.md` section 7).
- As of 2026-07-08: Created `docs/partner/pubsub-broadcast-developer-guide.md` — comprehensive developer guide covering Pub/Sub broadcast infrastructure, IAM, channels, roles, producer/consumer implementation, and deployment checklists.
- As of 2026-07-08: Implemented `partner-symbol-added` Pub/Sub lifecycle channel. `onSymbolAdded` now fetches DAILY/WEEKLY/MONTHLY in parallel and publishes a `SymbolAddedPayloadV1` only when all intervals succeed. Removed obsolete `_refreshEnabled` field from `TrackedSymbolV2`, converters, add paths, and UI. Added worked example to `docs/partner/pubsub-broadcast-developer-guide.md` and split the manual runbook into `docs/partner/pubsub-broadcast-runbook.md`.
- As of 2026-07-09: Implemented daily intraday OHLCV bar aggregation from Alpha Vantage `TIME_SERIES_INTRADAY` (`15min`/`compact`/`extended_hours=false`, `entitlement=delayed`). New aggregator (`utils/av-intraday-aggregate.utils.ts`) and writer (`firestore/av-intraday-ohlcv.writer.ts`) write aggregated `o/h/l/c/v` into the daily bar. Existing `i*` fields are still populated for backward compatibility during the rollout. W/M intraday overlay continues to use existing ratcheting logic. Added unit tests in `scripts/test/av-intraday-aggregate.test.ts` (9 cases, all passing). Functions build passes. See `docs/project-plan/intraday-full-bar-aggregation.md`.
- As of 2026-07-09: Refined intraday OHLCV implementation after thermo-nuclear review. Migrated daily intraday OHLCV and legacy `i*` writes into one atomic transaction (`firestore/av-intraday-ohlcv.writer.ts` → `upsertAvDailyIntradayBar`). Extracted shared `buildLatestMetadataFromBars` helper in `firestore/av-firestore-utils.ts`. Removed the duplicate daily `i*` snapshot writer. Extracted canonical `fetchAndStoreDailyIntradayBar` service in `services/av-intraday-daily.service.ts` and adopted it in both the intraday snapshot worker and the base handler DAILY PRE path. Worker now runs weekly/monthly snapshots in parallel. Simplified aggregator type guard, moved `Intl.DateTimeFormat` instances out of the aggregation loop, and narrowed the `TIME_SERIES_INTRADAY` interval enum to `1min` and `15min`. Moved unit tests to `functions/tests/v2/alpha-vantage/utils/av-intraday-aggregate.test.ts` and excluded `tests/` from `tsconfig.json`. Functions build passes; all 9 aggregator tests pass.
- As of 2026-07-09: Second thermo-nuclear review cleanup. Renamed writer to `firestore/av-daily-intraday.writer.ts`. Removed `{ bar }` wrapper from `fetchAndStoreDailyIntradayBar`; function now returns `IntradayRthBarAggregate | null`. Moved `dow` computation into the daily writer so the service no longer crosses into firestore utils. Extracted `findImmediatePredecessorBar` and `computeChangeMetrics` helpers in `firestore/av-firestore-utils.ts` and reused them in both the daily writer and the W/M intraday snapshot core. Confirmed W/M change metrics use the *prior period* bar close, not yesterday's daily close. Replaced hand-rolled W/M metadata with `buildLatestMetadataFromBars`. Moved daily writer `Intl.DateTimeFormat` to module scope and replaced W/M `console.log` calls with structured logger. Simplified `getNumeric` in the aggregator. Functions build passes; all 9 aggregator tests pass.
- As of 2026-07-09: Third review pass. Re-exported `av-firestore-utils` from the `firestore` barrel and converted the base handler to import all writers/helpers from `../firestore`. Replaced the base handler's bespoke ET date/dow computation with `todayEtDate()` and `computeDowFromDateString()`. Extracted a single shared `INTRADAY_TIME_FORMATTER` and used it in both the daily and W/M writers. Removed redundant `Number(ip)` and unnecessary `as any`/`as CompactBar` casts from the W/M core. Functions build passes; all 9 aggregator tests pass.
- As of 2026-07-20: Implemented and reviewed `partnerHistoricalOptionsV2`, an authenticated on-demand Alpha Vantage `HISTORICAL_OPTIONS` partner endpoint. It validates `symbol` and optional `date`, uses a provider-neutral no-persistence fetch path, returns normalized contracts plus corrected analysis, and enforces a maximum serialized response size. A second review removed browser CORS/Firebase identity access, stopped inferred contract fields, made aggregate averages exclude unavailable values, and preserved typed provider diagnostics. Deployment, IAM allowlisting, any GCS cache, and any shared Alpha Vantage throttle remain pending.

---

## Future Enhancements (Post-Phase 1)

### Enhanced AI Integration

- [ ] **Task 5.1: Leverage MCP server for AI assistance**
- [ ] **Task 5.2: Integrate Gemini API for request construction**
- [ ] **Task 5.3: Integrate Gemini API for response interpretation**
- [ ] **Task 5.4: Integrate Gemini API for data analysis**

### Dynamic Endpoint Discovery/Form Generation

- [ ] **Task 6.1: Investigate OpenAPI/Swagger for form generation**

### Backend Enhancements

- [ ] **Task 7.1: Implement backend caching**
- [ ] **Task 7.2: Implement shared Alpha Vantage provider throttling**
  - [ ] Coordinate account-wide Alpha Vantage call volume across partner endpoints, scheduled refreshes, and other direct provider consumers.
  - [ ] Preserve the historical-options endpoint's public request and response contract while enforcing the shared provider limit.
- [ ] **Task 7.3: Implement data transformation/filtering**
- [ ] **Task 7.4: Migrate options chains storage (HISTORICAL_OPTIONS) to sharded Firestore or GCS; implement shard-aware readers; re-enable endpoint in refresher**
- [ ] **Task 7.5: Introduce endpoint/interval short code suffix in `runId`**
  - Add compact code (e.g., `-d|-w|-m|gq|sect|...`) to `runId` while preserving readability
  - Update validator to accept the new pattern alongside legacy during rollout
  - Backfill historical run documents to new `runId` format and update any references

### Enhanced UI/UX

- [ ] **Task 8.1: Add JSON pretty-printing and syntax highlighting**
- [ ] **Task 8.2: Add history of requests**
- [ ] **Task 8.3: Add ability to save/load favorite requests**

### Operations

- [ ] **Task 9.1: Implement advanced error handling and logging**
- [ ] **Task 9.2: Set up monitoring and alerts**
- [ ] **Task 9.3: Configure custom domains**
