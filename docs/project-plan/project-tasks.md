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
- [ ] **Task 7.2: Implement backend rate limiting**
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
